import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const prompts: Record<string, string> = {
  sentence_upgrade: `
You are a TOEFL writing practice generator.
Generate one sentence upgrade practice question.

Return ONLY valid JSON:
{
  "type": "sentence_upgrade",
  "originalSentence": "...",
  "task": "...",
  "upgradedVersion": "...",
  "explanation": ["...", "...", "..."]
}

Requirements:
- The original sentence should be simple and low-scoring.
- The upgraded version should be natural, specific, and suitable for TOEFL writing.
- Do not use overly difficult vocabulary.
`,

  detail_expansion: `
You are a TOEFL writing practice generator.
Generate one detail expansion practice question.

Return ONLY valid JSON:
{
  "type": "detail_expansion",
  "topicSentence": "...",
  "task": "...",
  "sampleExpansion": "...",
  "usefulMoves": ["...", "...", "..."]
}

Requirements:
- The topic sentence should be broad and common.
- The sample expansion must add one clear reason and one specific example.
`,

  discussion_outline: `
You are a TOEFL Academic Discussion practice generator.
Generate one outline-building practice question.

Return ONLY valid JSON:
{
  "type": "discussion_outline",
  "professorQuestion": "...",
  "studentA": "...",
  "studentB": "...",
  "task": "...",
  "sampleOutline": {
    "opinion": "...",
    "connection": "...",
    "reason": "...",
    "example": "...",
    "finalIdea": "..."
  }
}

Requirements:
- The professor question should be realistic for TOEFL Academic Discussion.
- Student A and Student B should have different opinions.
- The outline should help users build a 100-word response.
`,

  email_rewrite: `
You are a TOEFL email writing practice generator.
Generate one email rewriting practice question.

Return ONLY valid JSON:
{
  "type": "email_rewrite",
  "badEmail": "...",
  "task": "...",
  "improvedEmail": "...",
  "problems": ["...", "...", "..."]
}

Requirements:
- The bad email should be too direct, too short, or impolite.
- The improved email should be polite, clear, and appropriate.
`,

  error_fix: `
You are a TOEFL grammar practice generator.
Generate one error correction practice question.

Return ONLY valid JSON:
{
  "type": "error_fix",
  "wrongSentence": "...",
  "task": "...",
  "correctSentence": "...",
  "reason": "..."
}

Requirements:
- The wrong sentence should contain one or two common TOEFL writing errors.
- Focus on subject-verb agreement, articles, plural nouns, tense, comma splice, or word choice.
`,
};

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "Missing GEMINI_API_KEY" });
    }

    const { type } = req.body || {};

    if (!type || !prompts[type]) {
      return res.status(400).json({ error: "Invalid practice type" });
    }

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompts[type],
      config: {
        temperature: 0.8,
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
      error: "Failed to generate practice task",
    });
  }
}