import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { count = 5, level = "Medium", topic = "Mixed" } = req.body || {};

    const prompt = `
You are a TOEFL Build a Sentence exercise generator.

Generate ${count} TOEFL-style A/B dialogue sentence-building questions.

The exercise format:
1. Show one previous sentence as A.
2. Show the next sentence as B.
3. B must contain answerPrefix, several blanks, and answerSuffix.
4. The student will drag shuffled chunks into the blanks.
5. Do not provide Chinese hints.

Dialogue relationship rules:
1. If A is a question, B should be an answer.
2. If A is a statement, B can be:
   - a follow-up question, or
   - another statement that naturally continues the idea.
3. Mix these three patterns:
   - question-answer
   - statement-question
   - statement-statement

Design rules:
1. The target sentence should sound natural.
2. The target sentence should be suitable for TOEFL learners.
3. The target sentence should contain 8 to 16 words.
4. answerPrefix and answerSuffix should be visible fixed parts of B.
5. chunks should fill the blanks between answerPrefix and answerSuffix.
6. Chunks can be single words or meaningful phrase groups.
7. Hide capitalization by making all chunks lowercase.
8. Do not include punctuation in chunks.
9. The full sentence formed by answerPrefix + chunks + answerSuffix must equal target.
10. Make sure chunks are in the exact correct order needed to reconstruct the missing part.

Scoring rule:
Each question is worth 0.5 points.
If all blanks are correct, the student gets 0.5.
If one or more blanks are wrong, the student gets 0.

Selected difficulty: ${level}
Selected topic: ${topic}

Return valid JSON only. No markdown.

Return format:
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
      "answerPrefix": "The",
      "answerSuffix": "fantastic.",
      "target": "The tour guides who showed us around the old city were fantastic.",
      "chunks": [
        "tour guides",
        "who",
        "showed us around",
        "the",
        "old city",
        "were"
      ],
      "explanation": "A asks about the highlight of the trip, so B gives a direct answer. The phrase who showed us around the old city is a relative clause modifying tour guides."
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

    const text = response.text;
    const json = JSON.parse(text);

    return res.status(200).json(json);
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to generate questions",
    });
  }
}