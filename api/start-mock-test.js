import { GoogleGenAI } from "@google/genai";
import { generateContentWithModelFallback } from "../lib/gemini-helper.js";
import {
  createAdminClient,
  deductPoints,
  getCreditBalance,
  getUserFromRequest,
} from "../lib/points.js";

function getEndPunctuation(sentence) {
  const match = String(sentence || "").trim().match(/[.!?]$/);
  return match ? match[0] : ".";
}

function removeEndPunctuation(sentence) {
  return String(sentence || "").trim().replace(/[.!?]+$/g, "");
}

function cleanWord(word) {
  return String(word || "")
    .replace(/^[,.;:!?]+/g, "")
    .replace(/[,.;:!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanChunk(chunk) {
  return String(chunk || "")
    .replace(/[,.!?;:]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

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

function splitWordsIntoChunks(words) {
  const chunks = [];
  let index = 0;

  while (index < words.length) {
    const current = words[index]?.toLowerCase();
    const next = words[index + 1]?.toLowerCase();

    const nounPhraseLength = isLikelyNounPhrase(words, index);
    if (nounPhraseLength) {
      chunks.push(words.slice(index, index + nounPhraseLength).join(" "));
      index += nounPhraseLength;
      continue;
    }

    if (current === "to" && next) {
      chunks.push(words.slice(index, index + 2).join(" "));
      index += 2;
      continue;
    }

    if (current === "will" && next === "be") {
      chunks.push("will be");
      index += 2;
      continue;
    }

    if (current === "could" && next === "you") {
      chunks.push("could you");
      index += 2;
      continue;
    }

    if (current === "can" && next === "you") {
      chunks.push("can you");
      index += 2;
      continue;
    }

    if (current === "do" && next === "you") {
      chunks.push("do you");
      index += 2;
      continue;
    }

    if (current === "did" && next === "you") {
      chunks.push("did you");
      index += 2;
      continue;
    }

    chunks.push(words[index]);
    index += 1;
  }

  return chunks.map(cleanChunk).filter(Boolean);
}

function buildPartsFromTarget(target) {
  const punctuation = getEndPunctuation(target);
  const sentenceWithoutPunctuation = removeEndPunctuation(target);

  const words = sentenceWithoutPunctuation
    .split(/\s+/)
    .map(cleanWord)
    .filter(Boolean);

  if (words.length === 0) {
    return [
      { type: "blank", answer: "i" },
      { type: "blank", answer: "am" },
      { type: "blank", answer: "not" },
      { type: "blank", answer: "sure" },
      { type: "fixed", text: "." },
    ];
  }

  const parts = [];

  const firstWord = words[0];
  const commonFixedStarters = [
    "The",
    "A",
    "An",
    "She",
    "He",
    "It",
    "They",
    "I",
    "We",
    "There",
  ];

  let blankWords = words;

  if (commonFixedStarters.includes(firstWord) && words.length >= 8) {
    parts.push({
      type: "fixed",
      text: firstWord,
    });
    blankWords = words.slice(1);
  }

  const chunks = splitWordsIntoChunks(blankWords);

  chunks.forEach((chunk) => {
    parts.push({
      type: "blank",
      answer: chunk,
    });
  });

  parts.push({
    type: "fixed",
    text: punctuation,
  });

  return parts;
}

function getChunksFromParts(parts) {
  return parts
    .filter((part) => part.type === "blank")
    .map((part) => cleanChunk(part.answer))
    .filter(Boolean);
}

function normalizeSentenceQuestion(question, index, level, topic) {
  const target =
    typeof question.target === "string" && question.target.trim()
      ? question.target.trim()
      : "I am not sure about it yet.";

  const parts = buildPartsFromTarget(target);
  const chunks = getChunksFromParts(parts);

  return {
    id: index + 1,
    level: question.level || level,
    topic: question.topic || topic,
    relationType: question.relationType || "question-answer",
    contextSpeaker: "A",
    contextSentence:
      question.contextSentence ||
      "What was the main point of the conversation?",
    answerSpeaker: "B",
    target,
    parts,
    chunks,
    explanation:
      question.explanation ||
      "This question tests sentence structure and logical connection between two speakers.",
  };
}

const MOCK_TEST_COST = 3;
const PRACTICE_TYPES = ["sentence", "email", "discussion"];
const MOCK_TEST_MAX_OUTPUT_TOKENS = 8192;
const MOCK_TEST_GENERATION_ATTEMPTS = 2;

const mockTestResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sentenceQuestions: {
      type: "array",
      minItems: 10,
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "integer" },
          level: { type: "string" },
          topic: { type: "string" },
          relationType: { type: "string" },
          contextSentence: { type: "string" },
          target: { type: "string" },
          explanation: { type: "string" },
        },
        required: [
          "id",
          "level",
          "topic",
          "relationType",
          "contextSentence",
          "target",
          "explanation",
        ],
      },
    },
    emailPrompt: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        subject: { type: "string" },
        scenario: { type: "string" },
        task: { type: "string" },
        requirements: {
          type: "array",
          minItems: 3,
          maxItems: 3,
          items: { type: "string" },
        },
        suggestedLength: { type: "string" },
      },
      required: [
        "title",
        "subject",
        "scenario",
        "task",
        "requirements",
        "suggestedLength",
      ],
    },
    discussionPrompt: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        instruction: { type: "string" },
        professorName: { type: "string" },
        professor: { type: "string" },
        studentOneName: { type: "string" },
        studentOnePost: { type: "string" },
        studentTwoName: { type: "string" },
        studentTwoPost: { type: "string" },
        question: { type: "string" },
        suggestedLength: { type: "string" },
      },
      required: [
        "title",
        "instruction",
        "professorName",
        "professor",
        "studentOneName",
        "studentOnePost",
        "studentTwoName",
        "studentTwoPost",
        "question",
        "suggestedLength",
      ],
    },
  },
  required: ["sentenceQuestions", "emailPrompt", "discussionPrompt"],
};

