import { GoogleGenAI } from "@google/genai";

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Gemini returned invalid JSON: ${text.slice(0, 300)}`);
  }
}

function normalizeSentenceQuestions(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item, index) => {
      const speakerA = String(item.speakerA || "").trim();
      const speakerB = String(item.speakerB || "").trim();
      const chunks = Array.isArray(item.chunks)
        ? item.chunks.map((chunk) => String(chunk).trim()).filter(Boolean)
        : [];

      if (!speakerA || !speakerB || chunks.length === 0) {
        return null;
      }

      return {
        id: `mock-sentence-${index + 1}`,
        speakerA,
        speakerB,
        chunks,
      };
    })
    .filter(Boolean);
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

    const { level = "medium", topic = "general campus and daily life" } =
      req.body || {};

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const prompt = `
You are creating a complete TOEFL-style mock test.

Generate:
1. Exactly 10 Build a Sentence questions.
2. Exactly 1 Email Writing prompt.
3. Exactly 1 Academic Discussion prompt.

Difficulty level: ${level}
Topic preference: ${topic}

Build a Sentence rules:
- Each question has a short Speaker A line and a natural Speaker B response.
- Speaker B must be reconstructable from chunks.
- Chunks should be meaningful word groups, not always single words.
- Do not include punctuation-only chunks.
- Speaker B should be natural conversational English.
- Each Speaker B should contain 8 to 16 words.
- The chunk order should be shuffled.
- Avoid making all questions too similar.
- Use campus, workplace, travel, daily life, schedule, study, or service situations.

Email Writing rules:
- The scenario should be realistic for school, work, campus service, travel, application, or daily communication.
- Include a clear task and 3 to 4 requirements.
- Recommended length should be 100–150 words.

Academic Discussion rules:
- Include a professor's discussion question.
- Include two student posts with different opinions.
- The final question should ask the test taker to express and support an opinion.
- Recommended length should be at least 100 words.

Return valid JSON only. No markdown.

Return this exact JSON structure:
{
  "sentenceQuestions": [
    {
      "speakerA": "string",
      "speakerB": "string",
      "chunks": ["string", "string", "string"]
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

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.8,
      },
    });

    const text = response.text || "";

    if (!text.trim()) {
      throw new Error("Gemini returned empty response");
    }

    const json = safeJsonParse(text);

    const sentenceQuestions = normalizeSentenceQuestions(json.sentenceQuestions);
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

    const message = error?.message || String(error);

    if (message.includes("429") || message.toLowerCase().includes("quota")) {
      return res.status(429).json({
        error: "AI generation quota exceeded. Please try again later.",
        details: message,
      });
    }

    return res.status(500).json({
      error: error?.message || "Failed to start mock test",
      details: String(error),
    });
  }
}