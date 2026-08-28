import { createClient } from "@supabase/supabase-js";

export const TEMP_REVIEW_ACCESS_ENABLED = true;
export const TEMP_REVIEW_POINTS = 999;

export function createAdminClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase server environment variables.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

export async function getUserFromRequest(supabaseAdmin, req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;

  if (!token) return null;

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) return null;

  return user;
}

export async function getUserProfile(supabaseAdmin, userId) {
  if (TEMP_REVIEW_ACCESS_ENABLED) {
    return { points: TEMP_REVIEW_POINTS };
  }

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("points")
    .eq("id", userId)
    .single();

  if (error || !data) {
    throw new Error("User profile not found.");
  }

  return data;
}

export async function deductPoints(supabaseAdmin, userId, currentPoints, cost) {
  if (TEMP_REVIEW_ACCESS_ENABLED) {
    return TEMP_REVIEW_POINTS;
  }

  const newBalance = currentPoints - cost;

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ points: newBalance })
    .eq("id", userId);

  if (error) throw error;

  return newBalance;
}

export async function chargeRequestAfterSuccess(req, cost, label) {
  const supabaseAdmin = createAdminClient();
  const user = await getUserFromRequest(supabaseAdmin, req);

  if (!user) {
    const error = new Error("Please sign in before starting practice.");
    error.statusCode = 401;
    throw error;
  }

  const profile = await getUserProfile(supabaseAdmin, user.id);

  if (profile.points < cost) {
    const error = new Error(`Not enough points. ${label} costs ${cost} point.`);
    error.statusCode = 402;
    error.balance = profile.points;
    error.cost = cost;
    throw error;
  }

  const balance = await deductPoints(supabaseAdmin, user.id, profile.points, cost);

  return { user, balance };
}
