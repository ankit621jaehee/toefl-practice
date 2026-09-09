export const WRITING_ABILITY_MODEL_VERSION = "writing-ability-v1";

export const MIN_WRITING_ABILITY_SAMPLES = 5;

export type WritingAbilityTaskType = "email" | "discussion";
export type WritingAbilityTrend = "STABLE" | "IMPROVING" | "DECLINING";
export type WritingAbilityStatus = "INSUFFICIENT_DATA" | "ACTIVE";

export type WritingAbilityDefinition = {
  skillKey: string;
  labelZh: string;
  labelEn: string;
};

export type WritingAbilityEntry = {
  taskType: WritingAbilityTaskType;
  createdAt: string;
  abilityScores: Record<string, number>;
};

export type WritingAbilityMetric = WritingAbilityDefinition & {
  stableScore: number;
  displayScore: number;
  sampleCount: number;
  trend: WritingAbilityTrend;
};

export type WritingAbilitySuggestion = {
  skillKey: string;
  labelZh: string;
  displayScore: number;
  suggestion: string;
};

export type WritingAbilityProfile = {
  taskType: WritingAbilityTaskType;
  status: WritingAbilityStatus;
  sampleCount: number;
  requiredSamples: number;
  metrics: WritingAbilityMetric[];
  suggestions: WritingAbilitySuggestion[];
  modelVersion: string;
};

export const EMAIL_WRITING_ABILITY_DEFINITIONS: WritingAbilityDefinition[] = [
  { skillKey: "email_task_fulfillment", labelZh: "任务完成", labelEn: "Task Fulfillment" },
  { skillKey: "email_clarity", labelZh: "信息表达", labelEn: "Clarity" },
  { skillKey: "email_organization", labelZh: "组织与连贯", labelEn: "Organization" },
  { skillKey: "email_appropriacy", labelZh: "语境与语气", labelEn: "Appropriacy" },
  { skillKey: "email_language_use", labelZh: "语言运用", labelEn: "Language Use" },
];

export const DISCUSSION_WRITING_ABILITY_DEFINITIONS: WritingAbilityDefinition[] = [
  { skillKey: "discussion_position_relevance", labelZh: "观点与切题", labelEn: "Position & Relevance" },
  { skillKey: "discussion_development", labelZh: "论证展开", labelEn: "Development" },
  { skillKey: "discussion_reasoning", labelZh: "论证质量", labelEn: "Reasoning" },
  { skillKey: "discussion_coherence", labelZh: "组织与连贯", labelEn: "Coherence" },
  { skillKey: "discussion_language_use", labelZh: "语言运用", labelEn: "Language Use" },
];

export function getWritingAbilityDefinitions(taskType: WritingAbilityTaskType) {
  return taskType === "email"
    ? EMAIL_WRITING_ABILITY_DEFINITIONS
    : DISCUSSION_WRITING_ABILITY_DEFINITIONS;
}

function roundDisplayScore(score: number) {
  return Math.round(score * 10) / 10;
}

function clampAbilityScore(score: number) {
  return Math.max(0, Math.min(5, score));
}

function isValidAbilityScore(score: unknown) {
  const parsed = Number(score);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 5;
}

function calculateMetric(scores: number[]) {
  const baselineScores = scores.slice(0, MIN_WRITING_ABILITY_SAMPLES);
  let stableScore =
    baselineScores.reduce((sum, score) => sum + score, 0) /
    MIN_WRITING_ABILITY_SAMPLES;
  let trend: WritingAbilityTrend = "STABLE";
  let outlierDirection: "HIGH" | "LOW" | null = null;
  let outlierStreak = 0;

  scores.slice(MIN_WRITING_ABILITY_SAMPLES).forEach((score) => {
    const difference = score - stableScore;
    const direction = difference > 0 ? "HIGH" : "LOW";
    const isPotentialOutlier = Math.abs(difference) >= 1.2;

    if (!isPotentialOutlier) {
      outlierDirection = null;
      outlierStreak = 0;
      trend = Math.abs(difference) >= 0.35 ? (difference > 0 ? "IMPROVING" : "DECLINING") : "STABLE";
      stableScore = stableScore * 0.82 + score * 0.18;
      return;
    }

    if (outlierDirection === direction) {
      outlierStreak += 1;
    } else {
      outlierDirection = direction;
      outlierStreak = 1;
    }

    if (outlierStreak >= 3) {
      trend = direction === "HIGH" ? "IMPROVING" : "DECLINING";
      stableScore = stableScore * 0.68 + score * 0.32;
    } else {
      stableScore = stableScore * 0.95 + score * 0.05;
    }
  });

  return {
    stableScore: clampAbilityScore(stableScore),
    displayScore: roundDisplayScore(clampAbilityScore(stableScore)),
    trend,
  };
}

