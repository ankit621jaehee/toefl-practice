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
You are a TOEFL Academic Discussion prompt generator.

Generate one TOEFL-style academic discussion writing task.

The prompt should include:
1. A professor's discussion question.
2. One student post supporting one side.
3. Another student post giving a different view.
4. A final question asking the test taker to express and support their opinion.

Topic categories:
- education
- technology
- environment
- psychology
- campus life
- workplace
- health
- society
- communication
- creativity

Requirements:
1. The prompt must be in English.
2. Do not include Chinese.
3. The professor's post should introduce a debatable academic topic.
4. The two student posts should be short but meaningful.
5. The final question should ask for the student's opinion.
6. The task should be suitable for TOEFL learners.
7. Avoid overly political or sensitive topics.
8. Suggested length should be at least 100 words.

Selected difficulty: ${level}
Selected topic: ${topic}

Return valid JSON only. No markdown.

Return this exact JSON structure:
{
  "title": "Academic Discussion Practice",
  "professor": "We've been discussing whether universities should require students to take courses outside their major. Some people believe these courses help students become more well-rounded, while others think students should focus only on their chosen field.",
  "studentOneName": "Kelly",
  "studentOnePost": "I think students should take courses outside their major because they may discover new interests.",
  "studentTwoName": "Andrew",
  "studentTwoPost": "I disagree. College is already expensive and stressful, so students should focus on courses that directly help their future careers.",
  "question": "Do you think universities should require students to take courses outside their major? Why or why not?",
  "suggestedLength": "Recommended length: at least 100 words"
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
      title: json.title || "Academic Discussion Practice",
      professor: json.professor || "",
      studentOneName: json.studentOneName || "Kelly",
      studentOnePost: json.studentOnePost || "",
      studentTwoName: json.studentTwoName || "Andrew",
      studentTwoPost: json.studentTwoPost || "",
      question: json.question || "",
      suggestedLength:
        json.suggestedLength || "Recommended length: at least 100 words",
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to generate academic discussion prompt",
    });
  }
}