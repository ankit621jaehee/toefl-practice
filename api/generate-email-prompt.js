import { GoogleGenAI } from "@google/genai";
import { chargeRequestAfterSuccess } from "../server/points.js";

const EMAIL_PROMPT_COST = 1;

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
You are a TOEFL Email Writing prompt generator.

Generate one TOEFL-style email writing task.

The task should closely match the real TOEFL Writing for an Academic Discussion / Email task screen style shown in official-style practice:
- First give a clear background paragraph.
- Then give a direct writing task sentence.
- Then list exactly 3 concrete requirements.

Common scenarios:
- writing to a professor
- writing to an academic advisor
- writing to a campus office
- writing to a club organizer
- writing to a housing office
- writing to a library or student service center

Requirements:
1. The prompt must be in English.
2. Do not include Chinese.
3. The scenario must be one natural background paragraph of 55–85 words.
4. The scenario must explain who the student is, what happened, and why the email is needed.
5. The task must be a single sentence in this pattern: "Write an email to [recipient]. In your email, do the following:"
6. Include exactly 3 bullet-point requirements.
7. Each requirement should start with an action verb such as Share, Describe, Explain, Ask, Suggest, Request, Apologize, or Thank.
8. The requirements should be specific enough that the student knows what to include.
9. The topic should not be too repetitive.
10. Avoid overly dramatic or unrealistic situations.
11. Suggested length should be 100–150 words.
12. Include a concise email subject line that matches the specific situation and recipient. Do not use a generic subject like "Email Writing Practice".

Do not write a vague task like "Write a reply to your professor."
Do not make the email prompt only about receiving an email. It should first explain the situation/background.

Selected difficulty: ${level}
Selected topic: ${topic}

Also include a hidden field called "knowledgeCategory".
The value must be exactly one of:
内容完整性, 词汇表达, 语法结构, 连贯性, 礼貌格式.
Choose the category based on the main skill tested by this email prompt.
Do not show this field to the student. It should only appear in the JSON output.

Return valid JSON only. No markdown.

Return this exact JSON structure:
{
  "title": "Email Writing Practice",
  "subject": "A Stress Management Tip That Might Help",
  "scenario": "You are a university student, and you participated in a recent campus workshop about stress management. There was a particular technique or activity from the workshop that you found especially effective in reducing your stress. You think this might be helpful to your friend, Sarah, who has been feeling overwhelmed with her workload lately.",
  "task": "Write an email to Sarah. In your email, do the following:",
  "requirements": [
    "Share the specific stress management technique or activity you learned.",
    "Describe how it helped you manage your stress.",
    "Suggest that Sarah can try it when she feels overwhelmed."
  ],
  "suggestedLength": "Recommended length: 100–150 words",
  "knowledgeCategory": "礼貌格式"
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

    const { balance } = await chargeRequestAfterSuccess(
      req,
      EMAIL_PROMPT_COST,
      "Email Writing practice"
    );

    return res.status(200).json({
      title: json.title || "Email Writing Practice",
      subject: json.subject || json.title || "Email Writing Task",
      scenario: json.scenario || "",
      task: json.task || "Write an email to a classmate. In your email, do the following:",
      requirements: Array.isArray(json.requirements)
        ? json.requirements.slice(0, 3)
        : [],
      suggestedLength: json.suggestedLength || "Recommended length: 100–150 words",
      balance,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Failed to generate email prompt",
      balance: error.balance,
      cost: error.cost,
    });
  }
}
