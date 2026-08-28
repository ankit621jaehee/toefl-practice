import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import {
  applyMinimumLengthCap,
  formatFivePointScore,
  validateFivePointScore,
} from "./writing-scoring.js";
import {
  ABILITY_MODEL_VERSION,
  normalizeAbilityScores,
} from "./writing-ability.js";

const DISCUSSION_SCORE_COST = 2;
// Temporary school review access. Remove or set to false after review.
const TEMP_REVIEW_ACCESS_ENABLED = true;
const TEMP_REVIEW_POINTS = 999;

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

function countWords(text) {
  return String(text || "").trim()
    ? String(text || "").trim().split(/\s+/).length
    : 0;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Gemini returned invalid JSON: ${text.slice(0, 300)}`);
  }
}

function calculateDiscussionScore(json, wordCount) {
  if (json.overallScore === undefined) {
    throw new Error("Gemini response is missing overallScore.");
  }

  const score = applyMinimumLengthCap(
    validateFivePointScore(json.overallScore, "discussion overallScore"),
    wordCount,
    [
      { words: 5, cap: 0.5 },
      { words: 10, cap: 1 },
      { words: 30, cap: 2 },
      { words: 60, cap: 3 },
      { words: 80, cap: 3.5 },
      { words: 100, cap: 4 },
    ]
  );

  return formatFivePointScore(score);
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

async function getUserProfile(supabaseAdmin, userId) {
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

async function deductPoints(supabaseAdmin, userId, currentPoints, cost) {
  if (TEMP_REVIEW_ACCESS_ENABLED) {
    return TEMP_REVIEW_POINTS;
  }

  const newBalance = currentPoints - cost;

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({
      points: newBalance,
    })
    .eq("id", userId);

  if (error) {
    throw error;
  }

  return newBalance;
}
async function savePracticeRecord({
  supabaseAdmin,
  userId,
  practiceType,
  prompt,
  answer,
  feedback,
  score,
  pointsSpent,
}) {
  const { error } = await supabaseAdmin.from("practice_records").insert({
    user_id: userId,
    practice_type: practiceType,
    prompt,
    answer,
    feedback,
    score,
    points_spent: pointsSpent,
  });

  if (error) {
    console.error("Failed to save practice record:", error);
  }
}
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  try {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("Missing GEMINI_API_KEY environment variable");
    }

    const supabaseAdmin = createAdminClient();
    const token = getBearerToken(req);
    const user = await getUserFromToken(supabaseAdmin, token);

    if (!user) {
      return res.status(401).json({
        error: "Please sign in before using AI scoring.",
      });
    }

    const profile = await getUserProfile(supabaseAdmin, user.id);

    if (profile.points < DISCUSSION_SCORE_COST) {
      return res.status(402).json({
        error: `Not enough points. Academic Discussion scoring costs ${DISCUSSION_SCORE_COST} points.`,
        balance: profile.points,
        cost: DISCUSSION_SCORE_COST,
      });
    }

    const { prompt, answer } = req.body || {};

    if (!prompt || !answer) {
      return res.status(400).json({
        error: "Missing prompt or answer",
      });
    }

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    const wordCount = countWords(answer);

    const scoringPrompt = `
You are a strict but fair TOEFL Academic Discussion evaluator.

Evaluate the student's academic discussion response.

Important scoring principle:
Do not over-focus on word count once the response reaches around 100 words.
Word count is mainly used to identify clearly incomplete responses.
A response with 100+ words should be scored mainly based on opinion, contribution, development, organization, language, and naturalness.

Student word count: ${wordCount}

Assign an overallScore using this TOEFL-style FORGE practice rubric. The score must be exactly one of:
0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5.

Use a two-step scoring process:
1. First decide the integer band that best describes the response.
2. Then use a .5 score only when the response is clearly stronger than that band but not consistently strong enough for the next band.

Do not return arbitrary decimal scores such as 3.7 or 4.2.

Rubric:
- 5: A fully successful response. The response is a relevant and very clearly expressed contribution to the online discussion and demonstrates consistent facility in language use. It has relevant, well-elaborated explanations, examples, or details; effective syntactic variety and precise word choice; and almost no lexical or grammatical errors.
- 4: A generally successful response. The response is relevant and easily understood. It has relevant and adequately elaborated explanations, examples, or details; a variety of syntactic structures and appropriate word choice; and few lexical or grammatical errors.
- 3: A partially successful response. The response is mostly relevant and understandable, with some facility in language use. Part of an explanation, example, or detail may be missing, unclear, or irrelevant; syntax/vocabulary range may be limited; and noticeable language errors may appear.
- 2: A mostly unsuccessful response. The response attempts to contribute but language limitations may make ideas hard to follow. Ideas may be poorly elaborated or only partially relevant, with limited syntax/vocabulary and accumulated errors.
- 1: An unsuccessful response. The response is an ineffective attempt to contribute and may prevent expression of ideas. It may contain few coherent ideas, severely limited syntax/vocabulary, serious frequent errors, or mostly borrowed language.
- 0: Blank, rejects the topic, not in English, entirely copied from the prompt, disconnected from the prompt, or arbitrary keystrokes.

Also return abilityScores for long-term Writing Ability Analysis.
Ability scores are separate from overallScore. They must be based on the student's actual response, use 0.0 to 5.0, and may use 0.1 precision.
Do not force ability scores to average exactly to overallScore, but keep them reasonably consistent with the response quality.

Academic Discussion ability dimensions:
- discussion_position_relevance: direct response to the question, clear position, and relevant supporting ideas.
- discussion_development: sufficient explanation of reasons, details, and examples.
- discussion_reasoning: quality of the logic chain from reason to explanation to example to position; penalize weak, repetitive, or loosely connected support.
- discussion_coherence: clear organization, logical relationships, natural progression, and limited unnecessary repetition.
- discussion_language_use: grammar, vocabulary, sentence structure, language control, naturalness, and accuracy.

Minimum length rules:
- If fewer than 5 words, all dimension scores should be very low.
- If 5 to 9 words, the response is extremely incomplete.
- If 10 to 29 words, the response is clearly incomplete.
- If 30 to 59 words, the response may be partially complete but underdeveloped.
- If 60 to 99 words, the response can be acceptable but probably lacks development.
- If 100 words or more, do not penalize mainly for length.

Be consistent:
Use the same standards every time.
Do not give a high score to a very short response just because it has few grammar mistakes.
Do not be overly harsh on a complete 100+ word response only because it is not very long.
A strong response should express an opinion and support it.

Feedback quality rules:
1. All feedback explanations must be written in Simplified Chinese.
2. The student's original phrases, corrected phrases, improvedVersion, and sampleAnswer should remain in English.
3. Do not give generic comments like "good job" or "improve grammar" unless you explain exactly why.
4. Every strength should mention a specific feature of the student's response.
5. Every problem should identify a specific weakness and explain how it affects the score.
6. Grammar corrections should only include real issues from the student's response.
7. If the student's response has few grammar errors, focus on style, clarity, development, and naturalness instead.
8. The improvedVersion should preserve the student's original meaning and improve it, not replace it with a completely unrelated model answer.
9. The sampleAnswer should be a separate high-scoring answer for the prompt.
10. The actionPlan should give 3 short, practical, personalized steps in Simplified Chinese.
11. Use clear and direct Chinese suitable for a TOEFL learner.
12. Do not mention internal raw scores, score conversion, score caps, formulas, point deductions, or hidden scoring rules.
13. Feedback should explain strengths, problems, and how to improve. Do not say things like "扣0.5分".

Academic discussion prompt:
${JSON.stringify(prompt)}

Student response:
${answer}

Return valid JSON only. No markdown.

Return this exact JSON structure:
{
  "overallScore": 4.0,
  "abilityScores": {
    "discussion_position_relevance": 4.3,
    "discussion_development": 3.6,
    "discussion_reasoning": 3.4,
    "discussion_coherence": 4.1,
    "discussion_language_use": 3.9
  },
  "strengths": [
    "用中文说明学生讨论回答中的一个具体亮点。",
    "用中文说明学生讨论回答中的一个具体亮点。",
    "用中文说明学生讨论回答中的一个具体亮点。"
  ],
  "problems": [
    "用中文指出一个具体问题，并说明它为什么影响得分。",
    "用中文指出一个具体问题，并说明它为什么影响得分。",
    "用中文指出一个具体问题，并说明它为什么影响得分。"
  ],
  "grammarCorrections": [
    {
      "original": "student's original phrase or sentence",
      "corrected": "corrected phrase or sentence",
      "explanation": "用中文简要说明为什么这样改"
    }
  ],
  "actionPlan": [
    "用中文给出下一次开头表达观点时的提分动作。",
    "用中文给出一个和本次论证直接相关的发展建议。",
    "用中文给出一个语言表达或回应同学观点方面的提分动作。"
  ],
  "improvedVersion": "A polished version that preserves the student's original meaning.",
  "sampleAnswer": "A separate strong sample academic discussion response for this prompt."
}
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: scoringPrompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    });

    const text = response.text || "";

    if (!text.trim()) {
      throw new Error("Gemini returned empty response");
    }

    const json = safeJsonParse(text);
    const finalScore = calculateDiscussionScore(json, wordCount);
    const abilityScores = normalizeAbilityScores(
      "discussion",
      json.abilityScores || json.ability_scores
    );

    const newBalance = await deductPoints(
      supabaseAdmin,
      user.id,
      profile.points,
      DISCUSSION_SCORE_COST
    );




    const finalFeedback = {
      score: finalScore,
      strengths: normalizeArray(json.strengths),
      problems: normalizeArray(json.problems),
      grammarCorrections: normalizeArray(json.grammarCorrections),
      actionPlan: normalizeArray(json.actionPlan),
      improvedVersion: json.improvedVersion || "",
      sampleAnswer: json.sampleAnswer || "",
      abilityScores,
      abilityModelVersion: ABILITY_MODEL_VERSION,
    };

    await savePracticeRecord({
      supabaseAdmin,
      userId: user.id,
      practiceType: "discussion",
      prompt,
      answer,
      feedback: finalFeedback,
      score: finalScore,
      pointsSpent: DISCUSSION_SCORE_COST,
    });

    return res.status(200).json({
      ...finalFeedback,
      cost: DISCUSSION_SCORE_COST,
      balance: newBalance,
    });





  } catch (error) {
    console.error("Academic discussion scoring error:", error);

    const message = error?.message || String(error);

    if (message.includes("429") || message.toLowerCase().includes("quota")) {
      return res.status(429).json({
        error: "AI scoring quota exceeded. Please try again later.",
        details: message,
      });
    }

    return res.status(500).json({
      error: error?.message || "Failed to score academic discussion",
      details: String(error),
    });
  }
}
