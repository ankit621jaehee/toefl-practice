import { GoogleGenAI } from "@google/genai";

function countWords(text) {
  return String(text || "").trim()
    ? String(text || "").trim().split(/\s+/).length
    : 0;
}

function clampScore(score) {
  const number = Number(score);

  if (Number.isNaN(number)) return 0;

  return Math.max(0, Math.min(5, number));
}

function roundToOneDecimal(score) {
  return Math.round(score * 10) / 10;
}

function formatScore(score) {
  return `${roundToOneDecimal(score).toFixed(1)} / 5.0`;
}

function applyMinimumLengthCap(score, wordCount) {
  let finalScore = score;
  if (wordCount < 5) {
    finalScore = Math.min(finalScore, 0.5);
  } else if (wordCount < 10) {
    finalScore = Math.min(finalScore, 1.0);
  } else if (wordCount < 30) {
    finalScore = Math.min(finalScore, 2.0);
  } else if (wordCount < 60) {
    finalScore = Math.min(finalScore, 3.0);
  } else if (wordCount < 80) {
    finalScore = Math.min(finalScore, 3.5);
  } else if (wordCount < 100) {
    finalScore = Math.min(finalScore, 4.0);
  }
  return finalScore;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function calculateDiscussionScore(json, wordCount) {
  const opinionScore = clampScore(json.opinionScore);
  const developmentScore = clampScore(json.developmentScore);
  const languageScore = clampScore(json.languageScore);
  const naturalnessScore = clampScore(json.naturalnessScore);

  let score =
    opinionScore * 0.35 +
    developmentScore * 0.3 +
    languageScore * 0.25 +
    naturalnessScore * 0.1;

  score = applyMinimumLengthCap(score, wordCount);

  return formatScore(score);
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
You are a strict but fair TOEFL Academic Discussion evaluator.

Evaluate the student's academic discussion response.

Important scoring principle:
Do not over-focus on word count once the response reaches around 100 words.
Word count is mainly used to identify clearly incomplete responses.
A response with 100+ words should be scored mainly based on opinion, contribution, development, organization, language, and naturalness.

Student word count: ${wordCount}

Score each dimension from 0.0 to 5.0 using one decimal place.

Dimension 1: opinionScore
- Does the student clearly answer the professor's question?
- Is there a clear opinion or position?
- Does the response stay on topic?

Dimension 2: developmentScore
- Does the student give reasons, explanations, or examples?
- Does the response contribute something new to the discussion?
- Does it connect to or respond to the classmates' ideas when useful?

Dimension 3: languageScore
- Grammar accuracy.
- Vocabulary.
- Sentence control.
- Clarity.

Dimension 4: naturalnessScore
- Academic discussion style.
- Naturalness.
- Logical flow.

Minimum length rules:
- If fewer than 5 words, all dimension scores should be very low.
- If 5 to 9 words, the response is extremely incomplete.
- If 10 to 29 words, the response is clearly incomplete.
- If 30 to 59 words, the response may be partially complete but underdeveloped.
- If 60 to 99 words, the response can be acceptable but probably lacks development.
- If 100 words or more, do not penalize mainly for length.

Be consistent:
Use the same standards every time.
Do not give a high score to a very short response just because it has few grammar mistakes.
Do not be overly harsh on a complete 90+ word response only because it is not very long.
A strong response should express an opinion and support it.

Academic discussion prompt:
${JSON.stringify(prompt)}

Student response:
${answer}

Return valid JSON only. No markdown.

Return this exact JSON structure:
{
  "opinionScore": 4.0,
  "developmentScore": 4.0,
  "languageScore": 4.0,
  "naturalnessScore": 4.0,
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
        temperature: 0.1,
      },
    });

    const text = response.text || "";

    if (!text) {
      throw new Error("Gemini returned empty response");
    }

    const json = JSON.parse(text);
    const finalScore = calculateDiscussionScore(json, wordCount);

    return res.status(200).json({
      score: finalScore,
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