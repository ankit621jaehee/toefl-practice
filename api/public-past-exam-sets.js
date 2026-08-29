import { createClient } from "@supabase/supabase-js";

function createAdminClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase server environment variables.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (process.env.VITE_PUBLIC_PAST_EXAM_ACCESS !== "true") {
    return res.status(403).json({ error: "Public question bank access is disabled." });
  }

  try {
    const supabaseAdmin = createAdminClient();
    const { data, error } = await supabaseAdmin
      .from("question_sets")
      .select(
        "id, source_type, title, display_date, mock_number, sort_order, content, created_at"
      )
      .eq("status", "published")
      .eq("source_type", "past_exam")
      .order("sort_order", { ascending: true })
      .order("display_date", { ascending: false });

    if (error) throw error;

    return res.status(200).json({ items: data || [] });
  } catch (error) {
    console.error("Public past exam catalog error:", error);
    return res.status(500).json({
      error: error?.message || "Failed to load the public question bank.",
    });
  }
}
