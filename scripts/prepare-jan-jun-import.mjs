import fs from "node:fs";

const inputPath = process.argv[2];
const outputPath = process.argv[3];
const categoryPath = process.argv[4];
if (!inputPath || !outputPath || !categoryPath) {
  throw new Error("Usage: node scripts/prepare-jan-jun-import.mjs <ocr.jsonl> <output.json> <category-ocr.jsonl>");
}

const records = fs
  .readFileSync(inputPath, "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line))
  .filter((record) => /\/(Email|学术)\/26年[1-6]月\//.test(record.path));

const allowedCategories = [
  "学术校园", "服务反馈", "旅行住宿", "合作活动", "生活社交", "求职申请",
  "教育学习", "商业经济", "科技媒体", "心理健康", "环境城市", "艺术人文", "社会文化", "政府政策",
];
const categoryByPath = new Map(
  fs.readFileSync(categoryPath, "utf8").trim().split("\n").map((line) => {
    const record = JSON.parse(line);
    const recognized = record.lines.map((item) => item.text);
    let category = recognized.find((text) => allowedCategories.includes(text));
    if (!category) {
      const joined = recognized.join(" ");
      if (joined.includes("艺术人")) category = "艺术人文";
      else if (joined.includes("社会文")) category = "社会文化";
      else if (joined.includes("商业经")) category = "商业经济";
    }
    return [record.path, category || ""];
  })
);

const genericInstruction =
  "Your professor is teaching a class. Write a post responding to the professor's question.\n\n" +
  "In your response, you should do the following:\n" +
  "• Express and support your opinion.\n" +
  "• Make a contribution to the discussion in your own words.\n\n" +
  "An effective response will contain at least 100 words.";

const cleanLine = (value) =>
  value
    .replace(/\s+/g, " ")
    .replace(/\b1 (believe|think|agree|am|would|support|prefer)\b/g, "I $1")
    .replace(/\bsuccesstul\b/gi, "successful")
    .replace(/\bana\b/g, "and")
    .replace(/\btollowing\b/gi, "following")
    .replace(/\bcontlicts\b/gi, "conflicts")
    .replace(/\bAl\b/g, "AI")
    .trim();

const joinWrapped = (lines) =>
  lines
    .map(cleanLine)
    .filter(Boolean)
    .join(" ")
    .replace(/\b([A-Za-z]+)-\s+([a-z]+)\b/g, "$1-$2")
    .replace(/\s+([,.;:?!])/g, "$1")
    .trim();

function classifyEmail(text) {
  const groups = [
    ["求职申请", /\b(job|career|intern|internship|resume|résumé|interview|employer|employee|hiring|employment|job application)\b/i],
    ["服务反馈", /customer service|complaint|refund|replacement|repair|damaged|defective|technical problem|technical issue|online store|delivery|order|purchase|subscription|support team|property manager|heating system|submission form|product|issue/i],
    ["旅行住宿", /\b(travel|trip|flight|airline|hotel|hostel|accommodation|reservation|booking|vacation|tour|luggage|tourist|resort)\b/i],
    ["生活社交", /new city|adjust|overwhelmed|advice|personal problem|relationship|family|social life|make new friends|settle into|well-being|birthday|wedding|stress|health/i],
    ["合作活动", /group project|group member|event|club|meeting|volunteer|activity|invite|invitation|organize|organizer|festival|concert|team|workshop|conference|collaborat/i],
    ["学术校园", /professor|course|class|assignment|campus|university|college|research project|semester|academic|deadline|lecture|school/i],
  ];
  for (const [label, pattern] of groups) if (pattern.test(text)) return label;
  return "学术校园";
}

function classifyDiscussion(text) {
  const groups = [
    ["政府政策", /government|policy|policies|law|laws|tax|taxes|budget|regulation|vote|voting|official|public funding/i],
    ["艺术人文", /\b(art|artist|music|museum|painting|film|literature|humanities|poetry|theater|theatre|philosophy)\b/i],
    ["环境城市", /environment|pollution|climate|urban|traffic|public transport|recycling|sustainab|natural resource|planet|energy-efficient/i],
    ["心理健康", /stress|mental health|health|exercise|wellness|sleep|emotion|psychology|anxiety|maturity/i],
    ["商业经济", /business|economy|economic|company|consumer|advertising|marketing|money|income|workplace|financial|poverty|retail|brand/i],
    ["科技媒体", /artificial intelligence|\bAI\b|technology|digital|internet|online platform|social media|\bapp(s)?\b|video platform/i],
    ["社会文化", /society|social mobility|culture|cultural|community|tradition|language|family|friend|anthropolog|ritual|hierarchy|networking|personal connections|adulthood/i],
    ["教育学习", /education|educational|school|college|university|student|course|class|learning|training|degree|teacher|professor/i],
  ];
  for (const [label, pattern] of groups) if (pattern.test(text)) return label;
  return "教育学习";
}

function findHeader(lines) {
  const index = lines.findIndex((line) => /^2026-\d{2}-\d{2}\s+/.test(line));
  if (index < 0) throw new Error(`Missing dated title`);
  const match = lines[index].match(/^(2026-\d{2}-\d{2})\s+(.+)$/);
  return { index, date: match[1], title: cleanLine(match[2]) };
}

function parseEmail(record) {
  const rawLines = record.lines.filter((line) => line.confidence >= 0.8).map((line) => line.text);
  const { index: headerIndex, date, title } = findHeader(rawLines);
  const lines = rawLines.slice(headerIndex + 1).map(cleanLine);
  const taskIndex = lines.findIndex(
    (line) => /^Write an email to .+In your email, do the following\.?$/i.test(line)
  );
  const lengthIndex = lines.findIndex((line) => /^Write as much as you can and in complete sentences\.?$/i.test(line));
  if (taskIndex < 0 || lengthIndex < 0) {
    throw new Error(`Cannot locate task boundaries: ${record.path}`);
  }

  const scenario = joinWrapped(lines.slice(0, taskIndex));
  const task = cleanLine(lines[taskIndex]);
  const requirementLines = lines.slice(taskIndex + 1, lengthIndex);
  const requirements = [];
  for (const line of requirementLines) {
    const match = line.match(/^([1-3])\.\s*(.*)$/);
    if (match) requirements.push(match[2]);
    else if (!requirements.length && /^[•-]\s*/.test(line)) requirements.push(line.replace(/^[•-]\s*/, ""));
    else if (requirements.length) requirements[requirements.length - 1] += ` ${line}`;
  }
  if (requirements.length !== 3) {
    throw new Error(`Expected 3 requirements: ${record.path}`);
  }

  const recipientMatch = task.match(/^Write an email to (.+?)\. In your email/i);
  const recipient = recipientMatch?.[1] || "";
  const after = lines.slice(lengthIndex + 1).filter((line) => {
    if (!line) return false;
    if (/7\s*min/i.test(line)) return false;
    if (/^[•.·…]+$/.test(line)) return false;
    if (/^[^A-Za-z]*$/.test(line)) return false;
    if (line === recipient) return false;
    if (line.length < 5) return false;
    if (/^[A-Z0-9#*\/<> ]+$/.test(line) && !/[a-z]/.test(line)) return false;
    return true;
  });
  const subject = cleanLine(after.at(-1) || title).replace(/^[^A-Za-z0-9]+/, "");
  const promptText = [title, scenario, task, requirements.join(" ")].join(" ");

  return {
    sourcePath: record.path,
    displayDate: date,
    title,
    task: {
      type: "email",
      title: "Email Writing",
      prompt: {
        title,
        scenario,
        task,
        recipient,
        subject,
        requirements: requirements.map((requirement) => {
          const cleaned = cleanLine(requirement).replace(/\b([A-Za-z]+)-\s+([a-z]+)\b/g, "$1-$2");
          return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
        }),
        suggestedLength: cleanLine(lines[lengthIndex]),
        sampleAnswer: "",
        category: categoryByPath.get(record.path) || classifyEmail(promptText),
      },
    },
  };
}

function parseDiscussion(record) {
  const rawLines = record.lines.filter((line) => line.confidence >= 0.8).map((line) => line.text);
  const { index: headerIndex, date, title } = findHeader(rawLines);
  const lines = rawLines.slice(headerIndex + 1).map(cleanLine);
  let professorIndex = lines.findIndex((line) => /[•·.]\s*Professor(?:\s+l)?$/i.test(line));
  if (professorIndex < 0) {
    professorIndex = lines.findIndex((line) => /\bProfessor(?:\s+l)?$/i.test(line));
  }
  if (professorIndex < 0) throw new Error(`Missing professor marker: ${record.path}`);
  let studentIndexes = lines
    .map((line, index) => (/[•·]\s*Student$/i.test(line) ? index : -1))
    .filter((index) => index > professorIndex);
  studentIndexes = lines
    .map((line, index) => (/[•·.]\s*Student$/i.test(line) ? index : -1))
    .filter((index) => index > professorIndex);

  const firstStudentLooksLikeProfessor =
    studentIndexes.length >= 2 &&
    /^(Dr\.|Doctor)\s/i.test(lines[studentIndexes[0]]) &&
    /^Write a post responding to the professor's question/i.test(lines[professorIndex + 1] || "");
  if (firstStudentLooksLikeProfessor) {
    professorIndex = studentIndexes[0];
    studentIndexes = studentIndexes.slice(1);
  }
  if (studentIndexes.length < 1) throw new Error(`Missing student markers: ${record.path}`);

  const professorName = lines[professorIndex].replace(/\s*[•·.]\s*(?:Professor|Student)(?:\s+l)?$/i, "").trim();
  const studentOneName = lines[studentIndexes[0]].replace(/\s*[•·.]\s*Student$/i, "").trim();
  const studentTwoName = studentIndexes[1]
    ? lines[studentIndexes[1]].replace(/\s*[•·.]\s*Student$/i, "").trim()
    : "";
  const professor = joinWrapped(lines.slice(professorIndex + 1, studentIndexes[0]));
  const studentOnePost = joinWrapped(lines.slice(studentIndexes[0] + 1, studentIndexes[1] || lines.length));
  const studentTwoPost = studentIndexes[1]
    ? joinWrapped(lines.slice(studentIndexes[1] + 1).filter((line) => !/^O?\s*[#H][^a-z]*$/i.test(line)))
    : "";
  const questionMatch = professor.match(/([^.!?]*(?:\?|Why or why not\?|Explain why\.?))\s*$/i);
  const question = cleanLine(questionMatch?.[1] || professor);
  const promptText = [title, professor, studentOnePost, studentTwoPost].join(" ");

  return {
    sourcePath: record.path,
    displayDate: date,
    title,
    task: {
      type: "discussion",
      title: "Academic Discussion",
      prompt: {
        title,
        professorName,
        professor,
        question,
        studentOneName,
        studentOnePost,
        studentTwoName,
        studentTwoPost,
        instruction: genericInstruction,
        suggestedLength: "An effective response will contain at least 100 words.",
        category: categoryByPath.get(record.path) || classifyDiscussion(promptText),
      },
    },
  };
}

const parsed = [];
const errors = [];
for (const record of records) {
  try {
    parsed.push(record.path.includes("/Email/") ? parseEmail(record) : parseDiscussion(record));
  } catch (error) {
    errors.push({ path: record.path, error: error.message });
  }
}

const duplicates = [];
const seen = new Map();
for (const item of parsed) {
  const key = `${item.task.type}|${item.displayDate}|${item.title.toLowerCase()}`;
  if (seen.has(key)) duplicates.push({ key, first: seen.get(key), duplicate: item.sourcePath });
  else seen.set(key, item.sourcePath);
}

const deduped = [];
const emailContentKeys = new Map();
for (const item of parsed) {
  if (item.task.type !== "email") {
    deduped.push(item);
    continue;
  }
  const prompt = item.task.prompt;
  const key = `${item.displayDate}|${prompt.recipient}|${prompt.requirements.join("|")}`.toLowerCase();
  const existingIndex = emailContentKeys.get(key);
  if (existingIndex === undefined) {
    emailContentKeys.set(key, deduped.length);
    deduped.push(item);
    continue;
  }
  const existing = deduped[existingIndex];
  duplicates.push({
    key,
    first: existing.sourcePath,
    duplicate: item.sourcePath,
    reason: "same date, recipient, and requirements",
  });
  if ((prompt.scenario || "").length > (existing.task.prompt.scenario || "").length) {
    deduped[existingIndex] = item;
  }
}

const payload = { generatedAt: new Date().toISOString(), counts: { records: records.length, parsed: parsed.length, deduped: deduped.length, errors: errors.length }, errors, duplicates, items: deduped };
fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify({ counts: payload.counts, duplicateCount: duplicates.length, outputPath }, null, 2));
