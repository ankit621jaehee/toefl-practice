import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supportAdminSupabase } from "./supabaseClient";

type TicketStatus = "sent" | "processing" | "resolved" | "closed";
type SupportAdminView = "home" | "tickets" | "notifications";

type SupportMessage = {
  id: string;
  ticket_id: string;
  sender: "user" | "support";
  message: string;
  cycle: number;
  created_at: string;
};

type SupportTicket = {
  id: string;
  user_id: string;
  reply_email: string;
  message: string;
  status: TicketStatus;
  cycle: number;
  support_reply: string | null;
  replied_at: string | null;
  handled_by: string | null;
  created_at: string;
  updated_at: string;
  messages: SupportMessage[];
};

const STATUS_LABELS: Record<TicketStatus, string> = {
  sent: "已提交",
  processing: "处理中",
  resolved: "已处理",
  closed: "已完成",
};
const SUPPORT_ADMIN_EMAIL = "2959618937@qq.com";

function getSupportAdminView(pathname = window.location.pathname): SupportAdminView {
  if (pathname.endsWith("/tickets")) return "tickets";
  if (pathname.endsWith("/notifications")) return "notifications";
  return "home";
}

async function getAccessToken() {
  const { data } = await supportAdminSupabase.auth.getSession();
  return data.session?.access_token || "";
}

