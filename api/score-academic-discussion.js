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
  } else if (wordCount < 90) {
    score = Math.min(score, 3.8);
  } else if (wordCount < 110) {
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
You are a strict TOEFL Academic Discussion evaluator.

Evaluate the student's academic discussion response.

Scoring scale:
- 5.0: Excellent response. Clear opinion, strong reasoning, relevant examples, connects to the discussion, natural academic language.
- 4.0: Good response. Clear opinion and relevant support, with minor language or development issues.
- 3.0: Fair response. Some opinion and support, but development is limited or unclear.
- 2.0: Weak response. Very limited, vague, incomplete, or only slightly related.
- 1.0: Very poor response. Only a few relevant words or one incomplete idea.
- 0.0: Empty, irrelevant, or not a response to the discussion.

Main scoring criteria:
1. Clear opinion:
   - Does the student clearly express a position?
2. Response to the professor:
   - Does the student answer the discussion question?
3. Contribution to the discussion:
   - Does the student add something new?
   - Does the student avoid simply copying classmates' ideas?
4. Development:
   - Reasons, explanations, and examples.
5. Organization:
   - Logical flow.
6. Language:
   - Grammar accuracy.
   - Vocabulary.
   - Academic naturalness.

Length penalty rules:
- Student word count is ${wordCount}.
- If the response has fewer than 5 words, the score must be between 0.0 and 0.5.
- If the response has 5 to 9 words, the score must be between 0.0 and 1.0.
- If the response has 10 to 29 words, the score must not exceed 2.0.
- If the response has 30 to 49 words, the score must not exceed 3.0.
- If the response has 50 to 79 words, the score must not exceed 3.5.
- A response generally needs at least 90 words to receive 4.0 or above.
- A response generally needs at least 110 words to receive 4.5 or above.
- If the response does not express a clear opinion, the score must not exceed 3.0.
- If the response does not respond to the professor's question, the score must not exceed 2.5.
- If the response only repeats a classmate's idea without adding its own reasoning, the score must not exceed 3.0.
- If the response only contains a short phrase or a single sentence, the score must not exceed 1.5.

Important:
Be strict. Do not reward a very short response just because it has no grammar mistakes.
A few correct words are not enough for a high score.
Academic Discussion responses must show an opinion and support it.

Academic discussion prompt:
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
      error: error.message || "Failed to score academic discussion",
    });
  }
}