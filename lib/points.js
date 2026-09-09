import { createClient } from "@supabase/supabase-js";

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

function normalizeCreditBalance(data) {
  return {
    temporaryBalance: Number(data?.temporaryBalance || 0),
    permanentBalance: Number(data?.permanentBalance || 0),
    balance: Number(data?.balance || 0),
    checkInDates: Array.isArray(data?.checkInDates) ? data.checkInDates : [],
    claimedMilestones: Array.isArray(data?.claimedMilestones)
      ? data.claimedMilestones.map(Number)
      : [],
  };
}

export async function getCreditBalance(supabaseAdmin, userId) {
  const { data, error } = await supabaseAdmin.rpc(
    "get_profile_credit_balance",
    { target_user_id: userId }
  );

  if (error) throw error;
  return normalizeCreditBalance(data);
}

export async function deductPoints(supabaseAdmin, userId, cost) {
  const { data, error } = await supabaseAdmin.rpc("charge_profile_credits", {
    target_user_id: userId,
    point_cost: cost,
  });

  if (error) {
    const normalizedError = new Error(error.message || "Failed to deduct credits.");
    if ((error.message || "").includes("INSUFFICIENT_CREDITS")) {
      normalizedError.statusCode = 402;
      normalizedError.cost = cost;
      Object.assign(
        normalizedError,
        await getCreditBalance(supabaseAdmin, userId)
      );
    }
    throw normalizedError;
  }

  return normalizeCreditBalance(data);
}

export async function chargeAndSavePracticeRecord(
  supabaseAdmin,
  { userId, practiceType, prompt, answer, feedback, score, cost, sessionId }
) {
  const { data, error } = await supabaseAdmin.rpc(
    "charge_and_save_practice_record",
    {
      target_user_id: userId,
      target_practice_type: practiceType,
      target_prompt: prompt,
      target_answer: answer,
      target_feedback: feedback,
      target_score: score,
      point_cost: cost,
      target_session_id: sessionId || null,
    }
  );

  if (error) {
    const normalizedError = new Error(
      error.message || "Failed to save the scored practice."
    );
    if ((error.message || "").includes("INSUFFICIENT_CREDITS")) {
      normalizedError.statusCode = 402;
      normalizedError.cost = cost;
      Object.assign(
        normalizedError,
        await getCreditBalance(supabaseAdmin, userId)
      );
    }
    throw normalizedError;
  }

  return {
    ...normalizeCreditBalance(data),
    recordId: data?.recordId || null,
  };
}

export async function chargeRequestAfterSuccess(req, cost, label) {
  const supabaseAdmin = createAdminClient();
  const user = await getUserFromRequest(supabaseAdmin, req);

  if (!user) {
    const error = new Error("Please sign in before starting practice.");
    error.statusCode = 401;
    throw error;
  }

  const creditBalance = await deductPoints(supabaseAdmin, user.id, cost);
  return { user, ...creditBalance };
}
