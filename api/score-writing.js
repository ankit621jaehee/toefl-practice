import scoreEmailWriting from "../lib/score-email-writing-handler.js";
import scoreAcademicDiscussion from "../lib/score-academic-discussion-handler.js";

export default async function handler(req, res) {
  const task = String(req.query?.task || "").toLowerCase();

  if (task === "email") {
    return scoreEmailWriting(req, res);
  }

  if (task === "discussion") {
    return scoreAcademicDiscussion(req, res);
  }

  return res.status(400).json({ error: "Unsupported writing task" });
}
