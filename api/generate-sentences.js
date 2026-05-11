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

    const { count = 5, level = "Medium", topic = "Mixed" } = req.body || {};

    const prompt = `
You are a TOEFL Build a Sentence exercise generator.

Generate ${count} TOEFL-style A/B dialogue sentence-building questions.

The exercise format:
1. Show one previous sentence as A.
2. Show the next sentence as B.
3. B must contain only 0 to 2 visible fixed words.
4. Most of B must be hidden as blanks.
5. The student will drag shuffled chunks into the blanks.
6. Do not provide Chinese hints.
7. Do not create translation questions.

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

4. answerPrefix and answerSuffix are the visible fixed words in B.
5. The total number of visible fixed words in answerPrefix and answerSuffix must be 0 to 2 words.
6. Usually, answerPrefix should be empty or contain only 1 word.
7. Usually, answerSuffix should be empty or contain only 1 word.
8. Do not make answerPrefix or answerSuffix a full phrase.
9. Do not put more than 2 visible words outside the blanks.
10. Do not put the complete target sentence into answerPrefix or answerSuffix.

11. The missing part must be split into chunks.
12. chunks must not be empty.
13. chunks must contain at least 4 items.
14. Chunks can be single words or meaningful phrase groups.
15. Hide capitalization by making all chunks lowercase.
16. Do not include punctuation in chunks.
17. Most of the B sentence should appear in chunks.
18. The chunks, in order, plus answerPrefix and answerSuffix, must reconstruct the target sentence exactly.
19. Make sure chunks are in the exact correct order needed to reconstruct the missing part.

Very important:
Bad example:
{
  "answerPrefix": "Oh really, have you considered",
  "answerSuffix": "requirements?",
  "chunks": ["the essay"]
}
This is wrong because too many words are visible.

Good example:
{
  "answerPrefix": "",
  "answerSuffix": "requirements?",
  "target": "Oh really, have you considered the essay requirements?",
  "chunks": ["oh really", "have you considered", "the essay"]
}
This is correct because most of the sentence is hidden in chunks.

Another good example:
{
  "answerPrefix": "The",
  "answerSuffix": "",
  "target": "The tour guides who showed us around the old city were fantastic.",
  "chunks": ["tour guides", "who", "showed us around", "the old city", "were fantastic"]
}

Scoring rule:
Each question is worth 0.5 points.
If all blanks are correct, the student gets 0.5.
If one or more blanks are wrong, the student gets 0.

Selected difficulty: ${level}
Selected topic: ${topic}

Return valid JSON only. No markdown.
Do not include explanations outside the JSON.

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
      "answerSuffix": "",
      "target": "The tour guides who showed us around the old city were fantastic.",
      "chunks": [
        "tour guides",
        "who",
        "showed us around",
        "the old city",
        "were fantastic"
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

    const text = response.text || "";

    if (!text) {
      throw new Error("Gemini returned empty response");
    }

    const json = JSON.parse(text);

    if (!Array.isArray(json.questions)) {
      throw new Error("Gemini response does not contain questions array");
    }

    const cleanedQuestions = json.questions.map((question, index) => {
      const chunks = Array.isArray(question.chunks)
        ? question.chunks.filter(
            (chunk) => typeof chunk === "string" && chunk.trim() !== ""
          )
        : [];

      return {
        id: index + 1,
        level: question.level || level,
        topic: question.topic || topic,
        relationType: question.relationType || "question-answer",
        contextSpeaker: question.contextSpeaker || "A",
        contextSentence:
          question.contextSentence ||
          "What was the main point of the conversation?",
        answerSpeaker: question.answerSpeaker || "B",
        answerPrefix: question.answerPrefix || "",
        answerSuffix: question.answerSuffix || "",
        target: question.target || "",
        chunks,
        explanation:
          question.explanation ||
          "This question tests sentence structure and logical connection between two speakers.",
      };
    });

    return res.status(200).json({
      questions: cleanedQuestions,
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to generate questions",
    });
  }
}