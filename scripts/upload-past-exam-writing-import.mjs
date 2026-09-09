import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createClient } from "@supabase/supabase-js";

const env = {};
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\n/)) {
    const match = line.match(/^([^#=\s]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase server credentials in .env");

const inputPath = process.argv[2];
const commit = process.argv.includes("--commit");
if (!inputPath) throw new Error("Usage: node scripts/upload-past-exam-writing-import.mjs <import.json> [--commit]");

const payload = JSON.parse(fs.readFileSync(path.resolve(inputPath), "utf8"));
const items = payload.items || [];
const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

function taskKeys(date, task) {
  const prompt = task.prompt || {};
  const keys = new Set([`${task.type}|${date}|title|${normalize(prompt.title || task.title)}`]);
  if (task.type === "email") {
    keys.add(`${task.type}|${date}|email|${normalize(prompt.recipient)}|${normalize((prompt.requirements || []).join(" "))}`);
    keys.add(`${task.type}|${date}|email-content|${normalize(prompt.scenario)}|${normalize((prompt.requirements || []).join(" "))}`);
  } else if (task.type === "discussion") {
    keys.add(`${task.type}|${date}|discussion|${normalize(prompt.professor)}`);
  }
  return keys;
}

function tasksEquivalent(left, right) {
  if (!left || !right || left.type !== right.type) return false;
  const a = left.prompt || {};
  const b = right.prompt || {};
  if (left.type === "email") {
    return (
      normalize(a.scenario) === normalize(b.scenario) &&
      normalize((a.requirements || []).join(" ")) === normalize((b.requirements || []).join(" ")) &&
      normalize(a.category) === normalize(b.category)
    );
  }
  return (
    normalize(a.professor) === normalize(b.professor) &&
    normalize(a.studentOnePost) === normalize(b.studentOnePost) &&
    normalize(a.studentTwoPost) === normalize(b.studentTwoPost) &&
    normalize(a.category) === normalize(b.category)
  );
}

function validateItem(item) {
  const { displayDate, title, task } = item;
  if (!/^2026-(0[1-6])-\d{2}$/.test(displayDate)) throw new Error(`Invalid date: ${item.sourcePath}`);
  if (!title || !task || !["email", "discussion"].includes(task.type)) throw new Error(`Invalid task: ${item.sourcePath}`);
  const prompt = task.prompt || {};
  const serialized = JSON.stringify(prompt);
  if (/7\s*min|10\s*min|开始练习|题干信息|课堂讨论|查看系统范文/.test(serialized)) {
    throw new Error(`UI text leaked into prompt: ${item.sourcePath}`);
  }
  if (task.type === "email") {
    if (!prompt.scenario || !prompt.task || !prompt.recipient || !prompt.subject || prompt.requirements?.length !== 3) {
      throw new Error(`Incomplete email: ${item.sourcePath}`);
    }
  } else if (!prompt.professor || !prompt.question || !prompt.studentOneName || !prompt.studentOnePost) {
    throw new Error(`Incomplete discussion: ${item.sourcePath}`);
  }
}

items.forEach(validateItem);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: existingRows, error: existingError } = await supabase
  .from("question_sets")
  .select("id, title, display_date, content")
  .eq("source_type", "past_exam")
  .gte("display_date", "2026-01-01")
  .lte("display_date", "2026-06-30");
if (existingError) throw existingError;

const keyOwners = new Map();
const existingById = new Map();
for (const row of existingRows || []) {
  existingById.set(row.id, { ...row, content: structuredClone(row.content), changedTaskIndexes: new Set() });
  for (const [taskIndex, task] of (row.content?.tasks || []).entries()) {
    for (const key of taskKeys(row.display_date, task)) {
      keyOwners.set(key, { kind: "existing", rowId: row.id, taskIndex });
    }
  }
}

const skipped = [];
const pending = [];
for (const item of items) {
  const keys = taskKeys(item.displayDate, item.task);
  const matchedOwner = [...keys].map((key) => keyOwners.get(key)).find(Boolean);
  if (matchedOwner) {
    let action = "skip-duplicate";
    if (matchedOwner.kind === "existing") {
      const row = existingById.get(matchedOwner.rowId);
      if (!isDeepStrictEqual(row.content.tasks[matchedOwner.taskIndex], item.task) && !tasksEquivalent(row.content.tasks[matchedOwner.taskIndex], item.task)) {
        row.content.tasks[matchedOwner.taskIndex] = item.task;
        row.changedTaskIndexes.add(matchedOwner.taskIndex);
        action = "refresh-existing";
      } else {
        action = "already-current";
      }
    }
    skipped.push({
      date: item.displayDate,
      title: item.title,
      type: item.task.type,
      action,
    });
    continue;
  }
  for (const key of keys) keyOwners.set(key, { kind: "pending" });
  pending.push(item);
}

const rowsToRefresh = [...existingById.values()].filter((row) => row.changedTaskIndexes.size > 0);

console.log(JSON.stringify({ mode: commit ? "commit" : "dry-run", sourceCount: items.length, existingRowCount: existingRows?.length || 0, pendingCount: pending.length, skippedCount: skipped.length, refreshRowCount: rowsToRefresh.length, refreshTaskCount: rowsToRefresh.reduce((sum, row) => sum + row.changedTaskIndexes.size, 0), skipped }, null, 2));
if (!commit) process.exit(0);

for (const row of rowsToRefresh) {
  const { data, error } = await supabase
    .from("question_sets")
    .update({ content: row.content })
    .eq("id", row.id)
    .select("id, content")
    .single();
  if (error) throw error;
  if (!isDeepStrictEqual(data.content, row.content)) {
    throw new Error(`Existing row refresh mismatch: ${row.id}`);
  }
}

const rows = pending.map((item) => ({
  source_type: "past_exam",
  title: `TOEFL Past Exam - ${item.displayDate.replaceAll("-", "/")} - ${item.title}`,
  display_date: item.displayDate,
  mock_number: null,
  sort_order: 0,
  content: {
    tasks: [item.task],
    description: item.title,
  },
}));

const inserted = [];
for (let index = 0; index < rows.length; index += 25) {
  const batch = rows.slice(index, index + 25);
  const { data, error } = await supabase
    .from("question_sets")
    .insert(batch)
    .select("id, title, display_date, content");
  if (error) throw error;
  inserted.push(...(data || []));
}

if (inserted.length !== rows.length) {
  throw new Error(`Read-back count mismatch: expected ${rows.length}, received ${inserted.length}`);
}

for (let index = 0; index < inserted.length; index += 1) {
  const expected = rows[index];
  const actual = inserted[index];
  if (
    actual.title !== expected.title ||
    actual.display_date !== expected.display_date ||
    !isDeepStrictEqual(actual.content, expected.content)
  ) {
    throw new Error(`Read-back mismatch: ${expected.title}`);
  }
}

console.log(JSON.stringify({ uploaded: true, insertedCount: inserted.length, verifiedCount: inserted.length, refreshedRowCount: rowsToRefresh.length, refreshedTaskCount: rowsToRefresh.reduce((sum, row) => sum + row.changedTaskIndexes.size, 0), insertedIds: inserted.map((row) => row.id) }, null, 2));
