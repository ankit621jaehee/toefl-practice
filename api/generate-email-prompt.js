import { GoogleGenAI } from "@google/genai";

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

    const { level = "Medium", topic = "Mixed" } = req.body || {};

    const prompt = `
You are a TOEFL Email Writing prompt generator.

Generate one TOEFL-style email writing task.

The task should be realistic and suitable for TOEFL learners.

Common scenarios:
- writing to a professor
- writing to an academic advisor
- writing to a campus office
- writing to a club organizer
- writing to a housing office
- writing to a library or student service center

Requirements:
1. The prompt must be in English.
2. Do not include Chinese.
3. The scenario should be clear and specific.
4. The task should ask the student to write a reply email.
5. Include exactly 3 bullet-point requirements.
6. The topic should not be too repetitive.
7. Avoid overly dramatic or unrealistic situations.
8. Suggested length should be 100–150 words.

Selected difficulty: ${level}
Selected topic: ${topic}

Return valid JSON only. No markdown.

Return this exact JSON structure:
{
  "title": "Email Writing Practice",
  "scenario": "You received an email from your professor saying that you missed an important class presentation.",
  "task": "Write a reply to your professor.",
  "requirements": [
    "Apologize for missing the presentation.",
    "Explain why you were absent.",
    "Ask whether you can make up the presentation."
  ],
  "suggestedLength": "Recommended length: 100–150 words"
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

    return res.status(200).json({
      title: json.title || "Email Writing Practice",
      scenario: json.scenario || "",
      task: json.task || "Write a reply email.",
      requirements: Array.isArray(json.requirements)
        ? json.requirements.slice(0, 3)
        : [],
      suggestedLength: json.suggestedLength || "Recommended length: 100–150 words",
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to generate email prompt",
    });
  }
}