export default function SupportAdminPage() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [adminView, setAdminView] = useState<SupportAdminView>(() =>
    getSupportAdminView()
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | TicketStatus>("all");
  const [reply, setReply] = useState("");
  const [loadMessage, setLoadMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [notificationAudience, setNotificationAudience] = useState<
    "all" | "specific"
  >("all");
  const [notificationTargetEmail, setNotificationTargetEmail] = useState("");
  const [notificationTitle, setNotificationTitle] = useState("");
  const [notificationMessage, setNotificationMessage] = useState("");
  const [notificationStatus, setNotificationStatus] = useState("");
  const [isSendingNotification, setIsSendingNotification] = useState(false);

  const selectedTicket = tickets.find((ticket) => ticket.id === selectedId) || null;
  const filteredTickets = useMemo(
    () =>
      statusFilter === "all"
        ? tickets
        : tickets.filter((ticket) => ticket.status === statusFilter),
    [statusFilter, tickets]
  );
  const activeTicketCount = tickets.filter(
    (ticket) => ticket.status !== "closed"
  ).length;
  function navigateAdminView(view: SupportAdminView) {
    const path =
      view === "home" ? "/support-admin" : `/support-admin/${view}`;
    window.history.pushState({}, "", path);
    setAdminView(view);
  }

  useEffect(() => {
    const handlePopState = () => setAdminView(getSupportAdminView());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    let isMounted = true;
    void supportAdminSupabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      setUser(data.session?.user || null);
      setIsAuthLoading(false);
    });
    const {
      data: { subscription },
    } = supportAdminSupabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      setUser(session?.user || null);
      setIsAuthLoading(false);
    });
    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function loadTickets() {
    setIsLoading(true);
    setLoadMessage("");
    try {
      const token = await getAccessToken();
      const response = await fetch("/api/support-admin", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "工单加载失败。");
      const nextTickets = (payload.tickets || []) as SupportTicket[];
      setTickets(nextTickets);
      setSelectedId((current) =>
        nextTickets.some((ticket) => ticket.id === current)
          ? current
          : ""
      );
    } catch (error) {
      setLoadMessage(error instanceof Error ? error.message : "工单加载失败。");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (user) void loadTickets();
    else {
      setTickets([]);
      setSelectedId("");
    }
  }, [user]);

  useEffect(() => {
    if (!selectedTicket) return;
    setReply("");
  }, [selectedTicket?.id]);

  async function openTicket(ticket: SupportTicket) {
    setSelectedId(ticket.id);
    setLoadMessage("");
    if (ticket.status !== "sent") return;

    try {
      const token = await getAccessToken();
      const response = await fetch("/api/support-admin", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action: "view", ticketId: ticket.id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "工单状态更新失败。");
      const updated = payload.ticket as SupportTicket;
      setTickets((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      );
    } catch (error) {
      setLoadMessage(
        error instanceof Error ? error.message : "工单状态更新失败。"
      );
    }
  }

  async function signIn() {
    if (!email.trim() || !password) {
      setAuthMessage("请输入客服账号和密码。");
      return;
    }
    const normalizedEmail =
      email.trim() === "2959618937"
        ? SUPPORT_ADMIN_EMAIL
        : email.trim().toLowerCase();
    if (normalizedEmail !== SUPPORT_ADMIN_EMAIL) {
      setAuthMessage("仅允许指定客服账号登录。");
      return;
    }
    setIsSigningIn(true);
    setAuthMessage("");
    const { error } = await supportAdminSupabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });
    setIsSigningIn(false);
    if (error) setAuthMessage("账号或密码错误。");
    else setPassword("");
  }

  async function saveTicket() {
    if (!selectedTicket) return;
    if (!reply.trim()) {
      setLoadMessage("请先填写客服回复。");
      return;
    }
    setIsSaving(true);
    setLoadMessage("");
    try {
      const token = await getAccessToken();
      const response = await fetch("/api/support-admin", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          action: "reply",
          ticketId: selectedTicket.id,
          supportReply: reply.trim(),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "工单保存失败。");
      const updated = payload.ticket as SupportTicket;
      setTickets((current) =>
        current
          .map((ticket) => (ticket.id === updated.id ? updated : ticket))
          .sort(
            (left, right) =>
              Date.parse(right.updated_at) - Date.parse(left.updated_at)
          )
      );
      setReply("");
      setLoadMessage("回复已发送，工单已自动变为“已处理”。");
    } catch (error) {
      setLoadMessage(error instanceof Error ? error.message : "工单保存失败。");
    } finally {
      setIsSaving(false);
    }
  }

  async function pushNotification() {
    if (!notificationTitle.trim() || !notificationMessage.trim()) {
      setNotificationStatus("请填写通知标题和内容。");
      return;
    }
    if (notificationAudience === "specific" && !notificationTargetEmail.trim()) {
      setNotificationStatus("请输入指定用户的登录邮箱。");
      return;
    }

    setIsSendingNotification(true);
    setNotificationStatus("");
    try {
      const token = await getAccessToken();
      const response = await fetch("/api/support-admin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          action: "push_notification",
          audience: notificationAudience,
          targetEmail: notificationTargetEmail.trim(),
          title: notificationTitle.trim(),
          message: notificationMessage.trim(),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "通知发送失败。");

      setNotificationTitle("");
      setNotificationMessage("");
      setNotificationTargetEmail("");
      setNotificationStatus(`通知已发送给 ${payload.recipientCount || 0} 位用户。`);
    } catch (error) {
      setNotificationStatus(
        error instanceof Error ? error.message : "通知发送失败。"
      );
    } finally {
      setIsSendingNotification(false);
    }
  }

  if (isAuthLoading) {
    return (
      <main
        className="support-admin-auth-loading"
        aria-live="polite"
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#f5f7fa",
          color: "#68708a",
          fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
          fontWeight: 800,
        }}
      >
        正在检查客服后台登录状态…
      </main>
    );
  }

  if (!user) {
    return (
      <main className="support-admin-login">
        <style>{`
          .support-admin-login { min-height: 100vh; display: grid; place-items: center; padding: 24px; box-sizing: border-box; background: #f5f7fa; color: #171c2d; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
          .support-admin-login section { width: min(420px,100%); display: grid; gap: 14px; padding: 34px; box-sizing: border-box; border: 1px solid #e2e6ef; border-radius: 22px; background: radial-gradient(circle at 100% 0%,rgba(83,101,255,.055),transparent 38%),#fbfcfe; box-shadow: 0 30px 90px rgba(25,31,56,.18),0 8px 24px rgba(25,31,56,.07); }
          .support-admin-login img { width: 150px; }
          .support-admin-login span { color: #00756f; font-size: 12px; font-weight: 900; letter-spacing: .12em; }
          .support-admin-login h1 { margin: 0; font-size: 34px; }
          .support-admin-login p { margin: 0 0 8px; color: #68708a; }
          .support-admin-login input { width: 100%; box-sizing: border-box; border: 1px solid #dfe3eb; border-radius: 12px; background: white; padding: 12px 14px; font: inherit; transition: border-color .16s ease,box-shadow .16s ease; }
          .support-admin-login input:focus { outline: 0; border-color: rgba(5,128,122,.55); box-shadow: 0 0 0 3px rgba(5,128,122,.1); }
          .support-admin-login button { min-height: 44px; border: 0; border-radius: 999px; background: #05807a; color: white; padding: 10px 20px; font-weight: 900; cursor: pointer; box-shadow: 0 8px 18px rgba(5,128,122,.15); }
          .support-admin-login button:disabled { cursor: wait; opacity: .65; }
        `}</style>
        <section>
          <img src="/forge-logo-trimmed.png" alt="FORGE" />
          <span>SUPPORT ADMIN</span>
          <h1>客服后台</h1>
          <p>仅允许指定客服账号登录。</p>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="2959618937"
          />
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void signIn();
            }}
            placeholder="密码"
          />
          {authMessage && <strong>{authMessage}</strong>}
          <button type="button" onClick={() => void signIn()} disabled={isSigningIn}>
            {isSigningIn ? "正在登录..." : "登录客服后台"}
          </button>
        </section>
      </main>
    );
  }

  return (
    <div className="support-admin-shell">
      <style>{`
        .support-admin-shell, .support-admin-login { min-height: 100vh; background: #f5f7fa; color: #171c2d; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
        .support-admin-login { display: grid; place-items: center; padding: 24px; box-sizing: border-box; }
        .support-admin-login section { width: min(420px,100%); display: grid; gap: 14px; padding: 34px; border: 1px solid #e2e6ef; border-radius: 22px; background: #fbfcfe; box-shadow: 0 30px 90px rgba(25,31,56,.18),0 8px 24px rgba(25,31,56,.07); }
        .support-admin-login img { width: 150px; }
        .support-admin-login span { color: #00756f; font-size: 12px; font-weight: 900; letter-spacing: .12em; }
        .support-admin-login h1 { margin: 0; font-size: 34px; }
        .support-admin-login p { margin: 0 0 8px; color: #68708a; }
        .support-admin-login input, .support-admin-editor textarea, .support-admin-editor select, .support-admin-notification input, .support-admin-notification textarea, .support-admin-notification select { width: 100%; box-sizing: border-box; border: 1px solid #dfe3eb; border-radius: 12px; background: white; padding: 12px 14px; color: #171c2d; font: inherit; transition: border-color .16s ease,box-shadow .16s ease; }
        .support-admin-login input:focus, .support-admin-editor textarea:focus, .support-admin-editor select:focus, .support-admin-notification input:focus, .support-admin-notification textarea:focus, .support-admin-notification select:focus { outline: 0; border-color: rgba(5,128,122,.55); box-shadow: 0 0 0 3px rgba(5,128,122,.1); }
        .support-admin-login button, .support-admin-primary { min-height: 42px; border: 0; border-radius: 999px; background: #05807a; color: white; padding: 10px 20px; font-weight: 900; cursor: pointer; box-shadow: 0 8px 18px rgba(5,128,122,.15); }
        .support-admin-primary:disabled, .support-admin-login button:disabled { cursor: wait; opacity: .58; }
        .support-admin-header { min-height: 72px; display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 0 28px; border-bottom: 1px solid #e8ebf2; background: linear-gradient(110deg,#f5fbfa 0%,#f8f8ff 100%); color: #171c2d; }
        .support-admin-header img { width: 125px; }
        .support-admin-header div { display: flex; align-items: center; gap: 14px; font-size: 13px; font-weight: 800; }
        .support-admin-header div > span { color: #68708a; }
        .support-admin-header button { border: 1px solid #dfe3eb; border-radius: 999px; background: white; color: #35307d; padding: 8px 13px; font-weight: 850; cursor: pointer; }
        .support-admin-header button:first-child { color: #05807a; }
        .support-admin-main { max-width: 1180px; margin: 0 auto; padding: 32px 26px 46px; }
        .support-admin-title { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 16px; padding: 2px 4px; }
        .support-admin-title h1 { margin: 0; font-size: 29px; letter-spacing: -.025em; }
        .support-admin-title p { margin: 6px 0 0; color: #68708a; }
        .support-admin-filters { display: flex; gap: 8px; flex-wrap: wrap; }
        .support-admin-filters button { border: 1px solid #dfe3eb; border-radius: 999px; background: white; color: #68708a; padding: 8px 13px; font-weight: 850; cursor: pointer; }
        .support-admin-filters button.active { background: rgba(5,128,122,.09); color: #05807a; border-color: rgba(5,128,122,.18); }
        .support-admin-notification { margin-bottom: 20px; padding: clamp(24px,4vw,44px); display: grid; grid-template-columns: minmax(150px,.45fr) minmax(190px,.7fr) minmax(220px,1fr) auto; gap: 16px; align-items: end; border: 1px solid #e2e6ef; border-radius: 22px; background: radial-gradient(circle at 100% 0%,rgba(83,101,255,.055),transparent 38%),white; box-shadow: 0 18px 45px rgba(31,36,64,.07); }
        .support-admin-notification h2 { grid-column: 1/-1; margin: 0 0 6px; font-size: 24px; letter-spacing: -.02em; }
        .support-admin-notification label { display: grid; gap: 8px; color: #68708a; font-size: 12px; font-weight: 850; }
        .support-admin-notification textarea { grid-column: 1/-2; min-height: 130px; resize: vertical; line-height: 1.7; }
        .support-admin-notification .support-admin-primary { min-height: 44px; }
        .support-admin-notification-status { grid-column: 1/-1; margin: 0; color: #00756f; font-size: 13px; font-weight: 800; }
        .support-admin-grid { min-height: min(650px,calc(100vh - 190px)); display: grid; grid-template-columns: minmax(290px,35%) minmax(0,1fr); border: 1px solid #e2e6ef; border-radius: 22px; background: #fbfcfe; overflow: hidden; box-shadow: 0 24px 65px rgba(31,36,64,.1); }
        .support-admin-list { max-height: calc(100vh - 190px); overflow-y: auto; display: flex; flex-direction: column; gap: 7px; padding: 12px; border-right: 1px solid #e8ebf2; background: #f5f7fa; }
        .support-admin-editor { min-width: 0; overflow-y: auto; padding: clamp(28px,4vw,48px); display: grid; align-content: start; gap: 18px; background: radial-gradient(circle at 100% 0%,rgba(83,101,255,.055),transparent 38%),white; }
        .support-admin-ticket { position: relative; width: 100%; display: grid; gap: 7px; flex: 0 0 auto; border: 1px solid transparent; border-radius: 12px; background: white; padding: 14px; color: #171c2d; text-align: left; cursor: pointer; }
        .support-admin-ticket:hover { border-color: #dce4e8; }
        .support-admin-ticket.active { border-color: rgba(5,128,122,.38); box-shadow: 0 8px 20px rgba(42,68,83,.08); }
        .support-admin-ticket.active::before { content: ""; position: absolute; top: 11px; bottom: 11px; left: -1px; width: 3px; border-radius: 0 3px 3px 0; background: #05807a; }
        .support-admin-ticket strong { color: #171c2d; font-size: 15px; }
        .support-admin-ticket span { color: #68708a; font-size: 12px; }
        .support-admin-badge { justify-self: start; border: 1px solid rgba(5,128,122,.16); border-radius: 999px; background: rgba(5,128,122,.07); color: #05807a !important; padding: 4px 8px; font-weight: 900; }
        .support-admin-editor h2 { margin: 0; font-size: 27px; letter-spacing: -.02em; }
        .support-admin-meta { display: flex; gap: 10px 18px; flex-wrap: wrap; color: #68708a; font-size: 13px; font-weight: 750; }
        .support-admin-message { border: 1px solid #e8ebf2; border-radius: 14px; background: #f8fafc; padding: 18px; white-space: pre-wrap; line-height: 1.75; }
        .support-admin-thread { display: grid; gap: 10px; }
        .support-admin-thread h3 { margin: 0; font-size: 15px; }
        .support-admin-thread-message { max-width: 86%; border: 1px solid #e3e6ef; border-radius: 14px; background: #f8fafc; padding: 13px 15px; }
        .support-admin-thread-message.support { justify-self: end; border-color: #bfe2df; background: #eef9f8; }
        .support-admin-thread-message strong { display: block; margin-bottom: 5px; color: #35307d; font-size: 12px; }
        .support-admin-thread-message.support strong { color: #00756f; }
        .support-admin-thread-message p { margin: 0; white-space: pre-wrap; line-height: 1.6; }
        .support-admin-thread-message time { display: block; margin-top: 6px; color: #7b8297; font-size: 11px; }
        .support-admin-editor label { display: grid; gap: 8px; font-size: 13px; font-weight: 900; color: #35307d; }
        .support-admin-editor textarea { min-height: 160px; resize: vertical; line-height: 1.7; }
        .support-admin-note { margin: 0 4px 14px; color: #00756f; font-weight: 800; }
        .support-admin-home-intro { margin-bottom: 18px; padding: 24px 28px; border: 1px solid #e2e6ef; border-radius: 22px; background: linear-gradient(110deg,#f5fbfa 0%,#f8f8ff 100%); box-shadow: 0 12px 34px rgba(31,36,64,.055); }
        .support-admin-home-intro span { color: #05807a; font-size: 12px; font-weight: 950; letter-spacing: .12em; }
        .support-admin-home-intro h1 { margin: 8px 0 6px; font-size: 32px; letter-spacing: -.025em; }
        .support-admin-home-intro p { max-width: 680px; margin: 0; color: #68708a; line-height: 1.7; }
        .support-admin-home-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 14px; padding: 14px; border: 1px solid #e2e6ef; border-radius: 22px; background: #f5f7fa; box-shadow: 0 24px 65px rgba(31,36,64,.08); }
        .support-admin-home-card { min-height: 230px; display: grid; grid-template-rows: auto auto 1fr auto; gap: 10px; padding: 26px; border: 1px solid transparent; border-radius: 16px; background: white; color: #171c2d; text-align: left; cursor: pointer; transition: transform .18s ease,border-color .18s ease,box-shadow .18s ease; }
        .support-admin-home-card:hover { transform: translateY(-2px); border-color: rgba(5,128,122,.32); box-shadow: 0 14px 30px rgba(42,68,83,.08); }
        .support-admin-home-card:focus-visible { outline: 3px solid rgba(0,117,111,.25); outline-offset: 3px; }
        .support-admin-home-card-label { justify-self: start; padding: 5px 9px; border: 1px solid rgba(5,128,122,.16); border-radius: 999px; background: rgba(5,128,122,.07); color: #05807a; font-size: 11px; font-weight: 900; letter-spacing: .08em; }
        .support-admin-home-card h2 { margin: 0; font-size: 26px; }
        .support-admin-home-card p { margin: 0; color: #68708a; line-height: 1.65; }
        .support-admin-home-card-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 16px; border-top: 1px solid #eceef5; color: #35307d; font-size: 14px; font-weight: 900; }
        .support-admin-home-card-count { color: #05807a; }
        @media (max-width: 800px) { .support-admin-header { min-height: 64px; padding: 8px 14px; } .support-admin-header img { width: 105px; } .support-admin-header div { gap: 7px; } .support-admin-header div > span { display:none; } .support-admin-header button { padding: 7px 10px; } .support-admin-main { padding: 18px 12px 30px; } .support-admin-title { align-items: flex-start; flex-direction: column; } .support-admin-notification { grid-template-columns: 1fr; padding: 24px 20px; border-radius: 16px; } .support-admin-notification h2, .support-admin-notification textarea, .support-admin-notification-status { grid-column: 1; } .support-admin-grid { min-height: 0; grid-template-columns: 1fr; border-radius: 16px; } .support-admin-list { max-height: 330px; border-right: 0; border-bottom: 1px solid #e8ebf2; } .support-admin-editor { padding: 24px 20px 30px; } .support-admin-home-grid { grid-template-columns: 1fr; padding: 10px; border-radius: 16px; } .support-admin-home-intro { padding: 22px; border-radius: 16px; } .support-admin-home-intro h1 { font-size: 29px; } .support-admin-home-card { min-height: 210px; padding: 22px; } }
      `}</style>
      <header className="support-admin-header">
        <img src="/forge-logo-trimmed.png" alt="FORGE" />
        <div>
          {adminView !== "home" && (
            <button type="button" onClick={() => navigateAdminView("home")}>
              ← 返回主页
            </button>
          )}
          <span>{user.email}</span>
          <button type="button" onClick={() => void supportAdminSupabase.auth.signOut()}>
            退出登录
          </button>
        </div>
      </header>
      <main className="support-admin-main">
        {adminView === "home" && (
          <>
            <section className="support-admin-home-intro">
              <span>SUPPORT ADMIN</span>
              <h1>客服后台</h1>
              <p>选择需要处理的工作。用户问题与通知推送已分开管理。</p>
            </section>
            <section className="support-admin-home-grid">
              <button
                type="button"
                className="support-admin-home-card"
                onClick={() => navigateAdminView("tickets")}
              >
                <span className="support-admin-home-card-label">TICKETS</span>
                <h2>工单管理</h2>
                <p>查看用户问题与历史回复；工单状态会根据查看、回复和用户追问自动更新。</p>
                <span className="support-admin-home-card-footer">
                  <span className="support-admin-home-card-count">
                    {isLoading ? "正在读取…" : `${activeTicketCount} 条未结束`}
                  </span>
                  <span>进入管理 →</span>
                </span>
              </button>
              <button
                type="button"
                className="support-admin-home-card"
                onClick={() => navigateAdminView("notifications")}
              >
                <span className="support-admin-home-card-label">NOTIFICATIONS</span>
                <h2>通知管理</h2>
                <p>向全部用户或指定用户推送系统更新、活动和服务通知。</p>
                <span className="support-admin-home-card-footer">
                  <span className="support-admin-home-card-count">支持全部或指定用户</span>
                  <span>进入管理 →</span>
                </span>
              </button>
            </section>
          </>
        )}

        {adminView === "notifications" && (
          <>
            <div className="support-admin-title">
              <div>
                <h1>通知管理</h1>
                <p>向全部用户或指定用户推送通知。</p>
              </div>
            </div>
            <section className="support-admin-notification">
              <h2>发送通知</h2>
              <label>
                接收范围
                <select
                  value={notificationAudience}
                  onChange={(event) =>
                    setNotificationAudience(event.target.value as "all" | "specific")
                  }
                >
                  <option value="all">全部用户</option>
                  <option value="specific">指定用户</option>
                </select>
              </label>
              {notificationAudience === "specific" && (
                <label>
                  用户登录邮箱
                  <input
                    type="email"
                    value={notificationTargetEmail}
                    onChange={(event) => setNotificationTargetEmail(event.target.value)}
                    placeholder="user@example.com"
                  />
                </label>
              )}
              <label>
                通知标题
                <input
                  value={notificationTitle}
                  onChange={(event) => setNotificationTitle(event.target.value)}
                  placeholder="例如：系统更新通知"
                  maxLength={120}
                />
              </label>
              <textarea
                value={notificationMessage}
                onChange={(event) => setNotificationMessage(event.target.value)}
                placeholder="输入推送给用户的通知内容..."
                maxLength={5000}
              />
              <button
                type="button"
                className="support-admin-primary"
                onClick={() => void pushNotification()}
                disabled={isSendingNotification}
              >
                {isSendingNotification ? "正在发送..." : "发送通知"}
              </button>
              {notificationStatus && (
                <p className="support-admin-notification-status">
                  {notificationStatus}
                </p>
              )}
            </section>
          </>
        )}

        {adminView === "tickets" && (
          <>
            <div className="support-admin-title">
              <div>
                <h1>工单管理</h1>
                <p>点击工单后自动进入处理中，回复后转为已处理；48 小时无追问将自动完成。</p>
              </div>
              <div className="support-admin-filters">
                {(["all", "sent", "processing", "resolved", "closed"] as const).map(
                  (value) => (
                    <button
                      key={value}
                      type="button"
                      className={statusFilter === value ? "active" : undefined}
                      onClick={() => setStatusFilter(value)}
                    >
                      {value === "all" ? "全部" : STATUS_LABELS[value]}
                    </button>
                  )
                )}
              </div>
            </div>
            {loadMessage && <p className="support-admin-note">{loadMessage}</p>}
            <div className="support-admin-grid">
              <section className="support-admin-list">
                {isLoading && <div style={{ padding: 20 }}>正在加载工单...</div>}
                {!isLoading && filteredTickets.length === 0 && (
                  <div style={{ padding: 20, color: "#68708a" }}>暂无工单。</div>
                )}
                {filteredTickets.map((ticket) => (
                  <button
                    key={ticket.id}
                    type="button"
                    className={`support-admin-ticket${ticket.id === selectedId ? " active" : ""}`}
                    onClick={() => void openTicket(ticket)}
                  >
                    <strong>
                      {ticket.message.length > 52
                        ? `${ticket.message.slice(0, 52)}...`
                        : ticket.message}
                    </strong>
                    <span>{ticket.reply_email}</span>
                    <span>{new Date(ticket.created_at).toLocaleString("zh-CN")}</span>
                    <span className="support-admin-badge">{STATUS_LABELS[ticket.status]}</span>
                  </button>
                ))}
              </section>
              <section className="support-admin-editor">
                {!selectedTicket && <p>请选择一条工单。</p>}
                {selectedTicket && (
                  <>
                    <h2>工单详情</h2>
                    <div className="support-admin-meta">
                      <span>工单：{selectedTicket.id.slice(0, 8)}</span>
                      <span>用户：{selectedTicket.reply_email}</span>
                      <span>第 {selectedTicket.cycle} 轮</span>
                      <span>{new Date(selectedTicket.created_at).toLocaleString("zh-CN")}</span>
                    </div>
                    <div className="support-admin-message">{selectedTicket.message}</div>
                    {selectedTicket.messages?.filter(
                      (message, index) =>
                        !(
                          index === 0 &&
                          message.sender === "user" &&
                          message.message === selectedTicket.message
                        )
                    ).length > 0 && (
                      <div className="support-admin-thread">
                        <h3>后续沟通</h3>
                        {selectedTicket.messages
                          .filter(
                            (message, index) =>
                              !(
                                index === 0 &&
                                message.sender === "user" &&
                                message.message === selectedTicket.message
                              )
                          )
                          .map((message) => (
                            <div
                              key={message.id}
                              className={`support-admin-thread-message ${message.sender}`}
                            >
                              <strong>
                                {message.sender === "support" ? "客服回复" : "用户续问"}
                                {` · 第 ${message.cycle} 轮`}
                              </strong>
                              <p>{message.message}</p>
                              <time>{new Date(message.created_at).toLocaleString("zh-CN")}</time>
                            </div>
                          ))}
                      </div>
                    )}
                    <p className="support-admin-note" style={{ margin: 0 }}>
                      当前状态：{STATUS_LABELS[selectedTicket.status]}。状态由系统自动更新，客服无需手动选择。
                    </p>
                    {selectedTicket.status !== "closed" ? (
                      <>
                        <label>
                          回复用户
                          <textarea
                            value={reply}
                            onChange={(event) => setReply(event.target.value)}
                            placeholder="输入处理结果或需要用户补充的信息..."
                            maxLength={5000}
                          />
                        </label>
                        <button
                          type="button"
                          className="support-admin-primary"
                          onClick={() => void saveTicket()}
                          disabled={isSaving || !reply.trim()}
                        >
                          {isSaving ? "正在发送..." : "回复并标记为已处理"}
                        </button>
                      </>
                    ) : (
                      <p className="support-admin-note" style={{ margin: 0 }}>
                        此工单已自动完成，不能继续回复。
                      </p>
                    )}
                  </>
                )}
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
