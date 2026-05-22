import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { generateContentWithModelFallback } from "./gemini-helper.js";
import { generateBuildSentenceQuestions } from "./build-sentence-helper.js";





const nounPhraseStarters = new Set([
  "a",
  "an",
  "the",
  "any",
  "some",
  "this",
  "that",
  "these",
  "those",
  "my",
  "your",
  "his",
  "her",
  "our",
  "their",
]);

const commonAdjectives = new Set([
  "old",
  "new",
  "good",
  "great",
  "important",
  "different",
  "available",
  "assigned",
  "quiet",
  "public",
  "private",
  "main",
  "major",
  "final",
  "first",
  "last",
  "next",
  "same",
  "local",
  "academic",
  "specific",
  "useful",
]);

function isLikelyNounPhrase(words, index) {
  const current = words[index]?.toLowerCase();
  const next = words[index + 1]?.toLowerCase();
  const third = words[index + 2]?.toLowerCase();

  if (!current || !next) return false;

  if (nounPhraseStarters.has(current)) {
    if (third && commonAdjectives.has(next)) return 3;
    return 2;
  }

  if (commonAdjectives.has(current)) return 2;

  return false;
}



function getChunksFromParts(parts) {
  return parts
    .filter((part) => part.type === "blank")
    .map((part) => cleanChunk(part.answer))
    .filter(Boolean);
}


function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Gemini returned invalid JSON: ${text.slice(0, 300)}`);
  }
}

const MOCK_TEST_COST = 10;

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
    .update({ points: newBalance })
    .eq("id", userId);

  if (error) throw error;

  return newBalance;
}


function normalizeEmailPrompt(value) {
  return {
    title: String(value?.title || "Email Writing").trim(),
    scenario: String(value?.scenario || "").trim(),
    task: String(value?.task || "").trim(),
    requirements: Array.isArray(value?.requirements)
      ? value.requirements.map((item) => String(item).trim()).filter(Boolean)
      : [],
    suggestedLength: String(
      value?.suggestedLength || "Recommended length: 100–150 words"
    ).trim(),
  };
}

function normalizeDiscussionPrompt(value) {
  return {
    title: String(value?.title || "Academic Discussion").trim(),
    professor: String(value?.professor || "").trim(),
    studentOneName: String(value?.studentOneName || "Student A").trim(),
    studentOnePost: String(value?.studentOnePost || "").trim(),
    studentTwoName: String(value?.studentTwoName || "Student B").trim(),
    studentTwoPost: String(value?.studentTwoPost || "").trim(),
    question: String(value?.question || "").trim(),
    suggestedLength: String(
      value?.suggestedLength || "Recommended length: at least 100 words"
    ).trim(),
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
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
        error: "Please sign in before starting a mock test.",
      });
    }

    const profile = await getUserProfile(supabaseAdmin, user.id);

    if (profile.points < MOCK_TEST_COST) {
      return res.status(402).json({
        error: `Not enough points. Full Mock Test costs ${MOCK_TEST_COST} points.`,
        balance: profile.points,
        cost: MOCK_TEST_COST,
      });
    }

    const newBalance = await deductPoints(
      supabaseAdmin,
      user.id,
      profile.points,
      MOCK_TEST_COST
    );


    const { level = "Medium", topic = "Mixed" } = req.body || {};
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getMockSentenceDistribution() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const easyCount = getRandomInt(3, 5);
    const mediumCount = getRandomInt(2, 3);
    const hardCount = 10 - easyCount - mediumCount;

    if (hardCount >= 2 && hardCount <= 4) {
      return {
        easyCount,
        mediumCount,
        hardCount,
      };
    }
  }

  return {
    easyCount: 4,
    mediumCount: 3,
    hardCount: 3,
  };
}

function shuffleArray(array) {
  return [...array].sort(() => Math.random() - 0.5);
}

const { easyCount, mediumCount, hardCount } = getMockSentenceDistribution();

const easyQuestions = await generateBuildSentenceQuestions({
  ai,
  count: easyCount,
  level: "Easy",
  topic,
});

const mediumQuestions = await generateBuildSentenceQuestions({
  ai,
  count: mediumCount,
  level: "Medium",
  topic,
  excludeTargets: easyQuestions.map((q) => q.target),
});

const hardQuestions = await generateBuildSentenceQuestions({
  ai,
  count: hardCount,
  level: "Hard",
  topic,
  excludeTargets: [
    ...easyQuestions.map((q) => q.target),
    ...mediumQuestions.map((q) => q.target),
  ],
});

const sentenceQuestions = shuffleArray([
  ...easyQuestions,
  ...mediumQuestions,
  ...hardQuestions,
]).map((question, index) => ({
  ...question,
  id: index + 1,
}));



    const prompt = `
You are creating a complete TOEFL-style mock test.

Generate:
1. Exactly 1 Email Writing prompt.
2. Exactly 1 Academic Discussion prompt.


Email Writing rules:
- The scenario should be realistic for school, work, campus service, travel, application, or daily communication.
- Include a clear task and 3 to 4 requirements.
- Recommended length should be 100–150 words.

Academic Discussion rules:
- Include a professor's discussion question.
- Include two student posts with different opinions.
- The final question should ask the test taker to express and support an opinion.
- Recommended length should be at least 100 words.

Difficulty level: ${level}
Topic preference: ${topic}

Return valid JSON only. No markdown.

Return this exact JSON structure:
{
  "sentenceQuestions": [
    {
      "id": 1,
      "level": "Medium",
      "topic": "Travel",
      "relationType": "question-answer",
      "contextSentence": "What was the highlight of your trip?",
      "target": "The tour guides who showed us around the old city were fantastic.",
      "explanation": "A asks about the highlight of the trip. B answers with a noun phrase followed by a relative clause."
    }
  ],
  "emailPrompt": {
    "title": "string",
    "scenario": "string",
    "task": "string",
    "requirements": ["string", "string", "string"],
    "suggestedLength": "Recommended length: 100–150 words"
  },
  "discussionPrompt": {
    "title": "string",
    "professor": "string",
    "studentOneName": "string",
    "studentOnePost": "string",
    "studentTwoName": "string",
    "studentTwoPost": "string",
    "question": "string",
    "suggestedLength": "Recommended length: at least 100 words"
  }
}
`;

    const { response, modelUsed } = await generateContentWithModelFallback(ai, {
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.8,
      },
    });
    console.log("Start mock test model used:", modelUsed);

    const text = response.text || "";
    if (!text.trim()) throw new Error("Gemini returned empty response");

    const json = safeJsonParse(text);







    const emailPrompt = normalizeEmailPrompt(json.emailPrompt);
    const discussionPrompt = normalizeDiscussionPrompt(json.discussionPrompt);

    if (sentenceQuestions.length !== 10) {
      throw new Error(
        `Expected 10 sentence questions, got ${sentenceQuestions.length}`
      );
    }

    if (!emailPrompt.scenario || !emailPrompt.task) {
      throw new Error("Generated email prompt is incomplete");
    }

    if (!discussionPrompt.professor || !discussionPrompt.question) {
      throw new Error("Generated discussion prompt is incomplete");
    }

    return res.status(200).json({
      sentenceQuestions,
      emailPrompt,
      discussionPrompt,
      cost: MOCK_TEST_COST,
      balance: newBalance,
    });



  } catch (error) {
    console.error("Start mock test error:", error);

    return res.status(500).json({
      error: error?.message || "Failed to start mock test",
      details: String(error),
    });
  }
}