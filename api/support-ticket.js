import {
  createAdminClient,
  getUserFromRequest,
} from "../lib/points.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TICKET_FIELDS =
  "id, reply_email, message, status, cycle, support_reply, replied_at, created_at, updated_at, expires_at";

async function loadTicketMessages(supabaseAdmin, ticketId) {
  const { data, error } = await supabaseAdmin
    .from("support_ticket_messages")
    .select("id, sender, message, cycle, created_at")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const supabaseAdmin = createAdminClient();
    const user = await getUserFromRequest(supabaseAdmin, req);

    if (!user) {
      return res.status(401).json({ error: "请先登录后再提交客服工单。" });
    }

    const replyEmail = String(user.email || "").trim();
    const message = String(req.body?.message || "").trim();
    const ticketId = String(req.body?.ticketId || "").trim();

    if (!EMAIL_PATTERN.test(replyEmail)) {
      return res.status(400).json({ error: "当前账户没有可用于回复的有效邮箱。" });
    }
    if (!message || message.length > 5_000) {
      return res.status(400).json({ error: "问题内容需要填写，并且不能超过 5000 个字符。" });
    }

    if (ticketId) {
      if (!UUID_PATTERN.test(ticketId)) {
        return res.status(400).json({ error: "无效的工单编号。" });
      }

      const { data: existingTicket, error: ticketError } = await supabaseAdmin
        .from("support_tickets")
        .select("id, user_id, status, cycle, expires_at")
        .eq("id", ticketId)
        .eq("user_id", user.id)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

      if (ticketError) throw ticketError;
      if (!existingTicket) {
        return res.status(404).json({ error: "没有找到这条客服工单。" });
      }
      if (existingTicket.status === "closed") {
        return res.status(409).json({ error: "该工单已完成，不能继续提问。" });
      }
      if (existingTicket.status !== "resolved") {
        return res.status(409).json({ error: "请等待客服处理后再继续提问。" });
      }

      const nextCycle = Number(existingTicket.cycle || 1) + 1;
      const now = new Date().toISOString();
      const { error: messageError } = await supabaseAdmin
        .from("support_ticket_messages")
        .insert({
          ticket_id: ticketId,
          sender: "user",
          sender_user_id: user.id,
          message,
          cycle: nextCycle,
          created_at: now,
        });
      if (messageError) throw messageError;

      const { data: reopenedTicket, error: reopenError } = await supabaseAdmin
        .from("support_tickets")
        .update({
          status: "processing",
          cycle: nextCycle,
          updated_at: now,
        })
        .eq("id", ticketId)
        .eq("user_id", user.id)
        .select(TICKET_FIELDS)
        .single();
      if (reopenError) throw reopenError;

      return res.status(200).json({
        success: true,
        ticket: {
          ...reopenedTicket,
          messages: await loadTicketMessages(supabaseAdmin, ticketId),
        },
      });
    }

    const newTicketId = crypto.randomUUID();
    const { data, error } = await supabaseAdmin
      .from("support_tickets")
      .insert({
        id: newTicketId,
        user_id: user.id,
        reply_email: replyEmail,
        message,
      })
      .select(TICKET_FIELDS)
      .single();

    if (error) {
      console.error("Support ticket persistence failed:", error);
      return res.status(500).json({ error: "客服工单保存失败，请稍后重试。" });
    }

    const { error: initialMessageError } = await supabaseAdmin
      .from("support_ticket_messages")
      .insert({
        ticket_id: newTicketId,
        sender: "user",
        sender_user_id: user.id,
        message,
        cycle: 1,
        created_at: data.created_at,
      });

    if (initialMessageError) {
      await supabaseAdmin.from("support_tickets").delete().eq("id", newTicketId);
      throw initialMessageError;
    }

    return res.status(201).json({
      success: true,
      ticket: {
        ...data,
        messages: await loadTicketMessages(supabaseAdmin, newTicketId),
      },
    });
  } catch (error) {
    console.error("Support ticket submission failed:", error);
    return res.status(500).json({ error: "客服工单提交失败，请稍后重试。" });
  }
}
