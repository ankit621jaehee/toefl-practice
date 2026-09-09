import {
  createAdminClient,
  getUserFromRequest,
} from "../lib/points.js";

const DELETE_TARGETS = {
  practice: { table: "practice_records", idColumn: "id" },
  mock: { table: "mock_records", idColumn: "id" },
  session: { table: "practice_sessions", idColumn: "client_session_id" },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const supabaseAdmin = createAdminClient();
    const user = await getUserFromRequest(supabaseAdmin, req);

    if (!user) {
      return res.status(401).json({ error: "请先登录再删除记录。" });
    }

    const source = String(req.body?.source || "");
    const id = String(req.body?.id || "").trim();
    const target = Object.prototype.hasOwnProperty.call(DELETE_TARGETS, source)
      ? DELETE_TARGETS[source]
      : null;

    if (!target || !id) {
      return res.status(400).json({ error: "删除目标无效。" });
    }

    const { data, error } = await supabaseAdmin
      .from(target.table)
      .delete()
      .eq(target.idColumn, id)
      .eq("user_id", user.id)
      .select(target.idColumn);

    if (error) {
      throw error;
    }

    if (!data?.length) {
      return res.status(404).json({ error: "未找到这条记录，或记录已被删除。" });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Delete record error:", error);
    return res.status(500).json({ error: "删除失败，请稍后重试。" });
  }
}
