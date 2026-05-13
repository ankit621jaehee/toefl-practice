import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { generateContentWithModelFallback } from "./gemini-helper.js";

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

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Gemini returned invalid JSON: ${text.slice(0, 300)}`);
  }
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
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

function formatFivePointScore(score) {
  return `${roundToOneDecimal(score).toFixed(1)} / 5.0`;
}

function extractNumericScore(scoreText) {
  const match = String(scoreText || "").match(/[\d.]+/);
  if (!match) return 0;
  return clampScore(Number(match[0]));
}

function normalizeText(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[.,!?;:]/g, "")
    .replace(/\s+/g, " ");
}

function calculateSentenceScore(sentenceQuestions, sentenceAnswers) {
  if (!Array.isArray(sentenceQuestions)) return 0;

  let correctCount = 0;

  sentenceQuestions.forEach((question) => {
    const userChunks = sentenceAnswers?.[question.id] || [];
    const userAnswer = Array.isArray(userChunks) ? userChunks.join(" ") : "";

    if (normalizeText(userAnswer) === normalizeText(question.speakerB)) {
        correctCount += 1;
    }
  });

  return correctCount * 0.5;
}

function calculateFinalScore(sentenceScore, emailScoreNumber, discussionScoreNumber) {
  const finalScore =
    ((sentenceScore / 5) * 6 * 0.25) +
    ((emailScoreNumber / 5) * 6 * 0.35) +
    ((discussionScoreNumber / 5) * 6 * 0.4);

  return roundToOneDecimal(finalScore);
}

function applyMinimumLengthCap(score, wordCount) {
  let finalScore = score;

  if (wordCount < 5) finalScore = Math.min(finalScore, 0.5);
  else if (wordCount < 10) finalScore = Math.min(finalScore, 1.0);
  else if (wordCount < 30) finalScore = Math.min(finalScore, 2.0);
  else if (wordCount < 60) finalScore = Math.min(finalScore, 3.0);
  else if (wordCount < 90) finalScore = Math.min(finalScore, 3.5);

  return finalScore;
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

  return formatFivePointScore(score);
}

function calculateDiscussionScore(json, wordCount) {
  const taskScore = clampScore(json.taskScore);
  const developmentScore = clampScore(json.developmentScore);
  const organizationScore = clampScore(json.organizationScore);
  const languageScore = clampScore(json.languageScore);

  let score =
    taskScore * 0.25 +
    developmentScore * 0.35 +
    organizationScore * 0.15 +
    languageScore * 0.25;

  score = applyMinimumLengthCap(score, wordCount);

  return formatFivePointScore(score);
}

async function scoreEmailWriting(ai, prompt, answer) {
  const wordCount = countWords(answer);

  const scoringPrompt = `
You are a strict but fair TOEFL Email Writing evaluator.

Evaluate the student's email response.

Important scoring principle:
Do not over-focus on word count once the response reaches around 90 words.
Word count is mainly used to identify clearly incomplete responses.

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

Feedback quality rules:
1. Give specific feedback based on the student's actual response.
2. Grammar corrections should only include real issues from the response.
3. The improvedVersion should preserve the student's meaning.
4. The sampleAnswer should be a separate high-scoring answer.
5. The actionPlan should give 3 practical steps.

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
  "strengths": ["string", "string", "string"],
  "problems": ["string", "string", "string"],
  "grammarCorrections": [
    {
      "original": "string",
      "corrected": "string",
      "explanation": "string"
    }
  ],
  "actionPlan": ["string", "string", "string"],
  "improvedVersion": "string",
  "sampleAnswer": "string"
}
`;

  const { response, modelUsed } = await generateContentWithModelFallback(ai, {
    contents: scoringPrompt,
    config: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

console.log("Email scoring model used:", modelUsed);

  const text = response.text || "";
  if (!text.trim()) throw new Error("Gemini returned empty email scoring response");

  const json = safeJsonParse(text);
  const score = calculateEmailScore(json, wordCount);

  return {
    score,
    feedback: {
      score,
      strengths: normalizeArray(json.strengths),
      problems: normalizeArray(json.problems),
      grammarCorrections: normalizeArray(json.grammarCorrections),
      actionPlan: normalizeArray(json.actionPlan),
      improvedVersion: json.improvedVersion || "",
      sampleAnswer: json.sampleAnswer || "",
    },
  };
}

async function scoreAcademicDiscussion(ai, prompt, answer) {
  const wordCount = countWords(answer);

  const scoringPrompt = `
You are a strict but fair TOEFL Academic Discussion evaluator.

Evaluate the student's discussion response.

