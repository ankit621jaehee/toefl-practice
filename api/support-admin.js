import {
  createAdminClient,
  getUserFromRequest,
} from "../lib/points.js";

const SUPPORT_ADMIN_EMAIL = "2959618937@qq.com";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function hasSupportAccess(user) {
  const metadata = user?.app_metadata || {};
  const email = String(user?.email || "").trim().toLowerCase();
  return (
    email === SUPPORT_ADMIN_EMAIL &&
    (metadata.role === "admin" ||
      metadata.role === "support" ||
      metadata.support_role === "admin" ||
      metadata.support_role === "support")
  );
}

async function getSupportAgent(req) {
  const supabaseAdmin = createAdminClient();
  const user = await getUserFromRequest(supabaseAdmin, req);
  return { supabaseAdmin, user };
}

export default async function handler(req, res) {
  try {
    const context = await getSupportAgent(req);
    if (!context.user) {
      return res.status(401).json({ error: "请先登录客服账号。" });
    }
    if (!hasSupportAccess(context.user)) {
      return res.status(403).json({ error: "仅指定客服账号可以访问此后台。" });
    }

    const { supabaseAdmin, user } = context;

    if (req.method === "GET") {
      const { error: closeError } = await supabaseAdmin.rpc(
        "close_stale_resolved_support_tickets"
      );
      if (closeError) throw closeError;

      const now = new Date().toISOString();
      const { error: cleanupError } = await supabaseAdmin
        .from("support_tickets")
        .delete()
        .lte("expires_at", now);
      if (cleanupError) throw cleanupError;

      const { data, error } = await supabaseAdmin
        .from("support_tickets")
        .select(
          "id, user_id, reply_email, message, status, cycle, support_reply, replied_at, handled_by, created_at, updated_at, expires_at"
        )
        .gt("expires_at", now)
        .order("updated_at", { ascending: false });

      if (error) throw error;
      const tickets = data || [];
      const ticketIds = tickets.map((ticket) => ticket.id);
      let messages = [];
      if (ticketIds.length > 0) {
        const { data: messageData, error: messageError } = await supabaseAdmin
          .from("support_ticket_messages")
          .select("id, ticket_id, sender, message, cycle, created_at")
          .in("ticket_id", ticketIds)
          .order("created_at", { ascending: true });
        if (messageError) throw messageError;
        messages = messageData || [];
      }

      return res.status(200).json({
        tickets: tickets.map((ticket) => ({
          ...ticket,
          messages: messages.filter((message) => message.ticket_id === ticket.id),
        })),
      });
    }

    if (req.method === "POST") {
      const action = String(req.body?.action || "").trim();
      if (action !== "push_notification") {
        return res.status(400).json({ error: "无效的后台操作。" });
      }

      const title = String(req.body?.title || "").trim();
      const message = String(req.body?.message || "").trim();
      const audience = String(req.body?.audience || "all").trim();
      const targetEmail = String(req.body?.targetEmail || "")
        .trim()
        .toLowerCase();

      if (!title || title.length > 120) {
        return res.status(400).json({ error: "通知标题需要填写，并且不能超过 120 个字符。" });
      }
      if (!message || message.length > 5_000) {
        return res.status(400).json({ error: "通知内容需要填写，并且不能超过 5000 个字符。" });
      }
      if (audience !== "all" && audience !== "specific") {
        return res.status(400).json({ error: "无效的通知接收范围。" });
      }
      if (audience === "specific" && !targetEmail) {
        return res.status(400).json({ error: "请输入指定用户的登录邮箱。" });
      }

      const { data: profiles, error: profileError } = await supabaseAdmin
        .from("profiles")
        .select("id, email");
      if (profileError) throw profileError;

      const recipients = (profiles || []).filter((profile) => {
        if (!profile.id) return false;
        if (audience === "all") return true;
        return String(profile.email || "").trim().toLowerCase() === targetEmail;
      });
      if (recipients.length === 0) {
        return res.status(404).json({ error: "没有找到符合条件的用户。" });
      }

      const rows = recipients.map((profile) => ({
        user_id: profile.id,
        kind: "admin_broadcast",
        title,
        message,
        destination: null,
        source_type: "support_admin",
        source_id: crypto.randomUUID(),
      }));
      const { error: insertError } = await supabaseAdmin
        .from("user_notifications")
        .insert(rows);
      if (insertError) throw insertError;

      return res.status(201).json({ success: true, recipientCount: rows.length });
    }

    if (req.method === "PATCH") {
      const ticketId = String(req.body?.ticketId || "").trim();
      const action = String(req.body?.action || "").trim();
      const supportReply = String(req.body?.supportReply || "").trim();

      if (!UUID_PATTERN.test(ticketId)) {
        return res.status(400).json({ error: "无效的工单编号。" });
      }
      if (action !== "view" && action !== "reply") {
        return res.status(400).json({ error: "无效的工单操作。" });
      }
      if (action === "reply" && !supportReply) {
        return res.status(400).json({ error: "请填写客服回复。" });
      }
      if (supportReply.length > 5_000) {
        return res.status(400).json({ error: "客服回复不能超过 5000 个字符。" });
      }

      const { data: existingTicket, error: existingTicketError } =
        await supabaseAdmin
          .from("support_tickets")
          .select(
            "id, status, cycle, support_reply, replied_at, handled_by, updated_at, expires_at"
          )
          .eq("id", ticketId)
          .gt("expires_at", new Date().toISOString())
          .maybeSingle();
      if (existingTicketError) throw existingTicketError;
      if (!existingTicket) {
        return res.status(404).json({ error: "没有找到这条客服工单。" });
      }

      const now = new Date().toISOString();
      if (existingTicket.status === "closed") {
        return res.status(409).json({ error: "该工单已经完成。" });
      }

      if (action === "reply") {
        const { error: messageError } = await supabaseAdmin
          .from("support_ticket_messages")
          .insert({
            ticket_id: ticketId,
            sender: "support",
            sender_user_id: user.id,
            message: supportReply,
            cycle: Number(existingTicket.cycle || 1),
            created_at: now,
          });
        if (messageError) throw messageError;
      }

      const update = {
        status:
          action === "reply"
            ? "resolved"
            : existingTicket.status === "sent"
              ? "processing"
              : existingTicket.status,
        support_reply:
          action === "reply"
            ? supportReply
            : existingTicket.support_reply || null,
        replied_at:
          action === "reply" ? now : existingTicket.replied_at || null,
        handled_by: existingTicket.handled_by || user.id,
        updated_at:
          action === "view" && existingTicket.status !== "sent"
            ? existingTicket.updated_at
            : now,
      };
      const { data, error } = await supabaseAdmin
        .from("support_tickets")
        .update(update)
        .eq("id", ticketId)
        .select(
          "id, user_id, reply_email, message, status, cycle, support_reply, replied_at, handled_by, created_at, updated_at, expires_at"
        )
        .single();

      if (error) throw error;
      const { data: messages, error: messageLoadError } = await supabaseAdmin
        .from("support_ticket_messages")
        .select("id, ticket_id, sender, message, cycle, created_at")
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: true });
      if (messageLoadError) throw messageLoadError;
      return res.status(200).json({
        ticket: { ...data, messages: messages || [] },
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("Support admin request failed:", error);
    return res.status(500).json({ error: "客服后台请求失败，请稍后重试。" });
  }
}
