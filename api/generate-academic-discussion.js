import { GoogleGenAI } from "@google/genai";
import { chargeRequestAfterSuccess } from "./points.js";

const DISCUSSION_PROMPT_COST = 1;

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Gemini returned invalid JSON: ${text.slice(0, 300)}`);
  }
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

    const prompt = `
You are a TOEFL Academic Discussion prompt generator.

Generate one TOEFL-style academic discussion writing task.

The task must closely match the real TOEFL Academic Discussion screen structure:
1. First show general instructions/background for the test taker.
2. Then show the professor's post.
3. The debatable question the test taker answers must be raised inside the professor's post.
4. Then show two student posts with different opinions.

The instruction/background should follow this style:
"Your professor is teaching a class on [subject]. Write a post responding to the professor's question. In your response, you should
· express and support your personal opinion
· make a contribution to the discussion in your own words
An effective response will contain at least 100 words. You have ten minutes to write."

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
3. Include an "instruction" field with the test-taker background and requirements.
4. The professor's post should first briefly state what the class has been discussing.
5. The professor's post must end with one clear question, such as "Do you believe... Why or why not?"
6. The "question" field must repeat only the professor's final debatable question.
7. The two student posts should be short but meaningful, and they should answer the professor's question from different angles.
8. The task should be suitable for TOEFL learners.
9. Avoid overly political or sensitive topics.
10. Suggested length should be at least 100 words.
11. Make the topic different from common sample prompts when possible.
12. Do not include markdown.

Also include a hidden field called "knowledgeCategory".
The value must be exactly one of:
内容发展, 词汇表达, 语法句型, 连贯与组织, 任务完成.
Choose the category based on the main skill tested by this academic discussion prompt.
Do not show this field to the student. It should only appear in the JSON output.

Return valid JSON only.

Return this exact JSON structure:
{
  "title": "Academic Discussion Practice",
  "instruction": "Your professor is teaching a class on sociology. Write a post responding to the professor's question. In your response, you should\n· express and support your personal opinion\n· make a contribution to the discussion in your own words\nAn effective response will contain at least 100 words. You have ten minutes to write.",
  "professorName": "Doctor Achebe",
  "professor": "We've been discussing government budgets and the difficult decisions governments must make regarding the use of public funds. Some services are clearly essential and must be paid for by any government. But what about public funding of the arts? Do you believe that governments should provide financial support to artists-for example, painters, sculptors, musicians, or filmmakers? Why or why not?",
  "studentOneName": "Claire",
  "studentOnePost": "I don't think taxpayers' money should be spent on impractical or inessential services. Artists should support themselves by selling their work to private individuals and companies.",
  "studentTwoName": "Paul",
  "studentTwoPost": "I think art is essential. Public spaces in my hometown would not be the same without statues, murals, and other artwork that residents and visitors enjoy.",
  "question": "Do you believe that governments should provide financial support to artists? Why or why not?",
  "suggestedLength": "Recommended length: at least 100 words",
  "knowledgeCategory": "内容发展"
}
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.7,
      },
    });

    const text = response.text || "";

    if (!text.trim()) {
      throw new Error("Gemini returned empty response");
    }

    const json = safeJsonParse(text);

    const { balance } = await chargeRequestAfterSuccess(
      req,
      DISCUSSION_PROMPT_COST,
      "Academic Discussion practice"
    );

    return res.status(200).json({
      title: json.title || "Academic Discussion Practice",
      instruction:
        json.instruction ||
        "Your professor is teaching a class on sociology. Write a post responding to the professor's question. In your response, you should\n· express and support your personal opinion\n· make a contribution to the discussion in your own words\nAn effective response will contain at least 100 words. You have ten minutes to write.",
      professorName: json.professorName || "Professor",
      professor:
        json.professor ||
        "We've been discussing how students can balance academic success with personal well-being. Some people believe students should focus mainly on grades, while others think mental health and personal growth are equally important.",
      studentOneName: json.studentOneName || "Kelly",
      studentOnePost:
        json.studentOnePost ||
        "I think students should focus on grades because academic performance can affect scholarships and future opportunities.",
      studentTwoName: json.studentTwoName || "Andrew",
      studentTwoPost:
        json.studentTwoPost ||
        "I believe personal well-being is just as important because students cannot perform well if they are constantly stressed.",
      question:
        json.question ||
        "Do you think students should prioritize academic success or personal well-being? Explain your reasoning.",
      suggestedLength:
        json.suggestedLength || "Recommended length: at least 100 words",
      balance,
    });
  } catch (error) {
    console.error("Generate academic discussion error:", error);

    return res.status(error.statusCode || 500).json({
      error:
        error?.message || "Failed to generate academic discussion prompt",
      details: String(error),
      balance: error.balance,
      cost: error.cost,
    });
  }
}
