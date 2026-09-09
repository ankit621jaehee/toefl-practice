import {
  createAdminClient,
  getCreditBalance,
  getUserFromRequest,
} from "../lib/points.js";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const supabaseAdmin = createAdminClient();
    const user = await getUserFromRequest(supabaseAdmin, req);

    if (!user) {
      return res.status(401).json({ error: "Please sign in first." });
    }

    if (req.method === "GET") {
      return res.status(200).json(await getCreditBalance(supabaseAdmin, user.id));
    }

    if (req.body?.action !== "check-in") {
      return res.status(400).json({ error: "Unsupported credit action." });
    }

    const { data, error } = await supabaseAdmin.rpc("claim_daily_credit", {
      target_user_id: user.id,
    });
    if (error) throw error;

    return res.status(200).json(data);
  } catch (error) {
    console.error("Credits API error:", error);
    return res.status(error?.statusCode || 500).json({
      error: error?.message || "Failed to load credits.",
    });
  }
}
