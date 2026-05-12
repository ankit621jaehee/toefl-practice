import { createClient } from "@supabase/supabase-js";

function createAdminClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("Missing SUPABASE_URL");
  }

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization || "";

  if (!authHeader.startsWith("Bearer ")) {
    return "";
  }

  return authHeader.replace("Bearer ", "").trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  try {
    const supabaseAdmin = createAdminClient();

    const token = getBearerToken(req);

    if (!token) {
      return res.status(401).json({
        error: "Please sign in first.",
      });
    }

    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return res.status(401).json({
        error: "Invalid or expired login session.",
      });
    }

    const rawCode = req.body?.code;

    const code = String(rawCode || "")
      .trim()
      .toUpperCase();

    if (!code) {
      return res.status(400).json({
        error: "Please enter a redeem code.",
      });
    }

    const { data: redeemCode, error: codeError } = await supabaseAdmin
      .from("redeem_codes")
      .select("id, code, points, max_uses, used_count, expires_at, is_active")
      .eq("code", code)
      .single();

    if (codeError || !redeemCode) {
      return res.status(404).json({
        error: "Invalid redeem code.",
      });
    }

    if (!redeemCode.is_active) {
      return res.status(400).json({
        error: "This redeem code is no longer active.",
      });
    }

    if (redeemCode.expires_at && new Date(redeemCode.expires_at) < new Date()) {
      return res.status(400).json({
        error: "This redeem code has expired.",
      });
    }

    if (redeemCode.used_count >= redeemCode.max_uses) {
      return res.status(400).json({
        error: "This redeem code has already reached its usage limit.",
      });
    }

    const { data: existingLog } = await supabaseAdmin
      .from("redeem_logs")
      .select("id")
      .eq("user_id", user.id)
      .eq("code_id", redeemCode.id)
      .maybeSingle();

    if (existingLog) {
      return res.status(400).json({
        error: "You have already used this redeem code.",
      });
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("points")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({
        error: "User profile not found.",
      });
    }

    const newBalance = profile.points + redeemCode.points;

    const { error: updateProfileError } = await supabaseAdmin
      .from("profiles")
      .update({
        points: newBalance,
      })
      .eq("id", user.id);

    if (updateProfileError) {
      throw updateProfileError;
    }

    const { error: updateCodeError } = await supabaseAdmin
      .from("redeem_codes")
      .update({
        used_count: redeemCode.used_count + 1,
      })
      .eq("id", redeemCode.id);

    if (updateCodeError) {
      throw updateCodeError;
    }

    const { error: logError } = await supabaseAdmin.from("redeem_logs").insert({
      user_id: user.id,
      code_id: redeemCode.id,
      points_added: redeemCode.points,
    });

    if (logError) {
      throw logError;
    }

    return res.status(200).json({
      success: true,
      message: `Redeemed successfully. ${redeemCode.points} points added.`,
      pointsAdded: redeemCode.points,
      balance: newBalance,
    });
  } catch (error) {
    console.error("Redeem code error:", error);

    return res.status(500).json({
      error: error?.message || "Failed to redeem code.",
      details: String(error),
    });
  }
}