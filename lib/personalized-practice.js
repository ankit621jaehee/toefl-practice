const TOPICS = {
  email: [
    ["学术校园", "Academic & Campus"],
    ["服务反馈", "Service & Feedback"],
    ["旅行住宿", "Travel & Accommodation"],
    ["合作活动", "Collaboration & Activities"],
    ["生活社交", "Life & Social"],
    ["求职申请", "Career & Applications"],
  ],
  discussion: [
    ["教育学习", "Education & Learning"],
    ["商业经济", "Work & Economy"],
    ["科技媒体", "Technology & Media"],
    ["心理健康", "Psychology & Health"],
    ["环境城市", "Environment & Cities"],
    ["艺术人文", "Arts & Humanities"],
    ["社会文化", "Society & Culture"],
    ["政府政策", "Government & Policy"],
  ],
};

const TOPIC_ALIASES = {
  email: {
    工作沟通: "求职申请",
    旅行安排: "旅行住宿",
    校园学习: "学术校园",
    校园活动: "合作活动",
    申请咨询: "求职申请",
  },
  discussion: {
    历史社会: "社会文化",
    商业管理: "商业经济",
    媒体社会: "科技媒体",
    市场营销: "商业经济",
    教育科技: "教育学习",
    文学艺术: "艺术人文",
    科技社会: "科技媒体",
    经济政策: "商业经济",
    艺术文化: "艺术人文",
  },
};

const KEYWORDS = {
  email: {
    学术校园: ["professor", "course", "class", "assignment", "campus", "university", "college", "research", "semester", "deadline", "lecture"],
    服务反馈: ["customer service", "complaint", "refund", "replacement", "repair", "damaged", "defective", "delivery", "order", "purchase", "support", "product", "issue"],
    旅行住宿: ["travel", "trip", "flight", "airline", "hotel", "hostel", "accommodation", "reservation", "booking", "vacation", "tour", "luggage"],
    合作活动: ["group project", "event", "club", "meeting", "volunteer", "activity", "invite", "organize", "festival", "concert", "team", "workshop", "conference", "collaborat"],
    生活社交: ["new city", "adjust", "overwhelmed", "personal advice", "relationship", "family", "social life", "new friends", "well-being", "birthday", "wedding"],
    求职申请: ["job", "career", "intern", "resume", "résumé", "interview", "employer", "employee", "hiring", "employment", "application"],
  },
  discussion: {
    教育学习: ["education", "school", "college", "university", "student", "course", "class", "learning", "training", "degree", "teacher", "professor"],
    商业经济: ["business", "economy", "economic", "company", "consumer", "advertising", "marketing", "money", "income", "workplace", "financial", "poverty"],
    科技媒体: ["artificial intelligence", "technology", "digital", "internet", "online platform", "social media", "app", "video platform"],
    心理健康: ["stress", "mental health", "health", "exercise", "wellness", "sleep", "emotion", "psychology", "anxiety"],
    环境城市: ["environment", "pollution", "climate", "smart city", "urban", "traffic", "public transport", "recycling", "sustainab", "natural resource", "planet", "energy"],
    艺术人文: ["art", "artist", "music", "museum", "painting", "film", "literature", "humanities", "poetry", "theater", "philosophy"],
    社会文化: ["society", "social mobility", "culture", "community", "tradition", "language", "family", "friend", "anthropology", "ritual", "hierarchy", "networking"],
    政府政策: ["government", "policy", "law", "tax", "budget", "regulation", "vote", "official", "public funding"],
  },
};

const INTERNAL_CATEGORIES = new Set([
  "内容完整性", "词汇表达", "语法结构", "连贯性", "礼貌格式",
  "内容发展", "语法句型", "连贯与组织", "任务完成",
]);

export function getTopicDefinitions(taskType) {
  return (TOPICS[taskType] || []).map(([topic, label]) => ({ topic, label }));
}

function topicLabel(taskType, topic) {
  return TOPICS[taskType]?.find(([value]) => value === topic)?.[1] || topic;
}

function promptText(prompt) {
  return JSON.stringify(prompt || {}).toLowerCase();
}

export function normalizePracticeTopic(taskType, rawTopic, prompt) {
  const allowed = new Set((TOPICS[taskType] || []).map(([topic]) => topic));
  const raw = String(rawTopic || "").trim();
  if (allowed.has(raw)) return raw;
  const alias = TOPIC_ALIASES[taskType]?.[raw];
  if (alias) return alias;

  const text = promptText(prompt);
  let best = { topic: TOPICS[taskType]?.[0]?.[0] || "", score: 0 };
  for (const [topic] of TOPICS[taskType] || []) {
    const score = (KEYWORDS[taskType]?.[topic] || []).reduce(
      (total, keyword) => total + (text.split(keyword).length - 1),
      0
    );
    if (score > best.score) best = { topic, score };
  }
  return best.topic;
}

