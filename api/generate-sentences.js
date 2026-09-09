import { GoogleGenAI } from "@google/genai";
import { generateContentWithModelFallback } from "../lib/gemini-helper.js";
import { chargeRequestAfterSuccess } from "../lib/points.js";

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


function buildPartsFromTargetLegacy(target, level = "Medium") {
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

  // 1. 句首如果是自然短语，可以固定，类似 Official Questions 中的 The textbook ____。
  if (parts.length >= 5 && parts[0].type === "blank") {
    const firstText = parts[0].answer;
    const firstWordCount = cleanChunk(firstText).split(/\s+/).length;

    if (firstWordCount <= 2) {
      convertBlankToFixed(0);
    }
  }

  // 2. 句尾如果是 Official Questions 中常见的给定短语，可以固定。
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

const pastExamDeterminers = new Set([
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

const pastExamPronouns = new Set([
  "i",
  "you",
  "he",
  "she",
  "it",
  "we",
  "they",
  "me",
  "him",
  "her",
  "us",
  "them",
]);

const pastExamAuxiliaries = new Set([
  "am",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
  "can",
  "could",
  "may",
  "might",
  "will",
  "would",
  "should",
  "must",
]);

const pastExamPrepositions = new Set([
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

const pastExamClauseWords = new Set([
  "that",
  "which",
  "who",
  "whom",
  "whose",
  "what",
  "when",
  "where",
  "why",
  "how",
  "whether",
  "if",
  "because",
  "although",
  "since",
  "while",
  "unless",
]);

const pastExamPhrasePairs = new Set([
  "a lot",
  "able to",
  "according to",
  "be able",
  "find out",
  "going to",
  "how long",
  "how much",
  "in order",
  "kind of",
  "make sure",
  "need to",
  "not only",
  "plan to",
  "planning to",
  "rather than",
  "such as",
  "supposed to",
  "used to",
  "wanted to",
]);

const pastExamLowInformationWords = new Set([
  ...pastExamDeterminers,
  ...pastExamPronouns,
  ...pastExamAuxiliaries,
  ...pastExamPrepositions,
  ...pastExamClauseWords,
  "and",
  "or",
  "but",
  "not",
]);

function getPastExamBlankCount(wordCount) {
  if (wordCount <= 4) return Math.max(2, wordCount - 1);
  if (wordCount <= 6) return 4;
  if (wordCount <= 8) return 5;
  if (wordCount <= 10) return 6;
  return 7;
}

function tokenizePastExamTarget(target) {
  return (
    String(target || "").match(/[A-Za-z0-9]+(?:[-'’][A-Za-z0-9]+)*|[,;:]/g) ||
    []
  );
}

function scorePastExamPair(leftUnit, rightUnit, pairIndex, unitCount) {
  if (
    leftUnit.type !== "words" ||
    rightUnit.type !== "words" ||
    leftUnit.words.length + rightUnit.words.length > 2
  ) {
    return -Infinity;
  }

  const left = cleanChunk(leftUnit.words.join(" "));
  const right = cleanChunk(rightUnit.words.join(" "));
  const pair = `${left} ${right}`;
  const rightWord = rightUnit.words[0]?.toLowerCase() || "";
  let score = 20 - Math.abs(pairIndex + 0.5 - unitCount / 2);

  if (pastExamPhrasePairs.has(pair)) score += 120;
  if (left === "to") score += 100;
  if (
    ["ask", "asked", "know", "knew", "wonder", "wondered"].includes(left) &&
    pastExamClauseWords.has(right)
  ) {
    score += 115;
  }
  if (pastExamPrepositions.has(left) && pastExamDeterminers.has(right)) {
    score += 90;
  }
  if (pastExamAuxiliaries.has(left) && pastExamPronouns.has(right)) {
    score += 85;
  }
  if (pastExamPronouns.has(left) && pastExamAuxiliaries.has(right)) {
    score += 80;
  }
  if (pastExamAuxiliaries.has(left) && pastExamDeterminers.has(right)) {
    score += 70;
  }
  if (pastExamClauseWords.has(left) && !pastExamClauseWords.has(right)) {
    score += 75;
  }
  if (pastExamDeterminers.has(left) && !pastExamLowInformationWords.has(right)) {
    score += 55;
  }
  if (
    ["am", "is", "are", "was", "were", "be", "been"].includes(left) &&
    (rightWord.endsWith("ed") || rightWord.endsWith("ing"))
  ) {
    score += 100;
  }
  if (
    !pastExamPronouns.has(left) &&
    !pastExamAuxiliaries.has(left) &&
    pastExamAuxiliaries.has(right)
  ) {
    score -= 80;
  }

  return score;
}

function mergePastExamTokens(tokens, desiredWordUnitCount) {
  const units = tokens.map((token) =>
    /^[,;:]$/.test(token)
      ? { type: "punctuation", text: token }
      : { type: "words", words: [token] }
  );

  const countWordUnits = () =>
    units.filter((unit) => unit.type === "words").length;

  while (countWordUnits() > desiredWordUnitCount) {
    let bestIndex = -1;
    let bestScore = -Infinity;

    for (let index = 0; index < units.length - 1; index += 1) {
      const score = scorePastExamPair(
        units[index],
        units[index + 1],
        index,
        units.length
      );
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    if (bestIndex < 0) break;

    units.splice(bestIndex, 2, {
      type: "words",
      words: [...units[bestIndex].words, ...units[bestIndex + 1].words],
    });
  }

  return units;
}

function getPastExamFixedAnchorCount(wordCount) {
  if (wordCount < 3) return 0;

  // Each eligible question independently receives 0, 1, or 2 fixed anchors.
  // All three outcomes have the same probability; a ten-question set therefore
  // has natural variation instead of a preset quota or repeating pattern.
  return Math.floor(Math.random() * 3);
}

function getPastExamFixedAnchorIndexes(units, desiredCount) {
  if (desiredCount <= 0) return [];

  const wordUnitIndexes = units
    .map((unit, index) => (unit.type === "words" ? index : -1))
    .filter((index) => index >= 0);
  if (wordUnitIndexes.length < 3) return [];

  const center = (units.length - 1) / 2;
  const rankedIndexes = wordUnitIndexes
    .map((index) => {
      const words = units[index].words.map((word) => word.toLowerCase());
      const normalized = cleanChunk(words.join(" "));
      let score = 30 - Math.abs(index - center) * 3;

      if (flexibleOrAmbiguousChunks.has(normalized)) score += 100;
      if (words.some((word) => !pastExamLowInformationWords.has(word))) score += 55;
      if (words.every((word) => pastExamLowInformationWords.has(word))) score -= 80;
      if (words.length === 2) score += 8;
      if (pastExamPhrasePairs.has(normalized)) score -= 70;
      if (
        words.some(
          (word) =>
            pastExamAuxiliaries.has(word) ||
            pastExamClauseWords.has(word) ||
            pastExamPrepositions.has(word)
        )
      ) {
        score -= 35;
      }
      if (index === wordUnitIndexes[0] || index === wordUnitIndexes.at(-1)) {
        score -= 8;
      }

      return { index, score };
    })
    .sort((left, right) => right.score - left.score);

  const selected = [];
  for (const candidate of rankedIndexes) {
    if (selected.some((index) => Math.abs(index - candidate.index) <= 1)) {
      continue;
    }
    selected.push(candidate.index);
    if (selected.length >= desiredCount) break;
  }

  if (selected.length < desiredCount) {
    for (const candidate of rankedIndexes) {
      if (selected.includes(candidate.index)) continue;
      selected.push(candidate.index);
      if (selected.length >= desiredCount) break;
    }
  }

  return selected;
}

// 目标句的固定提示数量不使用组内配额：每道题独立、等概率地选择
// 0、1 或 2 个固定词/词块，避免每组十题重复同一种固定模式。
export function buildPartsFromTarget(target) {
  const punctuation = getEndPunctuation(target);
  const tokens = tokenizePastExamTarget(removeEndPunctuation(target));
  const wordCount = tokens.filter((token) => !/^[,;:]$/.test(token)).length;

  if (wordCount === 0) {
    return buildPartsFromTargetLegacy("I am not sure.", "Easy");
  }

  const desiredBlankCount = getPastExamBlankCount(wordCount);
  const desiredFixedAnchorCount = getPastExamFixedAnchorCount(wordCount);
  const desiredWordUnitCount = Math.min(
    wordCount,
    desiredBlankCount + desiredFixedAnchorCount
  );
  const units = mergePastExamTokens(tokens, desiredWordUnitCount);
  const fixedAnchorIndexes = new Set(
    getPastExamFixedAnchorIndexes(units, desiredFixedAnchorCount)
  );
  const parts = units.map((unit, index) => {
    if (unit.type === "punctuation") {
      return { type: "fixed", text: unit.text };
    }

    const text = unit.words.join(" ");
    return fixedAnchorIndexes.has(index)
      ? { type: "fixed", text }
      : { type: "blank", answer: text };
  });

  parts.push({ type: "fixed", text: punctuation });
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

  const parts = buildPartsFromTarget(target);
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
      count = 10,
      level = "Medium",
      topic = "Mixed",
      randomSeed,
      chargePoints = true,
      excludeTargets = [],
      designRules = {},
    } = req.body || {};

    currentDesignRules = designRules || {};

    const requestedCount = Number(count) || 10;
    const generatedCount = requestedCount + 3;
    const seed =
      randomSeed || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const prompt = `
You are the question-generation engine for FORGE Build a Sentence practice.

Generate ${generatedCount} original TOEFL-style Build a Sentence questions.

For each question, generate ONLY:
1. Speaker A's context sentence
2. Speaker B's complete target sentence
3. a brief explanation of the main language structure

The application will create blanks, fixed text, and draggable chunks separately.
Do NOT generate or describe the sentence arrangement.

The application independently assigns 0, 1, or 2 in-sentence fixed anchors to
each question. All three fixed-anchor counts have exactly the same probability.
Do not assume that every item will receive a fixed word, and do not design the
batch around a preset quota or repeating fixed-anchor pattern.
Therefore, each target must remain naturally and uniquely orderable even when
the learner receives no in-sentence fixed word as a clue.

Selected difficulty: ${level}
Selected topic: ${topic}
Random seed: ${seed}

====================
CURRENT FORGE BANK PROFILE
====================

Use this measured profile of the current published FORGE sentence bank as the
calibration target. These are set-level tendencies, not rigid quotas for every
individual question:

- The bank contains 567 published sentence questions across Official Questions and ETS Mock.
- The median target length is 9 words; the middle half is 8-11 words.
- Most questions become 4-7 draggable chunks after phrase-aware chunking.
- About 4 of every 10 targets are questions; about 6 are statements.
- Speaker A asks a question in roughly 6 of every 10 conversations and gives a
  statement, plan, or situation in the others.
- Clause words appear regularly, but direct responses remain common.
- Embedded-question frames and relative-clause structures each occur in roughly
  2 of every 10 questions.
- Present-perfect, modal, infinitive, gerund/participle, passive, and negative
  structures recur across a set, often with categories overlapping naturally.

For each group of approximately 10 generated questions, aim for:
- 4 target questions and 6 target statements
- 5-7 Speaker A questions and 3-5 Speaker A statements or situations
- at least 4 targets with a meaningful clause dependency
- about 2 embedded-question targets, but no repeated opening frame
- about 2 relative-clause targets
- about 2 present-perfect targets
- about 2 modal targets
- at least 1 passive target
- about 2 negative targets
- several direct, structurally simple responses to balance the set

These categories may overlap. Do not force awkward grammar merely to satisfy a
count. Naturalness and a single clearly preferred word order take priority.

====================
STYLE
====================

Each item is a short A/B conversation.

Speaker A gives a natural question, comment, situation, or piece of information.
Speaker B responds with ONE complete sentence that logically continues the conversation.

The dialogue should resemble natural communication in university and everyday
student life rather than a traditional grammar exercise.

Common contexts include:
- classes, assignments, exams, and study
- professors, classmates, and group projects
- presentations, meetings, and workshops
- campus events, clubs, and activities
- libraries, offices, registration, and schedules
- technology and study resources
- internships, jobs, and interviews
- transportation, housing, food, and shopping
- appointments, plans, and social activities
- travel and study abroad

Most contexts should be university-related, but ordinary student-life situations
are also appropriate.

Keep vocabulary familiar and natural.
Do not use specialized knowledge, obscure words, literary language,
or unnecessarily formal academic English.

====================
TARGET SENTENCES
====================

Speaker B's target should be a concise, natural spoken sentence.

Most targets should be 8-11 words, centered around 9 words.
Occasional 5-7 word or 12-13 word targets are allowed when the structure calls
for them, but do not fill the set with unusually short or long sentences.

Never add words merely to increase difficulty.

Use both statements and questions.

The target should contain enough grammatical structure to make sentence
arrangement meaningful. Difficulty should come primarily from recognizing
relationships between words and phrases, not from difficult vocabulary.

Targets must support natural phrase-aware chunks. Common multiword units such as
"do you", "know if", "will be", "to find out", determiner+noun phrases,
verb complements, and short prepositional phrases may remain intact as one
draggable chunk. Do not write every target as a chain of isolated one-word units.

Authentic structures may include:
- direct yes/no or wh-questions
- embedded questions with if, whether, who, what, where, how, etc.
- noun clauses
- relative clauses, including omitted or reduced relatives
- simple past and present forms
- present perfect
- present continuous
- future and modal constructions
- passive constructions
- infinitives and gerunds
- negation
- comparison and coordination
- prepositional relationships
- common collocations and phrasal verbs

Use these naturally rather than treating them as a checklist.

====================
STYLE EXAMPLES
====================

The following examples illustrate the desired style and structural variety.
Use them only as style references. Do NOT copy, closely paraphrase,
or repeatedly reuse their sentence patterns.

Example 1 - Short / direct structure
A: Did anyone record the presentation?
B: Did someone record it?

Example 2 - Embedded question
A: Do you know what the interview will be like?
B: Do you know if it's a group or an individual interview?

Example 3 - More complex clause structure
A: What did she ask about your research?
B: She was curious about what resources we had used to find a solution.

These examples demonstrate the RANGE of authentic questions, not templates.
Generated questions should use a wider variety of structures than these examples.

====================
DIFFICULTY
====================

Easy:
Use a relatively direct sentence structure.
The learner should still need to recognize basic English word order,
verb forms, question structure, negation, or a common phrase.

Medium:
Use one meaningful grammatical dependency, such as an embedded question,
relative clause, tense relationship, passive structure, infinitive pattern,
or another structure requiring careful word order.

Hard:
Use stronger structural dependencies, such as a clause inside a larger
sentence, a relative or reduced clause, perfect/passive structure,
or two grammatical relationships interacting in one concise sentence.

Hard questions should NOT rely on rare vocabulary or excessive sentence length.

====================
VARIETY
====================

The generated set must feel like a real mixed question set rather than
variations of one template.

Vary:
- conversation situations
- sentence openings
- statements and questions
- grammatical structures
- tense and verb patterns
- subjects and sentence shapes
- whether the target begins with a pronoun, noun phrase, auxiliary, wh-word,
  time/reason phrase, or reporting frame

Embedded questions and relative clauses should appear regularly,
but no single structure should dominate the set.

In particular, avoid repeatedly using templates such as:
"Do you know if..."
"Do you know whether..."
"Can you tell me..."
"The ___ that..."

Within a 10-question set, do not use the same first three target words more than
once, and do not use more than two targets from the same narrow grammatical frame.

Do not create several questions by keeping the same sentence structure
and merely replacing names, objects, courses, places, or activities.

Some questions should be structurally simple.
Others should require more careful analysis.
Natural variation in difficulty is desirable.

====================
CONTEXT
====================

Speaker A and Speaker B must form a coherent conversation.

Speaker B must genuinely respond to what Speaker A says.

Use context to create meaningful relationships involving:
- reasons
- people or things being identified
- plans and intentions
- completed or unfinished actions
- requests for information
- uncertainty
- time and scheduling
- preferences
- problems and explanations
- recommendations
- availability
- past experiences

Pronouns must have clear references.
Tense and time expressions must be logically consistent.

Do not generate a generic Speaker A sentence merely to introduce an
unrelated grammar target.

====================
QUESTION QUALITY
====================

Design targets that work well as sentence-arrangement questions.

Prefer sentences where grammatical relationships strongly constrain word order.

Avoid sentences containing many freely movable adverbs or expressions that
could produce several equally natural arrangements.

Because some questions will have no in-sentence fixed anchor, avoid targets in
which two chunks can swap positions without changing grammar or meaning. Prefer
clear dependencies such as auxiliary-subject order, verb-complement order,
clause introducer + clause, determiner + noun phrase, or preposition + object.

Avoid unnecessary words such as:
usually, often, generally, actually, perhaps, probably, also

unless they are genuinely necessary to the meaning.

The intended sentence should be clearly preferable to alternative word orders.

Do not sacrifice natural English merely to force a unique arrangement.

====================
ORIGINALITY
====================

All questions must be original.

Do not reproduce or closely paraphrase known TOEFL questions.

Do not create a new question by simply changing names, nouns, locations,
courses, or other surface details in an existing question.

Do not reuse any of these previous targets:

${Array.isArray(excludeTargets) ? excludeTargets.join("\n") : ""}

Within the generated batch, avoid near-duplicate contexts or targets.

====================
FINAL CHECK
====================

Before returning an item, silently verify that:
- A and B form a natural conversation.
- B directly and logically responds to A.
- The target is grammatically correct and idiomatic.
- Vocabulary is appropriate for TOEFL learners.
- The sentence works naturally as an arrangement task.
- Word order is meaningfully constrained.
- The target would still have one clearly preferred order without relying on a
  fixed word placed in the middle of the sentence.
- Difficulty comes from structure rather than vocabulary.
- The item does not overuse a pattern already used in the batch.
- The item is not a paraphrase of another question.
- The explanation identifies the actual structure being tested.

If an item fails any check, replace it before returning the result.

====================
OUTPUT
====================

Return valid JSON only:

{
  "questions": [
    {
      "id": 1,
      "level": "${level}",
      "topic": "${topic}",
      "relationType": "question-answer",
      "contextSpeaker": "A",
      "contextSentence": "...",
      "answerSpeaker": "B",
      "target": "...",
      "explanation": "..."
    }
  ]
}

Return exactly ${generatedCount} questions.
Do not output markdown.
Do not output comments or additional text.
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

    const creditBalance = chargePoints
      ? await chargeRequestAfterSuccess(
          req,
          SENTENCE_PROMPT_COST,
          "Build a Sentence practice"
        )
      : {};

    return res.status(200).json({
      questions: finalQuestions,
      ...creditBalance,
    });


    } catch (error) {
      console.error("generate-sentences error:", error);
      currentDesignRules = {};

      return res.status(error.statusCode || 500).json({
        error: error?.message || "Failed to generate questions",
        balance: error.balance,
        temporaryBalance: error.temporaryBalance,
        permanentBalance: error.permanentBalance,
        cost: error.cost,
      });
    }
}
