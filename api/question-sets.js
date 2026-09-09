import {
  createAdminClient,
  getUserFromRequest,
} from "../lib/points.js";
import { isActivePro } from "../lib/entitlements.js";

function createLockedCatalogItem(item) {
  return {
    ...item,
    content: {
      description: item.content?.description || "",
      tasks: [],
    },
    locked: true,
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const supabaseAdmin = createAdminClient();
    const user = await getUserFromRequest(supabaseAdmin, req);
    let profile = null;

    if (user) {
      const profileResult = await supabaseAdmin
        .from("profiles")
        .select("subscription_tier, subscription_expires_at")
        .eq("id", user.id)
        .maybeSingle();

      if (profileResult.error) throw profileResult.error;
      profile = profileResult.data;
    }

    const { data: questionSets, error } = await supabaseAdmin
      .from("question_sets")
      .select(
        "id, source_type, title, display_date, mock_number, sort_order, content, created_at"
      )
      .eq("status", "published")
      .order("source_type", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("display_date", { ascending: false });

    if (error) throw error;

    const isPro = isActivePro(profile);
    const publicQuestionBankAccess =
      process.env.PUBLIC_QUESTION_BANK_ACCESS === "true";
    const hasQuestionBankAccess = isPro || publicQuestionBankAccess;
    const items = (questionSets || []).map((item) => {
      return hasQuestionBankAccess
        ? { ...item, locked: false }
        : createLockedCatalogItem(item);
    });
    const unlockedIds = items
      .filter((item) => !item.locked)
      .map((item) => item.id);

    return res.status(200).json({
      isPro,
      hasQuestionBankAccess,
      publicQuestionBankAccess,
      subscriptionTier: isPro ? "pro" : "free",
      subscriptionExpiresAt: isPro ? profile?.subscription_expires_at || null : null,
      unlockedIds,
      items,
    });
  } catch (error) {
    console.error("Question set catalog error:", error);
    return res.status(500).json({
      error: error?.message || "Failed to load question sets.",
    });
  }
}
