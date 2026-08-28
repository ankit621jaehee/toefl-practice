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

async function getUserFromToken(supabaseAdmin, token) {
  if (!token) return null;

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) return null;

  return user;
}

function createSkippedFeedback(score = "Not graded") {
  return {
    score,
    strengths: [],
    problems: [],
    grammarCorrections: [],
    actionPlan: [],
    improvedVersion: "",
    sampleAnswer: "",
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const supabaseAdmin = createAdminClient();
    const user = await getUserFromToken(supabaseAdmin, getBearerToken(req));

    if (!user) {
      return res.status(401).json({ error: "Please sign in first." });
    }

    const {
      sentenceQuestions,
      sentenceAnswers,
      sentenceScore,
      questionSetId,
      sourceType,
    } = req.body || {};

    if (!Array.isArray(sentenceQuestions) || sentenceQuestions.length === 0) {
      return res.status(400).json({ error: "Missing sentence questions." });
    }

    const numericScore = Number(sentenceScore);
    const safeScore = Number.isFinite(numericScore) ? numericScore : 0;

    const { data: savedRecord, error: saveError } = await supabaseAdmin
      .from("mock_records")
      .insert({
        user_id: user.id,
        sentence_questions: sentenceQuestions,
        sentence_answers: sentenceAnswers || {},
        sentence_score: safeScore,
        email_prompt: {},
        email_answer: "",
        email_feedback: createSkippedFeedback(),
        email_score: "Not graded",
        discussion_prompt: {},
        discussion_answer: "",
        discussion_feedback: createSkippedFeedback(),
        discussion_score: "Not graded",
        final_score: safeScore,
        knowledge_analysis: [],
        study_advice: [],
        points_spent: 0,
      })
      .select("id")
      .single();

    if (saveError) {
      throw saveError;
    }

    if (questionSetId && sourceType) {
      const { error: attemptError } = await supabaseAdmin
        .from("question_attempts")
        .insert({
          user_id: user.id,
          question_set_id: questionSetId,
          source_type: sourceType,
          status: "completed",
          score: safeScore,
          result: {
            recordId: savedRecord?.id,
            sentenceScore: safeScore,
            finalScore: safeScore,
          },
        });

      if (attemptError) {
        console.error("Failed to save sentence question attempt:", attemptError);
      }
    }

    return res.status(200).json({
      recordId: savedRecord?.id,
      sentenceScore: safeScore,
    });
  } catch (error) {
    console.error("Save sentence record error:", error);

    return res.status(500).json({
      error: error?.message || "Failed to save sentence record",
    });
  }
}
