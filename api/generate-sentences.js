import { GoogleGenAI } from "@google/genai";

function cleanBlankAnswer(text) {
  return String(text || "")
    .replace(/[,.!?;:]+$/g, "")
    .replace(/^[,.!?;:]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function cleanFixedText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function countFixedWords(parts) {
  return parts
    .filter((part) => part.type === "fixed")
    .flatMap((part) => cleanFixedText(part.text).split(/\s+/).filter(Boolean))
    .filter((word) => !/^[,.!?;:]+$/.test(word)).length;
}

function normalizeParts(parts, target) {
  if (!Array.isArray(parts)) return [];

  const cleaned = [];

  for (const part of parts) {
    if (!part || typeof part !== "object") continue;

    if (part.type === "fixed") {
      const text = cleanFixedText(part.text);
      if (text) {
        cleaned.push({
          type: "fixed",
          text,
        });
      }
    }

    if (part.type === "blank") {
      const answer = cleanBlankAnswer(part.answer);
      if (answer) {
        cleaned.push({
          type: "blank",
          answer,
        });
      }
    }
  }

  return cleaned;
}

function getChunksFromParts(parts) {
  return parts
    .filter((part) => part.type === "blank")
    .map((part) => cleanBlankAnswer(part.answer))
    .filter(Boolean);
}

function isUsableQuestion(question) {
  const parts = Array.isArray(question.parts) ? question.parts : [];
  const chunks = getChunksFromParts(parts);
  const fixedWords = countFixedWords(parts);

  return (
    typeof question.contextSentence === "string" &&
    question.contextSentence.trim() &&
    typeof question.target === "string" &&
    question.target.trim() &&
    parts.length > 0 &&
    chunks.length >= 6 &&
    chunks.length <= 9 &&
    fixedWords <= 3
  );
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

The exercise is NOT a translation task.
It is a dialogue sentence-building task.

The student sees:
1. Speaker A's sentence.
2. Speaker B's incomplete sentence.
3. Some fixed words are already shown in B.
4. Several blanks appear in B.
5. The student chooses word chunks from a word bank and puts them into the blanks.

The style should look like these examples:

Example 1:
A: What was the highlight of your trip?
B: The ____ ____ ____ ____ ____ ____ fantastic.
Answer: The tour guides who showed us around the old city were fantastic.
Word bank: tour guides / who / showed / us around / the old / city / were

Example 2:
A: I heard Anna got a promotion.
B: ____ ____ ____ ____ she will be ____ ____ ____?
Answer: Do you know if she will be moving to a different department?
Word bank: do / you / know / if / moving / to a / different / department

Example 3:
A: We're planning a trip to the mountains next weekend.
B: ____ ____ tell me ____ ____ ____ ____?
Answer: Can you tell me whether the cabins will be available?
Word bank: can / you / whether / the cabins / will be / available

Example 4:
A: What did Maria ask you about the book you're reading?
B: She ____ ____ ____ ____ ____ ____.
Answer: She wanted to know where she could buy a copy.
Word bank: wanted / to know / where / she could / buy / a copy

Output design rules:
1. A sentence should be a natural context.
2. B sentence should be a natural response to A.
3. B sentence should contain 8 to 14 words.
4. Use 6 to 8 blanks per question.
5. Use 0 to 3 visible fixed words total in B.
6. Fixed words can appear at the beginning, middle, or end.
7. Most of B should be hidden in blanks.
8. Each blank corresponds to one chunk.
9. Chunks should usually be 1 word or 2 words.
10. Only use a 3-word chunk when it is a very natural phrase.
11. Do not create huge chunks like "a different department" if it can be split into "a different" and "department".
12. Do not create huge chunks like "will be available" if it can be split into "will be" and "available".
13. Do not put punctuation in blank answers.
14. Punctuation must stay in fixed parts, such as "." or "?".
15. Do not include commas, periods, or question marks in the word bank.
16. Do not use Chinese.
17. Mix question-answer, statement-question, and statement-statement patterns.
18. The answer must be reconstructable exactly from the fixed words and chunks.

Selected difficulty: ${level}
Selected topic: ${topic}

Return valid JSON only. No markdown.

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
      "parts": [
        { "type": "fixed", "text": "The" },
        { "type": "blank", "answer": "tour guides" },
        { "type": "blank", "answer": "who" },
        { "type": "blank", "answer": "showed" },
        { "type": "blank", "answer": "us around" },
        { "type": "blank", "answer": "the old" },
        { "type": "blank", "answer": "city" },
        { "type": "blank", "answer": "were" },
        { "type": "fixed", "text": "fantastic." }
      ],
      "explanation": "A asks about the highlight of the trip. B answers with a noun phrase followed by a relative clause."
    }
  ]
}

Requirements for parts:
1. parts must reconstruct the full target sentence in order.
2. fixed parts are visible words or punctuation shown to the student.
3. blank parts are hidden spaces the student fills.
4. Every blank part must have an answer.
5. Use 6 to 8 blank parts.
6. Use no more than 3 visible fixed words total.
7. Never put punctuation in blank answers.
8. Punctuation should be in fixed parts only.
9. Fixed punctuation can be its own part, for example { "type": "fixed", "text": "?" }.
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

    const cleanedQuestions = json.questions.map((question, index) => {
      const parts = normalizeParts(question.parts, question.target);
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
        target: question.target || "",
        parts,
        chunks,
        explanation:
          question.explanation ||
          "This question tests sentence structure and logical connection between two speakers.",
      };
    });

    const usableQuestions = cleanedQuestions.filter(isUsableQuestion);

    if (usableQuestions.length === 0) {
      throw new Error("Gemini generated unusable questions");
    }

    return res.status(200).json({
      questions: usableQuestions,
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to generate questions",
    });
  }
}