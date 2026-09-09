import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const envPath = path.join(process.cwd(), ".env");
const env = {};

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\n/)) {
    const match = line.match(/^([^#=\s]+)=(.*)$/);
    if (match) {
      env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
}

const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.");
  process.exit(1);
}

const inputPath = process.argv[2];
const rawInput = inputPath
  ? fs.readFileSync(path.resolve(inputPath), "utf8")
  : fs.readFileSync(0, "utf8");

const article = JSON.parse(rawInput);

const localDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const requiredFields = [
  "topic",
  "moderator_intro",
  "discussant_a_response",
  "discussant_b_response",
  "moderator_summary",
];

for (const field of requiredFields) {
  if (!article[field] || typeof article[field] !== "string") {
    console.error(`Missing required string field: ${field}`);
    process.exit(1);
  }
}

const fullText =
  article.full_text ||
  [
    `Moderator: ${article.moderator_intro}`,
    `${article.discussant_a_name || "Discussant A"}: ${article.discussant_a_response}`,
    `${article.discussant_b_name || "Discussant B"}: ${article.discussant_b_response}`,
    `Moderator Summary: ${article.moderator_summary}`,
  ].join("\n\n");

const row = {
  article_date: article.article_date || localDate,
  title: article.title || article.topic,
  topic: article.topic,
  category: article.category || "general",
  language: "en",
  moderator_name: article.moderator_name || "Moderator",
  discussant_a_name: article.discussant_a_name || "Discussant A",
  discussant_b_name: article.discussant_b_name || "Discussant B",
  moderator_intro: article.moderator_intro,
  discussant_a_response: article.discussant_a_response,
  discussant_b_response: article.discussant_b_response,
  moderator_summary: article.moderator_summary,
  full_text: fullText,
  content: article.content || {
    moderator_intro: article.moderator_intro,
    discussant_a_response: article.discussant_a_response,
    discussant_b_response: article.discussant_b_response,
    moderator_summary: article.moderator_summary,
  },
  review_notes: article.review_notes || "",
  status: article.status || "published",
  published_at: article.published_at || new Date().toISOString(),
};

const supabase = createClient(supabaseUrl, serviceRoleKey);
const { data, error } = await supabase
  .from("daily_writing_articles")
  .upsert(row, { onConflict: "article_date" })
  .select("id, article_date, title, status")
  .single();

if (error) {
  console.error(error);
  process.exit(1);
}

console.log(JSON.stringify({ uploaded: true, article: data }, null, 2));
