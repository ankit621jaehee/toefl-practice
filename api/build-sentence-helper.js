import { generateContentWithModelFallback } from "./gemini-helper.js";

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

function shouldPreferFixed(chunk) {
  const normalized = cleanChunk(chunk);

  if (!normalized) return false;
  if (normalized.length <= 2) return false;

  if (flexibleOrAmbiguousChunks.has(normalized)) return true;

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

  return strongLogicAnchors.has(normalized);
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

    if (whWords.has(current)) {
      chunks.push(words[index]);
      index += 1;
      continue;
    }

    if (prepositions.has(current)) {
      chunks.push(words[index]);
      index += 1;
      continue;
    }

    if (
      beVerbs.has(current) &&
      next &&
      (next.endsWith("ing") || next.endsWith("ed"))
    ) {
      chunks.push(words.slice(index, index + 2).join(" "));
      index += 2;
      continue;
    }

    if (modalVerbs.has(current) && next) {
      chunks.push(words.slice(index, index + 2).join(" "));
      index += 2;
      continue;
    }

    if ((current === "more" || current === "less") && next) {
      chunks.push(words.slice(index, index + 2).join(" "));
      index += 2;
      continue;
    }

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

    if (commonAdjectives.has(current) && next) {
      chunks.push(words.slice(index, index + 2).join(" "));
      index += 2;
      continue;
    }

    if (nounPhraseStarters.has(current) && next) {
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
      desiredBlankMin: 7,
      desiredBlankMax: 8,
      maxFixedAnchors: 2,
      maxWordsPerBlank: 3,
    };
  }

  if (level === "Medium") {
    return {
      desiredBlankMin: 6,
      desiredBlankMax: 7,
      maxFixedAnchors: 1,
      maxWordsPerBlank: 3,
    };
  }

  return {
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
      return { type: "fixed", text: chunk };
    }

    return { type: "blank", answer: chunk };
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
    parts[index] = { type: "fixed", text: parts[index].answer };
  }

  function convertFixedToBlank(index) {
    if (!parts[index] || parts[index].type !== "fixed") return;
    const text = parts[index].text;
    if (isPunctuationOnlyText(text)) return;
    parts[index] = { type: "blank", answer: text };
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
      const mergedWordCount = mergedAnswer.split(/\s+/).filter(Boolean).length;

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

  if (parts.length >= 5 && parts[0].type === "blank") {
    const firstText = parts[0].answer;
    const firstWordCount = cleanChunk(firstText).split(/\s+/).length;

    if (firstWordCount <= 2) {
      convertBlankToFixed(0);
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

      return !protectedFixed.has(cleaned);
    });

    if (convertibleFixedIndex === undefined) break;

    convertFixedToBlank(convertibleFixedIndex);
  }

  while (countBlankParts(parts) > config.desiredBlankMax) {
    if (!mergeNeighborBlanks()) break;
  }

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

function normalizeSentenceQuestion(question, index, level, topic) {
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
    knowledgeCategory: question.knowledgeCategory || "句型结构",
  };
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Gemini returned invalid JSON: ${String(text).slice(0, 300)}`);
  }
}

export async function generateBuildSentenceQuestions({
  ai,
  count = 5,
  level = "Medium",
  topic = "Mixed",
  randomSeed,
  excludeTargets = [],
}) {
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
- Generate ${generatedCount} completely new questions.
- Do not reuse any of these target sentences:
${Array.isArray(excludeTargets) ? excludeTargets.join("\n") : ""}
- Do not copy the examples.
- Each question must have a different context and target sentence.

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
10. Do not make the sentence all blanks except punctuation.
11. Avoid childish, mechanical, or overly repetitive responses.
12. Avoid responses that simply repeat Speaker A's wording without adding a natural answer.
13. Do not include Chinese.
14. Do not include markdown.
15. Make every question different in topic and sentence pattern.

Selected difficulty: ${level}
Selected topic: ${topic}

For each question, include a hidden field called "knowledgeCategory".

The value of "knowledgeCategory" must be exactly one of:
从句, 短语搭配, 连词使用, 句型结构, 时态一致.

Choose the category based on the main grammar or expression point tested by the sentence.

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

  console.log("Build sentence model used:", modelUsed);

  const text = response.text || "";

  if (!text.trim()) {
    throw new Error("Gemini returned empty response");
  }

  const json = safeJsonParse(text);

  if (!Array.isArray(json.questions)) {
    throw new Error("Gemini response does not contain questions array");
  }

  const cleanedQuestions = json.questions.map((question, index) =>
    normalizeSentenceQuestion(question, index, level, topic)
  );

  const finalQuestions = cleanedQuestions.slice(0, requestedCount);

  if (finalQuestions.length < requestedCount) {
    throw new Error(
      `Gemini only generated ${finalQuestions.length} usable questions, but ${requestedCount} were requested`
    );
  }

  return finalQuestions;
}