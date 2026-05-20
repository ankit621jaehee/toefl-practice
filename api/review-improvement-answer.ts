import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "Missing GEMINI_API_KEY" });
    }

    const { type, task, userAnswer } = req.body || {};

    if (!type || !task || !userAnswer) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `
You are a TOEFL writing coach.

The user completed a writing improvement practice.

Practice type:
${type}

Practice task:
${JSON.stringify(task, null, 2)}

User answer:
${userAnswer}

Please review the user's answer and return ONLY valid JSON:

{
  "overallComment": "...",
  "strengths": ["...", "..."],
  "problems": ["...", "..."],
  "suggestions": ["...", "..."],
  "improvedVersion": "..."
}

Requirements:
- Use Chinese for comments.
- Keep the feedback practical and specific.
- Do not be overly harsh.
- The improved version should preserve the user's main idea but make it clearer, more natural, and more suitable for TOEFL writing.
- If the practice type is discussion_outline, improve the outline instead of writing a full essay.
- If the practice type is email_rewrite, improve the email format and tone.
`,
      config: {
        temperature: 0.5,
        responseMimeType: "application/json",
      },
    });

    const text = response.text;

    if (!text) {
      return res.status(500).json({ error: "No content returned" });
    }

    return res.status(200).json(JSON.parse(text));
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: "Failed to review answer",
    });
  }
}