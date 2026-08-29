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

function rpcErrorStatus(message) {
  switch (message) {
    case "NOT_AUTHENTICATED":
    case "INVALID_USER":
      return 401;
    case "INVALID_CODE":
    case "PROFILE_NOT_FOUND":
      return 404;
    default:
      return 400;
  }
}

function rpcErrorText(message) {
  switch (message) {
    case "NOT_AUTHENTICATED":
    case "INVALID_USER":
      return "Please sign in first.";
    case "EMPTY_CODE":
      return "Please enter a redeem code.";
    case "INVALID_CODE":
      return "Invalid redeem code.";
    case "INACTIVE_CODE":
      return "This redeem code is no longer active.";
    case "EXPIRED_CODE":
      return "This redeem code has expired.";
    case "CODE_LIMIT_REACHED":
      return "This redeem code has already reached its usage limit.";
    case "CODE_ALREADY_REDEEMED":
      return "You have already used this redeem code.";
    case "PROFILE_NOT_FOUND":
      return "User profile not found.";
    default:
      return message || "Failed to redeem code.";
  }
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

    const { data, error } = await supabaseAdmin.rpc("redeem_code_for_user", {
      target_user_id: user.id,
      raw_code: code,
    });

    if (error) {
      const msg = error.message || "";
      return res.status(rpcErrorStatus(msg)).json({
        error: rpcErrorText(msg),
      });
    }

    const rewardType = data?.rewardType || "credits";
    const pointsAdded = data?.creditsAdded ?? 0;
    const proDays = data?.proDays ?? 0;
    const balance = data?.balance;
    const subscriptionTier = data?.subscriptionTier;
    const subscriptionExpiresAt = data?.subscriptionExpiresAt;

    const message =
      rewardType === "pro"
        ? `Redeemed successfully. Pro membership activated for ${proDays} days.`
        : `Redeemed successfully. ${pointsAdded} points added.`;

    return res.status(200).json({
      success: true,
      message,
      pointsAdded,
      balance,
      rewardType,
      proDays,
      subscriptionTier,
      subscriptionExpiresAt,
    });
  } catch (error) {
    console.error("Redeem code error:", error);

    return res.status(500).json({
      error: error?.message || "Failed to redeem code.",
      details: String(error),
    });
  }
}
