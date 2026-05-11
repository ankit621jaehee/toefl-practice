import { GoogleGenAI } from "@google/genai";

function countWords(text) {
  return String(text || "").trim()
    ? String(text || "").trim().split(/\s+/).length
    : 0;
}

function extractNumericScore(scoreText) {
  const match = String(scoreText || "").match(/\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function formatScore(score) {
  return `${score.toFixed(1)} / 5.0`;
}

function applyLengthCap(scoreText, wordCount) {
  let score = extractNumericScore(scoreText);

  if (wordCount < 5) {
    score = Math.min(score, 0.5);
  } else if (wordCount < 10) {
    score = Math.min(score, 1.0);
  } else if (wordCount < 30) {
    score = Math.min(score, 2.0);
  } else if (wordCount < 50) {
    score = Math.min(score, 3.0);
  } else if (wordCount < 80) {
    score = Math.min(score, 3.5);
  } else if (wordCount < 100) {
    score = Math.min(score, 4.2);
  }

  return formatScore(score);
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
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

    const { prompt, answer } = req.body || {};

    if (!prompt || !answer) {
      return res.status(400).json({
        error: "Missing prompt or answer",
      });
    }

    const wordCount = countWords(answer);

    const scoringPrompt = `
You are a strict TOEFL Email Writing evaluator.

Evaluate the student's email response.

Scoring scale:
- 5.0: Excellent response. Fully completes the task, natural email format, strong organization, accurate language.
- 4.0: Good response. Completes the task with minor language or development issues.
- 3.0: Fair response. Partially completes the task but has noticeable problems.
- 2.0: Weak response. Very limited, incomplete, unclear, or poorly developed.
- 1.0: Very poor response. Only a few relevant words or one very incomplete sentence.
- 0.0: Empty, irrelevant, or not an email response.

Main scoring criteria:
1. Task completion:
   - Does the student address all required points?
   - Does the response answer the email situation?
2. Email format:
   - Greeting, body, closing.
   - Appropriate structure for an email.
3. Tone:
   - Polite, respectful, appropriate for a professor or university staff member.
4. Clarity and organization:
   - Clear purpose.
   - Logical order.
5. Language:
   - Grammar accuracy.
   - Vocabulary.
   - Naturalness.

Length penalty rules:
- Student word count is ${wordCount}.
- If the response has fewer than 5 words, the score must be between 0.0 and 0.5.
- If the response has 5 to 9 words, the score must be between 0.0 and 1.0.
- If the response has 10 to 29 words, the score must not exceed 2.0.
- If the response has 30 to 49 words, the score must not exceed 3.0.
- If the response has 50 to 79 words, the score must not exceed 3.5.
- A response generally needs at least 80 words to receive 4.0 or above.
- A response generally needs at least 100 words to receive 4.5 or above.
- If the response does not look like an email, the score must not exceed 2.0.
- If the response does not address the required points, the score must not exceed 3.0.
- If the response only contains a short phrase or a single sentence, the score must not exceed 1.5.

Important:
Be strict. Do not reward a very short response just because it has no grammar mistakes.
A few correct words are not enough for a high score.

Email prompt:
${JSON.stringify(prompt)}

Student response:
${answer}

Return valid JSON only. No markdown.

Return this exact JSON structure:
{
  "score": "2.0 / 5.0",
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
  "improvedVersion": "A polished version of the student's email.",
  "sampleAnswer": "A strong sample email for this prompt."
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
    const cappedScore = applyLengthCap(json.score || "0.0 / 5.0", wordCount);

    return res.status(200).json({
      score: cappedScore,
      strengths: normalizeArray(json.strengths),
      problems: normalizeArray(json.problems),
      grammarCorrections: normalizeArray(json.grammarCorrections),
      improvedVersion: json.improvedVersion || "",
      sampleAnswer: json.sampleAnswer || "",
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to score email writing",
    });
  }
}