const suggestionText: Record<string, string> = {
  email_task_fulfillment:
    "建议先核对题目要求，把必须回应的信息点逐条覆盖，再用结尾明确下一步或请求。",
  email_clarity:
    "建议把核心信息写得更具体，减少模糊表达，让收件人能快速理解你的目的和细节。",
  email_organization:
    "建议按目的、原因、具体信息、下一步的顺序组织邮件，让信息推进更自然。",
  email_appropriacy:
    "建议根据收件人身份调整语气，请求、解释或投诉时保持礼貌、直接且符合场景。",
  email_language_use:
    "建议优先保证语法和句子控制准确，再逐步增加更自然的词汇和句式变化。",
  discussion_position_relevance:
    "建议开头直接回应讨论问题，并确保后续理由始终回到同一个核心立场。",
  discussion_development:
    "建议提出理由后继续解释为什么这一点成立，再用具体例子完成展开。",
  discussion_reasoning:
    "建议重点练习“理由 → 解释 → 例子 → 回扣观点”的完整逻辑链，避免重复或弱相关论证。",
  discussion_coherence:
    "建议让观点之间有清楚的顺序和连接，减少不必要重复，使读者更容易跟随。",
  discussion_language_use:
    "建议优先提高句子准确性和表达自然度，确保复杂观点也能被清楚表达。",
};

function buildSuggestions(metrics: WritingAbilityMetric[]) {
  return metrics
    .slice()
    .sort((left, right) => left.stableScore - right.stableScore)
    .slice(0, 2)
    .map((metric) => ({
      skillKey: metric.skillKey,
      labelZh: metric.labelZh,
      displayScore: metric.displayScore,
      suggestion: suggestionText[metric.skillKey],
    }));
}

export function calculateStableAbilityProfile(
  taskType: WritingAbilityTaskType,
  entries: WritingAbilityEntry[]
): WritingAbilityProfile {
  const definitions = getWritingAbilityDefinitions(taskType);
  const validEntries = entries
    .filter((entry) =>
      definitions.every((definition) =>
        isValidAbilityScore(entry.abilityScores?.[definition.skillKey])
      )
    )
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));

  if (validEntries.length < MIN_WRITING_ABILITY_SAMPLES) {
    return {
      taskType,
      status: "INSUFFICIENT_DATA",
      sampleCount: validEntries.length,
      requiredSamples: MIN_WRITING_ABILITY_SAMPLES,
      metrics: [],
      suggestions: [],
      modelVersion: WRITING_ABILITY_MODEL_VERSION,
    };
  }

  const metrics = definitions.map((definition) => {
    const scores = validEntries.map((entry) =>
      Number(entry.abilityScores[definition.skillKey])
    );
    const result = calculateMetric(scores);

    return {
      ...definition,
      stableScore: result.stableScore,
      displayScore: result.displayScore,
      sampleCount: scores.length,
      trend: result.trend,
    };
  });

  return {
    taskType,
    status: "ACTIVE",
    sampleCount: validEntries.length,
    requiredSamples: MIN_WRITING_ABILITY_SAMPLES,
    metrics,
    suggestions: buildSuggestions(metrics),
    modelVersion: WRITING_ABILITY_MODEL_VERSION,
  };
}