function extractTopic(taskType, prompt) {
  const candidates = [prompt?.category, prompt?.topic, prompt?.knowledgeCategory];
  const explicit = candidates.find((value) => value && !INTERNAL_CATEGORIES.has(value));
  return normalizePracticeTopic(taskType, explicit, prompt);
}

function parseScore(value) {
  const score = Number.parseFloat(String(value ?? "").match(/\d+(?:\.\d+)?/)?.[0] || "");
  return Number.isFinite(score) && score >= 0 && score <= 5 ? score : null;
}

function hasValidGrading(feedback, score) {
  return score !== null && feedback && typeof feedback === "object" && Object.keys(feedback).length > 0;
}

export function collectGradedAttempts(practiceRecords, mockRecords) {
  const attempts = [];
  for (const record of practiceRecords || []) {
    if (record.practice_type !== "email" && record.practice_type !== "discussion") continue;
    const score = parseScore(record.score);
    if (!hasValidGrading(record.feedback, score)) continue;
    attempts.push({
      taskType: record.practice_type,
      topic: extractTopic(record.practice_type, record.prompt),
      score,
      createdAt: record.created_at,
      recordId: record.id,
    });
  }
  for (const record of mockRecords || []) {
    for (const taskType of ["email", "discussion"]) {
      const score = parseScore(record[`${taskType}_score`]);
      const feedback = record[`${taskType}_feedback`];
      if (!hasValidGrading(feedback, score)) continue;
      const prompt = record[`${taskType}_prompt`];
      attempts.push({
        taskType,
        topic: extractTopic(taskType, prompt),
        score,
        createdAt: record.created_at,
        recordId: `${record.id}:${taskType}`,
      });
    }
  }
  return attempts.filter((item) => item.topic && Number.isFinite(Date.parse(item.createdAt)));
}

function calculateTaskProfile(taskType, allAttempts) {
  const attempts = allAttempts
    .filter((item) => item.taskType === taskType)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 10);
  const definitions = getTopicDefinitions(taskType);
  const topics = definitions.map(({ topic, label }) => {
    const entries = attempts
      .filter((item) => item.topic === topic)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const count = entries.length;
    const weightedTotal = entries.reduce((sum, entry, index) => sum + entry.score * (index + 1), 0);
    const weight = entries.reduce((sum, _entry, index) => sum + index + 1, 0);
    const average = count ? weightedTotal / weight : null;
    const split = Math.max(1, Math.floor(count / 2));
    const older = entries.slice(0, split);
    const newer = entries.slice(split);
    const mean = (items) => items.reduce((sum, item) => sum + item.score, 0) / Math.max(1, items.length);
    const trend = count >= 3 ? mean(newer) - mean(older) : 0;
    const confidence = Math.min(1, count / 3);
    const adjustedMastery = average === null ? 3.5 : average * confidence + 3.5 * (1 - confidence);
    const recommendationPriority = average === null
      ? 10
      : (5 - adjustedMastery) + confidence * 0.35 - Math.max(0, trend) * 0.45;
    return {
      topic,
      label,
      count,
      score: average === null ? null : Number(average.toFixed(2)),
      confidence: Number(confidence.toFixed(2)),
      trend: Number(trend.toFixed(2)),
      priority: Number(recommendationPriority.toFixed(3)),
    };
  });
  const coveredTopics = topics.filter((item) => item.count > 0).length;
  const building = attempts.length < 5 || coveredTopics < 3;
  const focus = topics
    .filter((item) => item.count > 0)
    .sort((a, b) => b.priority - a.priority || b.count - a.count)
    .slice(0, 3);
  return {
    taskType,
    status: building ? "building" : "personalized",
    attemptCount: attempts.length,
    coveredTopics,
    totalTopics: topics.length,
    topics,
    focus,
  };
}

export function buildLearningProfile(practiceRecords, mockRecords) {
  const attempts = collectGradedAttempts(practiceRecords, mockRecords);
  return {
    email: calculateTaskProfile("email", attempts),
    discussion: calculateTaskProfile("discussion", attempts),
  };
}

