import { createAdminClient } from "./points.js";
import { requireActivePro } from "./entitlements.js";
import {
  buildLearningProfile,
  chooseRecommendationFocus,
  findQuestionCandidates,
} from "./personalized-practice.js";

async function loadLearningData(supabaseAdmin, userId) {
  const [practiceResult, mockResult, historyResult] = await Promise.all([
    supabaseAdmin
      .from("practice_records")
      .select("id, practice_type, prompt, feedback, score, created_at")
      .eq("user_id", userId)
      .in("practice_type", ["email", "discussion"])
      .order("created_at", { ascending: false })
      .limit(80),
    supabaseAdmin
      .from("mock_records")
      .select("id, email_prompt, email_feedback, email_score, discussion_prompt, discussion_feedback, discussion_score, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(40),
    supabaseAdmin
      .from("personalized_practice_recommendations")
      .select("id, task_type, topic, source, question_set_id, question_key, recommended_at, started_at, completed_at")
      .eq("user_id", userId)
      .order("recommended_at", { ascending: false })
      .limit(100),
  ]);

  if (practiceResult.error) throw practiceResult.error;
  if (mockResult.error) throw mockResult.error;
  if (historyResult.error) throw historyResult.error;

  return {
    practiceRecords: practiceResult.data || [],
    mockRecords: mockResult.data || [],
    history: historyResult.data || [],
  };
}

function serializeProfile(profiles) {
  const taskProfiles = {
    email: profiles.email,
    discussion: profiles.discussion,
  };
  const personalizedProfiles = Object.values(taskProfiles).filter(
    (profile) => profile.status === "personalized"
  );
  const recommendedFocus = personalizedProfiles
    .flatMap((profile) => profile.focus.map((item) => ({ ...item, taskType: profile.taskType })))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 3);

  return {
    stage: personalizedProfiles.length === 2 ? "personalized" : "building",
    taskProfiles,
    recommendedFocus,
  };
}

async function updateRecommendation(supabaseAdmin, userId, id, values) {
  const { data, error } = await supabaseAdmin
    .from("personalized_practice_recommendations")
    .update(values)
    .eq("id", id)
    .eq("user_id", userId)
    .select("id, task_type, topic, source, question_set_id, question_key, recommended_at, started_at, completed_at")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const notFound = new Error("未找到这条个性化练习推荐。");
    notFound.statusCode = 404;
    throw notFound;
  }
  return data;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const supabaseAdmin = createAdminClient();
    const { user } = await requireActivePro(supabaseAdmin, req);
    const body = req.body || {};
    const action = body.action || "profile";

    if (action === "start") {
      const recommendation = await updateRecommendation(
        supabaseAdmin,
        user.id,
        body.recommendationId,
        { started_at: new Date().toISOString() }
      );
      return res.status(200).json({ recommendation });
    }

    if (action === "complete") {
      const recommendation = await updateRecommendation(
        supabaseAdmin,
        user.id,
        body.recommendationId,
        { completed_at: new Date().toISOString() }
      );
      return res.status(200).json({ recommendation });
    }

    const learningData = await loadLearningData(supabaseAdmin, user.id);
    const profiles = buildLearningProfile(
      learningData.practiceRecords,
      learningData.mockRecords
    );
    const profile = serializeProfile(profiles);

    if (action === "profile") {
      return res.status(200).json({ profile });
    }

    if (action !== "recommend") {
      return res.status(400).json({ error: "Unknown action" });
    }

    const focus = chooseRecommendationFocus(
      profiles,
      learningData.history,
      user.id,
      body.preferredTaskType,
      body.preferredTopic
    );

    const [setsResult, attemptsResult] = await Promise.all([
      supabaseAdmin
        .from("question_sets")
        .select("id, source_type, sort_order, content")
        .eq("status", "published")
        .in("source_type", ["past_exam", "ets_mock"]),
      supabaseAdmin
        .from("question_attempts")
        .select("question_set_id")
        .eq("user_id", user.id)
        .eq("status", "completed"),
    ]);
    if (setsResult.error) throw setsResult.error;
    if (attemptsResult.error) throw attemptsResult.error;

    const completedSetIds = new Set(
      (attemptsResult.data || []).map((item) => item.question_set_id)
    );
    const candidates = findQuestionCandidates(
      setsResult.data || [],
      focus.taskType,
      focus.topic,
      completedSetIds,
      learningData.history
    );
    const candidate = candidates[0] || null;
    const source = candidate ? "past_exam" : "ai_generated";

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("personalized_practice_recommendations")
      .insert({
        user_id: user.id,
        task_type: focus.taskType,
        topic: focus.topic,
        source,
        question_set_id: candidate?.questionSetId || null,
        question_key: candidate?.questionKey || null,
      })
      .select("id, task_type, topic, source, question_set_id, question_key, recommended_at")
      .single();
    if (insertError) throw insertError;

    return res.status(200).json({
      profile,
      recommendation: {
        id: inserted.id,
        taskType: focus.taskType,
        taskTypeLabel: focus.taskType === "email" ? "Email Writing" : "Academic Discussion",
        topic: focus.topic,
        topicLabel: focus.label,
        source,
        sourceLabel:
          source === "past_exam" ? "Official Questions" : "AI Generated",
        questionSetId: candidate?.questionSetId || null,
        questionSetSourceType: candidate?.questionSetSourceType || null,
        questionKey: candidate?.questionKey || null,
        task: candidate?.task || null,
        recommendedAt: inserted.recommended_at,
      },
    });
  } catch (error) {
    console.error("Personalized practice error:", error);
    return res.status(error.statusCode || 500).json({
      error: error.message || "个性化练习暂时无法加载，请稍后重试。",
    });
  }
}
