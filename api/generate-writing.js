import generateEmailPrompt from "../lib/generate-email-prompt-handler.js";
import generateAcademicDiscussion from "../lib/generate-academic-discussion-handler.js";

export default async function handler(req, res) {
  const task = String(req.query?.task || "").toLowerCase();

  if (task === "email") {
    return generateEmailPrompt(req, res);
  }

  if (task === "discussion") {
    return generateAcademicDiscussion(req, res);
  }

  return res.status(400).json({ error: "Unsupported writing task" });
}
