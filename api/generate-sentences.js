import { GoogleGenAI } from "@google/genai";

function getEndPunctuation(sentence) {
  const match = String(sentence || "").trim().match(/[.!?]$/);
  return match ? match[0] : ".";
}

function removeEndPunctuation(sentence) {
  return String(sentence || "")
    .trim()
    .replace(/[.!?]+$/g, "");
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

function splitWordsIntoChunks(words) {
  const chunks = [];
  let index = 0;

  while (index < words.length) {
    const remaining = words.length - index;

    if (remaining <= 2) {
      chunks.push(words.slice(index).join(" "));
      break;
    }

    // 尽量拆细：多数是 1 个词或 2 个词
    if (remaining >= 8) {
      chunks.push(words.slice(index, index + 2).join(" "));
      index += 2;
    } else if (remaining >= 5) {
      chunks.push(words.slice(index, index + 1).join(" "));
      index += 1;
    } else {
      chunks.push(words.slice(index, index + 2).join(" "));
      index += 2;
    }
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

  // 保留 0–1 个开头已有词，避免白给太多
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

function normalizeQuestion(question, index, level, topic) {
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("Missing GEMINI_API_KEY environment variable");
    }

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    const { count = 5, level = "Medium", topic = "Mixed" } = req.body || {};

    const prompt = `
You are a TOEFL Build a Sentence exercise generator.

Generate ${count} TOEFL-style A/B dialogue sentence-building questions.

Important:
You only need to generate Speaker A's context sentence, Speaker B's full target sentence, and the explanation.
Do not decide blanks.
Do not create word banks.
The website will automatically split the B sentence into blanks.

The exercise is NOT a translation task.
It is a dialogue sentence-building task.

Good style examples:

Example 1:
A: What was the highlight of your trip?
B target: The tour guides who showed us around the old city were fantastic.

Example 2:
A: I heard Anna got a promotion.
B target: Do you know if she will be moving to a different department?

Example 3:
A: We're planning a trip to the mountains next weekend.
B target: Can you tell me whether the cabins will be available?

Example 4:
A: What did Maria ask you about the book you're reading?
B target: She wanted to know where she could buy a copy.

Rules:
1. Speaker A should provide a natural dialogue context.
2. Speaker B's target sentence should be a natural response.
3. B target should contain 8 to 14 words.
4. B target should test useful grammar, word order, collocation, or logical connection.
5. Mix these relationship types:
   - question-answer
   - statement-question
   - statement-statement
6. Avoid overly simple sentences like "What time does it start?"
7. Avoid repeated sentence patterns.
8. Do not include Chinese.
9. Do not include markdown.

Selected difficulty: ${level}
Selected topic: ${topic}

Return valid JSON only.

Return this exact JSON structure:
{
  "questions": [
    {
      "id": 1,
      "level": "Medium",
      "topic": "Travel",
      "relationType": "question-answer",
      "contextSpeaker": "A",
      "contextSentence": "What was the highlight of your trip?",
      "answerSpeaker": "B",
      "target": "The tour guides who showed us around the old city were fantastic.",
      "explanation": "A asks about the highlight of the trip. B answers with a noun phrase followed by a relative clause."
    }
  ]
}
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const text = response.text || "";

    if (!text) {
      throw new Error("Gemini returned empty response");
    }

    const json = JSON.parse(text);

    if (!Array.isArray(json.questions)) {
      throw new Error("Gemini response does not contain questions array");
    }

    const cleanedQuestions = json.questions.map((question, index) =>
      normalizeQuestion(question, index, level, topic)
    );

    return res.status(200).json({
      questions: cleanedQuestions,
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to generate questions",
    });
  }
}