const ALLOWED_FIVE_POINT_SCORES = new Set([
  0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5,
]);

export function validateFivePointScore(score, label = "score") {
  const value = Number(score);

  if (!Number.isFinite(value) || !ALLOWED_FIVE_POINT_SCORES.has(value)) {
    throw new Error(
      `Invalid ${label}: expected one of 0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5.`
    );
  }

  return value;
}

export function formatFivePointScore(score) {
  return `${validateFivePointScore(score).toFixed(1)} / 5.0`;
}

export function extractFivePointScore(scoreText) {
  const match = String(scoreText || "").match(/\d+(?:\.\d+)?/);
  if (!match) return 0;
  return validateFivePointScore(Number(match[0]));
}

export function applyMinimumLengthCap(score, wordCount, thresholds) {
  const value = validateFivePointScore(score);
  const cap = thresholds.find((item) => wordCount < item.words)?.cap;

  return cap === undefined ? value : Math.min(value, cap);
}

export function calculateWritingRawScore({
  sentenceScore,
  emailScore,
  discussionScore,
}) {
  const sentence = Number(sentenceScore);
  const email = validateFivePointScore(emailScore, "email score");
  const discussion = validateFivePointScore(discussionScore, "discussion score");

  if (!Number.isFinite(sentence) || sentence < 0 || sentence > 10) {
    throw new Error("Invalid sentence score: expected a number from 0 to 10.");
  }

  return sentence + email + discussion;
}

function roundToHalfBand(score) {
  return Math.round(score * 2) / 2;
}

function getSentenceDeduction(sentenceScore) {
  const sentence = Number(sentenceScore);

  if (!Number.isFinite(sentence) || sentence < 0 || sentence > 10) {
    throw new Error("Invalid sentence score: expected a number from 0 to 10.");
  }

  if (sentence >= 10) return 0;
  if (sentence >= 9) return 0.5;
  if (sentence >= 8) return 1;
  if (sentence >= 7) return 1.5;
  if (sentence >= 6) return 2;
  if (sentence >= 5) return 2.5;
  if (sentence >= 4) return 3;
  if (sentence >= 3) return 3.5;
  return 4;
}

function getEssayDeduction(emailScore, discussionScore) {
  const email = validateFivePointScore(emailScore, "email score");
  const discussion = validateFivePointScore(discussionScore, "discussion score");
  const essayModuleScore = email + discussion;

  if (essayModuleScore >= 9) return 0;
  if (essayModuleScore >= 7.5) return 0.5;
  if (essayModuleScore >= 6.5) return 1;
  if (essayModuleScore >= 5.5) return 1.5;
  if (essayModuleScore >= 4.5) return 2;
  if (essayModuleScore >= 3.5) return 2.5;
  if (essayModuleScore >= 2.5) return 3;
  if (essayModuleScore >= 1.5) return 3.5;
  return 4;
}

export function getEstimatedWritingScore({
  sentenceScore,
  emailScore,
  discussionScore,
}) {
  const sentenceDeduction = getSentenceDeduction(sentenceScore);
  const essayDeduction = getEssayDeduction(emailScore, discussionScore);
  const totalDeduction = Math.min(5, sentenceDeduction + essayDeduction);
  const estimatedScore = Math.max(1, 6 - totalDeduction);

  return roundToHalfBand(estimatedScore);
}

export function calculateFinalWritingScore({
  sentenceScore,
  emailScore,
  discussionScore,
}) {
  const rawScore = calculateWritingRawScore({
    sentenceScore,
    emailScore,
    discussionScore,
  });
  const estimatedScore = getEstimatedWritingScore({
    sentenceScore,
    emailScore,
    discussionScore,
  });

  return {
    rawScore,
    estimatedScore,
  };
}
