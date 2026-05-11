import { GoogleGenAI } from "@google/genai";

function removeFinalPunctuation(sentence) {
  return sentence.trim().replace(/[.!?。！？]+$/g, "");
}

function getFinalPunctuation(sentence) {
  const match = sentence.trim().match(/[.!?]$/);
  return match ? match[0] : ".";
}

function cleanChunkText(text) {
  return text
    .replace(/[,.!?;:]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function splitIntoChunks(sentence) {
  const cleanSentence = removeFinalPunctuation(sentence);
  const words = cleanSentence.split(/\s+/).filter(Boolean);

  if (words.length <= 4) {
    return words.map((word) => cleanChunkText(word)).filter(Boolean);
  }

  const chunks = [];
  let index = 0;

  while (index < words.length) {
    const remaining = words.length - index;

    if (remaining <= 2) {
      chunks.push(words.slice(index).join(" "));
      break;
    }

    if (remaining === 3) {
      chunks.push(words.slice(index, index + 1).join(" "));
      chunks.push(words.slice(index + 1).join(" "));
      break;
    }

    const groupSize = remaining >= 8 ? 2 : remaining >= 5 ? 2 : 1;
    chunks.push(words.slice(index, index + groupSize).join(" "));
    index += groupSize;
  }

  return chunks.map((chunk) => cleanChunkText(chunk)).filter(Boolean);
}

function normalizeQuestion(question, index, level, topic) {
  const rawTarget =
    typeof question.target === "string" && question.target.trim()
      ? question.target.trim()
      : "I am not sure about it yet.";

  const punctuation = getFinalPunctuation(rawTarget);
  const chunks = splitIntoChunks(rawTarget);

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

    // 关键：不再使用 Gemini 生成的 prefix/suffix
    // 这样 B 句不会出现一大堆已有单词
    answerPrefix: "",
    answerSuffix: punctuation,

    target: rawTarget,
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
You only need to generate the full target sentence.
The website will automatically hide the sentence and split it into draggable chunks.
Do not decide the blanks yourself.

Question format:
1. Speaker A gives one sentence.
2. Speaker B gives one natural response.
3. Speaker B's response should be the target sentence.

Dialogue relationship rules:
1. If A is a question, B should be an answer.
2. If A is a statement, B can be a follow-up question.
3. If A is a statement, B can also be another statement that naturally continues the idea.
4. Mix these three types:
   - question-answer
   - statement-question
   - statement-statement

Target sentence rules:
1. The target sentence must be natural English.
2. The target sentence should be suitable for TOEFL learners.
3. The target sentence should contain 8 to 16 words.
4. The sentence should test useful grammar, collocation, or logical connection.
5. Do not make the sentence too short.
6. Do not make the sentence too simple.
7. Do not create translation questions.
8. Do not include Chinese.

Selected difficulty: ${level}
Selected topic: ${topic}

Return valid JSON only. No markdown.
Do not include any explanation outside JSON.

Return this exact JSON structure:
{
  "questions": [
    {
      "id": 1,
      "level": "Medium",
      "topic": "Campus Life",
      "relationType": "statement-statement",
      "contextSpeaker": "A",
      "contextSentence": "Have you decided what you want to major in yet?",
      "answerSpeaker": "B",
      "target": "I'm still not sure about it, but I'm leaning towards history.",
      "explanation": "A asks about the speaker's future major. B gives a cautious answer and uses but to introduce a current preference."
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