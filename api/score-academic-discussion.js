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

    const { prompt, answer } = req.body || {};

    if (!prompt || !answer) {
      return res.status(400).json({
        error: "Missing prompt or answer",
      });
    }

    const scoringPrompt = `
You are a TOEFL Academic Discussion evaluator.

Evaluate the student's academic discussion response.

Scoring rules:
1. Score the response on a 0.0 to 5.0 scale.
2. Use one decimal place, such as 3.5, 4.0, or 4.5.
3. Be strict but fair.
4. Focus on:
   - clear opinion
   - response to the professor's question
   - connection to classmates' ideas
   - development of reasons and examples
   - organization
   - grammar and vocabulary
   - academic naturalness
5. A strong response should contribute something new to the discussion.
6. If the response only repeats classmates' ideas without adding its own reasoning, lower the score.
7. If the response is too short, vague, off-topic, or memorized, lower the score.
8. Return valid JSON only. No markdown.

Academic discussion prompt:
${JSON.stringify(prompt)}

Student response:
${answer}

Return this exact JSON structure:
{
  "score": "4.0 / 5.0",
  "strengths": [
    "strength 1",
    "strength 2",
    "strength 3"
  ],
  "problems": [
    "problem 1",
    "problem 2",
    "problem 3"
  ],
  "grammarCorrections": [
    {
      "original": "student's original phrase or sentence",
      "corrected": "corrected phrase or sentence",
      "explanation": "brief explanation"
    }
  ],
  "improvedVersion": "A polished version of the student's academic discussion response.",
  "sampleAnswer": "A strong sample academic discussion response for this prompt."
}
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: scoringPrompt,
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
      score: json.score || "N/A",
      strengths: Array.isArray(json.strengths) ? json.strengths : [],
      problems: Array.isArray(json.problems) ? json.problems : [],
      grammarCorrections: Array.isArray(json.grammarCorrections)
        ? json.grammarCorrections
        : [],
      improvedVersion: json.improvedVersion || "",
      sampleAnswer: json.sampleAnswer || "",
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to score academic discussion",
    });
  }
}