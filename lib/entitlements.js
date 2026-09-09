import { getUserFromRequest } from "./points.js";

export function isActivePro(profile) {
  if (profile?.subscription_tier !== "pro") return false;
  if (!profile.subscription_expires_at) return true;
  const expiresAt = Date.parse(profile.subscription_expires_at);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

export async function getActiveEntitlement(supabaseAdmin, userId) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("subscription_tier, subscription_expires_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;

  return {
    isPro: isActivePro(data),
    tier: isActivePro(data) ? "pro" : "free",
    expiresAt: data?.subscription_expires_at || null,
  };
}

export async function requireActivePro(supabaseAdmin, req) {
  const user = await getUserFromRequest(supabaseAdmin, req);

  if (!user) {
    const error = new Error("请先登录后再使用个性化练习。");
    error.statusCode = 401;
    throw error;
  }

  const entitlement = await getActiveEntitlement(supabaseAdmin, user.id);
  if (!entitlement.isPro) {
    const error = new Error("个性化练习为 Pro 功能，请先兑换或升级会员。");
    error.statusCode = 403;
    throw error;
  }

  return { user, ...entitlement };
}
