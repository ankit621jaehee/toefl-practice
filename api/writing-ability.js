export const ABILITY_MODEL_VERSION = "writing-ability-v1";

export const MIN_ABILITY_SAMPLES = 5;

export const EMAIL_ABILITY_DEFINITIONS = [
  {
    skillKey: "email_task_fulfillment",
    labelZh: "任务完成",
    labelEn: "Task Fulfillment",
  },
  {
    skillKey: "email_clarity",
    labelZh: "信息表达",
    labelEn: "Clarity",
  },
  {
    skillKey: "email_organization",
    labelZh: "组织与连贯",
    labelEn: "Organization",
  },
  {
    skillKey: "email_appropriacy",
    labelZh: "语境与语气",
    labelEn: "Appropriacy",
  },
  {
    skillKey: "email_language_use",
    labelZh: "语言运用",
    labelEn: "Language Use",
  },
];

export const DISCUSSION_ABILITY_DEFINITIONS = [
  {
    skillKey: "discussion_position_relevance",
    labelZh: "观点与切题",
    labelEn: "Position & Relevance",
  },
  {
    skillKey: "discussion_development",
    labelZh: "论证展开",
    labelEn: "Development",
  },
  {
    skillKey: "discussion_reasoning",
    labelZh: "论证质量",
    labelEn: "Reasoning",
  },
  {
    skillKey: "discussion_coherence",
    labelZh: "组织与连贯",
    labelEn: "Coherence",
  },
  {
    skillKey: "discussion_language_use",
    labelZh: "语言运用",
    labelEn: "Language Use",
  },
];

export function getAbilityDefinitions(taskType) {
  if (taskType === "email") return EMAIL_ABILITY_DEFINITIONS;
  if (taskType === "discussion") return DISCUSSION_ABILITY_DEFINITIONS;
  return [];
}

function isValidAbilityNumber(value) {
  return Number.isFinite(value) && value >= 0 && value <= 5;
}

export function roundAbilityScore(value, fieldName = "ability score") {
  const parsed = Number(value);

  if (!isValidAbilityNumber(parsed)) {
    throw new Error(`${fieldName} must be between 0.0 and 5.0.`);
  }

  return Math.round(parsed * 10) / 10;
}

export function normalizeAbilityScores(taskType, rawScores) {
  const definitions = getAbilityDefinitions(taskType);
  const source = rawScores && typeof rawScores === "object" ? rawScores : {};
  const normalized = {};

  definitions.forEach((definition) => {
    if (source[definition.skillKey] === undefined) {
      throw new Error(`Missing ability score: ${definition.skillKey}`);
    }

    normalized[definition.skillKey] = roundAbilityScore(
      source[definition.skillKey],
      definition.skillKey
    );
  });

  return normalized;
}
