import { GoogleGenAI } from "@google/genai";
import { generateContentWithModelFallback } from "./gemini-helper.js";
import { chargeRequestAfterSuccess } from "../server/points.js";

const SENTENCE_PROMPT_COST = 1;

let currentDesignRules = {};

function getEndPunctuation(sentence) {
  const match = String(sentence || "").trim().match(/[.!?]$/);
  return match ? match[0] : ".";
}

function removeEndPunctuation(sentence) {
  return String(sentence || "")
    .trim()
    .replace(/[.!?]+$/g, "");
}

function cleanWord(word) {
  return String(word || "")
    .replace(/^[,.;:!?]+/g, "")
    .replace(/[,.;:!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanChunk(chunk) {
  return String(chunk || "")
    .replace(/[,.!?;:]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const flexibleOrAmbiguousChunks = new Set([
  "usually",
  "often",
  "sometimes",
  "generally",
  "probably",
  "perhaps",
  "maybe",
  "actually",
  "also",
  "still",
  "even",
  "only",
  "just",
  "really",
  "clearly",
  "carefully",
  "quickly",
  "slowly",
  "more clearly",
  "more carefully",
  "at the same time",
  "in the future",
  "in the past",
  "for example",
  "for instance",
  "in fact",
  "as a result",
  "on the other hand",
]);

const logicAnchorChunks = new Set([
  "although",
  "because",
  "since",
  "while",
  "whereas",
  "however",
  "therefore",
  "instead",
  "unless",
  "even though",
  "as long as",
  "so that",
  "rather than",
  "not only",
  "but also",
]);

function shouldPreferFixed(chunk) {
  const normalized = cleanChunk(chunk);

  if (!normalized) return false;

  // 不要因为词短就 fixed。
  // i / is / in / of / to 这些应该可以作为 blank，否则 fixed 会太散。
  if (normalized.length <= 2) return false;

  // 位置很灵活的副词/状语可以 fixed，避免多答案。
  if (flexibleOrAmbiguousChunks.has(normalized)) return true;

  // 逻辑词不要全部自动 fixed。
  // 只有比较长、明显作为句子线索的逻辑短语才 fixed。
  const strongLogicAnchors = new Set([
    "however",
    "therefore",
    "instead",
    "even though",
    "as long as",
    "so that",
    "rather than",
    "not only",
    "but also",
    "on the other hand",
    "as a result",
  ]);

  if (strongLogicAnchors.has(normalized)) return true;

  return false;
}




const nounPhraseStarters = new Set([
  "a",
  "an",
  "the",
  "any",
  "some",
  "this",
  "that",
  "these",
  "those",
  "my",
  "your",
  "his",
  "her",
  "our",
  "their",
]);

const commonAdjectives = new Set([
  "old",
  "new",
  "good",
  "great",
  "important",
  "different",
  "available",
  "assigned",
  "quiet",
  "public",
  "private",
  "main",
  "major",
  "final",
  "first",
  "last",
  "next",
  "same",
  "local",
  "academic",
  "specific",
  "useful",
]);

function isLikelyNounPhrase(words, index) {
  const current = words[index]?.toLowerCase();
  const next = words[index + 1]?.toLowerCase();
  const third = words[index + 2]?.toLowerCase();

  if (!current || !next) return false;

  // any assistance / some data / the cabins / a copy
  if (nounPhraseStarters.has(current)) {
    // the old city / a different department
    if (third && commonAdjectives.has(next)) {
      return 3;
    }

    return 2;
  }

  // old city / quiet area / different department
  if (commonAdjectives.has(current)) {
    return 2;
  }

  return false;
}

function splitWordsIntoChunks(words) {
  const chunks = [];
  let index = 0;

  const beVerbs = new Set(["am", "is", "are", "was", "were", "be", "been", "being"]);
  const modalVerbs = new Set(["can", "could", "may", "might", "will", "would", "should", "must"]);
  const whWords = new Set(["what", "when", "where", "why", "how", "whether", "if", "which", "who", "whom", "whose"]);
  const prepositions = new Set([
    "in",
    "on",
    "at",
    "by",
    "for",
    "with",
    "from",
    "to",
    "of",
    "about",
    "among",
    "between",
    "during",
    "before",
    "after",
    "without",
    "within",
    "through",
  ]);

  while (index < words.length) {
    const current = words[index]?.toLowerCase();
    const next = words[index + 1]?.toLowerCase();
    const third = words[index + 2]?.toLowerCase();

    if (!current) {
      index += 1;
      continue;
    }

    // wh-word / 从句引导词单独成块：why / whether / how / where
    // 这样可以明确考宾语从句或嵌入问句结构。
    if (whWords.has(current)) {
      chunks.push(words[index]);
      index += 1;
      continue;
    }

    // 介词单独成块：among / with / in / for
    // 不要总是绑成 among students，否则介词位置判断就被弱化了。
    if (prepositions.has(current)) {
      chunks.push(words[index]);
      index += 1;
      continue;
    }

    // be + V-ing / be + Ved：are becoming / was assigned
    if (
      beVerbs.has(current) &&
      next &&
      (next.endsWith("ing") || next.endsWith("ed"))
    ) {
      chunks.push(words.slice(index, index + 2).join(" "));
      index += 2;
      continue;
    }

    // modal + verb：could explain / should consider
    if (modalVerbs.has(current) && next) {
      chunks.push(words.slice(index, index + 2).join(" "));
      index += 2;
      continue;
    }

    // more / less + adjective：more popular / less expensive
    if ((current === "more" || current === "less") && next) {
      chunks.push(words.slice(index, index + 2).join(" "));
      index += 2;
      continue;
    }

    // not only / but also 这种固定结构单独保留
    if (current === "not" && next === "only") {
      chunks.push("not only");
      index += 2;
      continue;
    }

    if (current === "but" && next === "also") {
      chunks.push("but also");
      index += 2;
      continue;
    }

    // adjective + noun：local museums / public libraries
    // 但不要把介词 + 名词绑起来。
    if (commonAdjectives.has(current) && next) {
      chunks.push(words.slice(index, index + 2).join(" "));
      index += 2;
      continue;
    }

    // article / determiner + noun：the article / a copy
    // 这个可以保留为自然短语。
    if (nounPhraseStarters.has(current) && next) {
      // the local museums / a different department
      if (third && commonAdjectives.has(next)) {
        chunks.push(words.slice(index, index + 3).join(" "));
        index += 3;
        continue;
      }

      chunks.push(words.slice(index, index + 2).join(" "));
      index += 2;
      continue;
    }

    chunks.push(words[index]);
    index += 1;
  }

  return chunks.map(cleanChunk).filter(Boolean);
}

function getDifficultySentenceConfig(level) {
  if (level === "Hard") {
    return {
      targetWordMin: 8,
      targetWordMax: 9,
      desiredBlankMin: 7,
      desiredBlankMax: 8,
      maxFixedAnchors: 2,
      maxWordsPerBlank: 3,
    };
  }

  if (level === "Medium") {
    return {
      targetWordMin: 6,
      targetWordMax: 7,
      desiredBlankMin: 6,
      desiredBlankMax: 7,
      maxFixedAnchors: 1,
      maxWordsPerBlank: 3,
    };
  }

  return {
    targetWordMin: 5,
    targetWordMax: 6,
    desiredBlankMin: 4,
    desiredBlankMax: 5,
    maxFixedAnchors: 1,
    maxWordsPerBlank: 3,
  };
}
function isPunctuationOnlyText(text) {
  return /^[,.;:!?，。！？；：]+$/.test(String(text || "").trim());
}

function countBlankParts(parts) {
  return parts.filter((part) => part.type === "blank").length;
}

function countMeaningfulFixedParts(parts) {
  return parts.filter((part) => {
    if (part.type !== "fixed") return false;
    const text = String(part.text || "").trim();
    return text.length > 1 && !isPunctuationOnlyText(text);
  }).length;
}


function buildPartsFromTarget(target, level = "Medium") {
  const punctuation = getEndPunctuation(target);
  const sentenceWithoutPunctuation = removeEndPunctuation(target);

  const words = sentenceWithoutPunctuation
    .split(/\s+/)
    .map(cleanWord)
    .filter(Boolean);

  if (words.length === 0) {
    return [
      { type: "blank", answer: "i" },
      { type: "blank", answer: "am" },
      { type: "blank", answer: "not" },
      { type: "blank", answer: "sure" },
      { type: "fixed", text: "." },
    ];
  }

  const config = getDifficultySentenceConfig(level);
  const chunks = splitWordsIntoChunks(words);

  const parts = chunks.map((chunk) => {
    if (shouldPreferFixed(chunk)) {
      return {
        type: "fixed",
        text: chunk,
      };
    }

    return {
      type: "blank",
      answer: chunk,
    };
  });

  function getBlankIndexes() {
    return parts
      .map((part, index) => (part.type === "blank" ? index : -1))
      .filter((index) => index !== -1);
  }

  function getFixedIndexes() {
    return parts
      .map((part, index) => (part.type === "fixed" ? index : -1))
      .filter((index) => index !== -1);
  }

  function convertBlankToFixed(index) {
    if (!parts[index] || parts[index].type !== "blank") return;

    parts[index] = {
      type: "fixed",
      text: parts[index].answer,
    };
  }

  function convertFixedToBlank(index) {
    if (!parts[index] || parts[index].type !== "fixed") return;

    const text = parts[index].text;

    if (isPunctuationOnlyText(text)) return;

    parts[index] = {
      type: "blank",
      answer: text,
    };
  }

  function getPartWordCount(part) {
    const text = part.type === "blank" ? part.answer : part.text;

    return String(text || "")
      .split(/\s+/)
      .filter(Boolean).length;
  }

  function mergeNeighborBlanks() {
    const blankIndexes = getBlankIndexes();
    if (blankIndexes.length < 2) return false;
    const maxWordsPerBlank = config.maxWordsPerBlank || 3;
    const blockedMergeWords = new Set([
      "that",
      "which",
      "who",
      "where",
      "when",
      "why",
      "whether",
      "if",
      "because",
      "although",
      "since",
      "while",
    ]);

    for (let i = 0; i < blankIndexes.length - 1; i += 1) {
      const first = blankIndexes[i];
      const second = blankIndexes[i + 1];
      if (second !== first + 1) continue;
      const firstClean = cleanChunk(parts[first].answer);
      const secondClean = cleanChunk(parts[second].answer);
      if (blockedMergeWords.has(firstClean) || blockedMergeWords.has(secondClean)) {
        continue;
      }
      const mergedAnswer = `${parts[first].answer} ${parts[second].answer}`;
      const mergedWordCount = mergedAnswer
        .split(/\s+/)
        .filter(Boolean).length;

      if (mergedWordCount > maxWordsPerBlank) continue;

      parts[first] = {
        type: "blank",
        answer: mergedAnswer,
      };

      parts.splice(second, 1);
      return true;
    }

    return false;
  }

  // 1. 句首如果是自然短语，可以固定，类似真题中的 The textbook ____。
  if (parts.length >= 5 && parts[0].type === "blank") {
    const firstText = parts[0].answer;
    const firstWordCount = cleanChunk(firstText).split(/\s+/).length;

    if (firstWordCount <= 2) {
      convertBlankToFixed(0);
    }
  }

  // 2. 句尾如果是真题常见给定短语，可以固定。
  const endingFixedCandidates = new Set([
    "for me",
    "for us",
    "in class",
    "after class",
    "at the library",
    "on campus",
    "near the school",
    "during exams",
    "before class",
    "after school",
  ]);

  const blankIndexesForEnding = getBlankIndexes();
  const lastBlankIndex =
    blankIndexesForEnding[blankIndexesForEnding.length - 1];

  if (
    lastBlankIndex !== undefined &
    endingFixedCandidates.has(cleanChunk(parts[lastBlankIndex].answer))    ) {
  convertBlankToFixed(lastBlankIndex);
}

  // 3. 如果有逗号，逗号前后不能全靠盲猜，保留自然线索。
  if (sentenceWithoutPunctuation.includes(",")) {
    const beforeCommaText = sentenceWithoutPunctuation.split(",")[0].trim();
    const beforeCommaWordCount = beforeCommaText
      .split(/\s+/)
      .filter(Boolean).length;

    let runningWordCount = 0;
    let beforeCommaPartIndex = -1;
    let afterCommaPartIndex = -1;

    for (let i = 0; i < parts.length; i += 1) {
      const text =
        parts[i].type === "blank" ? parts[i].answer : parts[i].text;

      const wordCount = String(text || "")
        .split(/\s+/)
        .filter(Boolean).length;

      if (runningWordCount < beforeCommaWordCount) {
        beforeCommaPartIndex = i;
      }

      if (
        runningWordCount >= beforeCommaWordCount &&
        afterCommaPartIndex === -1
      ) {
        afterCommaPartIndex = i;
      }

      runningWordCount += wordCount;
    }

    if (beforeCommaPartIndex >= 0) {
      convertBlankToFixed(beforeCommaPartIndex);
    }

    if (afterCommaPartIndex >= 0) {
      convertBlankToFixed(afterCommaPartIndex);
    }
  }

  while (countMeaningfulFixedParts(parts) > config.maxFixedAnchors) {
    const fixedIndexes = getFixedIndexes();

    const convertibleFixedIndex = fixedIndexes.find((index) => {
      const text = parts[index].text;
      const cleaned = cleanChunk(text);

      if (isPunctuationOnlyText(text)) return false;

      const protectedFixed = new Set([
        "for me",
        "for us",
        "that is",
        "there is",
        "there are",
        "in class",
        "on campus",
        "during exams",
      ]);

      if (protectedFixed.has(cleaned)) return false;

      return true;
    });

    if (convertibleFixedIndex === undefined) break;

    convertFixedToBlank(convertibleFixedIndex);
  }


  // 5. 空太多就合并 blank，控制在 5–7 左右。
  while (countBlankParts(parts) > config.desiredBlankMax) {
    if (!mergeNeighborBlanks()) break;
  }

  // 6. 空太少时，只把不重要 fixed 转回 blank。
  while (countBlankParts(parts) < config.desiredBlankMin) {
    const fixedIndexes = getFixedIndexes();

    const convertibleFixedIndex = fixedIndexes.find((index) => {
      const text = parts[index].text;

      return (
        !shouldPreferFixed(text) &&
        !isPunctuationOnlyText(text) &&
        String(text || "").trim().length > 2
      );
    });

    if (convertibleFixedIndex === undefined) break;

    convertFixedToBlank(convertibleFixedIndex);
  }

  parts.push({
    type: "fixed",
    text: punctuation,
  });

  return parts;
}
function getChunksFromParts(parts) {
  return parts
    .filter((part) => part.type === "blank")
    .map((part) => cleanChunk(part.answer))
    .filter(Boolean);
}

function normalizeQuestion(question, index, level, topic) {
  const target =
    typeof question.target === "string" && question.target.trim()
      ? question.target.trim()
      : "I am not sure about it yet.";

  const parts = buildPartsFromTarget(target, level);
  const chunks = getChunksFromParts(parts);

  return {
    id: index + 1,
    level: question.level || level,
    topic: question.topic || topic,
    relationType: question.relationType || "question-answer",
    contextSpeaker: "A",
    contextSentence:
      question.contextSentence ||
      "What was the main point of the conversation?",
    answerSpeaker: "B",
    target,
    parts,
    chunks,
    explanation:
      question.explanation ||
      "This question tests sentence structure and logical connection between two speakers.",
  };
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

    const {
      count = 5,
      level = "Medium",
      topic = "Mixed",
      randomSeed,
      chargePoints = true,
      excludeTargets = [],
      designRules = {},
    } = req.body || {};

    currentDesignRules = designRules || {};

    const requestedCount = Number(count) || 5;
    const generatedCount = requestedCount + 3;
    const seed =
      randomSeed || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const prompt = `
You are a TOEFL Build a Sentence exercise generator.

Generate ${generatedCount} TOEFL-style A/B dialogue sentence-building questions.

Important:
You only need to generate Speaker A's context sentence, Speaker B's full target sentence, and the explanation.
Do not decide blanks.
Do not create word banks.
The website will automatically split the B sentence into blanks.

The exercise is NOT a translation task.
It is a dialogue sentence-building task.

Good style examples:

Example 1:
A: What was the highlight of your trip?
B target: The tour guides who showed us around the old city were fantastic.

Example 2:
A: I heard Anna got a promotion.
B target: Do you know if she will be moving to a different department?

Example 3:
A: We're planning a trip to the mountains next weekend.
B target: Can you tell me whether the cabins will be available?

Example 4:
A: What did Maria ask you about the book you're reading?
B target: She wanted to know where she could buy a copy.

Random seed: ${seed}

Important:
- Generate ${count} completely new questions.
- Do not reuse any of these target sentences:
${Array.isArray(excludeTargets) ? excludeTargets.join("\n") : ""}
- Do not copy the examples.
- Each question must have a different context, target sentence, and word bank.

Rules:
1. Speaker A should provide a natural dialogue context.
2. Speaker B's target sentence should be a natural response.
3. Difficulty is based mainly on the complexity of the target sentence, not on the number of blanks.
4. B target length and complexity should match the selected difficulty:
   - Easy: 4 to 6 words. Use simple but natural responses.
   - Medium: 5 to 7 words. Use useful collocations, embedded questions, or simple relative clauses.
   - Hard: 8 to 10 words. Use compact but more complex structures, such as relative clauses, embedded questions, comparisons, or cause-effect phrases.
5. For Hard difficulty, prefer compact sentences that can naturally be divided into 7 to 8 short blanks.
6. Do not generate target sentences longer than 15 words.
7. Avoid long clauses that would force many words into one blank.
8. Avoid unnecessary adverbs like usually, often, actually, also, or generally unless they are essential to the meaning.
9. Prefer sentence structures where each word or short phrase has a clear position.
10. Some words or phrases may remain fixed only when they naturally help the student infer the sentence.
11. Do not force fixed words into the middle of every sentence.
12. Do not make the sentence all blanks except punctuation.
13. Avoid childish, mechanical, or overly repetitive responses.
14. Avoid responses that simply repeat Speaker A's wording without adding a natural answer.
15. Do not include Chinese.
16. Do not include markdown.
17. Make every question different in topic and sentence pattern.

Selected difficulty: ${level}
Selected topic: ${topic}

For each question, also include a hidden field called "knowledgeCategory".

The value of "knowledgeCategory" must be exactly one of:
从句, 短语搭配, 连词使用, 句型结构, 时态一致.

Choose the category based on the main grammar or expression point tested by the sentence.

Do not show this field to the student. It should only appear in the JSON output.

Each question must follow this JSON structure:
{
  "id": number,
  "contextSpeaker": "A",
  "contextSentence": string,
  "answerSpeaker": "B",
  "target": string,
  "parts": [
    { "type": "fixed", "text": string },
    { "type": "blank", "answer": string }
  ],
  "chunks": string[],
  "explanation": string,
  "knowledgeCategory": "从句"
}

Return valid JSON only.

Return this exact JSON structure:
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
      "target": "The tour guides who showed us around the old city were fantastic.",
      "explanation": "A asks about the highlight of the trip. B answers with a noun phrase followed by a relative clause.",
      "knowledgeCategory": "从句"
    }
  ]
}
`;

    const { response, modelUsed } = await generateContentWithModelFallback(ai, {
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.8,
      },
    });

    console.log("Generate sentences model used:", modelUsed);

    const text = response.text || "";

    if (!text) {
      throw new Error("Gemini returned empty response");
    }

    const json = JSON.parse(text);

    if (!Array.isArray(json.questions)) {
      throw new Error("Gemini response does not contain questions array");
    }

    const cleanedQuestions = json.questions.map((question, index) =>
      normalizeQuestion(question, index, level, topic)
    );

    const finalQuestions = cleanedQuestions.slice(0, requestedCount);

    if (finalQuestions.length < requestedCount) {
      throw new Error(
        `Gemini only generated ${finalQuestions.length} usable questions, but ${requestedCount} were requested`
      );
    }

    currentDesignRules = {};

    const { balance } = chargePoints
      ? await chargeRequestAfterSuccess(
          req,
          SENTENCE_PROMPT_COST,
          "Build a Sentence practice"
        )
      : { balance: undefined };

    return res.status(200).json({
      questions: finalQuestions,
      balance,
    });


    } catch (error) {
      console.error("generate-sentences error:", error);
      currentDesignRules = {};

      return res.status(error.statusCode || 500).json({
        error: error?.message || "Failed to generate questions",
        balance: error.balance,
        cost: error.cost,
      });
    }
}
