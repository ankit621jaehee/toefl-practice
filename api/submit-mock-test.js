import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { generateContentWithModelFallback } from "./gemini-helper.js";
import {
  applyMinimumLengthCap as capFivePointScoreByLength,
  calculateFinalWritingScore,
  extractFivePointScore,
  formatFivePointScore as formatValidatedFivePointScore,
  validateFivePointScore,
} from "../server/writing-scoring.js";
import {
  ABILITY_MODEL_VERSION,
  normalizeAbilityScores,
} from "../server/writing-ability.js";

const MOCK_TEST_COST = 3;

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

function createSkippedFeedback(score = "5.0 / 5.0") {
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

function extractNumericScore(scoreText) {
  return extractFivePointScore(scoreText);
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

function getCorrectChunks(question) {
  if (Array.isArray(question.parts)) {
    return question.parts
      .filter((part) => part.type === "blank")
      .map((part) => String(part.answer || "").trim())
      .filter(Boolean);
  }

  if (Array.isArray(question.chunks)) {
    return question.chunks
      .map((chunk) => String(chunk || "").trim())
      .filter(Boolean);
  }

  return [];
}

function calculateSentenceScore(sentenceQuestions, sentenceAnswers) {
  if (!Array.isArray(sentenceQuestions)) return 0;

  let correctCount = 0;
  const pointValue =
    sentenceQuestions.length > 0 ? 5 / sentenceQuestions.length : 0;

  sentenceQuestions.forEach((question) => {
    const userChunks =
      sentenceAnswers?.[String(question.id)] || sentenceAnswers?.[question.id] || [];

    if (!Array.isArray(userChunks) || userChunks.length === 0) {
      return;
    }

    const correctChunks = getCorrectChunks(question);

    if (correctChunks.length === 0) {
      return;
    }

    if (userChunks.length !== correctChunks.length) {
      return;
    }

    const isCorrect = correctChunks.every((correctChunk, index) => {
      return normalizeText(userChunks[index]) === normalizeText(correctChunk);
    });

    if (isCorrect) {
      correctCount += 1;
    }
  });

  return correctCount * pointValue;
}


function calculateFinalScore(sentenceScore, emailScoreNumber, discussionScoreNumber) {
  return calculateFinalWritingScore({
    sentenceScore: Math.max(0, Math.min(10, Number(sentenceScore) * 2)),
    emailScore: emailScoreNumber,
    discussionScore: discussionScoreNumber,
  }).estimatedScore;
}

function calculateEmailScore(json, wordCount) {
  if (json.overallScore === undefined) {
    throw new Error("Gemini response is missing email overallScore.");
  }

  const score = capFivePointScoreByLength(
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

  return formatValidatedFivePointScore(score);
}

function calculateDiscussionScore(json, wordCount) {
  if (json.overallScore === undefined) {
    throw new Error("Gemini response is missing discussion overallScore.");
  }

  const score = capFivePointScoreByLength(
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

  return formatValidatedFivePointScore(score);
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

Assign an overallScore using this TOEFL-style FORGE practice rubric. The score must be exactly one of:
0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5.

Use a two-step scoring process:
1. First decide the integer band that best describes the response.
2. Then use a .5 score only when the response is clearly stronger than that band but not consistently strong enough for the next band.

Do not return arbitrary decimal scores such as 3.7 or 4.2.

Rubric:
- 5: A fully successful response. Effective, clearly expressed, supports the communicative purpose, uses effective syntactic variety and precise word choice, follows appropriate social conventions, and has almost no lexical or grammatical errors.
- 4: A generally successful response. Mostly effective and easily understood, with adequate elaboration, appropriate syntax and word choice, mostly appropriate social conventions, and few lexical or grammatical errors.
- 3: A partially successful response. Generally accomplishes the task, but limitations in language may prevent parts of the message from being fully clear and effective. It may have partial elaboration, moderate syntax/vocabulary range, and noticeable errors.
- 2: A mostly unsuccessful response. Attempts the task but is mostly ineffective, limited, or difficult to interpret, with limited/irrelevant elaboration and accumulated language errors.
- 1: An unsuccessful response. Ineffective, possibly hard to understand, with very little elaboration, telegraphic language, serious frequent errors, or mostly borrowed language.
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

Feedback quality rules:
1. All feedback explanations must be written in Simplified Chinese.
2. The student's original phrases, corrected phrases, improvedVersion, and sampleAnswer should remain in English.
3. Give specific feedback based on the student's actual response.
4. Grammar corrections should only include real issues from the response.
5. The improvedVersion should preserve the student's meaning.
6. The sampleAnswer should be a separate high-scoring answer.
7. The actionPlan should give 3 practical, personalized steps in Simplified Chinese.
8. Do not mention internal raw scores, score conversion, score caps, formulas, point deductions, or hidden scoring rules.
9. Feedback should explain strengths, problems, and how to improve. Do not say things like "扣0.5分".

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
  "strengths": ["用中文说明一个具体亮点", "用中文说明一个具体亮点", "用中文说明一个具体亮点"],
  "problems": ["用中文指出一个具体问题并说明影响", "用中文指出一个具体问题并说明影响", "用中文指出一个具体问题并说明影响"],
  "grammarCorrections": [
    {
      "original": "string",
      "corrected": "string",
      "explanation": "用中文简要说明为什么这样改"
    }
  ],
  "actionPlan": ["用中文给出一个提分动作", "用中文给出一个提分动作", "用中文给出一个提分动作"],
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
  const abilityScores = normalizeAbilityScores(
    "email",
    json.abilityScores || json.ability_scores
  );

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
      abilityScores,
      abilityModelVersion: ABILITY_MODEL_VERSION,
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

Assign an overallScore using this TOEFL-style FORGE practice rubric. The score must be exactly one of:
0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5.

Use a two-step scoring process:
1. First decide the integer band that best describes the response.
2. Then use a .5 score only when the response is clearly stronger than that band but not consistently strong enough for the next band.

Do not return arbitrary decimal scores such as 3.7 or 4.2.

Rubric:
- 5: A fully successful response. Relevant and very clearly expressed contribution to the online discussion, with consistent facility in language use, well-elaborated explanations/examples/details, effective syntactic variety and precise word choice, and almost no lexical or grammatical errors.
- 4: A generally successful response. Relevant and easily understood contribution, with adequate elaboration, a variety of syntactic structures, appropriate word choice, and few lexical or grammatical errors.
- 3: A partially successful response. Mostly relevant and understandable, but some explanation/example/detail may be missing, unclear, or irrelevant; syntax/vocabulary may be limited; and noticeable errors may appear.
- 2: A mostly unsuccessful response. Attempts to contribute, but ideas may be hard to follow, poorly elaborated, only partially relevant, and limited by syntax/vocabulary and accumulated errors.
- 1: An unsuccessful response. Ineffective attempt to contribute, with few coherent ideas, severely limited syntax/vocabulary, serious frequent errors, or mostly borrowed language.
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
- If 60 to 89 words, the response can be acceptable but probably lacks development.
- If 90 words or more, do not penalize mainly for length.

Feedback quality rules:
1. All feedback explanations must be written in Simplified Chinese.
2. The student's original phrases, corrected phrases, improvedVersion, and sampleAnswer should remain in English.
3. Give specific feedback based on the student's actual response.
4. Grammar corrections should only include real issues from the response.
5. The improvedVersion should preserve the student's meaning.
6. The sampleAnswer should be a separate high-scoring answer.
7. The actionPlan should give 3 practical, personalized steps in Simplified Chinese.
8. Do not mention internal raw scores, score conversion, score caps, formulas, point deductions, or hidden scoring rules.
9. Feedback should explain strengths, problems, and how to improve. Do not say things like "扣0.5分".

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
  "strengths": ["用中文说明一个具体亮点", "用中文说明一个具体亮点", "用中文说明一个具体亮点"],
  "problems": ["用中文指出一个具体问题并说明影响", "用中文指出一个具体问题并说明影响", "用中文指出一个具体问题并说明影响"],
  "grammarCorrections": [
    {
      "original": "string",
      "corrected": "string",
      "explanation": "用中文简要说明为什么这样改"
    }
  ],
  "actionPlan": ["用中文给出一个提分动作", "用中文给出一个提分动作", "用中文给出一个提分动作"],
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
  const abilityScores = normalizeAbilityScores(
    "discussion",
    json.abilityScores || json.ability_scores
  );

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
      abilityScores,
      abilityModelVersion: ABILITY_MODEL_VERSION,
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

Rules:
- Write in Simplified Chinese.
- Be specific and useful.
- Do not give generic encouragement only.
- Do not mention internal raw scores, score conversion, score caps, formulas, point deductions, or hidden scoring rules.

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


    const {
      sentenceQuestions,
      sentenceAnswers,
      emailPrompt,
      emailAnswer,
      discussionPrompt,
      discussionAnswer,
      selectedTypes,
    } = req.body || {};

    const selectedTypeSet = new Set(
      Array.isArray(selectedTypes) && selectedTypes.length > 0
        ? selectedTypes.filter((type) =>
            ["sentence", "email", "discussion"].includes(type)
          )
        : ["sentence", "email", "discussion"]
    );
    const includesSentence = selectedTypeSet.has("sentence");
    const includesEmail = selectedTypeSet.has("email");
    const includesDiscussion = selectedTypeSet.has("discussion");

    if (
      !Array.isArray(sentenceQuestions) ||
      !sentenceAnswers ||
      (includesSentence && sentenceQuestions.length === 0) ||
      (includesEmail && (!emailPrompt || !String(emailAnswer || "").trim())) ||
      (includesDiscussion &&
        (!discussionPrompt || !String(discussionAnswer || "").trim()))
    ) {
      return res.status(400).json({
        error: "Missing mock test data.",
      });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const sentenceScore = includesSentence
      ? calculateSentenceScore(sentenceQuestions, sentenceAnswers)
      : 5;

    const emailResult = includesEmail
      ? await scoreEmailWriting(ai, emailPrompt, emailAnswer)
      : { score: "5.0 / 5.0", feedback: createSkippedFeedback() };
    const discussionResult = includesDiscussion
      ? await scoreAcademicDiscussion(ai, discussionPrompt, discussionAnswer)
      : { score: "5.0 / 5.0", feedback: createSkippedFeedback() };

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
      selectedTypes: Array.from(selectedTypeSet),
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
