import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";

const EMAIL_SCORE_COST = 3;

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

function clampScore(score) {
  const number = Number(score);

  if (Number.isNaN(number)) return 0;

  return Math.max(0, Math.min(5, number));
}

function roundToOneDecimal(score) {
  return Math.round(score * 10) / 10;
}

function formatScore(score) {
  return `${roundToOneDecimal(score).toFixed(1)} / 5.0`;
}

function applyMinimumLengthCap(score, wordCount) {
  let finalScore = score;

  if (wordCount < 5) {
    finalScore = Math.min(finalScore, 0.5);
  } else if (wordCount < 10) {
    finalScore = Math.min(finalScore, 1.0);
  } else if (wordCount < 30) {
    finalScore = Math.min(finalScore, 2.0);
  } else if (wordCount < 60) {
    finalScore = Math.min(finalScore, 3.0);
  } else if (wordCount < 90) {
    finalScore = Math.min(finalScore, 3.5);
  }

  return finalScore;
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
  const taskScore = clampScore(json.taskScore);
  const organizationScore = clampScore(json.organizationScore);
  const languageScore = clampScore(json.languageScore);
  const naturalnessScore = clampScore(json.naturalnessScore);

  let score =
    taskScore * 0.4 +
    organizationScore * 0.2 +
    languageScore * 0.3 +
    naturalnessScore * 0.1;

  score = applyMinimumLengthCap(score, wordCount);

  return formatScore(score);
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

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    const { prompt, answer } = req.body || {};

    if (!prompt || !answer) {
      return res.status(400).json({
        error: "Missing prompt or answer",
      });
    }

    const wordCount = countWords(answer);

    const scoringPrompt = `
You are a strict but fair TOEFL Email Writing evaluator.

Evaluate the student's email response.

Important scoring principle:
Do not over-focus on word count once the response reaches around 90 words.
Word count is mainly used to identify clearly incomplete responses.
A response with 90+ words should be scored mainly based on task completion, email format, clarity, language, and naturalness.

Student word count: ${wordCount}

Score each dimension from 0.0 to 5.0 using one decimal place.

Dimension 1: taskScore
- Does the email address all required points?
- Does it respond appropriately to the situation?
- Does it have a clear purpose?

Dimension 2: organizationScore
- Does it have a clear email structure?
- Greeting, body, closing.
- Logical order and easy flow.

Dimension 3: languageScore
- Grammar accuracy.
- Vocabulary.
- Sentence control.
- Clarity.

Dimension 4: naturalnessScore
- Polite and appropriate tone.
- Natural email style.
- Appropriate formality.

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
1. Do not give generic comments like "good job" or "improve grammar" unless you explain exactly why.
2. Every strength should mention a specific feature of the student's response.
3. Every problem should identify a specific weakness and explain how it affects the score.
4. Grammar corrections should only include real issues from the student's response.
5. If the student's response has few grammar errors, focus on style, clarity, development, and naturalness instead.
6. The improvedVersion should preserve the student's original meaning and improve it, not replace it with a completely unrelated model answer.
7. The sampleAnswer should be a separate high-scoring answer for the prompt.
8. The actionPlan should give 3 short, practical steps for improving the next response.
9. Use clear and direct language suitable for a TOEFL learner.

Email prompt:
${JSON.stringify(prompt)}

Student response:
${answer}

Return valid JSON only. No markdown.

Return this exact JSON structure:
{
  "taskScore": 4.0,
  "organizationScore": 4.0,
  "languageScore": 4.0,
  "naturalnessScore": 4.0,
  "strengths": [
    "Specific strength based on the student's email.",
    "Specific strength based on the student's email.",
    "Specific strength based on the student's email."
  ],
  "problems": [
    "Specific problem and why it matters.",
    "Specific problem and why it matters.",
    "Specific problem and why it matters."
  ],
  "grammarCorrections": [
    {
      "original": "student's original phrase or sentence",
      "corrected": "corrected phrase or sentence",
      "explanation": "brief explanation"
    }
  ],
  "actionPlan": [
    "Next time, make sure the email has a clear greeting and closing.",
    "Address every bullet point in the prompt directly.",
    "Add one specific detail to make the explanation more convincing."
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

    const newBalance = await deductPoints(
      supabaseAdmin,
      user.id,
      profile.points,
      EMAIL_SCORE_COST
    );

    return res.status(200).json({
      score: finalScore,
      strengths: normalizeArray(json.strengths),
      problems: normalizeArray(json.problems),
      grammarCorrections: normalizeArray(json.grammarCorrections),
      actionPlan: normalizeArray(json.actionPlan),
      improvedVersion: json.improvedVersion || "",
      sampleAnswer: json.sampleAnswer || "",
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