function stableNumber(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function chooseFocus(profile, seed, lastTopic) {
  const focus = profile.focus.slice(0, 3);
  if (!focus.length) return profile.topics.slice().sort((a, b) => a.count - b.count)[0];
  const roll = stableNumber(seed) % 100;
  const index = roll < 45 ? 0 : roll < 80 ? 1 : 2;
  let selected = focus[Math.min(index, focus.length - 1)];
  if (selected?.topic === lastTopic && focus.length > 1) {
    selected = focus[(Math.min(index, focus.length - 1) + 1) % focus.length];
  }
  return selected;
}

export function chooseRecommendationFocus(profiles, history, userId, preferredTaskType, preferredTopic) {
  const validPreferredTask = preferredTaskType === "email" || preferredTaskType === "discussion"
    ? preferredTaskType
    : null;
  const last = history?.[0] || null;
  const sequence = String(history?.length || 0);
  const seed = `${userId}:${new Date().toISOString().slice(0, 10)}:${sequence}`;

  if (validPreferredTask && preferredTopic) {
    const normalized = normalizePracticeTopic(validPreferredTask, preferredTopic, {});
    if (getTopicDefinitions(validPreferredTask).some((item) => item.topic === normalized)) {
      return { taskType: validPreferredTask, topic: normalized, label: topicLabel(validPreferredTask, normalized) };
    }
  }

  if (validPreferredTask) {
    const preferredProfile = profiles[validPreferredTask];
    if (preferredProfile.status === "building") {
      const candidates = preferredProfile.topics
        .slice()
        .sort((a, b) => a.count - b.count || b.priority - a.priority);
      const leastCoveredCount = candidates[0]?.count ?? 0;
      const leastCovered = candidates.filter(
        (item) => item.count === leastCoveredCount
      );
      let selected =
        leastCovered[stableNumber(seed) % Math.max(1, leastCovered.length)] ||
        candidates[0];
      if (selected?.topic === last?.topic && candidates.length > 1) {
        selected =
          candidates.find((item) => item.topic !== last.topic) || selected;
      }
      return {
        taskType: validPreferredTask,
        topic: selected.topic,
        label: selected.label,
      };
    }

    const selected = chooseFocus(preferredProfile, seed, last?.topic);
    return {
      taskType: validPreferredTask,
      topic: selected.topic,
      label: selected.label,
    };
  }

  const buildingProfiles = [profiles.email, profiles.discussion].filter((profile) => profile.status === "building");
  if (buildingProfiles.length) {
    const selectedProfile = buildingProfiles.sort(
      (a, b) => a.attemptCount - b.attemptCount || a.coveredTopics - b.coveredTopics
    )[0];
    const candidates = selectedProfile.topics.slice().sort((a, b) => a.count - b.count || b.priority - a.priority);
    let selected = candidates[stableNumber(seed) % Math.max(1, candidates.filter((item) => item.count === candidates[0]?.count).length)];
    if (selected?.topic === last?.topic && candidates.length > 1) selected = candidates.find((item) => item.topic !== last.topic) || selected;
    return { taskType: selectedProfile.taskType, topic: selected.topic, label: selected.label };
  }

  const taskProfiles = [profiles.email, profiles.discussion];
  let selectedProfile = taskProfiles
    .slice()
    .sort((a, b) => (b.focus[0]?.priority || 0) - (a.focus[0]?.priority || 0))[0];
  if (last?.task_type === selectedProfile.taskType && taskProfiles.length > 1 && (stableNumber(seed) % 4) === 0) {
    selectedProfile = taskProfiles.find((profile) => profile.taskType !== selectedProfile.taskType) || selectedProfile;
  }
  const selected = chooseFocus(selectedProfile, seed, last?.topic);
  return { taskType: selectedProfile.taskType, topic: selected.topic, label: selected.label };
}

export function findQuestionCandidates(questionSets, taskType, topic, completedSetIds, recommendationHistory) {
  const recentCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const previouslyRecommended = new Map();
  for (const item of recommendationHistory || []) {
    if (item.question_key) previouslyRecommended.set(item.question_key, Date.parse(item.recommended_at));
  }
  const candidates = [];
  for (const set of questionSets || []) {
    const tasks = Array.isArray(set.content?.tasks) ? set.content.tasks : [];
    tasks.forEach((task, index) => {
      if (task.type !== taskType) return;
      if (extractTopic(taskType, task.prompt) !== topic) return;
      const questionKey = `${set.id}:${taskType}:${index}`;
      const lastRecommendedAt = previouslyRecommended.get(questionKey) || 0;
      if (lastRecommendedAt > recentCutoff) return;
      candidates.push({
        questionSetId: set.id,
        questionSetSourceType: set.source_type,
        questionKey,
        task,
        unseen: !completedSetIds.has(set.id) && !previouslyRecommended.has(questionKey),
        lastRecommendedAt,
        sortOrder: Number(set.sort_order || 0),
      });
    });
  }
  return candidates.sort((a, b) => Number(b.unseen) - Number(a.unseen) || a.lastRecommendedAt - b.lastRecommendedAt || b.sortOrder - a.sortOrder);
}
