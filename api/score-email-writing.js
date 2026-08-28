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

const EMAIL_SCORE_COST = 2;
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

function calculateEmailScore(json, wordCount) {
  if (json.overallScore === undefined) {
    throw new Error("Gemini response is missing overallScore.");
  }

  const score = applyMinimumLengthCap(
    validateFivePointScore(json.overallScore, "email overallScore"),
    wordCount,
    [
      { words: 5, cap: 0.5 },
      { words: 10, cap: 1 },
      { words: 30, cap: 2 },
      { words: 60, cap: 3 },
      { words: 90, cap: 3.5 },
    ]
  );

  return formatFivePointScore(score);
}

async function getUserFromToken(supabaseAdmin, token) {
  if (!token) {
    return null;
  }

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return null;
  }

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

    if (profile.points < EMAIL_SCORE_COST) {
      return res.status(402).json({
        error: `Not enough points. Email Writing scoring costs ${EMAIL_SCORE_COST} points.`,
        balance: profile.points,
        cost: EMAIL_SCORE_COST,
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
You are a strict but fair TOEFL Email Writing evaluator.

Evaluate the student's email response.

Important scoring principle:
Do not over-focus on word count once the response reaches around 90 words.
Word count is mainly used to identify clearly incomplete responses.
A response with 90+ words should be scored mainly based on task completion, email format, clarity, language, and naturalness.

Student word count: ${wordCount}

Assign an overallScore using this TOEFL-style FORGE practice rubric. The score must be exactly one of:
0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5.

Use a two-step scoring process:
1. First decide the integer band that best describes the response.
2. Then use a .5 score only when the response is clearly stronger than that band but not consistently strong enough for the next band.

Do not return arbitrary decimal scores such as 3.7 or 4.2.

Rubric:
- 5: A fully successful response. The response is effective, clearly expressed, and shows consistent facility in language use. It supports the communicative purpose, uses effective syntactic variety and precise word choice, follows appropriate social conventions, and has almost no lexical or grammatical errors.
- 4: A generally successful response. The response is mostly effective and easily understood. It has adequate elaboration, syntactic variety, appropriate word choice, mostly appropriate social conventions, and few lexical or grammatical errors.
- 3: A partially successful response. The response generally accomplishes the task, but limitations in language facility may prevent parts of the message from being fully clear and effective. It may have partial elaboration, moderate syntax/vocabulary range, and noticeable errors.
- 2: A mostly unsuccessful response. The response attempts the task but is mostly ineffective, limited, or difficult to interpret. It may have limited or irrelevant elaboration, limited syntax/vocabulary, and accumulated language errors.
- 1: An unsuccessful response. The response is ineffective, may be nearly unintelligible, has very little elaboration, telegraphic language, serious frequent errors, or mostly borrowed language.
- 0: Blank, rejects the topic, not in English, entirely copied from the prompt, disconnected from the prompt, or arbitrary keystrokes.

Also return abilityScores for long-term Writing Ability Analysis.
Ability scores are separate from overallScore. They must be based on the student's actual response, use 0.0 to 5.0, and may use 0.1 precision.
Do not force ability scores to average exactly to overallScore, but keep them reasonably consistent with the response quality.

Email ability dimensions:
- email_task_fulfillment: task completion, coverage of required information, and effective response to the email purpose.
- email_clarity: clear, specific, understandable information with little ambiguity.
- email_organization: logical order, natural flow, and clear email structure.
- email_appropriacy: appropriate tone, register, relationship awareness, and natural requests/explanations/suggestions/complaints.
- email_language_use: grammar, vocabulary, sentence structure, language control, naturalness, and accuracy.

Minimum length rules:
- If fewer than 5 words, all dimension scores should be very low.
- If 5 to 9 words, the response is extremely incomplete.
- If 10 to 29 words, the response is clearly incomplete.
- If 30 to 59 words, the response may be partially complete but underdeveloped.
- If 60 to 89 words, the response can be acceptable but probably lacks development.
- If 90 words or more, do not penalize mainly for length.

Be consistent:
Use the same standards every time.
Do not give a high score to a very short response just because it has few grammar mistakes.
Do not be overly harsh on a complete 90+ word response only because it is not very long.

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

Email prompt:
${JSON.stringify(prompt)}

Student response:
${answer}

Return valid JSON only. No markdown.

Return this exact JSON structure:
{
  "overallScore": 4.0,
  "abilityScores": {
    "email_task_fulfillment": 4.4,
    "email_clarity": 4.2,
    "email_organization": 4.0,
    "email_appropriacy": 4.3,
    "email_language_use": 3.9
  },
  "strengths": [
    "用中文说明学生邮件中的一个具体亮点。",
    "用中文说明学生邮件中的一个具体亮点。",
    "用中文说明学生邮件中的一个具体亮点。"
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
    "用中文给出下一次写邮件时最需要优先改进的一步。",
    "用中文给出一个和本次答案直接相关的内容提升建议。",
    "用中文给出一个语言表达或结构方面的提分动作。"
  ],
  "improvedVersion": "A polished version that preserves the student's original meaning.",
  "sampleAnswer": "A separate strong sample email for this prompt."
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
    const finalScore = calculateEmailScore(json, wordCount);
    const abilityScores = normalizeAbilityScores(
      "email",
      json.abilityScores || json.ability_scores
    );

    const newBalance = await deductPoints(
      supabaseAdmin,
      user.id,
      profile.points,
      EMAIL_SCORE_COST
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
      practiceType: "email",
      prompt,
      answer,
      feedback: finalFeedback,
      score: finalScore,
      pointsSpent: EMAIL_SCORE_COST,
    });

    return res.status(200).json({
      ...finalFeedback,
      cost: EMAIL_SCORE_COST,
      balance: newBalance,
    });
  } catch (error) {
    console.error("Email scoring error:", error);

    const message = error?.message || String(error);

    if (message.includes("429") || message.toLowerCase().includes("quota")) {
      return res.status(429).json({
        error: "AI scoring quota exceeded. Please try again later.",
        details: message,
      });
    }

    return res.status(500).json({
      error: error?.message || "Failed to score email writing",
      details: String(error),
    });
  }
}