Important scoring principle:
Do not over-focus on word count once the response reaches around 100 words.
Word count is mainly used to identify clearly incomplete responses.

Student word count: ${wordCount}

Score each dimension from 0.0 to 5.0 using one decimal place.

Dimension 1: taskScore
- Does the response answer the professor's question?
- Does it clearly express the student's own opinion?
- Does it connect to the discussion context?

Dimension 2: developmentScore
- Is the opinion well supported?
- Are reasons and examples specific?
- Does the response add something meaningful to the discussion?

Dimension 3: organizationScore
- Is the response logically organized?
- Are transitions clear?
- Is it easy to follow?

Dimension 4: languageScore
- Grammar accuracy.
- Vocabulary.
- Sentence control.
- Academic tone and clarity.

Minimum length rules:
- If fewer than 5 words, all dimension scores should be very low.
- If 5 to 9 words, the response is extremely incomplete.
- If 10 to 29 words, the response is clearly incomplete.
- If 30 to 59 words, the response may be partially complete but underdeveloped.
- If 60 to 89 words, the response can be acceptable but probably lacks development.
- If 90 words or more, do not penalize mainly for length.

Feedback quality rules:
1. Give specific feedback based on the student's actual response.
2. Grammar corrections should only include real issues from the response.
3. The improvedVersion should preserve the student's meaning.
4. The sampleAnswer should be a separate high-scoring answer.
5. The actionPlan should give 3 practical steps.

Academic discussion prompt:
${JSON.stringify(prompt)}

Student response:
${answer}

Return valid JSON only. No markdown.

Return this exact JSON structure:
{
  "taskScore": 4.0,
  "developmentScore": 4.0,
  "organizationScore": 4.0,
  "languageScore": 4.0,
  "strengths": ["string", "string", "string"],
  "problems": ["string", "string", "string"],
  "grammarCorrections": [
    {
      "original": "string",
      "corrected": "string",
      "explanation": "string"
    }
  ],
  "actionPlan": ["string", "string", "string"],
  "improvedVersion": "string",
  "sampleAnswer": "string"
}
`;

  const { response, modelUsed } = await generateContentWithModelFallback(ai, {
    contents: scoringPrompt,
    config: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });
  console.log("Discussion scoring model used:", modelUsed);

  const text = response.text || "";
  if (!text.trim()) {
    throw new Error("Gemini returned empty discussion scoring response");
  }

  const json = safeJsonParse(text);
  const score = calculateDiscussionScore(json, wordCount);

  return {
    score,
    feedback: {
      score,
      strengths: normalizeArray(json.strengths),
      problems: normalizeArray(json.problems),
      grammarCorrections: normalizeArray(json.grammarCorrections),
      actionPlan: normalizeArray(json.actionPlan),
      improvedVersion: json.improvedVersion || "",
      sampleAnswer: json.sampleAnswer || "",
    },
  };
}

async function generateMockAnalysis(ai, {
  sentenceQuestions,
  sentenceAnswers,
  sentenceScore,
  emailPrompt,
  emailAnswer,
  emailScore,
  emailFeedback,
  discussionPrompt,
  discussionAnswer,
  discussionScore,
  discussionFeedback,
  finalScore,
}) {
  const prompt = `
You are a TOEFL study coach.

Analyze this student's full mock test performance and provide:
1. knowledgeAnalysis: specific weak knowledge points or skill gaps.
2. studyAdvice: practical study suggestions for the next 1-2 weeks.

The mock test has three tasks:
- Build a Sentence: objective grammar and sentence construction, full score 5.
- Email Writing: communication, task completion, tone, grammar, full score 5.
- Academic Discussion: opinion, development, logic, academic language, full score 5.

Weights:
- Build a Sentence: 25%
- Email Writing: 35%
- Academic Discussion: 40%

Scores:
- Build a Sentence: ${sentenceScore} / 5.0
- Email Writing: ${emailScore}
- Academic Discussion: ${discussionScore}
- Final Score: ${finalScore} / 6.0

Build a Sentence questions and answers:
${JSON.stringify({ sentenceQuestions, sentenceAnswers })}

Email prompt:
${JSON.stringify(emailPrompt)}

Email answer:
${emailAnswer}

Email feedback:
${JSON.stringify(emailFeedback)}

Academic discussion prompt:
${JSON.stringify(discussionPrompt)}

Academic discussion answer:
${discussionAnswer}

Academic discussion feedback:
${JSON.stringify(discussionFeedback)}

Return valid JSON only. No markdown.

