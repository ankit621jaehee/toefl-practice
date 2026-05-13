import { GoogleGenAI } from "@google/genai";

import { generateContentWithModelFallback } from "./gemini-helper.js";

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

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Gemini returned invalid JSON: ${text.slice(0, 300)}`);
  }
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

    const { level = "Medium", topic = "Mixed" } = req.body || {};
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

    return res.status(200).json({
      sentenceQuestions,
      emailPrompt,
      discussionPrompt,
    });
  } catch (error) {
    console.error("Start mock test error:", error);

    return res.status(500).json({
      error: error?.message || "Failed to start mock test",
      details: String(error),
    });
  }
}