function getFinishReason(response) {
  return response?.candidates?.[0]?.finishReason || "UNKNOWN";
}

async function generateCompleteMockTest(ai, prompt) {
  let lastError;

  for (let attempt = 0; attempt < MOCK_TEST_GENERATION_ATTEMPTS; attempt += 1) {
    const { response, modelUsed } = await generateContentWithModelFallback(ai, {
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: mockTestResponseSchema,
        maxOutputTokens: MOCK_TEST_MAX_OUTPUT_TOKENS,
        temperature: attempt === 0 ? 0.7 : 0.4,
      },
    });

    const text = response.text || "";
    const finishReason = getFinishReason(response);

    try {
      if (!text.trim()) {
        throw new Error("Gemini returned an empty response");
      }

      if (finishReason !== "STOP" && finishReason !== "UNKNOWN") {
        throw new Error(`Gemini stopped with finish reason ${finishReason}`);
      }

      return {
        json: JSON.parse(text),
        modelUsed,
        finishReason,
      };
    } catch (error) {
      lastError = error;
      console.error("Incomplete mock-test generation", {
        attempt: attempt + 1,
        modelUsed,
        finishReason,
        responseLength: text.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const error = new Error("AI mock-test generation was incomplete");
  error.cause = lastError;
  throw error;
}

function normalizeEmailPrompt(value) {
  return {
    title: String(value?.title || "Email Writing").trim(),
    subject: String(value?.subject || value?.title || "Email Writing Task").trim(),
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
    instruction: String(value?.instruction || "").trim(),
    professorName: String(value?.professorName || "Professor").trim(),
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
    const user = await getUserFromRequest(supabaseAdmin, req);

    if (!user) {
      return res.status(401).json({
        error: "Please sign in before starting a mock test.",
      });
    }

    const creditBalance = await getCreditBalance(supabaseAdmin, user.id);

    const { level = "Medium", topic = "Mixed" } = req.body || {};
    const requestedTypes = Array.isArray(req.body?.selectedTypes)
      ? req.body.selectedTypes
      : PRACTICE_TYPES;
    const selectedTypes = PRACTICE_TYPES.filter((type) =>
      requestedTypes.includes(type)
    );

    if (selectedTypes.length < 2) {
      return res.status(400).json({
        error: "Combined practice requires at least two task types.",
      });
    }

    const practiceCost = Math.min(MOCK_TEST_COST, selectedTypes.length);

    if (creditBalance.balance < practiceCost) {
      return res.status(402).json({
        error: `Not enough points. This practice costs ${practiceCost} points.`,
        ...creditBalance,
        cost: practiceCost,
      });
    }
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const prompt = `
You are creating a complete TOEFL-style mock test.

Generate:
1. Exactly 10 Build a Sentence questions.
2. Exactly 1 Email Writing prompt.
3. Exactly 1 Academic Discussion prompt.

Build a Sentence rules:
- You only generate Speaker A's context sentence, Speaker B's full target sentence, and explanation.
- Do not decide blanks.
- Do not create word banks.
- The website will automatically split Speaker B into blanks.
- Speaker B target should contain 8 to 14 words.
- The exercise is NOT translation.
- It is an A/B dialogue sentence-building task.
- Avoid repeated sentence patterns.
- Avoid overly simple sentences.
- Do not include Chinese.

Email Writing rules:
- The prompt must follow the real TOEFL-style structure: a clear background paragraph, then a task sentence, then requirements.
- The scenario should be realistic for school, work, campus service, travel, application, or daily communication.
- The scenario must explain who the student is, what happened, and why the email is needed.
- The task must be one sentence in this pattern: "Write an email to [recipient]. In your email, do the following:"
- Include exactly 3 concrete requirements.
- Each requirement should start with an action verb.
- Recommended length should be 100–150 words.
- Include a concise subject field that matches the specific situation. Do not use a generic subject like "Email Writing Practice".

Academic Discussion rules:
- Include an instruction field before the professor post. It should explain the class subject and list the response requirements.
- The instruction should say the student should express and support a personal opinion and make a contribution in their own words.
- The professor's post should first state what the class has been discussing.
- The debatable question must be asked by the professor inside the professor's post.
- The question field must repeat only that final debatable question.
- Include two student posts with different opinions.
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
    "subject": "A Stress Management Tip That Might Help",
    "scenario": "You are a university student, and you participated in a recent campus workshop about stress management. There was a particular technique or activity from the workshop that you found especially effective in reducing your stress. You think this might be helpful to your friend, Sarah, who has been feeling overwhelmed with her workload lately.",
    "task": "Write an email to Sarah. In your email, do the following:",
    "requirements": ["string", "string", "string"],
    "suggestedLength": "Recommended length: 100–150 words"
  },
  "discussionPrompt": {
    "title": "string",
    "instruction": "Your professor is teaching a class on sociology. Write a post responding to the professor's question. In your response, you should\n· express and support your personal opinion\n· make a contribution to the discussion in your own words\nAn effective response will contain at least 100 words. You have ten minutes to write.",
    "professorName": "Doctor Achebe",
    "professor": "We've been discussing government budgets and the difficult decisions governments must make regarding the use of public funds. Some services are clearly essential and must be paid for by any government. But what about public funding of the arts? Do you believe that governments should provide financial support to artists-for example, painters, sculptors, musicians, or filmmakers? Why or why not?",
    "studentOneName": "string",
    "studentOnePost": "string",
    "studentTwoName": "string",
    "studentTwoPost": "string",
    "question": "string",
    "suggestedLength": "Recommended length: at least 100 words"
  }
}
`;

    const { json, modelUsed, finishReason } = await generateCompleteMockTest(
      ai,
      prompt
    );
    console.log("Start mock test generation completed", {
      modelUsed,
      finishReason,
    });

    if (!Array.isArray(json.sentenceQuestions)) {
      throw new Error("Gemini response does not contain sentenceQuestions");
    }

    const sentenceQuestions = json.sentenceQuestions
      .slice(0, 10)
      .map((question, index) =>
        normalizeSentenceQuestion(question, index, level, topic)
      );

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

    const updatedCredits = await deductPoints(
      supabaseAdmin,
      user.id,
      practiceCost
    );

    return res.status(200).json({
      sentenceQuestions,
      emailPrompt,
      discussionPrompt,
      selectedTypes,
      cost: practiceCost,
      ...updatedCredits,
    });



  } catch (error) {
    console.error("Start mock test error:", error);

    return res.status(error?.statusCode || 500).json({
      error:
        error?.statusCode && error?.message
          ? error.message
          : "AI 题目生成未完成，请重试。",
      balance: error?.balance,
      temporaryBalance: error?.temporaryBalance,
      permanentBalance: error?.permanentBalance,
      cost: error?.cost,
    });
  }
}