Return this exact JSON structure:
{
  "knowledgeAnalysis": [
    "Specific weak point 1.",
    "Specific weak point 2.",
    "Specific weak point 3.",
    "Specific weak point 4."
  ],
  "studyAdvice": [
    "Practical advice 1.",
    "Practical advice 2.",
    "Practical advice 3.",
    "Practical advice 4."
  ]
}
`;

  const { response, modelUsed } = await generateContentWithModelFallback(ai, {
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      temperature: 0.2,
    },
  });
  console.log("Mock analysis model used:", modelUsed);

  const text = response.text || "";
  if (!text.trim()) {
    return {
      knowledgeAnalysis: [],
      studyAdvice: [],
    };
  }

  const json = safeJsonParse(text);

  return {
    knowledgeAnalysis: normalizeArray(json.knowledgeAnalysis),
    studyAdvice: normalizeArray(json.studyAdvice),
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
        error: "Please sign in before submitting a mock test.",
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

    const {
      sentenceQuestions,
      sentenceAnswers,
      emailPrompt,
      emailAnswer,
      discussionPrompt,
      discussionAnswer,
    } = req.body || {};

    if (
      !Array.isArray(sentenceQuestions) ||
      !sentenceAnswers ||
      !emailPrompt ||
      !String(emailAnswer || "").trim() ||
      !discussionPrompt ||
      !String(discussionAnswer || "").trim()
    ) {
      return res.status(400).json({
        error: "Missing mock test data.",
      });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const sentenceScore = calculateSentenceScore(
      sentenceQuestions,
      sentenceAnswers
    );

    const emailResult = await scoreEmailWriting(ai, emailPrompt, emailAnswer);
    const discussionResult = await scoreAcademicDiscussion(
      ai,
      discussionPrompt,
      discussionAnswer
    );

    const emailScoreNumber = extractNumericScore(emailResult.score);
    const discussionScoreNumber = extractNumericScore(discussionResult.score);

    const finalScore = calculateFinalScore(
      sentenceScore,
      emailScoreNumber,
      discussionScoreNumber
    );

    let knowledgeAnalysis = [];
    let studyAdvice = [];

    try {
      const analysisResult = await generateMockAnalysis(ai, {
        sentenceQuestions,
        sentenceAnswers,
        sentenceScore,
        emailPrompt,
        emailAnswer,
        emailScore: emailResult.score,
        emailFeedback: emailResult.feedback,
        discussionPrompt,
        discussionAnswer,
        discussionScore: discussionResult.score,
        discussionFeedback: discussionResult.feedback,
        finalScore,
      });

      knowledgeAnalysis = analysisResult.knowledgeAnalysis;
      studyAdvice = analysisResult.studyAdvice;
    } catch (analysisError) {
      console.error("Mock analysis generation failed:", analysisError);

      knowledgeAnalysis = [
        "The system could not generate a detailed knowledge analysis this time.",
      ];

      studyAdvice = [
        "Review your sentence construction accuracy and compare your writing with the improved versions.",
      ];
    }

    const newBalance = await deductPoints(
      supabaseAdmin,
      user.id,
      profile.points,
      MOCK_TEST_COST
    );

    const { data: savedRecord, error: saveError } = await supabaseAdmin
      .from("mock_records")
      .insert({
        user_id: user.id,

        sentence_questions: sentenceQuestions,
        sentence_answers: sentenceAnswers,
        sentence_score: sentenceScore,

        email_prompt: emailPrompt,
        email_answer: emailAnswer,
        email_feedback: emailResult.feedback,
        email_score: emailResult.score,

        discussion_prompt: discussionPrompt,
        discussion_answer: discussionAnswer,
        discussion_feedback: discussionResult.feedback,
        discussion_score: discussionResult.score,

        final_score: finalScore,
        knowledge_analysis: knowledgeAnalysis,
        study_advice: studyAdvice,

        points_spent: MOCK_TEST_COST,
      })
      .select("id")
      .single();

    if (saveError) {
      throw saveError;
    }

    return res.status(200).json({
      recordId: savedRecord?.id,
      sentenceScore,
      emailScore: emailResult.score,
      discussionScore: discussionResult.score,
      finalScore,
      emailFeedback: emailResult.feedback,
      discussionFeedback: discussionResult.feedback,
      knowledgeAnalysis,
      studyAdvice,
      cost: MOCK_TEST_COST,
      balance: newBalance,
    });
  } catch (error) {
    console.error("Submit mock test error:", error);

    const message = error?.message || String(error);

    if (message.includes("429") || message.toLowerCase().includes("quota")) {
      return res.status(429).json({
        error: "AI scoring quota exceeded. Please try again later.",
        details: message,
      });
    }

    return res.status(500).json({
      error: error?.message || "Failed to submit mock test",
      details: String(error),
    });
  }
}