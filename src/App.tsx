import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type MouseEvent,
  type ReactNode,
  type CSSProperties,
  type TouchEvent,
} from "react";
// Import chart components from recharts for ability analysis trends
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from "recharts";
import type { User } from "@supabase/supabase-js";
import { MorphIcon } from "morphicons/react";
import {
  Atom,
  Bell,
  Calendar,
  Cpu,
  Headphones,
  MapPin,
  Sparkles,
  Sun,
  User as UserIcon,
} from "lucide";
import { supabase } from "./supabaseClient";
import SupportAdminPage from "./SupportAdminPage";
import {
  dailyArticles,
  getTodayDailyArticle,
  type DailyArticle,
} from "./dailyData";
import {
  calculateStableAbilityProfile,
  getWritingAbilityDefinitions,
  MIN_WRITING_ABILITY_SAMPLES,
  type WritingAbilityEntry,
  type WritingAbilityMetric,
  type WritingAbilityProfile,
} from "./writingAbility";

const AI_GENERATION_PROGRESS_HOLD_MS = 4000;
const AI_GENERATION_PROGRESS_FINISH_MS = 1000;

function waitForAiGenerationProgress(durationMs: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

async function runWithAiGenerationProgress<T>(
  operation: () => Promise<T>,
  onGenerationReady: () => void
) {
  const startedAt = Date.now();
  const result = await operation();
  const elapsed = Date.now() - startedAt;
  const remainingUntilHold = Math.max(
    0,
    AI_GENERATION_PROGRESS_HOLD_MS - elapsed
  );

  if (remainingUntilHold > 0) {
    await waitForAiGenerationProgress(remainingUntilHold);
  }

  onGenerationReady();
  await waitForAiGenerationProgress(AI_GENERATION_PROGRESS_FINISH_MS);
  return result;
}

// Knowledge point categories constants for different practice types.
// These arrays define the conceptual areas used to populate the radar chart
// and to tag newly generated questions/prompts internally.  They are not
// displayed to the user directly.
const SENTENCE_KNOWLEDGE_CATEGORIES = [
  "从句",
  "短语搭配",
  "连词使用",
  "句型结构",
  "时态一致",
] as const;

const EMAIL_KNOWLEDGE_CATEGORIES = [
  "内容完整性",
  "词汇表达",
  "语法结构",
  "连贯性",
  "礼貌格式",
] as const;

const DISCUSSION_KNOWLEDGE_CATEGORIES = [
  "内容发展",
  "词汇表达",
  "语法句型",
  "连贯与组织",
  "任务完成",
] as const;

// Helpers to assign a random knowledge category to a generated question or prompt.
function getRandomElement<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function assignSentenceKnowledgeCategory(): string {
  return getRandomElement(SENTENCE_KNOWLEDGE_CATEGORIES);
}

function assignEmailKnowledgeCategory(): string {
  return getRandomElement(EMAIL_KNOWLEDGE_CATEGORIES);
}

function assignDiscussionKnowledgeCategory(): string {
  return getRandomElement(DISCUSSION_KNOWLEDGE_CATEGORIES);
}

function getEmailRecipient(prompt: EmailPrompt) {
  if (prompt.to?.trim()) return prompt.to.trim();
  if (prompt.recipient?.trim()) return prompt.recipient.trim();

  const taskSource = prompt.task || "";
  const source = `${prompt.task || ""} ${prompt.scenario || ""}`;
  const patterns = [
    /write an email to\s+(.+?)(?:\.\s*in your email|,\s*in your email|\s+in your email)/i,
    /write a reply to\s+(.+?)(?:\.\s*in your email|,\s*in your email|\s+in your email)/i,
    /email to\s+(.+?)(?:\.\s*in your email|,\s*in your email|\s+in your email)/i,
    /write an email to\s+(.+?)(?:\.|,)/i,
    /write a reply to\s+(.+?)(?:\.|,)/i,
  ];

  for (const pattern of patterns.slice(0, 3)) {
    const match = taskSource.match(pattern);

    if (match?.[1]) {
      return match[1].replace(/\s+/g, " ").trim();
    }
  }

  for (const pattern of patterns) {
    const match = source.match(pattern);

    if (match?.[1]) {
      return match[1].replace(/\s+/g, " ").trim();
    }
  }

  return "Professor";
}

function getEmailSubject(prompt: EmailPrompt) {
  if (prompt.subject?.trim()) {
    return prompt.subject.trim();
  }

  const genericTitles = new Set([
    "email writing practice",
    "email writing",
    "write an email",
  ]);
  const title = prompt.title?.trim();

  if (title && !genericTitles.has(title.toLowerCase())) {
    return title;
  }

  const taskMatch = `${prompt.task || ""} ${prompt.scenario || ""}`.match(
    /\b(?:about|regarding|for|on)\s+([A-Za-z][A-Za-z\s-]{3,45})(?:\.|,|;|\s+to|\s+and|\s+because|\s+that|\s+in\b)/i
  );

  if (taskMatch?.[1]) {
    return taskMatch[1]
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  const recipient = getEmailRecipient(prompt);
  return recipient === "Professor" ? "Email Writing Task" : `Message to ${recipient}`;
}

function getEmailPromptText(prompt: EmailPrompt) {
  return [
    prompt.title,
    prompt.subject,
    prompt.scenario,
    prompt.task,
    ...(prompt.requirements || []),
    prompt.suggestedLength,
  ].join(" ");
}

function getDiscussionPromptText(prompt: DiscussionPrompt) {
  return [
    prompt.title,
    prompt.instruction,
    prompt.professorName,
    prompt.professor,
    prompt.studentOneName,
    prompt.studentOnePost,
    prompt.studentTwoName,
    prompt.studentTwoPost,
    prompt.question,
    prompt.suggestedLength,
  ]
    .filter(Boolean)
    .join(" ");
}

function useTextareaEditor(
  value: string,
  setValue: (value: string) => void,
  blockedPasteSource = ""
) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);
  const currentValueRef = useRef(value);

  useEffect(() => {
    currentValueRef.current = value;
  }, [value]);

  function normalizeText(text: string) {
    return text.toLowerCase().replace(/\s+/g, " ").trim();
  }

  function isBlockedPasteText(text: string) {
    const normalizedText = normalizeText(text);
    const normalizedSource = normalizeText(blockedPasteSource);

    if (normalizedText.length < 12 || normalizedSource.length === 0) {
      return false;
    }

    return normalizedSource.includes(normalizedText);
  }

  function restoreSelection(position: number) {
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;

      if (!textarea) return;

      textarea.focus();
      textarea.setSelectionRange(position, position);
    });
  }

  function pushUndo(previousValue: string) {
    undoStackRef.current.push(previousValue);

    if (undoStackRef.current.length > 80) {
      undoStackRef.current.shift();
    }
  }

  function commitValue(nextValue: string, caretPosition?: number) {
    const previousValue = currentValueRef.current;

    if (nextValue === previousValue) return;

    pushUndo(previousValue);
    redoStackRef.current = [];
    currentValueRef.current = nextValue;
    setValue(nextValue);

    if (caretPosition !== undefined) {
      restoreSelection(caretPosition);
    }
  }

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    commitValue(event.target.value, event.target.selectionStart);
  }

  async function cutSelection() {
    const textarea = textareaRef.current;

    if (!textarea) return;

    const { selectionStart, selectionEnd } = textarea;

    if (selectionStart === selectionEnd) return;

    const selectedText = currentValueRef.current.slice(selectionStart, selectionEnd);

    try {
      await navigator.clipboard.writeText(selectedText);
    } catch {
      // The text is still cut from the answer even if clipboard permission fails.
    }

    const nextValue =
      currentValueRef.current.slice(0, selectionStart) +
      currentValueRef.current.slice(selectionEnd);

    commitValue(nextValue, selectionStart);
  }

  async function pasteFromClipboard() {
    const textarea = textareaRef.current;

    if (!textarea) return;

    let clipboardText = "";

    try {
      clipboardText = await navigator.clipboard.readText();
    } catch {
      window.alert("浏览器没有允许读取剪贴板，请使用键盘粘贴或检查浏览器权限。");
      return;
    }

    if (isBlockedPasteText(clipboardText)) {
      window.alert("题目内容不能粘贴到回答区。");
      return;
    }

    const { selectionStart, selectionEnd } = textarea;
    const nextValue =
      currentValueRef.current.slice(0, selectionStart) +
      clipboardText +
      currentValueRef.current.slice(selectionEnd);

    commitValue(nextValue, selectionStart + clipboardText.length);
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pastedText = event.clipboardData.getData("text");

    if (isBlockedPasteText(pastedText)) {
      event.preventDefault();
      window.alert("题目内容不能粘贴到回答区。");
    }
  }

  function undo() {
    const previousValue = undoStackRef.current.pop();

    if (previousValue === undefined) return;

    redoStackRef.current.push(currentValueRef.current);
    currentValueRef.current = previousValue;
    setValue(previousValue);
    restoreSelection(previousValue.length);
  }

  function redo() {
    const nextValue = redoStackRef.current.pop();

    if (nextValue === undefined) return;

    pushUndo(currentValueRef.current);
    currentValueRef.current = nextValue;
    setValue(nextValue);
    restoreSelection(nextValue.length);
  }

  return {
    textareaRef,
    handleChange,
    handlePaste,
    cutSelection,
    pasteFromClipboard,
    undo,
    redo,
  };
}

type Page =
  | "home"
  | "practice-loading"
  | "sentence-intro"
  | "email-intro"
  | "discussion-intro"
  | "sentence"
  | "email"
  | "discussion"
  | "records"
  | "record-detail"
  | "mock"
  | "mock-result"
  | "mock-records"
  | "mock-record-detail"
  | "past-exam"
  | "past-exam-preview"
  | "past-exam-detail"
  | "ets-mock-practice"
  | "ets-mock-detail"
  | "ets-style-preview"
  | "scoring-guide-email"
  | "scoring-guide-discussion"
  | "analytics"
  | "practice-sessions";

const pauseModalOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.5)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  zIndex: 1000,
  padding: "24px",
};

const pauseModalContentStyle: CSSProperties = {
  background: "white",
  borderRadius: "16px",
  padding: "32px",
  width: "90%",
  maxWidth: "520px",
  textAlign: "center",
  boxShadow: "0 24px 80px rgba(15, 23, 42, 0.25)",
};

const pauseModalTitleStyle: CSSProperties = {
  fontSize: "40px",
  lineHeight: 1.1,
  fontWeight: 800,
  margin: "0 0 24px",
  letterSpacing: "0",
};

const pauseModalDividerStyle: CSSProperties = {
  height: "1px",
  background: "#d1d5db",
  marginBottom: "28px",
};

const pauseModalTextStyle: CSSProperties = {
  fontSize: "22px",
  lineHeight: 1.65,
  margin: 0,
};

const pauseModalActionsStyle: CSSProperties = {
  display: "flex",
  gap: "24px",
  marginTop: "36px",
  flexWrap: "wrap",
  justifyContent: "center",
};

const pauseModalButtonStyle: CSSProperties = {
  border: "none",
  borderRadius: "20px",
  background: "#006b67",
  color: "white",
  fontSize: "22px",
  lineHeight: 1.2,
  fontWeight: 800,
  padding: "18px 56px",
  minWidth: "180px",
  cursor: "pointer",
};

type Part =
  | {
      type: "fixed";
      text: string;
    }
  | {
      type: "blank";
      answer: string;
    };

type Chunk = {
  id: string;
  text: string;
};

type DraggedChunk = {
  chunk: Chunk;
  sourceSlotIndex?: number;
};

type TouchDragPreview = {
  x: number;
  y: number;
  text: string;
};

function getSentenceDropSlotAtPoint(clientX: number, clientY: number) {
  const target = document.elementFromPoint(clientX, clientY);
  const slot = target?.closest<HTMLElement>("[data-sentence-slot-index]");
  const slotIndex = Number(slot?.dataset.sentenceSlotIndex);

  return Number.isInteger(slotIndex) && slotIndex >= 0 ? slotIndex : null;
}

function useSentenceTouchDrag({
  disabled,
  setDragged,
  onPlace,
}: {
  disabled: boolean;
  setDragged: (chunk: DraggedChunk | null) => void;
  onPlace: (draggedChunk: DraggedChunk, slotIndex: number) => void;
}) {
  const touchDraggedRef = useRef<DraggedChunk | null>(null);
  const touchStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const touchMovedRef = useRef(false);
  const [touchDropSlotIndex, setTouchDropSlotIndex] = useState<number | null>(
    null
  );
  const [touchDragPreview, setTouchDragPreview] =
    useState<TouchDragPreview | null>(null);

  function clearTouchDrag() {
    touchDraggedRef.current = null;
    touchStartPointRef.current = null;
    touchMovedRef.current = false;
    setDragged(null);
    setTouchDropSlotIndex(null);
    setTouchDragPreview(null);
  }

  function startTouchDrag(
    event: TouchEvent<HTMLElement>,
    draggedChunk: DraggedChunk
  ) {
    if (disabled) return;

    const touch = event.touches[0];
    if (!touch) return;

    touchDraggedRef.current = draggedChunk;
    touchStartPointRef.current = { x: touch.clientX, y: touch.clientY };
    touchMovedRef.current = false;
    setDragged(draggedChunk);
    setTouchDragPreview({
      x: touch.clientX,
      y: touch.clientY,
      text: normalizeChunkDisplayText(draggedChunk.chunk.text),
    });
  }

  function moveTouchDrag(event: TouchEvent<HTMLElement>) {
    if (!touchDraggedRef.current) return;

    const touch = event.touches[0];
    if (!touch) return;

    const startPoint = touchStartPointRef.current;
    if (
      startPoint &&
      Math.hypot(touch.clientX - startPoint.x, touch.clientY - startPoint.y) > 6
    ) {
      touchMovedRef.current = true;
    }

    if (touchMovedRef.current) {
      event.preventDefault();
    }
    setTouchDropSlotIndex(
      getSentenceDropSlotAtPoint(touch.clientX, touch.clientY)
    );
    setTouchDragPreview((previous) =>
      previous
        ? { ...previous, x: touch.clientX, y: touch.clientY }
        : previous
    );
  }

  function finishTouchDrag(event: TouchEvent<HTMLElement>) {
    const draggedChunk = touchDraggedRef.current;
    if (!draggedChunk) return;

    const touch = event.changedTouches[0];
    const slotIndex = touch
      ? getSentenceDropSlotAtPoint(touch.clientX, touch.clientY)
      : null;

    if (slotIndex !== null) {
      event.preventDefault();
      onPlace(draggedChunk, slotIndex);
      clearTouchDrag();
      return;
    }

    if (touchMovedRef.current) {
      event.preventDefault();
      clearTouchDrag();
      return;
    }

    // A short tap keeps the word selected so mobile users can tap a blank as
    // an alternative when the word bank and answer line are not both visible.
    touchDraggedRef.current = null;
    touchStartPointRef.current = null;
    touchMovedRef.current = false;
    setTouchDropSlotIndex(null);
    setTouchDragPreview(null);
  }

  return {
    touchDropSlotIndex,
    touchDragPreview,
    startTouchDrag,
    moveTouchDrag,
    finishTouchDrag,
    cancelTouchDrag: clearTouchDrag,
  };
}

function SentenceTouchDragPreview({ preview }: { preview: TouchDragPreview }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        zIndex: 10000,
        left: preview.x,
        top: preview.y,
        transform: "translate(-50%, calc(-100% - 14px))",
        maxWidth: "min(82vw, 320px)",
        padding: "9px 14px",
        borderRadius: "12px",
        border: "1px solid rgba(0, 107, 103, 0.35)",
        background: "rgba(255, 255, 255, 0.96)",
        color: "#005f5b",
        boxShadow: "0 10px 28px rgba(15, 23, 42, 0.2)",
        fontSize: "17px",
        lineHeight: 1.25,
        fontWeight: 800,
        pointerEvents: "none",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {preview.text}
    </div>
  );
}

type Question = {
  id: number;
  contextSpeaker: string;
  contextSentence: string;
  answerSpeaker: string;
  target: string;
  parts: Part[];
  chunks: string[];
  explanation: string;
  recordSourceType?: "forge_ai" | "past_exam" | "ets_mock";
  recordPracticeMode?: "fixed" | "random";
};

type EmailPrompt = {
  title: string;
  subject?: string;
  recipient?: string;
  to?: string;
  scenario: string;
  task: string;
  requirements: string[];
  suggestedLength: string;
  category?: string;
  knowledgeCategory?: string;
  personalizedRecommendationId?: string | null;
  recordSourceType?: "forge_ai" | "past_exam" | "ets_mock";
  recordPracticeMode?: "fixed" | "random";
};

type DiscussionPrompt = {
  title: string;
  instruction?: string;
  professorName?: string;
  professor: string;
  studentOneName: string;
  studentOnePost: string;
  studentTwoName: string;
  studentTwoPost: string;
  question: string;
  suggestedLength: string;
  category?: string;
  knowledgeCategory?: string;
  personalizedRecommendationId?: string | null;
  recordSourceType?: "forge_ai" | "past_exam" | "ets_mock";
  recordPracticeMode?: "fixed" | "random";
};

type PersonalizedTaskType = "email" | "discussion";

type PersonalizedTopicStat = {
  topic: string;
  label: string;
  count: number;
  score: number | null;
  confidence: number;
  trend: number;
  priority: number;
};

type PersonalizedTaskProfile = {
  taskType: PersonalizedTaskType;
  status: "building" | "personalized";
  attemptCount: number;
  coveredTopics: number;
  totalTopics: number;
  topics: PersonalizedTopicStat[];
  focus: PersonalizedTopicStat[];
};

type PersonalizedProfile = {
  stage: "building" | "personalized";
  taskProfiles: Record<PersonalizedTaskType, PersonalizedTaskProfile>;
  recommendedFocus: (PersonalizedTopicStat & { taskType: PersonalizedTaskType })[];
};

type PersonalizedRecommendation = {
  id: string;
  taskType: PersonalizedTaskType;
  taskTypeLabel: string;
  topic: string;
  topicLabel: string;
  source: "past_exam" | "ai_generated";
  sourceLabel: string;
  questionSetId: string | null;
  questionSetSourceType: "past_exam" | "ets_mock" | null;
  questionKey: string | null;
  task: QuestionSetTask | null;
  recommendedAt: string;
};

type WritingFeedback = {
  score: string;
  strengths: string[];
  problems: string[];
  grammarCorrections: {
    original: string;
    corrected: string;
    explanation: string;
  }[];
  actionPlan: string[];
  improvedVersion: string;
  sampleAnswer: string;
  abilityScores?: Record<string, number>;
  ability_scores?: Record<string, number>;
  abilityModelVersion?: string;
  ability_model_version?: string;
};
type MockSentenceQuestion = Question;

type MockTestData = {
  sentenceQuestions: MockSentenceQuestion[];
  emailPrompt: EmailPrompt;
  discussionPrompt: DiscussionPrompt;
  selectedTypes?: PastExamPracticeType[];
  cost?: number;
  balance?: number;
  temporaryBalance?: number;
  permanentBalance?: number;
};

type CreditBalance = {
  balance: number;
  temporaryBalance: number;
  permanentBalance: number;
  checkInDates?: string[];
  claimedMilestones?: number[];
};

type RedeemResult = Partial<CreditBalance> & {
  message: string;
  rewardType: "credits" | "pro";
  creditsAdded?: number;
  proDays?: number;
  subscriptionExpiresAt?: string | null;
};

type MockResult = {
  recordId?: string;
  sentenceQuestions: MockSentenceQuestion[];
  sentenceAnswers?: Record<string, string[]>;
  emailPrompt?: EmailPrompt;
  emailAnswer?: string;
  discussionPrompt?: DiscussionPrompt;
  discussionAnswer?: string;
  sentenceScore: number;
  emailScore: string;
  discussionScore: string;
  finalScore: number;
  emailFeedback: WritingFeedback;
  discussionFeedback: WritingFeedback;
  knowledgeAnalysis: string[];
  studyAdvice: string[];
  selectedTypes?: PastExamPracticeType[];
  cost?: number;
  balance?: number;
};

type MockRecord = {
  id: string;
  sentence_questions: MockSentenceQuestion[];
  sentence_answers: Record<string, string[]>;
  sentence_score: number;

  email_prompt: EmailPrompt;
  email_answer: string;
  email_feedback: WritingFeedback;
  email_score: string;

  discussion_prompt: DiscussionPrompt;
  discussion_answer: string;
  discussion_feedback: WritingFeedback;
  discussion_score: string;

  final_score: number;
  knowledge_analysis: string[];
  study_advice: string[];

  points_spent: number;
  created_at: string;
};

type QuestionSetTask =
  | {
      type: "sentence";
      title: string;
      questions: Question[];
    }
  | {
      type: "email";
      title: string;
      prompt: EmailPrompt;
    }
  | {
      type: "discussion";
      title: string;
      prompt: DiscussionPrompt;
    };

type PastExamPracticeType = "sentence" | "email" | "discussion";

type EtsStylePreviewPageKey =
  | "ai"
  | "daily"
  | "library"
  | "records"
  | "analytics"
  | "calendar"
  | "help"
  | "support"
  | "account"
  | "store";

type EtsStylePastSearchType =
  | "Build a Sentence"
  | "Email Writing"
  | "Academic Discussion";

type EtsStylePreviewRestoreState = {
  page?: EtsStylePreviewPageKey;
  libraryTab: "past" | "mock";
  pastBank: PastExamPracticeType | null;
  topicFilter: string;
  completionFilter: "all" | "done" | "undone";
  sortOrder: "desc" | "asc";
  bankPage: number;
  pastSearchType: EtsStylePastSearchType;
  pastSearchInput: string;
  appliedPastSearch: string;
};

type HelpSupportStatus = "已提交" | "处理中" | "已处理" | "已完成";

type HelpSupportMessage = {
  id: string;
  sender: "user" | "support";
  message: string;
  cycle: number;
  createdAt: string;
};

type HelpSupportTicket = {
  id: string;
  email: string;
  message: string;
  createdAt: string;
  status: HelpSupportStatus;
  cycle: number;
  supportReply: string;
  repliedAt: string | null;
  messages: HelpSupportMessage[];
};

type UserNotification = {
  id: string;
  kind: "system" | "support_reply" | "admin_broadcast";
  title: string;
  message: string;
  destination: string | null;
  createdAt: string;
  readAt: string | null;
};

type RedemptionHistoryItem = {
  id: string;
  rewardType: "credits" | "pro";
  creditsAdded: number;
  proDays: number | null;
  subscriptionExpiresAt: string | null;
  redeemedAt: string;
};

type PastExamPreviewSelection = {
  item: QuestionSet;
  type: PastExamPracticeType;
  task: QuestionSetTask;
  question?: Question;
};

type PastExamRandomOptions = {
  selectedTypes: PastExamPracticeType[];
  practiceMode?: "custom" | "exam_set";
  sentenceMode?: "mixed" | "random_set" | "set";
  sentenceSetId?: string;
};

type QuestionSetContent = {
  description?: string;
  tasks?: QuestionSetTask[];
};

type QuestionSet = {

  id: string;

  source_type: "past_exam" | "ets_mock";

  title: string;

  display_date: string | null;

  mock_number: number | null;

  sort_order: number;

  content: QuestionSetContent;

  created_at: string;

  locked?: boolean;

};

type QuestionAttempt = {

  id: string;

  question_set_id: string;

  source_type: "past_exam" | "ets_mock";

  status: "started" | "completed";

  score: number | null;

  created_at: string;

};






type PracticeRecord = {
  id: string;
  practice_type: string;
  prompt: EmailPrompt | DiscussionPrompt | Record<string, unknown>;
  answer: string;
  feedback: WritingFeedback;
  score: string;
  points_spent: number;
  created_at: string;
};

type PastExamRecordLink = {
  id: string;
  recordId: string;
  source: "practice" | "mock";
  label: string;
  score: string;
  createdAt: string;
  detail: PastExamRecordDetail;
};

type PastExamRecordDetail =
  | {
      kind: "practice";
      record: PracticeRecord;
    }
  | {
      kind: "session";
      session: PracticeSession;
    }
  | {
      kind: "mock-section";
      record: MockRecord;
      section: "sentence" | "email" | "discussion";
      sentenceQuestions?: Question[];
    }
  | {
      kind: "mock-full";
      record: MockRecord;
    };

type DeleteRecordTarget = {
  source: "practice" | "mock" | "session";
  id: string;
  label: string;
};

type RecordContextMenuState = {
  x: number;
  y: number;
  target: DeleteRecordTarget;
};

function compactComparableText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function getPromptScoreKey(type: "email" | "discussion", prompt: unknown) {
  const typedPrompt =
    prompt && typeof prompt === "object"
      ? (prompt as Partial<EmailPrompt & DiscussionPrompt>)
      : ({} as Partial<EmailPrompt & DiscussionPrompt>);

  if (type === "email") {
    const requirements = Array.isArray(typedPrompt.requirements)
      ? typedPrompt.requirements.join(" ")
      : "";

    return compactComparableText(
      [
        getEmailRecipient(typedPrompt as EmailPrompt),
        getEmailSubject(typedPrompt as EmailPrompt),
        typedPrompt.scenario,
        typedPrompt.task,
        requirements,
      ].join(" ")
    );
  }

  return compactComparableText(
    [
      typedPrompt.instruction,
      typedPrompt.professorName,
      typedPrompt.professor,
      typedPrompt.studentOneName,
      typedPrompt.studentOnePost,
      typedPrompt.studentTwoName,
      typedPrompt.studentTwoPost,
      typedPrompt.question,
    ].join(" ")
  );
}

function parsePracticeScore(score: unknown) {
  const match = String(score || "").match(/\d+(?:\.\d+)?/);
  if (!match) return null;

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function getSentenceQuestionKey(question: Partial<Question>) {
  const safeQuestion =
    question && typeof question === "object"
      ? question
      : ({} as Partial<Question>);
  const renderedTarget =
    !safeQuestion.target && Array.isArray(safeQuestion.parts)
      ? cleanDuplicatedPunctuation(
          safeQuestion.parts
            .map((part) => {
              if (!part || typeof part !== "object") return "";
              return part.type === "fixed" ? part.text || "" : part.answer || "";
            })
            .join(" ")
        )
      : "";

  return compactComparableText(
    [
      safeQuestion.contextSpeaker,
      safeQuestion.contextSentence,
      safeQuestion.target || renderedTarget,
    ].join(" ")
  );
}

function getSentenceSetKey(questions: Partial<Question>[]) {
  return questions
    .map((question) => getSentenceQuestionKey(question))
    .filter(Boolean)
    .sort()
    .join(" || ");
}

function isSkippedWritingFeedback(feedback: WritingFeedback | null | undefined) {
  if (!feedback) return true;

  return (
    (feedback.strengths || []).length === 0 &&
    (feedback.problems || []).length === 0 &&
    (feedback.grammarCorrections || []).length === 0 &&
    (feedback.actionPlan || []).length === 0 &&
    !feedback.improvedVersion &&
    !feedback.sampleAnswer
  );
}

function hasRecordedSentenceSection(record: MockRecord) {
  const questions = record.sentence_questions || [];
  if (questions.length === 0) return false;

  const hasAnySentenceAnswer = Object.values(record.sentence_answers || {}).some(
    (answer) => Array.isArray(answer) && answer.length > 0
  );
  const isLegacyWritingOnlyRecord =
    !hasAnySentenceAnswer &&
    Number(record.sentence_score) === 5 &&
    !isSkippedWritingFeedback(record.email_feedback) &&
    !isSkippedWritingFeedback(record.discussion_feedback);

  return !isLegacyWritingOnlyRecord;
}

function isCompleteMockRecord(record: MockRecord) {
  return (
    hasRecordedSentenceSection(record) &&
    !isSkippedWritingFeedback(record.email_feedback) &&
    !isSkippedWritingFeedback(record.discussion_feedback)
  );
}

function isEtsMockRandomRecord(
  record: MockRecord,
  fixedQuestionSets: QuestionSet[]
) {
  if (!isCompleteMockRecord(record)) return false;

  const storedSections = [
    ...(record.sentence_questions || []),
    record.email_prompt,
    record.discussion_prompt,
  ];
  const hasOnlyEtsMockSources = storedSections.every(
    (section) => section?.recordSourceType === "ets_mock"
  );

  if (!hasOnlyEtsMockSources) return false;

  const storedModes = storedSections
    .map((section) => section?.recordPracticeMode)
    .filter((mode): mode is "fixed" | "random" => Boolean(mode));

  if (storedModes.includes("random")) return true;
  if (storedModes.includes("fixed")) return false;

  // Older records did not persist the launch mode. Exact set matches are
  // fixed-set attempts; other records made entirely from ETS Mock are random.
  return !fixedQuestionSets.some((questionSet) =>
    isMockRecordForQuestionSet(record, questionSet)
  );
}

// A summary of a single practice session. These rows are persisted to the
// signed-in user's cloud account to provide a unified view across devices.
// Each session includes the type of practice performed,
// the total duration in seconds, the score achieved (or "未完成" if the
// session was not completed), and the date/time when the session started.
type PracticeSession = {
  id: string;
  type: 'sentence' | 'email' | 'discussion' | 'mock';
  duration: number;
  score: number | string;
  date: string;
  sourceType?: "forge_ai" | "past_exam" | "ets_mock";
  prompt?: EmailPrompt | DiscussionPrompt | Record<string, unknown>;
  answer?: string;
};

type PracticeSessionRow = {
  client_session_id: string;
  practice_type: PracticeSession["type"];
  duration_seconds: number;
  score: string | null;
  status: "completed" | "ungraded" | "abandoned";
  source_type: "forge_ai" | "past_exam" | "ets_mock";
  started_at: string;
  prompt: EmailPrompt | DiscussionPrompt | Record<string, unknown> | null;
  answer: string | null;
};

function getPracticeSessionStatus(
  score: PracticeSession["score"]
): PracticeSessionRow["status"] {
  if (score === "未完成") return "abandoned";
  if (score === "未批改") return "ungraded";
  return "completed";
}

function toPracticeSessionRow(session: PracticeSession, userId: string) {
  return {
    user_id: userId,
    client_session_id: session.id,
    practice_type: session.type,
    duration_seconds: Math.max(0, Math.round(session.duration || 0)),
    score: String(session.score),
    status: getPracticeSessionStatus(session.score),
    source_type: session.sourceType || "forge_ai",
    started_at: session.date,
    prompt: session.prompt || null,
    answer: session.answer || null,
  };
}
const EMAIL_SCORING_COST = 1;
const DISCUSSION_SCORING_COST = 1;
// Format a duration in seconds as minutes:seconds (e.g., 5:07).  This helper
// is used to display elapsed times for single practice sessions.  If seconds
// is undefined or negative, it returns "0:00".
function formatDuration(seconds: number): string {
  const secs = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(secs / 60);
  const rest = secs % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}


const sampleEmailPrompt: EmailPrompt = {
  title: "Email Writing Practice",
  subject: "A Stress Management Tip That Might Help",
  scenario:
    "You are a university student, and you participated in a recent campus workshop about stress management. There was a particular technique or activity from the workshop that you found especially effective in reducing your stress. You think this might be helpful to your friend, Sarah, who has been feeling overwhelmed with her workload lately.",
  task: "Write an email to Sarah. In your email, do the following:",
  requirements: [
    "Share the specific stress management technique or activity you learned.",
    "Describe how it helped you manage your stress.",
    "Suggest that Sarah can try it when she feels overwhelmed.",
  ],
  suggestedLength: "Recommended length: 100–150 words",
};


const sampleDiscussionPrompt: DiscussionPrompt = {
  title: "Academic Discussion Practice",
  instruction:
    "Your professor is teaching a class on sociology. Write a post responding to the professor's question. In your response, you should\n· express and support your personal opinion\n· make a contribution to the discussion in your own words\nAn effective response will contain at least 100 words. You have ten minutes to write.",
  professorName: "Doctor Achebe",
  professor:
    "We've been discussing government budgets and the difficult decisions governments must make regarding the use of public funds. Some services are clearly essential and must be paid for by any government. But what about public funding of the arts? Do you believe that governments should provide financial support to artists-for example, painters, sculptors, musicians, or filmmakers? Why or why not?",
  studentOneName: "Claire",
  studentOnePost:
    "I don't think taxpayers' money should be spent on impractical or inessential services. Artists should support themselves by selling their work to private individuals and companies.",
  studentTwoName: "Paul",
  studentTwoPost:
    "I think art is essential. Public spaces in my hometown would not be the same without statues, murals, and other artwork that residents and visitors enjoy.",
  question:
    "Do you believe that governments should provide financial support to artists? Why or why not?",
  suggestedLength: "Recommended length: at least 100 words",
};



const fallbackQuestions: Question[] = [
  {
    id: 1,
    contextSpeaker: "A",
    contextSentence: "What was the highlight of your trip?",
    answerSpeaker: "B",
    target: "The tour guides who showed us around the old city were fantastic.",
    parts: [
      { type: "fixed", text: "The" },
      { type: "blank", answer: "tour guides" },
      { type: "blank", answer: "who" },
      { type: "blank", answer: "showed" },
      { type: "blank", answer: "us around" },
      { type: "blank", answer: "the old city" },
      { type: "blank", answer: "were" },
      { type: "fixed", text: "fantastic." },
    ],
    chunks: ["tour guides", "who", "showed", "us around", "the old city", "were"],
    explanation:
      "A asks about the highlight of the trip. B answers with a noun phrase followed by a relative clause.",
  },
  {
    id: 2,
    contextSpeaker: "A",
    contextSentence: "I heard Anna got a promotion.",
    answerSpeaker: "B",
    target: "Do you know if she will be moving to a different department?",
    parts: [
      { type: "blank", answer: "do you" },
      { type: "blank", answer: "know" },
      { type: "blank", answer: "if" },
      { type: "fixed", text: "she" },
      { type: "blank", answer: "will be" },
      { type: "blank", answer: "moving" },
      { type: "blank", answer: "to" },
      { type: "blank", answer: "a different department" },
      { type: "fixed", text: "?" },
    ],
    chunks: [
      "do you",
      "know",
      "if",
      "will be",
      "moving",
      "to",
      "a different department",
    ],
    explanation:
      "B asks a follow-up question about Anna's promotion using Do you know if...",
  },
  {
    id: 3,
    contextSpeaker: "A",
    contextSentence: "We're planning a trip to the mountains next weekend.",
    answerSpeaker: "B",
    target: "Can you tell me whether the cabins will be available?",
    parts: [
      { type: "blank", answer: "can you" },
      { type: "fixed", text: "tell me" },
      { type: "blank", answer: "whether" },
      { type: "blank", answer: "the cabins" },
      { type: "blank", answer: "will be" },
      { type: "blank", answer: "available" },
      { type: "fixed", text: "?" },
    ],
    chunks: ["can you", "whether", "the cabins", "will be", "available"],
    explanation:
      "B makes a polite indirect question using Can you tell me whether...",
  },
  {
    id: 4,
    contextSpeaker: "A",
    contextSentence: "What did Maria ask you about the book you're reading?",
    answerSpeaker: "B",
    target: "She wanted to know where she could buy a copy.",
    parts: [
      { type: "fixed", text: "She" },
      { type: "blank", answer: "wanted" },
      { type: "blank", answer: "to know" },
      { type: "blank", answer: "where" },
      { type: "blank", answer: "she could" },
      { type: "blank", answer: "buy" },
      { type: "blank", answer: "a copy" },
      { type: "fixed", text: "." },
    ],
    chunks: ["wanted", "to know", "where", "she could", "buy", "a copy"],
    explanation:
      "B reports Maria's question using wanted to know where...",
  },
  {
    id: 5,
    contextSpeaker: "A",
    contextSentence: "The museum exhibition opens next month.",
    answerSpeaker: "B",
    target: "Do you know how much tickets will cost?",
    parts: [
      { type: "blank", answer: "do you" },
      { type: "blank", answer: "know" },
      { type: "blank", answer: "how" },
      { type: "blank", answer: "much" },
      { type: "blank", answer: "tickets" },
      { type: "blank", answer: "will cost" },
      { type: "fixed", text: "?" },
    ],
    chunks: ["do you", "know", "how", "much", "tickets", "will cost"],
    explanation:
      "B asks an indirect question about price using Do you know how much...",
  },
];

function shuffle<T>(list: T[]) {
  const result = [...list];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    const temp = result[index];

    result[index] = result[randomIndex];
    result[randomIndex] = temp;
  }

  return result;
}

function cleanAnswer(text: string) {
  return text
    .replace(/[,.!?;:]+$/g, "")
    .replace(/^[,.!?;:]+/g, "")
    .trim()
    .toLowerCase();
}

function getBlankAnswers(question: Question) {
  return question.parts
    .filter(
      (part): part is { type: "blank"; answer: string } =>
        part.type === "blank"
    )
    .map((part) => cleanAnswer(part.answer));
}

function makeChunks(question: Question) {
  return getBlankAnswers(question).map((text, index) => ({
    id: `${question.id}-${index}-${text}`,
    text,
  }));
}

function makeEmptySlots(question: Question) {
  const blankCount = getBlankAnswers(question).length;
  return Array(blankCount).fill(null) as (Chunk | null)[];
}

function createInitialSlots(questionList: Question[]) {
  const record: Record<number, (Chunk | null)[]> = {};

  questionList.forEach((question) => {
    record[question.id] = makeEmptySlots(question);
  });

  return record;
}

function createBankOrders(questionList: Question[]) {
  const record: Record<number, Chunk[]> = {};

  questionList.forEach((question) => {
    record[question.id] = shuffle(makeChunks(question));
  });

  return record;
}

function isValidPart(part: unknown): part is Part {
  if (!part || typeof part !== "object") return false;

  const candidate = part as Partial<Part>;

  if (candidate.type === "fixed") {
    return typeof candidate.text === "string";
  }

  if (candidate.type === "blank") {
    return typeof candidate.answer === "string";
  }

  return false;
}

function normalizeQuestions(apiQuestions: Partial<Question>[]) {
  return apiQuestions
    .map((question, index) => {
      const validParts = Array.isArray(question.parts)
        ? question.parts.filter(isValidPart)
        : [];

      if (
        !question.target ||
        !question.contextSentence ||
        validParts.length === 0 ||
        validParts.filter((part) => part.type === "blank").length === 0
      ) {
        return null;
      }

      const splitParts = validParts.flatMap(splitPunctuationFromPart);

      const finalPartsWithPunctuation = dedupePunctuationParts(
        addPunctuationFromTarget(splitParts, question.target)
      );

      return {
        id: index + 1,
        contextSpeaker: question.contextSpeaker || "A",
        contextSentence: question.contextSentence,
        answerSpeaker: question.answerSpeaker || "B",
        target: cleanDuplicatedPunctuation(question.target),
        parts: finalPartsWithPunctuation,
        chunks: getBlankAnswers({
          id: index + 1,
          contextSpeaker: question.contextSpeaker || "A",
          contextSentence: question.contextSentence,
          answerSpeaker: question.answerSpeaker || "B",
          target: question.target,
          parts: finalPartsWithPunctuation,
          chunks: [],
          explanation: question.explanation || "",
        }),
        explanation:
          question.explanation ||
          "This question tests sentence structure and logical connection between two speakers.",
      };
    })
    .filter((question): question is Question => question !== null);
}
async function generateQuestionsFromAPI(
  count: number,
  level: string,
  topic: string,
  chargePoints = true
) {
  const collected: Question[] & Partial<CreditBalance> = [];
  const usedTargets = new Set<string>(
    fallbackQuestions.map((q) =>
      cleanDuplicatedPunctuation(q.target).toLowerCase()
    )
  );
  const maxAttempts = 4;

  for (let attempt = 0; attempt < maxAttempts && collected.length < count; attempt += 1) {
    const remaining = count - collected.length;
    const randomSeed = `${Date.now()}-${attempt}-${Math.random()
      .toString(36)
      .slice(2)}`;

    const {
      data: { session },
    } = await supabase.auth.getSession();

    const response = await fetch("/api/generate-sentences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {}),
      },
      body: JSON.stringify({
      count: remaining,
      level,
      topic,
      randomSeed,
      chargePoints: chargePoints && attempt === 0,
      excludeTargets: Array.from(usedTargets),
      designRules: {
        blankRange:
          level === "Hard"
            ? { min: 7, max: 8 }
            : level === "Medium"
            ? { min: 6, max: 7 }
            : { min: 5, max: 6 },
        minFixedParts:
          level === "Hard" ? 3 : level === "Medium" ? 3 : 2,
        requireCommaAnchor: true,
        avoidOverBlanking: true,
        fixedWhenAmbiguous: true,
        ruleText:
          "Keep about 5 to 7 blanks regardless of difficulty. Difficulty should come from sentence complexity, not the number of blanks. If a word or phrase is too flexible in position, likely to cause multiple valid answers, or needed as a clue for logic, keep it as fixed text.",
      },
      knowledgeCategories: [
        "从句",
        "短语搭配",
        "连词使用",
        "句型结构",
        "时态一致",
      ],
    }),
  })
  if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || "API request failed");
    }

    const data = await response.json();

    if (!Array.isArray(data.questions)) {
      throw new Error("Invalid API response");
    }

    if (typeof data.balance === "number") {
      collected.balance = data.balance;
      collected.temporaryBalance = data.temporaryBalance;
      collected.permanentBalance = data.permanentBalance;
    }

    const normalized = normalizeQuestions(data.questions as Partial<Question>[]);

    for (const question of normalized) {
      const targetKey = cleanDuplicatedPunctuation(question.target).toLowerCase();

      if (!usedTargets.has(targetKey)) {
        usedTargets.add(targetKey);

        collected.push({
          ...question,
          id: collected.length + 1,
          target: cleanDuplicatedPunctuation(question.target),
          parts: dedupePunctuationParts(question.parts),
        });
      }

      if (collected.length >= count) break;
    }
  }

  if (collected.length < count) {
    throw new Error(
      `AI only generated ${collected.length} valid questions, but ${count} were requested.`
    );
  }

  const questions = collected.slice(0, count) as Question[] & {
    balance?: number;
    temporaryBalance?: number;
    permanentBalance?: number;
  };
  questions.balance = collected.balance;
  questions.temporaryBalance = collected.temporaryBalance;
  questions.permanentBalance = collected.permanentBalance;

  return questions;
}

async function generateEmailPromptWithAPI(
  level: string,
  topic: string,
  personalizedRecommendationId?: string
) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const response = await fetch("/api/generate-email-prompt", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {}),
    },
    body: JSON.stringify({
      level,
      topic,
      personalizedRecommendationId,
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || "Failed to generate email prompt");
  }

  return (await response.json()) as EmailPrompt;
}

async function generateAcademicDiscussionWithAPI(
  level: string,
  topic: string,
  personalizedRecommendationId?: string
) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const response = await fetch("/api/generate-academic-discussion", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {}),
    },
    body: JSON.stringify({
      level,
      topic,
      personalizedRecommendationId,
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || "Failed to generate academic discussion prompt");
  }

  return (await response.json()) as DiscussionPrompt;
}

async function requestPersonalizedPractice(
  body: Record<string, unknown>
): Promise<{
  profile?: PersonalizedProfile;
  recommendation?: PersonalizedRecommendation;
}> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("请先登录后再使用个性化练习。");
  }

  const response = await fetch("/api/personalized-practice", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || "个性化练习暂时无法加载，请稍后重试。");
  }
  return data;
}

async function startSelectedMockTestWithAPI(
  selectedTypes: PastExamPracticeType[],
  level = "Medium",
  topic = "Mixed"
) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("Please sign in before starting this practice.");
  }

  const response = await fetch("/api/start-mock-test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ level, topic, selectedTypes }),
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Failed to start this practice");
  }

  return data as MockTestData;
}

async function scoreEmailWritingWithAPI(
  prompt: unknown,
  answer: string,
  sessionId?: string
) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("Please sign in before using AI scoring.");
  }

  const response = await fetch("/api/score-email-writing", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      prompt,
      answer,
      sessionId,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Failed to score email writing");
  }

  return data as WritingFeedback & {
    balance?: number;
    cost?: number;
  };
}

async function scoreAcademicDiscussionWithAPI(
  prompt: unknown,
  answer: string,
  sessionId?: string
) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("Please sign in before using AI scoring.");
  }

  const response = await fetch("/api/score-academic-discussion", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      prompt,
      answer,
      sessionId,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Failed to score academic discussion");
  }

  return data as WritingFeedback & {
    balance?: number;
    cost?: number;
  };
}

function isQuestionComplete(slots: (Chunk | null)[]) {
  return slots.every((slot: Chunk | null) => slot !== null);
}



function normalizeSentenceText(text: string) {
  return text
    .replace(/[.,!?;:，。！？；：]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function splitPunctuationFromPart(part: Part): Part[] {
  if (part.type !== "blank") return [part];

  const match = part.answer.match(/^(.+?)([.,!?;:，。！？；：]+)$/);

  if (!match) return [part];

  return [
    {
      type: "blank",
      answer: match[1].trim(),
    },
    {
      type: "fixed",
      text: match[2],
    },
  ];
}

function addPunctuationFromTarget(parts: Part[], target: string): Part[] {
  if (!target) return parts;

  const result: Part[] = [];
  let cursor = 0;

  parts.forEach((part, partIndex) => {
    result.push(part);

    const text = part.type === "fixed" ? part.text : part.answer;
    const index = target.toLowerCase().indexOf(text.toLowerCase(), cursor);

    if (index === -1) return;

    cursor = index + text.length;

    const punctuationMatch = target
      .slice(cursor)
      .match(/^\s*([.,!?;:，。！？；：]+)/);

    if (!punctuationMatch) return;

    const last = result[result.length - 1];
    const next = parts[partIndex + 1];

    const lastAlreadyHasPunctuation =
      last?.type === "fixed" &&
      /[.,!?;:，。！？；：]$/.test(last.text.trim());

    const nextIsPunctuation =
      next?.type === "fixed" && isPunctuationOnly(next.text);

    if (!lastAlreadyHasPunctuation && !nextIsPunctuation) {
      result.push({
        type: "fixed",
        text: punctuationMatch[1],
      });
    }

    cursor += punctuationMatch[0].length;
  });

  return dedupePunctuationParts(result);
}

function isPunctuationOnly(text: string) {
  return /^[.,!?;:，。！？；：]+$/.test(text.trim());
}

function cleanDuplicatedPunctuation(text: string) {
  return text
    .replace(/\s+([.,!?;:，。！？；：])/g, "$1")
    .replace(/([.!?。！？])\1+/g, "$1")
    .replace(/([,;:，；：])\1+/g, "$1")
    .trim();
}

function dedupePunctuationParts(parts: Part[]): Part[] {
  const result: Part[] = [];

  for (const part of parts) {
    const previous = result[result.length - 1];

    if (
      part.type === "fixed" &&
      previous?.type === "fixed" &&
      isPunctuationOnly(part.text) &&
      isPunctuationOnly(previous.text)
    ) {
      previous.text = part.text;
      continue;
    }

    if (
      part.type === "fixed" &&
      previous?.type === "fixed" &&
      /[.,!?;:，。！？；：]$/.test(previous.text.trim()) &&
      isPunctuationOnly(part.text)
    ) {
      continue;
    }

    result.push(part);
  }

  return result;
}


function buildFullAnswerFromSlots(question: Question, slots: (Chunk | null)[]) {
  let blankIndex = 0;

  return question.parts
    .map((part, partIndex) => {
      if (part.type === "fixed") {
        return getDisplayedFixedText(question, partIndex, part.text || "");
      }

      const slotIndex = blankIndex;
      const slot = slots[slotIndex];
      blankIndex += 1;

      return getDisplayedChunkText(question, slotIndex, slot);
    })
    .join(" ")
    .replace(/\s+([.,!?;:，。！？；：])/g, "$1")
    .replace(/([.!?。！？])\1+/g, "$1")
    .replace(/([,;:，；：])\1+/g, "$1")
    .trim();
  }

function capitalizeFirstLetter(text: string) {
  return text.replace(/[A-Za-z]/, (letter) => letter.toUpperCase());
}

function normalizeChunkDisplayText(text: string) {
  return text
    .toLowerCase()
    .replace(/\bi\b/g, "I");
}

function isFirstAnswerTextPart(question: Question, targetPartIndex: number) {
  for (let index = 0; index < question.parts.length; index += 1) {
    const part = question.parts[index];

    if (part.type === "fixed" && /[A-Za-z0-9]/.test(part.text)) {
      return index === targetPartIndex;
    }

    if (part.type === "blank") {
      return index === targetPartIndex;
    }
  }

  return false;
}

function getDisplayedFixedText(question: Question, partIndex: number, text: string) {
  return isFirstAnswerTextPart(question, partIndex)
    ? capitalizeFirstLetter(text)
    : text;
}

function isFirstSentenceBlank(question: Question, targetSlotIndex: number) {
  let blankIndex = 0;
  let hasSeenSentenceText = false;

  for (const part of question.parts) {
    if (part.type === "fixed") {
      if (/[A-Za-z0-9]/.test(part.text)) {
        hasSeenSentenceText = true;
      }

      continue;
    }

    if (part.type === "blank") {
      if (blankIndex === targetSlotIndex) {
        return !hasSeenSentenceText;
      }

      hasSeenSentenceText = true;
      blankIndex += 1;
    }
  }

  return false;
}

function getDisplayedChunkText(
  question: Question,
  slotIndex: number,
  chunk: Chunk | null
) {
  if (!chunk) return "";

  const baseText = normalizeChunkDisplayText(chunk.text);

  return isFirstSentenceBlank(question, slotIndex)
    ? capitalizeFirstLetter(baseText)
    : baseText;
}

function isQuestionCorrect(question: Question, slots: (Chunk | null)[]) {
  const userFullAnswer = buildFullAnswerFromSlots(question, slots);

  return normalizeSentenceText(userFullAnswer) === normalizeSentenceText(question.target);
}




function renderFullAnswer(question: Question) {
  return cleanDuplicatedPunctuation(
    question.parts
      .map((part) => {
        if (part.type === "fixed") return part.text;
        return part.answer;
      })
      .join(" ")
  );
}

function countWords(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

type PastExamRandomSetCandidate = {
  date: string;
  sentenceEntries: {
    questionSet: QuestionSet;
    task: Extract<QuestionSetTask, { type: "sentence" }>;
  }[];
  emailEntries: {
    questionSet: QuestionSet;
    task: Extract<QuestionSetTask, { type: "email" }>;
  }[];
  discussionEntries: {
    questionSet: QuestionSet;
    task: Extract<QuestionSetTask, { type: "discussion" }>;
  }[];
};

function getPastExamRandomSetCandidates(questionSets: QuestionSet[]) {
  const groups = new Map<string, PastExamRandomSetCandidate>();

  questionSets.forEach((questionSet) => {
    const date = questionSet.display_date || "";
    if (!date) return;

    const group = groups.get(date) || {
      date,
      sentenceEntries: [],
      emailEntries: [],
      discussionEntries: [],
    };

    (questionSet.content.tasks || []).forEach((task) => {
      if (task.type === "sentence" && task.questions.length > 0) {
        group.sentenceEntries.push({ questionSet, task });
      } else if (task.type === "email") {
        group.emailEntries.push({ questionSet, task });
      } else if (task.type === "discussion") {
        group.discussionEntries.push({ questionSet, task });
      }
    });

    groups.set(date, group);
  });

  return Array.from(groups.values()).filter(
    (group) =>
      group.sentenceEntries.length > 0 &&
      group.emailEntries.length > 0 &&
      group.discussionEntries.length > 0
  );
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState("");
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [points, setPoints] = useState(0);
  const [temporaryPoints, setTemporaryPoints] = useState(0);
  const [permanentPoints, setPermanentPoints] = useState(0);
  const [creditCheckInDates, setCreditCheckInDates] = useState<string[]>([]);
  const [claimedCreditMilestones, setClaimedCreditMilestones] = useState<
    number[]
  >([]);
  const [records, setRecords] = useState<PracticeRecord[]>([]);
  const [, setIsLoadingRecords] = useState(false);
  const [, setRecordMessage] = useState("");
  const [mockTestData, setMockTestData] = useState<MockTestData | null>(null);
  const [selectedPastExamId, setSelectedPastExamId] = useState("");
  const [selectedEtsMockId, setSelectedEtsMockId] = useState("");
  const [isEtsMockPreviewOpen, setIsEtsMockPreviewOpen] = useState(false);
  const [pastExamActiveBank, setPastExamActiveBank] =
    useState<PastExamPracticeType | null>(null);
  const [selectedPastExamPreview, setSelectedPastExamPreview] =
    useState<PastExamPreviewSelection | null>(null);
  const [selectedPastExamRecordDetail, setSelectedPastExamRecordDetail] =
    useState<PastExamRecordDetail | null>(null);
  const [practiceReturnPage, setPracticeReturnPage] = useState<Page>("home");
  const [pastExamPreviewBackPage, setPastExamPreviewBackPage] =
    useState<Page>("past-exam");
  const [pastExamPreviewRestoreState, setPastExamPreviewRestoreState] =
    useState<EtsStylePreviewRestoreState | null>(null);
  const [pastExamDetailBackPage, setPastExamDetailBackPage] =
    useState<Page>("past-exam");
  const [etsMockDetailBackPage, setEtsMockDetailBackPage] =
    useState<Page>("ets-mock-practice");
  const [pastExamBankBackPage, setPastExamBankBackPage] =
    useState<Page>("past-exam");
  const [openPastExamRandomOnEnter, setOpenPastExamRandomOnEnter] =
    useState(false);
  const [etsStyleInitialPage, setEtsStyleInitialPage] =
    useState<EtsStylePreviewPageKey>(() => {
      const path = window.location.pathname;

      if (path === "/store") return "store";
      if (path === "/analytics") return "analytics";
      if (path === "/support-center") return "support";
      if (path === "/mock-records") return "library";
      if (path === "/records" || path === "/practice-sessions") return "ai";

      return "ai";
    });
  const [etsStyleInitialLibraryTab, setEtsStyleInitialLibraryTab] =
    useState<"past" | "mock">("past");
  const [etsStyleInitialPastBank, setEtsStyleInitialPastBank] =
    useState<PastExamPracticeType | null>(null);
  const [etsStyleInitialTopicFilter, setEtsStyleInitialTopicFilter] =
    useState("all");
  const [etsStyleInitialCompletionFilter, setEtsStyleInitialCompletionFilter] =
    useState<"all" | "done" | "undone">("all");
  const [etsStyleInitialSortOrder, setEtsStyleInitialSortOrder] =
    useState<"desc" | "asc">("desc");
  const [etsStyleInitialBankPage, setEtsStyleInitialBankPage] = useState(1);
  const [etsStyleInitialPastSearchType, setEtsStyleInitialPastSearchType] =
    useState<EtsStylePastSearchType>("Build a Sentence");
  const [etsStyleInitialPastSearchInput, setEtsStyleInitialPastSearchInput] =
    useState("");
  const [etsStyleInitialAppliedPastSearch, setEtsStyleInitialAppliedPastSearch] =
    useState("");
  const pastExamScrollYRef = useRef(0);
  const [pastExamSets, setPastExamSets] = useState<QuestionSet[]>([]);
  const [etsMockSets, setEtsMockSets] = useState<QuestionSet[]>([]);
  const [questionAttempts, setQuestionAttempts] = useState<QuestionAttempt[]>([]);
  const [isLoadingQuestionSets, setIsLoadingQuestionSets] = useState(false);
  const [questionSetMessage, setQuestionSetMessage] = useState("");
  const [activeQuestionSetId, setActiveQuestionSetId] = useState("");
  const [activeQuestionSourceType, setActiveQuestionSourceType] = useState<
    "past_exam" | "ets_mock" | ""
  >("");
  const [activePersonalizedRecommendationId, setActivePersonalizedRecommendationId] =
    useState("");

  // ---------------------------------------------------------------------------
  // Authorization flags
  //
  // The Official Questions library and ETS mock practice each require a paid
  // subscription before a user can access the question set.  Users with
  // authorization flags stored on their profile can bypass the paywall and
  // access the practice lists directly.  If no flags are present (or the
  // profile table does not define them), we assume the user has not yet been
  // granted access and show a purchase/contact screen instead.  These flags
  // are loaded when the authenticated user changes.
  const [hasPastExamAccess, setHasPastExamAccess] = useState(false);
  const [isProAccount, setIsProAccount] = useState(false);
  const [subscriptionExpiresAt, setSubscriptionExpiresAt] = useState<
    string | null
  >(null);
  const [unlockedEtsMockIds, setUnlockedEtsMockIds] = useState<string[]>([]);


  useEffect(() => {

  function handleHashChange() {

    const hash = window.location.hash.replace("#/", "");

    if (hash === "past-exam") {

      setPageState("past-exam");

      return;

    }

    if (hash === "ets-mock-practice") {

      setPageState("ets-mock-practice");

      return;

    }

    if (hash === "ets-style-preview") {

      setPageState("ets-style-preview");

      return;

    }

    if (hash === "records") {
      setEtsStyleInitialPage("ai");
      setPageState("ets-style-preview");

      return;

    }

    if (hash === "mock-records") {
      setEtsStyleInitialPage("library");
      setEtsStyleInitialLibraryTab("past");
      setPageState("ets-style-preview");

      return;

    }

    setEtsStyleInitialPage("ai");
    setPageState("ets-style-preview");

  }

  window.addEventListener("hashchange", handleHashChange);

  return () => {

    window.removeEventListener("hashchange", handleHashChange);

  };

}, []);

  const [mockSentenceSlots, setMockSentenceSlots] = useState<
    Record<number, (Chunk | null)[]>
  >({});
  const [mockSentenceBanks, setMockSentenceBanks] = useState<
    Record<number, Chunk[]>
  >({});
  const [mockDragged, setMockDragged] = useState<DraggedChunk | null>(null); 


  const [mockEmailAnswer, setMockEmailAnswer] = useState("");
  const [mockDiscussionAnswer, setMockDiscussionAnswer] = useState("");
  const [mockResult, setMockResult] = useState<MockResult | null>(null);
  const [isSubmittingMock, setIsSubmittingMock] = useState(false);
  const [mockMessage, setMockMessage] = useState("");
  const [mockRecords, setMockRecords] = useState<MockRecord[]>([]);
  const [, setIsLoadingMockRecords] = useState(false);
  const [, setMockRecordMessage] = useState("");
  const [recordContextMenu, setRecordContextMenu] =
    useState<RecordContextMenuState | null>(null);
  const [showPointsModal, setShowPointsModal] = useState(false);

  // -------------------------------------------------------------------------
  // Cloud practice session tracking
  //
  // The app collects summary information for every practice session (single
  // sentence, email, discussion or full mock test).  Each session records
  // when it started, how long the user spent (in seconds), the resulting
  // score (or "未完成" if the session was abandoned), and the date.  These
  // sessions are stored in Supabase so they follow the signed-in account.
  // The localStorage reader below exists only to migrate older local records.
  const [practiceSessions, setPracticeSessions] = useState<PracticeSession[]>([]);
  // Start timestamps for each practice type.  When a session begins we record
  // the current time; when it ends we compute the duration and reset the
  // timestamp back to null.
  const [sentenceStartTime, setSentenceStartTime] = useState<number | null>(null);
  const [emailStartTime, setEmailStartTime] = useState<number | null>(null);
  const [discussionStartTime, setDiscussionStartTime] = useState<number | null>(null);
  const [mockStartTime, setMockStartTime] = useState<number | null>(null);
  // A timer used to update the elapsed seconds for the currently active
  // practice.  This value is updated once per second when a practice page
  // is active and a start time is defined.  Other pages reset it to 0.
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [practiceTimerMode, setPracticeTimerMode] = useState<"countup" | "countdown">(
    "countup"
  );
  const [activePracticeType, setActivePracticeType] = useState<
    "sentence" | "email" | "discussion" | null
  >(null);
  const [countdownLeft, setCountdownLeft] = useState<number | null>(null);
  const [singlePauseStartedAt, setSinglePauseStartedAt] = useState<number | null>(
    null
  );
  const [showSinglePauseModal, setShowSinglePauseModal] = useState(false);

  const singlePracticeDurations = {
    sentence: 6 * 60 + 50,
    email: 7 * 60,
    discussion: 10 * 60,
  };

  useEffect(() => {
    if (!user) {
      setPracticeSessions([]);
      return;
    }

    const userId = user.id;
    let cancelled = false;

    async function syncPracticeSessions() {
      let localSessions: PracticeSession[] = [];
      let localMigrationFailed = false;

      try {
        const accountStored = localStorage.getItem(
          `practiceSessions:${userId}`
        );
        const accountSessions = accountStored
          ? (JSON.parse(accountStored) as PracticeSession[])
          : [];
        const legacyOwner = localStorage.getItem("practiceSessionsLegacyOwner");
        const legacyStored = localStorage.getItem("practiceSessions");
        const legacySessions =
          legacyStored && (!legacyOwner || legacyOwner === userId)
            ? (JSON.parse(legacyStored) as PracticeSession[])
            : [];
        const mergedLocal = new Map<string, PracticeSession>();
        [...accountSessions, ...legacySessions].forEach((session) =>
          mergedLocal.set(session.id, session)
        );
        localSessions = Array.from(mergedLocal.values());
      } catch {
        localSessions = [];
      }

      if (localSessions.length > 0) {
        const { error: uploadError } = await supabase
          .from("practice_sessions")
          .upsert(
            localSessions.map((session) =>
              toPracticeSessionRow(session, userId)
            ),
            { onConflict: "user_id,client_session_id" }
          );

        if (uploadError) {
          localMigrationFailed = true;
          console.error("Failed to upload local practice sessions:", uploadError);
        } else {
          try {
            localStorage.removeItem(`practiceSessions:${userId}`);
            if (
              !localStorage.getItem("practiceSessionsLegacyOwner") ||
              localStorage.getItem("practiceSessionsLegacyOwner") === userId
            ) {
              localStorage.removeItem("practiceSessions");
              localStorage.removeItem("practiceSessionsLegacyOwner");
            }
          } catch {
            // The cloud copy is authoritative even if cleanup is unavailable.
          }
        }
      }

      const { data, error } = await supabase
        .from("practice_sessions")
        .select(
          "client_session_id, practice_type, duration_seconds, score, status, source_type, started_at, prompt, answer"
        )
        .eq("user_id", userId)
        .order("started_at", { ascending: false });

      if (error) {
        console.error("Failed to load cloud practice sessions:", error);
        return;
      }

      if (cancelled) return;

      const merged = new Map<string, PracticeSession>();
      if (localMigrationFailed) {
        localSessions.forEach((session) => merged.set(session.id, session));
      }
      ((data || []) as PracticeSessionRow[]).forEach((row) => {
        merged.set(row.client_session_id, {
          id: row.client_session_id,
          type: row.practice_type,
          duration: row.duration_seconds,
          score: row.score ?? "未批改",
          date: row.started_at,
          sourceType: row.source_type || "forge_ai",
          prompt: row.prompt || undefined,
          answer: row.answer || undefined,
        });
      });

      setPracticeSessions(
        Array.from(merged.values()).sort(
          (left, right) => Date.parse(right.date) - Date.parse(left.date)
        )
      );
    }

    void syncPracticeSessions();

    return () => {
      cancelled = true;
    };
  }, [user]);

  // Update the elapsed seconds timer based on the currently active practice
  // session.  The timer observes the start timestamps directly rather than
  // relying on the current page.  When a practice starts, the corresponding
  // start time is set; when the session ends, that start time is reset to
  // null.  The effect creates a single interval that updates once per
  // second while any start time is active.
  useEffect(() => {
    let timer: number | undefined;
    function update() {
      if (singlePauseStartedAt !== null) return;

      if (sentenceStartTime !== null) {
        setElapsedSeconds(Math.floor((Date.now() - sentenceStartTime) / 1000));
      } else if (emailStartTime !== null) {
        setElapsedSeconds(Math.floor((Date.now() - emailStartTime) / 1000));
      } else if (discussionStartTime !== null) {
        setElapsedSeconds(Math.floor((Date.now() - discussionStartTime) / 1000));
      } else if (mockStartTime !== null) {
        setElapsedSeconds(Math.floor((Date.now() - mockStartTime) / 1000));
      } else {
        setElapsedSeconds(0);
      }
    }
    // Only set up a timer if at least one session has started
    if (sentenceStartTime !== null || emailStartTime !== null || discussionStartTime !== null || mockStartTime !== null) {
      update();
      timer = window.setInterval(update, 1000);
    } else {
      setElapsedSeconds(0);
    }
    return () => {
      if (timer !== undefined) {
        clearInterval(timer);
      }
    };
  }, [
    sentenceStartTime,
    emailStartTime,
    discussionStartTime,
    mockStartTime,
    singlePauseStartedAt,
  ]);

  // Helper to add a completed session to the list.  Accepts the practice
  // type (sentence/email/discussion/mock), the duration in seconds, and
  // the score achieved (as a number or the string "未完成").  A unique
  // identifier and the current ISO timestamp are generated automatically.
  function addPracticeSession(
    type: 'sentence' | 'email' | 'discussion' | 'mock',
    duration: number,
    score: number | string,
    content?: Pick<PracticeSession, "prompt" | "answer">
  ) {
    const newSession: PracticeSession = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type,
      duration,
      score,
      date: new Date().toISOString(),
      sourceType: activeQuestionSourceType || "forge_ai",
      ...content,
    };
    setPracticeSessions((prev) => [newSession, ...prev]);

    if (user) {
      void supabase
        .from("practice_sessions")
        .upsert(toPracticeSessionRow(newSession, user.id), {
          onConflict: "user_id,client_session_id",
        })
        .then(({ error }) => {
          if (error) {
            console.error("Failed to save practice session:", error);
          }
        });
    }

    return newSession;
  }

  function updatePracticeSessionScore(
    sessionId: string,
    score: number | string
  ) {
    if (!sessionId) return;

    setPracticeSessions((current) =>
      current.map((session) =>
        session.id === sessionId ? { ...session, score } : session
      )
    );

    if (user) {
      void supabase
        .from("practice_sessions")
        .update({
          score: String(score),
          status: getPracticeSessionStatus(score),
        })
        .eq("user_id", user.id)
        .eq("client_session_id", sessionId)
        .then(({ error }) => {
          if (error) {
            console.error("Failed to update practice session:", error);
          }
        });
    }
  }


  const [page, setPageState] = useState<Page>(() => {

  const path = window.location.pathname;

  if (path === "/") return "ets-style-preview";

  if (path === "/past-exam/preview") return "past-exam-preview";

  if (path === "/past-exam") return "past-exam";

  if (path.startsWith("/past-exam/")) return "past-exam-detail";

  if (path === "/ets-mock-practice") return "ets-mock-practice";

  if (path.startsWith("/ets-mock-practice/")) return "ets-mock-detail";

  if (path === "/store") return "ets-style-preview";

  if (path === "/scoring-guide/email") return "scoring-guide-email";

  if (path === "/scoring-guide/discussion") return "scoring-guide-discussion";

  if (
    path === "/analytics" ||
    path === "/records" ||
    path === "/mock-records" ||
    path === "/practice-sessions"
  ) {
    return "ets-style-preview";
  }

  return "ets-style-preview";

});

useEffect(() => {

  const handlePopState = () => {

    setPageState(getPageFromPath());

  };

  window.addEventListener("popstate", handlePopState);

  return () => {

    window.removeEventListener("popstate", handlePopState);

  };

}, []);

useEffect(() => {
  function closeContextMenu() {
    setRecordContextMenu(null);
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      closeContextMenu();
    }
  }

  window.addEventListener("click", closeContextMenu);
  window.addEventListener("scroll", closeContextMenu, true);
  window.addEventListener("keydown", handleKeyDown);

  return () => {
    window.removeEventListener("click", closeContextMenu);
    window.removeEventListener("scroll", closeContextMenu, true);
    window.removeEventListener("keydown", handleKeyDown);
  };
}, []);

function setPage(nextPage: Page) {

  const opensNewProgress =
    nextPage === "records" ||
    nextPage === "mock-records" ||
    nextPage === "practice-sessions";
  const opensNewAnalytics = nextPage === "analytics";
  const destinationPage: Page =
    nextPage === "home" || opensNewProgress || opensNewAnalytics
      ? "ets-style-preview"
      : nextPage;

  // When navigating away from an active practice page before submission, record
  // the session as incomplete.  We check each practice type: if its start
  // timestamp is not null and the next page differs, we compute the elapsed
  // duration and append a session with "未完成" as the score.  After recording
  // we reset the corresponding start time to null so that the timer stops.
  if (page === "sentence" && sentenceStartTime !== null && nextPage !== "sentence") {
    const pausedOffset =
      singlePauseStartedAt !== null ? Date.now() - singlePauseStartedAt : 0;
    const duration = Math.floor(
      (Date.now() - sentenceStartTime - pausedOffset) / 1000
    );
    addPracticeSession("sentence", duration, "未完成");
    setSentenceStartTime(null);
  }
  if (page === "email" && emailStartTime !== null && nextPage !== "email") {
    const pausedOffset =
      singlePauseStartedAt !== null ? Date.now() - singlePauseStartedAt : 0;
    const duration = Math.floor(
      (Date.now() - emailStartTime - pausedOffset) / 1000
    );
    addPracticeSession("email", duration, "未完成");
    setEmailStartTime(null);
  }
  if (page === "discussion" && discussionStartTime !== null && nextPage !== "discussion") {
    const pausedOffset =
      singlePauseStartedAt !== null ? Date.now() - singlePauseStartedAt : 0;
    const duration = Math.floor(
      (Date.now() - discussionStartTime - pausedOffset) / 1000
    );
    addPracticeSession("discussion", duration, "未完成");
    setDiscussionStartTime(null);
  }
  if (page === "mock" && mockStartTime !== null && nextPage !== "mock" && nextPage !== "mock-result") {
    const duration = Math.floor((Date.now() - mockStartTime) / 1000);
    addPracticeSession("mock", duration, "未完成");
    setMockStartTime(null);
  }

  if (nextPage === "home") {
    setEtsStyleInitialPage("ai");
  } else if (nextPage === "mock-records") {
    setEtsStyleInitialPage("library");
    setEtsStyleInitialLibraryTab("past");
  } else if (nextPage === "records" || nextPage === "practice-sessions") {
    setEtsStyleInitialPage("ai");
  } else if (opensNewAnalytics) {
    setEtsStyleInitialPage("analytics");
  }
  setPageState(destinationPage);
  setShowSinglePauseModal(false);
  setSinglePauseStartedAt(null);

  const pathMap: Partial<Record<Page, string>> = {

    home: "/",

    records: "/records",

    "mock-records": "/mock-records",

    "past-exam": "/past-exam",

    "ets-mock-practice": "/ets-mock-practice",

    "ets-style-preview": "/",

    "scoring-guide-email": "/scoring-guide/email",

    "scoring-guide-discussion": "/scoring-guide/discussion",

    // 能力分析页面路径
    "analytics": "/analytics",
    // Unified practice session summary page
    "practice-sessions": "/practice-sessions",

  };

  const nextPath =
    nextPage === "home"
      ? "/"
      : opensNewProgress
        ? "/records"
        : opensNewAnalytics
          ? "/analytics"
          : pathMap[destinationPage];

  if (nextPath) {

    window.history.pushState({}, "", nextPath);

  }

}

 useEffect(() => {
  const path = window.location.pathname;

  if (path.startsWith("/past-exam/")) {
    const id = path.replace("/past-exam/", "").split('/')[0];
    setPastExamDetailBackPage("past-exam");
    setSelectedPastExamId(id);
  }

  if (path.startsWith("/ets-mock-practice/")) {
    const id = path.replace("/ets-mock-practice/", "").split('/')[0];
    setEtsMockDetailBackPage("ets-mock-practice");
    setSelectedEtsMockId(id);
  }
}, []);

  useEffect(() => {
  async function loadUser() {
    const { data } = await supabase.auth.getUser();
    setUser(data.user);

    if (data.user) {
      await loadPoints(data.user.id);
    } else {
      resetCreditBalance();
    }
  }

  loadUser();

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange(
    // Supabase emits an event name and a session object.  Provide explicit
    // types here to avoid implicit `any` errors when using strict
    // TypeScript settings.  We do not currently care about the event
    // name, so it is prefixed with an underscore to mark it as unused.
    (_event: string, session: { user: User | null } | null) => {
      const currentUser: User | null = session?.user ?? null;
      setUser(currentUser);

      if (_event === "PASSWORD_RECOVERY") {
        setIsPasswordRecovery(true);
        setAuthMessage("Please enter your new password.");
        setPageState("ets-style-preview");
        window.history.replaceState({}, "", "/");
      }

      if (currentUser) {
        loadPoints(currentUser.id);
      } else {
        resetCreditBalance();
      }
    }
  );

  return () => {
    subscription.unsubscribe();
  };
}, []);

function rememberPastExamScroll() {
  pastExamScrollYRef.current = window.scrollY || 0;
}

function restorePastExamScroll() {
  requestAnimationFrame(() => {
    window.scrollTo({ top: pastExamScrollYRef.current, behavior: "auto" });
  });
}

function restoreEtsStylePreview(restoreState?: EtsStylePreviewRestoreState | null) {
  setEtsStyleInitialPage(restoreState?.page || "library");
  if (restoreState) {
    setEtsStyleInitialLibraryTab(restoreState.libraryTab);
    setEtsStyleInitialPastBank(restoreState.pastBank);
    setEtsStyleInitialTopicFilter(restoreState.topicFilter);
    setEtsStyleInitialCompletionFilter(restoreState.completionFilter);
    setEtsStyleInitialSortOrder(restoreState.sortOrder);
    setEtsStyleInitialBankPage(restoreState.bankPage);
    setEtsStyleInitialPastSearchType(restoreState.pastSearchType);
    setEtsStyleInitialPastSearchInput(restoreState.pastSearchInput);
    setEtsStyleInitialAppliedPastSearch(restoreState.appliedPastSearch);
  }
  setPageState("ets-style-preview");
  window.history.pushState({}, "", "/");
}

function goToForgeHome() {
  setEtsStyleInitialPage("ai");
  setPageState("ets-style-preview");
  window.history.pushState({}, "", "/");
}

function goToPreviousLayer(targetPage: Page) {
  if (targetPage === "ets-style-preview") {
    restoreEtsStylePreview(pastExamPreviewRestoreState);
    return;
  }

  if (targetPage === "past-exam") {
    setPageState("past-exam");
    window.history.pushState({}, "", "/past-exam");
    restorePastExamScroll();
    return;
  }

  if (targetPage === "ets-mock-practice") {
    setPageState("ets-mock-practice");
    window.history.pushState({}, "", "/ets-mock-practice");
    return;
  }

  setPage(targetPage);
}

function goToPracticeReturnPage() {
  if (practiceReturnPage === "past-exam-preview" && selectedPastExamPreview) {
    setPageState("past-exam-preview");
    window.history.pushState({}, "", "/past-exam/preview");
    return;
  }

  if (practiceReturnPage === "past-exam-detail") {
    setPageState("past-exam-detail");
    window.history.pushState({}, "", `/past-exam/${selectedPastExamId}`);
    return;
  }

  if (practiceReturnPage === "past-exam") {
    setEtsStyleInitialPage("library");
    setEtsStyleInitialLibraryTab("past");
    setEtsStyleInitialPastBank(null);
    setPageState("ets-style-preview");
    window.history.pushState({}, "", "/");
    return;
  }

  if (practiceReturnPage === "ets-mock-detail") {
    setPageState("ets-mock-detail");
    window.history.pushState({}, "", `/ets-mock-practice/${selectedEtsMockId}`);
    return;
  }

  if (practiceReturnPage === "ets-mock-practice") {
    setPageState("ets-mock-practice");
    window.history.pushState({}, "", "/ets-mock-practice");
    return;
  }

  if (practiceReturnPage === "ets-style-preview") {
    if (
      activeQuestionSourceType === "past_exam" &&
      pastExamPreviewRestoreState
    ) {
      restoreEtsStylePreview(pastExamPreviewRestoreState);
      return;
    }

    setPageState("ets-style-preview");
    window.history.pushState({}, "", "/");
    return;
  }

  goToForgeHome();
}

function exitPracticeToReturnPage() {
  if (activeQuestionSourceType === "past_exam" || activeQuestionSourceType === "ets_mock") {
    setPage("home");
    requestAnimationFrame(goToPracticeReturnPage);
    return;
  }

  setPage("home");
}

function openSinglePauseModal() {
  setSinglePauseStartedAt(Date.now());
  setShowSinglePauseModal(true);
}

function returnFromSinglePause() {
  const pausedDuration =
    singlePauseStartedAt !== null ? Date.now() - singlePauseStartedAt : 0;

  if (activePracticeType === "sentence" && sentenceStartTime !== null) {
    setSentenceStartTime(sentenceStartTime + pausedDuration);
  }

  if (activePracticeType === "email" && emailStartTime !== null) {
    setEmailStartTime(emailStartTime + pausedDuration);
  }

  if (activePracticeType === "discussion" && discussionStartTime !== null) {
    setDiscussionStartTime(discussionStartTime + pausedDuration);
  }

  setSinglePauseStartedAt(null);
  setShowSinglePauseModal(false);
}

function continueFromSinglePause() {
  if (activePracticeType === "sentence") {
    setSentenceStartTime(null);
  }

  if (activePracticeType === "email") {
    setEmailStartTime(null);
  }

  if (activePracticeType === "discussion") {
    setDiscussionStartTime(null);
  }

  setActivePracticeType(null);
  setCountdownLeft(null);
  setSinglePauseStartedAt(null);
  setShowSinglePauseModal(false);

  goToPracticeReturnPage();
}

function openRecordContextMenu(
  event: MouseEvent<HTMLElement>,
  target: DeleteRecordTarget
) {
  event.preventDefault();
  setRecordContextMenu({
    x: event.clientX,
    y: event.clientY,
    target,
  });
}

async function deleteRecord(target: DeleteRecordTarget) {
  if (!user) {
    setRecordContextMenu(null);
    return;
  }

  const shouldDelete = window.confirm(`确定删除这条${target.label}记录吗？`);
  if (!shouldDelete) {
    setRecordContextMenu(null);
    return;
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  if (!accessToken) {
    window.alert("登录状态已失效，请重新登录后再删除。");
    setRecordContextMenu(null);
    return;
  }

  const response = await fetch("/api/delete-record", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ source: target.source, id: target.id }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    window.alert(`删除失败：${data.error || "请稍后重试。"}`);
    setRecordContextMenu(null);
    return;
  }

  if (target.source === "practice") {
    setRecords((current) => current.filter((record) => record.id !== target.id));
  } else if (target.source === "mock") {
    setMockRecords((current) =>
      current.filter((record) => record.id !== target.id)
    );
  } else {
    setPracticeSessions((current) =>
      current.filter((session) => session.id !== target.id)
    );
  }

  setRecordContextMenu(null);
}



function applyCreditBalance(data: Partial<CreditBalance>) {
  if (typeof data.balance === "number") setPoints(data.balance);
  if (typeof data.temporaryBalance === "number") {
    setTemporaryPoints(data.temporaryBalance);
  }
  if (typeof data.permanentBalance === "number") {
    setPermanentPoints(data.permanentBalance);
  }
  if (Array.isArray(data.checkInDates)) {
    setCreditCheckInDates(data.checkInDates);
  }
  if (Array.isArray(data.claimedMilestones)) {
    setClaimedCreditMilestones(data.claimedMilestones);
  }
}

function resetCreditBalance() {
  setPoints(0);
  setTemporaryPoints(0);
  setPermanentPoints(0);
  setCreditCheckInDates([]);
  setClaimedCreditMilestones([]);
}

async function loadPoints(_userId: string) {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    resetCreditBalance();
    return;
  }

  const response = await fetch("/api/credits", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json();

  if (!response.ok) {
    console.error("Failed to load credits:", data.error || response.statusText);
    resetCreditBalance();
    return;
  }

  applyCreditBalance(data);
}

async function redeemCode(code: string): Promise<RedeemResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("请先登录再使用兑换码。");

  const response = await fetch("/api/redeem-code", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ code }),
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "兑换失败，请稍后重试。");
  }

  applyCreditBalance(data);
  await loadQuestionSets();
  return data as RedeemResult;
}

async function claimDailyCredit() {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("请先登录再签到。");

  const response = await fetch("/api/credits", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ action: "check-in" }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "签到失败，请稍后重试。");
  applyCreditBalance(data);
}

async function handleSignUp() {
  if (!authEmail || !authPassword) {
    setAuthMessage("Please enter your email and password.");
    return;
  }

  setIsAuthLoading(true);
  setAuthMessage("");

  const { error } = await supabase.auth.signUp({
    email: authEmail,
    password: authPassword,
  });

  if (error) {
    setAuthMessage(error.message);
  } else {
    setAuthMessage(
      "Registration successful. Please check your email if confirmation is required."
    );
  }

  setIsAuthLoading(false);
}

async function handleSignIn() {
  if (!authEmail || !authPassword) {
    setAuthMessage("Please enter your email and password.");
    return;
  }

  setIsAuthLoading(true);
  setAuthMessage("");

  const { error } = await supabase.auth.signInWithPassword({
    email: authEmail,
    password: authPassword,
  });

  if (error) {
    setAuthMessage(error.message);
  } else {
    setAuthMessage("Signed in successfully.");
    setAuthPassword("");
  }

  setIsAuthLoading(false);
}

async function handleSendPasswordReset() {
  const email = (forgotPasswordEmail || authEmail).trim();

  if (!email) {
    setAuthMessage("Please enter the email for your account.");
    return;
  }

  setIsAuthLoading(true);
  setAuthMessage("");

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/`,
  });

  if (error) {
    setAuthMessage(error.message);
  } else {
    setForgotPasswordEmail(email);
    setAuthMessage("Password reset email sent. Please check your inbox.");
  }

  setIsAuthLoading(false);
}

async function handleUpdatePassword() {
  if (!newPassword || !newPasswordConfirm) {
    setAuthMessage("Please enter and confirm your new password.");
    return;
  }

  if (newPassword.length < 6) {
    setAuthMessage("Password must be at least 6 characters.");
    return;
  }

  if (newPassword !== newPasswordConfirm) {
    setAuthMessage("The two passwords do not match.");
    return;
  }

  setIsAuthLoading(true);
  setAuthMessage("");

  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (error) {
    setAuthMessage(error.message);
  } else {
    setIsPasswordRecovery(false);
    setNewPassword("");
    setNewPasswordConfirm("");
    setAuthMessage("Password updated successfully.");
  }

  setIsAuthLoading(false);
}

async function handleSignOut() {
  await supabase.auth.signOut();
  setUser(null);
  resetCreditBalance();
  setIsPasswordRecovery(false);
  setNewPassword("");
  setNewPasswordConfirm("");
  setAuthMessage("Signed out.");
}

async function loadPracticeRecords() {
  if (!user) {
    setRecordMessage("Please sign in first.");
    return;
  }

  setIsLoadingRecords(true);
  setRecordMessage("");

  const { data, error } = await supabase
    .from("practice_records")
    .select(
      "id, practice_type, prompt, answer, feedback, score, points_spent, created_at"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    setRecordMessage(error.message);
    setIsLoadingRecords(false);
    return;
  }

  setRecords((data || []) as PracticeRecord[]);
  setIsLoadingRecords(false);
}

async function loadQuestionSets() {
  setIsLoadingQuestionSets(true);
  setQuestionSetMessage("");

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    const response = await fetch("/api/question-sets", {
      headers: accessToken
        ? { Authorization: `Bearer ${accessToken}` }
        : undefined,
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Failed to load question sets.");
    }

    const sets = (payload.items || []) as QuestionSet[];
    setIsProAccount(Boolean(payload.isPro));
    setSubscriptionExpiresAt(
      typeof payload.subscriptionExpiresAt === "string"
        ? payload.subscriptionExpiresAt
        : null
    );
    setHasPastExamAccess(
      Boolean(payload.hasQuestionBankAccess ?? payload.isPro)
    );
    setUnlockedEtsMockIds(
      Array.isArray(payload.unlockedIds) ? payload.unlockedIds : []
    );
    setPastExamSets(
      sets.filter((item: QuestionSet) => item.source_type === "past_exam")
    );
    setEtsMockSets(
      sets.filter((item: QuestionSet) => item.source_type === "ets_mock")
    );
  } catch (error) {
    setHasPastExamAccess(false);
    setIsProAccount(false);
    setSubscriptionExpiresAt(null);
    setUnlockedEtsMockIds([]);
    setPastExamSets([]);
    setEtsMockSets([]);
    setQuestionSetMessage(
      error instanceof Error ? error.message : "Failed to load question sets."
    );
  } finally {
    setIsLoadingQuestionSets(false);
  }
}

async function loadQuestionAttempts() {

  if (!user) {

    setQuestionAttempts([]);

    return;

  }

  const { data, error } = await supabase

    .from("question_attempts")

    .select("id, question_set_id, source_type, status, score, created_at")

    .eq("user_id", user.id)

    .order("created_at", { ascending: false });

  if (error) {

    setQuestionSetMessage(error.message);

    return;

  }

  setQuestionAttempts((data || []) as QuestionAttempt[]);

}


useEffect(() => {
  loadQuestionSets();
}, [user]);
useEffect(() => {
  loadQuestionAttempts();
}, [user]);

useEffect(() => {
  if (!user) {
    setRecords([]);
    setMockRecords([]);
    return;
  }

  void Promise.all([loadPracticeRecords(), loadMockRecords()]);
}, [user]);

useEffect(() => {
  if (!user || page !== "past-exam") return;

  loadPracticeRecords();
  loadMockRecords();
}, [user, page]);

const writingBestScoreByPrompt = useMemo(() => {
  const bestScores = new Map<string, number>();

  function addBestScore(type: "email" | "discussion", prompt: unknown, score: unknown) {
    const parsedScore = parsePracticeScore(score);
    if (parsedScore === null) return;

    const key = getPromptScoreKey(type, prompt);
    if (!key) return;

    const current = bestScores.get(key);
    if (current === undefined || parsedScore > current) {
      bestScores.set(key, parsedScore);
    }
  }

  records.forEach((record) => {
    if (record.practice_type === "email") {
      addBestScore("email", record.prompt, record.score);
    }

    if (record.practice_type === "discussion") {
      addBestScore("discussion", record.prompt, record.score);
    }
  });

  mockRecords.forEach((record) => {
    addBestScore("email", record.email_prompt, record.email_score);
    addBestScore("discussion", record.discussion_prompt, record.discussion_score);
  });

  return bestScores;
}, [records, mockRecords]);

const sentenceBestScoreBySet = useMemo(() => {
  const bestScores = new Map<string, number>();

  mockRecords.forEach((record) => {
    if (!hasRecordedSentenceSection(record)) return;

    const key = getSentenceSetKey(record.sentence_questions || []);
    const parsedScore =
      typeof record.sentence_score === "number"
        ? record.sentence_score
        : Number(record.sentence_score);

    if (!key || Number.isNaN(parsedScore)) return;

    const current = bestScores.get(key);
    if (current === undefined || parsedScore > current) {
      bestScores.set(key, parsedScore);
    }
  });

  return bestScores;
}, [mockRecords]);


function getPracticedIds(sourceType: "past_exam" | "ets_mock") {

  return questionAttempts

    // Explicitly type `attempt` as `QuestionAttempt` to avoid implicit any.
    .filter((attempt: QuestionAttempt) => attempt.source_type === sourceType)

    .map((attempt: QuestionAttempt) => attempt.question_set_id);

}

function getPastExamSetById(id: string) {
  // Provide an explicit type for the callback to avoid implicit any.
  return pastExamSets.find((item: QuestionSet) => item.id === id) || null;
}

function getEtsMockSetById(id: string) {
  // Provide an explicit type for the callback to avoid implicit any.
  return etsMockSets.find((item: QuestionSet) => item.id === id) || null;
}

async function loadMockRecords() {
  if (!user) {
    setMockRecordMessage("Please sign in first.");
    return;
  }

  setIsLoadingMockRecords(true);
  setMockRecordMessage("");

  const { data, error } = await supabase
    .from("mock_records")
    .select(
      "id, sentence_questions, sentence_answers, sentence_score, email_prompt, email_answer, email_feedback, email_score, discussion_prompt, discussion_answer, discussion_feedback, discussion_score, final_score, knowledge_analysis, study_advice, points_spent, created_at"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    setMockRecordMessage(error.message);
    setIsLoadingMockRecords(false);
    return;
  }

  setMockRecords((data || []) as MockRecord[]);
  setIsLoadingMockRecords(false);
}

function buildMockTestDataFromQuestionSet(questionSet: QuestionSet) {
  const tasks = Array.isArray(questionSet.content.tasks)
    ? questionSet.content.tasks
    : [];

  const sentenceTask = tasks.find((task) => task.type === "sentence");
  const emailTask = tasks.find((task) => task.type === "email");
  const discussionTask = tasks.find((task) => task.type === "discussion");

  if (!sentenceTask || sentenceTask.type !== "sentence") {
    throw new Error("This mock test does not contain Build a Sentence tasks.");
  }

  if (!emailTask || emailTask.type !== "email") {
    throw new Error("This mock test does not contain an Email Writing task.");
  }

  if (!discussionTask || discussionTask.type !== "discussion") {
    throw new Error(
      "This mock test does not contain an Academic Discussion task."
    );
  }

  const sentenceQuestions = sentenceTask.questions.map((question, index) => ({
    ...question,
    id: typeof question.id === "number" ? question.id : index + 1,
    level: "medium",
    topic: "ets mock",
    relationType: "question-answer",
    explanation:
      question.explanation ||
      "This question tests sentence structure and logical connection.",
  }));

  return {
    sentenceQuestions,
    emailPrompt: emailTask.prompt,
    discussionPrompt: discussionTask.prompt,
  } as MockTestData;
}

function handleStartPastExamPractice(questionSet: QuestionSet | null) {
  if (!questionSet) {
    setQuestionSetMessage("These Official Questions are not available yet.");
    return;
  }

  try {
    const data = buildMockTestDataFromQuestionSet(questionSet);

    setPracticeReturnPage("past-exam-detail");
    setActiveQuestionSetId(questionSet.id);
    setActiveQuestionSourceType("past_exam");

    setMockMessage("");
    setMockResult(null);
    setMockTestData(data);
    setMockSentenceSlots(createInitialSlots(data.sentenceQuestions));
    setMockSentenceBanks(createBankOrders(data.sentenceQuestions));
    setMockDragged(null);
    setMockEmailAnswer("");
    setMockDiscussionAnswer("");
    setMockStartTime(Date.now());

    setPageState("mock");
    window.history.pushState({}, "", `/past-exam/${questionSet.id}/practice`);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to start this Official Questions practice.";

    setQuestionSetMessage(message);
  }
}

function getPastExamTasksByType(type: PastExamPracticeType) {
  return pastExamSets.flatMap((questionSet: QuestionSet) => {
    const tasks = Array.isArray(questionSet.content.tasks)
      ? questionSet.content.tasks
      : [];

    return tasks
      .filter((task) => task.type === type)
      .map((task) => ({
        questionSet,
        task,
      }));
  });
}

function getQuestionSetTasksByType(
  questionSets: QuestionSet[],
  type: PastExamPracticeType
) {
  return questionSets.flatMap((questionSet: QuestionSet) => {
    const tasks = Array.isArray(questionSet.content.tasks)
      ? questionSet.content.tasks
      : [];

    return tasks
      .filter((task) => task.type === type)
      .map((task) => ({
        questionSet,
        task,
      }));
  });
}

function normalizeSentenceQuestions(
  questionsToNormalize: Question[],
  topic = "past exam"
) {
  return questionsToNormalize.map((question, index) => ({
    ...question,
    id: index + 1,
    level: "medium",
    topic,
    relationType: "question-answer",
    explanation:
      question.explanation ||
      "This question tests sentence structure and logical connection.",
    knowledgeCategory:
      (question as Question & { knowledgeCategory?: string }).knowledgeCategory ||
      assignSentenceKnowledgeCategory(),
  }));
}

function getSentenceQuestionKey(question: Question) {
  return [
    normalizeSentenceText(question.contextSentence || ""),
    normalizeSentenceText(question.target || renderFullAnswer(question)),
  ].join("::");
}

function getUniqueSentenceQuestions(questionsToDedupe: Question[]) {
  const seen = new Set<string>();

  return questionsToDedupe.filter((question) => {
    const key = getSentenceQuestionKey(question);

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function getRandomPastExamSentenceSelection(options: PastExamRandomOptions) {
  const sentenceEntries = getPastExamTasksByType("sentence");
  const selectedSentenceEntry =
    options.sentenceMode === "set" && options.sentenceSetId
      ? sentenceEntries.find(
          (entry) => entry.questionSet.id === options.sentenceSetId
        )
      : options.sentenceMode === "random_set"
        ? getRandomElement(sentenceEntries)
      : null;
  const sentencePool =
    selectedSentenceEntry?.task.type === "sentence"
      ? selectedSentenceEntry.task.questions
      : sentenceEntries.flatMap((sentenceEntry) =>
          sentenceEntry.task.type === "sentence"
            ? sentenceEntry.task.questions
            : []
        );

  const uniqueQuestions = getUniqueSentenceQuestions(sentencePool);
  const questions =
    options.sentenceMode === "set" || options.sentenceMode === "random_set"
      ? uniqueQuestions.slice(0, 10)
      : uniqueQuestions.sort(() => Math.random() - 0.5).slice(0, 10);

  return {
    questions,
    questionSetId: selectedSentenceEntry?.questionSet.id || "",
  };
}

async function showPracticeSelectionProgress(
  selectedTypes: PastExamPracticeType[]
) {
  setPracticeLoadingMode("practice-selection");
  setIsPracticeGenerationReady(false);
  setActivePracticeType(
    selectedTypes.length === 1 ? selectedTypes[0] : null
  );
  setPage("practice-loading");
  await runWithAiGenerationProgress(
    async () => undefined,
    () => setIsPracticeGenerationReady(true)
  );
}

async function handleStartRandomPastExamPractice(
  options: PastExamRandomOptions,
  returnPage?: Page
) {
  if (!hasPastExamAccess) {
    setPage("past-exam");
    return;
  }

  const { selectedTypes } = options;

  if (selectedTypes.length === 0) {
    setQuestionSetMessage("请至少选择一个练习部分。");
    return;
  }

  setQuestionSetMessage("");
  setPracticeTimerMode("countdown");
  setPracticeReturnPage(
    returnPage ||
      (page === "past-exam-preview"
        ? "past-exam-preview"
        : page === "past-exam-detail"
          ? "past-exam-detail"
          : page === "ets-style-preview"
            ? "ets-style-preview"
            : "past-exam")
  );
  setActiveQuestionSetId("");
  setActiveQuestionSourceType("past_exam");

  if (options.practiceMode === "exam_set") {
    const candidate = getRandomElement(
      getPastExamRandomSetCandidates(pastExamSets)
    );
    const sentenceEntry = candidate
      ? getRandomElement(candidate.sentenceEntries)
      : null;
    const emailEntry = candidate ? getRandomElement(candidate.emailEntries) : null;
    const discussionEntry = candidate
      ? getRandomElement(candidate.discussionEntries)
      : null;

    if (!candidate || !sentenceEntry || !emailEntry || !discussionEntry) {
      setQuestionSetMessage("当前 Official Questions 题库暂时没有可随机抽取的完整考试 Set。");
      return;
    }

    const sentenceQuestions = normalizeSentenceQuestions(
      getUniqueSentenceQuestions(sentenceEntry.task.questions).slice(0, 10),
      `past exam ${candidate.date}`
    );

    if (sentenceQuestions.length === 0) {
      setQuestionSetMessage("抽中的考试 Set 暂时没有可用的造句题。");
      return;
    }

    const sourceIds = new Set([
      sentenceEntry.questionSet.id,
      emailEntry.questionSet.id,
      discussionEntry.questionSet.id,
    ]);
    const data: MockTestData = {
      sentenceQuestions,
      emailPrompt: emailEntry.task.prompt,
      discussionPrompt: discussionEntry.task.prompt,
      selectedTypes: ["sentence", "email", "discussion"],
    };

    await showPracticeSelectionProgress(data.selectedTypes || []);
    setActiveQuestionSetId(
      sourceIds.size === 1 ? sentenceEntry.questionSet.id : ""
    );
    setMockMessage("");
    setMockResult(null);
    setMockTestData(data);
    setMockSentenceSlots(createInitialSlots(sentenceQuestions));
    setMockSentenceBanks(createBankOrders(sentenceQuestions));
    setMockDragged(null);
    setMockEmailAnswer("");
    setMockDiscussionAnswer("");
    setMockStartTime(Date.now());
    setPage("mock");
    return;
  }

  const availableTypes = selectedTypes.filter(
    (type) => getPastExamTasksByType(type).length > 0
  );

  if (availableTypes.length === 0) {
    setQuestionSetMessage("所选部分暂时没有可抽取的 Official Questions。");
    return;
  }

  if (availableTypes.length === 1) {
    const selectedType = availableTypes[0];
    const entry = getRandomElement(getPastExamTasksByType(selectedType));

    if (!entry) {
      setQuestionSetMessage("所选部分暂时没有可抽取的 Official Questions。");
      return;
    }

    if (entry.task.type === "sentence") {
      const sentenceSelection = getRandomPastExamSentenceSelection(options);
      const selectedQuestions = sentenceSelection.questions;

      if (selectedQuestions.length === 0) {
        setQuestionSetMessage("造句题库暂时没有可抽取的题。");
        return;
      }

      const processedQuestions = normalizeSentenceQuestions(
        selectedQuestions,
        "past exam"
      );

      await showPracticeSelectionProgress(availableTypes);
      setActiveQuestionSetId(sentenceSelection.questionSetId);
      setQuestions(processedQuestions);
      setSlotsByQuestion(createInitialSlots(processedQuestions));
      setBankOrders(createBankOrders(processedQuestions));
      setCurrentIndex(0);
      setDragged(null);
      setResults({});
      setIsSubmitted(false);
      setApiMessage("");
      setActivePracticeType("sentence");
      setPage("sentence-intro");
      return;
    }

    if (entry.task.type === "email") {
      await showPracticeSelectionProgress(availableTypes);
      setCurrentEmailPrompt(entry.task.prompt);
      setEmailAnswer("");
      setEmailSubmitted(false);
      setEmailFeedback(null);
      setActivePracticeType("email");
      setPage("email-intro");
      return;
    }

    if (entry.task.type === "discussion") {
      await showPracticeSelectionProgress(availableTypes);
      setCurrentDiscussionPrompt(entry.task.prompt);
      setDiscussionAnswer("");
      setDiscussionSubmitted(false);
      setDiscussionFeedback(null);
      setActivePracticeType("discussion");
      setPage("discussion-intro");
    }

    return;
  }

  const selectedSentenceSelection = availableTypes.includes("sentence")
    ? getRandomPastExamSentenceSelection(options)
    : { questions: [], questionSetId: "" };
  const selectedSentenceQuestions = selectedSentenceSelection.questions;
  const emailEntry = availableTypes.includes("email")
    ? getRandomElement(getPastExamTasksByType("email"))
    : null;
  const discussionEntry = availableTypes.includes("discussion")
    ? getRandomElement(getPastExamTasksByType("discussion"))
    : null;

  if (availableTypes.includes("sentence") && selectedSentenceQuestions.length === 0) {
    setQuestionSetMessage("造句题库暂时没有可抽取的题。");
    return;
  }

  if (availableTypes.includes("email") && emailEntry?.task.type !== "email") {
    setQuestionSetMessage("邮件题库暂时没有可抽取的题。");
    return;
  }

  if (
    availableTypes.includes("discussion") &&
    discussionEntry?.task.type !== "discussion"
  ) {
    setQuestionSetMessage("讨论题库暂时没有可抽取的题。");
    return;
  }

  const sentenceQuestions = normalizeSentenceQuestions(
    selectedSentenceQuestions,
    "past exam"
  );
  const data: MockTestData = {
    sentenceQuestions,
    emailPrompt:
      emailEntry?.task.type === "email" ? emailEntry.task.prompt : sampleEmailPrompt,
    discussionPrompt:
      discussionEntry?.task.type === "discussion"
        ? discussionEntry.task.prompt
        : sampleDiscussionPrompt,
    selectedTypes: availableTypes,
  };

  await showPracticeSelectionProgress(availableTypes);
  setMockMessage("");
  setMockResult(null);
  setMockTestData(data);
  setMockSentenceSlots(createInitialSlots(sentenceQuestions));
  setMockSentenceBanks(createBankOrders(sentenceQuestions));
  setMockDragged(null);
  setMockEmailAnswer("");
  setMockDiscussionAnswer("");
  setMockStartTime(Date.now());
  setPage("mock");
}

function handleStartPastExamSinglePractice(
  type: PastExamPracticeType,
  task: QuestionSetTask,
  question?: Question,
  questionSetId = "",
  returnPage: Page = "past-exam",
  sourceType: "past_exam" | "ets_mock" = "past_exam"
) {
  if (!hasPastExamAccess) {
    setPage("past-exam");
    return;
  }

  setQuestionSetMessage("");
  setPracticeTimerMode("countdown");
  setPracticeReturnPage(returnPage);
  setActiveQuestionSetId(questionSetId);
  setActiveQuestionSourceType(sourceType);

  if (type === "sentence" && task.type === "sentence") {
    const selectedQuestions = question ? [question] : task.questions;

    if (selectedQuestions.length === 0) {
      setQuestionSetMessage("这套造句题暂时没有可练习的题目。");
      return;
    }

    const processedQuestions = normalizeSentenceQuestions(
      selectedQuestions,
      getPastExamTaskTopic(task, question)
    );

    setQuestions(processedQuestions);
    setSlotsByQuestion(createInitialSlots(processedQuestions));
    setBankOrders(createBankOrders(processedQuestions));
    setCurrentIndex(0);
    setDragged(null);
    setResults({});
    setIsSubmitted(false);
    setApiMessage("");
    setActivePracticeType("sentence");
    setPage("sentence-intro");
    return;
  }

  if (type === "email" && task.type === "email") {
    setCurrentEmailPrompt(task.prompt);
    setEmailAnswer("");
    setEmailSubmitted(false);
    setEmailFeedback(null);
    setActivePracticeType("email");
    setPage("email-intro");
    return;
  }

  if (type === "discussion" && task.type === "discussion") {
    setCurrentDiscussionPrompt(task.prompt);
    setDiscussionAnswer("");
    setDiscussionSubmitted(false);
    setDiscussionFeedback(null);
    setActivePracticeType("discussion");
    setPage("discussion-intro");
  }
}


function handleStartEtsMockPractice(
  questionSet: QuestionSet | null,
  returnPage: Page = "ets-mock-detail"
) {
  if (!questionSet) {
    setQuestionSetMessage("This mock test is not available yet.");
    return;
  }

  try {
    const data = buildMockTestDataFromQuestionSet(questionSet);

    setPracticeReturnPage(returnPage);
    setActiveQuestionSetId(questionSet.id);
    setActiveQuestionSourceType("ets_mock");
    setMockMessage("");
    setMockResult(null);
    setMockTestData(data);
    setMockSentenceSlots(createInitialSlots(data.sentenceQuestions));
    setMockSentenceBanks(createBankOrders(data.sentenceQuestions));
    setMockDragged(null);
    setMockEmailAnswer("");
    setMockDiscussionAnswer("");
    setMockStartTime(Date.now());

    setPageState("mock");
    window.history.pushState({}, "", `/ets-mock-practice/${questionSet.id}/practice`);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to start this mock practice.";

    setQuestionSetMessage(message);
  }
}

function getEtsMockSentenceSelection(
  questionSets: QuestionSet[],
  options: PastExamRandomOptions
) {
  const sentenceEntries = getQuestionSetTasksByType(questionSets, "sentence");
  const selectedEntry =
    options.sentenceMode === "set" && options.sentenceSetId
      ? sentenceEntries.find(
          (entry) => entry.questionSet.id === options.sentenceSetId
        )
      : getRandomElement(sentenceEntries);

  if (!selectedEntry || selectedEntry.task.type !== "sentence") return null;

  return {
    questionSetId: selectedEntry.questionSet.id,
    questions: getUniqueSentenceQuestions(selectedEntry.task.questions).slice(0, 10),
  };
}

async function handleStartRandomEtsMockPractice(
  options: PastExamRandomOptions = {
    selectedTypes: ["sentence", "email", "discussion"],
    sentenceMode: "mixed",
  },
  returnPage: Page = "ets-mock-practice"
) {
  const availableSets = etsMockSets.filter((item) =>
    unlockedEtsMockIds.includes(item.id)
  );

  if (availableSets.length === 0) {
    setQuestionSetMessage("请先解锁至少一套 ETS 模拟题。");
    setPage("ets-mock-practice");
    return;
  }

  const selectedTypes = (
    ["sentence", "email", "discussion"] as PastExamPracticeType[]
  ).filter((type) => options.selectedTypes.includes(type));
  if (selectedTypes.length === 0) {
    setQuestionSetMessage("请至少选择一个练习部分。");
    return;
  }

  const sentenceSelection = selectedTypes.includes("sentence")
    ? getEtsMockSentenceSelection(availableSets, options)
    : null;
  const emailEntry = selectedTypes.includes("email")
    ? getRandomElement(getQuestionSetTasksByType(availableSets, "email"))
    : null;
  const discussionEntry = selectedTypes.includes("discussion")
    ? getRandomElement(getQuestionSetTasksByType(availableSets, "discussion"))
    : null;

  if (
    (selectedTypes.includes("sentence") && !sentenceSelection?.questions.length) ||
    (selectedTypes.includes("email") && emailEntry?.task.type !== "email") ||
    (selectedTypes.includes("discussion") &&
      discussionEntry?.task.type !== "discussion")
  ) {
    setQuestionSetMessage("已解锁的 ETS 模拟题暂时无法拼成所选练习。");
    return;
  }

  setQuestionSetMessage("");
  setPracticeTimerMode("countdown");
  setPracticeReturnPage(returnPage);
  setActiveQuestionSourceType("ets_mock");

  if (selectedTypes.length === 1) {
    const selectedType = selectedTypes[0];
    await showPracticeSelectionProgress(selectedTypes);

    if (selectedType === "sentence" && sentenceSelection) {
      const processedQuestions = normalizeSentenceQuestions(
        sentenceSelection.questions,
        "ets mock"
      );
      setActiveQuestionSetId(sentenceSelection.questionSetId);
      setQuestions(processedQuestions);
      setSlotsByQuestion(createInitialSlots(processedQuestions));
      setBankOrders(createBankOrders(processedQuestions));
      setCurrentIndex(0);
      setDragged(null);
      setResults({});
      setIsSubmitted(false);
      setApiMessage("");
      setActivePracticeType("sentence");
      setPage("sentence-intro");
      return;
    }

    if (selectedType === "email" && emailEntry?.task.type === "email") {
      setActiveQuestionSetId(emailEntry.questionSet.id);
      setCurrentEmailPrompt(emailEntry.task.prompt);
      setEmailAnswer("");
      setEmailSubmitted(false);
      setEmailFeedback(null);
      setActivePracticeType("email");
      setPage("email-intro");
      return;
    }

    if (
      selectedType === "discussion" &&
      discussionEntry?.task.type === "discussion"
    ) {
      setActiveQuestionSetId(discussionEntry.questionSet.id);
      setCurrentDiscussionPrompt(discussionEntry.task.prompt);
      setDiscussionAnswer("");
      setDiscussionSubmitted(false);
      setDiscussionFeedback(null);
      setActivePracticeType("discussion");
      setPage("discussion-intro");
      return;
    }
  }

  const sentenceQuestions = normalizeSentenceQuestions(
    sentenceSelection?.questions || [],
    "ets mock"
  );
  const data: MockTestData = {
    sentenceQuestions,
    emailPrompt:
      emailEntry?.task.type === "email" ? emailEntry.task.prompt : sampleEmailPrompt,
    discussionPrompt:
      discussionEntry?.task.type === "discussion"
        ? discussionEntry.task.prompt
        : sampleDiscussionPrompt,
    selectedTypes,
  };

  await showPracticeSelectionProgress(selectedTypes);
  setActiveQuestionSetId("");
  setMockMessage("");
  setMockResult(null);
  setMockTestData(data);
  setMockSentenceSlots(createInitialSlots(sentenceQuestions));
  setMockSentenceBanks(createBankOrders(sentenceQuestions));
  setMockDragged(null);
  setMockEmailAnswer("");
  setMockDiscussionAnswer("");
  setMockStartTime(Date.now());
  setPage("mock");
}

async function saveQuestionAttempt(result: MockResult) {
  if (!user) return;
  if (!activeQuestionSetId || !activeQuestionSourceType) return;

  const { error } = await supabase.from("question_attempts").insert({
    user_id: user.id,
    question_set_id: activeQuestionSetId,
    source_type: activeQuestionSourceType,
    status: "completed",
    score: result.finalScore,
    result: {
      recordId: result.recordId,
      sentenceScore: result.sentenceScore,
      emailScore: result.emailScore,
      discussionScore: result.discussionScore,
      finalScore: result.finalScore,
      knowledgeAnalysis: result.knowledgeAnalysis,
      studyAdvice: result.studyAdvice,
    },
  });

  if (error) {
    console.error("Failed to save question attempt:", error);
  }
}



async function handleSubmitMockTest() {
  if (!mockTestData) {
    setMockMessage("Mock test data is missing.");
    return;
  }

  if (!user) {
    setMockMessage("Please sign in before submitting a mock test.");
    return;
  }


  setIsSubmittingMock(true);
  setMockMessage("");
  setMockResult(null);
  setPage("mock-result");

  try {
    const sentenceAnswers = Object.fromEntries(
      mockTestData.sentenceQuestions.map((question: MockSentenceQuestion) => [
        String(question.id),
        (mockSentenceSlots[question.id] || [])
          .filter((slot): slot is Chunk => slot !== null)
          // Provide an explicit type for `slot` to avoid implicit-any.
          .map((slot: Chunk) => slot.text),
      ])
    );
    const result = await submitMockTestWithAPI({
      sentenceQuestions: mockTestData.sentenceQuestions,
      sentenceAnswers,
      emailPrompt: mockTestData.emailPrompt,
      emailAnswer: mockEmailAnswer,
      discussionPrompt: mockTestData.discussionPrompt,
      discussionAnswer: mockDiscussionAnswer,
      selectedTypes: mockTestData.selectedTypes,
      sourceType: activeQuestionSourceType || "forge_ai",
      practiceMode: activeQuestionSetId ? "fixed" : "random",
    });

    const roundedFinalScore = Math.round(Number(result.finalScore) * 2) / 2;
    const roundedResult = {
      ...result,
      sentenceQuestions: mockTestData.sentenceQuestions,
      sentenceAnswers,
      emailPrompt: mockTestData.emailPrompt,
      emailAnswer: mockEmailAnswer,
      discussionPrompt: mockTestData.discussionPrompt,
      discussionAnswer: mockDiscussionAnswer,
      finalScore: roundedFinalScore,
      selectedTypes: mockTestData.selectedTypes || result.selectedTypes,
    };
    setMockResult(roundedResult);
    const personalizedRecommendationIds = Array.from(
      new Set(
        [
          mockTestData.emailPrompt.personalizedRecommendationId,
          mockTestData.discussionPrompt.personalizedRecommendationId,
        ].filter((id): id is string => Boolean(id))
      )
    );
    if (personalizedRecommendationIds.length > 0) {
      try {
        await Promise.all(
          personalizedRecommendationIds.map((recommendationId) =>
            requestPersonalizedPractice({
              action: "complete",
              recommendationId,
            })
          )
        );
        setActivePersonalizedRecommendationId("");
      } catch (completionError) {
        console.error(
          "Failed to complete personalized recommendations",
          completionError
        );
      }
    }
    await saveQuestionAttempt(roundedResult);
    await loadMockRecords();
    await loadQuestionAttempts();

    if (mockStartTime !== null) {
      const duration = Math.floor((Date.now() - mockStartTime) / 1000);
      addPracticeSession('mock', duration, roundedFinalScore);
      setMockStartTime(null);
    }
    // Do not update points here based on the backend balance because the
    // cost has already been deducted at the start of the mock.
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to submit mock test.";

    setMockMessage(message);
  } finally {
    setIsSubmittingMock(false);
  }
}

async function submitMockTestWithAPI({
  sentenceQuestions,
  sentenceAnswers,
  emailPrompt,
  emailAnswer,
  discussionPrompt,
  discussionAnswer,
  selectedTypes,
  sourceType,
  practiceMode,
}: {
  sentenceQuestions: MockSentenceQuestion[];
  sentenceAnswers: Record<string, string[]>;
  emailPrompt: EmailPrompt;
  emailAnswer: string;
  discussionPrompt: DiscussionPrompt;
  discussionAnswer: string;
  selectedTypes?: PastExamPracticeType[];
  sourceType: "forge_ai" | "past_exam" | "ets_mock";
  practiceMode: "fixed" | "random";
}) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("Please sign in before submitting a mock test.");
  }

  const response = await fetch("/api/submit-mock-test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      sentenceQuestions,
      sentenceAnswers,
      emailPrompt,
      emailAnswer,
      discussionPrompt,
      discussionAnswer,
      selectedTypes,
      sourceType,
      practiceMode,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Failed to submit mock test");
  }

  return data as MockResult;
}

async function saveSentenceRecordWithAPI({
  sentenceQuestions,
  sentenceAnswers,
  sentenceScore,
  questionSetId,
  sourceType,
}: {
  sentenceQuestions: MockSentenceQuestion[];
  sentenceAnswers: Record<string, string[]>;
  sentenceScore: number;
  questionSetId?: string;
  sourceType?: "past_exam" | "ets_mock" | "";
}) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("Please sign in before saving this record.");
  }

  const response = await fetch("/api/save-sentence-record", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      sentenceQuestions,
      sentenceAnswers,
      sentenceScore,
      questionSetId,
      sourceType,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Failed to save sentence record");
  }

  return data as { recordId?: string; sentenceScore: number };
}

  const [questions, setQuestions] = useState<Question[]>(fallbackQuestions);
  const questionCount = 10;
  const level = "Medium";
  const topic = "Mixed";

  const [currentIndex, setCurrentIndex] = useState(0);
  const [slotsByQuestion, setSlotsByQuestion] = useState(() =>
    createInitialSlots(fallbackQuestions)
  );
  const [bankOrders, setBankOrders] = useState(() =>
    createBankOrders(fallbackQuestions)
  );

  const [, setIsLoading] = useState(false);
  const [, setApiMessage] = useState("");
  const [isPracticeGenerationReady, setIsPracticeGenerationReady] =
    useState(false);
  const [practiceLoadingMode, setPracticeLoadingMode] = useState<
    "ai-generation" | "personalized-selection" | "practice-selection"
  >("ai-generation");
  const [dragged, setDragged] = useState<DraggedChunk | null>(null);

  const [isSubmitted, setIsSubmitted] = useState(false);
  const [results, setResults] = useState<Record<number, number>>({});

  const [currentEmailPrompt, setCurrentEmailPrompt] =
    useState<EmailPrompt>(sampleEmailPrompt);
  const [isGeneratingEmailPrompt, setIsGeneratingEmailPrompt] = useState(false);
  const [emailAnswer, setEmailAnswer] = useState("");
  const [emailPracticeSessionId, setEmailPracticeSessionId] = useState("");
  const [emailSubmitted, setEmailSubmitted] = useState(false);
  const [emailFeedback, setEmailFeedback] = useState<WritingFeedback | null>(
    null
  );
  const [isScoringEmail, setIsScoringEmail] = useState(false);

  const [currentDiscussionPrompt, setCurrentDiscussionPrompt] =
    useState<DiscussionPrompt>(sampleDiscussionPrompt);
  const [isGeneratingDiscussionPrompt, setIsGeneratingDiscussionPrompt] =
    useState(false);
  const [discussionAnswer, setDiscussionAnswer] = useState("");
  const [discussionPracticeSessionId, setDiscussionPracticeSessionId] =
    useState("");
  const [discussionSubmitted, setDiscussionSubmitted] = useState(false);
  const [discussionFeedback, setDiscussionFeedback] =
    useState<WritingFeedback | null>(null);
  const [isScoringDiscussion, setIsScoringDiscussion] = useState(false);

  const currentQuestion = questions[currentIndex];
  const currentSlots = slotsByQuestion[currentQuestion.id] || [];
  const currentAnswers = getBlankAnswers(currentQuestion);

  const currentBank = useMemo(() => {
    const usedIds = currentSlots
      .filter((slot): slot is Chunk => slot !== null)
      .map((slot: Chunk) => slot.id);

    return (bankOrders[currentQuestion.id] || []).filter(
      (chunk: Chunk) => !usedIds.includes(chunk.id)
    );
  }, [bankOrders, currentQuestion.id, currentSlots]);


  const sentenceQuestionPointValue =
    questions.length > 0 ? 10 / questions.length : 0;
  const emailWordCount = countWords(emailAnswer);
  const discussionWordCount = countWords(discussionAnswer);

  function updateCurrentSlots(newSlots: (Chunk | null)[]) {
    setSlotsByQuestion({
      ...slotsByQuestion,
      [currentQuestion.id]: newSlots,
    });
  }

  function placeChunk(chunk: Chunk, slotIndex: number, sourceSlotIndex?: number) {
    if (isSubmitted) return;

    const newSlots = [...currentSlots];

    const oldSlotIndex = newSlots.findIndex(
      (slot: Chunk | null, index) =>
        index !== slotIndex && slot?.id === chunk.id
    );

    if (oldSlotIndex !== -1) {
      newSlots[oldSlotIndex] = null;
    }

    if (sourceSlotIndex !== undefined && sourceSlotIndex !== slotIndex) {
      newSlots[sourceSlotIndex] = null;
    }

    newSlots[slotIndex] = chunk;

    updateCurrentSlots(newSlots);
  }

  function removeChunk(slotIndex: number) {
    if (isSubmitted) return;

    const newSlots = [...currentSlots];
    newSlots[slotIndex] = null;

    updateCurrentSlots(newSlots);
  }

  function nextQuestion() {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setDragged(null);
    }
  }

  function previousQuestion() {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setDragged(null);
    }
  }

  async function submitAll(forceSubmit = false) {
    const unfinishedQuestions = questions.filter(
      (question) => !isQuestionComplete(slotsByQuestion[question.id] || [])
    );

    if (!forceSubmit && unfinishedQuestions.length > 0) {
      const shouldContinue = window.confirm(
        `还有 ${unfinishedQuestions.length} 道题没有做完，是否继续提交批改？`
      );

      if (!shouldContinue) {
        return;
      }
    }

    const finalResults: Record<number, number> = {};

    questions.forEach((question) => {
      const slots = slotsByQuestion[question.id] || [];
      const complete = isQuestionComplete(slots);
      const correct = complete && isQuestionCorrect(question, slots);

      finalResults[question.id] = correct ? sentenceQuestionPointValue : 0;
    });

    setResults(finalResults);
    setIsSubmitted(true);
    const total = (Object.values(finalResults) as number[]).reduce(
      (sum: number, s: number) => sum + s,
      0
    );

    if (user && activePracticeType === "sentence") {
      const sentenceAnswers = Object.fromEntries(
        questions.map((question) => [
          String(question.id),
          (slotsByQuestion[question.id] || [])
            .filter((slot): slot is Chunk => slot !== null)
            .map((slot) => slot.text),
        ])
      );

      try {
        await saveSentenceRecordWithAPI({
          sentenceQuestions: questions,
          sentenceAnswers,
          sentenceScore: total,
          questionSetId: activeQuestionSetId || undefined,
          sourceType: activeQuestionSourceType,
        });
        await loadMockRecords();
        await loadQuestionAttempts();
      } catch (error) {
        console.error("Failed to save sentence record:", error);
        setApiMessage(
          error instanceof Error ? error.message : "造句记录保存失败。"
        );
      }
    }

    // Record the practice session when all questions have been submitted.  The
    // total duration is computed from the sentenceStartTime and stored in the
    // unified sessions list.  After recording, reset the start time so that
    // the timer stops.
    if (sentenceStartTime !== null) {
      const duration = Math.floor((Date.now() - sentenceStartTime) / 1000);
      addPracticeSession('sentence', duration, total);
      setSentenceStartTime(null);
    }
    setActivePracticeType(null);
    setCountdownLeft(null);
  }

  async function startNewPractice(returnPage: Page = "home") {
    // Require authentication before starting a practice.  If the user is
    // not signed in, show an alert and abort.  When authenticated, record
    // the start time so that the elapsed timer begins counting up.
    if (!user) {
      alert('请先登录后再开始练习。');
      return;
    }
    if (points < 1) {
      setShowPointsModal(true);
      return;
    }
    if (!window.confirm("开始造句练习将扣除 1 积分，是否继续？")) {
      return;
    }
    setPracticeReturnPage(returnPage);
    setActivePracticeType("sentence");
    setPracticeLoadingMode("ai-generation");
    setIsPracticeGenerationReady(false);
    setPage("practice-loading");
    setIsLoading(true);
    setApiMessage("");

    try {
      const generated = await runWithAiGenerationProgress(
        () => generateQuestionsFromAPI(questionCount, level, topic),
        () => setIsPracticeGenerationReady(true)
      );

      if (typeof generated.balance === "number") {
        applyCreditBalance(generated);
      }

      // Attach a hidden knowledge category to each generated sentence question.  This
      // extra property is used internally for analytics and does not affect the
      // question rendering or logic.
      const processedGenerated = (generated as any[]).map((q) => ({
        ...q,
        knowledgeCategory: assignSentenceKnowledgeCategory(),
      }));
      setQuestions(processedGenerated);
      setSlotsByQuestion(createInitialSlots(processedGenerated));
      setBankOrders(createBankOrders(processedGenerated));
      setCurrentIndex(0);
      setDragged(null);
      setResults({});
      setIsSubmitted(false);
      setApiMessage("已成功由 Gemini 生成新题组。");
      setPage("sentence-intro");
    } catch (error) {
      console.error(error);

      const message =
        error instanceof Error
          ? error.message
          : "AI 生成题目失败，请稍后再试。";

      setApiMessage(message);
      alert(
        `AI 生成题目失败：${message}`
      );
      if (returnPage === "ets-style-preview") {
        restoreEtsStylePreview();
      } else {
        setPage("home");
      }
    } finally {
      setIsLoading(false);
    }
  }

  function beginSentencePractice() {
    setSentenceStartTime(Date.now());
    setCountdownLeft(
      practiceTimerMode === "countdown" ? singlePracticeDurations.sentence : null
    );
    setActivePracticeType("sentence");
    setPage("sentence");
  }

  async function generateNewEmailPrompt(
    topicOverride = topic,
    personalizedRecommendationId?: string
  ) {
    setEmailAnswer("");
    setEmailSubmitted(false);
    setEmailFeedback(null);
    setIsGeneratingEmailPrompt(true);

    try {
      const prompt = await generateEmailPromptWithAPI(
        level,
        topicOverride,
        personalizedRecommendationId
      );
      if (typeof (prompt as EmailPrompt & { balance?: number }).balance === "number") {
        applyCreditBalance(prompt as EmailPrompt & Partial<CreditBalance>);
      }
      // Assign a hidden knowledge category to the generated email prompt.  The extra
      // field is cast away when saving to state to satisfy the EmailPrompt type.
      const processedPrompt: any = {
        ...prompt,
        category: prompt.category || topicOverride,
        knowledgeCategory:
          prompt.knowledgeCategory || assignEmailKnowledgeCategory(),
        personalizedRecommendationId,
      };
      setCurrentEmailPrompt(processedPrompt as EmailPrompt);
      return processedPrompt as EmailPrompt;
    } catch (error) {
      console.error("Failed to generate email prompt:", error);
      throw error;
    } finally {
      setIsGeneratingEmailPrompt(false);
    }
  }

  async function generateNewDiscussionPrompt(
    topicOverride = topic,
    personalizedRecommendationId?: string
  ) {
    setDiscussionAnswer("");
    setDiscussionSubmitted(false);
    setDiscussionFeedback(null);
    setIsGeneratingDiscussionPrompt(true);

    try {
      const prompt = await generateAcademicDiscussionWithAPI(
        level,
        topicOverride,
        personalizedRecommendationId
      );
      if (
        typeof (prompt as DiscussionPrompt & { balance?: number }).balance ===
        "number"
      ) {
        applyCreditBalance(prompt as DiscussionPrompt & Partial<CreditBalance>);
      }
      // Assign a hidden knowledge category to the generated discussion prompt.
      const processedPrompt: any = {
        ...prompt,
        category: prompt.category || topicOverride,
        knowledgeCategory:
          prompt.knowledgeCategory || assignDiscussionKnowledgeCategory(),
        personalizedRecommendationId,
      };
      setCurrentDiscussionPrompt(processedPrompt as DiscussionPrompt);
      return processedPrompt as DiscussionPrompt;
    } catch (error) {
      console.error("Failed to generate academic discussion prompt:", error);
      throw error;
    } finally {
      setIsGeneratingDiscussionPrompt(false);
    }
  }

  async function startEmailPractice(returnPage: Page = "home") {
    // Require authentication and sufficient points before starting the email
    // writing practice.  If the user is not signed in, prompt them to log
    // in.  If there are insufficient points, open the points modal instead
    // of starting the practice.  The server deducts the point after the prompt
    // is generated successfully and returns the updated balance.
    if (!user) {
      alert('请先登录后再开始练习。');
      return;
    }
    if (points < EMAIL_SCORING_COST) {
      setShowPointsModal(true);
      return;
    }
    if (!window.confirm("开始邮件写作将扣除 1 积分，是否继续？")) {
      return;
    }
    setPracticeReturnPage(returnPage);
    setEmailPracticeSessionId("");
    setActivePracticeType("email");
    setPracticeLoadingMode("ai-generation");
    setIsPracticeGenerationReady(false);
    setPage("practice-loading");
    try {
      await runWithAiGenerationProgress(
        generateNewEmailPrompt,
        () => setIsPracticeGenerationReady(true)
      );
      setPage("email-intro");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "邮件写作题目生成失败。";
      alert(message);
      setActivePracticeType(null);
      if (returnPage === "ets-style-preview") {
        restoreEtsStylePreview();
      } else {
        setPage("home");
      }
    }
  }

  function beginEmailPractice() {
    setEmailStartTime(Date.now());
    setCountdownLeft(
      practiceTimerMode === "countdown" ? singlePracticeDurations.email : null
    );
    setActivePracticeType("email");
    setPage("email");
  }

  async function startDiscussionPractice(returnPage: Page = "home") {
    // Ensure the user is signed in and has enough points before starting the
    // academic discussion practice.  If not signed in, alert the user.  If
    // their balance is insufficient, show the points purchase modal.
    if (!user) {
      alert('请先登录后再开始练习。');
      return;
    }
    if (points < DISCUSSION_SCORING_COST) {
      setShowPointsModal(true);
      return;
    }
    if (!window.confirm("开始学术讨论将扣除 1 积分，是否继续？")) {
      return;
    }
    setPracticeReturnPage(returnPage);
    setDiscussionPracticeSessionId("");
    setActivePracticeType("discussion");
    setPracticeLoadingMode("ai-generation");
    setIsPracticeGenerationReady(false);
    setPage("practice-loading");
    try {
      await runWithAiGenerationProgress(
        generateNewDiscussionPrompt,
        () => setIsPracticeGenerationReady(true)
      );
      setPage("discussion-intro");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "学术讨论题目生成失败。";
      alert(message);
      setActivePracticeType(null);
      if (returnPage === "ets-style-preview") {
        restoreEtsStylePreview();
      } else {
        setPage("home");
      }
    }
  }

  async function startPersonalizedPractice(
    requestedTypes: PersonalizedTaskType[],
    preferredFocus?: {
      taskType: PersonalizedTaskType;
      topic: string;
    } | null
  ) {
    if (!user) {
      window.alert("请先登录后再使用个性化练习。");
      return false;
    }
    if (!isProAccount) {
      window.alert("个性化练习为 Pro 功能，请先兑换或升级会员。");
      return false;
    }

    const selectedTypes = (["email", "discussion"] as PersonalizedTaskType[])
      .filter((type) => requestedTypes.includes(type));
    if (selectedTypes.length === 0) return false;

    const selectionStartedAt = Date.now();
    const finishPersonalizedSelectionProgress = async () => {
      const elapsed = Date.now() - selectionStartedAt;
      const remainingUntilHold = Math.max(
        0,
        AI_GENERATION_PROGRESS_HOLD_MS - elapsed
      );
      if (remainingUntilHold > 0) {
        await waitForAiGenerationProgress(remainingUntilHold);
      }
      setIsPracticeGenerationReady(true);
      await waitForAiGenerationProgress(AI_GENERATION_PROGRESS_FINISH_MS);
    };

    setPracticeLoadingMode("personalized-selection");
    setIsPracticeGenerationReady(false);
    setActivePracticeType(
      selectedTypes.length === 1 ? selectedTypes[0] : null
    );
    setPage("practice-loading");

    try {
      const recommendations: PersonalizedRecommendation[] = [];
      for (const taskType of selectedTypes) {
        const result = await requestPersonalizedPractice({
          action: "recommend",
          preferredTaskType: taskType,
          preferredTopic:
            preferredFocus?.taskType === taskType
              ? preferredFocus.topic
              : undefined,
        });
        if (!result.recommendation) {
          throw new Error("暂时无法为所选题型生成个性化推荐。");
        }
        recommendations.push(result.recommendation);
      }

      const aiGeneratedCount = recommendations.filter(
        (item) => item.source === "ai_generated"
      ).length;
      if (points < aiGeneratedCount) {
        setShowPointsModal(true);
        restoreEtsStylePreview();
        return false;
      }
      if (
        aiGeneratedCount > 0 &&
        !window.confirm(
          `其中 ${aiGeneratedCount} 道题需要 AI 生成，将扣除 ${aiGeneratedCount} 积分，是否继续？`
        )
      ) {
        restoreEtsStylePreview();
        return false;
      }

      await Promise.all(
        recommendations.map((recommendation) =>
          requestPersonalizedPractice({
            action: "start",
            recommendationId: recommendation.id,
          })
        )
      );
      setPracticeReturnPage("ets-style-preview");

      if (recommendations.length === 1) {
        const recommendation = recommendations[0];
        setActivePersonalizedRecommendationId(recommendation.id);

        if (recommendation.source === "past_exam") {
          if (!recommendation.task) {
            throw new Error("推荐的 Official Questions 内容暂时无法读取，请重新获取推荐。");
          }
          if (
            recommendation.task.type !== "email" &&
            recommendation.task.type !== "discussion"
          ) {
            throw new Error("推荐的 Official Questions 题型不匹配，请重新获取推荐。");
          }
          const personalizedTask: QuestionSetTask =
            recommendation.task.type === "email"
              ? {
                  ...recommendation.task,
                  prompt: {
                    ...recommendation.task.prompt,
                    personalizedRecommendationId: recommendation.id,
                  },
                }
              : {
                  ...recommendation.task,
                  prompt: {
                    ...recommendation.task.prompt,
                    personalizedRecommendationId: recommendation.id,
                  },
                };
          await finishPersonalizedSelectionProgress();
          handleStartPastExamSinglePractice(
            personalizedTask.type,
            personalizedTask,
            undefined,
            recommendation.questionSetId || "",
            "ets-style-preview",
            recommendation.questionSetSourceType || "past_exam"
          );
          return true;
        }

        setActivePracticeType(recommendation.taskType);
        if (recommendation.taskType === "email") {
          setEmailPracticeSessionId("");
          await runWithAiGenerationProgress(
            () => generateNewEmailPrompt(recommendation.topic, recommendation.id),
            () => setIsPracticeGenerationReady(true)
          );
          setPage("email-intro");
        } else {
          setDiscussionPracticeSessionId("");
          await runWithAiGenerationProgress(
            () =>
              generateNewDiscussionPrompt(
                recommendation.topic,
                recommendation.id
              ),
            () => setIsPracticeGenerationReady(true)
          );
          setPage("discussion-intro");
        }
        return true;
      }

      setActivePersonalizedRecommendationId("");
      setPracticeTimerMode("countdown");
      setActiveQuestionSetId("");
      setActiveQuestionSourceType("");
      setActivePracticeType(null);
      setMockMessage("");
      setMockResult(null);
      setMockTestData(null);

      const loadCombinedPrompts = async () => {
        let emailPrompt: EmailPrompt | null = null;
        let discussionPrompt: DiscussionPrompt | null = null;

        for (const recommendation of recommendations) {
          if (recommendation.source === "past_exam") {
            if (!recommendation.task) {
              throw new Error("推荐的 Official Questions 内容暂时无法读取，请重新获取推荐。");
            }
            if (
              recommendation.taskType === "email" &&
              recommendation.task.type === "email"
            ) {
              emailPrompt = {
                ...recommendation.task.prompt,
                personalizedRecommendationId: recommendation.id,
              };
            }
            if (
              recommendation.taskType === "discussion" &&
              recommendation.task.type === "discussion"
            ) {
              discussionPrompt = {
                ...recommendation.task.prompt,
                personalizedRecommendationId: recommendation.id,
              };
            }
            continue;
          }

          if (recommendation.taskType === "email") {
            emailPrompt = await generateNewEmailPrompt(
              recommendation.topic,
              recommendation.id
            );
          } else {
            discussionPrompt = await generateNewDiscussionPrompt(
              recommendation.topic,
              recommendation.id
            );
          }
        }

        if (!emailPrompt || !discussionPrompt) {
          throw new Error("个性化组合练习内容不完整，请重新尝试。");
        }
        return { emailPrompt, discussionPrompt };
      };

      let combinedPrompts: {
        emailPrompt: EmailPrompt;
        discussionPrompt: DiscussionPrompt;
      };
      if (aiGeneratedCount > 0) {
        combinedPrompts = await runWithAiGenerationProgress(
          loadCombinedPrompts,
          () => setIsPracticeGenerationReady(true)
        );
      } else {
        combinedPrompts = await loadCombinedPrompts();
        await finishPersonalizedSelectionProgress();
      }

      const data: MockTestData = {
        sentenceQuestions: [],
        emailPrompt: combinedPrompts.emailPrompt,
        discussionPrompt: combinedPrompts.discussionPrompt,
        selectedTypes: ["email", "discussion"],
      };
      setMockTestData(data);
      setMockSentenceSlots({});
      setMockSentenceBanks({});
      setMockDragged(null);
      setMockEmailAnswer("");
      setMockDiscussionAnswer("");
      setMockStartTime(Date.now());
      setPage("mock");
      return true;
    } catch (error) {
      setActivePersonalizedRecommendationId("");
      window.alert(
        error instanceof Error
          ? error.message
          : "个性化练习启动失败，请稍后重试。"
      );
      restoreEtsStylePreview();
      return false;
    }
  }

  async function completeActivePersonalizedPractice(
    promptRecommendationId?: string | null
  ) {
    const recommendationId =
      activePersonalizedRecommendationId || promptRecommendationId || "";
    if (!recommendationId) return;
    await requestPersonalizedPractice({
      action: "complete",
      recommendationId,
    });
    setActivePersonalizedRecommendationId("");
  }

  function beginDiscussionPractice() {
    setDiscussionStartTime(Date.now());
    setCountdownLeft(
      practiceTimerMode === "countdown"
        ? singlePracticeDurations.discussion
        : null
    );
    setActivePracticeType("discussion");
    setPage("discussion");
  }

  async function startSelectedAiPractice(
    requestedTypes: PastExamPracticeType[]
  ) {
    const selectedTypes = (
      ["sentence", "email", "discussion"] as PastExamPracticeType[]
    ).filter((type) => requestedTypes.includes(type));

    if (selectedTypes.length === 0) return;

    if (selectedTypes.length === 1) {
      const selectedType = selectedTypes[0];

      if (selectedType === "sentence") {
        await startNewPractice("ets-style-preview");
      } else if (selectedType === "email") {
        await startEmailPractice("ets-style-preview");
      } else {
        await startDiscussionPractice("ets-style-preview");
      }

      return;
    }

    if (!user) {
      window.alert("请先登录后再开始练习。");
      return;
    }

    const practiceCost = selectedTypes.length;
    if (points < practiceCost) {
      setShowPointsModal(true);
      return;
    }

    const practiceName =
      selectedTypes.length === 3 ? "完整模考" : "组合练习";
    if (
      !window.confirm(
        `开始${practiceName}将扣除 ${practiceCost} 积分，是否继续？`
      )
    ) {
      return;
    }

    setPracticeTimerMode("countdown");
    setPracticeReturnPage("ets-style-preview");
    setActiveQuestionSetId("");
    setActiveQuestionSourceType("");
    setActivePracticeType(null);
    setMockMessage("");
    setMockResult(null);
    setMockTestData(null);
    setPracticeLoadingMode("ai-generation");
    setIsPracticeGenerationReady(false);
    setPage("practice-loading");

    try {
      const generatedSentenceQuestions = selectedTypes.includes("sentence")
        ? await generateQuestionsFromAPI(10, "Medium", "Mixed", false)
        : null;

      const data = await runWithAiGenerationProgress(
        () => startSelectedMockTestWithAPI(selectedTypes),
        () => setIsPracticeGenerationReady(true)
      );

      if (typeof data.balance === "number") {
        applyCreditBalance(data);
      }

      const selectedData: MockTestData = {
        ...data,
        sentenceQuestions: selectedTypes.includes("sentence")
          ? generatedSentenceQuestions || data.sentenceQuestions
          : [],
        selectedTypes,
      };
      setMockTestData(selectedData);
      setMockSentenceSlots(
        createInitialSlots(
          selectedTypes.includes("sentence")
            ? selectedData.sentenceQuestions
            : []
        )
      );
      setMockSentenceBanks(
        createBankOrders(
          selectedTypes.includes("sentence")
            ? selectedData.sentenceQuestions
            : []
        )
      );
      setMockDragged(null);
      setMockEmailAnswer("");
      setMockDiscussionAnswer("");
      setMockStartTime(Date.now());
      setPage("mock");
    } catch (error) {
      const rawMessage =
        error instanceof Error ? error.message : "练习题目生成失败。";
      const message = /gemini|invalid json|unexpected end|sentencequestions/i.test(
        rawMessage
      )
        ? "AI 题目生成未完成，请重试。"
        : rawMessage;
      window.alert(message);
      setMockMessage(message);
      setMockStartTime(null);
      restoreEtsStylePreview();
    }
  }

  async function submitEmailWriting(forceSubmit = false) {
    if (!forceSubmit && emailWordCount === 0) return;

    setEmailFeedback(null);
    setEmailSubmitted(true);
    if (emailStartTime !== null) {
      const duration = Math.floor((Date.now() - emailStartTime) / 1000);
      const session = addPracticeSession("email", duration, "未批改", {
        prompt: currentEmailPrompt,
        answer: emailAnswer,
      });
      setEmailPracticeSessionId(session.id);
      setEmailStartTime(null);
    }
    setActivePracticeType(null);
    setCountdownLeft(null);
  }

  async function gradeEmailWriting() {
    if (!emailSubmitted || isScoringEmail) return;
    if (!window.confirm("AI智能批改将扣除 2 积分，是否继续？")) return;

    setIsScoringEmail(true);
    setEmailFeedback(null);
    try {
      const feedback = await scoreEmailWritingWithAPI(
        currentEmailPrompt,
        emailAnswer,
        emailPracticeSessionId
      );
      setEmailFeedback(feedback);
      if (typeof feedback.balance === "number") {
        applyCreditBalance(feedback);
      }
      updatePracticeSessionScore(emailPracticeSessionId, feedback.score);
      await loadPracticeRecords();
      try {
        await completeActivePersonalizedPractice(
          currentEmailPrompt.personalizedRecommendationId
        );
      } catch (completionError) {
        console.error("Failed to complete personalized recommendation", completionError);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'AI scoring failed. Please try again.';
      setEmailFeedback({
        score: '评分失败',
        strengths: [],
        problems: [message],
        grammarCorrections: [],
        actionPlan: [],
        improvedVersion: '',
        sampleAnswer: '',
      });
      setEmailSubmitted(true);
    } finally {
      setIsScoringEmail(false);
    }
  }

  async function submitDiscussionWriting(forceSubmit = false) {
    if (!forceSubmit && discussionWordCount === 0) return;

    setDiscussionFeedback(null);
    setDiscussionSubmitted(true);
    if (discussionStartTime !== null) {
      const duration = Math.floor((Date.now() - discussionStartTime) / 1000);
      const session = addPracticeSession("discussion", duration, "未批改", {
        prompt: currentDiscussionPrompt,
        answer: discussionAnswer,
      });
      setDiscussionPracticeSessionId(session.id);
      setDiscussionStartTime(null);
    }
    setActivePracticeType(null);
    setCountdownLeft(null);
  }

  async function gradeDiscussionWriting() {
    if (!discussionSubmitted || isScoringDiscussion) return;
    if (!window.confirm("AI智能批改将扣除 2 积分，是否继续？")) return;

    setIsScoringDiscussion(true);
    setDiscussionFeedback(null);
    try {
      const feedback = await scoreAcademicDiscussionWithAPI(
        currentDiscussionPrompt,
        discussionAnswer,
        discussionPracticeSessionId
      );

      setDiscussionFeedback(feedback);
      setDiscussionSubmitted(true);
      if (typeof feedback.balance === "number") {
        applyCreditBalance(feedback);
      }
      updatePracticeSessionScore(discussionPracticeSessionId, feedback.score);
      await loadPracticeRecords();
      try {
        await completeActivePersonalizedPractice(
          currentDiscussionPrompt.personalizedRecommendationId
        );
      } catch (completionError) {
        console.error("Failed to complete personalized recommendation", completionError);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'AI scoring failed. Please try again.';

      setDiscussionFeedback({
        score: '评分失败',
        strengths: [],
        problems: [message],
        grammarCorrections: [],
        actionPlan: [],
        improvedVersion: '',
        sampleAnswer: '',
      });
      setDiscussionSubmitted(true);
    } finally {
      setIsScoringDiscussion(false);
    }
  }

  async function gradeDeferredPracticeSession(
    session: PracticeSession
  ): Promise<WritingFeedback> {
    if (
      (session.type !== "email" && session.type !== "discussion") ||
      !session.prompt ||
      !session.answer?.trim()
    ) {
      throw new Error("这条历史记录没有保存完整题目和答案，无法补批改。");
    }

    const feedback =
      session.type === "email"
        ? await scoreEmailWritingWithAPI(
            session.prompt,
            session.answer,
            session.id
          )
        : await scoreAcademicDiscussionWithAPI(
            session.prompt,
            session.answer,
            session.id
          );

    if (typeof feedback.balance === "number") {
      applyCreditBalance(feedback);
    }
    updatePracticeSessionScore(session.id, feedback.score);
    await loadPracticeRecords();
    const recommendationId = (
      session.prompt as { personalizedRecommendationId?: string | null }
    ).personalizedRecommendationId;
    if (recommendationId) {
      try {
        await completeActivePersonalizedPractice(recommendationId);
      } catch (completionError) {
        console.error("Failed to complete personalized recommendation", completionError);
      }
    }

    return feedback;
  }

  useEffect(() => {
    if (practiceTimerMode !== "countdown" || activePracticeType === null) return;
    if (singlePauseStartedAt !== null) return;
    if (
      (activePracticeType === "sentence" && sentenceStartTime === null) ||
      (activePracticeType === "email" && emailStartTime === null) ||
      (activePracticeType === "discussion" && discussionStartTime === null)
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      const startTime =
        activePracticeType === "sentence"
          ? sentenceStartTime
          : activePracticeType === "email"
            ? emailStartTime
            : discussionStartTime;
      if (startTime === null) return;

      const duration = singlePracticeDurations[activePracticeType];
      const remaining = Math.max(
        0,
        duration - Math.floor((Date.now() - startTime) / 1000)
      );
      setCountdownLeft(remaining);

      if (remaining <= 0) {
        window.clearInterval(timer);
        const typeToSubmit = activePracticeType;
        if (typeToSubmit === "sentence") return;
        setActivePracticeType(null);
        if (typeToSubmit === "email") void submitEmailWriting(true);
        if (typeToSubmit === "discussion") void submitDiscussionWriting(true);
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [
    activePracticeType,
    discussionStartTime,
    emailStartTime,
    practiceTimerMode,
    sentenceStartTime,
    singlePauseStartedAt,
  ]);

  const isExamWorkspacePage =
    page === "mock" ||
    page === "mock-result" ||
    page === "sentence" ||
    page === "email" ||
    page === "discussion";
  const isWideSupportPage =
    page === "practice-loading" ||
    page === "sentence-intro" ||
    page === "email-intro" ||
    page === "discussion-intro" ||
    page === "past-exam" ||
    page === "past-exam-preview" ||
    page === "ets-style-preview";
  const contentMaxWidth = isExamWorkspacePage
    ? page === "mock-result"
      ? "100vw"
      : "calc(100vw - 16px)"
    : isWideSupportPage
      ? "min(1680px, calc(100vw - 32px))"
      : "min(1360px, calc(100vw - 64px))";

  if (window.location.pathname.startsWith("/support-admin")) {
    return <SupportAdminPage />;
  }

  return (
    <div
      className={`question-preview-overlay${isExamWorkspacePage ? " exam-workspace-shell" : ""}`}
      style={{
        width: "100%",
        minHeight: "100vh",
        background: "white",
        padding: 0,
        margin: 0,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        overflowX: "hidden",
        overflowY: page === "mock" ? "hidden" : "auto",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: contentMaxWidth,
          minHeight:
            page === "mock" || page === "mock-result" ? "100vh" : "auto",
          margin: 0,
          background: "white",
          padding:
            page === "mock" ||
            page === "mock-result" ||
            page === "practice-loading" ||
            page === "sentence-intro" ||
            page === "email-intro" ||
            page === "discussion-intro" ||
            page === "sentence" ||
            page === "email" ||
            page === "discussion" ||
            page === "ets-style-preview"
              ? "0"
              : "40px",
          borderRadius: 0,
          boxShadow: "none",
          boxSizing: "border-box",
        }}
      >
        {page === "practice-loading" && (
          <PracticeLoadingPage
            type={activePracticeType}
            isGenerationReady={isPracticeGenerationReady}
            mode={practiceLoadingMode}
          />
        )}

        {page === "scoring-guide-email" && (
          <OfficialScoringGuidePage type="email" />
        )}

        {page === "scoring-guide-discussion" && (
          <OfficialScoringGuidePage type="discussion" />
        )}

        {page === "ets-style-preview" && (
          <EtsStylePreviewPage
            initialPage={etsStyleInitialPage}
            initialLibraryTab={etsStyleInitialLibraryTab}
            initialPastBank={etsStyleInitialPastBank}
            initialTopicFilter={etsStyleInitialTopicFilter}
            initialCompletionFilter={etsStyleInitialCompletionFilter}
            initialSortOrder={etsStyleInitialSortOrder}
            initialBankPage={etsStyleInitialBankPage}
            initialPastSearchType={etsStyleInitialPastSearchType}
            initialPastSearchInput={etsStyleInitialPastSearchInput}
            initialAppliedPastSearch={etsStyleInitialAppliedPastSearch}
            user={user}
            isPro={isProAccount}
            subscriptionExpiresAt={subscriptionExpiresAt}
            hasQuestionBankAccess={hasPastExamAccess}
            unlockedEtsMockIds={unlockedEtsMockIds}
            points={points}
            temporaryPoints={temporaryPoints}
            permanentPoints={permanentPoints}
            creditCheckInDates={creditCheckInDates}
            claimedCreditMilestones={claimedCreditMilestones}
            onClaimDailyCredit={claimDailyCredit}
            onRedeemCode={redeemCode}
            records={records}
            mockRecords={mockRecords}
            practiceSessions={practiceSessions}
            pastExamSets={pastExamSets}
            etsMockSets={etsMockSets}
            bestScores={writingBestScoreByPrompt}
            sentenceBestScores={sentenceBestScoreBySet}
            practiceTimerMode={practiceTimerMode}
            setPracticeTimerMode={setPracticeTimerMode}
            authEmail={authEmail}
            authPassword={authPassword}
            authMessage={authMessage}
            isAuthLoading={isAuthLoading}
            showForgotPassword={showForgotPassword}
            forgotPasswordEmail={forgotPasswordEmail}
            isPasswordRecovery={isPasswordRecovery}
            newPassword={newPassword}
            newPasswordConfirm={newPasswordConfirm}
            setAuthEmail={setAuthEmail}
            setAuthPassword={setAuthPassword}
            setShowForgotPassword={setShowForgotPassword}
            setForgotPasswordEmail={setForgotPasswordEmail}
            setNewPassword={setNewPassword}
            setNewPasswordConfirm={setNewPasswordConfirm}
            onSignIn={handleSignIn}
            onSignUp={handleSignUp}
            onSignOut={handleSignOut}
            onSendPasswordReset={handleSendPasswordReset}
            onUpdatePassword={handleUpdatePassword}
            onStartSelectedPractice={startSelectedAiPractice}
            onStartPersonalizedPractice={startPersonalizedPractice}
            onStartPastExamRandom={(options) => {
              setEtsStyleInitialPage("library");
              setEtsStyleInitialLibraryTab("past");
              setPastExamPreviewRestoreState(null);
              setPracticeReturnPage("ets-style-preview");
              void handleStartRandomPastExamPractice(options, "ets-style-preview");
          }}
            onOpenPastExamSelection={(selection, restoreState) => {
              setPastExamPreviewBackPage("ets-style-preview");
              setPastExamPreviewRestoreState(restoreState || null);
              setSelectedPastExamPreview(selection);
            }}
            onOpenEtsMockSet={(id, _restoreState) => {
              setEtsMockDetailBackPage("ets-style-preview");
              setSelectedEtsMockId(id);
              setIsEtsMockPreviewOpen(true);
            }}
            onStartEtsMockRandom={(options) => {
              setEtsStyleInitialPage("library");
              setEtsStyleInitialLibraryTab("mock");
              setPastExamPreviewRestoreState(null);
              void handleStartRandomEtsMockPractice(
                options,
                "ets-style-preview"
              );
              setPracticeReturnPage("ets-style-preview");
            }}
            onOpenRecordDetail={setSelectedPastExamRecordDetail}
            onRecordContextMenu={(event, target) =>
              openRecordContextMenu(event, target)
            }
          />
        )}

        {page === "sentence-intro" && (
          <SinglePracticeIntroPage
            title="Build a Sentence"
            onBegin={beginSentencePractice}
          >
            <p>Move the words in the boxes to create grammatical sentences.</p>
            <p>
              {practiceTimerMode === "countdown"
                ? "You will have 6 minutes and 50 seconds to complete this task. When time ends, your answers will be submitted automatically."
                : "The clock will count up while you complete this task."}
            </p>
          </SinglePracticeIntroPage>
        )}

        {page === "email-intro" && (
          <SinglePracticeIntroPage title="Write an Email" onBegin={beginEmailPractice}>
            <p>You will read some information and use the information to write an email.</p>
            <p>
              {practiceTimerMode === "countdown"
                ? "You will have 7 minutes to write the email. When time ends, your response will be submitted automatically."
                : "The clock will count up while you write the email."}
            </p>
          </SinglePracticeIntroPage>
        )}

        {page === "discussion-intro" && (
          <SinglePracticeIntroPage
            title="Write for an Academic Discussion"
            onBegin={beginDiscussionPractice}
          >
            <p>
              A professor has posted a question about a topic and students have responded with their
              thoughts and ideas. Make a contribution to the discussion.
            </p>
            <p>
              {practiceTimerMode === "countdown"
                ? "You will have 10 minutes to write. When time ends, your response will be submitted automatically."
                : "The clock will count up while you write your response."}
            </p>
          </SinglePracticeIntroPage>
        )}

        {page === "sentence" && (
            <SentencePractice
            questions={questions}
            currentIndex={currentIndex}
            slotsByQuestion={slotsByQuestion}
            currentSlots={currentSlots}
            currentAnswers={currentAnswers}
            currentQuestion={currentQuestion}
            currentBank={currentBank}
            isSubmitted={isSubmitted}
            results={results}
            dragged={dragged}
            setDragged={setDragged}
            setPage={(nextPage) => {
              if (nextPage === "home") goToForgeHome();
              else setPage(nextPage);
            }}
            nextQuestion={nextQuestion}
            previousQuestion={previousQuestion}
            goToQuestion={(questionIndex) => {
              setCurrentIndex(questionIndex);
              setDragged(null);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            submitAll={submitAll}
            removeChunk={removeChunk}
            placeChunk={placeChunk}
            elapsedSeconds={
              practiceTimerMode === "countdown" && activePracticeType === "sentence"
                ? countdownLeft ?? singlePracticeDurations.sentence
                : elapsedSeconds
            }
            isCountdown={practiceTimerMode === "countdown"}
            onPause={openSinglePauseModal}
          />
        )}

        {page === "email" && (
            <WritingPracticePage
              title={currentEmailPrompt.title}
              isGenerating={isGeneratingEmailPrompt}
              onGenerateNew={generateNewEmailPrompt}
              promptBlock={
                <>
                  <p
                    style={{
                      color: "#000",
                      lineHeight: 1.45,
                      marginTop: 0,
                      fontSize: "20px",
                      fontWeight: 400,
                    }}
                  >
                    {currentEmailPrompt.scenario}
                  </p>

                  <div
                    style={{
                      marginTop: "28px",
                      lineHeight: 1.45,
                      color: "#000",
                      fontSize: "20px",
                    }}
                  >
                    <strong>{currentEmailPrompt.task}</strong>

                    <ul style={{ lineHeight: 1.55, marginTop: "18px" }}>
                      {currentEmailPrompt.requirements.map((requirement) => (
                        <li key={requirement}>{requirement}</li>
                      ))}
                    </ul>

                    <p style={{ color: "#000", marginBottom: 0 }}>
                      {currentEmailPrompt.suggestedLength}
                    </p>
                  </div>
                </>
              }
              responseHeader={
                <div
                  style={{
                    textAlign: "left",
                    color: "#000",
                    fontSize: "20px",
                    lineHeight: 1.25,
                    fontWeight: 800,
                  }}
                >
                  <div style={{ marginBottom: "16px" }}>Your Response:</div>
                  <div>To: {getEmailRecipient(currentEmailPrompt)}</div>
                  <div>Subject: {getEmailSubject(currentEmailPrompt)}</div>
                </div>
              }
              protectedPromptText={getEmailPromptText(currentEmailPrompt)}
              answer={emailAnswer}
              setAnswer={(value) => {
                setEmailAnswer(value);
                setEmailSubmitted(false);
                setEmailFeedback(null);
              }}
              placeholder="Write your email here..."
              isScoring={isScoringEmail}
              onSubmit={submitEmailWriting}
              onGrade={gradeEmailWriting}
              submitted={emailSubmitted}
              feedback={emailFeedback}
              setPage={(nextPage) => {
                if (nextPage === "home") goToForgeHome();
                else setPage(nextPage);
              }}
              elapsedSeconds={
                practiceTimerMode === "countdown" && activePracticeType === "email"
                  ? countdownLeft ?? singlePracticeDurations.email
                  : elapsedSeconds
              }
              isCountdown={practiceTimerMode === "countdown"}
              onPause={openSinglePauseModal}
            />
        )}

        {page === "discussion" && (
            <WritingPracticePage
            title={currentDiscussionPrompt.title}
            isGenerating={isGeneratingDiscussionPrompt}
            onGenerateNew={generateNewDiscussionPrompt}
            promptBlock={
              <>
                  {currentDiscussionPrompt.instruction && (
                    <div
                      style={{
                        marginBottom: "22px",
                        lineHeight: 1.8,
                        whiteSpace: "pre-line",
                      }}
                    >
                      {currentDiscussionPrompt.instruction}
                    </div>
                  )}
                <div
                  style={{
                    lineHeight: 1.8,
                    marginBottom: "24px",
                  }}
                >
                  <strong>{currentDiscussionPrompt.professorName || "Professor"}</strong>
                  <p style={{ marginBottom: 0 }}>
                    {currentDiscussionPrompt.professor}
                  </p>
                </div>

              </>
            }
            responseTopBlock={
              <div
                style={{
                  display: "grid",
                  gap: "18px",
                  marginBottom: "18px",
                  lineHeight: 1.8,
                }}
              >
                <div>
                  <strong>{currentDiscussionPrompt.studentOneName}</strong>
                  <p style={{ marginBottom: 0 }}>
                    {currentDiscussionPrompt.studentOnePost}
                  </p>
                </div>

                <div>
                  <strong>{currentDiscussionPrompt.studentTwoName}</strong>
                  <p style={{ marginBottom: 0 }}>
                    {currentDiscussionPrompt.studentTwoPost}
                  </p>
                </div>
              </div>
            }
            protectedPromptText={getDiscussionPromptText(currentDiscussionPrompt)}
            answer={discussionAnswer}
            setAnswer={(value) => {
              setDiscussionAnswer(value);
              setDiscussionSubmitted(false);
              setDiscussionFeedback(null);
            }}
            placeholder="Write your academic discussion response here..."
            isScoring={isScoringDiscussion}
            onSubmit={submitDiscussionWriting}
            onGrade={gradeDiscussionWriting}
            submitted={discussionSubmitted}
            feedback={discussionFeedback}
            setPage={(nextPage) => {
              if (nextPage === "home") goToForgeHome();
              else setPage(nextPage);
            }}
            elapsedSeconds={
              practiceTimerMode === "countdown" && activePracticeType === "discussion"
                ? countdownLeft ?? singlePracticeDurations.discussion
                : elapsedSeconds
            }
            isCountdown={practiceTimerMode === "countdown"}
            onPause={openSinglePauseModal}
            />
        )}

        {page === "mock" && mockTestData && (
          <MockTestPage
            data={mockTestData}
            sentenceSlots={mockSentenceSlots}
            setSentenceSlots={setMockSentenceSlots}
            sentenceBanks={mockSentenceBanks}
            dragged={mockDragged}
            setDragged={setMockDragged}
            emailAnswer={mockEmailAnswer}
            setEmailAnswer={setMockEmailAnswer}
            discussionAnswer={mockDiscussionAnswer}
            setDiscussionAnswer={setMockDiscussionAnswer}
            isSubmitting={isSubmittingMock}
            message={mockMessage}
            onSubmit={handleSubmitMockTest}
            onCancel={() => {
              exitPracticeToReturnPage();
            }}
            onPauseExit={exitPracticeToReturnPage}
          />
        )}

        {page === "mock-result" && (
          <MockResultPage
            result={mockResult}
            isLoading={isSubmittingMock}
            message={mockMessage}
            onBackHome={goToForgeHome}
            onViewRecords={() => {
              setPage("mock-records");
            }}
          />
        )}

        {page === "past-exam" && (
          hasPastExamAccess ? (
            <PastExamPage
              items={pastExamSets}
              activeBank={pastExamActiveBank}
              setActiveBank={(type) => {
                setPastExamBankBackPage("past-exam");
                setPastExamActiveBank(type);
              }}
              openRandomOnEnter={openPastExamRandomOnEnter}
              onRandomOpened={() => setOpenPastExamRandomOnEnter(false)}
              onBackLayer={() => {
                if (pastExamBankBackPage === "past-exam") {
                  setPastExamActiveBank(null);
                  return;
                }

                goToPreviousLayer(pastExamBankBackPage);
              }}
              practicedIds={getPracticedIds("past_exam")}
              bestScores={writingBestScoreByPrompt}
              sentenceBestScores={sentenceBestScoreBySet}
              mockRecords={mockRecords}
              isLoading={isLoadingQuestionSets}
              message={questionSetMessage}
              onRecordContextMenu={(event, target) =>
                openRecordContextMenu(event, target)
              }
              onOpenRecordDetail={setSelectedPastExamRecordDetail}
              onPreview={(selection) => {
                rememberPastExamScroll();
                setPastExamPreviewBackPage("past-exam");
                setPastExamPreviewRestoreState(null);
                setSelectedPastExamPreview(selection);
              }}
              onRandomPractice={handleStartRandomPastExamPractice}
            />
          ) : (
            <AccessPaywall
              title="🔒 Pro 专属：Official Questions"
              description="升级 Pro 后可使用 Official Questions、随机组题和完整模考。"
              onBackHome={() => setPage("home")}
            />
          )
        )}

        {page === "past-exam-preview" && selectedPastExamPreview && (
          hasPastExamAccess ? (
            <PastExamPreviewPage
              selection={selectedPastExamPreview}
              practiceRecords={records}
              mockRecords={mockRecords}
              onRecordContextMenu={(event, target) =>
                openRecordContextMenu(event, target)
              }
              onOpenRecordDetail={setSelectedPastExamRecordDetail}
              onBack={() => {
                goToPreviousLayer(pastExamPreviewBackPage);
              }}
              onStart={() => {
                handleStartPastExamSinglePractice(
                  selectedPastExamPreview.type,
                  selectedPastExamPreview.task,
                  selectedPastExamPreview.question,
                  selectedPastExamPreview.item.id
                );
              }}
            />
          ) : (
            <AccessPaywall
              title="🔒 Pro 专属：Official Questions"
              description="升级 Pro 后可使用 Official Questions、随机组题和完整模考。"
              onBackHome={() => {
                goToPreviousLayer(pastExamPreviewBackPage);
              }}
            />
          )
        )}
        
        {page === "past-exam-detail" && (
          hasPastExamAccess ? (
            <PastExamDetailPage
              examId={selectedPastExamId}
              examSet={getPastExamSetById(selectedPastExamId)}
              message={questionSetMessage}
              onStart={() => {
                handleStartPastExamPractice(getPastExamSetById(selectedPastExamId));
              }}
              onBack={() => {
                goToPreviousLayer(pastExamDetailBackPage);
              }}
            />
          ) : (
            <AccessPaywall
              title="🔒 Pro 专属：Official Questions"
              description="升级 Pro 后可使用 Official Questions、随机组题和完整模考。"
              onBackHome={() => {
                goToPreviousLayer(pastExamDetailBackPage);
              }}
            />
          )
        )}

        {page === "ets-mock-practice" && (
          // Always display the ETS mock practice list.  Each set shows locked/unlocked status individually.
          <EtsMockPracticePage
            items={etsMockSets}
            practicedIds={getPracticedIds("ets_mock")}
            unlockedIds={unlockedEtsMockIds}
            mockRecords={mockRecords}
            isLoading={isLoadingQuestionSets}
            message={questionSetMessage}
            onBackHome={() => setPage("home")}
            onRandomPractice={() => void handleStartRandomEtsMockPractice()}
            onOpenRecordDetail={setSelectedPastExamRecordDetail}
            onRecordContextMenu={(event, target) =>
              openRecordContextMenu(event, target)
            }
            onPreview={(id) => {
              setEtsMockDetailBackPage("ets-mock-practice");
              setSelectedEtsMockId(id);
              setIsEtsMockPreviewOpen(true);
            }}
          />
        )}
        
        {page === "ets-mock-detail" && (
          // Check if the selected set is unlocked individually.  If not, show paywall for that set.
          unlockedEtsMockIds.includes(selectedEtsMockId) ? (
            <EtsMockDetailPage
              mockId={selectedEtsMockId}
              mockSet={getEtsMockSetById(selectedEtsMockId)}
              message={questionSetMessage}
              mockRecords={mockRecords}
              onOpenRecordDetail={setSelectedPastExamRecordDetail}
              onRecordContextMenu={(event, target) =>
                openRecordContextMenu(event, target)
              }
              onStart={() => {
                handleStartEtsMockPractice(getEtsMockSetById(selectedEtsMockId));
              }}
              onStartSingle={(type, task) => {
                handleStartPastExamSinglePractice(
                  type,
                  task,
                  undefined,
                  selectedEtsMockId,
                  "ets-mock-detail",
                  "ets_mock"
                );
              }}
              onBack={() => {
                goToPreviousLayer(etsMockDetailBackPage);
              }}
            />
          ) : (
            <AccessPaywall
              title="该套题尚未解锁"
              description="请联系客服解锁此套 ETS 模考题。"
              onBackHome={() => {
                goToPreviousLayer(etsMockDetailBackPage);
              }}
            />
          )
        )}















      </div>
      {selectedPastExamPreview &&
        (page === "past-exam" || page === "ets-style-preview") &&
        hasPastExamAccess && (
          <QuestionPreviewModal
            onClose={() => setSelectedPastExamPreview(null)}
          >
            <PastExamPreviewPage
              embedded
              selection={selectedPastExamPreview}
              practiceRecords={records}
              mockRecords={mockRecords}
              onRecordContextMenu={(event, target) =>
                openRecordContextMenu(event, target)
              }
              onOpenRecordDetail={setSelectedPastExamRecordDetail}
              onBack={() => setSelectedPastExamPreview(null)}
              onStart={() => {
                const preview = selectedPastExamPreview;
                setSelectedPastExamPreview(null);
                handleStartPastExamSinglePractice(
                  preview.type,
                  preview.task,
                  preview.question,
                  preview.item.id,
                  page
                );
              }}
            />
          </QuestionPreviewModal>
        )}
      {isEtsMockPreviewOpen &&
        selectedEtsMockId &&
        (page === "ets-mock-practice" || page === "ets-style-preview") && (
          <QuestionPreviewModal
            onClose={() => setIsEtsMockPreviewOpen(false)}
          >
            {unlockedEtsMockIds.includes(selectedEtsMockId) ? (
              <EtsMockDetailPage
                embedded
                mockId={selectedEtsMockId}
                mockSet={getEtsMockSetById(selectedEtsMockId)}
                message={questionSetMessage}
                mockRecords={mockRecords}
                onOpenRecordDetail={setSelectedPastExamRecordDetail}
                onRecordContextMenu={(event, target) =>
                  openRecordContextMenu(event, target)
                }
                onStart={() => {
                  const selectedSet = getEtsMockSetById(selectedEtsMockId);
                  setIsEtsMockPreviewOpen(false);
                  handleStartEtsMockPractice(selectedSet, page);
                }}
                onStartSingle={(type, task) => {
                  setIsEtsMockPreviewOpen(false);
                  handleStartPastExamSinglePractice(
                    type,
                    task,
                    undefined,
                    selectedEtsMockId,
                    page,
                    "ets_mock"
                  );
                }}
                onBack={() => setIsEtsMockPreviewOpen(false)}
              />
            ) : (
              <AccessPaywall
                title="该套题尚未解锁"
                description="请联系客服解锁此套 ETS 模考题。"
                onBackHome={() => setIsEtsMockPreviewOpen(false)}
              />
            )}
          </QuestionPreviewModal>
        )}
       {recordContextMenu && (
        <div
          style={{
            position: "fixed",
            left: recordContextMenu.x,
            top: recordContextMenu.y,
            zIndex: 1000,
            minWidth: "150px",
            padding: "6px",
            borderRadius: "12px",
            border: "1px solid #e2e8f0",
            background: "white",
            boxShadow: "0 16px 40px rgba(15, 23, 42, 0.18)",
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => deleteRecord(recordContextMenu.target)}
            style={{
              width: "100%",
              border: "none",
              borderRadius: "9px",
              background: "white",
              color: "#be123c",
              cursor: "pointer",
              fontWeight: 800,
              padding: "10px 12px",
              textAlign: "left",
            }}
          >
            删除记录
          </button>
        </div>
      )}
       {selectedPastExamRecordDetail && (
        <PastExamRecordDetailModal
          detail={selectedPastExamRecordDetail}
          onClose={() => setSelectedPastExamRecordDetail(null)}
          onGradeSession={gradeDeferredPracticeSession}
        />
      )}
       {showSinglePauseModal && (
        <PracticePauseModal
          onReturn={returnFromSinglePause}
          onContinue={continueFromSinglePause}
        />
      )}
       {showPointsModal && (

        <PointsModal onClose={() => setShowPointsModal(false)} />

      )}
    </div>
  );
}

function PracticeLoadingPage({
  type: _type,
  isGenerationReady,
  mode = "ai-generation",
}: {
  type: "sentence" | "email" | "discussion" | null;
  isGenerationReady: boolean;
  mode?: "ai-generation" | "personalized-selection" | "practice-selection";
}) {
  const [progress, setProgress] = useState(0);
  const [transitionDuration, setTransitionDuration] = useState(0);

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      setTransitionDuration(AI_GENERATION_PROGRESS_HOLD_MS);
      setProgress(80);
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, []);

  useEffect(() => {
    if (!isGenerationReady) return;

    setTransitionDuration(AI_GENERATION_PROGRESS_FINISH_MS);
    setProgress(100);
  }, [isGenerationReady]);

  return (
    <div
      className="forge-preview-shell"
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "28px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ width: "min(520px, 100%)", textAlign: "center" }}>
        <p
          style={{
            color: "#64748b",
            marginBottom: "24px",
            fontSize: "22px",
            fontWeight: 800,
          }}
        >
          {mode === "practice-selection"
            ? isGenerationReady
              ? "练习内容已匹配完成，正在进入。"
              : "正在从题库中抽取并组合本次练习，请稍等。"
            : mode === "personalized-selection"
            ? isGenerationReady
              ? "个性化练习已匹配完成，正在进入。"
              : "正在分析你的近期表现，并从 Official Questions 题库中匹配最适合的练习。"
            : isGenerationReady
              ? "题目生成完成，正在进入。"
              : "正在生成题目，请稍等。"}
        </p>
        <div
          role="progressbar"
          aria-label={
            mode === "practice-selection"
              ? "题库随机练习匹配进度"
              : mode === "personalized-selection"
              ? "个性化练习匹配进度"
              : "AI 题目生成进度"
          }
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          style={{
            height: "12px",
            borderRadius: "999px",
            background: "#e2e8f0",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${progress}%`,
              height: "100%",
              borderRadius: "999px",
              background: "#006b67",
              boxShadow: "0 0 14px rgba(0, 107, 103, 0.35)",
              transition: `width ${transitionDuration}ms linear`,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function PracticePauseModal({
  onReturn,
  onContinue,
}: {
  onReturn: () => void;
  onContinue: () => void;
}) {
  return (
    <div style={pauseModalOverlayStyle}>
      <div style={pauseModalContentStyle}>
        <h1 style={pauseModalTitleStyle}>Pause</h1>

        <div style={pauseModalDividerStyle} />

        <p style={pauseModalTextStyle}>
          Select <strong>Return</strong> to continue working.
        </p>

        <p style={{ ...pauseModalTextStyle, marginTop: "4px" }}>
          Select <strong>Continue</strong> to leave this question.
        </p>

        <div style={pauseModalActionsStyle}>
          <button
            type="button"
            onClick={onReturn}
            style={pauseModalButtonStyle}
          >
            Return
          </button>

          <button
            type="button"
            onClick={onContinue}
            style={pauseModalButtonStyle}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

function SinglePracticeIntroPage({
  title,
  children,
  onBegin,
}: {
  title: string;
  children: ReactNode;
  onBegin: () => void;
}) {
  return (
    <>
      <div
        className="exam-green-bar"
      >
        <button
          type="button"
          onClick={onBegin}
          className="exam-action-button exam-action-button--nav"
        >
          Begin
          <span className="exam-action-chevron" aria-hidden="true">›</span>
        </button>
      </div>
      <PracticeStatusBar label="Directions" />
      <main
        className="exam-direction-page"
      >
        <h1
          className="exam-direction-title"
        >
          {title}
        </h1>
        <div className="exam-direction-body">{children}</div>
      </main>
    </>
  );
}

function SingleTimeRemainingConfirmation({
  questionLabel,
  timeText,
  isTimeHidden,
  onToggleTime,
  onPause,
  onBack,
  onContinue,
}: {
  questionLabel: string;
  timeText: string;
  isTimeHidden: boolean;
  onToggleTime: () => void;
  onPause: () => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <>
      <div
        className="exam-green-bar writing-practice-toolbar"
        style={{ justifyContent: "flex-end", gap: "8px" }}
      >
        <button
          type="button"
          onClick={onBack}
          className="exam-action-button exam-action-button--nav"
        >
          <span className="exam-action-chevron" aria-hidden="true">‹</span>
          Back
        </button>
        <button
          type="button"
          onClick={onPause}
          className="exam-action-button exam-action-button--pause"
        >
          Pause
          <span className="exam-pause-symbol" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onContinue}
          className="exam-action-button exam-action-button--nav"
        >
          Continue
          <span className="exam-action-chevron" aria-hidden="true">›</span>
        </button>
      </div>
      <PracticeStatusBar
        label={questionLabel}
        timeText={timeText}
        isTimeHidden={isTimeHidden}
        onToggleTime={onToggleTime}
      />
      <main
        style={{
          maxWidth: "1120px",
          margin: "0 auto",
          padding: "56px 28px",
          color: "#444",
          fontSize: "24px",
          lineHeight: 1.55,
        }}
      >
        <h1
          style={{
            fontSize: "40px",
            fontWeight: 500,
            margin: "0 0 26px",
            borderBottom: "2px solid #d6d6d6",
            paddingBottom: "18px",
          }}
        >
          Time Remaining
        </h1>
        <p>
          You still have time to respond. As long as there is time remaining, you can keep writing
          or revise your response.
        </p>
        <p>
          Select <strong>Back</strong> to keep writing or revising.
        </p>
        <p>
          Select <strong>Continue</strong> to leave this question.
        </p>
        <p>Once you leave this question, you WILL NOT be able to return to it.</p>
      </main>
    </>
  );
}

function PracticeStatusBar({
  label,
  timeText,
  isTimeHidden = false,
  onToggleTime,
}: {
  label?: string;
  timeText?: string;
  isTimeHidden?: boolean;
  onToggleTime?: () => void;
}) {
  return (
    <div className="exam-practice-status-bar">
      <div className="exam-practice-status-copy">
        <strong>Writing</strong>
        {label && (
          <>
            <span className="exam-practice-status-divider" aria-hidden="true" />
            <span>{label}</span>
          </>
        )}
      </div>
      {timeText !== undefined && onToggleTime && (
        <div className="exam-practice-status-time">
          <span>{isTimeHidden ? "**:**" : timeText}</span>
          <span className="exam-practice-status-divider" aria-hidden="true" />
          <button type="button" onClick={onToggleTime}>
            {isTimeHidden ? "Show Time" : "Hide Time"}
          </button>
        </div>
      )}
    </div>
  );
}

function SentenceReviewTable({
  questions,
  slotsByQuestion,
  selectedIndex,
  onSelect,
  resultScores,
  title = "Review",
  description = "Select a sentence below, then choose Go to the Question to review or complete it.",
}: {
  questions: Question[];
  slotsByQuestion: Record<number, (Chunk | null)[]>;
  selectedIndex: number;
  onSelect: (questionIndex: number) => void;
  resultScores?: Record<number, number>;
  title?: string;
  description?: string;
}) {
  return (
    <section
      style={{
        width: "min(960px, calc(100% - 48px))",
        margin: "48px auto",
        color: "#172033",
      }}
    >
      <h1 style={{ margin: "0 0 10px", fontSize: "38px", fontWeight: 650 }}>
        {title}
      </h1>
      <p style={{ margin: "0 0 28px", color: "#64748b", fontSize: "18px" }}>
        {description}
      </p>

      <div
        role="table"
        aria-label="Sentence review"
        style={{
          width: "min(480px, 100%)",
          margin: 0,
          overflow: "hidden",
          border: "1px solid #cbd5e1",
          borderRadius: "14px",
          background: "white",
        }}
      >
        <div
          role="row"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(110px, 220px)",
            background: "#edf3f8",
            borderBottom: "1px solid #cbd5e1",
            fontWeight: 850,
            fontSize: "17px",
          }}
        >
          <div role="columnheader" style={{ padding: "15px 22px" }}>Question</div>
          <div role="columnheader" style={{ padding: "15px 22px" }}>Status</div>
        </div>

        {questions.map((question, questionIndex) => {
          const finished = isQuestionComplete(slotsByQuestion[question.id] || []);
          const isResult = resultScores !== undefined;
          const correct = (resultScores?.[question.id] || 0) > 0;
          const selected = selectedIndex === questionIndex;

          return (
            <button
              key={question.id}
              type="button"
              role="row"
              aria-selected={selected}
              onClick={() => onSelect(questionIndex)}
              style={{
                width: "100%",
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(110px, 220px)",
                border: 0,
                borderBottom:
                  questionIndex === questions.length - 1
                    ? "none"
                    : "1px solid #dbe3ea",
                background: selected ? "#e8f5f4" : "white",
                color: "#172033",
                padding: 0,
                textAlign: "left",
                cursor: "pointer",
                boxShadow: selected ? "inset 4px 0 0 #00756f" : "none",
              }}
            >
              <span role="cell" style={{ padding: "17px 22px", fontWeight: 800 }}>
                Sentence {questionIndex + 1}
              </span>
              <span
                role="cell"
                style={{
                  padding: "17px 22px",
                  color: isResult
                    ? correct
                      ? "#087f5b"
                      : "#b42318"
                    : finished
                      ? "#087f5b"
                      : "#9a6700",
                  fontWeight: 850,
                }}
              >
                {isResult
                  ? correct
                    ? "Correct"
                    : "Wrong"
                  : finished
                    ? "Finished"
                    : "Unfinished"}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function SentenceResultDetail({
  question,
  questionIndex,
  slots,
  correct,
}: {
  question: Question;
  questionIndex: number;
  slots: (Chunk | null)[];
  correct: boolean;
}) {
  const userAnswer = buildFullAnswerFromSlots(question, slots);

  return (
    <section
      style={{
        width: "min(960px, calc(100% - 48px))",
        margin: "48px auto",
        color: "#172033",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "18px",
          marginBottom: "28px",
        }}
      >
        <div>
          <p style={{ margin: "0 0 8px", color: "#64748b", fontWeight: 800 }}>
            Sentence {questionIndex + 1}
          </p>
          <h1 style={{ margin: 0, fontSize: "38px", fontWeight: 650 }}>
            Answer Review
          </h1>
        </div>
        <span
          style={{
            borderRadius: "999px",
            padding: "9px 16px",
            background: correct ? "#e8f5ef" : "#fff0ed",
            color: correct ? "#087f5b" : "#b42318",
            fontWeight: 900,
          }}
        >
          {correct ? "Correct" : "Wrong"}
        </span>
      </div>

      <section
        style={{
          border: "1px solid #dbe3ea",
          borderRadius: "16px",
          background: "white",
          padding: "24px 26px",
          lineHeight: 1.75,
          fontSize: "18px",
        }}
      >
        <p style={{ marginTop: 0 }}>
          <strong>{question.contextSpeaker}:</strong> {question.contextSentence}
        </p>
        <div style={{ height: "1px", background: "#e2e8f0", margin: "22px 0" }} />
        <p>
          <strong>Your answer:</strong> {question.answerSpeaker}: {userAnswer || "Unfinished"}
        </p>
        <p>
          <strong>Correct answer:</strong> {question.answerSpeaker}:{" "}
          {question.target || renderFullAnswer(question)}
        </p>
        {question.explanation && (
          <p style={{ marginBottom: 0, color: "#64748b" }}>
            <strong>Explanation:</strong> {question.explanation}
          </p>
        )}
      </section>
    </section>
  );
}

function SentencePractice({
  questions,
  currentIndex,
  slotsByQuestion,
  currentSlots,
  currentAnswers,
  currentQuestion,
  currentBank,
  isSubmitted,
  results,
  dragged,
  setDragged,
  setPage,
  nextQuestion,
  previousQuestion,
  goToQuestion,
  submitAll,
  removeChunk,
  placeChunk,
  elapsedSeconds,
  isCountdown,
  onPause,
}: {
  questions: Question[];
  currentIndex: number;
  slotsByQuestion: Record<number, (Chunk | null)[]>;
  currentSlots: (Chunk | null)[];
  currentAnswers: string[];
  currentQuestion: Question;
  currentBank: Chunk[];
  isSubmitted: boolean;
  results: Record<number, number>;
  dragged: DraggedChunk | null;
  setDragged: (chunk: DraggedChunk | null) => void;
  setPage: (page: Page) => void;
  nextQuestion: () => void;
  previousQuestion: () => void;
  goToQuestion: (questionIndex: number) => void;
  submitAll: () => void;
  removeChunk: (slotIndex: number) => void;
  placeChunk: (
    chunk: Chunk,
    slotIndex: number,
    sourceSlotIndex?: number
  ) => void;
  /** Number of seconds elapsed since the practice started. */
  elapsedSeconds: number;
  isCountdown: boolean;
  onPause: () => void;
}) {
  const [isTimeHidden, setIsTimeHidden] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [selectedReviewIndex, setSelectedReviewIndex] = useState(0);
  const [returnToReviewAvailable, setReturnToReviewAvailable] = useState(false);
  const sentenceTouchDrag = useSentenceTouchDrag({
    disabled: isSubmitted,
    setDragged,
    onPlace: (draggedChunk, slotIndex) => {
      placeChunk(
        draggedChunk.chunk,
        slotIndex,
        draggedChunk.sourceSlotIndex
      );
    },
  });

  const [resultStep, setResultStep] = useState<"score" | "answers">("score");
  const totalScore = questions.reduce(
    (sum, question) => sum + (results[question.id] || 0),
    0
  );

  useEffect(() => {
    if (isSubmitted) {
      setResultStep("score");
      setShowReview(false);
      setReturnToReviewAvailable(false);
    }
  }, [isSubmitted]);

  useEffect(() => {
    if (isCountdown && elapsedSeconds <= 0 && !isSubmitted) {
      setSelectedReviewIndex(currentIndex);
      setShowReview(true);
      setReturnToReviewAvailable(false);
    }
  }, [currentIndex, elapsedSeconds, isCountdown, isSubmitted]);

  if (isSubmitted) {
    const selectedResultQuestion = questions[selectedReviewIndex];
    const selectedResultCorrect =
      (results[selectedResultQuestion?.id] || 0) > 0;

    return (
      <>
        <div
          className="exam-green-bar sentence-practice-toolbar"
        >
          {resultStep === "score" && (
            <button
              type="button"
              onClick={() => setResultStep("answers")}
              className="exam-action-button exam-action-button--nav"
            >
              Next
              <span className="exam-action-chevron" aria-hidden="true">›</span>
            </button>
          )}
          {resultStep === "answers" && !returnToReviewAvailable && (
            <button
              type="button"
              onClick={() => setPage("home")}
              className="exam-action-button exam-action-button--nav"
            >
              Home
              <span className="exam-action-chevron" aria-hidden="true">›</span>
            </button>
          )}
          {resultStep === "answers" && returnToReviewAvailable && (
            <>
              <button
                type="button"
                onClick={() => setSelectedReviewIndex((index) => Math.max(0, index - 1))}
                disabled={selectedReviewIndex === 0}
                className="exam-action-button exam-action-button--nav"
              >
                <span className="exam-action-chevron" aria-hidden="true">‹</span>
                Back
              </button>
              <button
                type="button"
                onClick={() => setReturnToReviewAvailable(false)}
                className="exam-action-button exam-action-button--nav"
              >
                Return
              </button>
              <button
                type="button"
                onClick={() =>
                  setSelectedReviewIndex((index) =>
                    Math.min(questions.length - 1, index + 1)
                  )
                }
                disabled={selectedReviewIndex === questions.length - 1}
                className="exam-action-button exam-action-button--nav"
              >
                Next
                <span className="exam-action-chevron" aria-hidden="true">›</span>
              </button>
            </>
          )}
        </div>
        <PracticeStatusBar
          label={
            resultStep === "score"
              ? "Score"
              : returnToReviewAvailable
                ? `Question ${selectedReviewIndex + 1} of ${questions.length}`
                : "Results"
          }
        />
        {resultStep === "score" && (
          <main style={{ maxWidth: "1080px", margin: "0 auto", padding: "44px 28px" }}>
            <h1 style={{ fontSize: "40px", fontWeight: 500 }}>Build a Sentence Score</h1>
            <p style={{ fontSize: "56px", fontWeight: 900, color: "#006b67" }}>
              {totalScore.toFixed(1)} / 10.0
            </p>
          </main>
        )}
        {resultStep === "answers" && !returnToReviewAvailable && (
          <SentenceReviewTable
            questions={questions}
            slotsByQuestion={slotsByQuestion}
            selectedIndex={selectedReviewIndex}
            resultScores={results}
            title="Results"
            description="Select a sentence to view your answer, the correct answer, and feedback."
            onSelect={(index) => {
              setSelectedReviewIndex(index);
              setReturnToReviewAvailable(true);
            }}
          />
        )}
        {resultStep === "answers" && returnToReviewAvailable && selectedResultQuestion && (
          <SentenceResultDetail
            question={selectedResultQuestion}
            questionIndex={selectedReviewIndex}
            slots={slotsByQuestion[selectedResultQuestion.id] || []}
            correct={selectedResultCorrect}
          />
        )}
      </>
    );
  }

  if (showReview) {
    return (
      <>
        <div
          className="exam-green-bar sentence-practice-toolbar"
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <button
            type="button"
            onClick={onPause}
            className="exam-action-button exam-action-button--pause"
          >
            Pause
            <span className="exam-pause-symbol" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => {
              goToQuestion(selectedReviewIndex);
              setShowReview(false);
              setReturnToReviewAvailable(true);
            }}
            className="exam-action-button exam-action-button--nav"
          >
            Go to the Question
            <MorphIcon
              icon={MapPin}
              size={17}
              strokeWidth={2.2}
              reducedMotion="user"
            />
          </button>
          <button
            type="button"
            onClick={() => void submitAll()}
            className="exam-action-button exam-action-button--nav"
          >
            Submit
            <span className="exam-action-chevron" aria-hidden="true">›</span>
          </button>
        </div>

        <PracticeStatusBar
          label="Review"
          timeText={formatDuration(elapsedSeconds)}
          isTimeHidden={isTimeHidden}
          onToggleTime={() => setIsTimeHidden((value) => !value)}
        />

        <SentenceReviewTable
          questions={questions}
          slotsByQuestion={slotsByQuestion}
          selectedIndex={selectedReviewIndex}
          onSelect={setSelectedReviewIndex}
        />
      </>
    );
  }

  return (
    <>
      <div
        className="exam-green-bar sentence-practice-toolbar"
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: "8px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "8px",
            marginLeft: "auto",
            flexWrap: "nowrap",
          }}
        >
          <button
            type="button"
            onClick={previousQuestion}
            disabled={currentIndex === 0 || isSubmitted}
            className="exam-action-button exam-action-button--nav"
          >
            <span className="exam-action-chevron" aria-hidden="true">‹</span>
            Back
          </button>
          {returnToReviewAvailable && (
            <button
              type="button"
              onClick={() => {
                setSelectedReviewIndex(currentIndex);
                setShowReview(true);
                setReturnToReviewAvailable(false);
              }}
              className="exam-action-button exam-action-button--nav"
            >
              Return
            </button>
          )}
          <button
            type="button"
            onClick={onPause}
            disabled={isSubmitted}
            className="exam-action-button exam-action-button--pause"
          >
            Pause
            <span className="exam-pause-symbol" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (currentIndex < questions.length - 1) {
                nextQuestion();
              } else {
                setSelectedReviewIndex(currentIndex);
                setShowReview(true);
                setReturnToReviewAvailable(false);
              }
            }}
            disabled={isSubmitted}
            className="exam-action-button exam-action-button--nav"
          >
            <span>
              Next
            </span>
            <span className="exam-action-chevron" aria-hidden="true">›</span>
          </button>
        </div>
      </div>

      <PracticeStatusBar
        label={`Question ${currentIndex + 1} of ${questions.length}`}
        timeText={formatDuration(elapsedSeconds)}
        isTimeHidden={isTimeHidden}
        onToggleTime={() => setIsTimeHidden((value) => !value)}
      />

      <div
        style={{
          fontSize: "21px",
          lineHeight: "2.05",
          fontWeight: 700,
          margin: "64px auto 34px",
          maxWidth: "1280px",
          textAlign: "left",
        }}
      >
        <div style={{ marginBottom: "96px" }}>
          {currentQuestion.contextSpeaker}: {currentQuestion.contextSentence}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
          <span>{currentQuestion.answerSpeaker}:</span>

          {(() => {
            let blankIndex = 0;

            return currentQuestion.parts.map((part, partIndex) => {
              if (part.type === "fixed") {
                return (
                  <span key={`fixed-${partIndex}`}>
                    {getDisplayedFixedText(currentQuestion, partIndex, part.text)}
                  </span>
                );
              }

              const slotIndex = blankIndex;
              blankIndex += 1;

              const slot = currentSlots[slotIndex];
              const slotIsWrong =
                isSubmitted && slot?.text !== currentAnswers[slotIndex];
              const displayedText = getDisplayedChunkText(
                currentQuestion,
                slotIndex,
                slot
              );

              return (
                <button
                  key={`blank-${partIndex}`}
                  data-sentence-slot-index={slotIndex}
                  onClick={() => {
                    if (dragged) {
                      if (
                        dragged.sourceSlotIndex === slotIndex &&
                        dragged.chunk.id === slot?.id
                      ) {
                        removeChunk(slotIndex);
                      } else {
                        placeChunk(
                          dragged.chunk,
                          slotIndex,
                          dragged.sourceSlotIndex
                        );
                      }
                      setDragged(null);
                      return;
                    }

                    removeChunk(slotIndex);
                  }}
                  draggable={!isSubmitted && Boolean(slot)}
                  onDragStart={() => {
                    if (slot) {
                      setDragged({ chunk: slot, sourceSlotIndex: slotIndex });
                    }
                  }}
                  onDragEnd={() => setDragged(null)}
                  onTouchStart={(event) => {
                    if (slot) {
                      sentenceTouchDrag.startTouchDrag(event, {
                        chunk: slot,
                        sourceSlotIndex: slotIndex,
                      });
                    }
                  }}
                  onTouchMove={sentenceTouchDrag.moveTouchDrag}
                  onTouchEnd={sentenceTouchDrag.finishTouchDrag}
                  onTouchCancel={sentenceTouchDrag.cancelTouchDrag}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragged) {
                      placeChunk(dragged.chunk, slotIndex, dragged.sourceSlotIndex);
                      setDragged(null);
                    }
                  }}
                  style={{
                    minWidth: displayedText ? "auto" : "112px",
                    width: displayedText ? "auto" : "112px",
                    minHeight: "34px",
                    padding: displayedText ? "0 8px 2px" : "0 0 2px",
                    border: "none",
                    borderBottom: "2px solid",
                    borderColor:
                      sentenceTouchDrag.touchDropSlotIndex === slotIndex
                        ? "#00857f"
                        : slotIsWrong
                          ? "#f43f5e"
                          : "#111827",
                    borderRadius: 0,
                    background: "transparent",
                    color: slotIsWrong ? "#be123c" : "#111827",
                    fontSize: "20px",
                    fontWeight: 700,
                    cursor: isSubmitted ? "default" : "pointer",
                    textAlign: "center",
                    verticalAlign: "baseline",
                    touchAction: "none",
                    userSelect: "none",
                    boxShadow:
                      sentenceTouchDrag.touchDropSlotIndex === slotIndex
                        ? "0 7px 0 -4px rgba(0, 133, 127, 0.22)"
                        : "none",
                  }}
                >
                  {displayedText}
                </button>
              );
            });
          })()}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "28px",
          justifyContent: "center",
          margin: "40px auto 24px",
          maxWidth: "1280px",
        }}
      >
          {currentBank.map((chunk: Chunk) => (
            <button
              key={chunk.id}
              draggable={!isSubmitted}
              onDragStart={() => setDragged({ chunk })}
              onDragEnd={() => setDragged(null)}
              onTouchStart={(event) =>
                sentenceTouchDrag.startTouchDrag(event, { chunk })
              }
              onTouchMove={sentenceTouchDrag.moveTouchDrag}
              onTouchEnd={sentenceTouchDrag.finishTouchDrag}
              onTouchCancel={sentenceTouchDrag.cancelTouchDrag}
              style={{
                padding: "4px 2px",
                border: "none",
                borderRadius: 0,
                background: "transparent",
                fontSize: "20px",
                fontWeight: 600,
                cursor: isSubmitted ? "default" : "grab",
                touchAction: "none",
                userSelect: "none",
                color:
                  dragged?.chunk.id === chunk.id ? "#00857f" : "inherit",
                transform:
                  dragged?.chunk.id === chunk.id ? "scale(1.04)" : "none",
              }}
            >
              {normalizeChunkDisplayText(chunk.text)}
            </button>
          ))}

          {currentBank.length === 0 && (
            <span style={{ color: "#64748b" }}>本题词库已清空。</span>
          )}
      </div>

      {sentenceTouchDrag.touchDragPreview && (
        <SentenceTouchDragPreview
          preview={sentenceTouchDrag.touchDragPreview}
        />
      )}

      {isSubmitted && (
        <div
          style={{
            marginTop: "20px",
            padding: "20px",
            borderRadius: "18px",
            background: "#eef2ff",
            color: "#312e81",
          }}
        >
          <strong>正确答案：</strong>
          {currentQuestion.answerSpeaker}:{" "}
          {currentQuestion.target || renderFullAnswer(currentQuestion)}
          <br />
          <br />
          <strong>解析：</strong>
          {currentQuestion.explanation}
        </div>
      )}
    </>
  );
}

function WritingPracticePage({
  title,
  isGenerating,
  onGenerateNew: _onGenerateNew,
  promptBlock,
  responseHeader,
  responseTopBlock,
  protectedPromptText,
  answer,
  setAnswer,
  placeholder,
  isScoring,
  onSubmit,
  onGrade,
  submitted,
  feedback,
  setPage,
  elapsedSeconds,
  isCountdown,
  onPause,
}: {
  title: string;
  isGenerating: boolean;
  onGenerateNew: () => void;
  promptBlock: ReactNode;
  responseHeader?: ReactNode;
  responseTopBlock?: ReactNode;
  protectedPromptText: string;
  answer: string;
  setAnswer: (value: string) => void;
  placeholder: string;
  isScoring: boolean;
  onSubmit: (forceSubmit?: boolean) => void;
  onGrade: () => void;
  submitted: boolean;
  feedback: WritingFeedback | null;
  setPage: (page: Page) => void;
  /** Number of seconds elapsed since the practice started. */
  elapsedSeconds: number;
  isCountdown: boolean;
  onPause: () => void;
}) {
  const [resultStep, setResultStep] = useState<"score" | "feedback">("score");
  const [isTimeHidden, setIsTimeHidden] = useState(false);
  const [showTimeRemaining, setShowTimeRemaining] = useState(false);
  const editor = useTextareaEditor(answer, setAnswer, protectedPromptText);

  useEffect(() => {
    if (submitted) {
      setResultStep("score");
      setShowTimeRemaining(false);
    }
  }, [submitted]);

  const toolbarButtonStyle: CSSProperties = {
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    padding: "8px 14px",
    background: "white",
    cursor: "pointer",
    fontSize: "15px",
    marginRight: "8px",
  };

  if (showTimeRemaining) {
    return (
      <SingleTimeRemainingConfirmation
        questionLabel={title}
        timeText={formatDuration(elapsedSeconds)}
        isTimeHidden={isTimeHidden}
        onToggleTime={() => setIsTimeHidden((value) => !value)}
        onPause={onPause}
        onBack={() => setShowTimeRemaining(false)}
        onContinue={() => {
          setShowTimeRemaining(false);
          onSubmit(true);
        }}
      />
    );
  }

  if (isScoring || submitted) {
    return (
      <>
        <div
          className="exam-green-bar"
          style={
            submitted && !feedback
              ? { justifyContent: "space-between" }
              : undefined
          }
        >
          {submitted && !feedback && (
            <button
              type="button"
              onClick={() => setPage("home")}
              className="exam-action-button exam-action-button--nav"
            >
              <span className="exam-action-chevron" aria-hidden="true">‹</span>
              Home
            </button>
          )}
          {submitted && feedback && (
            <button
              type="button"
              onClick={() => {
                if (resultStep === "score") setResultStep("feedback");
                else setPage("home");
              }}
              className="exam-action-button exam-action-button--nav"
            >
              {resultStep === "score" ? "Next" : "Home"}
              <span className="exam-action-chevron" aria-hidden="true">›</span>
            </button>
          )}
          {submitted && !feedback && (
            <button
              type="button"
              onClick={onGrade}
              disabled={isScoring}
              className="exam-action-button exam-action-button--nav"
            >
              {isScoring ? "批改中..." : "提交批改"}
              <span className="exam-action-chevron" aria-hidden="true">›</span>
            </button>
          )}
        </div>
        <PracticeStatusBar
          label={
            isScoring
              ? "Grading"
              : submitted && !feedback
                ? `${title} Review`
                : resultStep === "score"
                  ? "Score"
                  : "Feedback"
          }
        />
        <main style={{ maxWidth: "1080px", margin: "0 auto", padding: "44px 28px" }}>
          {isScoring && (
            <section
              style={{
                minHeight: "260px",
                display: "grid",
                placeItems: "center",
                textAlign: "center",
                border: "1px solid #e2e8f0",
                borderRadius: "18px",
                background: "#f8fafc",
              }}
            >
              <div>
                <p style={{ fontSize: "34px", fontWeight: 900, color: "#006b67" }}>
                  正在批改中
                </p>
                <p style={{ color: "#64748b" }}>AI 正在生成分数、反馈和提升建议，请稍等。</p>
              </div>
            </section>
          )}

          {!isScoring && submitted && !feedback && (
            <section
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: "18px",
                background: "#fff",
                padding: "28px",
              }}
            >
              <h1 style={{ fontSize: "36px", fontWeight: 800, marginTop: 0 }}>
                {title} Review
              </h1>
              <div
                className="writing-review-grid"
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                  gap: "22px",
                  alignItems: "start",
                }}
              >
                <div
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: "14px",
                    padding: "20px",
                    lineHeight: 1.7,
                    userSelect: "none",
                    WebkitUserSelect: "none",
                  }}
                >
                  {promptBlock}
                  {responseTopBlock}
                </div>
                <div
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: "14px",
                    padding: "20px",
                    lineHeight: 1.7,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  <strong>Your Response</strong>
                  <p style={{ color: "#111827" }}>{answer || "未作答"}</p>
                </div>
              </div>
            </section>
          )}

          {!isScoring && submitted && feedback && resultStep === "score" && (
            <>
              <h1 style={{ fontSize: "40px", fontWeight: 500 }}>{title} Score</h1>
              <p style={{ fontSize: "56px", fontWeight: 900, color: "#006b67" }}>
                {feedback.score}
              </p>
            </>
          )}

          {!isScoring && submitted && feedback && resultStep === "feedback" && (
            <>
              <h1 style={{ fontSize: "40px", fontWeight: 500 }}>{title} Feedback</h1>
              <FeedbackBox
                score={feedback.score}
                strengths={feedback.strengths}
                problems={feedback.problems}
                grammarCorrections={feedback.grammarCorrections}
                actionPlan={feedback.actionPlan}
                improvedVersion={feedback.improvedVersion}
              />
            </>
          )}
        </main>
      </>
    );
  }


  return (
      <>
      {/* Header showing the practice title and elapsed time */}
      <div
        className="exam-green-bar writing-practice-toolbar"
        style={{
          justifyContent: "flex-end",
          position: "sticky",
          top: 0,
          zIndex: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: "8px",
            flexWrap: "nowrap",
            width: "auto",
            marginLeft: "auto",
          }}
        >
          <button
            type="button"
            onClick={onPause}
            disabled={isScoring || isGenerating}
            className="exam-action-button exam-action-button--pause"
          >
            Pause
            <span className="exam-pause-symbol" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (isCountdown && elapsedSeconds > 0) {
                setShowTimeRemaining(true);
              } else {
                onSubmit(true);
              }
            }}
            disabled={isScoring || isGenerating}
            className="exam-action-button exam-action-button--nav"
          >
            Next
            <span className="exam-action-chevron" aria-hidden="true">›</span>
          </button>
        </div>
      </div>

      <PracticeStatusBar
        label={title}
        timeText={formatDuration(elapsedSeconds)}
        isTimeHidden={isTimeHidden}
        onToggleTime={() => setIsTimeHidden((value) => !value)}
      />

      {isGenerating ? (
        <div
          style={{
            padding: "22px",
            borderRadius: "18px",
            background: "#f1f5f9",
            marginBottom: "24px",
            color: "#64748b",
            fontWeight: 700,
          }}
        >
          正在生成新题目...
        </div>
      ) : (
        <div className="writing-exam-scroll">
        <div className="writing-exam-grid">
          <section
            onContextMenu={(event) => event.preventDefault()}
            onCopy={(event) => event.preventDefault()}
            onCut={(event) => event.preventDefault()}
            style={{
              minHeight: "calc(100vh - 178px)",
              padding: "24px 28px",
              border: "2px solid #e5e7eb",
              borderRadius: "18px",
              lineHeight: 1.65,
              overflow: "auto",
              fontSize: "16px",
              userSelect: "none",
              WebkitUserSelect: "none",
            }}
          >
            {promptBlock}
          </section>

          <section
            style={{
              minHeight: "calc(100vh - 178px)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                marginBottom: "12px",
                lineHeight: 1.55,
                fontSize: "16px",
                fontWeight: 700,
              }}
            >
              {responseHeader || <strong>Your Response:</strong>}
            </div>

            {responseTopBlock && (
              <div
                onContextMenu={(event) => event.preventDefault()}
                onCopy={(event) => event.preventDefault()}
                onCut={(event) => event.preventDefault()}
                style={{
                  userSelect: "none",
                  WebkitUserSelect: "none",
                }}
              >
                {responseTopBlock}
              </div>
            )}

            <div
              style={{
                display: "flex",
                gap: "8px",
                marginBottom: "12px",
                flexShrink: 0,
              }}
              onContextMenu={(event) => event.preventDefault()}
            >
              <button type="button" onClick={editor.cutSelection} style={toolbarButtonStyle}>
                Cut
              </button>
              <button type="button" onClick={editor.pasteFromClipboard} style={toolbarButtonStyle}>
                Paste
              </button>
              <button type="button" onClick={editor.undo} style={toolbarButtonStyle}>
                Undo
              </button>
              <button type="button" onClick={editor.redo} style={toolbarButtonStyle}>
                Redo
              </button>
            </div>

            <textarea
              ref={editor.textareaRef}
              value={answer}
              onChange={editor.handleChange}
              onPaste={editor.handlePaste}
              onContextMenu={(event) => event.preventDefault()}
              placeholder={placeholder}
              disabled={isGenerating || isScoring}
              style={{
                width: "100%",
                flex: 1,
                minHeight: "320px",
                padding: "18px",
                borderRadius: "18px",
                border: "2px solid #e5e7eb",
                fontSize: "16px",
                lineHeight: 1.6,
                resize: "vertical",
                boxSizing: "border-box",
                background: isGenerating || isScoring ? "#f8fafc" : "white",
              }}
            />
          </section>
        </div>
        </div>
      )}

    </>
  );
}

function FeedbackBox({
  score,
  strengths,
  problems,
  grammarCorrections,
  actionPlan,
  improvedVersion,
}: {
  score: string;
  strengths: string[];
  problems: string[];
  grammarCorrections?: {
    original: string;
    corrected: string;
    explanation: string;
  }[];
  actionPlan?: string[];
  improvedVersion: string;
}) {
  return (
    <div
      style={{
        padding: "24px",
        borderRadius: "20px",
        background: "#eef2ff",
        color: "#312e81",
      }}
    >
      <h3 style={{ marginTop: 0 }}>个性化评价与提升建议：{score}</h3>

      <strong>亮点</strong>
      <ul style={{ lineHeight: 1.8 }}>
        {strengths.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <strong>主要问题</strong>
      <ul style={{ lineHeight: 1.8 }}>
        {problems.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      {grammarCorrections && grammarCorrections.length > 0 && (
        <>
          <strong>语言修改建议</strong>
          <div style={{ display: "grid", gap: "12px", marginTop: "12px" }}>
            {grammarCorrections.map((item, index) => (
              <div
                key={`${item.original}-${index}`}
                style={{
                  background: "white",
                  padding: "14px",
                  borderRadius: "14px",
                  color: "#111827",
                  lineHeight: 1.7,
                }}
              >
                <div>
                  <strong>原文：</strong> {item.original}
                </div>
                <div>
                  <strong>修改：</strong> {item.corrected}
                </div>
                <div style={{ color: "#64748b" }}>
                  <strong>说明：</strong> {item.explanation}
                </div>
              </div>
            ))}
          </div>
          <br />
        </>
      )}

      {actionPlan && actionPlan.length > 0 && (
        <>
          <strong>提分建议</strong>
          <ul style={{ lineHeight: 1.8 }}>
            {actionPlan.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      )}

      <strong>优化版本</strong>
      <pre
        style={{
          whiteSpace: "pre-wrap",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          lineHeight: 1.8,
          background: "white",
          padding: "18px",
          borderRadius: "16px",
          color: "#111827",
        }}
      >
        {improvedVersion}
      </pre>

    </div>
  );
}

type OfficialScoringRow = {
  score: string;
  title: string;
  description: string;
  bullets?: string[];
  shaded?: boolean;
};

const emailOfficialScoringRows: OfficialScoringRow[] = [
  {
    score: "5",
    title: "A fully successful response",
    description:
      "The response is effective, is clearly expressed, and shows consistent facility in the use of language.",
    bullets: [
      "Elaboration that effectively supports the communicative purpose",
      "Effective syntactic variety and precise, idiomatic word choice",
      "Consistent use of appropriate social conventions (e.g., politeness, register, organization of information, and formulation of actions such as requests, refusals, criticisms, etc.)",
      "Almost no lexical or grammatical errors other than those expected from a competent writer writing under timed conditions (e.g., common typos or common misspellings or substitutions like there/their)",
    ],
    shaded: true,
  },
  {
    score: "4",
    title: "A generally successful response",
    description:
      "The response is mostly effective and easily understood. Language facility is adequate to the task.",
    bullets: [
      "Adequate elaboration to support the communicative purpose",
      "Syntactic variety and appropriate word choice",
      "Mostly appropriate social conventions",
      "Few lexical or grammatical errors",
    ],
  },
  {
    score: "3",
    title: "A partially successful response",
    description:
      "The response generally accomplishes the task. Limitations in language facility may prevent parts of the message from being fully clear and effective.",
    bullets: [
      "Elaboration that partially supports the communicative purpose",
      "A moderate range of syntax and vocabulary",
      "Some noticeable errors in structure, word forms, use of idiomatic language and/or social conventions",
    ],
    shaded: true,
  },
  {
    score: "2",
    title: "A mostly unsuccessful response",
    description:
      "The response reflects an attempt to address the task, but it is mostly ineffective. The message may be limited or difficult to interpret.",
    bullets: [
      "Limited or irrelevant elaboration",
      "Some connected sentence-level language, with a limited range of syntax and vocabulary",
      "An accumulation of errors in sentence structure and/or language use",
    ],
  },
  {
    score: "1",
    title: "An unsuccessful response",
    description:
      "The response reflects an ineffective attempt to address the task. The message may be limited to the point of being unintelligible.",
    bullets: [
      "Very little elaboration, if any",
      "Telegraphic language (i.e., short and/or disconnected phrases and sentences) with a very limited range of vocabulary",
      "Serious and frequent errors in the use of language",
      "Minimal original language; any coherent language is mostly borrowed from the stimulus",
    ],
    shaded: true,
  },
  {
    score: "0",
    title: "",
    description:
      "The response is blank, rejects the topic, is not in English, is entirely copied from the prompt, is entirely unconnected to the prompt or consists of arbitrary keystrokes.",
  },
];

const discussionOfficialScoringRows: OfficialScoringRow[] = [
  {
    score: "5",
    title: "A fully successful response",
    description:
      "The response is a relevant and very clearly expressed contribution to the online discussion, and it demonstrates consistent facility in the use of language.",
    bullets: [
      "Relevant and well-elaborated explanations, exemplifications, and/or details",
      "Effective use of a variety of syntactic structures and precise, idiomatic word choice",
      "Almost no lexical or grammatical errors other than those expected from a competent writer writing under timed conditions (e.g., common typos or common misspellings or substitutions like there/their)",
    ],
    shaded: true,
  },
  {
    score: "4",
    title: "A generally successful response",
    description:
      "The response is a relevant contribution to the online discussion, and facility in the use of language allows the writer's ideas to be easily understood.",
    bullets: [
      "Relevant and adequately elaborated explanations, exemplifications, and/or details",
      "A variety of syntactic structures and appropriate word choice",
      "Few lexical or grammatical errors",
    ],
  },
  {
    score: "3",
    title: "A partially successful response",
    description:
      "The response is a mostly relevant and mostly understandable contribution to the online discussion, and there is some facility in the use of language.",
    bullets: [
      "Elaboration in which part of an explanation, example, or detail may be missing, unclear, or irrelevant",
      "Some variety in syntactic structures and a range of vocabulary",
      "Some noticeable lexical and grammatical errors in sentence structure, word form, or use of idiomatic language",
    ],
    shaded: true,
  },
  {
    score: "2",
    title: "A mostly unsuccessful response",
    description:
      "The response reflects an attempt to contribute to the online discussion, but limitations in the use of language may make ideas hard to follow.",
    bullets: [
      "Ideas that may be poorly elaborated or only partially relevant",
      "A limited range of syntactic structures and vocabulary",
      "An accumulation of errors in sentence structure, word forms, or use",
    ],
  },
  {
    score: "1",
    title: "An unsuccessful response",
    description:
      "The response reflects an ineffective attempt to contribute to the online discussion, and limitations in the use of language may prevent the expression of ideas.",
    bullets: [
      "Words and phrases that indicate an attempt to address the task but with few or no coherent ideas",
      "Severely limited range of syntactic structures and vocabulary",
      "Serious and frequent errors in the use of language",
      "Minimal original language; any coherent language is mostly borrowed from the stimulus",
    ],
    shaded: true,
  },
  {
    score: "0",
    title: "",
    description:
      "The response is blank, rejects the topic, is not in English, is entirely copied from the prompt, is entirely unconnected to the prompt, or consists of arbitrary keystrokes.",
  },
];

function OfficialScoringGuidePage({ type }: { type: "email" | "discussion" }) {
  const isEmail = type === "email";

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f8f9ff",
        color: "#171c2d",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        padding: "44px 24px 72px",
      }}
    >
      <div style={{ maxWidth: "1120px", margin: "0 auto" }}>
        <button
          type="button"
          onClick={() => window.close()}
          style={{
            border: "1px solid #d6d8e5",
            borderRadius: "6px",
            background: "white",
            color: "#35307d",
            padding: "10px 16px",
            fontSize: "16px",
            fontWeight: 850,
            cursor: "pointer",
            marginBottom: "18px",
          }}
        >
          关闭
        </button>
        <OfficialScoringTable
          title={
            isEmail
              ? "Write an Email Scoring Guide"
              : "Write for an Academic Discussion Scoring Guide"
          }
          rows={isEmail ? emailOfficialScoringRows : discussionOfficialScoringRows}
        />
      </div>
    </main>
  );
}

function OfficialScoringTable({
  title,
  rows,
}: {
  title: string;
  rows: OfficialScoringRow[];
}) {
  return (
    <div
      style={{
        background: "white",
        borderRadius: "8px",
        overflow: "hidden",
        borderBottom: "4px solid #30327c",
        margin: "4px 0 8px",
        textAlign: "left",
      }}
    >
      <h2
        style={{
          margin: "0 0 6px",
          color: "#30327c",
          fontSize: "16px",
          fontWeight: 900,
        }}
      >
        {title}
      </h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "92px 1fr",
          background: "#30327c",
          color: "white",
          fontWeight: 900,
          fontSize: "14px",
        }}
      >
        <div style={{ padding: "8px 12px" }}>Score</div>
        <div style={{ padding: "8px 12px" }}>General Description</div>
      </div>

      {rows.map((row) => (
        <div
          key={`${title}-${row.score}`}
          style={{
            display: "grid",
            gridTemplateColumns: "92px 1fr",
            background: row.shaded ? "#e8e9ff" : "white",
            color: "#111827",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: row.score === "0" ? "72px" : "104px",
              color: "#30327c",
              fontSize: "48px",
              fontWeight: 900,
              lineHeight: 1,
            }}
          >
            {row.score}
          </div>
          <div
            style={{
              padding: row.score === "0" ? "16px 14px" : "9px 14px",
              fontSize: "12px",
              lineHeight: 1.35,
              fontWeight: row.score === "0" ? 900 : 500,
              textAlign: "left",
            }}
          >
            {row.title && (
              <strong
                style={{
                  display: "block",
                  fontWeight: 900,
                  marginBottom: "1px",
                  textAlign: "left",
                }}
              >
                {row.title}
              </strong>
            )}
            <div style={{ textAlign: "left" }}>{row.description}</div>
            {row.bullets && (
              <>
                <div style={{ marginTop: "5px", textAlign: "left" }}>
                  A typical response displays the following:
                </div>
                <ul
                  style={{
                    margin: "5px 0 0",
                    paddingLeft: "22px",
                    textAlign: "left",
                    listStylePosition: "outside",
                  }}
                >
                  {row.bullets.map((bullet) => (
                    <li key={bullet} style={{ marginBottom: "2px" }}>
                      {bullet}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function PointsModal({ onClose }: { onClose: () => void }) {
  const packages = [
    {
      name: "体验套餐",
      points: 20,
      price: "¥39.9",
      discount: '',
      description: "适合轻量体验 Build A Sentence / Email / Discussion 功能。",
    },
    {
      name: "练习套餐",
      points: 60,
      price: "¥109.9",
      discount: '优惠10%',
      description: "适合一段时间内稳定进行写作练习。",
    },
    {
      name: "强化套餐",
      points: 150,
      price: "¥249",
      discount: '优惠15%',
      description: "适合高频练习，在集中备考阶段使用。",
    },
  ];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        zIndex: 999,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "620px",
          background: "white",
          borderRadius: "24px",
          padding: "30px",
          boxShadow: "0 20px 60px rgba(15, 23, 42, 0.25)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "16px",
            alignItems: "center",
            marginBottom: "14px",
          }}
        >
          <h2 style={{ margin: 0 }}>获取 Points</h2>

          <button
            type="button"
            onClick={onClose}
            style={{
              border: "1px solid #cbd5e1",
              background: "white",
              borderRadius: "999px",
              width: "36px",
              height: "36px",
              cursor: "pointer",
              fontWeight: 800,
            }}
          >
            ×
          </button>
        </div>

        <p style={{ color: "#64748b", lineHeight: 1.8, marginBottom: "22px" }}>
          请联系客服获取。
        </p>

        <div style={{ display: "grid", gap: "12px", marginBottom: "24px" }}>
          {packages.map((item) => (
            <div
              key={item.name}
              style={{
                position: "relative",
                padding: "18px",
                border: "1px solid #e2e8f0",
                borderRadius: "18px",
                background: "#f8fafc",
                overflow: "hidden",
              }}
            >
              {item.discount && (
                <div
                  style={{
                    position: "absolute",
                    top: "12px",
                    right: "12px",
                    padding: "5px 10px",
                    borderRadius: "999px",
                    background: "#dc2626",
                    color: "white",
                    fontSize: "12px",
                    fontWeight: 800,
                  }}
                >
                  {item.discount}
                 </div>
              )}

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "12px",
                  alignItems: "flex-start",
                  marginBottom: "8px",
                  paddingRight: item.discount ? "86px" : 0,
                }}
              >
                <div>
                  <strong style={{ fontSize: "17px" }}>{item.name}</strong>

                  <div
                    style={{
                      color: "#64748b",
                      fontSize: "14px",
                      marginTop: "6px",
                      fontWeight: 700,
                    }}
                  >
                    {item.points} points
                  </div>
                </div>

                <strong
                  style={{
                    fontSize: "22px",
                    color: "#111827",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.price}
                </strong>
              </div>

              <p style={{ color: "#64748b", margin: 0, lineHeight: 1.7 }}>
                {item.description}
              </p>
            </div>
          ))}
        </div>

        <div
          style={{
            textAlign: "center",
            padding: "22px",
            borderRadius: "20px",
            background: "#eef2ff",
          }}
        >
          <img
            src="/customer-service-qr.png"
            alt="客服二维码"
            style={{
              width: "180px",
              height: "180px",
              objectFit: "cover",
              borderRadius: "16px",
              border: "1px solid #c7d2fe",
              background: "white",
            }}
          />

          <p
            style={{
              color: "#312e81",
              fontWeight: 700,
              marginBottom: 0,
            }}
          >
            请扫码联系客服
          </p>
        </div>
      </div>
    </div>
  );
}

function MockTestPage({
  data,
  sentenceSlots,
  setSentenceSlots,
  sentenceBanks,
  dragged,
  setDragged,
  emailAnswer,
  setEmailAnswer,
  discussionAnswer,
  setDiscussionAnswer,
  isSubmitting,
  onSubmit,
  onCancel: _onCancel,
  onPauseExit,
}: {

  data: MockTestData;

  sentenceSlots: Record<number, (Chunk | null)[]>;

  setSentenceSlots: (

    value:

      | Record<number, (Chunk | null)[]>

      | ((

          previous: Record<number, (Chunk | null)[]>

        ) => Record<number, (Chunk | null)[]>)

  ) => void;

  sentenceBanks: Record<number, Chunk[]>;

  dragged: DraggedChunk | null;

  setDragged: (chunk: DraggedChunk | null) => void;

  emailAnswer: string;

  setEmailAnswer: (value: string) => void;

  discussionAnswer: string;

  setDiscussionAnswer: (value: string) => void;

  isSubmitting: boolean;

  message: string;

  onSubmit: () => void;

  onCancel: () => void;

  onPauseExit: () => void;

}) {

  const cardStyle = {
    background: "white",
    border: "none",
    borderRadius: "0",
    padding: "18px 28px",
    marginBottom: "0",
    boxShadow: "none",
    minHeight: "calc(100vh - 104px)",
    boxSizing: "border-box" as const,
  };

  const secondaryButtonStyle = {

    padding: "12px 20px",

    border: "1px solid #cbd5e1",

    borderRadius: "12px",

    background: "white",

    fontWeight: 700,

    cursor: "pointer",

  };

  const selectedMockTypes = (
    data.selectedTypes?.length
      ? data.selectedTypes
      : (["sentence", "email", "discussion"] as PastExamPracticeType[])
  ).filter((type, index, list) => list.indexOf(type) === index);
  const orderedMockTypes = (["sentence", "email", "discussion"] as PastExamPracticeType[]).filter(
    (type) => selectedMockTypes.includes(type)
  );
  const orderedMockTypeKey = orderedMockTypes.join("|");
  const selectedWritingTypes = orderedMockTypes.filter(
    (type) => type === "email" || type === "discussion"
  );
  const firstMockPart = orderedMockTypes[0] || "sentence";
  const [mockPart, setMockPart] = useState<PastExamPracticeType>(
    firstMockPart
  );
  const [mockStage, setMockStage] = useState<
    | "overview"
    | "sentence-intro"
    | "sentence"
    | "sentence-review"
    | "email-intro"
    | "email"
    | "email-confirm"
    | "discussion-intro"
    | "discussion"
    | "discussion-confirm"
    | "end"
  >("overview");

  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(0);
  const [sentenceReviewReturnAvailable, setSentenceReviewReturnAvailable] =
    useState(false);

  const [timeLeft, setTimeLeft] = useState(6 * 60);
  const [isTimeHidden, setIsTimeHidden] = useState(false);
  const onSubmitRef = useRef(onSubmit);

  // Track whether the user has paused the mock test. When paused, the countdown
  // timer is halted and a modal asking whether to return or continue is shown.
  const [isPaused, setIsPaused] = useState(false);
  const [showPauseModal, setShowPauseModal] = useState(false);

  // Styles for toolbar buttons that appear above the textareas in the email and
  // discussion parts. These buttons offer simple editing actions like cut,
  // paste, undo and redo. The look is kept minimal to blend with the
  // streamlined exam UI.
  const toolbarButtonStyle: CSSProperties = {
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    padding: "8px 14px",
    background: "white",
    cursor: "pointer",
    fontSize: "15px",
    marginRight: "8px",
  };

  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  useEffect(() => {
    // Halt the timer when the test is submitting or paused. This ensures the
    // countdown stops while the pause modal is visible.
    if (
      isSubmitting ||
      isPaused ||
      ![
        "sentence",
        "sentence-review",
        "email",
        "email-confirm",
        "discussion",
        "discussion-confirm",
      ].includes(mockStage)
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      setTimeLeft((previous) => {
        if (previous <= 1) {
          window.clearInterval(timer);

          if (mockPart === "sentence") {
            setMockStage("sentence-review");
            window.scrollTo({ top: 0, behavior: "smooth" });
            return 0;
          }

          if (mockPart === "discussion") {
            // For the discussion part we do not auto-submit when time is up.
            // Simply set time left to zero and allow the user to submit manually.
            return 0;
          }

          const currentPartIndex = orderedMockTypes.indexOf(mockPart);
          const nextPart = orderedMockTypes[currentPartIndex + 1];

          if (nextPart) {
            setMockPart(nextPart);
            setMockStage(getIntroStageForPart(nextPart));
            setCurrentSentenceIndex(0);
            window.scrollTo({ top: 0, behavior: "smooth" });
            return getDurationForPart(nextPart);
          }

          setMockStage("end");
          window.scrollTo({ top: 0, behavior: "smooth" });
          return 0;
        }

        return previous - 1;
      });
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [mockPart, mockStage, isSubmitting, isPaused, orderedMockTypeKey]);

  function formatTime(seconds: number) {

    const minutes = Math.floor(seconds / 60);
    const restSeconds = seconds % 60;
    return `${minutes}:${String(restSeconds).padStart(2, "0")}`;
  }

  function getIntroStageForPart(part: PastExamPracticeType) {
    if (part === "sentence") return "sentence-intro" as const;
    if (part === "email") return "email-intro" as const;
    return "discussion-intro" as const;
  }

  function getDurationForPart(part: PastExamPracticeType) {
    if (part === "sentence") return 6 * 60 + 50;
    if (part === "email") return 7 * 60;
    return 10 * 60;
  }

  function goToMockPart(part: PastExamPracticeType) {
    setMockPart(part);
    setMockStage(getIntroStageForPart(part));
    setTimeLeft(getDurationForPart(part));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goToNextMockPartAfter(part: PastExamPracticeType) {
    const currentPartIndex = orderedMockTypes.indexOf(part);
    const nextPart = orderedMockTypes[currentPartIndex + 1];

    if (nextPart) {
      goToMockPart(nextPart);
      return;
    }

    setMockStage("end");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goToNextSentence() {

    if (currentSentenceIndex < data.sentenceQuestions.length - 1) {

      setCurrentSentenceIndex((previous) => previous + 1);

      window.scrollTo({ top: 0, behavior: "smooth" });

      return;

    }

    setMockStage("sentence-review");

  }

  function handleHeaderNext() {
    if (mockPart === "sentence") {
      if (currentSentenceIndex < data.sentenceQuestions.length - 1) {
        goToNextSentence();
      } else {
        setMockStage("sentence-review");
      }
    } else if (mockPart === "email") {
      setMockStage("email-confirm");
    } else {
      setMockStage("discussion-confirm");
    }
  }


  function updateQuestionSlots(questionId: number, newSlots: (Chunk | null)[]) {

    setSentenceSlots((previous) => ({

      ...previous,

      [questionId]: newSlots,

    }));

  }

  function placeChunk(
    question: Question,
    chunk: Chunk,
    slotIndex: number,
    sourceSlotIndex?: number
  ) {

    const currentSlots = sentenceSlots[question.id] || makeEmptySlots(question);

    const newSlots = [...currentSlots];

    const oldSlotIndex = newSlots.findIndex(
      (slot: Chunk | null, index) =>
        index !== slotIndex && slot?.id === chunk.id
    );

    if (oldSlotIndex !== -1) {

      newSlots[oldSlotIndex] = null;

    }

    if (sourceSlotIndex !== undefined && sourceSlotIndex !== slotIndex) {

      newSlots[sourceSlotIndex] = null;

    }

    newSlots[slotIndex] = chunk;

    updateQuestionSlots(question.id, newSlots);

  }

  function removeChunk(question: Question, slotIndex: number) {

    const currentSlots = sentenceSlots[question.id] || makeEmptySlots(question);

    const newSlots = [...currentSlots];

    newSlots[slotIndex] = null;

    updateQuestionSlots(question.id, newSlots);

  }

  function resetCurrentQuestion(question: Question) {

    updateQuestionSlots(question.id, makeEmptySlots(question));

  }

  function getAvailableBank(question: Question) {

    const currentSlots = sentenceSlots[question.id] || makeEmptySlots(question);

    const usedIds = currentSlots
      .filter((slot): slot is Chunk => slot !== null)
      .map((slot: Chunk) => slot.id);

    return (sentenceBanks[question.id] || []).filter(
      (chunk: Chunk) => !usedIds.includes(chunk.id)
    );

  }

  const emailWordCount = emailAnswer.trim()

    ? emailAnswer.trim().split(/\s+/).length

    : 0;

  const discussionWordCount = discussionAnswer.trim()

    ? discussionAnswer.trim().split(/\s+/).length

    : 0;

  const emailEditor = useTextareaEditor(
    emailAnswer,
    setEmailAnswer,
    getEmailPromptText(data.emailPrompt)
  );
  const discussionEditor = useTextareaEditor(
    discussionAnswer,
    setDiscussionAnswer,
    getDiscussionPromptText(data.discussionPrompt)
  );

  const currentQuestion = data.sentenceQuestions[currentSentenceIndex];
  const activeQuestionStage = ["sentence", "email", "discussion"].includes(mockStage);
  const mockSentenceTouchDrag = useSentenceTouchDrag({
    disabled: isSubmitting || mockStage !== "sentence",
    setDragged,
    onPlace: (draggedChunk, slotIndex) => {
      if (!currentQuestion) return;

      placeChunk(
        currentQuestion,
        draggedChunk.chunk,
        slotIndex,
        draggedChunk.sourceSlotIndex
      );
    },
  });

  function renderExamTopBar(
    actions: Array<{
      label: string;
      onClick: () => void;
      variant?: "outline";
      disabled?: boolean;
    }>
  ) {
    return (
      <div
        className="exam-green-bar"
      >
        {actions.map((action) => {
          const isBack = action.label === "Back";
          const isPause = action.label === "Pause";
          const isGoToQuestion = action.label === "Go to the Question";

          return (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              disabled={isSubmitting || action.disabled}
              className={`exam-action-button ${
                isPause
                  ? "exam-action-button--pause"
                  : "exam-action-button--nav"
              }`}
            >
              {isBack && (
                <span className="exam-action-chevron" aria-hidden="true">‹</span>
              )}
              <span>{action.label}</span>
              {isPause ? (
                <span className="exam-pause-symbol" aria-hidden="true" />
              ) : isGoToQuestion ? (
                <MorphIcon
                  icon={MapPin}
                  size={17}
                  strokeWidth={2.2}
                  reducedMotion="user"
                />
              ) : !isBack ? (
                <span className="exam-action-chevron" aria-hidden="true">›</span>
              ) : null}
            </button>
          );
        })}
      </div>
    );
  }

  function renderExamSubHeader(questionLabel?: string, showTimer = false) {
    return (
      <PracticeStatusBar
        label={questionLabel}
        timeText={showTimer ? formatTime(timeLeft) : undefined}
        isTimeHidden={isTimeHidden}
        onToggleTime={
          showTimer ? () => setIsTimeHidden((value) => !value) : undefined
        }
      />
    );
  }

  function renderIntroPage(
    title: string,
    body: ReactNode,
    buttonLabel: string,
    onClick: () => void
  ) {
    return (
      <>
        {renderExamTopBar([{ label: buttonLabel, onClick }])}
        {renderExamSubHeader()}
        <section
          className="exam-direction-page"
        >
          <h1
            className="exam-direction-title"
          >
            {title}
          </h1>
          <div className="exam-direction-body">{body}</div>
        </section>
      </>
    );
  }

  function renderLeaveConfirm(next: () => void, back: () => void, questionLabel: string) {
    return (
      <>
        {renderExamTopBar([
          { label: "Back", onClick: back, variant: "outline" },
          {
            label: "Pause",
            onClick: () => {
              setIsPaused(true);
              setShowPauseModal(true);
            },
            variant: "outline",
          },
          { label: "Continue", onClick: next },
        ])}
        {renderExamSubHeader(questionLabel, true)}
        <section
          style={{
            maxWidth: "1120px",
            margin: "0 auto",
            padding: "56px 28px",
            color: "#444",
            fontSize: "24px",
            lineHeight: 1.55,
          }}
        >
          <h1
            style={{
              fontSize: "40px",
              fontWeight: 500,
              margin: "0 0 26px",
              borderBottom: "2px solid #d6d6d6",
              paddingBottom: "18px",
            }}
          >
            Time Remaining
          </h1>
          <p>You still have time to respond. As long as there is time remaining, you can keep writing or revise your response.</p>
          <p>Select <strong>Back</strong> to keep writing or revising.</p>
          <p>Select <strong>Continue</strong> to leave this question.</p>
          <p>Once you leave this question, you WILL NOT be able to return to it.</p>
        </section>
      </>
    );
  }

  function getWritingQuestionLabel(part: "email" | "discussion") {
    const writingIndex = selectedWritingTypes.indexOf(part) + 1;
    const writingTotal = selectedWritingTypes.length;

    return writingTotal > 0
      ? `Question ${writingIndex} of ${writingTotal}`
      : "";
  }

  function getOverviewDescription() {
    if (orderedMockTypes.length === 3) {
      return "In the writing section, you will answer 12 questions to demonstrate how well you can write in English. There are three types of tasks.";
    }

    if (orderedMockTypes.length === 2) {
      return "In this writing practice, you will complete two selected task types in the same order as the test.";
    }

    return "In this writing practice, you will complete one selected task type.";
  }

  const overviewRows = [
    {
      type: "sentence" as PastExamPracticeType,
      label: "Build a Sentence",
      description: "Create grammatical sentences.",
    },
    {
      type: "email" as PastExamPracticeType,
      label: "Write an Email",
      description: "Write an email using information provided.",
    },
    {
      type: "discussion" as PastExamPracticeType,
      label: "Write for an Academic Discussion",
      description: "Participate in an online discussion.",
    },
  ].filter((row) => orderedMockTypes.includes(row.type));

  return (

    <>
      {showPauseModal && (
        <div style={pauseModalOverlayStyle}>
          <div style={pauseModalContentStyle}>
            <h1 style={pauseModalTitleStyle}>Pause</h1>

            <div style={pauseModalDividerStyle} />

            <p style={pauseModalTextStyle}>
              Select <strong>Return</strong> to continue working.
            </p>

            <p style={{ ...pauseModalTextStyle, marginTop: "4px" }}>
              Select <strong>Continue</strong> to leave this question.
            </p>

            <div style={pauseModalActionsStyle}>

              <button
                type="button"
                onClick={() => {
                  setShowPauseModal(false);
                  setIsPaused(false);
                }}
                style={pauseModalButtonStyle}
              >
                Return
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowPauseModal(false);
                  setIsPaused(false);
                  onPauseExit();
                }}
                style={pauseModalButtonStyle}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
      {mockStage === "overview" &&
        renderIntroPage(
          "Writing",
          <>
            <p>{getOverviewDescription()}</p>
            <table
              style={{
                borderCollapse: "collapse",
                marginTop: "24px",
                minWidth: "520px",
                fontSize: "22px",
              }}
            >
              <thead>
                <tr style={{ background: "#ffad75" }}>
                  <th style={{ border: "2px solid #3f1d12", padding: "8px 16px", textAlign: "left" }}>
                    Type of Task
                  </th>
                  <th style={{ border: "2px solid #3f1d12", padding: "8px 16px", textAlign: "left" }}>
                    Description
                  </th>
                </tr>
              </thead>
              <tbody>
                {overviewRows.map((row) => (
                  <tr key={row.type}>
                    <td style={{ border: "1px solid #3f1d12", padding: "8px 16px" }}>
                      {row.label}
                    </td>
                    <td style={{ border: "1px solid #3f1d12", padding: "8px 16px" }}>
                      {row.description}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>,
          "Continue",
          () => goToMockPart(firstMockPart)
        )}
      {mockStage === "sentence-intro" &&
        orderedMockTypes.includes("sentence") &&
        renderIntroPage(
          "Build a Sentence",
          <>
            <p>Move the words in the boxes to create grammatical sentences.</p>
            <p>In an actual test, a clock will show you how much time you have to complete this task.</p>
          </>,
          "Begin",
          () => {
            setMockPart("sentence");
            setMockStage("sentence");
            setTimeLeft(getDurationForPart("sentence"));
          }
        )}
      {mockStage === "email-intro" &&
        orderedMockTypes.includes("email") &&
        renderIntroPage(
          "Write an Email",
          <>
            <p>You will read some information and use the information to write an email.</p>
            <p>You will have 7 minutes to write the email.</p>
          </>,
          "Begin",
          () => {
            setMockPart("email");
            setMockStage("email");
            setTimeLeft(getDurationForPart("email"));
          }
        )}
      {mockStage === "discussion-intro" &&
        orderedMockTypes.includes("discussion") &&
        renderIntroPage(
          "Write for an Academic Discussion",
          <>
            <p>
              A professor has posted a question about a topic and students have responded with their
              thoughts and ideas. Make a contribution to the discussion.
            </p>
            <p>You will have 10 minutes to write.</p>
          </>,
          "Begin",
          () => {
            setMockPart("discussion");
            setMockStage("discussion");
            setTimeLeft(getDurationForPart("discussion"));
          }
        )}
      {mockStage === "email-confirm" &&
        renderLeaveConfirm(
          () => goToNextMockPartAfter("email"),
          () => setMockStage("email"),
          getWritingQuestionLabel("email")
        )}
      {mockStage === "sentence-review" && (
        <>
          {renderExamTopBar([
            {
              label: "Pause",
              onClick: () => {
                setIsPaused(true);
                setShowPauseModal(true);
              },
              variant: "outline",
            },
            {
              label: "Go to the Question",
              onClick: () => {
                setSentenceReviewReturnAvailable(true);
                setMockStage("sentence");
                window.scrollTo({ top: 0, behavior: "smooth" });
              },
            },
            {
              label: "Submit",
              onClick: () => goToNextMockPartAfter("sentence"),
            },
          ])}
          {renderExamSubHeader("Review", true)}
          <SentenceReviewTable
            questions={data.sentenceQuestions}
            slotsByQuestion={sentenceSlots}
            selectedIndex={currentSentenceIndex}
            onSelect={setCurrentSentenceIndex}
          />
        </>
      )}
      {mockStage === "discussion-confirm" &&
        renderLeaveConfirm(
          () => setMockStage("end"),
          () => setMockStage("discussion"),
          getWritingQuestionLabel("discussion")
        )}
      {mockStage === "end" &&
        renderIntroPage(
          "End of Writing Section",
          <p>Thank you for completing the writing section.</p>,
          isSubmitting ? "Submitting..." : "Next",
          () => onSubmit()
        )}
      {activeQuestionStage && (
        <>
          {renderExamTopBar([
            ...(mockPart === "sentence"
              ? [
                  {
                    label: "Back",
                    onClick: () => {
                      if (currentSentenceIndex > 0) {
                        setCurrentSentenceIndex((previous) => previous - 1);
                        setDragged(null);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }
                    },
                    variant: "outline" as const,
                    disabled: currentSentenceIndex === 0,
                  },
                ]
              : []),
            ...(mockPart === "sentence" && sentenceReviewReturnAvailable
              ? [
                  {
                    label: "Return",
                    onClick: () => {
                      setSentenceReviewReturnAvailable(false);
                      setMockStage("sentence-review");
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    },
                    variant: "outline" as const,
                  },
                ]
              : []),
            {
              label: "Pause",
              onClick: () => {
                setIsPaused(true);
                setShowPauseModal(true);
              },
              variant: "outline",
            },
            {
              label: "Next",
              onClick: handleHeaderNext,
            },
          ])}
          {renderExamSubHeader(
            mockPart === "sentence"
              ? `Question ${currentSentenceIndex + 1} of ${data.sentenceQuestions.length}`
              : mockPart === "email" || mockPart === "discussion"
                ? getWritingQuestionLabel(mockPart)
                : "",
            true
          )}
        </>
      )}

      {mockStage === "sentence" && currentQuestion && (

        <section style={{ ...cardStyle, padding: "34px 28px" }}>

          {(() => {

            const question = currentQuestion;

            const currentSlots =

              sentenceSlots[question.id] || makeEmptySlots(question);

            const currentBank = getAvailableBank(question);

            return (

              <>

                <div

                  style={{

                    fontSize: "21px",

                    lineHeight: "2.05",

                    fontWeight: 700,

                    margin: "64px auto 34px",
                    maxWidth: "1280px",
                    textAlign: "left",

                  }}

                >

                  <div style={{ marginBottom: "96px" }}>

                    {question.contextSpeaker}: {question.contextSentence}

                  </div>

                  <div

                    style={{

                      display: "flex",

                      flexWrap: "wrap",

                      gap: "10px",

                    }}

                  >

                    <span>{question.answerSpeaker}:</span>

                    {(() => {

                      let blankIndex = 0;

                      return question.parts.map((part, partIndex) => {

                        if (part.type === "fixed") {

                          return (

                            <span key={`fixed-${partIndex}`}>
                              {getDisplayedFixedText(question, partIndex, part.text)}
                            </span>

                          );

                        }

                        const slotIndex = blankIndex;

                        blankIndex += 1;

                        const slot = currentSlots[slotIndex];
                        const displayedText = getDisplayedChunkText(
                          question,
                          slotIndex,
                          slot
                        );

                        return (

                          <button

                            key={`blank-${partIndex}`}

                            type="button"

                            data-sentence-slot-index={slotIndex}

                            onClick={() => {
                              if (dragged) {
                                if (
                                  dragged.sourceSlotIndex === slotIndex &&
                                  dragged.chunk.id === slot?.id
                                ) {
                                  removeChunk(question, slotIndex);
                                } else {
                                  placeChunk(
                                    question,
                                    dragged.chunk,
                                    slotIndex,
                                    dragged.sourceSlotIndex
                                  );
                                }
                                setDragged(null);
                                return;
                              }

                              removeChunk(question, slotIndex);
                            }}

                            draggable={Boolean(slot)}

                            onDragStart={() => {

                              if (slot) {

                                setDragged({ chunk: slot, sourceSlotIndex: slotIndex });

                              }

                            }}

                            onDragEnd={() => setDragged(null)}

                            onTouchStart={(event) => {
                              if (slot) {
                                mockSentenceTouchDrag.startTouchDrag(event, {
                                  chunk: slot,
                                  sourceSlotIndex: slotIndex,
                                });
                              }
                            }}

                            onTouchMove={mockSentenceTouchDrag.moveTouchDrag}

                            onTouchEnd={mockSentenceTouchDrag.finishTouchDrag}

                            onTouchCancel={mockSentenceTouchDrag.cancelTouchDrag}

                            onDragOver={(event) => event.preventDefault()}

                            onDrop={() => {

                              if (dragged) {

                                placeChunk(
                                  question,
                                  dragged.chunk,
                                  slotIndex,
                                  dragged.sourceSlotIndex
                                );

                                setDragged(null);

                              }

                            }}

                            style={{

                              minWidth: displayedText ? "auto" : "112px",

                              width: displayedText ? "auto" : "112px",

                              minHeight: "34px",

                              padding: displayedText ? "0 8px 2px" : "0 0 2px",

                              border: "none",

                              borderBottom: `2px solid ${
                                mockSentenceTouchDrag.touchDropSlotIndex === slotIndex
                                  ? "#00857f"
                                  : "#111827"
                              }`,

                              borderRadius: 0,

                              background: "transparent",

                              color: "#111827",

                              fontSize: "20px",

                              fontWeight: 700,

                              cursor: "pointer",

                              textAlign: "center",

                              touchAction: "none",

                              userSelect: "none",

                              boxShadow:
                                mockSentenceTouchDrag.touchDropSlotIndex === slotIndex
                                  ? "0 7px 0 -4px rgba(0, 133, 127, 0.22)"
                                  : "none",

                            }}

                          >

                            {displayedText}

                          </button>

                        );

                      });

                    })()}

                  </div>

                </div>

                <div

                  style={{

                    margin: "40px auto 24px",
                    maxWidth: "1280px",

                  }}

                >

                  <div

                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "28px",
                      justifyContent: "center",
                    }}

                  >

                    {currentBank.map((chunk: Chunk) => (

                      <button

                        key={chunk.id}

                        type="button"

                        draggable

                        onDragStart={() => setDragged({ chunk })}

                        onDragEnd={() => setDragged(null)}

                        onTouchStart={(event) =>
                          mockSentenceTouchDrag.startTouchDrag(event, { chunk })
                        }

                        onTouchMove={mockSentenceTouchDrag.moveTouchDrag}

                        onTouchEnd={mockSentenceTouchDrag.finishTouchDrag}

                        onTouchCancel={mockSentenceTouchDrag.cancelTouchDrag}

                        style={{

                          padding: "4px 2px",

                          border: "none",

                          borderRadius: 0,

                          background: "transparent",

                          fontSize: "20px",

                          fontWeight: 600,

                          cursor: "grab",

                          touchAction: "none",

                          userSelect: "none",

                          color:
                            dragged?.chunk.id === chunk.id ? "#00857f" : "inherit",

                          transform:
                            dragged?.chunk.id === chunk.id ? "scale(1.04)" : "none",

                        }}

                      >

                          {normalizeChunkDisplayText(chunk.text)}

                        </button>

                    ))}

                    {currentBank.length === 0 && (

                      <span style={{ color: "#64748b" }}>本题词库已清空。</span>

                    )}

                  </div>

                </div>

                {mockSentenceTouchDrag.touchDragPreview && (
                  <SentenceTouchDragPreview
                    preview={mockSentenceTouchDrag.touchDragPreview}
                  />
                )}

                <div
                  /* Hide bottom sentence navigation buttons since navigation is handled in the header */
                  style={{ display: "none" }}
                >

                  <button

                    type="button"

                    onClick={() => {

                      if (currentSentenceIndex > 0) {

                        setCurrentSentenceIndex(currentSentenceIndex - 1);

                      }

                    }}

                    disabled={currentSentenceIndex === 0}

                    style={{

                      ...secondaryButtonStyle,

                      cursor:

                        currentSentenceIndex === 0 ? "not-allowed" : "pointer",

                      opacity: currentSentenceIndex === 0 ? 0.5 : 1,

                    }}

                  >

                    上一题

                  </button>

                  <button

                    type="button"

                    onClick={goToNextSentence}

                    style={secondaryButtonStyle}

                  >

                    {currentSentenceIndex < data.sentenceQuestions.length - 1

                      ? "下一题"

                      : "Next: Email Writing"}

                  </button>

                  <button

                    type="button"

                    onClick={() => resetCurrentQuestion(question)}

                    style={secondaryButtonStyle}

                  >

                    清空本题

                  </button>

                </div>

              </>

            );

          })()}

        </section>

      )}

      {mockStage === "email" && (
        <section style={{ ...cardStyle, padding: "24px 28px" }}>
          <div className="writing-exam-scroll">
          <div className="writing-exam-grid">
            <div
              onContextMenu={(event) => event.preventDefault()}
              onCopy={(event) => event.preventDefault()}
              onCut={(event) => event.preventDefault()}
              style={{
                minHeight: "calc(100vh - 150px)",
                padding: "24px 28px",
                border: "2px solid #e5e7eb",
                borderRadius: "18px",
                lineHeight: 1.65,
                overflow: "auto",
                fontSize: "16px",
                userSelect: "none",
                WebkitUserSelect: "none",
              }}
            >
              <p style={{ color: "#111827", lineHeight: 1.8, marginTop: 0 }}>
                {data.emailPrompt.scenario}
              </p>

              <div style={{ marginTop: "28px", lineHeight: 1.8 }}>
                <strong>{data.emailPrompt.task}</strong>

                <ul style={{ lineHeight: 1.8 }}>
                  {data.emailPrompt.requirements.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>

                <p style={{ color: "#475569", marginBottom: 0 }}>
                  {data.emailPrompt.suggestedLength}
                </p>
              </div>
            </div>

            <div
              style={{
                minHeight: "calc(100vh - 150px)",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  marginBottom: "20px",
                  lineHeight: 1.7,
                  fontSize: "17px",
                  fontWeight: 700,
                }}
              >
                <strong>Your Response:</strong>
                <div>To: {getEmailRecipient(data.emailPrompt)}</div>
                <div>Subject: {getEmailSubject(data.emailPrompt)}</div>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  marginBottom: "12px",
                  flexShrink: 0,
                }}
              >
                <button type="button" onClick={emailEditor.cutSelection} style={toolbarButtonStyle}>
                  Cut
                </button>
                <button type="button" onClick={emailEditor.pasteFromClipboard} style={toolbarButtonStyle}>
                  Paste
                </button>
                <button type="button" onClick={emailEditor.undo} style={toolbarButtonStyle}>
                  Undo
                </button>
                <button type="button" onClick={emailEditor.redo} style={toolbarButtonStyle}>
                  Redo
                </button>
              </div>

              <textarea
                ref={emailEditor.textareaRef}
                value={emailAnswer}
                onChange={emailEditor.handleChange}
                onPaste={emailEditor.handlePaste}
                onContextMenu={(event) => event.preventDefault()}
                placeholder="Write your email here..."
                style={{
                  width: "100%",
                  flex: 1,
                  minHeight: "320px",
                  padding: "18px",
                  borderRadius: "18px",
                  border: "2px solid #e5e7eb",
                  fontSize: "16px",
                  lineHeight: 1.6,
                  boxSizing: "border-box",
                  resize: "none",
                  overflow: "auto",
                }}
              />

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "12px",
                  marginTop: "12px",
                  flexShrink: 0,
                }}
              >
                <p
                  style={{
                    color: "#64748b",
                    fontWeight: 700,
                    margin: 0,
                  }}
                >
                  Word Count: {emailWordCount}
                </p>

              </div>
            </div>
          </div>
          </div>
        </section>
      )}

      {mockStage === "discussion" && (
        <section style={{ ...cardStyle, padding: "24px 28px" }}>
        <div className="writing-exam-scroll">
        <div className="writing-exam-grid">
          <div
            onContextMenu={(event) => event.preventDefault()}
            onCopy={(event) => event.preventDefault()}
            onCut={(event) => event.preventDefault()}
            style={{
              minHeight: "calc(100vh - 150px)",
              padding: "24px 28px",
              border: "2px solid #e5e7eb",
              borderRadius: "18px",
              lineHeight: 1.65,
              overflow: "auto",
              fontSize: "16px",
              userSelect: "none",
              WebkitUserSelect: "none",
            }}
          >
            <div
              style={{
                display: "grid",
                gap: "12px",
                lineHeight: 1.6,
              }}
            >
              {data.discussionPrompt.instruction && (
                <div
                  style={{
                    whiteSpace: "pre-line",
                    lineHeight: 1.8,
                  }}
                >
                  {data.discussionPrompt.instruction}
                </div>
              )}

              <div
                style={{
                  lineHeight: 1.8,
                  marginTop: "24px",
                }}
              >
                <strong>
                  {data.discussionPrompt.professorName || "Professor"}
                </strong>
                <p style={{ marginBottom: 0 }}>
                  {data.discussionPrompt.professor}
                </p>
              </div>

            </div>
          </div>

          {/* 右侧：上方学生观点 + 下方写作区 */}
          <div
            style={{
              minHeight: "calc(100vh - 150px)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              onContextMenu={(event) => event.preventDefault()}
              onCopy={(event) => event.preventDefault()}
              onCut={(event) => event.preventDefault()}
              style={{
                display: "grid",
                gap: "18px",
                marginBottom: "18px",
                lineHeight: 1.8,
                fontSize: "16px",
                userSelect: "none",
                WebkitUserSelect: "none",
              }}
            >
              <div>
                <strong>{data.discussionPrompt.studentOneName}</strong>
                <p style={{ marginBottom: 0 }}>
                  {data.discussionPrompt.studentOnePost}
                </p>
              </div>

              <div>
                <strong>{data.discussionPrompt.studentTwoName}</strong>
                <p style={{ marginBottom: 0 }}>
                  {data.discussionPrompt.studentTwoPost}
                </p>
              </div>
            </div>

            <div
              style={{
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                boxSizing: "border-box",
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  marginBottom: "12px",
                  flexShrink: 0,
                }}
              >
                <button type="button" onClick={discussionEditor.cutSelection} style={toolbarButtonStyle}>
                  Cut
                </button>
                <button type="button" onClick={discussionEditor.pasteFromClipboard} style={toolbarButtonStyle}>
                  Paste
                </button>
                <button type="button" onClick={discussionEditor.undo} style={toolbarButtonStyle}>
                  Undo
                </button>
                <button type="button" onClick={discussionEditor.redo} style={toolbarButtonStyle}>
                  Redo
                </button>
              </div>

              <textarea
                ref={discussionEditor.textareaRef}
                value={discussionAnswer}
                onChange={discussionEditor.handleChange}
                onPaste={discussionEditor.handlePaste}
                onContextMenu={(event) => event.preventDefault()}
                placeholder="Write your discussion response here..."
                style={{
                  width: "100%",
                  flex: 1,
                  minHeight: "320px",
                  padding: "18px",
                  borderRadius: "18px",
                  border: "2px solid #e5e7eb",
                  fontSize: "16px",
                  lineHeight: 1.6,
                  boxSizing: "border-box",
                  resize: "none",
                  overflow: "auto",
                }}
              />

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "12px",
                  marginTop: "12px",
                  flexShrink: 0,
                }}
              >
                <p
                  style={{
                    color: "#64748b",
                    fontWeight: 700,
                    margin: 0,
                  }}
                >
                  Word Count: {discussionWordCount}
                </p>

              </div>
            </div>
          </div>
        </div>
        </div>
      </section>
    )}
    </>
  );
}



function MockResultPage({
  result,
  isLoading,
  message,
  onBackHome,
  onViewRecords,
}: {
  result: MockResult | null;
  isLoading: boolean;
  message: string;
  onBackHome: () => void;
  onViewRecords: () => void;
}) {
  const cardStyle = {
    background: "white",
    border: "1px solid #e2e8f0",
    borderRadius: "18px",
    padding: "18px 22px",
    marginBottom: "14px",
    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.04)",
    boxSizing: "border-box" as const,
  };
  const [resultStep, setResultStep] = useState<
    "overall" | "sentence" | "email" | "discussion"
  >("overall");
  const [sentenceResultIndex, setSentenceResultIndex] = useState(0);
  const [showSentenceResultDetail, setShowSentenceResultDetail] = useState(false);
  const selectedResultTypes = (
    result?.selectedTypes?.length
      ? result.selectedTypes
      : (["sentence", "email", "discussion"] as PastExamPracticeType[])
  ).filter((type, index, list) => list.indexOf(type) === index);
  const orderedResultTypes = (["sentence", "email", "discussion"] as PastExamPracticeType[]).filter(
    (type) => selectedResultTypes.includes(type)
  );
  const orderedResultTypeKey = orderedResultTypes.join("|");
  const lastResultStep = orderedResultTypes[orderedResultTypes.length - 1];
  const hasOverallScore = orderedResultTypes.length === 3;

  function goNextResultStep() {
    if (resultStep === "overall") {
      setResultStep(orderedResultTypes[0] || "sentence");
      return;
    }

    const currentIndex = orderedResultTypes.indexOf(resultStep as PastExamPracticeType);
    const nextStep = orderedResultTypes[currentIndex + 1];

    if (nextStep) setResultStep(nextStep);
    else onBackHome();
  }

  useEffect(() => {
    setSentenceResultIndex(0);
    setShowSentenceResultDetail(false);
    setResultStep(hasOverallScore ? "sentence" : "overall");
  }, [result?.recordId, hasOverallScore, orderedResultTypeKey]);

  const resultSentenceSlots = useMemo(() => {
    if (!result) return {} as Record<number, (Chunk | null)[]>;

    return Object.fromEntries(
      result.sentenceQuestions.map((question) => {
        const answerTexts = result.sentenceAnswers?.[String(question.id)] || [];
        return [
          question.id,
          answerTexts.map((text, index) => ({
            id: `result-${question.id}-${index}`,
            text,
          })),
        ];
      })
    ) as Record<number, (Chunk | null)[]>;
  }, [result]);

  const resultSentenceScores = useMemo(() => {
    if (!result) return {} as Record<number, number>;

    return Object.fromEntries(
      result.sentenceQuestions.map((question) => [
        question.id,
        isQuestionCorrect(question, resultSentenceSlots[question.id] || []) ? 1 : 0,
      ])
    );
  }, [result, resultSentenceSlots]);

  const correctSentenceCount = Object.values(resultSentenceScores).filter(
    (score) => score > 0
  ).length;
  const finalScore = result ? Number(result.finalScore) : 0;
  const finalScorePercent = Math.max(0, Math.min(100, (finalScore / 6) * 100));
  const fullMockTabStyle = (type: PastExamPracticeType): CSSProperties => ({
    appearance: "none",
    width: "100%",
    minHeight: "150px",
    padding: "24px 22px",
    border: `2px solid ${resultStep === type ? "#148a83" : "#e1e7ef"}`,
    borderRadius: "18px",
    background: resultStep === type ? "#f0fbfa" : "white",
    color: "#171c2d",
    boxShadow:
      resultStep === type
        ? "0 12px 30px rgba(0, 117, 111, 0.12)"
        : "0 8px 22px rgba(15, 23, 42, 0.05)",
    textAlign: "center",
    cursor: "pointer",
    transition: "border-color 180ms ease, background 180ms ease, box-shadow 180ms ease, transform 180ms ease",
  });

  return (
    <>
      <div
        className="exam-green-bar mock-result-green-bar"
      >
        {result && !isLoading && resultStep === "sentence" && showSentenceResultDetail ? (
          <>
            <button
              type="button"
              onClick={() => setSentenceResultIndex((index) => Math.max(0, index - 1))}
              disabled={sentenceResultIndex === 0}
              className="exam-action-button exam-action-button--nav"
            >
              <span className="exam-action-chevron" aria-hidden="true">‹</span>
              Back
            </button>
            <button
              type="button"
              onClick={() => setShowSentenceResultDetail(false)}
              className="exam-action-button exam-action-button--nav"
            >
              Return
            </button>
            <button
              type="button"
              onClick={() =>
                setSentenceResultIndex((index) =>
                  Math.min(result.sentenceQuestions.length - 1, index + 1)
                )
              }
              disabled={sentenceResultIndex === result.sentenceQuestions.length - 1}
              className="exam-action-button exam-action-button--nav"
            >
              Next
              <span className="exam-action-chevron" aria-hidden="true">›</span>
            </button>
          </>
        ) : result && !isLoading && hasOverallScore ? (
          <>
            <button
              type="button"
              onClick={onBackHome}
              className="exam-action-button exam-action-button--nav"
            >
              Home
            </button>
            <button
              type="button"
              onClick={onViewRecords}
              className="exam-action-button exam-action-button--nav"
            >
              Records
              <span className="exam-action-chevron" aria-hidden="true">›</span>
            </button>
          </>
        ) : result && !isLoading ? (
          <>
            <button
              type="button"
              onClick={goNextResultStep}
              className="exam-action-button exam-action-button--nav"
            >
              {resultStep === lastResultStep ? "Home" : "Next"}
              <span className="exam-action-chevron" aria-hidden="true">›</span>
            </button>
            {resultStep === lastResultStep && (
              <button
                type="button"
                onClick={onViewRecords}
                className="exam-action-button exam-action-button--nav"
              >
                Records
                <span className="exam-action-chevron" aria-hidden="true">›</span>
              </button>
            )}
          </>
        ) : null}
        {!result && !isLoading && (
          <button
            type="button"
            onClick={onBackHome}
            className="exam-action-button exam-action-button--nav"
          >
            Home
            <span className="exam-action-chevron" aria-hidden="true">›</span>
          </button>
        )}
      </div>
      <PracticeStatusBar
        label={
          resultStep === "sentence" && showSentenceResultDetail && result
            ? `Question ${sentenceResultIndex + 1} of ${result.sentenceQuestions.length}`
            : isLoading
              ? "Grading"
              : hasOverallScore
                ? "Writing · Mock Test Results"
              : resultStep === "overall"
                ? "Score"
                : resultStep === "sentence"
                  ? "Build a Sentence Results"
                  : resultStep === "email"
                    ? "Email Writing Feedback"
                    : "Academic Discussion Feedback"
        }
      />

      <main
        style={{
          maxWidth: "1180px",
          margin: "0 auto",
          padding: "44px 28px 64px",
          boxSizing: "border-box",
        }}
      >
        <h1
          style={{
            fontSize: "40px",
            fontWeight: 500,
            margin: "0 0 20px",
            borderBottom: "2px solid #d6d6d6",
            paddingBottom: "18px",
          }}
        >
          {hasOverallScore ? "Your Mock Test Results" : "Writing Score and Feedback"}
        </h1>

        {isLoading && (
          <section
            style={{
              ...cardStyle,
              minHeight: "260px",
              display: "grid",
              placeItems: "center",
              textAlign: "center",
            }}
          >
            <div>
              <p
                style={{
                  fontSize: "34px",
                  fontWeight: 900,
                  color: "#006b67",
                  margin: "0 0 14px",
                }}
              >
                正在批改中
              </p>
              <p style={{ color: "#64748b", fontSize: "18px", margin: 0 }}>
                AI 正在生成成绩、反馈和提升建议，请稍等。
              </p>
            </div>
          </section>
        )}

        {!isLoading && message && !result && (
          <section style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>批改失败</h2>
            <p style={{ color: "#be123c", fontWeight: 700 }}>{message}</p>
          </section>
        )}

        {result && hasOverallScore && (
          <section
            style={{
              ...cardStyle,
              padding: "30px",
              background: "linear-gradient(180deg, #f3f8ff 0%, #ffffff 72%)",
            }}
          >
            <div style={{ textAlign: "center" }}>
              <h2 style={{ margin: "0 0 8px", fontSize: "30px" }}>✎ Writing</h2>
              <div
                style={{
                  position: "relative",
                  width: "min(100%, 330px)",
                  height: "178px",
                  margin: "0 auto 14px",
                }}
              >
                <svg
                  viewBox="0 0 240 130"
                  role="img"
                  aria-label={`Writing score ${finalScore.toFixed(1)} out of 6`}
                  style={{ width: "100%", height: "100%", overflow: "visible" }}
                >
                  <path
                    d="M 20 110 A 100 100 0 0 1 220 110"
                    pathLength="100"
                    fill="none"
                    stroke="#c9dcfb"
                    strokeWidth="18"
                    strokeLinecap="butt"
                  />
                  <path
                    d="M 20 110 A 100 100 0 0 1 220 110"
                    pathLength="100"
                    fill="none"
                    stroke="#2584df"
                    strokeWidth="18"
                    strokeLinecap="butt"
                    strokeDasharray={`${finalScorePercent} ${100 - finalScorePercent}`}
                  />
                </svg>
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    bottom: "20px",
                    transform: "translateX(-50%)",
                    color: "#2075d2",
                    whiteSpace: "nowrap",
                  }}
                >
                  <strong
                    style={{
                      display: "block",
                      fontSize: "34px",
                      lineHeight: 1,
                      marginBottom: "7px",
                    }}
                  >
                    {finalScore.toFixed(1)} of 6
                  </strong>
                  <span style={{ color: "#7c8799", fontWeight: 700 }}>分数</span>
                </div>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "16px",
                marginTop: "8px",
              }}
            >
              <button
                type="button"
                aria-pressed={resultStep === "sentence"}
                onClick={() => {
                  setResultStep("sentence");
                  setShowSentenceResultDetail(false);
                }}
                style={fullMockTabStyle("sentence")}
              >
                <span style={{ display: "block", fontSize: "20px", fontWeight: 900 }}>
                  Build a Sentence
                </span>
                <span style={{ display: "block", marginTop: "15px", fontSize: "30px", fontWeight: 900, color: "#087e77" }}>
                  {result.sentenceScore.toFixed(1)} / 10.0
                </span>
                <span style={{ display: "block", marginTop: "8px", color: "#68708a", fontWeight: 750 }}>
                  Correct {correctSentenceCount} · Wrong {Math.max(0, result.sentenceQuestions.length - correctSentenceCount)}
                </span>
              </button>

              <button
                type="button"
                aria-pressed={resultStep === "email"}
                onClick={() => setResultStep("email")}
                style={fullMockTabStyle("email")}
              >
                <span style={{ display: "block", fontSize: "20px", fontWeight: 900 }}>
                  Email Writing
                </span>
                <span style={{ display: "block", marginTop: "15px", fontSize: "30px", fontWeight: 900, color: "#087e77" }}>
                  {result.emailScore}
                </span>
                <span style={{ display: "block", marginTop: "8px", color: "#68708a", fontWeight: 750 }}>
                  View answer and feedback
                </span>
              </button>

              <button
                type="button"
                aria-pressed={resultStep === "discussion"}
                onClick={() => setResultStep("discussion")}
                style={fullMockTabStyle("discussion")}
              >
                <span style={{ display: "block", fontSize: "20px", fontWeight: 900 }}>
                  Academic Discussion
                </span>
                <span style={{ display: "block", marginTop: "15px", fontSize: "30px", fontWeight: 900, color: "#087e77" }}>
                  {result.discussionScore}
                </span>
                <span style={{ display: "block", marginTop: "8px", color: "#68708a", fontWeight: 750 }}>
                  View answer and feedback
                </span>
              </button>
            </div>
          </section>
        )}

        {result && !hasOverallScore && resultStep === "overall" && (
          <section style={{ ...cardStyle, background: "#f8fafc" }}>
            <h2 style={{ margin: "0 0 18px", fontSize: "30px" }}>Scores</h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: "14px",
              }}
            >
              {orderedResultTypes.includes("sentence") && (
                <div style={{ padding: "16px", borderRadius: "14px", background: "white", border: "1px solid #e2e8f0" }}>
                  <strong>Build a Sentence</strong>
                  <p style={{ fontSize: "24px", fontWeight: 900 }}>{result.sentenceScore.toFixed(1)} / 10.0</p>
                </div>
              )}
              {orderedResultTypes.includes("email") && (
                <div style={{ padding: "16px", borderRadius: "14px", background: "white", border: "1px solid #e2e8f0" }}>
                  <strong>Email Writing</strong>
                  <p style={{ fontSize: "24px", fontWeight: 900 }}>{result.emailScore}</p>
                </div>
              )}
              {orderedResultTypes.includes("discussion") && (
                <div style={{ padding: "16px", borderRadius: "14px", background: "white", border: "1px solid #e2e8f0" }}>
                  <strong>Academic Discussion</strong>
                  <p style={{ fontSize: "24px", fontWeight: 900 }}>{result.discussionScore}</p>
                </div>
              )}
            </div>
          </section>
        )}

        {result && resultStep === "sentence" && orderedResultTypes.includes("sentence") && (
          showSentenceResultDetail ? (
            <SentenceResultDetail
              question={result.sentenceQuestions[sentenceResultIndex]}
              questionIndex={sentenceResultIndex}
              slots={
                resultSentenceSlots[
                  result.sentenceQuestions[sentenceResultIndex]?.id
                ] || []
              }
              correct={
                (resultSentenceScores[
                  result.sentenceQuestions[sentenceResultIndex]?.id
                ] || 0) > 0
              }
            />
          ) : (
            <SentenceReviewTable
              questions={result.sentenceQuestions}
              slotsByQuestion={resultSentenceSlots}
              selectedIndex={sentenceResultIndex}
              resultScores={resultSentenceScores}
              title="Build a Sentence Results"
              description={`Score: ${result.sentenceScore.toFixed(1)} / 10.0. Select a sentence to view your answer and feedback.`}
              onSelect={(index) => {
                setSentenceResultIndex(index);
                setShowSentenceResultDetail(true);
              }}
            />
          )
        )}

        {result && resultStep === "email" && orderedResultTypes.includes("email") && (
            <section style={cardStyle}>
              <h2 style={{ marginTop: 0 }}>Email Writing Feedback</h2>

              {result.emailPrompt && (
                <div
                  style={{
                    padding: "20px",
                    borderRadius: "14px",
                    background: "#f7f9fc",
                    border: "1px solid #e2e8f0",
                    marginBottom: "18px",
                    lineHeight: 1.75,
                  }}
                >
                  <h3 style={{ margin: "0 0 12px" }}>Question</h3>
                  <p>{result.emailPrompt.scenario}</p>
                  <p style={{ fontWeight: 800 }}>{result.emailPrompt.task}</p>
                  {result.emailPrompt.requirements?.length > 0 && (
                    <ul style={{ marginBottom: 0 }}>
                      {result.emailPrompt.requirements.map((requirement, index) => (
                        <li key={`${requirement}-${index}`}>{requirement}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div
                style={{
                  padding: "20px",
                  borderRadius: "14px",
                  background: "white",
                  border: "1px solid #d7dde8",
                  marginBottom: "18px",
                }}
              >
                <h3 style={{ margin: "0 0 12px" }}>Your Answer</h3>
                <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.75 }}>
                  {result.emailAnswer || "No answer submitted."}
                </p>
              </div>

              <FeedbackBox
                score={result.emailFeedback.score}
                strengths={result.emailFeedback.strengths || []}
                problems={result.emailFeedback.problems || []}
                grammarCorrections={result.emailFeedback.grammarCorrections || []}
                actionPlan={result.emailFeedback.actionPlan || []}
                improvedVersion={result.emailFeedback.improvedVersion || ""}
              />
            </section>
        )}

        {result && resultStep === "discussion" && orderedResultTypes.includes("discussion") && (
            <section style={cardStyle}>
              <h2 style={{ marginTop: 0 }}>Academic Discussion Feedback</h2>

              {result.discussionPrompt && (
                <div
                  style={{
                    padding: "20px",
                    borderRadius: "14px",
                    background: "#f7f9fc",
                    border: "1px solid #e2e8f0",
                    marginBottom: "18px",
                    lineHeight: 1.75,
                  }}
                >
                  <h3 style={{ margin: "0 0 12px" }}>Question</h3>
                  <p>
                    <strong>{result.discussionPrompt.professorName || "Professor"}:</strong>{" "}
                    {result.discussionPrompt.professor}
                  </p>
                  <p>
                    <strong>{result.discussionPrompt.studentOneName}:</strong>{" "}
                    {result.discussionPrompt.studentOnePost}
                  </p>
                  <p style={{ marginBottom: 0 }}>
                    <strong>{result.discussionPrompt.studentTwoName}:</strong>{" "}
                    {result.discussionPrompt.studentTwoPost}
                  </p>
                </div>
              )}

              <div
                style={{
                  padding: "20px",
                  borderRadius: "14px",
                  background: "white",
                  border: "1px solid #d7dde8",
                  marginBottom: "18px",
                }}
              >
                <h3 style={{ margin: "0 0 12px" }}>Your Answer</h3>
                <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.75 }}>
                  {result.discussionAnswer || "No answer submitted."}
                </p>
              </div>

              <FeedbackBox
                score={result.discussionFeedback.score}
                strengths={result.discussionFeedback.strengths || []}
                problems={result.discussionFeedback.problems || []}
                grammarCorrections={result.discussionFeedback.grammarCorrections || []}
                actionPlan={result.discussionFeedback.actionPlan || []}
                improvedVersion={result.discussionFeedback.improvedVersion || ""}
              />
            </section>
        )}
      </main>
    </>
  );
}

function WritingAbilityAnalysisPage({
  user,
  practiceRecords,
  mockRecords,
  pastExamSets,
  isLoading,
  message,
  onBackHome,
  personalizedProfile,
  onPracticeTopic,
  embedded = false,
}: {
  user: User | null;
  practiceRecords: PracticeRecord[];
  mockRecords: MockRecord[];
  pastExamSets: QuestionSet[];
  isLoading: boolean;
  message: string;
  onBackHome: () => void;
  personalizedProfile?: PersonalizedProfile | null;
  onPracticeTopic?: (taskType: PersonalizedTaskType, topic: string) => void;
  embedded?: boolean;
}) {
  const ink = "#171c2d";
  const accent = "#3b347f";
  const muted = "#68708a";
  const line = "#d6d8e5";
  const paleLavender = "#f8f7ff";
  const softLavender = "#f0eeff";
  const containerStyle: CSSProperties = {
    background: "rgba(255, 255, 255, 0.97)",
    border: `1px solid ${line}`,
    borderRadius: "6px",
    padding: "22px 24px",
    marginBottom: "18px",
    boxShadow: "0 8px 24px rgba(52, 48, 125, 0.08)",
  };
  const analysisNavItems = [
    { label: "Forge AI", icon: "AI", active: false },
    { label: "Practice Tests", icon: "PT", active: false },
    { label: "Daily", icon: "D", active: false },
    { label: "Study Plan", icon: "SP", active: false },
    { label: "Help", icon: "?", active: false },
    { label: "Analysis", icon: "A", active: true },
  ];
  const analysisTabs = [
    { key: "overview", label: "能力总览" },
    { key: "email", label: "Email 分析" },
    { key: "discussion", label: "Discussion 分析" },
    { key: "topic", label: "Topic 掌握度" },
    { key: "history", label: "诊断历史" },
  ] as const;
  const [activeAnalysisTab, setActiveAnalysisTab] = useState<
    (typeof analysisTabs)[number]["key"]
  >("overview");

  function getAbilityScores(
    taskType: "email" | "discussion",
    feedback: WritingFeedback | null | undefined
  ) {
    const definitions = getWritingAbilityDefinitions(taskType);
    const storedScores = feedback?.abilityScores || feedback?.ability_scores;
    const hasCompleteStoredScores = definitions.every((definition) => {
      const score = Number(storedScores?.[definition.skillKey]);
      return Number.isFinite(score) && score >= 0 && score <= 5;
    });

    return storedScores && hasCompleteStoredScores ? storedScores : null;
  }

  const pastExamKeys = useMemo(() => {
    const sentence = new Set<string>();
    const email = new Set<string>();
    const discussion = new Set<string>();

    pastExamSets.forEach((questionSet) => {
      (questionSet.content.tasks || []).forEach((task) => {
        if (task.type === "sentence") {
          task.questions.forEach((question) =>
            sentence.add(getSentenceQuestionKey(question))
          );
        } else if (task.type === "email") {
          email.add(getPromptScoreKey("email", task.prompt));
        } else if (task.type === "discussion") {
          discussion.add(getPromptScoreKey("discussion", task.prompt));
        }
      });
    });

    return { sentence, email, discussion };
  }, [pastExamSets]);

  const pastExamSentenceEntries = useMemo(
    () =>
      mockRecords
        .filter((record) => {
          if (!hasRecordedSentenceSection(record)) return false;

          const questions = record.sentence_questions || [];
          return (
            questions.length > 0 &&
            questions.every((question) =>
              pastExamKeys.sentence.has(getSentenceQuestionKey(question))
            )
          );
        })
        .map((record) => ({
          createdAt: record.created_at,
          score: Math.max(
            0,
            Math.min(5, (Number(record.sentence_score) / 10) * 5)
          ),
        }))
        .filter((entry) => Number.isFinite(entry.score)),
    [mockRecords, pastExamKeys]
  );

  const emailAbilityEntries = useMemo<WritingAbilityEntry[]>(() => {
    const singleEntries = practiceRecords.reduce<WritingAbilityEntry[]>(
      (entries, record) => {
        if (record.practice_type !== "email") return entries;
        const abilityScores = getAbilityScores("email", record.feedback);
        if (abilityScores) {
          entries.push({
            taskType: "email",
            createdAt: record.created_at,
            abilityScores,
          });
        }
        return entries;
      },
      []
    );

    const mockEntries = mockRecords.reduce<WritingAbilityEntry[]>(
      (entries, record) => {
        const abilityScores = getAbilityScores("email", record.email_feedback);
        if (abilityScores) {
          entries.push({
            taskType: "email",
            createdAt: record.created_at,
            abilityScores,
          });
        }
        return entries;
      },
      []
    );

    return [...singleEntries, ...mockEntries];
  }, [practiceRecords, mockRecords]);

  const discussionAbilityEntries = useMemo<WritingAbilityEntry[]>(() => {
    const singleEntries = practiceRecords.reduce<WritingAbilityEntry[]>(
      (entries, record) => {
        if (record.practice_type !== "discussion") return entries;
        const abilityScores = getAbilityScores("discussion", record.feedback);
        if (abilityScores) {
          entries.push({
            taskType: "discussion",
            createdAt: record.created_at,
            abilityScores,
          });
        }
        return entries;
      },
      []
    );

    const mockEntries = mockRecords.reduce<WritingAbilityEntry[]>(
      (entries, record) => {
        const abilityScores = getAbilityScores(
          "discussion",
          record.discussion_feedback
        );
        if (abilityScores) {
          entries.push({
            taskType: "discussion",
            createdAt: record.created_at,
            abilityScores,
          });
        }
        return entries;
      },
      []
    );

    return [...singleEntries, ...mockEntries];
  }, [practiceRecords, mockRecords]);

  const emailScoreEntries = useMemo(
    () =>
      [
        ...practiceRecords
          .filter((record) => record.practice_type === "email")
          .map((record) => ({
            createdAt: record.created_at,
            score: parsePracticeScore(record.score),
          })),
        ...mockRecords.map((record) => ({
          createdAt: record.created_at,
          score: parsePracticeScore(record.email_score),
        })),
      ].filter(
        (entry): entry is { createdAt: string; score: number } =>
          entry.score !== null
      ),
    [practiceRecords, mockRecords]
  );

  const discussionScoreEntries = useMemo(
    () =>
      [
        ...practiceRecords
          .filter((record) => record.practice_type === "discussion")
          .map((record) => ({
            createdAt: record.created_at,
            score: parsePracticeScore(record.score),
          })),
        ...mockRecords.map((record) => ({
          createdAt: record.created_at,
          score: parsePracticeScore(record.discussion_score),
        })),
      ].filter(
        (entry): entry is { createdAt: string; score: number } =>
          entry.score !== null
      ),
    [practiceRecords, mockRecords]
  );

  const emailProfile = useMemo(
    () => calculateStableAbilityProfile("email", emailAbilityEntries),
    [emailAbilityEntries]
  );
  const discussionProfile = useMemo(
    () => calculateStableAbilityProfile("discussion", discussionAbilityEntries),
    [discussionAbilityEntries]
  );
  const sentenceAbilityScore =
    pastExamSentenceEntries.length >= MIN_WRITING_ABILITY_SAMPLES
      ? pastExamSentenceEntries
          .slice()
          .sort(
            (left, right) =>
              Date.parse(right.createdAt) - Date.parse(left.createdAt)
          )
          .slice(0, 10)
          .reduce((sum, entry) => sum + entry.score, 0) /
        Math.min(10, pastExamSentenceEntries.length)
      : null;
  function getStableTaskScore(
    entries: { createdAt: string; score: number }[]
  ) {
    if (entries.length < MIN_WRITING_ABILITY_SAMPLES) return null;
    const recentEntries = entries
      .slice()
      .sort(
        (left, right) =>
          Date.parse(right.createdAt) - Date.parse(left.createdAt)
      )
      .slice(0, 10);
    return (
      recentEntries.reduce((sum, entry) => sum + entry.score, 0) /
      recentEntries.length
    );
  }
  const emailOverallScore = getStableTaskScore(emailScoreEntries);
  const discussionOverallScore = getStableTaskScore(discussionScoreEntries);
  const activeAbilityScores = [
    sentenceAbilityScore,
    emailOverallScore,
    discussionOverallScore,
  ].filter((score): score is number => score !== null);
  const overallWritingAbility =
    activeAbilityScores.length > 0
      ? activeAbilityScores.reduce((sum, score) => sum + score, 0) /
        activeAbilityScores.length
      : null;

  const activeMetrics = [
    ...(emailProfile.status === "ACTIVE" ? emailProfile.metrics : []),
    ...(discussionProfile.status === "ACTIVE" ? discussionProfile.metrics : []),
  ];
  const latestAbilityDate = [
    ...pastExamSentenceEntries,
    ...emailScoreEntries,
    ...discussionScoreEntries,
  ]
    .map((entry) => Date.parse(entry.createdAt))
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0];
  const trendData = [
    ...pastExamSentenceEntries.map((entry) => ({
      createdAt: entry.createdAt,
      score: entry.score,
      task: "Build a Sentence · Official Questions",
    })),
    ...emailScoreEntries.map((entry) => ({
      createdAt: entry.createdAt,
      score: entry.score,
      task: "Email",
    })),
    ...discussionScoreEntries.map((entry) => ({
      createdAt: entry.createdAt,
      score: entry.score,
      task: "Discussion",
    })),
  ]
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .slice(-10)
    .map((entry, index, entries) => {
      return {
        label:
          index === entries.length - 1
            ? "最新"
            : `${entries.length - index - 1}次前`,
        score: Number(entry.score.toFixed(1)),
        task: entry.task,
        createdAt: entry.createdAt,
      };
    });

  const radarData = activeMetrics.slice(0, 5).map((metric, index) => ({
    ability: metric.labelZh,
    Email:
      emailProfile.status === "ACTIVE"
        ? emailProfile.metrics[index % emailProfile.metrics.length]?.displayScore || 0
        : 0,
    Discussion:
      discussionProfile.status === "ACTIVE"
        ? discussionProfile.metrics[index % discussionProfile.metrics.length]?.displayScore || 0
        : 0,
  }));
  const pastExamTopicMasteryItems = personalizedProfile
    ? (["discussion", "email"] as PersonalizedTaskType[]).flatMap((taskType) =>
        personalizedProfile.taskProfiles[taskType].topics.map((topic) => ({
          ...topic,
          taskType,
          scope: taskType === "email" ? "Email" : "Discussion",
          progress:
            topic.score === null ? 0 : Math.round((topic.score / 5) * 100),
          canPractice:
            topic.score !== null && topic.count >= 2 && topic.score < 3.8,
        }))
      )
    : [];

  function getAbilityLevel(score: number) {
    if (score >= 4.2) return { label: "强项", color: "#16a34a", background: "#eaf8f0" };
    if (score >= 3.5) return { label: "中等", color: "#d97706", background: "#fff4df" };
    return { label: "待提升", color: "#ef4444", background: "#fff0f0" };
  }

  function renderAbilityMeter(metric: WritingAbilityMetric) {
    const level = getAbilityLevel(metric.displayScore);
    return (
      <div
        key={metric.skillKey}
        style={{
          display: "grid",
          gap: "12px",
          minHeight: "148px",
          borderRight: `1px solid ${line}`,
          padding: "18px 18px 16px",
          color: ink,
        }}
      >
        <div>
          <div style={{ color: ink, fontSize: "14px", fontWeight: 900 }}>{metric.labelZh}</div>
          <div style={{ color: muted, fontSize: "11px", fontWeight: 750, marginTop: "2px" }}>
            {metric.labelEn}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
          <strong style={{ color: ink, fontSize: "27px", lineHeight: 1 }}>
            {metric.displayScore.toFixed(1)}
          </strong>
          <span style={{ color: muted, fontSize: "13px", fontWeight: 800 }}>/5.0</span>
        </div>
        <span
          style={{
            justifySelf: "start",
            borderRadius: "999px",
            background: level.background,
            color: level.color,
            padding: "4px 12px",
            fontSize: "12px",
            fontWeight: 900,
          }}
        >
          {level.label}
        </span>
        <div
          style={{
            height: "6px",
            borderRadius: "999px",
            background: "#eef1f8",
            overflow: "hidden",
          }}
        >
          <span
            style={{
              display: "block",
              width: `${(metric.displayScore / 5) * 100}%`,
              height: "100%",
              borderRadius: "999px",
              background:
                metric.displayScore >= 4.2
                  ? "#31c36b"
                  : metric.displayScore >= 3.5
                    ? "#ff9d2e"
                    : "#ff5a64",
            }}
          />
        </div>
      </div>
    );
  }

  function renderProfile(
    profile: WritingAbilityProfile,
    title: string,
    totalScoreSamples: number
  ) {
    if (profile.status !== "ACTIVE") {
      return (
        <section style={{ ...containerStyle, padding: "20px" }}>
          <h2 style={{ margin: "0 0 12px", fontSize: "18px", color: ink }}>{title} 五维能力</h2>
          <p style={{ color: muted, lineHeight: 1.6, margin: 0, fontSize: "14px", fontWeight: 750 }}>
            已有 {totalScoreSamples} 次计分记录，其中 {profile.sampleCount} 次包含真实五维评分；达到 {profile.requiredSamples} 次五维评分后生成能力画像。
          </p>
        </section>
      );
    }

    return (
      <section style={{ ...containerStyle, padding: 0, overflow: "hidden" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "14px",
            padding: "18px 20px",
            borderBottom: `1px solid ${line}`,
          }}
        >
          <h2 style={{ margin: 0, fontSize: "18px", color: ink }}>{title} 五维能力</h2>
          <span style={{ color: muted, fontSize: "12px", fontWeight: 800 }}>
            基于 {profile.sampleCount} 次有效批改
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(130px, 1fr))" }}>
          {profile.metrics.map(renderAbilityMeter)}
        </div>
        {profile.suggestions.length > 0 && (
          <div
            style={{
              borderTop: `1px solid ${line}`,
              padding: "16px 20px",
              background: paleLavender,
            }}
          >
            <h3 style={{ margin: "0 0 10px", fontSize: "15px", color: accent }}>针对性建议</h3>
            {profile.suggestions.map((item, index) => (
              <p
                key={item.skillKey}
                style={{ color: muted, lineHeight: 1.6, margin: "0 0 10px", fontSize: "14px", fontWeight: 700 }}
              >
                <strong style={{ color: ink }}>
                  {index === 0 ? "优先提升" : "其次提升"}：{item.labelZh}
                </strong>
                <br />
                {item.suggestion}
              </p>
            ))}
          </div>
        )}
      </section>
    );
  }

  function renderSentenceProfile() {
    if (sentenceAbilityScore === null) {
      return (
        <section style={{ ...containerStyle, padding: "20px" }}>
          <h2 style={{ margin: "0 0 12px", fontSize: "18px", color: ink }}>
            Build a Sentence · Official Questions 能力
          </h2>
          <p
            style={{
              color: muted,
              lineHeight: 1.6,
              margin: 0,
              fontSize: "14px",
              fontWeight: 750,
            }}
          >
            已完成 {pastExamSentenceEntries.length} / {MIN_WRITING_ABILITY_SAMPLES} 次有效 Official Questions 练习；达到 5 次后生成稳定能力值。
          </p>
        </section>
      );
    }

    const accuracy = Math.round((sentenceAbilityScore / 5) * 100);
    return (
      <section style={{ ...containerStyle, padding: "20px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "14px",
            marginBottom: "16px",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "18px", color: ink }}>
            Build a Sentence · Official Questions 能力
          </h2>
          <span style={{ color: muted, fontSize: "12px", fontWeight: 800 }}>
            基于最近 {Math.min(10, pastExamSentenceEntries.length)} 次 Official Questions 记录
          </span>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(140px, 1fr))",
            gap: "12px",
          }}
        >
          {[
            { label: "稳定能力", value: `${sentenceAbilityScore.toFixed(1)} / 5.0` },
            { label: "平均正确率", value: `${accuracy}%` },
            { label: "有效 Official Questions 记录", value: `${pastExamSentenceEntries.length} 次` },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                border: `1px solid ${line}`,
                borderRadius: "6px",
                background: paleLavender,
                padding: "16px",
              }}
            >
              <span
                style={{
                  display: "block",
                  color: muted,
                  fontSize: "12px",
                  fontWeight: 800,
                  marginBottom: "8px",
                }}
              >
                {item.label}
              </span>
              <strong style={{ color: ink, fontSize: "22px" }}>{item.value}</strong>
            </div>
          ))}
        </div>
      </section>
    );
  }

  function renderScoreRing() {
    if (overallWritingAbility === null) {
      return (
        <div
          style={{
            width: "136px",
            height: "136px",
            borderRadius: "50%",
            border: "14px solid #eceaf8",
            display: "grid",
            placeItems: "center",
            margin: "20px auto 14px",
            color: muted,
            fontWeight: 900,
            textAlign: "center",
            fontSize: "13px",
          }}
        >
          样本不足
        </div>
      );
    }

    return (
      <div
        style={{
          width: "136px",
          height: "136px",
          borderRadius: "50%",
          background: `conic-gradient(#5868ff ${overallWritingAbility * 20}%, #eceaf8 0)`,
          display: "grid",
          placeItems: "center",
          margin: "20px auto 14px",
        }}
      >
        <div
          style={{
            width: "104px",
            height: "104px",
            borderRadius: "50%",
            background: "white",
            display: "grid",
            placeItems: "center",
            boxShadow: "inset 0 0 0 1px #f0f1f7",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <strong style={{ display: "block", color: ink, fontSize: "34px", lineHeight: 1 }}>
              {overallWritingAbility.toFixed(1)}
            </strong>
            <span style={{ color: muted, fontSize: "12px", fontWeight: 850 }}>/5.0</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        background: embedded ? "transparent" : "#f8f9ff",
        color: ink,
        display: "block",
        minHeight: embedded ? undefined : "100vh",
      }}
    >
      <aside
        style={{
          display: embedded ? "none" : "grid",
          position: "fixed",
          left: 0,
          top: 0,
          bottom: 0,
          width: "190px",
          boxSizing: "border-box",
          background: "rgba(255, 255, 255, 0.94)",
          borderRight: `1px solid ${line}`,
          padding: "22px 16px",
          alignContent: "start",
          gap: "6px",
          boxShadow: "10px 0 24px rgba(48, 45, 118, 0.04)",
          zIndex: 20,
        }}
      >
        <div style={{ marginBottom: "18px" }}>
          <img
            src="/forge-logo-trimmed.png"
            alt="FORGE"
            style={{ width: "134px", height: "auto", display: "block" }}
          />
        </div>
        {analysisNavItems.map((item) => (
          <div
            key={item.label}
            style={{
              borderRadius: "6px",
              background: item.active ? softLavender : "transparent",
              color: item.active ? "#5365ff" : muted,
              padding: "10px 10px",
              fontSize: "13px",
              fontWeight: 850,
              display: "grid",
              gridTemplateColumns: "30px minmax(0, 1fr)",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span
              style={{
                display: "grid",
                placeItems: "center",
                width: "26px",
                height: "26px",
                borderRadius: "6px",
                background: item.active ? "white" : "#f5f6ff",
                color: item.active ? "#5365ff" : "#7b8198",
                fontSize: "10px",
                fontWeight: 950,
              }}
            >
              {item.icon}
            </span>
            <span>{item.label}</span>
          </div>
        ))}
      </aside>
      <main
        style={{
          padding: embedded ? 0 : "24px 48px 44px",
          minWidth: 0,
          marginLeft: embedded ? 0 : "190px",
        }}
      >
      {!embedded && (
        <button
          type="button"
          onClick={onBackHome}
          style={{
            padding: "10px 16px",
            border: `1px solid ${line}`,
            borderRadius: "6px",
            background: "white",
            color: accent,
            fontWeight: 700,
            cursor: "pointer",
            marginBottom: "18px",
            boxShadow: "0 4px 12px rgba(52, 48, 125, 0.08)",
          }}
        >
          返回
        </button>
      )}

      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "18px",
          marginBottom: "18px",
        }}
      >
        <div>
          <div style={{ display: "flex", gap: "26px", flexWrap: "wrap" }}>
            {analysisTabs.map((tab) => {
              const isActive = activeAnalysisTab === tab.key;
              return (
                <button
                  type="button"
                  key={tab.key}
                  onClick={() => setActiveAnalysisTab(tab.key)}
                  style={{
                    border: 0,
                    borderBottom: isActive
                      ? "2px solid #5365ff"
                      : "2px solid transparent",
                    background: "transparent",
                    color: isActive ? "#5365ff" : ink,
                    padding: "0 0 8px",
                    fontSize: "13px",
                    fontWeight: 850,
                    cursor: "pointer",
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span style={{ color: muted, fontSize: "12px", fontWeight: 850 }}>
            更新于{" "}
            {latestAbilityDate
              ? new Date(latestAbilityDate).toISOString().slice(0, 10)
              : "暂无数据"}
          </span>
        </div>
      </header>

      <div style={{ marginBottom: "16px" }}>
        {!user && <p style={{ color: "#be123c" }}>请先登录后再查看分析。</p>}
        {user && isLoading && <p style={{ color: muted }}>正在加载练习记录...</p>}
        {user && !isLoading && message && (
          <p style={{ color: "#be123c" }}>{message}</p>
        )}
      </div>

      {user && !isLoading && !message && (
        <>
          {activeAnalysisTab === "overview" && (
            <>
              <section
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(210px, 0.9fr) minmax(260px, 1.25fr) minmax(260px, 1.25fr)",
                  gap: "12px",
                  marginBottom: "16px",
                }}
              >
            <div style={{ ...containerStyle, marginBottom: 0, minHeight: "250px" }}>
              <h2 style={{ margin: 0, color: ink, fontSize: "17px" }}>整体写作水平</h2>
              {renderScoreRing()}
              <p style={{ margin: 0, textAlign: "center", color: muted, fontSize: "13px", fontWeight: 800 }}>
                当前稳定水平 Stable Ability
              </p>
            </div>
            <div style={{ ...containerStyle, marginBottom: 0, minHeight: "250px" }}>
              <h2 style={{ margin: 0, color: ink, fontSize: "17px" }}>五维能力雷达图</h2>
              <div style={{ height: "220px" }}>
                {radarData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radarData}>
                      <PolarGrid stroke="#e4e7f4" />
                      <PolarAngleAxis dataKey="ability" tick={{ fill: muted, fontSize: 11 }} />
                      <PolarRadiusAxis angle={90} domain={[0, 5]} tick={false} axisLine={false} />
                      <Radar name="Email" dataKey="Email" stroke="#55a7ff" fill="#55a7ff" fillOpacity={0.18} />
                      <Radar name="Discussion" dataKey="Discussion" stroke="#7c5cff" fill="#7c5cff" fillOpacity={0.18} />
                    </RadarChart>
                  </ResponsiveContainer>
                ) : (
                  <p style={{ color: muted, fontWeight: 750 }}>完成更多有效 AI 批改后显示雷达图。</p>
                )}
              </div>
            </div>
            <div style={{ ...containerStyle, marginBottom: 0, minHeight: "250px" }}>
              <h2 style={{ margin: 0, color: ink, fontSize: "17px" }}>能力趋势（最近 10 次）</h2>
              <div style={{ height: "220px" }}>
                {trendData.length > 1 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData} margin={{ top: 24, right: 12, bottom: 8, left: -20 }}>
                      <CartesianGrid stroke="#edf0f7" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: muted, fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis domain={[1, 5]} tick={{ fill: muted, fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip />
                      <Line type="monotone" dataKey="score" stroke="#5365ff" strokeWidth={3} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p style={{ color: muted, fontWeight: 750 }}>完成更多有效 AI 批改后显示趋势。</p>
                )}
              </div>
            </div>
              </section>
              {renderSentenceProfile()}
            </>
          )}
          {activeAnalysisTab === "email" &&
            renderProfile(emailProfile, "Email Writing", emailScoreEntries.length)}
          {activeAnalysisTab === "discussion" &&
            renderProfile(
              discussionProfile,
              "Academic Discussion",
              discussionScoreEntries.length
            )}
          {activeAnalysisTab === "topic" && (
            <section
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "12px",
              }}
            >
            <div style={{ ...containerStyle, marginBottom: 0 }}>
              <h2 style={{ margin: "0 0 14px", fontSize: "18px", color: ink }}>Topic 掌握度</h2>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 14px" }}>
                {pastExamTopicMasteryItems.map((topic) => (
                  <div
                    key={`${topic.scope}-${topic.label}`}
                    style={{
                      border: `1px solid ${line}`,
                      borderRadius: "6px",
                      padding: "10px 12px",
                      background: "white",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "8px",
                        alignItems: "center",
                        marginBottom: "8px",
                      }}
                    >
                      <span style={{ color: ink, fontSize: "13px", fontWeight: 900 }}>
                        {topic.topic}
                      </span>
                      <span style={{ color: muted, fontSize: "11px", fontWeight: 800 }}>
                        {topic.score !== null ? `${topic.score.toFixed(1)}/5.0` : "待积累"}
                      </span>
                    </div>
                    <span
                      style={{
                        display: "block",
                        height: "6px",
                        borderRadius: "999px",
                        background: "#eef1f8",
                        overflow: "hidden",
                      }}
                    >
                      <span
                        style={{
                          display: "block",
                          width: `${topic.progress}%`,
                          height: "100%",
                          background:
                            topic.score === null
                              ? "#cbd5e1"
                              : topic.score >= 3
                                ? "#31c36b"
                                : topic.score >= 2
                                  ? "#eab308"
                                  : "#ef4444",
                        }}
                      />
                    </span>
                    {topic.canPractice && onPracticeTopic && (
                      <button
                        type="button"
                        onClick={() => onPracticeTopic(topic.taskType, topic.topic)}
                        style={{
                          border: 0,
                          background: "transparent",
                          color: accent,
                          padding: "9px 0 0",
                          fontSize: "12px",
                          fontWeight: 900,
                          cursor: "pointer",
                        }}
                      >
                        Practice this topic →
                      </button>
                    )}
                  </div>
                ))}
                {pastExamTopicMasteryItems.length === 0 && (
                  <p style={{ gridColumn: "1 / -1", margin: 0, color: muted, fontWeight: 750 }}>
                    完成更多有效 AI 批改后显示真实 Topic 掌握度。
                  </p>
                )}
              </div>
            </div>
            <div style={{ ...containerStyle, marginBottom: 0, background: "linear-gradient(180deg, white, #f5f4ff)" }}>
              <h2 style={{ margin: "0 0 14px", fontSize: "18px", color: ink }}>当前提升建议</h2>
              {[...emailProfile.suggestions, ...discussionProfile.suggestions].slice(0, 2).map((item, index) => (
                <div
                  key={item.skillKey}
                  style={{
                    border: `1px solid ${line}`,
                    borderRadius: "6px",
                    background: "white",
                    padding: "12px 14px",
                    marginBottom: "10px",
                  }}
                >
                  <strong style={{ color: ink, fontSize: "14px" }}>
                    {index === 0 ? "优先提升" : "其次提升"}：{item.labelZh}
                  </strong>
                  <p style={{ margin: "6px 0 0", color: muted, lineHeight: 1.55, fontSize: "13px", fontWeight: 750 }}>
                    {item.suggestion}
                  </p>
                </div>
              ))}
              {[...emailProfile.suggestions, ...discussionProfile.suggestions].length === 0 && (
                <p style={{ margin: 0, color: muted, fontSize: "14px", fontWeight: 750 }}>
                  完成更多有效 AI 批改后生成针对性建议。
                </p>
              )}
            </div>
            </section>
          )}
          {activeAnalysisTab === "history" && (
            <section style={containerStyle}>
              <h2 style={{ margin: "0 0 16px", fontSize: "18px", color: ink }}>
                诊断历史
              </h2>
              {trendData.length > 0 ? (
                <div style={{ display: "grid", gap: "8px" }}>
                  {trendData
                    .slice()
                    .reverse()
                    .map((entry, index) => (
                      <div
                        key={`${entry.createdAt}-${entry.task}-${index}`}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(150px, 1fr) minmax(140px, 1fr) 90px",
                          gap: "16px",
                          alignItems: "center",
                          border: `1px solid ${line}`,
                          borderRadius: "6px",
                          background: index === 0 ? paleLavender : "white",
                          padding: "13px 16px",
                        }}
                      >
                        <span style={{ color: muted, fontSize: "13px", fontWeight: 800 }}>
                          {new Date(entry.createdAt).toLocaleString("zh-CN")}
                        </span>
                        <strong style={{ color: ink, fontSize: "14px" }}>
                          {entry.task}
                        </strong>
                        <strong style={{ color: accent, textAlign: "right" }}>
                          {entry.score.toFixed(1)} / 5.0
                        </strong>
                      </div>
                    ))}
                </div>
              ) : (
                <p style={{ margin: 0, color: muted, fontWeight: 750 }}>
                  暂无可用于诊断的练习记录。
                </p>
              )}
            </section>
          )}
        </>
      )}
      </main>
    </div>
  );
}

// 能力分析页面：汇总用户的完整模考记录，展示平均分、薄弱项和建议
function AnalyticsPage({
  user,
  records,
  isLoading,
  message,
  onBackHome,
}: {
  user: User | null;
  records: MockRecord[];
  isLoading: boolean;
  message: string;
  onBackHome: () => void;
}) {
  // 统计练习数据和薄弱项
  const summary = useMemo(() => {
    if (!records || records.length === 0) return null;
    const total = records.length;
    let sumFinal = 0;
    let sumSentence = 0;
    let sumEmail = 0;
    let sumDiscussion = 0;
    records.forEach((rec) => {
      const finalScore = typeof rec.final_score === "number" ? rec.final_score : Number(rec.final_score);
      const sentenceScore = typeof rec.sentence_score === "number" ? rec.sentence_score : Number(rec.sentence_score);
      const emailScore = parseFloat(String(rec.email_score)) || 0;
      const discussionScore = parseFloat(String(rec.discussion_score)) || 0;
      sumFinal += isNaN(finalScore) ? 0 : finalScore;
      sumSentence += isNaN(sentenceScore) ? 0 : sentenceScore;
      sumEmail += isNaN(emailScore) ? 0 : emailScore;
      sumDiscussion += isNaN(discussionScore) ? 0 : discussionScore;
    });
    const avgFinal = sumFinal / total;
    const avgSentence = sumSentence / total;
    const avgEmail = sumEmail / total;
    const avgDiscussion = sumDiscussion / total;
    // 计算相对比值用于判定薄弱项（将各项分数统一到 0-1 区间）
    const ratioSentence = avgSentence / 5;
    const ratioEmail = avgEmail / 5;
    const ratioDiscussion = avgDiscussion / 5;
    let weakest: "sentence" | "email" | "discussion" = "sentence";
    let minRatio = ratioSentence;
    if (ratioEmail < minRatio) {
      weakest = "email";
      minRatio = ratioEmail;
    }
    if (ratioDiscussion < minRatio) {
      weakest = "discussion";
      minRatio = ratioDiscussion;
    }
    const suggestions: string[] = [];
    if (weakest === "sentence") {
      suggestions.push("造句题正确率相对较低，建议多加练习词块顺序、语法搭配以及固定表达的运用。");
    }
    if (weakest === "email") {
      suggestions.push("邮件写作分数相对较低，建议注意邮件结构、礼貌表达和具体细节描述，多参考范文提升写作质量。");
    }
    if (weakest === "discussion") {
      suggestions.push("学术讨论分数相对较低，建议在回应中充分阐述理由，并加入具体例子支撑观点，同时与他人观点互动。");
    }
    return {
      total,
      avgFinal,
      avgSentence,
      avgEmail,
      avgDiscussion,
      weakest,
      suggestions,
    };
  }, [records]);

  // 构建成绩趋势数据：按时间顺序收集每次完整模考的各项得分
  const trendData = useMemo(() => {
    if (!records || records.length === 0) return [] as {
      name: string;
      sentence: number;
      email: number;
      discussion: number;
      final: number;
    }[];
    return records
      .map((rec, idx) => {
        const finalScore =
          typeof rec.final_score === "number"
            ? rec.final_score
            : Number(rec.final_score);
        const sentenceScore =
          typeof rec.sentence_score === "number"
            ? rec.sentence_score
            : Number(rec.sentence_score);
        const emailScore = parseFloat(String(rec.email_score)) || 0;
        const discussionScore = parseFloat(String(rec.discussion_score)) || 0;
        return {
          // 使用顺序编号作为横轴标识，从最早到最新
          name: String(records.length - idx),
          sentence: isNaN(sentenceScore) ? 0 : sentenceScore,
          email: isNaN(emailScore) ? 0 : emailScore,
          discussion: isNaN(discussionScore) ? 0 : discussionScore,
          final: isNaN(finalScore) ? 0 : finalScore,
        };
      })
      .reverse();
  }, [records]);

  // 样式定义
  const containerStyle = {
    background: "white",
    border: "1px solid #e2e8f0",
    borderRadius: "24px",
    padding: "32px",
    marginBottom: "24px",
    boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
  } as const;

  const barContainerStyle = {
    width: "100%",
    background: "#e2e8f0",
    borderRadius: "12px",
    height: "12px",
    marginTop: "6px",
  } as const;

  const barStyle = (ratio: number) => ({
    width: `${Math.max(0, Math.min(1, ratio)) * 100}%`,
    height: "12px",
    background: "#6366f1",
    borderRadius: "12px",
  });

  // Prepare radar chart data based on knowledge point categories and user records.
  // Each practice type has its own set of categories defined at the module level.
  const sentenceCategories = useMemo(() => [...SENTENCE_KNOWLEDGE_CATEGORIES], []);
  const emailCategories = useMemo(() => [...EMAIL_KNOWLEDGE_CATEGORIES], []);
  const discussionCategories = useMemo(() => [...DISCUSSION_KNOWLEDGE_CATEGORIES], []);

  // Compute aggregated knowledge mastery for the sentence practice.  Each record's
  // sentence score is distributed across the categories with a simple weighting
  // scheme: earlier categories receive slightly higher weight.  The resulting
  // values are averaged over all records and capped at the maximum score (5).
  const radarDataSentence = useMemo(() => {
    if (!records || records.length === 0) {
      return sentenceCategories.map((cat) => ({
        subject: cat,
        score: 0,
        fullMark: 5,
      }));
    }
    const sums: number[] = new Array(sentenceCategories.length).fill(0);
    records.forEach((rec) => {
      const baseScore =
        typeof rec.sentence_score === "number"
          ? rec.sentence_score
          : Number(rec.sentence_score);
      const n = sentenceCategories.length;
      sentenceCategories.forEach((_, idx) => {
        const score = isNaN(baseScore) ? 0 : baseScore;
        sums[idx] += score * ((n - idx) / n);
      });
    });
    return sentenceCategories.map((cat, idx) => ({
      subject: cat,
      score: sums[idx] / records.length,
      fullMark: 5,
    }));
  }, [records, sentenceCategories]);

  // Compute aggregated knowledge mastery for email writing.  Similar to the
  // sentence calculation but using email scores.
  const radarDataEmail = useMemo(() => {
    if (!records || records.length === 0) {
      return emailCategories.map((cat) => ({
        subject: cat,
        score: 0,
        fullMark: 5,
      }));
    }
    const sums: number[] = new Array(emailCategories.length).fill(0);
    records.forEach((rec) => {
      const baseScore = parseFloat(String(rec.email_score)) || 0;
      const n = emailCategories.length;
      emailCategories.forEach((_, idx) => {
        const score = isNaN(baseScore) ? 0 : baseScore;
        sums[idx] += score * ((n - idx) / n);
      });
    });
    return emailCategories.map((cat, idx) => ({
      subject: cat,
      score: sums[idx] / records.length,
      fullMark: 5,
    }));
  }, [records, emailCategories]);

  // Compute aggregated knowledge mastery for academic discussion.
  const radarDataDiscussion = useMemo(() => {
    if (!records || records.length === 0) {
      return discussionCategories.map((cat) => ({
        subject: cat,
        score: 0,
        fullMark: 5,
      }));
    }
    const sums: number[] = new Array(discussionCategories.length).fill(0);
    records.forEach((rec) => {
      const baseScore = parseFloat(String(rec.discussion_score)) || 0;
      const n = discussionCategories.length;
      discussionCategories.forEach((_, idx) => {
        const score = isNaN(baseScore) ? 0 : baseScore;
        sums[idx] += score * ((n - idx) / n);
      });
    });
    return discussionCategories.map((cat, idx) => ({
      subject: cat,
      score: sums[idx] / records.length,
      fullMark: 5,
    }));
  }, [records, discussionCategories]);

  // Selected radar chart type: determines which dataset to display.
  const [selectedRadar, setSelectedRadar] = useState<
    "sentence" | "email" | "discussion"
  >("sentence");

  const currentRadarData :{
    subject: string;
    score: Number;
    fullMark: Number;
  }[] =
    selectedRadar === "sentence"
      ? radarDataSentence
      : selectedRadar === "email"
      ? radarDataEmail
      : radarDataDiscussion;

  return (
    <>
      <button
        type="button"
        onClick={onBackHome}
        style={{
          padding: "10px 16px",
          border: "1px solid #cbd5e1",
          borderRadius: "12px",
          background: "white",
          fontWeight: 700,
          cursor: "pointer",
          marginBottom: "24px",
        }}
      >
        返回首页
      </button>

      <div style={containerStyle}>
        <h1 style={{ marginTop: 0 }}>能力分析</h1>
        {/* 如果用户未登录 */}
        {!user && (
          <p style={{ color: "#be123c" }}>请先登录后再查看分析。</p>
        )}
        {/* 加载状态 */}
        {user && isLoading && (
          <p style={{ color: "#64748b" }}>正在加载练习记录...</p>
        )}
        {/* 错误信息 */}
        {user && !isLoading && message && (
          <p style={{ color: "#be123c" }}>{message}</p>
        )}
        {/* 没有记录 */}
        {user && !isLoading && !message && summary === null && (
          <p style={{ color: "#64748b" }}>
            暂无完整模考记录，请先完成一次完整模考以生成分析。
          </p>
        )}
        {/* 显示汇总数据 */}
        {user && !isLoading && summary && (
          <>
            <div style={{ marginBottom: "24px" }}>
              <h2 style={{ marginTop: 0, marginBottom: "12px" }}>总体统计</h2>
              <p style={{ color: "#475569" }}>完成次数：{summary.total}</p>
              <p style={{ color: "#475569" }}>
                平均总分：{summary.avgFinal.toFixed(1)} / 6.0
              </p>
            </div>
            <div style={{ marginBottom: "24px" }}>
              <h2 style={{ marginTop: 0, marginBottom: "12px" }}>分项能力</h2>
              <div style={{ marginBottom: "16px" }}>
                <strong>造句正确率：</strong>
                {(summary.avgSentence / 5 * 100).toFixed(0)}%
                <div style={barContainerStyle}>
                  <div style={barStyle(summary.avgSentence / 5)} />
                </div>
              </div>
              <div style={{ marginBottom: "16px" }}>
                <strong>邮件写作平均分：</strong>
                {summary.avgEmail.toFixed(1)} / 5.0
                <div style={barContainerStyle}>
                  <div style={barStyle(summary.avgEmail / 5)} />
                </div>
              </div>
              <div style={{ marginBottom: "16px" }}>
                <strong>学术讨论平均分：</strong>
                {summary.avgDiscussion.toFixed(1)} / 5.0
                <div style={barContainerStyle}>
                  <div style={barStyle(summary.avgDiscussion / 5)} />
                </div>
              </div>
            </div>
            <div>
              <h2 style={{ marginTop: 0, marginBottom: "12px" }}>薄弱项分析</h2>
              {summary.suggestions.map((tip, idx) => (
                <p key={idx} style={{ color: "#475569", lineHeight: 1.7 }}>
              {tip}
            </p>
          ))}
        </div>

            {/* 知识点掌握情况雷达图：一次只展示一种练习类型 */}
            <div style={{ marginTop: "32px" }}>
              <h2 style={{ marginTop: 0, marginBottom: "12px" }}>知识点掌握情况</h2>
              {/* 切换按钮：选择造句、邮件或讨论 */}
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  marginBottom: "16px",
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  onClick={() => setSelectedRadar("sentence")}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "8px",
                    border:
                      selectedRadar === "sentence"
                        ? "2px solid #6366f1"
                        : "1px solid #cbd5e1",
                    background:
                      selectedRadar === "sentence" ? "#eef2ff" : "#ffffff",
                    color: "#1e293b",
                    cursor: "pointer",
                  }}
                >
                  造句
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedRadar("email")}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "8px",
                    border:
                      selectedRadar === "email"
                        ? "2px solid #8b5cf6"
                        : "1px solid #cbd5e1",
                    background:
                      selectedRadar === "email" ? "#f5f3ff" : "#ffffff",
                    color: "#1e293b",
                    cursor: "pointer",
                  }}
                >
                  邮件
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedRadar("discussion")}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "8px",
                    border:
                      selectedRadar === "discussion"
                        ? "2px solid #22d3ee"
                        : "1px solid #cbd5e1",
                    background:
                      selectedRadar === "discussion" ? "#ecfeff" : "#ffffff",
                    color: "#1e293b",
                    cursor: "pointer",
                  }}
                >
                  讨论
                </button>
              </div>
              {/* 雷达图容器 */}
              <div style={{ width: "100%", height: "320px" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={currentRadarData}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="subject" />
                    <PolarRadiusAxis angle={30} domain={[0, 5]} />
                    <Radar
                      name="掌握度"
                      dataKey="score"
                      stroke={
                        selectedRadar === "sentence"
                          ? "#6366f1"
                          : selectedRadar === "email"
                          ? "#8b5cf6"
                          : "#22d3ee"
                      }
                      fill={
                        selectedRadar === "sentence"
                          ? "#6366f1"
                          : selectedRadar === "email"
                          ? "#8b5cf6"
                          : "#22d3ee"
                      }
                      fillOpacity={0.4}
                    />
                    <Tooltip />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 成绩趋势折线图：展示每次完整模考的各项分数变化 */}
            {trendData.length > 0 && (
              <div style={{ marginTop: "32px" }}>
                <h2 style={{ marginTop: 0, marginBottom: "12px" }}>成绩趋势</h2>
                {/* 完整模考总分折线图 */}
                <div style={{ marginBottom: "24px", width: "100%", height: "220px" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis domain={[0, 6]} />
                      <Tooltip />
                      <Line
                        type="monotone"
                        dataKey="final"
                        stroke="#111827"
                        dot={{ r: 2 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                  <div
                    style={{
                      textAlign: "center",
                      marginTop: "6px",
                      color: "#475569",
                      fontSize: "14px",
                    }}
                  >
                    完整模考总分
                  </div>
                </div>
                {/* 造句正确率折线图 */}
                <div style={{ marginBottom: "24px", width: "100%", height: "220px" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis domain={[0, 5]} />
                      <Tooltip />
                      <Line
                        type="monotone"
                        dataKey="sentence"
                        stroke="#6366f1"
                        dot={{ r: 2 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                  <div
                    style={{
                      textAlign: "center",
                      marginTop: "6px",
                      color: "#475569",
                      fontSize: "14px",
                    }}
                  >
                    造句题得分（满分 5）
                  </div>
                </div>
                {/* 邮件写作折线图 */}
                <div style={{ marginBottom: "24px", width: "100%", height: "220px" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis domain={[0, 5]} />
                      <Tooltip />
                      <Line
                        type="monotone"
                        dataKey="email"
                        stroke="#8b5cf6"
                        dot={{ r: 2 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                  <div
                    style={{
                      textAlign: "center",
                      marginTop: "6px",
                      color: "#475569",
                      fontSize: "14px",
                    }}
                  >
                    邮件写作得分（满分 5）
                  </div>
                </div>
                {/* 学术讨论折线图 */}
                <div style={{ marginBottom: "24px", width: "100%", height: "220px" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis domain={[0, 5]} />
                      <Tooltip />
                      <Line
                        type="monotone"
                        dataKey="discussion"
                        stroke="#22d3ee"
                        dot={{ r: 2 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                  <div
                    style={{
                      textAlign: "center",
                      marginTop: "6px",
                      color: "#475569",
                      fontSize: "14px",
                    }}
                  >
                    学术讨论得分（满分 5）
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

void AnalyticsPage;

function getPageFromPath(): Page {
  const path = window.location.pathname;

  if (path === "/")
    return "ets-style-preview";

  if (path.includes("/past-exam/preview"))
    return "past-exam-preview";
  if (path.includes("/past-exam"))
    return "past-exam";
  if (path.includes("/toefl-past-exam")) 
    return "past-exam";
  if (path.includes("/ets-mock-practice")) 
    return "ets-mock-practice";
  if (path.includes("/store"))
    return "ets-style-preview";
  if (path.includes("/build-a-sentence")) 
    return "sentence";
  if (path.includes("/email-writing")) 
    return "email";
  if (path.includes("/academic-discussion")) 
    return "discussion";
  if (path.includes("/full-mock-test")) 
    return "mock";

  if (
    path.includes("/practice-sessions") ||
    path.includes("/records") ||
    path.includes("/mock-records") ||
    path.includes("/analytics")
  ) {
    return "ets-style-preview";
  }

  return "ets-style-preview";
}

function getShortTopic(text: string, fallback = "Official Questions") {
  const cleaned = text
    .replace(/TOEFL Past Exam/gi, "")
    .replace(/Official Questions/gi, "")
    .replace(/Build a Sentence/gi, "")
    .replace(/Email Writing/gi, "")
    .replace(/Academic Discussion/gi, "")
    .replace(/\bPractice\b/gi, "")
    .replace(/\bQuestion\b/gi, "")
    .replace(/\b2026[-/]\d{1,2}[-/]\d{1,2}\b/g, "")
    .replace(/[-_:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const stopWords = new Set([
    "the",
    "and",
    "about",
    "your",
    "you",
    "are",
    "will",
    "write",
    "email",
    "professor",
    "student",
    "students",
    "question",
    "response",
    "recently",
    "have",
    "been",
    "with",
    "from",
    "that",
    "this",
    "there",
    "their",
    "what",
    "why",
    "how",
    "whether",
    "should",
  ]);

  const words = cleaned
    .split(/[^A-Za-z]+/)
    .filter((word) => word.length > 2 && !stopWords.has(word.toLowerCase()));

  const topicWords = Array.from(new Set(words)).slice(0, 4);

  return topicWords.length > 0 ? topicWords.join(" ") : fallback;
}

function toTitleCase(text: string) {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function getSimpleExamTopic(text: string, fallback = "Topic") {
  const normalized = text.toLowerCase();
  const topicRules: { label: string; keywords: string[] }[] = [
    {
      label: "Career",
      keywords: [
        "career",
        "job",
        "intern",
        "resume",
        "interview",
        "application",
        "workplace",
        "employer",
        "employee",
      ],
    },
    {
      label: "Travel",
      keywords: [
        "travel",
        "trip",
        "tour",
        "hotel",
        "resort",
        "package",
        "vacation",
        "spring break",
        "stay",
      ],
    },
    {
      label: "Environment",
      keywords: [
        "environment",
        "park",
        "litter",
        "water",
        "recycling",
        "climate",
        "pollution",
        "sustainability",
      ],
    },
    {
      label: "Housing",
      keywords: [
        "apartment",
        "landlord",
        "repair",
        "dorm",
        "room",
        "housing",
        "roommate",
      ],
    },
    {
      label: "Education",
      keywords: [
        "class",
        "course",
        "school",
        "lecture",
        "study",
        "exam",
        "professor",
        "college",
        "university",
      ],
    },
    {
      label: "Technology",
      keywords: [
        "technology",
        "digital",
        "online",
        "social media",
        "video",
        "app",
        "internet",
      ],
    },
    {
      label: "Presentation",
      keywords: ["presentation", "seminar", "workshop", "speech", "feedback"],
    },
    {
      label: "Health",
      keywords: ["health", "stress", "flu", "medical", "exercise", "wellness"],
    },
    {
      label: "Community",
      keywords: ["community", "volunteer", "service", "public"],
    },
    {
      label: "Art",
      keywords: ["art", "artist", "museum", "music", "painting"],
    },
  ];

  const matched = topicRules.find((rule) =>
    rule.keywords.some((keyword) => normalized.includes(keyword))
  );

  if (matched) return matched.label;

  return toTitleCase(getShortTopic(text, fallback).split(/\s+/).slice(0, 2).join(" "));
}

function getPastExamTaskTopic(task: QuestionSetTask, question?: Question) {
  if (task.type === "email") {
    return getSimpleExamTopic(
      [
        task.prompt.title,
        task.prompt.subject,
        task.prompt.scenario,
        task.prompt.task,
        ...(task.prompt.requirements || []),
      ].join(" "),
      "Email Topic"
    );
  }

  if (task.type === "discussion") {
    return getSimpleExamTopic(
      [
        task.prompt.title,
        task.prompt.question,
        task.prompt.professor,
        task.prompt.instruction,
      ].join(" "),
      "Discussion Topic"
    );
  }

  return getShortTopic(
    task.title || question?.contextSentence || question?.target || "",
    "Sentence Topic"
  );
}

function cleanPastExamDisplayTopic(value?: string | null) {
  return (value || "")
    .replace(/^TOEFL Past Exam\s*[-:]\s*/i, "")
    .replace(/^Official Questions\s*[-:]\s*/i, "")
    .replace(/^Build a Sentence\s*[-:]\s*/i, "")
    .replace(/^Email Writing\s*[-:]\s*/i, "")
    .replace(/^Academic Discussion\s*[-:]\s*/i, "")
    .replace(/\b2026[-/]\d{1,2}[-/]\d{1,2}\b/g, "")
    .replace(/[-_:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getOfficialQuestionsDisplayText(value?: string | null) {
  return (value || "")
    .replace(/TOEFL Past Exam/gi, "Official Questions")
    .replace(/\bPast Exam\b/gi, "Official Questions")
    .replace(/真题/g, "Official Questions");
}

function getPastExamTaskDisplayTopic(task: QuestionSetTask, question?: Question) {
  if (task.type === "email" || task.type === "discussion") {
    const promptTitle = cleanPastExamDisplayTopic(task.prompt.title);
    if (promptTitle) return promptTitle;

    const taskTitle = cleanPastExamDisplayTopic(task.title);
    if (taskTitle) return taskTitle;

    return getPastExamTaskTopic(task, question);
  }

  if (task.type === "sentence") {
    const taskTitle = cleanPastExamDisplayTopic(task.title);
    if (taskTitle) return taskTitle;
    return question ? getPastExamTaskTopic(task, question) : "Build a Sentence";
  }

  return getPastExamTaskTopic(task, question);
}

function getPastExamTaskCategory(task: QuestionSetTask) {
  if (task.type === "sentence") return "";

  const promptWithCategory = task.prompt as (EmailPrompt | DiscussionPrompt) & {
    knowledgeCategory?: string;
    category?: string;
  };
  const internalKnowledgeCategories = new Set<string>([
    ...EMAIL_KNOWLEDGE_CATEGORIES,
    ...DISCUSSION_KNOWLEDGE_CATEGORIES,
  ]);
  const categories = [
    promptWithCategory.category,
    promptWithCategory.knowledgeCategory,
  ].filter((value): value is string => Boolean(value));

  return (
    categories.find((category) => !internalKnowledgeCategories.has(category)) ||
    ""
  );
}

const EMAIL_TOPIC_CATEGORIES = [
  "学术校园",
  "服务反馈",
  "旅行住宿",
  "合作活动",
  "生活社交",
  "求职申请",
] as const;

const DISCUSSION_TOPIC_CATEGORIES = [
  "教育学习",
  "商业经济",
  "科技媒体",
  "心理健康",
  "环境城市",
  "艺术人文",
  "社会文化",
  "政府政策",
] as const;

function countTopicKeywordMatches(text: string, keywords: string[]) {
  return keywords.reduce((score, keyword) => {
    const pattern = keyword
      .split(/\s+/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+");
    const matches = text.match(new RegExp(`\\b${pattern}\\b`, "g"));
    return score + (matches?.length || 0);
  }, 0);
}

function chooseWritingTheme(
  text: string,
  groups: { label: string; keywords: string[] }[],
  fallback: string
) {
  return groups.reduce(
    (best, group) => {
      const score = countTopicKeywordMatches(text, group.keywords);
      return score > best.score ? { label: group.label, score } : best;
    },
    { label: fallback, score: 0 }
  ).label;
}

function getPastExamTaskTheme(task: QuestionSetTask) {
  if (task.type === "sentence") return "";

  const explicitCategory = getPastExamTaskCategory(task);
  const allowedCategories =
    task.type === "email"
      ? EMAIL_TOPIC_CATEGORIES
      : DISCUSSION_TOPIC_CATEGORIES;

  if ((allowedCategories as readonly string[]).includes(explicitCategory)) {
    return explicitCategory;
  }

  const text = [task.title, JSON.stringify(task.prompt)]
    .join(" ")
    .toLowerCase();

  if (task.type === "email") {
    return chooseWritingTheme(
      text,
      [
        {
          label: "求职申请",
          keywords: [
            "job",
            "career",
            "intern",
            "internship",
            "resume",
            "résumé",
            "interview",
            "employer",
            "employee",
            "hiring",
            "employment",
            "job application",
          ],
        },
        {
          label: "服务反馈",
          keywords: [
            "customer service",
            "complaint",
            "refund",
            "replacement",
            "repair",
            "damaged",
            "defective",
            "technical problem",
            "technical issue",
            "online store",
            "delivery",
            "order",
            "purchase",
            "subscription",
            "support team",
            "property manager",
            "heating system",
            "submission form",
            "product",
            "issue",
          ],
        },
        {
          label: "旅行住宿",
          keywords: [
            "travel",
            "trip",
            "flight",
            "airline",
            "hotel",
            "hostel",
            "accommodation",
            "reservation",
            "booking",
            "vacation",
            "tour",
            "luggage",
            "tourist",
            "resort",
          ],
        },
        {
          label: "生活社交",
          keywords: [
            "new city",
            "adjust",
            "adjustment",
            "overwhelmed",
            "advice",
            "personal advice",
            "personal problem",
            "relationship",
            "family",
            "social life",
            "make new friends",
            "settle into",
            "well-being",
            "birthday",
            "wedding",
          ],
        },
        {
          label: "合作活动",
          keywords: [
            "group project",
            "group member",
            "event",
            "club",
            "meeting",
            "volunteer",
            "activity",
            "invite",
            "invitation",
            "organize",
            "organizer",
            "festival",
            "concert",
            "team",
            "workshop",
            "conference",
            "collaborate",
            "collaboration",
          ],
        },
        {
          label: "学术校园",
          keywords: [
            "professor",
            "course",
            "class",
            "assignment",
            "campus",
            "university",
            "college",
            "research project",
            "semester",
            "academic",
            "deadline",
            "lecture",
          ],
        },
      ],
      "学术校园"
    );
  }

  return chooseWritingTheme(
    text,
    [
      {
        label: "政府政策",
        keywords: [
          "government",
          "policy",
          "policies",
          "law",
          "laws",
          "tax",
          "taxes",
          "budget",
          "regulation",
          "regulations",
          "vote",
          "voting",
          "official",
          "public funding",
        ],
      },
      {
        label: "艺术人文",
        keywords: [
          "art",
          "artist",
          "music",
          "museum",
          "painting",
          "film",
          "literature",
          "humanities",
          "poetry",
          "theater",
          "theatre",
          "philosophy",
          "free will",
        ],
      },
      {
        label: "环境城市",
        keywords: [
          "environment",
          "environmental",
          "pollution",
          "climate",
          "smart city",
          "smart cities",
          "urban",
          "traffic",
          "public transport",
          "recycling",
          "sustainability",
          "sustainable",
          "natural resource",
          "natural resources",
          "planet",
          "planets",
          "energy-efficient",
        ],
      },
      {
        label: "心理健康",
        keywords: [
          "stress",
          "mental health",
          "health",
          "exercise",
          "wellness",
          "sleep",
          "emotion",
          "psychology",
          "anxiety",
        ],
      },
      {
        label: "商业经济",
        keywords: [
          "business",
          "economy",
          "economic",
          "company",
          "consumer",
          "advertising",
          "marketing",
          "marketer",
          "marketers",
          "money",
          "income",
          "workplace",
          "financial",
          "poverty",
        ],
      },
      {
        label: "科技媒体",
        keywords: [
          "artificial intelligence",
          "ai",
          "technology",
          "digital",
          "internet",
          "online platform",
          "social media",
          "app",
          "apps",
          "video platform",
        ],
      },
      {
        label: "社会文化",
        keywords: [
          "society",
          "social mobility",
          "culture",
          "cultural",
          "community",
          "tradition",
          "traditions",
          "language",
          "family",
          "friend",
          "friends",
          "anthropology",
          "anthropologist",
          "ritual",
          "rituals",
          "hierarchy",
          "networking",
          "personal connections",
        ],
      },
      {
        label: "教育学习",
        keywords: [
          "education",
          "educational",
          "school",
          "college",
          "university",
          "student",
          "students",
          "course",
          "courses",
          "class",
          "learning",
          "training",
          "degree",
          "degrees",
          "teacher",
          "professor",
        ],
      },
    ],
    "教育学习"
  );
}

function PastExamPage({
  items,
  activeBank,
  setActiveBank,
  openRandomOnEnter,
  onRandomOpened,
  onBackLayer,
  practicedIds,
  bestScores,
  sentenceBestScores,
  mockRecords,
  isLoading,
  message,
  onRecordContextMenu,
  onOpenRecordDetail,
  onPreview,
  onRandomPractice,
}: {
  items: QuestionSet[];
  activeBank: PastExamPracticeType | null;
  setActiveBank: (type: PastExamPracticeType | null) => void;
  openRandomOnEnter: boolean;
  onRandomOpened: () => void;
  onBackLayer: () => void;
  practicedIds: string[];
  bestScores: Map<string, number>;
  sentenceBestScores: Map<string, number>;
  mockRecords: MockRecord[];
  isLoading: boolean;
  message: string;
  onRecordContextMenu: (
    event: MouseEvent<HTMLElement>,
    target: DeleteRecordTarget
  ) => void;
  onOpenRecordDetail: (detail: PastExamRecordDetail) => void;
  onPreview: (selection: PastExamPreviewSelection) => void;
  onRandomPractice: (options: PastExamRandomOptions) => void;
}) {
  const [showRandomModal, setShowRandomModal] = useState(false);
  const [selectedTypes, setSelectedTypes] = useState<PastExamPracticeType[]>([
    "sentence",
  ]);
  const [randomPracticeMode, setRandomPracticeMode] = useState<
    "custom" | "exam_set"
  >("custom");
  const [sentenceRandomMode, setSentenceRandomMode] =
    useState<"mixed" | "random_set" | "set">("mixed");
  const [selectedSentenceSetId, setSelectedSentenceSetId] = useState("");
  const [completionFilter, setCompletionFilter] =
    useState<"all" | "done" | "undone">("all");
  const [expandedDates, setExpandedDates] = useState<string[]>([]);

  const taskGroups = items.reduce(
    (groups, item) => {
      const tasks = Array.isArray(item.content.tasks) ? item.content.tasks : [];

      tasks.forEach((task) => {
        if (task.type === "sentence") {
          groups.sentence.push({ item, task });
        }

        if (task.type === "email") {
          groups.email.push({ item, task });
        }

        if (task.type === "discussion") {
          groups.discussion.push({ item, task });
        }
      });

      return groups;
    },
    {
      sentence: [] as { item: QuestionSet; task: Extract<QuestionSetTask, { type: "sentence" }> }[],
      email: [] as { item: QuestionSet; task: Extract<QuestionSetTask, { type: "email" }> }[],
      discussion: [] as { item: QuestionSet; task: Extract<QuestionSetTask, { type: "discussion" }> }[],
    }
  );

  useEffect(() => {
    setCompletionFilter("all");
    setExpandedDates([]);
  }, [activeBank]);

  useEffect(() => {
    if (!openRandomOnEnter) return;

    setShowRandomModal(true);
    onRandomOpened();
  }, [openRandomOnEnter, onRandomOpened]);

  function toggleType(type: PastExamPracticeType) {
    setSelectedTypes((current) => {
      if (current.includes(type)) {
        return current.filter((item) => item !== type);
      }

      return [...current, type];
    });
  }

  function startRandomPractice() {
    if (randomPracticeMode === "exam_set") {
      onRandomPractice({
        selectedTypes: ["sentence", "email", "discussion"],
        practiceMode: "exam_set",
      });
      setShowRandomModal(false);
      return;
    }

    if (selectedTypes.length === 0) return;
    if (
      selectedTypes.includes("sentence") &&
      sentenceRandomMode === "set" &&
      !selectedSentenceSetId &&
      sentenceSetOptions.length > 0
    ) {
      onRandomPractice({
        selectedTypes,
        sentenceMode: sentenceRandomMode,
        sentenceSetId: sentenceSetOptions[0].item.id,
      });
      setShowRandomModal(false);
      return;
    }

    onRandomPractice({
      selectedTypes,
      sentenceMode: sentenceRandomMode,
      sentenceSetId: selectedSentenceSetId,
    });
    setShowRandomModal(false);
  }

  function getQuestionSetDateTime(item: QuestionSet) {
    const time = Date.parse(item.display_date || "");
    return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
  }

  const sentenceSetOptions = taskGroups.sentence
    .map(({ item, task }) => ({
      item,
      task,
      count: task.questions.length,
    }))
    .sort((left, right) => {
      const dateDifference =
        getQuestionSetDateTime(right.item) - getQuestionSetDateTime(left.item);

      if (dateDifference !== 0) return dateDifference;

      return (left.item.sort_order || 0) - (right.item.sort_order || 0);
    });
  const sentenceQuestionCount = sentenceSetOptions.reduce(
    (total, option) => total + option.count,
    0
  );
  const randomExamSetCount = getPastExamRandomSetCandidates(items).length;
  const typeOptions: { type: PastExamPracticeType; label: string; count: number }[] = [
    {
      type: "sentence",
      label: "Build a Sentence",
      count: sentenceQuestionCount,
    },
    {
      type: "email",
      label: "Email Writing",
      count: taskGroups.email.length,
    },
    {
      type: "discussion",
      label: "Academic Discussion",
      count: taskGroups.discussion.length,
    },
  ];
  const activeBankTitle =
    activeBank === "sentence"
      ? "Build a Sentence"
      : activeBank === "email"
        ? "Email Writing"
        : activeBank === "discussion"
          ? "Academic Discussion"
          : "";

  const activeBankCount =
    activeBank === "sentence"
      ? sentenceSetOptions.length
      : activeBank === "email"
        ? taskGroups.email.length
        : activeBank === "discussion"
          ? taskGroups.discussion.length
          : 0;

  const practicedSetIds = new Set(practicedIds);

  function isPastExamEntryDone(
    type: PastExamPracticeType,
    item: QuestionSet,
    task: QuestionSetTask
  ) {
    if (type === "sentence") {
      return practicedSetIds.has(item.id);
    }

    if (type === "email" && task.type === "email") {
      return bestScores.has(getPromptScoreKey("email", task.prompt));
    }

    if (type === "discussion" && task.type === "discussion") {
      return bestScores.has(getPromptScoreKey("discussion", task.prompt));
    }

    return false;
  }

  function shouldShowPastExamEntry(
    type: PastExamPracticeType,
    item: QuestionSet,
    task: QuestionSetTask
  ) {
    if (completionFilter === "all") return true;

    const done = isPastExamEntryDone(type, item, task);
    return completionFilter === "done" ? done : !done;
  }

  function toggleExpandedDate(date: string) {
    setExpandedDates((current) =>
      current.includes(date)
        ? current.filter((item) => item !== date)
        : [...current, date]
    );
  }

  function groupPastExamEntriesByDate<T extends { item: QuestionSet }>(
    entries: T[]
  ) {
    return entries.reduce((groups, entry) => {
      const date = entry.item.display_date || "No date";
      const existing = groups.find((group) => group.date === date);

      if (existing) {
        existing.entries.push(entry);
      } else {
        groups.push({ date, entries: [entry] });
      }

      return groups;
    }, [] as { date: string; entries: T[] }[]);
  }

  const filteredSentenceEntries = sentenceSetOptions.filter(({ item, task }) =>
    shouldShowPastExamEntry("sentence", item, task)
  );
  const filteredEmailEntries = taskGroups.email.filter(({ item, task }) =>
    shouldShowPastExamEntry("email", item, task)
  );
  const filteredDiscussionEntries = taskGroups.discussion.filter(({ item, task }) =>
    shouldShowPastExamEntry("discussion", item, task)
  );
  const pastExamSentenceQuestionKeys = new Set(
    sentenceSetOptions.flatMap((option) =>
      option.task.questions.map((question) => getSentenceQuestionKey(question))
    )
  );
  const pastExamEmailPromptKeys = new Set(
    taskGroups.email.map(({ task }) => getPromptScoreKey("email", task.prompt))
  );
  const pastExamDiscussionPromptKeys = new Set(
    taskGroups.discussion.map(({ task }) =>
      getPromptScoreKey("discussion", task.prompt)
    )
  );
  const fullMockRecordLinks = mockRecords
    .filter((record) => {
      if (!isCompleteMockRecord(record)) return false;

      const sentenceQuestions = record.sentence_questions || [];

      return (
        sentenceQuestions.length > 0 &&
        sentenceQuestions.every((question) =>
          pastExamSentenceQuestionKeys.has(getSentenceQuestionKey(question))
        ) &&
        pastExamEmailPromptKeys.has(getPromptScoreKey("email", record.email_prompt)) &&
        pastExamDiscussionPromptKeys.has(
          getPromptScoreKey("discussion", record.discussion_prompt)
        )
      );
    })
    .map((record) => ({
      id: record.id,
      createdAt: record.created_at,
      finalScore: Number(record.final_score),
      sentenceScore: Number(record.sentence_score),
      emailScore: record.email_score,
      discussionScore: record.discussion_score,
      detail: {
        kind: "mock-full" as const,
        record,
      },
    }))
    .sort(
      (left, right) =>
        Date.parse(right.createdAt || "") - Date.parse(left.createdAt || "")
    );
  const sentenceDateGroups = groupPastExamEntriesByDate(filteredSentenceEntries);
  const emailDateGroups = groupPastExamEntriesByDate(filteredEmailEntries);
  const discussionDateGroups = groupPastExamEntriesByDate(filteredDiscussionEntries);
  const activeFilteredCount =
    activeBank === "sentence"
      ? filteredSentenceEntries.length
      : activeBank === "email"
        ? filteredEmailEntries.length
        : activeBank === "discussion"
          ? filteredDiscussionEntries.length
          : 0;

  return (
    <>
      {isLoading && <p style={{ color: "#64748b" }}>Loading question sets...</p>}
      {message && <p style={{ color: "#be123c", fontWeight: 700 }}>{message}</p>}
      {!isLoading && items.length === 0 && (
        <p style={{ color: "#64748b" }}>No question sets available yet.</p>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: activeBank ? "flex-start" : "center",
          marginBottom: "24px",
        }}
      >
        <button
          type="button"
          onClick={() => setShowRandomModal(true)}
          disabled={isLoading || items.length === 0}
          style={{
            width: activeBank ? "min(280px, 100%)" : "min(420px, 100%)",
            padding: "16px 22px",
            border: "none",
            borderRadius: "16px",
            background: isLoading || items.length === 0 ? "#cbd5e1" : "#111827",
            color: "white",
            fontWeight: 900,
            cursor: isLoading || items.length === 0 ? "not-allowed" : "pointer",
          }}
        >
          随机练习
        </button>
      </div>

      {!activeBank && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: "18px",
            }}
          >
            {typeOptions.map((option) => (
              <button
                key={option.type}
                type="button"
                onClick={() => setActiveBank(option.type)}
                style={{
                  minHeight: "150px",
                  padding: "26px",
                  border: "1px solid #e2e8f0",
                  borderRadius: "24px",
                  background: "#f8fafc",
                  color: "#111827",
                  textAlign: "left",
                  cursor: "pointer",
                  boxShadow: "0 14px 34px rgba(15, 23, 42, 0.06)",
                }}
              >
                <div style={{ fontSize: "28px", fontWeight: 900 }}>
                  {option.label}
                </div>
                <div
                  style={{
                    marginTop: "18px",
                    color: "#64748b",
                    fontSize: "18px",
                    fontWeight: 800,
                  }}
                >
                  {option.type === "sentence"
                    ? `${sentenceSetOptions.length} 套`
                    : `${option.count} 题`}
                </div>
              </button>
            ))}
          </div>

          <section
            style={{
              marginTop: "26px",
              padding: "22px",
              borderRadius: "20px",
              border: "1px solid #e2e8f0",
              background: "white",
              boxShadow: "0 10px 30px rgba(15, 23, 42, 0.05)",
            }}
          >
            <h2 style={{ margin: "0 0 14px", fontSize: "22px" }}>
              完整模考记录
            </h2>

            {fullMockRecordLinks.length === 0 && (
              <p style={{ margin: 0, color: "#64748b", lineHeight: 1.7 }}>
                暂无完整模考记录。
              </p>
            )}

            {fullMockRecordLinks.length > 0 && (
              <div style={{ display: "grid", gap: "10px" }}>
                {fullMockRecordLinks.map((record) => (
                  <button
                    key={record.id}
                    type="button"
                    onClick={() => onOpenRecordDetail(record.detail)}
                    onContextMenu={(event) =>
                      onRecordContextMenu(event, {
                        source: "mock",
                        id: record.id,
                        label: "完整模考",
                      })
                    }
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto auto auto",
                      gap: "14px",
                      alignItems: "center",
                      padding: "14px 16px",
                      borderRadius: "14px",
                      border: "1px solid #e2e8f0",
                      background: "#f8fafc",
                      color: "#111827",
                      cursor: "pointer",
                      fontWeight: 800,
                      textAlign: "left",
                    }}
                  >
                    <span style={{ color: "#64748b" }}>
                      {new Date(record.createdAt).toLocaleString()}
                    </span>
                    <span style={{ color: "#312e81" }}>
                      Final{" "}
                      {Number.isNaN(record.finalScore)
                        ? "-"
                        : record.finalScore.toFixed(1)}{" "}
                      / 6.0
                    </span>
                    <span style={{ color: "#64748b", fontSize: "14px" }}>
                      Sentence{" "}
                      {Number.isNaN(record.sentenceScore)
                        ? "-"
                        : record.sentenceScore.toFixed(1)}{" "}
                      · Email {record.emailScore} · Discussion{" "}
                      {record.discussionScore}
                    </span>
                    <span style={{ color: "#00756f" }}>查看详情</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {activeBank && (
        <section>
          <button
            type="button"
            onClick={onBackLayer}
            style={{
              padding: "10px 16px",
              border: "1px solid #cbd5e1",
              borderRadius: "12px",
              background: "white",
              color: "#111827",
              fontWeight: 800,
              cursor: "pointer",
              marginBottom: "18px",
            }}
          >
            返回上一层
          </button>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "14px",
              alignItems: "center",
              flexWrap: "wrap",
              marginBottom: "18px",
            }}
          >
            <div>
              <h2 style={{ margin: 0 }}>{activeBankTitle}</h2>
              <p style={{ margin: "6px 0 0", color: "#64748b" }}>
                {activeBank === "sentence"
                  ? `${activeFilteredCount} / ${activeBankCount} 套`
                  : `${activeFilteredCount} / ${activeBankCount} 题`}
              </p>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: "10px",
                flexWrap: "wrap",
              }}
            >
              {[
                ["all", "全部"],
                ["done", "已做过"],
                ["undone", "未做过"],
              ].map(([value, label]) => {
                const active = completionFilter === value;

                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() =>
                      setCompletionFilter(value as "all" | "done" | "undone")
                    }
                    style={{
                      padding: "8px 14px",
                      border: active
                        ? "1px solid #00756f"
                        : "1px solid #cbd5e1",
                      borderRadius: "999px",
                      background: active ? "#00756f" : "white",
                      color: active ? "white" : "#111827",
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: "grid", gap: "10px" }}>
            {activeBank === "sentence" &&
              sentenceDateGroups.map((group) => {
                const expanded = expandedDates.includes(group.date);

                return (
                  <PastExamDateGroup
                    key={`sentence-${group.date}`}
                    date={group.date}
                    count={group.entries.length}
                    unit="套"
                    expanded={expanded}
                    onToggle={() => toggleExpandedDate(group.date)}
                  >
                    {group.entries.map(({ item, task, count }, index) => (
                      <PastExamListCard
                        key={`${item.id}-${task.title}-${index}`}
                        date=""
                        topic="Build a Sentence"
                        category={`${count} 题`}
                        bestScore={sentenceBestScores.get(
                          getSentenceSetKey(task.questions)
                        )}
                        onClick={() => onPreview({ item, type: "sentence", task })}
                      />
                    ))}
                  </PastExamDateGroup>
                );
              })}

            {activeBank === "email" &&
              emailDateGroups.map((group) => {
                const expanded = expandedDates.includes(group.date);

                return (
                  <PastExamDateGroup
                    key={`email-${group.date}`}
                    date={group.date}
                    count={group.entries.length}
                    unit="题"
                    expanded={expanded}
                    onToggle={() => toggleExpandedDate(group.date)}
                  >
                    {group.entries.map(({ item, task }, index) => (
                      <PastExamListCard
                        key={`${item.id}-${task.title}-${index}`}
                        date=""
                        topic={getPastExamTaskDisplayTopic(task)}
                        category={getPastExamTaskTheme(task)}
                        bestScore={bestScores.get(
                          getPromptScoreKey("email", task.prompt)
                        )}
                        onClick={() => onPreview({ item, type: "email", task })}
                      />
                    ))}
                  </PastExamDateGroup>
                );
              })}

            {activeBank === "discussion" &&
              discussionDateGroups.map((group) => {
                const expanded = expandedDates.includes(group.date);

                return (
                  <PastExamDateGroup
                    key={`discussion-${group.date}`}
                    date={group.date}
                    count={group.entries.length}
                    unit="题"
                    expanded={expanded}
                    onToggle={() => toggleExpandedDate(group.date)}
                  >
                    {group.entries.map(({ item, task }, index) => (
                      <PastExamListCard
                        key={`${item.id}-${task.title}-${index}`}
                        date=""
                        topic={getPastExamTaskDisplayTopic(task)}
                        category={getPastExamTaskTheme(task)}
                        bestScore={bestScores.get(
                          getPromptScoreKey("discussion", task.prompt)
                        )}
                        onClick={() => onPreview({ item, type: "discussion", task })}
                      />
                    ))}
                  </PastExamDateGroup>
                );
              })}

            {activeFilteredCount === 0 && (
              <p style={{ color: "#64748b", margin: "8px 0" }}>
                暂无符合筛选条件的题目。
              </p>
            )}
          </div>
        </section>
      )}

      {showRandomModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
            padding: "20px",
          }}
        >
          <section
            style={{
              width: "min(520px, 100%)",
              background: "white",
              borderRadius: "22px",
              border: "1px solid #e2e8f0",
              padding: "24px",
              boxShadow: "0 24px 80px rgba(15, 23, 42, 0.22)",
            }}
          >
            <h2 style={{ marginTop: 0 }}>选择随机练习内容</h2>
            <p style={{ color: "#64748b", lineHeight: 1.7 }}>
              {randomPracticeMode === "exam_set"
                ? "系统会随机选择同一场考试的造句、邮件和讨论。"
                : "至少选择一个部分。造句会抽 10 题，邮件和讨论各抽 1 题。"}
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: "10px",
                marginBottom: "18px",
                padding: "5px",
                borderRadius: "16px",
                background: "#eef2f7",
              }}
            >
              {([
                ["custom", "自由随机"],
                ["exam_set", "随机 Set"],
              ] as const).map(([mode, label]) => {
                const active = randomPracticeMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setRandomPracticeMode(mode)}
                    style={{
                      padding: "11px 14px",
                      border: "none",
                      borderRadius: "12px",
                      background: active ? "white" : "transparent",
                      color: active ? "#00756f" : "#64748b",
                      boxShadow: active
                        ? "0 5px 16px rgba(15, 23, 42, 0.10)"
                        : "none",
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {randomPracticeMode === "custom" && <>
            <div style={{ display: "grid", gap: "12px" }}>
              {typeOptions.map((option) => {
                const active = selectedTypes.includes(option.type);

                return (
                  <button
                    key={option.type}
                    type="button"
                    onClick={() => toggleType(option.type)}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "14px 16px",
                      borderRadius: "16px",
                      border: active
                        ? "2px solid #00756f"
                        : "1px solid #cbd5e1",
                      background: active ? "#ecfeff" : "white",
                      color: "#111827",
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    <span>{option.label}</span>
                    <span style={{ color: "#64748b" }}>{option.count} 题</span>
                  </button>
                );
              })}
            </div>

            {selectedTypes.includes("sentence") && (
              <div
                style={{
                  marginTop: "18px",
                  padding: "16px",
                  borderRadius: "18px",
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                }}
              >
                <div
                  style={{
                    fontWeight: 900,
                    marginBottom: "12px",
                    color: "#111827",
                  }}
                >
                  Build a Sentence 抽题方式
                </div>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => setSentenceRandomMode("mixed")}
                    style={{
                      padding: "10px 14px",
                      borderRadius: "999px",
                      border:
                        sentenceRandomMode === "mixed"
                          ? "2px solid #00756f"
                          : "1px solid #cbd5e1",
                      background:
                        sentenceRandomMode === "mixed" ? "#00756f" : "white",
                      color:
                        sentenceRandomMode === "mixed" ? "white" : "#111827",
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    跨 set 随机
                  </button>
                  <button
                    type="button"
                    onClick={() => setSentenceRandomMode("random_set")}
                    style={{
                      padding: "10px 14px",
                      borderRadius: "999px",
                      border:
                        sentenceRandomMode === "random_set"
                          ? "2px solid #00756f"
                          : "1px solid #cbd5e1",
                      background:
                        sentenceRandomMode === "random_set"
                          ? "#00756f"
                          : "white",
                      color:
                        sentenceRandomMode === "random_set"
                          ? "white"
                          : "#111827",
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    同一 Set 随机
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSentenceRandomMode("set");
                      if (!selectedSentenceSetId && sentenceSetOptions[0]) {
                        setSelectedSentenceSetId(sentenceSetOptions[0].item.id);
                      }
                    }}
                    style={{
                      padding: "10px 14px",
                      borderRadius: "999px",
                      border:
                        sentenceRandomMode === "set"
                          ? "2px solid #00756f"
                          : "1px solid #cbd5e1",
                      background:
                        sentenceRandomMode === "set" ? "#00756f" : "white",
                      color: sentenceRandomMode === "set" ? "white" : "#111827",
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    选择一个 set
                  </button>
                </div>

                {sentenceRandomMode === "set" && (
                  <select
                    value={selectedSentenceSetId || sentenceSetOptions[0]?.item.id || ""}
                    onChange={(event) => setSelectedSentenceSetId(event.target.value)}
                    style={{
                      width: "100%",
                      marginTop: "12px",
                      padding: "12px 14px",
                      borderRadius: "14px",
                      border: "1px solid #cbd5e1",
                      background: "white",
                      fontWeight: 800,
                      color: "#111827",
                    }}
                  >
                    {sentenceSetOptions.map((option) => (
                      <option key={option.item.id} value={option.item.id}>
                        {option.item.display_date || "No date"} ({option.count} 题)
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
            </>}

            {randomPracticeMode === "exam_set" && randomExamSetCount === 0 && (
              <p style={{ color: "#be123c", fontWeight: 800 }}>
                当前题库没有同时包含三个题型的考试日期。
              </p>
            )}

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "10px",
                marginTop: "22px",
              }}
            >
              <button
                type="button"
                onClick={() => setShowRandomModal(false)}
                style={{
                  padding: "10px 16px",
                  borderRadius: "12px",
                  border: "1px solid #cbd5e1",
                  background: "white",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={startRandomPractice}
                disabled={
                  randomPracticeMode === "exam_set"
                    ? randomExamSetCount === 0
                    : selectedTypes.length === 0 ||
                      (selectedTypes.includes("sentence") &&
                        sentenceQuestionCount === 0)
                }
                style={{
                  padding: "10px 18px",
                  borderRadius: "12px",
                  border: "none",
                  background:
                    (randomPracticeMode === "exam_set"
                      ? randomExamSetCount === 0
                      : selectedTypes.length === 0 ||
                        (selectedTypes.includes("sentence") &&
                          sentenceQuestionCount === 0))
                      ? "#cbd5e1"
                      : "#00756f",
                  color: "white",
                  fontWeight: 800,
                  cursor:
                    (randomPracticeMode === "exam_set"
                      ? randomExamSetCount === 0
                      : selectedTypes.length === 0 ||
                        (selectedTypes.includes("sentence") &&
                          sentenceQuestionCount === 0))
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                {randomPracticeMode === "exam_set"
                  ? "开始随机 Set"
                  : "开始随机练习"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function QuestionPreviewModal({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 850,
        background: "rgba(15, 23, 42, 0.48)",
        padding: "28px",
        overflow: "auto",
      }}
      onClick={onClose}
    >
      <main
        className="question-preview-surface"
        role="dialog"
        aria-modal="true"
        aria-label="题目预览"
        style={{
          width: "min(1180px, 100%)",
          margin: "0 auto",
          borderRadius: "26px",
          background: "#f8fafc",
          padding: "22px",
          boxShadow: "0 28px 90px rgba(15, 23, 42, 0.28)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </main>
    </div>
  );
}

function PastExamPreviewPage({
  selection,
  practiceRecords,
  mockRecords,
  onRecordContextMenu,
  onOpenRecordDetail,
  onBack,
  onStart,
  embedded = false,
}: {
  selection: PastExamPreviewSelection;
  practiceRecords: PracticeRecord[];
  mockRecords: MockRecord[];
  onRecordContextMenu: (
    event: MouseEvent<HTMLElement>,
    target: DeleteRecordTarget
  ) => void;
  onOpenRecordDetail: (detail: PastExamRecordDetail) => void;
  onBack: () => void;
  onStart: () => void;
  embedded?: boolean;
}) {
  const { item, type, task, question } = selection;
  const topic =
    type === "sentence" && !question
      ? ""
      : getPastExamTaskDisplayTopic(task, question);
  const category =
    type === "sentence" && !question && task.type === "sentence"
      ? `${task.questions.length} 题`
      : getPastExamTaskTheme(task);
  const recordLinks: PastExamRecordLink[] = (() => {
    if (type === "sentence" && task.type === "sentence") {
      const previewQuestions = question ? [question] : task.questions;
      const previewSetKey = getSentenceSetKey(previewQuestions);
      const previewQuestionKeys = new Set(
        previewQuestions.map((item) => getSentenceQuestionKey(item))
      );

      return mockRecords
        .filter((record) => {
          const recordQuestions = record.sentence_questions || [];

          if (question) {
            return recordQuestions.some((item) =>
              previewQuestionKeys.has(getSentenceQuestionKey(item))
            );
          }

          return getSentenceSetKey(recordQuestions) === previewSetKey;
        })
        .map((record) => ({
          id: `mock-${record.id}-sentence`,
          recordId: record.id,
          source: "mock" as const,
          label: "Build a Sentence",
          score: `${Number(record.sentence_score).toFixed(1)} / 10.0`,
          createdAt: record.created_at,
          detail: {
            kind: "mock-section" as const,
            record,
            section: "sentence" as const,
            sentenceQuestions: previewQuestions,
          },
        }));
    }

    if (type === "email" && task.type === "email") {
      const promptKey = getPromptScoreKey("email", task.prompt);
      const singleRecords = practiceRecords
        .filter(
          (record) =>
            record.practice_type === "email" &&
            getPromptScoreKey("email", record.prompt) === promptKey
        )
        .map((record) => ({
          id: `practice-${record.id}`,
          recordId: record.id,
          source: "practice" as const,
          label: "Email Writing",
          score: record.score,
          createdAt: record.created_at,
          detail: {
            kind: "practice" as const,
            record,
          },
        }));
      const mockLinks = mockRecords
        .filter(
          (record) => getPromptScoreKey("email", record.email_prompt) === promptKey
        )
        .map((record) => ({
          id: `mock-${record.id}-email`,
          recordId: record.id,
          source: "mock" as const,
          label: "Email Writing",
          score: record.email_score,
          createdAt: record.created_at,
          detail: {
            kind: "mock-section" as const,
            record,
            section: "email" as const,
          },
        }));

      return [...singleRecords, ...mockLinks];
    }

    if (type === "discussion" && task.type === "discussion") {
      const promptKey = getPromptScoreKey("discussion", task.prompt);
      const singleRecords = practiceRecords
        .filter(
          (record) =>
            record.practice_type === "discussion" &&
            getPromptScoreKey("discussion", record.prompt) === promptKey
        )
        .map((record) => ({
          id: `practice-${record.id}`,
          recordId: record.id,
          source: "practice" as const,
          label: "Academic Discussion",
          score: record.score,
          createdAt: record.created_at,
          detail: {
            kind: "practice" as const,
            record,
          },
        }));
      const mockLinks = mockRecords
        .filter(
          (record) =>
            getPromptScoreKey("discussion", record.discussion_prompt) === promptKey
        )
        .map((record) => ({
          id: `mock-${record.id}-discussion`,
          recordId: record.id,
          source: "mock" as const,
          label: "Academic Discussion",
          score: record.discussion_score,
          createdAt: record.created_at,
          detail: {
            kind: "mock-section" as const,
            record,
            section: "discussion" as const,
          },
        }));

      return [...singleRecords, ...mockLinks];
    }

    return [];
  })().sort(
    (left, right) =>
      Date.parse(right.createdAt || "") - Date.parse(left.createdAt || "")
  );

  return (
    <>
      {!embedded && (
        <button
          type="button"
          onClick={onBack}
          style={{
            padding: "10px 16px",
            border: "1px solid #cbd5e1",
            borderRadius: "12px",
            background: "white",
            fontWeight: 700,
            cursor: "pointer",
            marginBottom: "24px",
          }}
        >
          返回
        </button>
      )}

      <section
        style={{
          background: "white",
          border: "1px solid #e2e8f0",
          borderRadius: "24px",
          padding: "28px",
          boxShadow: "0 14px 38px rgba(15, 23, 42, 0.06)",
          textAlign: "left",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "16px",
            alignItems: "flex-start",
            marginBottom: "24px",
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: "30px" }}>
              {[item.display_date || "No date", topic].filter(Boolean).join(" ")}
            </h1>
            <p style={{ margin: "8px 0 0", color: "#64748b", fontWeight: 800 }}>
              {type === "sentence"
                ? "Build a Sentence"
                : type === "email"
                  ? "Email Writing"
                  : "Academic Discussion"}
            </p>
          </div>

          {category && (
            <span
              style={{
                padding: "6px 12px",
                borderRadius: "8px",
                background: "#eef8f8",
                color: "#00756f",
                fontWeight: 800,
              }}
            >
              {category}
            </span>
          )}
        </div>

        {type === "sentence" && question && (
          <div
            style={{
              fontSize: "20px",
              lineHeight: 1.9,
              fontWeight: 700,
              color: "#111827",
            }}
          >
            <div>
              {question.contextSpeaker}: {question.contextSentence}
            </div>
            <div>
              {question.answerSpeaker}:{" "}
              {question.parts.map((part, index) =>
                part.type === "fixed" ? (
                  <span key={`fixed-${index}`}>{part.text} </span>
                ) : (
                  <span
                    key={`blank-${index}`}
                    style={{
                      display: "inline-block",
                      width: "110px",
                      borderBottom: "2px solid #111827",
                      margin: "0 8px",
                      transform: "translateY(-4px)",
                    }}
                  />
                )
              )}
            </div>
          </div>
        )}

        {type === "sentence" && !question && task.type === "sentence" && (
          <div
            style={{
              display: "grid",
              gap: "14px",
              color: "#111827",
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: "20px",
                lineHeight: 1.7,
                fontWeight: 800,
              }}
            >
              本 set 共 {task.questions.length} 道造句题，点击开始后按顺序进入练习。
            </p>
            {task.questions.slice(0, 3).map((itemQuestion, index) => (
              <div
                key={`${itemQuestion.contextSentence}-${index}`}
                style={{
                  padding: "14px 16px",
                  border: "1px solid #e2e8f0",
                  borderRadius: "14px",
                  background: "#f8fafc",
                  fontSize: "17px",
                  lineHeight: 1.65,
                  fontWeight: 700,
                }}
              >
                <div>
                  {itemQuestion.contextSpeaker}: {itemQuestion.contextSentence}
                </div>
                <div>
                  {itemQuestion.answerSpeaker}:{" "}
                  {itemQuestion.parts.map((part, partIndex) =>
                    part.type === "fixed" ? (
                      <span key={`fixed-${partIndex}`}>{part.text} </span>
                    ) : (
                      <span
                        key={`blank-${partIndex}`}
                        style={{
                          display: "inline-block",
                          width: "72px",
                          borderBottom: "2px solid #111827",
                          margin: "0 6px",
                          transform: "translateY(-4px)",
                        }}
                      />
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {type === "email" && task.type === "email" && (
          <div style={{ fontSize: "20px", lineHeight: 1.7, color: "#111827" }}>
            <p style={{ marginTop: 0 }}>{task.prompt.scenario}</p>
            <p>
              <strong>{task.prompt.task}</strong>
            </p>
            <ol style={{ paddingLeft: "24px" }}>
              {task.prompt.requirements.map((requirement) => (
                <li key={requirement}>{requirement}</li>
              ))}
            </ol>
            <p>{task.prompt.suggestedLength}</p>
            <div
              style={{
                marginTop: "22px",
                padding: "18px",
                borderRadius: "16px",
                background: "#f8fafc",
                fontWeight: 800,
              }}
            >
              <div>To: {getEmailRecipient(task.prompt)}</div>
              <div>Subject: {getEmailSubject(task.prompt)}</div>
            </div>
          </div>
        )}

        {type === "discussion" && task.type === "discussion" && (
          <div style={{ fontSize: "19px", lineHeight: 1.75, color: "#111827" }}>
            {task.prompt.instruction && (
              <div style={{ whiteSpace: "pre-line", marginBottom: "22px" }}>
                {task.prompt.instruction}
              </div>
            )}
            <strong>{task.prompt.professorName || "Professor"}</strong>
            <p>{task.prompt.professor}</p>
            <div style={{ display: "grid", gap: "12px", marginTop: "18px" }}>
              <div>
                <strong>{task.prompt.studentOneName}</strong>
                <p style={{ margin: 0 }}>{task.prompt.studentOnePost}</p>
              </div>
              <div>
                <strong>{task.prompt.studentTwoName}</strong>
                <p style={{ margin: 0 }}>{task.prompt.studentTwoPost}</p>
              </div>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onStart}
          style={{
            width: "100%",
            marginTop: "28px",
            padding: "16px 22px",
            border: "none",
            borderRadius: "16px",
            background: "#00756f",
            color: "white",
            fontWeight: 900,
            cursor: "pointer",
          }}
        >
          开始练习
        </button>

        <section
          style={{
            marginTop: "22px",
            paddingTop: "20px",
            borderTop: "1px solid #e2e8f0",
          }}
        >
          <h2 style={{ margin: "0 0 12px", fontSize: "20px" }}>回答记录</h2>

          {recordLinks.length === 0 && (
            <p style={{ margin: 0, color: "#64748b", lineHeight: 1.7 }}>
              暂无回答记录。
            </p>
          )}

          {recordLinks.length > 0 && (
            <div style={{ display: "grid", gap: "10px" }}>
              {recordLinks.map((record) => (
                <button
                  key={record.id}
                  type="button"
                  onClick={() => onOpenRecordDetail(record.detail)}
                  onContextMenu={(event) =>
                    onRecordContextMenu(event, {
                      source: record.source,
                      id: record.recordId,
                      label: record.label,
                    })
                  }
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto auto",
                    gap: "12px",
                    alignItems: "center",
                    padding: "13px 14px",
                    borderRadius: "14px",
                    border: "1px solid #e2e8f0",
                    background: "#f8fafc",
                    color: "#111827",
                    cursor: "pointer",
                    fontWeight: 800,
                    textAlign: "left",
                  }}
                >
                  <span style={{ color: "#64748b" }}>
                    {new Date(record.createdAt).toLocaleString()}
                  </span>
                  <span style={{ color: "#312e81" }}>{record.score}</span>
                  <span style={{ color: "#00756f" }}>查看详情</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </section>
    </>
  );
}

function PastExamRecordDetailModal({
  detail,
  onClose,
  onGradeSession,
}: {
  detail: PastExamRecordDetail;
  onClose: () => void;
  onGradeSession: (session: PracticeSession) => Promise<WritingFeedback>;
}) {
  const initialSection =
    detail.kind === "mock-section" ? detail.section : "overview";
  const [activeSection, setActiveSection] = useState<
    "overview" | "sentence" | "email" | "discussion"
  >(initialSection);
  const [sentenceDetailIndex, setSentenceDetailIndex] = useState(0);
  const [isGradingSession, setIsGradingSession] = useState(false);
  const [sessionGradeError, setSessionGradeError] = useState("");
  const [sessionFeedback, setSessionFeedback] =
    useState<WritingFeedback | null>(null);

  useEffect(() => {
    setActiveSection(initialSection);
    setSentenceDetailIndex(0);
    setIsGradingSession(false);
    setSessionGradeError("");
    setSessionFeedback(null);
  }, [detail, initialSection]);

  async function gradeSession(session: PracticeSession) {
    if (!window.confirm("AI智能批改将扣除 2 积分，是否继续？")) return;

    setIsGradingSession(true);
    setSessionGradeError("");
    try {
      const feedback = await onGradeSession(session);
      setSessionFeedback(feedback);
    } catch (error) {
      setSessionGradeError(
        error instanceof Error ? error.message : "AI 批改失败，请稍后重试。"
      );
    } finally {
      setIsGradingSession(false);
    }
  }

  const panelStyle: CSSProperties = {
    background: "white",
    border: "1px solid #e2e8f0",
    borderRadius: "18px",
    padding: "18px",
    marginBottom: "14px",
  };

  function renderAnswerBlock(answer: string) {
    return (
      <pre
        style={{
          whiteSpace: "pre-wrap",
          background: "#f8fafc",
          padding: "16px",
          borderRadius: "14px",
          lineHeight: 1.8,
          border: "1px solid #e2e8f0",
          fontFamily: "inherit",
        }}
      >
        {answer || "No answer"}
      </pre>
    );
  }

  function renderPracticeRecord(record: PracticeRecord) {
    return (
      <>
        <section style={panelStyle}>
          <h2 style={{ marginTop: 0 }}>
            {record.practice_type === "email"
              ? "Email Writing"
              : "Academic Discussion"}
          </h2>
          <div style={{ color: "#64748b", lineHeight: 1.8 }}>
            <div>{new Date(record.created_at).toLocaleString()}</div>
            <div>Score: {record.score}</div>
          </div>
        </section>

        <section style={panelStyle}>
          <h3 style={{ marginTop: 0 }}>Your Answer</h3>
          {renderAnswerBlock(record.answer)}
        </section>

        <section style={panelStyle}>
          <h3 style={{ marginTop: 0 }}>Feedback</h3>
          <FeedbackBox
            score={record.feedback.score}
            strengths={record.feedback.strengths || []}
            problems={record.feedback.problems || []}
            grammarCorrections={record.feedback.grammarCorrections || []}
            actionPlan={record.feedback.actionPlan || []}
            improvedVersion={record.feedback.improvedVersion || ""}
          />
        </section>
      </>
    );
  }

  function renderPracticeSession(session: PracticeSession) {
    const typeLabel =
      session.type === "sentence"
        ? "Build a Sentence"
        : session.type === "email"
          ? "Email Writing"
          : session.type === "discussion"
            ? "Academic Discussion"
            : "完整模考";
    const statusLabel =
      session.score === "未完成"
        ? "未完成"
        : session.score === "未批改"
          ? "等待批改"
          : String(session.score);
    const canGrade =
      session.score === "未批改" &&
      (session.type === "email" || session.type === "discussion") &&
      Boolean(session.prompt) &&
      Boolean(session.answer?.trim());

    return (
      <>
        <section style={panelStyle}>
          <h2 style={{ marginTop: 0 }}>{typeLabel}</h2>
          <div style={{ color: "#64748b", lineHeight: 1.9 }}>
            <div>开始时间：{new Date(session.date).toLocaleString()}</div>
            <div>
              练习状态：{sessionFeedback ? sessionFeedback.score : statusLabel}
            </div>
            <div>练习用时：{formatDuration(session.duration)}</div>
          </div>
          {session.score === "未完成" ? (
            <p style={{ marginBottom: 0, color: "#64748b", lineHeight: 1.7 }}>
              本次练习未提交，因此没有可展示的评分和反馈。
            </p>
          ) : canGrade && !sessionFeedback ? (
            <button
              type="button"
              onClick={() => void gradeSession(session)}
              disabled={isGradingSession}
              style={{
                marginTop: "18px",
                border: "none",
                borderRadius: "10px",
                background: isGradingSession ? "#94a3b8" : "#00756f",
                color: "white",
                padding: "12px 18px",
                fontSize: "16px",
                fontWeight: 900,
                cursor: isGradingSession ? "wait" : "pointer",
              }}
            >
              {isGradingSession ? "AI 正在批改…" : "AI 智能批改"}
            </button>
          ) : !sessionFeedback ? (
            <p style={{ marginBottom: 0, color: "#64748b", lineHeight: 1.7 }}>
              这条旧记录没有保存完整题目和答案，因此无法补批改。
            </p>
          ) : null}
          {sessionGradeError && (
            <p style={{ margin: "14px 0 0", color: "#be123c", lineHeight: 1.6 }}>
              {sessionGradeError}
            </p>
          )}
        </section>

        {session.answer && (
          <section style={panelStyle}>
            <h3 style={{ marginTop: 0 }}>Your Answer</h3>
            {renderAnswerBlock(session.answer)}
          </section>
        )}

        {sessionFeedback && (
          <section style={panelStyle}>
            <h3 style={{ marginTop: 0 }}>Feedback</h3>
            <FeedbackBox
              score={sessionFeedback.score}
              strengths={sessionFeedback.strengths || []}
              problems={sessionFeedback.problems || []}
              grammarCorrections={sessionFeedback.grammarCorrections || []}
              actionPlan={sessionFeedback.actionPlan || []}
              improvedVersion={sessionFeedback.improvedVersion || ""}
            />
          </section>
        )}
      </>
    );
  }

  function renderSentenceRecord(record: MockRecord, questions?: Question[]) {
    const selectedKeys = questions?.length
      ? new Set(questions.map((question) => getSentenceQuestionKey(question)))
      : null;
    const visibleQuestions = (record.sentence_questions || []).filter(
      (question) =>
        !selectedKeys || selectedKeys.has(getSentenceQuestionKey(question))
    );
    const currentIndex = Math.min(
      sentenceDetailIndex,
      Math.max(0, visibleQuestions.length - 1)
    );
    const question = visibleQuestions[currentIndex];

    function getQuestionResult(item: Question) {
      const userChunks =
        record.sentence_answers[String(item.id)] ||
        record.sentence_answers[item.id] ||
        [];
      const slots = Array.isArray(userChunks)
        ? userChunks.map((text, slotIndex) => ({
            id: `past-detail-${item.id}-${slotIndex}`,
            text,
          }))
        : [];
      const userAnswer = buildFullAnswerFromSlots(item, slots);
      const correctAnswer = item.target || renderFullAnswer(item);

      return {
        userAnswer,
        correctAnswer,
        isCorrect:
          normalizeSentenceText(userAnswer) ===
          normalizeSentenceText(correctAnswer),
      };
    }

    const currentResult = question
      ? getQuestionResult(question)
      : { userAnswer: "", correctAnswer: "", isCorrect: false };

    return (
      <>
        <section style={panelStyle}>
          <h2 style={{ marginTop: 0 }}>Build a Sentence</h2>
          <div style={{ color: "#64748b", lineHeight: 1.8 }}>
            <div>{new Date(record.created_at).toLocaleString()}</div>
            <div>Score: {Number(record.sentence_score).toFixed(1)} / 10.0</div>
          </div>
        </section>

        {visibleQuestions.length > 0 ? (
          <>
            <nav
              aria-label="造句题目切换"
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "8px",
                marginBottom: "14px",
              }}
            >
              {visibleQuestions.map((item, index) => {
                const itemIsCorrect = getQuestionResult(item).isCorrect;
                const resultStyle = itemIsCorrect
                  ? {
                      background: "#eef8f1",
                      border: "#a8d8b5",
                      color: "#286840",
                    }
                  : {
                      background: "#fff2f2",
                      border: "#edbcbc",
                      color: "#a04444",
                    };

                return (
                  <button
                    key={`${item.id}-${index}`}
                    type="button"
                    aria-label={`查看第 ${index + 1} 题，${
                      itemIsCorrect ? "正确" : "错误"
                    }`}
                    aria-current={currentIndex === index ? "page" : undefined}
                    onClick={() => setSentenceDetailIndex(index)}
                    style={{
                      width: "38px",
                      height: "38px",
                      borderRadius: "10px",
                      border: `1px solid ${resultStyle.border}`,
                      background: resultStyle.background,
                      color: resultStyle.color,
                      boxShadow:
                        currentIndex === index
                          ? "0 0 0 2px white, 0 0 0 4px #7771c8"
                          : "none",
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    {index + 1}
                  </button>
                );
              })}
            </nav>

            <section key={`${question.id}-${currentIndex}`} style={panelStyle}>
              <h3 style={{ marginTop: 0 }}>
                Question {currentIndex + 1} · {currentResult.isCorrect ? "Correct" : "Incorrect"}
              </h3>
              <p style={{ lineHeight: 1.7 }}>
                <strong>{question.contextSpeaker}:</strong>{" "}
                {question.contextSentence}
              </p>
              <p style={{ lineHeight: 1.7 }}>
                <strong>Your answer:</strong>{" "}
                {currentResult.userAnswer || (
                  <span style={{ color: "#be123c" }}>No answer</span>
                )}
              </p>
              <p style={{ lineHeight: 1.7 }}>
                <strong>Correct answer:</strong> {currentResult.correctAnswer}
              </p>
              {question.explanation && (
                <p style={{ color: "#64748b", lineHeight: 1.7, marginBottom: 0 }}>
                  {question.explanation}
                </p>
              )}
            </section>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "12px",
              }}
            >
              <button
                type="button"
                disabled={currentIndex === 0}
                onClick={() =>
                  setSentenceDetailIndex((index) => Math.max(0, index - 1))
                }
                style={{
                  border: "1px solid #cbd5e1",
                  borderRadius: "10px",
                  background: currentIndex === 0 ? "#f1f5f9" : "white",
                  color: currentIndex === 0 ? "#94a3b8" : "#35307d",
                  padding: "10px 16px",
                  fontWeight: 850,
                  cursor: currentIndex === 0 ? "not-allowed" : "pointer",
                }}
              >
                上一题
              </button>
              <button
                type="button"
                disabled={currentIndex === visibleQuestions.length - 1}
                onClick={() =>
                  setSentenceDetailIndex((index) =>
                    Math.min(visibleQuestions.length - 1, index + 1)
                  )
                }
                style={{
                  border: "1px solid #35307d",
                  borderRadius: "10px",
                  background:
                    currentIndex === visibleQuestions.length - 1
                      ? "#f1f5f9"
                      : "#35307d",
                  color:
                    currentIndex === visibleQuestions.length - 1
                      ? "#94a3b8"
                      : "white",
                  padding: "10px 16px",
                  fontWeight: 850,
                  cursor:
                    currentIndex === visibleQuestions.length - 1
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                下一题
              </button>
            </div>
          </>
        ) : (
          <section style={panelStyle}>暂无可展示的造句题目。</section>
        )}
      </>
    );
  }

  function renderMockWritingSection(
    record: MockRecord,
    section: "email" | "discussion"
  ) {
    const score = section === "email" ? record.email_score : record.discussion_score;
    const answer =
      section === "email" ? record.email_answer : record.discussion_answer;
    const feedback =
      section === "email" ? record.email_feedback : record.discussion_feedback;

    return (
      <>
        <section style={panelStyle}>
          <h2 style={{ marginTop: 0 }}>
            {section === "email" ? "Email Writing" : "Academic Discussion"}
          </h2>
          <div style={{ color: "#64748b", lineHeight: 1.8 }}>
            <div>{new Date(record.created_at).toLocaleString()}</div>
            <div>Score: {score}</div>
          </div>
        </section>

        <section style={panelStyle}>
          <h3 style={{ marginTop: 0 }}>Your Answer</h3>
          {renderAnswerBlock(answer)}
        </section>

        <section style={panelStyle}>
          <h3 style={{ marginTop: 0 }}>Feedback</h3>
          <FeedbackBox
            score={feedback.score}
            strengths={feedback.strengths || []}
            problems={feedback.problems || []}
            grammarCorrections={feedback.grammarCorrections || []}
            actionPlan={feedback.actionPlan || []}
            improvedVersion={feedback.improvedVersion || ""}
          />
        </section>
      </>
    );
  }

  function renderMockRecord(record: MockRecord, sentenceQuestions?: Question[]) {
    if (activeSection === "overview") {
      const recordedScoreLines = [
        hasRecordedSentenceSection(record)
          ? `Build a Sentence: ${Number(record.sentence_score).toFixed(1)} / 10.0`
          : null,
        !isSkippedWritingFeedback(record.email_feedback)
          ? `Email Writing: ${record.email_score}`
          : null,
        !isSkippedWritingFeedback(record.discussion_feedback)
          ? `Academic Discussion: ${record.discussion_score}`
          : null,
      ].filter((line): line is string => Boolean(line));

      return (
        <section style={panelStyle}>
          <h2 style={{ marginTop: 0 }}>
            {recordedScoreLines.length === 3 ? "完整练习记录" : "组合练习记录"}
          </h2>
          <div style={{ color: "#64748b", lineHeight: 1.9 }}>
            <div>{new Date(record.created_at).toLocaleString()}</div>
            <div>Final: {Number(record.final_score).toFixed(1)} / 6.0</div>
            {recordedScoreLines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        </section>
      );
    }

    if (activeSection === "sentence") {
      return renderSentenceRecord(record, sentenceQuestions);
    }

    return renderMockWritingSection(record, activeSection);
  }

  const mockRecord =
    detail.kind === "mock-section" || detail.kind === "mock-full"
      ? detail.record
      : null;
  const showTabs = detail.kind === "mock-full";
  const mockRecordTabs = mockRecord
    ? [
        ["overview", "总览"],
        hasRecordedSentenceSection(mockRecord) ? ["sentence", "造句"] : null,
        !isSkippedWritingFeedback(mockRecord.email_feedback)
          ? ["email", "邮件"]
          : null,
        !isSkippedWritingFeedback(mockRecord.discussion_feedback)
          ? ["discussion", "讨论"]
          : null,
      ].filter((tab): tab is string[] => Boolean(tab))
    : [];

  return (
    <div
      className="record-detail-overlay"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 900,
        background: "rgba(15, 23, 42, 0.45)",
        padding: "24px",
        overflow: "auto",
      }}
      onClick={onClose}
    >
      <main
        className="record-detail-surface"
        style={{
          width: "min(960px, 100%)",
          margin: "0 auto",
          background: "#ffffff",
          borderRadius: "24px",
          padding: "24px",
          boxShadow: "0 26px 80px rgba(15, 23, 42, 0.24)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "14px",
            alignItems: "center",
            marginBottom: "18px",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "26px" }}>回答详情</h1>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "1px solid #cbd5e1",
              borderRadius: "12px",
              background: "white",
              padding: "9px 14px",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            关闭
          </button>
        </div>

        {showTabs && (
          <div
            style={{
              display: "flex",
              gap: "10px",
              flexWrap: "wrap",
              marginBottom: "16px",
            }}
          >
            {mockRecordTabs.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() =>
                  setActiveSection(
                    value as "overview" | "sentence" | "email" | "discussion"
                  )
                }
                style={{
                  padding: "9px 13px",
                  borderRadius: "999px",
                  border:
                    activeSection === value
                      ? "1px solid #00756f"
                      : "1px solid #cbd5e1",
                  background: activeSection === value ? "#00756f" : "white",
                  color: activeSection === value ? "white" : "#111827",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {detail.kind === "practice" && renderPracticeRecord(detail.record)}
        {detail.kind === "session" && renderPracticeSession(detail.session)}
        {detail.kind === "mock-section" &&
          renderMockRecord(detail.record, detail.sentenceQuestions)}
        {detail.kind === "mock-full" && mockRecord && renderMockRecord(mockRecord)}
      </main>
    </div>
  );
}

function PastExamDateGroup({
  date,
  count,
  unit,
  expanded,
  onToggle,
  children,
}: {
  date: string;
  count: number;
  unit: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section
      className="question-bank-date-group"
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: "18px",
        background: "white",
        overflow: "hidden",
        boxShadow: "0 10px 26px rgba(15, 23, 42, 0.045)",
      }}
    >
      <button
        className="question-bank-date-trigger"
        type="button"
        onClick={onToggle}
        style={{
          width: "100%",
          border: "none",
          background: expanded ? "#f8fafc" : "white",
          padding: "14px 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "14px",
          cursor: "pointer",
          color: "#111827",
          textAlign: "left",
        }}
      >
        <span
          style={{
            fontSize: "20px",
            fontWeight: 900,
            lineHeight: 1.2,
          }}
        >
          {date}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "10px",
            color: "#64748b",
            fontSize: "14px",
            fontWeight: 800,
            whiteSpace: "nowrap",
          }}
        >
          {count} {unit}
          <span
            className="question-bank-row-arrow"
            style={{ color: "#00756f", fontSize: "18px" }}
          >
            {expanded ? "⌃" : "⌄"}
          </span>
        </span>
      </button>

      {expanded && (
        <div
          style={{
            display: "grid",
            gap: "8px",
            padding: "8px",
            background: "#f8fafc",
          }}
        >
          {children}
        </div>
      )}
    </section>
  );
}

function PastExamMonthGroup({
  month,
  count,
  unit,
  expanded,
  onToggle,
  children,
}: {
  month: string;
  count: number;
  unit: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section
      className="question-bank-month-group"
      style={{
        border: `1px solid ${expanded ? "#b9b7dd" : "#d6d8e5"}`,
        borderRadius: "20px",
        background: "white",
        overflow: "hidden",
        boxShadow: expanded
          ? "0 14px 34px rgba(53, 48, 125, 0.1)"
          : "0 10px 26px rgba(15, 23, 42, 0.045)",
      }}
    >
      <button
        className="question-bank-month-trigger"
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        style={{
          width: "100%",
          border: "none",
          background: expanded ? "#f4f4ff" : "white",
          padding: "18px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "16px",
          cursor: "pointer",
          color: "#111827",
          textAlign: "left",
        }}
      >
        <span style={{ fontSize: "22px", fontWeight: 900, lineHeight: 1.2 }}>
          {month}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "12px",
            color: "#68708a",
            fontSize: "14px",
            fontWeight: 850,
            whiteSpace: "nowrap",
          }}
        >
          {count} {unit}
          <span
            className="question-bank-row-arrow"
            aria-hidden="true"
            style={{ color: "#35307d", fontSize: "20px", lineHeight: 1 }}
          >
            {expanded ? "⌃" : "⌄"}
          </span>
        </span>
      </button>

      {expanded && (
        <div
          style={{
            display: "grid",
            gap: "10px",
            padding: "12px",
            background: "#f8fafc",
          }}
        >
          {children}
        </div>
      )}
    </section>
  );
}

function PastExamListCard({
  date,
  topic,
  category,
  bestScore,
  onClick,
}: {
  date: string;
  topic: string;
  category?: string;
  bestScore?: number;
  onClick: () => void;
}) {
  return (
    <button
      className="question-bank-list-card"
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        background: "white",
        border: "1px solid #eef2f7",
        borderRadius: "18px",
        padding: "14px 20px",
        minHeight: "58px",
        boxShadow: "0 10px 24px rgba(15, 23, 42, 0.05)",
        cursor: "pointer",
        textAlign: "left",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "14px",
      }}
    >
      <h3
        style={{
          margin: 0,
          fontSize: "19px",
          lineHeight: 1.2,
          fontWeight: 900,
          color: "#1f2937",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {[date, topic].filter(Boolean).join(" ")}
      </h3>

      <span
        style={{
          display: "inline-flex",
          flex: "0 0 auto",
          alignItems: "center",
          gap: "8px",
        }}
      >
        {category && (
          <span
            style={{
              display: "inline-flex",
              padding: "5px 10px",
              borderRadius: "8px",
              background: "#eef8f8",
              color: "#00756f",
              fontWeight: 800,
              fontSize: "13px",
              lineHeight: 1.2,
              whiteSpace: "nowrap",
            }}
          >
            {category}
          </span>
        )}

        {typeof bestScore === "number" && (
          <span
            style={{
              display: "inline-flex",
              padding: "5px 10px",
              borderRadius: "8px",
              background: "#f1f5f9",
              color: "#334155",
              fontWeight: 900,
              fontSize: "13px",
              lineHeight: 1.2,
              whiteSpace: "nowrap",
            }}
          >
            {bestScore.toFixed(1)}
          </span>
        )}
        {typeof bestScore !== "number" && (
          <span
            aria-hidden="true"
            style={{
              display: "inline-flex",
              width: "42px",
              height: "25px",
              flex: "0 0 42px",
            }}
          />
        )}
      </span>
    </button>
  );
}

function getQuestionSetTaskByType(
  questionSet: QuestionSet | null,
  type: PastExamPracticeType
) {
  const tasks = Array.isArray(questionSet?.content.tasks)
    ? questionSet.content.tasks
    : [];

  return tasks.find((task) => task.type === type) || null;
}

function isMockRecordForQuestionSet(record: MockRecord, questionSet: QuestionSet) {
  const sentenceTask = getQuestionSetTaskByType(questionSet, "sentence");
  const emailTask = getQuestionSetTaskByType(questionSet, "email");
  const discussionTask = getQuestionSetTaskByType(questionSet, "discussion");

  if (
    sentenceTask?.type !== "sentence" ||
    emailTask?.type !== "email" ||
    discussionTask?.type !== "discussion"
  ) {
    return false;
  }

  return (
    getSentenceSetKey(record.sentence_questions || []) ===
      getSentenceSetKey(sentenceTask.questions) &&
    getPromptScoreKey("email", record.email_prompt) ===
      getPromptScoreKey("email", emailTask.prompt) &&
    getPromptScoreKey("discussion", record.discussion_prompt) ===
      getPromptScoreKey("discussion", discussionTask.prompt)
  );
}

function isMockRecordFromQuestionSets(
  record: MockRecord,
  questionSets: QuestionSet[]
) {
  const sentenceKeys = new Set(
    questionSets.flatMap((questionSet) => {
      const task = getQuestionSetTaskByType(questionSet, "sentence");
      return task?.type === "sentence"
        ? task.questions.map((question) => getSentenceQuestionKey(question))
        : [];
    })
  );
  const emailKeys = new Set(
    questionSets.flatMap((questionSet) => {
      const task = getQuestionSetTaskByType(questionSet, "email");
      return task?.type === "email" ? [getPromptScoreKey("email", task.prompt)] : [];
    })
  );
  const discussionKeys = new Set(
    questionSets.flatMap((questionSet) => {
      const task = getQuestionSetTaskByType(questionSet, "discussion");
      return task?.type === "discussion"
        ? [getPromptScoreKey("discussion", task.prompt)]
        : [];
    })
  );
  const recordQuestions = record.sentence_questions || [];

  return (
    isCompleteMockRecord(record) &&
    recordQuestions.length > 0 &&
    recordQuestions.every((question) =>
      sentenceKeys.has(getSentenceQuestionKey(question))
    ) &&
    emailKeys.has(getPromptScoreKey("email", record.email_prompt)) &&
    discussionKeys.has(getPromptScoreKey("discussion", record.discussion_prompt))
  );
}

function EtsMockPracticePage({
  items,
  practicedIds,
  unlockedIds,
  mockRecords,
  isLoading,
  message,
  onBackHome,
  onPreview,
  onRandomPractice,
  onOpenRecordDetail,
  onRecordContextMenu,
}: {
  items: QuestionSet[];
  practicedIds: string[];
  unlockedIds: string[];
  mockRecords: MockRecord[];
  isLoading: boolean;
  message: string;
  onBackHome: () => void;
  onPreview: (id: string) => void;
  onRandomPractice: () => void;
  onOpenRecordDetail: (detail: PastExamRecordDetail) => void;
  onRecordContextMenu: (
    event: MouseEvent<HTMLElement>,
    target: DeleteRecordTarget
  ) => void;
}) {
  const [completionFilter, setCompletionFilter] =
    useState<"all" | "done" | "undone">("all");
  const unlockedItems = items.filter((item) => unlockedIds.includes(item.id));
  const filteredItems = items.filter((item) => {
    if (completionFilter === "all") return true;
    const done = practicedIds.includes(item.id);
    return completionFilter === "done" ? done : !done;
  });
  const randomRecordLinks = mockRecords
    .filter((record) => {
      if (!isMockRecordFromQuestionSets(record, unlockedItems)) return false;

      return !unlockedItems.some((item) => isMockRecordForQuestionSet(record, item));
    })
    .map((record) => ({
      id: record.id,
      createdAt: record.created_at,
      finalScore: Number(record.final_score),
      sentenceScore: Number(record.sentence_score),
      emailScore: record.email_score,
      discussionScore: record.discussion_score,
      detail: {
        kind: "mock-full" as const,
        record,
      },
    }))
    .sort(
      (left, right) =>
        Date.parse(right.createdAt || "") - Date.parse(left.createdAt || "")
    );

  return (
    <>
      <button
        type="button"
        onClick={onBackHome}
        style={{
          padding: "10px 16px",
          border: "1px solid #cbd5e1",
          borderRadius: "12px",
          background: "white",
          fontWeight: 700,
          cursor: "pointer",
          marginBottom: "24px",
        }}
      >
        返回首页
      </button>

      <section
        style={{
          background: "white",
          border: "1px solid #e2e8f0",
          borderRadius: "20px",
          padding: "24px",
          marginBottom: "24px",
          boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
        }}
      >
        <h1 style={{ marginTop: 0 }}>ETS Mock Practice</h1>
        <p style={{ color: "#64748b", lineHeight: 1.8 }}>
          ETS 风格模拟练习。可以选择一整套题练习，也可以从已解锁套题中随机拼成一套完整练习。
        </p>
        <button
          type="button"
          onClick={onRandomPractice}
          disabled={isLoading || unlockedItems.length === 0}
          style={{
            padding: "13px 20px",
            border: "none",
            borderRadius: "14px",
            background: isLoading || unlockedItems.length === 0 ? "#cbd5e1" : "#111827",
            color: "white",
            fontWeight: 900,
            cursor: isLoading || unlockedItems.length === 0 ? "not-allowed" : "pointer",
            marginTop: "12px",
          }}
        >
          随机拼题练习
        </button>
      </section>

      {isLoading && <p style={{ color: "#64748b" }}>Loading question sets...</p>}
      {message && <p style={{ color: "#be123c", fontWeight: 700 }}>{message}</p>}
      {!isLoading && items.length === 0 && (
        <p style={{ color: "#64748b" }}>No mock practice sets available yet.</p>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: "10px",
          flexWrap: "wrap",
          marginBottom: "14px",
        }}
      >
        {([
          ["all", "全部"],
          ["done", "已做过"],
          ["undone", "未做过"],
        ] as const).map(([value, label]) => {
          const active = completionFilter === value;

          return (
            <button
              key={value}
              type="button"
              onClick={() => setCompletionFilter(value)}
              style={{
                padding: "8px 14px",
                border: active
                  ? "1px solid #00756f"
                  : "1px solid #cbd5e1",
                borderRadius: "999px",
                background: active ? "#00756f" : "white",
                color: active ? "white" : "#111827",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div style={{ display: "grid", gap: "12px" }}>
        {filteredItems.map((item) => {
          const practiced = practicedIds.includes(item.id);
          const unlocked = unlockedIds.includes(item.id);
          const sentenceTask = getQuestionSetTaskByType(item, "sentence");
          const sentenceCount =
            sentenceTask?.type === "sentence" ? sentenceTask.questions.length : 0;

          return (
            <button
              type="button"
              key={item.id}
              onClick={() => onPreview(item.id)}
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 1fr auto",
                gap: "16px",
                alignItems: "center",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: "18px",
                padding: "18px 20px",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <div>
                <strong>{item.title}</strong>
                <div
                  style={{
                    color: "#64748b",
                    fontSize: "14px",
                    fontWeight: 800,
                    marginTop: "6px",
                  }}
                >
                  {sentenceCount} 造句题 · Email Writing · Academic Discussion
                </div>
              </div>

              <span
                style={{
                  color: unlocked
                    ? practiced
                      ? "#166534"
                      : "#64748b"
                    : "#b91c1c",
                  fontWeight: 800,
                }}
              >
                {unlocked
                  ? practiced
                    ? "已练习"
                    : "未练习"
                  : "未解锁 · 2元/套题"}
              </span>

              <span style={{ color: "#00756f", fontWeight: 900 }}>
                查看套题
              </span>
            </button>
          );
        })}
        {!isLoading && items.length > 0 && filteredItems.length === 0 && (
          <div
            style={{
              padding: "18px 20px",
              border: "1px solid #e2e8f0",
              borderRadius: "18px",
              background: "#f8fafc",
              color: "#64748b",
              fontWeight: 700,
            }}
          >
            暂无符合筛选条件的套题。
          </div>
        )}
      </div>

      <section
        style={{
          marginTop: "26px",
          padding: "22px",
          borderRadius: "20px",
          border: "1px solid #e2e8f0",
          background: "white",
          boxShadow: "0 10px 30px rgba(15, 23, 42, 0.05)",
        }}
      >
        <h2 style={{ margin: "0 0 14px", fontSize: "22px" }}>
          随机拼题记录
        </h2>

        {randomRecordLinks.length === 0 && (
          <p style={{ margin: 0, color: "#64748b", lineHeight: 1.7 }}>
            暂无随机拼题记录。
          </p>
        )}

        {randomRecordLinks.length > 0 && (
          <div style={{ display: "grid", gap: "10px" }}>
            {randomRecordLinks.map((record) => (
              <button
                key={record.id}
                type="button"
                onClick={() => onOpenRecordDetail(record.detail)}
                onContextMenu={(event) =>
                  onRecordContextMenu(event, {
                    source: "mock",
                    id: record.id,
                    label: "随机拼题模考",
                  })
                }
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto auto",
                  gap: "14px",
                  alignItems: "center",
                  padding: "14px 16px",
                  borderRadius: "14px",
                  border: "1px solid #e2e8f0",
                  background: "#f8fafc",
                  color: "#111827",
                  cursor: "pointer",
                  fontWeight: 800,
                  textAlign: "left",
                }}
              >
                <span style={{ color: "#64748b" }}>
                  {new Date(record.createdAt).toLocaleString()}
                </span>
                <span style={{ color: "#312e81" }}>
                  Final{" "}
                  {Number.isNaN(record.finalScore)
                    ? "-"
                    : record.finalScore.toFixed(1)}{" "}
                  / 6.0
                </span>
                <span style={{ color: "#64748b", fontSize: "14px" }}>
                  Sentence{" "}
                  {Number.isNaN(record.sentenceScore)
                    ? "-"
                    : record.sentenceScore.toFixed(1)}{" "}
                  · Email {record.emailScore} · Discussion {record.discussionScore}
                </span>
                <span style={{ color: "#00756f" }}>查看详情</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </>

  );
}

function EtsStylePreviewPage({
  initialPage,
  initialLibraryTab,
  initialPastBank,
  initialTopicFilter,
  initialCompletionFilter,
  initialSortOrder,
  initialBankPage,
  initialPastSearchType,
  initialPastSearchInput,
  initialAppliedPastSearch,
  user,
  isPro,
  subscriptionExpiresAt,
  hasQuestionBankAccess,
  unlockedEtsMockIds,
  points,
  temporaryPoints,
  permanentPoints,
  creditCheckInDates,
  claimedCreditMilestones,
  onClaimDailyCredit,
  onRedeemCode,
  records,
  mockRecords,
  practiceSessions,
  pastExamSets,
  etsMockSets,
  bestScores,
  sentenceBestScores,
  practiceTimerMode,
  setPracticeTimerMode,
  authEmail,
  authPassword,
  authMessage,
  isAuthLoading,
  showForgotPassword,
  forgotPasswordEmail,
  isPasswordRecovery,
  newPassword,
  newPasswordConfirm,
  setAuthEmail,
  setAuthPassword,
  setShowForgotPassword,
  setForgotPasswordEmail,
  setNewPassword,
  setNewPasswordConfirm,
  onSignIn,
  onSignUp,
  onSignOut,
  onSendPasswordReset,
  onUpdatePassword,
  onStartSelectedPractice,
  onStartPersonalizedPractice,
  onStartPastExamRandom,
  onOpenPastExamSelection,
  onOpenEtsMockSet,
  onStartEtsMockRandom,
  onOpenRecordDetail,
  onRecordContextMenu,
}: {
  initialPage: EtsStylePreviewPageKey;
  initialLibraryTab: "past" | "mock";
  initialPastBank: PastExamPracticeType | null;
  initialTopicFilter: string;
  initialCompletionFilter: "all" | "done" | "undone";
  initialSortOrder: "desc" | "asc";
  initialBankPage: number;
  initialPastSearchType: EtsStylePastSearchType;
  initialPastSearchInput: string;
  initialAppliedPastSearch: string;
  user: User | null;
  isPro: boolean;
  subscriptionExpiresAt: string | null;
  hasQuestionBankAccess: boolean;
  unlockedEtsMockIds: string[];
  points: number;
  temporaryPoints: number;
  permanentPoints: number;
  creditCheckInDates: string[];
  claimedCreditMilestones: number[];
  onClaimDailyCredit: () => Promise<void>;
  onRedeemCode: (code: string) => Promise<RedeemResult>;
  records: PracticeRecord[];
  mockRecords: MockRecord[];
  practiceSessions: PracticeSession[];
  pastExamSets: QuestionSet[];
  etsMockSets: QuestionSet[];
  bestScores: Map<string, number>;
  sentenceBestScores: Map<string, number>;
  practiceTimerMode: "countup" | "countdown";
  setPracticeTimerMode: (mode: "countup" | "countdown") => void;
  authEmail: string;
  authPassword: string;
  authMessage: string;
  isAuthLoading: boolean;
  showForgotPassword: boolean;
  forgotPasswordEmail: string;
  isPasswordRecovery: boolean;
  newPassword: string;
  newPasswordConfirm: string;
  setAuthEmail: (value: string) => void;
  setAuthPassword: (value: string) => void;
  setShowForgotPassword: (value: boolean) => void;
  setForgotPasswordEmail: (value: string) => void;
  setNewPassword: (value: string) => void;
  setNewPasswordConfirm: (value: string) => void;
  onSignIn: () => void | Promise<void>;
  onSignUp: () => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
  onSendPasswordReset: () => void | Promise<void>;
  onUpdatePassword: () => void | Promise<void>;
  onStartSelectedPractice: (
    selectedTypes: PastExamPracticeType[]
  ) => void | Promise<void>;
  onStartPersonalizedPractice: (
    selectedTypes: PersonalizedTaskType[],
    preferredFocus?: {
      taskType: PersonalizedTaskType;
      topic: string;
    } | null
  ) => boolean | Promise<boolean>;
  onStartPastExamRandom: (options: PastExamRandomOptions) => void | Promise<void>;
  onOpenPastExamSelection: (
    selection: PastExamPreviewSelection,
    restoreState?: EtsStylePreviewRestoreState
  ) => void;
  onOpenEtsMockSet: (
    id: string,
    restoreState?: EtsStylePreviewRestoreState
  ) => void;
  onStartEtsMockRandom: (
    options: PastExamRandomOptions
  ) => void | Promise<void>;
  onOpenRecordDetail: (detail: PastExamRecordDetail) => void;
  onRecordContextMenu: (
    event: MouseEvent<HTMLElement>,
    target: DeleteRecordTarget
  ) => void;
}) {
  const shell = "#f8f9ff";
  const ink = "#171c2d";
  const muted = "#68708a";
  const accent = "#35307d";
  const examGreen = "#00756f";
  const line = "#d6d8e5";
  const active = "#eef0ff";
  const softRadius = "6px";
  const sideWidth = "190px";
  const checkInMilestones = [
    { days: 7, bonus: 2 },
    { days: 14, bonus: 4 },
    { days: 21, bonus: 6 },
    { days: 28, bonus: 8 },
  ];
  const [previewPage, setPreviewPage] =
    useState<EtsStylePreviewPageKey>(initialPage);
  const [redeemCodeInput, setRedeemCodeInput] = useState("");
  const [redeemMessage, setRedeemMessage] = useState("");
  const [redeemSucceeded, setRedeemSucceeded] = useState(false);
  const [isRedeemingCode, setIsRedeemingCode] = useState(false);
  const [redeemCelebrationId, setRedeemCelebrationId] = useState(0);
  const redeemCelebrationTimerRef = useRef<number | null>(null);
  const redeemInputRef = useRef<HTMLInputElement>(null);
  const [libraryTab, setLibraryTab] =
    useState<"past" | "mock">(initialLibraryTab);
  const [etsMockLibrarySection, setEtsMockLibrarySection] =
    useState<"tpo" | "mock">("tpo");
  const [previewPastBank, setPreviewPastBank] =
    useState<PastExamPracticeType | null>(initialPastBank);
  const [previewTopicFilter, setPreviewTopicFilter] =
    useState(initialTopicFilter);
  const [previewCompletionFilter, setPreviewCompletionFilter] =
    useState<"all" | "done" | "undone">(initialCompletionFilter);
  const [etsMockCompletionFilter, setEtsMockCompletionFilter] =
    useState<"all" | "done" | "undone">("all");
  const [previewSortOrder, setPreviewSortOrder] = useState<"desc" | "asc">(
    initialSortOrder
  );
  const [previewBankPage, setPreviewBankPage] = useState(
    Math.max(1, initialBankPage)
  );
  const [previewExpandedMonths, setPreviewExpandedMonths] = useState<string[]>(
    []
  );
  const [previewExpandedDates, setPreviewExpandedDates] = useState<string[]>([]);
  const [pastSearchType, setPastSearchType] =
    useState<EtsStylePastSearchType>(initialPastSearchType);
  const [pastSearchInput, setPastSearchInput] =
    useState(initialPastSearchInput);
  const [appliedPastSearch, setAppliedPastSearch] = useState(
    initialAppliedPastSearch
  );
  const [previewRandomModal, setPreviewRandomModal] = useState<
    "past" | "mock" | null
  >(null);
  const [showAiPracticeSelector, setShowAiPracticeSelector] = useState(false);
  const [showPersonalizedPracticeSelector, setShowPersonalizedPracticeSelector] =
    useState(false);
  const [selectedPersonalizedTypes, setSelectedPersonalizedTypes] = useState<
    PersonalizedTaskType[]
  >(["email", "discussion"]);
  const [personalizedPreferredFocus, setPersonalizedPreferredFocus] = useState<{
    taskType: PersonalizedTaskType;
    topic: string;
  } | null>(null);
  const [isStartingPersonalizedPractice, setIsStartingPersonalizedPractice] =
    useState(false);
  const [personalizedProfile, setPersonalizedProfile] =
    useState<PersonalizedProfile | null>(null);
  useEffect(() => {
    if (!user || !isPro) return;
    let cancelled = false;
    void requestPersonalizedPractice({ action: "profile" })
      .then((result) => {
        if (!cancelled) setPersonalizedProfile(result.profile || null);
      })
      .catch((error) => {
        if (!cancelled) console.error("Failed to load personalized profile", error);
      });
    return () => {
      cancelled = true;
    };
  }, [user, isPro]);
  const [selectedAiPracticeTypes, setSelectedAiPracticeTypes] = useState<
    PastExamPracticeType[]
  >(["sentence", "email", "discussion"]);
  const [previewRandomTypes, setPreviewRandomTypes] = useState<
    PastExamPracticeType[]
  >(["sentence"]);
  const [previewPastRandomMode, setPreviewPastRandomMode] = useState<
    "custom" | "exam_set"
  >("custom");
  const [aiRecordTypeFilters, setAiRecordTypeFilters] = useState<
    ("mock" | "sentence" | "email" | "discussion")[]
  >(["mock", "sentence", "email", "discussion"]);
  const [aiRecordSortMode, setAiRecordSortMode] = useState<
    "time-desc" | "time-asc" | "score-desc" | "score-asc"
  >("time-desc");
  const [aiRecordPage, setAiRecordPage] = useState(1);
  const [pastRecordTypeFilters, setPastRecordTypeFilters] = useState<
    ("mock" | "sentence" | "email" | "discussion")[]
  >(["mock", "sentence", "email", "discussion"]);
  const [pastRecordSortMode, setPastRecordSortMode] = useState<
    "time-desc" | "time-asc" | "score-desc" | "score-asc"
  >("time-desc");
  const [pastRecordPage, setPastRecordPage] = useState(1);
  const [helpSearchInput, setHelpSearchInput] = useState("");
  const [activeHelpCategory, setActiveHelpCategory] =
    useState("账户与登录");
  const [helpSupportEmail, setHelpSupportEmail] = useState("");
  const [helpSupportMessage, setHelpSupportMessage] = useState("");
  const [isSubmittingSupportRequest, setIsSubmittingSupportRequest] =
    useState(false);
  const [supportFollowUpMessages, setSupportFollowUpMessages] = useState<
    Record<string, string>
  >({});
  const [submittingSupportFollowUpId, setSubmittingSupportFollowUpId] =
    useState("");
  const [helpSupportTickets, setHelpSupportTickets] = useState<
    HelpSupportTicket[]
  >([]);
  const [selectedSupportTicketId, setSelectedSupportTicketId] = useState("");
  const [userNotifications, setUserNotifications] = useState<
    UserNotification[]
  >([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showNotificationDetail, setShowNotificationDetail] = useState(false);
  const [selectedNotificationId, setSelectedNotificationId] = useState("");
  const [notificationPage, setNotificationPage] = useState(1);
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(false);
  const [redemptionHistory, setRedemptionHistory] = useState<
    RedemptionHistoryItem[]
  >([]);
  const savedDailyDetailSlug =
    typeof window !== "undefined"
      ? window.sessionStorage.getItem("forge-daily-detail-slug") || ""
      : "";
  const [dailyView, setDailyView] = useState<"home" | "detail" | "library">(
    initialPage === "daily" && savedDailyDetailSlug ? "detail" : "home"
  );
  const [dailyDetailReturnView, setDailyDetailReturnView] = useState<
    "home" | "library"
  >("home");
  const [selectedDailySlug, setSelectedDailySlug] = useState(
    savedDailyDetailSlug || getTodayDailyArticle()?.slug || dailyArticles[0]?.slug || ""
  );
  const [dailySearchInput, setDailySearchInput] = useState("");
  const [dailyTopicFilter, setDailyTopicFilter] = useState("全部");
  const [dailySortOrder, setDailySortOrder] = useState<"desc" | "asc">("desc");
  const [dailyDetailSection, setDailyDetailSection] = useState<
    "perspectiveA" | "perspectiveB" | "counterargument" | "ideaBank" | "practice"
  >("perspectiveA");
  const [dailyRelatedPage, setDailyRelatedPage] = useState(1);
  const [studyPlanMonth, setStudyPlanMonth] = useState(() => {
    const currentMonth = new Date().getMonth() + 1;
    return Math.min(12, Math.max(7, currentMonth));
  });
  const [selectedStudyPlanDate, setSelectedStudyPlanDate] = useState(() => {
    const today = new Date();
    const currentMonth = Math.min(12, Math.max(7, today.getMonth() + 1));
    const currentDay = currentMonth === today.getMonth() + 1 ? today.getDate() : 1;
    return `2026-${currentMonth}-${currentDay}`;
  });
  const [hoveredStudyPlanDate, setHoveredStudyPlanDate] = useState("");
  const [studyPlanExamDate, setStudyPlanExamDate] = useState("");
  const [studyPlanTargetScore, setStudyPlanTargetScore] = useState("5.0");
  const [isLearningProfileLoaded, setIsLearningProfileLoaded] = useState(!user);
  const [editingStudyPlanScore, setEditingStudyPlanScore] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [isEditingAccountProfile, setIsEditingAccountProfile] = useState(false);
  const [previewBackAvailable, setPreviewBackAvailable] = useState(false);
  const [isPreviewCheckInLoading, setIsPreviewCheckInLoading] = useState(false);
  const [studyPlanContextMenu, setStudyPlanContextMenu] = useState<{
    date: string;
  } | null>(null);
  const [previewSentenceRandomMode, setPreviewSentenceRandomMode] =
    useState<"mixed" | "random_set" | "set">("mixed");
  const [previewSentenceSetId, setPreviewSentenceSetId] = useState("");
  const previewScrollPositionsRef = useRef<Record<EtsStylePreviewPageKey, number>>({
    ai: 0,
    daily: 0,
    library: 0,
    records: 0,
    analytics: 0,
    calendar: 0,
    help: 0,
    support: 0,
    account: 0,
    store: 0,
  });
  const previewPageHistoryRef = useRef<EtsStylePreviewPageKey[]>([]);

  useEffect(() => {
    setPreviewPage(initialPage);
  }, [initialPage]);

  useEffect(() => {
    if (!user) {
      setUserNotifications([]);
      setShowNotifications(false);
      setShowNotificationDetail(false);
      setSelectedNotificationId("");
      setNotificationPage(1);
      return;
    }

    let active = true;
    const userId = user.id;

    async function loadNotifications() {
      setIsLoadingNotifications(true);
      const { data, error } = await supabase
        .from("user_notifications")
        .select("id, kind, title, message, destination, read_at, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100);

      if (!active) return;
      setIsLoadingNotifications(false);
      if (error) {
        console.error("Failed to load notifications:", error);
        return;
      }

      setUserNotifications(
        (data || []).map((item) => ({
          id: item.id,
          kind: item.kind as UserNotification["kind"],
          title: item.title,
          message: item.message,
          destination: item.destination || null,
          createdAt: item.created_at,
          readAt: item.read_at || null,
        }))
      );
    }

    void loadNotifications();
    const channel = supabase
      .channel(`user-notifications-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => void loadNotifications()
      )
      .subscribe();
    const refreshTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadNotifications();
    }, 60_000);

    return () => {
      active = false;
      window.clearInterval(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [user]);

  useEffect(() => {
    return () => {
      if (redeemCelebrationTimerRef.current !== null) {
        window.clearTimeout(redeemCelebrationTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (previewPage !== "calendar") return;

    const today = new Date();
    const currentMonth = Math.min(12, Math.max(7, today.getMonth() + 1));
    const currentDay = currentMonth === today.getMonth() + 1 ? today.getDate() : 1;

    setStudyPlanMonth(currentMonth);
    setSelectedStudyPlanDate(`2026-${currentMonth}-${currentDay}`);
    setHoveredStudyPlanDate("");
    setStudyPlanContextMenu(null);
  }, [previewPage]);

  useEffect(() => {
    const path = window.location.pathname;

    if (path === "/mock-records") {
      goToPastExamRecordSection();
    } else if (path === "/records" || path === "/practice-sessions") {
      goToAiRecordSection();
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setAccountName("");
      setStudyPlanTargetScore("5.0");
      setStudyPlanExamDate("");
      setIsLearningProfileLoaded(true);
      setHelpSupportTickets([]);
      setRedemptionHistory([]);
      return;
    }

    let cancelled = false;
    const userId = user.id;
    const learningProfileCacheKey = `forge-learning-profile:${userId}`;
    setIsLearningProfileLoaded(false);

    try {
      const cachedProfile = JSON.parse(
        window.localStorage.getItem(learningProfileCacheKey) || "null"
      ) as {
        displayName?: string;
        targetScore?: string;
        examDate?: string;
      } | null;

      setAccountName(cachedProfile?.displayName || "");
      setStudyPlanTargetScore(cachedProfile?.targetScore || "5.0");
      setStudyPlanExamDate(cachedProfile?.examDate || "");
    } catch {
      setAccountName("");
      setStudyPlanTargetScore("5.0");
      setStudyPlanExamDate("");
    }

    async function loadAccountData() {
      const [profileResult, ticketResult, redemptionResult] = await Promise.all([
        supabase
          .from("user_learning_profiles")
          .select("display_name, target_score, exam_date")
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("support_tickets")
          .select(
            "id, reply_email, message, status, cycle, support_reply, replied_at, created_at, expires_at, support_ticket_messages(id, sender, message, cycle, created_at)"
          )
          .eq("user_id", userId)
          .order("created_at", { ascending: false }),
        supabase
          .from("redeem_logs")
          .select(
            "id, reward_type, points_added, pro_days, subscription_expires_at, redeemed_at"
          )
          .eq("user_id", userId)
          .order("redeemed_at", { ascending: false }),
      ]);

      if (cancelled) return;

      if (profileResult.error) {
        console.error("Failed to load learning profile:", profileResult.error);
      } else if (profileResult.data) {
        const loadedProfile = {
          displayName: profileResult.data.display_name || "",
          targetScore: Number(
            profileResult.data.target_score || 5
          ).toFixed(1),
          examDate: profileResult.data.exam_date || "",
        };
        setAccountName(loadedProfile.displayName);
        setStudyPlanTargetScore(loadedProfile.targetScore);
        setStudyPlanExamDate(loadedProfile.examDate);
        try {
          window.localStorage.setItem(
            learningProfileCacheKey,
            JSON.stringify(loadedProfile)
          );
        } catch {
          // Database remains the source of truth when browser storage is unavailable.
        }
      }

      setIsLearningProfileLoaded(true);

      if (ticketResult.error) {
        console.error("Failed to load support tickets:", ticketResult.error);
      } else {
        const statusLabels: Record<string, HelpSupportStatus> = {
          sent: "已提交",
          processing: "处理中",
          resolved: "已处理",
          closed: "已完成",
        };
        setHelpSupportTickets(
          (ticketResult.data || []).map((ticket) => ({
            id: ticket.id,
            email: ticket.reply_email,
            message: ticket.message,
            createdAt: ticket.created_at,
            status: statusLabels[ticket.status] || "已提交",
            cycle: Number(ticket.cycle || 1),
            supportReply: ticket.support_reply || "",
            repliedAt: ticket.replied_at || null,
            messages: (ticket.support_ticket_messages || [])
              .map((message) => ({
                id: message.id,
                sender: (message.sender === "support"
                  ? "support"
                  : "user") as HelpSupportMessage["sender"],
                message: message.message,
                cycle: Number(message.cycle || 1),
                createdAt: message.created_at,
              }))
              .sort(
                (left, right) =>
                  Date.parse(left.createdAt) - Date.parse(right.createdAt)
              ),
          }))
        );
      }

      if (redemptionResult.error) {
        console.error(
          "Failed to load redemption history:",
          redemptionResult.error
        );
      } else {
        setRedemptionHistory(
          (redemptionResult.data || []).map((item) => ({
            id: item.id,
            rewardType: item.reward_type === "pro" ? "pro" : "credits",
            creditsAdded: Number(item.points_added || 0),
            proDays: item.pro_days === null ? null : Number(item.pro_days),
            subscriptionExpiresAt: item.subscription_expires_at,
            redeemedAt: item.redeemed_at,
          }))
        );
      }
    }

    void loadAccountData();
    return () => {
      cancelled = true;
    };
  }, [user]);

  function goToPreviewPage(nextPage: EtsStylePreviewPageKey) {
    if (nextPage === previewPage) return;

    previewScrollPositionsRef.current[previewPage] = window.scrollY || 0;
    previewPageHistoryRef.current.push(previewPage);
    setPreviewBackAvailable(true);
    setPreviewPage(nextPage);
    if (nextPage === "support") {
      window.history.replaceState({}, "", "/support-center");
    } else if (window.location.pathname === "/support-center") {
      window.history.replaceState({}, "", "/");
    }

    requestAnimationFrame(() => {
      window.scrollTo({
        top: previewScrollPositionsRef.current[nextPage] || 0,
        behavior: "auto",
      });
    });
  }

  function scrollToPreviewSection(sectionId: string) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document
          .getElementById(sectionId)
          ?.scrollIntoView({ behavior: "auto", block: "start" });
      });
    });
  }

  function goToAiRecordSection() {
    goToPreviewPage("ai");
    window.history.replaceState({}, "", "/records");
    scrollToPreviewSection("forge-ai-practice-records");
  }

  function goToPastExamRecordSection() {
    setLibraryTab("past");
    setPreviewPastBank(null);
    setAppliedPastSearch("");
    goToPreviewPage("library");
    window.history.replaceState({}, "", "/mock-records");
    scrollToPreviewSection("past-exam-practice-records");
  }

  function goBackPreviewPage() {
    previewScrollPositionsRef.current[previewPage] = window.scrollY || 0;
    const previousPage = previewPageHistoryRef.current.pop();

    if (!previousPage) {
      setPreviewBackAvailable(false);
      return;
    }

    setPreviewBackAvailable(previewPageHistoryRef.current.length > 0);
    setPreviewPage(previousPage);
    if (previewPage === "support" || previousPage === "support") {
      window.history.replaceState(
        {},
        "",
        previousPage === "support" ? "/support-center" : "/"
      );
    }

    requestAnimationFrame(() => {
      window.scrollTo({
        top: previewScrollPositionsRef.current[previousPage] || 0,
        behavior: "auto",
      });
    });
  }

  function getPreviewDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function calculateCheckInStreak(dates: string[]) {
    const dateSet = new Set(dates);
    const cursor = new Date(`${getPreviewDateKey()}T00:00:00`);

    if (!dateSet.has(getPreviewDateKey())) {
      cursor.setDate(cursor.getDate() - 1);
    }

    let streak = 0;
    while (dateSet.has(getPreviewDateKey(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    return streak;
  }

  async function handlePreviewCheckIn() {
    if (isPreviewCheckInLoading) return;
    setIsPreviewCheckInLoading(true);
    try {
      await onClaimDailyCredit();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "签到失败，请稍后重试。");
    } finally {
      setIsPreviewCheckInLoading(false);
    }
  }

  function normalizeWritingTargetScore(value: string) {
    const numericValue = Number.parseFloat(value);
    if (!Number.isFinite(numericValue)) return "";

    const clampedValue = Math.min(6, Math.max(1, numericValue));
    const roundedValue = Math.round(clampedValue * 2) / 2;
    return roundedValue.toFixed(1);
  }

  async function saveLearningProfile(
    overrides: Partial<{
      displayName: string;
      targetScore: string;
      examDate: string;
    }> = {}
  ) {
    if (!user) {
      window.alert("请先登录后再保存个人资料。");
      return false;
    }
    if (!isLearningProfileLoaded) {
      window.alert("个人资料仍在读取，请稍后再试。");
      return false;
    }

    const nextDisplayName = overrides.displayName ?? accountName;
    const nextTargetScore =
      normalizeWritingTargetScore(
        overrides.targetScore ?? studyPlanTargetScore
      ) || "5.0";
    const nextExamDate = overrides.examDate ?? studyPlanExamDate;
    const { error } = await supabase.from("user_learning_profiles").upsert(
      {
        user_id: user.id,
        display_name: nextDisplayName.trim(),
        target_score: Number(nextTargetScore),
        exam_date: nextExamDate || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

    if (error) {
      console.error("Failed to save learning profile:", error);
      window.alert("个人资料保存失败，请稍后重试。");
      return false;
    }

    setAccountName(nextDisplayName.trim());
    setStudyPlanTargetScore(nextTargetScore);
    setStudyPlanExamDate(nextExamDate);
    try {
      window.localStorage.setItem(
        `forge-learning-profile:${user.id}`,
        JSON.stringify({
          displayName: nextDisplayName.trim(),
          targetScore: nextTargetScore,
          examDate: nextExamDate,
        })
      );
    } catch {
      // The saved database value will be loaded on the next visit.
    }
    return true;
  }

  function handleWritingTargetScoreBlur() {
    const nextTargetScore =
      normalizeWritingTargetScore(studyPlanTargetScore) || "5.0";
    setStudyPlanTargetScore(nextTargetScore);
    setEditingStudyPlanScore(false);
    void saveLearningProfile({ targetScore: nextTargetScore });
  }

  const ctaStyle: CSSProperties = {
    border: "none",
    borderRadius: softRadius,
    background: accent,
    color: "white",
    padding: "16px 28px",
    minHeight: "56px",
    fontSize: "16px",
    fontWeight: 850,
    cursor: "pointer",
  };
  const aiCtaStyle: CSSProperties = {
    ...ctaStyle,
    background: examGreen,
  };

  const cardStyle: CSSProperties = {
    background: "white",
    border: `1px solid ${line}`,
    borderRadius: softRadius,
    boxShadow: "0 2px 10px rgba(17, 24, 39, 0.07)",
  };
  const navItems = [
    { key: "ai" as const, label: "Forge AI", mobileLabel: "AI", icon: Cpu },
    { key: "library" as const, label: "Practice Tests", mobileLabel: "Tests", icon: Sparkles },
    { key: "daily" as const, label: "Daily", mobileLabel: "Daily", icon: Sun },
    { key: "analytics" as const, label: "Analysis", mobileLabel: "Analysis", icon: Atom },
    { key: "calendar" as const, label: "Study Plan", mobileLabel: "Plan", icon: Calendar },
    { key: "help" as const, label: "Help", mobileLabel: "Help", icon: UserIcon },
  ];
  const todayDaily = getTodayDailyArticle();
  const selectedDailyArticle =
    dailyArticles.find((article) => article.slug === selectedDailySlug) ||
    todayDaily ||
    dailyArticles[0];

  function getDailyTopicCategory(article: DailyArticle) {
    const explicitDailyTopics = [
      "教育学习",
      "商业经济",
      "科技媒体",
      "心理健康",
      "环境城市",
      "艺术人文",
      "社会文化",
      "政府政策",
    ];

    if (explicitDailyTopics.includes(article.topic)) return article.topic;

    const text = [
      article.topic,
      article.titleZh,
      article.titleEn,
      article.subtitle,
      article.background,
      article.keywords.join(" "),
      article.focus.join(" "),
      article.ideaBank.ideas.join(" "),
      article.ideaBank.examples.join(" "),
    ]
      .join(" ")
      .toLowerCase();

    if (
      /government|policy|law|public fund|tax|budget|regulation|vote|official|政府|政策/.test(
        text
      )
    ) {
      return "政府政策";
    }
    if (/art|artist|music|museum|painting|film|literature|humanities|艺术|人文/.test(text)) {
      return "艺术人文";
    }
    if (
      /environment|pollution|climate|city|urban|traffic|park|transport|recycling|sustainab|环境|城市|绿地/.test(
        text
      )
    ) {
      return "环境城市";
    }
    if (/stress|health|mental|exercise|wellness|sleep|emotion|psycholog|心理|健康/.test(text)) {
      return "心理健康";
    }
    if (/technology|digital|internet|online|media|social media|ai|app|video|科技|媒体/.test(text)) {
      return "科技媒体";
    }
    if (/business|econom|company|consumer|advertis|money|market|workplace|商业|经济/.test(text)) {
      return "商业经济";
    }
    if (/society|culture|community|tradition|language|family|friend|social|社会|文化/.test(text)) {
      return "社会文化";
    }

    return "教育学习";
  }

  const dailyTopics = [
    "全部",
    "教育学习",
    "商业经济",
    "科技媒体",
    "心理健康",
    "环境城市",
    "艺术人文",
    "社会文化",
    "政府政策",
  ];
  const normalizedDailySearch = dailySearchInput.trim().toLowerCase();
  const filteredDailyArticles = dailyArticles
    .filter(
      (article) =>
        dailyTopicFilter === "全部" ||
        getDailyTopicCategory(article) === dailyTopicFilter
    )
    .filter((article) => {
      if (!normalizedDailySearch) return true;

      return [
        article.titleZh,
        article.titleEn,
        article.subtitle,
        article.topic,
        article.keywords.join(" "),
        article.ideaBank.ideas.join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedDailySearch);
    })
    .sort((left, right) =>
      dailySortOrder === "desc"
        ? right.publishDate.localeCompare(left.publishDate)
        : left.publishDate.localeCompare(right.publishDate)
    );
  const selectedDailyIndex = dailyArticles.findIndex(
    (article) => article.slug === selectedDailyArticle?.slug
  );
  const previousDaily =
    selectedDailyIndex >= 0 ? dailyArticles[selectedDailyIndex + 1] : undefined;
  const nextDaily =
    selectedDailyIndex > 0 ? dailyArticles[selectedDailyIndex - 1] : undefined;

  function openDailyArticle(
    article: DailyArticle,
    returnView: "home" | "library" = dailyView === "library" ? "library" : "home"
  ) {
    setSelectedDailySlug(article.slug);
    window.sessionStorage.setItem("forge-daily-detail-slug", article.slug);
    setDailyDetailSection("perspectiveA");
    setDailyRelatedPage(1);
    setDailyDetailReturnView(returnView);
    setDailyView("detail");
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
  }
  const helpCenterItems = [
    {
      category: "账户与登录",
      description: "管理你的 FORGE 账户、登录信息与账户安全。",
      questions: [
        {
          question: "如何注册 FORGE 账户？",
          answer:
            "在 FORGE 登录页面选择注册，使用你的邮箱创建账户并按照页面提示完成注册。注册完成后，你可以使用同一账户保存练习记录、学习进度和其他个人学习数据。",
        },
        {
          question: "忘记密码怎么办？",
          answer:
            "在登录页面点击「忘记密码」，输入注册 FORGE 时使用的邮箱。FORGE 会向该邮箱发送密码重置邮件。打开邮件中的重置链接并设置新密码后，即可使用新密码重新登录。",
        },
        {
          question: "为什么收不到重置密码邮件？",
          answer:
            "密码重置邮件可能需要几分钟才能送达。如果没有收到，请检查邮箱地址是否输入正确，查看垃圾邮件或广告邮件文件夹，等待几分钟后再次检查，或返回密码重置页面重新发送邮件。如果多次尝试后仍然无法收到，请前往客服中心联系我们。",
        },
        {
          question: "密码重置链接失效了怎么办？",
          answer:
            "出于账户安全考虑，密码重置链接具有一定的有效时间，并且部分链接只能使用一次。如果链接已经失效，请返回「忘记密码」页面重新发送密码重置邮件，并使用最新邮件中的链接。",
        },
        {
          question: "为什么 FORGE 要求我重新登录？",
          answer:
            "为了保护账户安全，登录状态可能会在一段时间后过期。清除浏览器数据、更换设备、修改账户安全信息等操作，也可能导致需要重新登录。",
        },
        {
          question: "我的学习数据会跟随账户保存吗？",
          answer:
            "已经同步至账户的学习数据会与你的 FORGE 账户关联。建议在开始正式练习前登录账户，以便保存学习记录和进度。",
        },
      ],
    },
    {
      category: "Forge AI",
      description: "了解 Forge AI 如何帮助你进行 TOEFL 学习和训练。",
      questions: [
        {
          question: "Forge AI 是什么？",
          answer:
            "Forge AI 是 FORGE 提供的 AI 辅助学习功能，用于帮助你进行 TOEFL 相关练习。根据不同训练类型，Forge AI 可以提供题目分析、语言反馈、写作建议以及针对性的学习指导。",
        },
        {
          question: "Forge AI 可以帮我做什么？",
          answer:
            "Forge AI 的主要作用是帮助你理解问题和改善作答，而不是简单替你完成题目。根据当前页面提供的功能，你可以进行写作分析、表达优化、错误解释、观点与论证训练以及针对性练习。具体可用能力以 Forge AI 页面当前提供的功能为准。",
        },
        {
          question: "Forge AI 的评分是官方 TOEFL 成绩吗？",
          answer:
            "不是。Forge AI 提供的评分和分析仅用于学习、练习和发现问题，不属于 ETS 官方 TOEFL 评分。AI 评分与实际 TOEFL 考试成绩可能存在差异，请将评分作为学习参考，而不是正式成绩预测。",
        },
        {
          question: "FORGE 是怎么评分的？",
          answer:
            "FORGE 使用自主研发的 Writing Calibration Engine 1（WCE1）对 Writing 成绩进行估算。\n\nWCE1 综合分析 Build a Sentence、Write an Email 和 Academic Discussion 三类任务的表现，并同时采用 20 分模型与双模块模型两个不同的评分视角进行计算与校准，从而减少单一换算方式带来的偏差，为用户提供更稳定、更有参考价值的 FORGE Estimated Writing Score（1–6 分）。\n\nWCE1 会随着更多可靠评分样本的积累持续进行验证与校准。\n\n请注意：WCE1 是 FORGE 独立开发的成绩估算模型，并非 ETS 官方评分公式，也不代表或复现 ETS 的内部评分算法。实际 TOEFL Writing 成绩请以 ETS 官方成绩为准。",
        },
        {
          question: "为什么 AI 给出的评分和我预期的不一样？",
          answer:
            "写作属于开放式作答，不同评分过程可能关注到不同方面。相比单次分数，更建议关注 Forge AI 对内容、结构、语言和论证等方面给出的具体反馈，并观察自己多次练习后的变化。",
        },
        {
          question: "Forge AI 会直接给我标准答案吗？",
          answer:
            "Forge AI 更强调帮助你建立独立作答能力。在部分训练中，系统会优先通过提示、分析和逐步引导帮助你找到答案，而不是立即生成完整答案。",
        },
        {
          question: "AI 一直没有生成结果怎么办？",
          answer:
            "AI 分析需要一定处理时间。如果长时间没有生成结果，可以检查网络连接并稍后重试。如果多次出现相同问题，可以前往客服中心提交反馈。",
        },
      ],
    },
    {
      category: "Practice Tests",
      description: "了解 FORGE 的题目练习、模拟测试、作答和解析功能。",
      questions: [
        {
          question: "Practice Tests 是什么？",
          answer:
            "Practice Tests 是 FORGE 的主要练习区域。你可以在这里进行不同类型的 TOEFL 题目训练，并根据当前提供的内容选择专项练习、Official Questions、ETS Mock 或随机拼题练习。",
        },
        {
          question: "Official Questions 和模拟题有什么区别？",
          answer:
            "Official Questions 主要用于了解实际考试曾经出现或与真实考试相关的题目与话题；模拟题则按照 TOEFL 的题型和能力要求设计，用于补充训练。不同题目的具体来源会根据 FORGE 当前题库信息进行标注，请以题目页面显示的来源信息为准。",
        },
        {
          question: "可以只练习某一种题型吗？",
          answer:
            "可以。Practice Tests 中的 Official Questions 页面提供 Build a Sentence、Email Writing 和 Academic Discussion 等题库入口，你可以根据自己的薄弱项选择对应题型进行专项练习。",
        },
        {
          question: "做完题以后可以查看解析吗？",
          answer:
            "支持解析或评分的题目在提交后会显示对应答案、解析或学习反馈。部分开放式题目还会提供 Forge AI 分析。",
        },
        {
          question: "可以重新做以前做过的题吗？",
          answer:
            "支持重新练习的题目可以再次进入并作答。你的历史作答和反馈可以在 Forge AI 主页，或对应题库题目下方的练习记录中查看。",
        },
        {
          question: "模拟练习成绩等于实际 TOEFL 成绩吗？",
          answer:
            "不等于。FORGE 中的练习成绩主要用于衡量学习表现和发现薄弱项。实际 TOEFL 成绩以正式考试结果为准。",
        },
      ],
    },
    {
      category: "Daily",
      description:
        "每天积累一个话题，从观点、论证和表达开始建立自己的 TOEFL 素材库。",
      questions: [
        {
          question: "Daily 是什么？",
          answer:
            "Daily 是 FORGE 的每日素材积累模块。每篇 Daily 围绕一个适合 TOEFL 学习的话题，通过背景、不同观点、论证、反驳和实用表达，帮助你积累可以迁移到写作中的内容。",
        },
        {
          question: "Daily 和普通英语文章有什么区别？",
          answer:
            "Daily 的目标不是单纯提高阅读量。每篇 Daily 都围绕一个具体问题组织内容，让你学习观点、理由、解释、举例、反方观点和反驳，最终将这些内容转化成可以用于 TOEFL 写作的素材。",
        },
        {
          question: "为什么 Daily 要同时提供正方和反方观点？",
          answer:
            "同一个 TOEFL 话题通常可以从不同角度展开。同时理解正反观点，可以帮助你避免只会背一种立场，并训练从不同角度分析问题、寻找论据和进行反驳的能力。",
        },
        {
          question: "什么是 Counterargument？",
          answer:
            "Counterargument 是反驳训练。它会展示如何先理解对方观点，再找到其中的限制、条件或逻辑不足，并进一步强化自己的立场。这种能力对于提高 Academic Discussion 中的论证深度非常有帮助。",
        },
        {
          question: "Idea Bank 是什么？",
          answer:
            "Idea Bank 会提炼当天 Daily 中最值得积累的内容，例如核心观点、可迁移例子、实用表达和论证方式。你不需要背下整篇文章，更重要的是把这些可以重复使用的素材逐渐变成自己的表达。",
        },
        {
          question: "错过当天的 Daily 还能看吗？",
          answer:
            "可以。点击 Daily 页面中的「View Daily Library」即可进入历史素材库，查看过去发布的 Daily 内容。",
        },
        {
          question: "在哪里查看以前的 Daily？",
          answer:
            "进入 Daily 后点击「View Daily Library」，即可浏览历史 Daily。你可以根据当前页面提供的搜索和分类功能查找感兴趣的话题。",
        },
        {
          question: "Daily 中的“已学习”和“未学习”是什么意思？",
          answer:
            "「已学习」表示你已经完成对应 Daily 的学习流程；「未学习」表示该内容还没有完成。这个状态可以帮助你区分已经学过和还没有学习的素材。",
        },
        {
          question: "什么是 Related Questions？",
          answer:
            "部分 Daily 会关联 FORGE 题库中主题相近的练习题。完成 Daily 后，你可以进入相关题目，把刚刚学习的观点、论证和表达应用到实际练习中。如果显示「0 related questions」，代表当前暂时没有关联题目。",
        },
        {
          question: "Daily 每天必须完成吗？",
          answer:
            "不需要。Daily 是一个长期素材积累工具，你可以按照自己的学习计划使用。不过，相比考试前一次性大量背素材，持续进行少量输入和输出通常更适合建立稳定的写作素材库。",
        },
      ],
    },
    {
      category: "Analysis",
      description: "查看你的写作能力分析、能力趋势与提升建议。",
      questions: [
        {
          question: "Analysis 是什么？",
          answer:
            "Analysis 是 FORGE 的写作能力分析页面。它会根据有效的 AI 批改结果，展示 Email Writing 和 Academic Discussion 的能力维度、趋势与提升建议。",
        },
        {
          question: "Analysis 什么时候会生成能力分析？",
          answer:
            "每个写作题型累计达到 5 次有效 AI 批改后，会生成相应的稳定能力分析。样本不足时，页面会显示当前进度。",
        },
        {
          question: "Analysis 使用哪些练习数据？",
          answer:
            "Analysis 只使用已经完成 AI 批改并保存到账户的 Email Writing 和 Academic Discussion 记录。未批改或未成功保存的练习不会计入。",
        },
        {
          question: "在哪里查看以前做过的练习？",
          answer:
            "练习历史保留在 Forge AI 主页的练习记录区域，以及对应题库题目下方的练习记录中。Analysis 页面只展示能力分析。",
        },
        {
          question: "Analysis 中的数据有什么用？",
          answer:
            "Analysis 用于识别稳定强项和薄弱能力，观察最近批改结果的变化，并提供更有针对性的后续练习建议。",
        },
      ],
    },
    {
      category: "Study Plan",
      description: "安排你的 TOEFL 学习时间，并结合考试日期规划备考。",
      questions: [
        {
          question: "Study Plan 是什么？",
          answer:
            "Study Plan 用于帮助你安排 TOEFL 学习时间。你可以结合自己的考试日期和学习安排查看计划，让日常练习更加有节奏。",
        },
        {
          question: "右侧日历中的「福」是什么意思？",
          answer:
            "「福」用于标记托福网考相关考试日期。你可以通过日历快速查看近期考试安排。具体考试日期请以官方公布的信息为准。",
        },
        {
          question: "为什么日历上有些日期不能选择？",
          answer:
            "过去日期、不可用日期或当前没有相关计划的日期可能会根据页面设计显示为不可选择状态。已经过去的考试日会回到普通日期显示。",
        },
        {
          question: "可以把自己的 TOEFL 考试日期加入 Study Plan 吗？",
          answer:
            "可以在右侧日历中右键点击「福」考试日，并选择「添加考试日」。添加后，Today's Plan 会显示距离考试还有多少天。",
        },
        {
          question: "目标分可以修改吗？",
          answer:
            "可以。点击 Today's Plan 中的目标分数字，输入新的目标分后按回车或点击其他位置即可保存。",
        },
        {
          question: "Study Plan 会自动安排每天做什么吗？",
          answer:
            "当前预览版本主要展示考试日期、今日学习概览和继续学习入口。自动学习计划尚未正式上线，后续可以结合练习记录和考试日期提供更加个性化的学习安排。",
        },
        {
          question: "日历中的 TOEFL 考试日期可靠吗？",
          answer:
            "FORGE 日历用于辅助备考规划。考试安排可能发生调整，报名和参加考试前，请务必以 TOEFL 官方公布的最新考试信息为准。",
        },
      ],
    },
    {
      category: "使用问题与反馈",
      description: "解决网站使用问题，报告错误或向 FORGE 提出建议。",
      questions: [
        {
          question: "FORGE 页面显示异常怎么办？",
          answer:
            "可以先尝试刷新当前页面，检查网络连接，重新登录账户，或使用较新的浏览器版本重新访问。如果问题持续存在，请前往客服中心提交反馈。",
        },
        {
          question: "为什么点击按钮没有反应？",
          answer:
            "可能与网络状态、页面加载或浏览器环境有关。可以先刷新页面后再次尝试。如果问题可以稳定复现，请截图并告诉我们出现问题的页面和操作步骤。",
        },
        {
          question: "我发现一道题可能有错误，怎么办？",
          answer:
            "欢迎通过客服中心提交题目反馈。建议提供题目名称或编号、你认为存在问题的位置、原因说明和截图。我们会根据这些信息进行核查。",
        },
        {
          question: "如何报告 Bug？",
          answer:
            "点击 Help Center 中的客服入口进入客服中心，创建工单并描述出现问题的页面和操作过程。如果可以，请同时提供截图。",
        },
        {
          question: "可以给 FORGE 提功能建议吗？",
          answer:
            "可以。如果你希望 FORGE 增加某项功能，或者认为现有功能可以改进，可以前往客服中心创建工单提交你的想法。",
        },
        {
          question: "反馈问题时应该提供哪些信息？",
          answer:
            "为了更快定位问题，建议尽量提供出现问题的页面、你进行了什么操作、实际发生了什么、你原本预期发生什么、相关截图，以及使用的设备或浏览器。",
        },
      ],
    },
  ];
  const normalizedHelpSearch = helpSearchInput.trim().toLowerCase();
  const activeHelpCenterSection =
    helpCenterItems.find((section) => section.category === activeHelpCategory) ||
    helpCenterItems[0];
  const helpSearchResults = helpCenterItems.flatMap((section) =>
    section.questions
      .filter((item) =>
        !normalizedHelpSearch ||
        [section.category, section.description, item.question, item.answer]
          .join(" ")
          .toLowerCase()
          .includes(normalizedHelpSearch)
      )
      .map((item) => ({
        ...item,
        category: section.category,
      }))
  );
  const filteredHelpQuestions = activeHelpCenterSection.questions.filter(
    (item) =>
      !normalizedHelpSearch ||
      [
        activeHelpCenterSection.category,
        activeHelpCenterSection.description,
        item.question,
        item.answer,
      ]
      .join(" ")
      .toLowerCase()
      .includes(normalizedHelpSearch)
  );
  function getAiRecordTypeLabel(
    type: "mock" | "sentence" | "email" | "discussion"
  ) {
    if (type === "mock") return "完整练习";
    if (type === "sentence") return "Build a Sentence";
    if (type === "email") return "Email Writing";
    return "Academic Discussion";
  }

  function getScoreValue(score: number | string) {
    const value = Number.parseFloat(String(score));
    return Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value;
  }

  function getScoreDisplayParts(score: number | string) {
    const matched = String(score).match(/^\s*(.+?)\s*\/\s*(.+?)\s*$/);
    return matched ? [matched[1], matched[2]] : null;
  }

  const allQuestionBankSets = [...pastExamSets, ...etsMockSets];
  const questionBankSentenceKeys = new Set(
    allQuestionBankSets.flatMap((questionSet) =>
      (questionSet.content.tasks || []).flatMap((task) =>
        task.type === "sentence"
          ? task.questions.map((question) => getSentenceQuestionKey(question))
          : []
      )
    )
  );
  const questionBankEmailKeys = new Set(
    allQuestionBankSets.flatMap((questionSet) =>
      (questionSet.content.tasks || []).flatMap((task) =>
        task.type === "email" ? [getPromptScoreKey("email", task.prompt)] : []
      )
    )
  );
  const questionBankDiscussionKeys = new Set(
    allQuestionBankSets.flatMap((questionSet) =>
      (questionSet.content.tasks || []).flatMap((task) =>
        task.type === "discussion"
          ? [getPromptScoreKey("discussion", task.prompt)]
          : []
      )
    )
  );

  function isQuestionBankPrompt(type: "email" | "discussion", prompt: unknown) {
    const key = getPromptScoreKey(type, prompt);
    return type === "email"
      ? questionBankEmailKeys.has(key)
      : questionBankDiscussionKeys.has(key);
  }

  function isQuestionBankPracticeRecord(record: PracticeRecord) {
    return (
      (record.practice_type === "email" &&
        isQuestionBankPrompt("email", record.prompt)) ||
      (record.practice_type === "discussion" &&
        isQuestionBankPrompt("discussion", record.prompt))
    );
  }

  function isQuestionBankMockRecord(record: MockRecord) {
    const embeddedSource = [
      ...(record.sentence_questions || []),
      record.email_prompt,
      record.discussion_prompt,
    ].find((value) =>
      ["forge_ai", "past_exam", "ets_mock"].includes(
        String(value?.recordSourceType || "")
      )
    )?.recordSourceType;

    if (embeddedSource === "forge_ai") return false;
    if (embeddedSource === "past_exam" || embeddedSource === "ets_mock") {
      return true;
    }

    // Older rows have no explicit source. Treat the whole record as a
    // question-bank record only when every section the user completed matches
    // the bank. One coincidental match must not hide a full AI practice.
    const hasSentence = hasRecordedSentenceSection(record);
    const hasEmail = !isSkippedWritingFeedback(record.email_feedback);
    const hasDiscussion = !isSkippedWritingFeedback(record.discussion_feedback);
    const sentenceMatches =
      !hasSentence ||
      ((record.sentence_questions || []).length > 0 &&
        (record.sentence_questions || []).every((question) =>
          questionBankSentenceKeys.has(getSentenceQuestionKey(question))
        ));
    const emailMatches =
      !hasEmail || isQuestionBankPrompt("email", record.email_prompt);
    const discussionMatches =
      !hasDiscussion ||
      isQuestionBankPrompt("discussion", record.discussion_prompt);

    return (
      (hasSentence || hasEmail || hasDiscussion) &&
      sentenceMatches &&
      emailMatches &&
      discussionMatches
    );
  }

  function isQuestionBankSession(session: PracticeSession) {
    if (session.sourceType === "past_exam" || session.sourceType === "ets_mock") {
      return true;
    }
    if (session.type === "email") {
      return isQuestionBankPrompt("email", session.prompt);
    }
    if (session.type === "discussion") {
      return isQuestionBankPrompt("discussion", session.prompt);
    }
    return false;
  }

  const unifiedAiRecords = [
    ...practiceSessions
      .filter(
        (session) =>
          !isQuestionBankSession(session) &&
          session.type !== "mock" &&
          typeof session.score === "string" &&
          (session.score === "未批改" || session.score === "未完成")
      )
      .map((session) => ({
        id: `session-${session.id}`,
        date: session.date,
        type: session.type as "sentence" | "email" | "discussion",
        typeLabel: getAiRecordTypeLabel(
          session.type as "sentence" | "email" | "discussion"
        ),
        score: session.score,
        scoreValue: Number.NEGATIVE_INFINITY,
        detail: {
          kind: "session" as const,
          session,
        },
        deleteTarget: {
          source: "session" as const,
          id: session.id,
          label: session.score === "未批改" ? "未批改练习" : "未完成练习",
        },
      })),
    ...mockRecords
      .filter(
        (record) =>
          !isQuestionBankMockRecord(record) && isCompleteMockRecord(record)
      )
      .map((record) => ({
        id: `mock-full-${record.id}`,
        date: record.created_at,
        type: "mock" as const,
        typeLabel: getAiRecordTypeLabel("mock"),
        score: `${Number(record.final_score).toFixed(1)} / 6.0`,
        scoreValue: Number(record.final_score),
        detail: {
          kind: "mock-full" as const,
          record,
        },
        deleteTarget: {
          source: "mock" as const,
          id: record.id,
          label: "完整练习",
        },
      })),
    ...mockRecords
      .filter(
        (record) =>
          !isQuestionBankMockRecord(record) &&
          hasRecordedSentenceSection(record) && !isCompleteMockRecord(record)
      )
      .map((record) => ({
        id: `sentence-${record.id}`,
        date: record.created_at,
        type: "sentence" as const,
        typeLabel: getAiRecordTypeLabel("sentence"),
        score: `${Number(record.sentence_score).toFixed(1)} / 10.0`,
        scoreValue: Number(record.sentence_score),
        detail: {
          kind: "mock-section" as const,
          record,
          section: "sentence" as const,
        },
        deleteTarget: {
          source: "mock" as const,
          id: record.id,
          label: "练习及其关联题型",
        },
      })),
    ...records
      .filter(
        (record) =>
          !isQuestionBankPracticeRecord(record) &&
          record.practice_type === "email"
      )
      .map((record) => ({
        id: `email-practice-${record.id}`,
        date: record.created_at,
        type: "email" as const,
        typeLabel: getAiRecordTypeLabel("email"),
        score: record.score,
        scoreValue: getScoreValue(record.score),
        detail: {
          kind: "practice" as const,
          record,
        },
        deleteTarget: {
          source: "practice" as const,
          id: record.id,
          label: "Email Writing",
        },
      })),
    ...mockRecords
      .filter(
        (record) =>
          !isQuestionBankMockRecord(record) &&
          !isCompleteMockRecord(record) &&
          !isSkippedWritingFeedback(record.email_feedback)
      )
      .map((record) => ({
        id: `email-mock-${record.id}`,
        date: record.created_at,
        type: "email" as const,
        typeLabel: getAiRecordTypeLabel("email"),
        score: record.email_score,
        scoreValue: getScoreValue(record.email_score),
        detail: {
          kind: "mock-section" as const,
          record,
          section: "email" as const,
        },
        deleteTarget: {
          source: "mock" as const,
          id: record.id,
          label: "练习及其关联题型",
        },
      })),
    ...records
      .filter(
        (record) =>
          !isQuestionBankPracticeRecord(record) &&
          record.practice_type === "discussion"
      )
      .map((record) => ({
        id: `discussion-practice-${record.id}`,
        date: record.created_at,
        type: "discussion" as const,
        typeLabel: getAiRecordTypeLabel("discussion"),
        score: record.score,
        scoreValue: getScoreValue(record.score),
        detail: {
          kind: "practice" as const,
          record,
        },
        deleteTarget: {
          source: "practice" as const,
          id: record.id,
          label: "Academic Discussion",
        },
      })),
    ...mockRecords
      .filter(
        (record) =>
          !isQuestionBankMockRecord(record) &&
          !isCompleteMockRecord(record) &&
          !isSkippedWritingFeedback(record.discussion_feedback)
      )
      .map((record) => ({
        id: `discussion-mock-${record.id}`,
        date: record.created_at,
        type: "discussion" as const,
        typeLabel: getAiRecordTypeLabel("discussion"),
        score: record.discussion_score,
        scoreValue: getScoreValue(record.discussion_score),
        detail: {
          kind: "mock-section" as const,
          record,
          section: "discussion" as const,
        },
        deleteTarget: {
          source: "mock" as const,
          id: record.id,
          label: "练习及其关联题型",
        },
      })),
  ];
  function formatDateOnly(dateText: string) {
    if (!dateText) return "";
    const parsed = new Date(dateText);
    if (Number.isNaN(parsed.getTime())) return dateText.slice(0, 10);
    return parsed.toISOString().slice(0, 10);
  }

  const userEmail = user?.email || "";
  const accountDisplayName =
    accountName.trim() || user?.user_metadata?.full_name || userEmail.split("@")[0] || "FORGE Learner";
  const maskedAccountEmail = userEmail
    ? userEmail.replace(/^(.{4}).*(@.*)$/, "$1****$2")
    : "";
  const todayForPreview = new Date();
  todayForPreview.setHours(0, 0, 0, 0);
  const selectedAccountExamDate = studyPlanExamDate
    ? new Date(`${studyPlanExamDate}T00:00:00`)
    : null;
  const daysUntilAccountExam = selectedAccountExamDate
    ? Math.max(
        0,
        Math.ceil(
          (selectedAccountExamDate.getTime() - todayForPreview.getTime()) /
            86400000
        )
      )
    : null;
  const completedPracticeCount = records.length + mockRecords.length;
  const learningDateSet = new Set<string>();

  unifiedAiRecords.forEach((record) => {
    const dateText = formatDateOnly(record.date);
    if (dateText) learningDateSet.add(dateText);
  });

  const learningDaysCount = learningDateSet.size;
  const previewTemporaryCreditTotal = temporaryPoints;
  const previewPermanentCreditDisplayTotal = permanentPoints;
  const previewCreditBalance = points;
  const todayCheckInKey = getPreviewDateKey();
  const hasCheckedInToday =
    creditCheckInDates.includes(todayCheckInKey);
  const previewCheckInStreak = calculateCheckInStreak(
    creditCheckInDates
  );
  const nextCheckInMilestone =
    checkInMilestones.find(
      (milestone) =>
        milestone.days > previewCheckInStreak ||
        !claimedCreditMilestones.includes(milestone.days)
    ) || checkInMilestones[checkInMilestones.length - 1];

  function getCurrentLearningStreak() {
    let streak = 0;
    const cursor = new Date(todayForPreview);

    while (true) {
      const dateKey = cursor.toISOString().slice(0, 10);
      if (!learningDateSet.has(dateKey)) break;
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    return streak;
  }

  function formatAccountDate(dateText: string) {
    if (!dateText) return "未设置";
    return dateText;
  }

  function formatMembershipExpiry(dateText: string | null) {
    if (!isPro) return "Free";
    if (!dateText) return "长期有效";

    const parsed = new Date(dateText);
    if (Number.isNaN(parsed.getTime())) return dateText.slice(0, 10);

    return [
      parsed.getFullYear(),
      String(parsed.getMonth() + 1).padStart(2, "0"),
      String(parsed.getDate()).padStart(2, "0"),
    ].join("-");
  }

  function renderAccountFieldButton(
    label: string,
    value: string,
    onClick: () => void
  ) {
    return (
      <button
        type="button"
        onClick={onClick}
        style={{
          border: `1px solid ${line}`,
          background: "white",
          color: accent,
          borderRadius: softRadius,
          padding: "8px 10px",
          fontSize: "13px",
          fontWeight: 850,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ color: muted, marginRight: "8px" }}>{label}</span>
        {value}
      </button>
    );
  }
  const filteredAiRecords = unifiedAiRecords
    .filter((record) => aiRecordTypeFilters.includes(record.type))
    .sort((left, right) => {
      if (aiRecordSortMode === "score-desc") {
        return right.scoreValue - left.scoreValue;
      }
      if (aiRecordSortMode === "score-asc") {
        return left.scoreValue - right.scoreValue;
      }

      const leftTime = Date.parse(left.date || "");
      const rightTime = Date.parse(right.date || "");
      const safeLeftTime = Number.isNaN(leftTime) ? 0 : leftTime;
      const safeRightTime = Number.isNaN(rightTime) ? 0 : rightTime;

      return aiRecordSortMode === "time-desc"
        ? safeRightTime - safeLeftTime
        : safeLeftTime - safeRightTime;
    });
  const aiRecordsPerPage = 10;
  const aiRecordTotalPages = Math.max(
    1,
    Math.ceil(filteredAiRecords.length / aiRecordsPerPage)
  );
  const normalizedAiRecordPage = Math.min(aiRecordPage, aiRecordTotalPages);
  const pagedAiRecords = filteredAiRecords.slice(
    (normalizedAiRecordPage - 1) * aiRecordsPerPage,
    normalizedAiRecordPage * aiRecordsPerPage
  );

  useEffect(() => {
    if (aiRecordPage > aiRecordTotalPages) {
      setAiRecordPage(aiRecordTotalPages);
    }
  }, [aiRecordPage, aiRecordTotalPages]);
  const pastExamBankCards = [
    {
      title: "Build a Sentence",
      type: "sentence" as const,
      description: `${pastExamSets.filter((set) => set.content.tasks?.some((task) => task.type === "sentence")).length} 个造句题库`,
    },
    {
      title: "Email Writing",
      type: "email" as const,
      description: `${pastExamSets.filter((set) => set.content.tasks?.some((task) => task.type === "email")).length} 个邮件题库`,
    },
    {
      title: "Academic Discussion",
      type: "discussion" as const,
      description: `${pastExamSets.filter((set) => set.content.tasks?.some((task) => task.type === "discussion")).length} 个讨论题库`,
    },
  ];
  type PastExamRecordRow = {
    id: string;
    date: string;
    type: "mock" | "sentence" | "email" | "discussion";
    typeLabel: string;
    score: string;
    scoreValue: number;
    detail: PastExamRecordDetail;
    deleteTarget: DeleteRecordTarget;
  };
  const pastExamRecordRows = (() => {
    const rows: PastExamRecordRow[] = [];
    const sentenceKeys = new Set(
      pastExamSets.flatMap((questionSet) =>
        (questionSet.content.tasks || []).flatMap((task) =>
          task.type === "sentence"
            ? task.questions.map((question) => getSentenceQuestionKey(question))
            : []
        )
      )
    );
    const emailKeys = new Set(
      pastExamSets.flatMap((questionSet) =>
        (questionSet.content.tasks || []).flatMap((task) =>
          task.type === "email"
            ? [getPromptScoreKey("email", task.prompt)]
            : []
        )
      )
    );
    const discussionKeys = new Set(
      pastExamSets.flatMap((questionSet) =>
        (questionSet.content.tasks || []).flatMap((task) =>
          task.type === "discussion"
            ? [getPromptScoreKey("discussion", task.prompt)]
            : []
        )
      )
    );

    records.forEach((record) => {
      const type = record.practice_type;
      const matchesPastExam =
        (type === "email" &&
          emailKeys.has(getPromptScoreKey("email", record.prompt))) ||
        (type === "discussion" &&
          discussionKeys.has(getPromptScoreKey("discussion", record.prompt)));

      if (!matchesPastExam || (type !== "email" && type !== "discussion")) {
        return;
      }

      rows.push({
        id: `practice-${record.id}`,
        date: record.created_at,
        type,
        typeLabel: getAiRecordTypeLabel(type),
        score: record.score,
        scoreValue: getScoreValue(record.score),
        detail: { kind: "practice", record },
        deleteTarget: {
          source: "practice",
          id: record.id,
          label: getAiRecordTypeLabel(type),
        },
      });
    });

    mockRecords.forEach((record) => {
      const questions = record.sentence_questions || [];
      const hasSentence =
        hasRecordedSentenceSection(record) &&
        questions.length > 0 &&
        questions.every((question) =>
          sentenceKeys.has(getSentenceQuestionKey(question))
        );
      const hasEmail =
        !isSkippedWritingFeedback(record.email_feedback) &&
        emailKeys.has(getPromptScoreKey("email", record.email_prompt));
      const hasDiscussion =
        !isSkippedWritingFeedback(record.discussion_feedback) &&
        discussionKeys.has(
          getPromptScoreKey("discussion", record.discussion_prompt)
        );

      if (
        isCompleteMockRecord(record) &&
        hasSentence &&
        hasEmail &&
        hasDiscussion
      ) {
        rows.push({
          id: `full-${record.id}`,
          date: record.created_at,
          type: "mock",
          typeLabel: getAiRecordTypeLabel("mock"),
          score: `${Number(record.final_score).toFixed(1)} / 6.0`,
          scoreValue: Number(record.final_score),
          detail: { kind: "mock-full", record },
          deleteTarget: {
            source: "mock",
            id: record.id,
            label: "完整练习",
          },
        });
        return;
      }

      if (hasSentence) {
        rows.push({
          id: `sentence-${record.id}`,
          date: record.created_at,
          type: "sentence",
          typeLabel: getAiRecordTypeLabel("sentence"),
          score: `${Number(record.sentence_score).toFixed(1)} / 10.0`,
          scoreValue: Number(record.sentence_score),
          detail: { kind: "mock-section", record, section: "sentence" },
          deleteTarget: {
            source: "mock",
            id: record.id,
            label: "练习及其关联题型",
          },
        });
      }

      if (hasEmail) {
        rows.push({
          id: `email-${record.id}`,
          date: record.created_at,
          type: "email",
          typeLabel: getAiRecordTypeLabel("email"),
          score: record.email_score,
          scoreValue: getScoreValue(record.email_score),
          detail: { kind: "mock-section", record, section: "email" },
          deleteTarget: {
            source: "mock",
            id: record.id,
            label: "练习及其关联题型",
          },
        });
      }

      if (hasDiscussion) {
        rows.push({
          id: `discussion-${record.id}`,
          date: record.created_at,
          type: "discussion",
          typeLabel: getAiRecordTypeLabel("discussion"),
          score: record.discussion_score,
          scoreValue: getScoreValue(record.discussion_score),
          detail: { kind: "mock-section", record, section: "discussion" },
          deleteTarget: {
            source: "mock",
            id: record.id,
            label: "练习及其关联题型",
          },
        });
      }
    });

    return rows;
  })();
  const filteredPastExamRecordRows = pastExamRecordRows
    .filter((record) => pastRecordTypeFilters.includes(record.type))
    .sort((left, right) => {
      if (pastRecordSortMode === "score-desc") {
        return right.scoreValue - left.scoreValue;
      }
      if (pastRecordSortMode === "score-asc") {
        return left.scoreValue - right.scoreValue;
      }

      const leftTime = Date.parse(left.date || "") || 0;
      const rightTime = Date.parse(right.date || "") || 0;
      return pastRecordSortMode === "time-desc"
        ? rightTime - leftTime
        : leftTime - rightTime;
    });
  const pastRecordsPerPage = 10;
  const pastRecordTotalPages = Math.max(
    1,
    Math.ceil(filteredPastExamRecordRows.length / pastRecordsPerPage)
  );
  const normalizedPastRecordPage = Math.min(
    pastRecordPage,
    pastRecordTotalPages
  );
  const pagedPastExamRecordRows = filteredPastExamRecordRows.slice(
    (normalizedPastRecordPage - 1) * pastRecordsPerPage,
    normalizedPastRecordPage * pastRecordsPerPage
  );
  useEffect(() => {
    if (pastRecordPage > pastRecordTotalPages) {
      setPastRecordPage(pastRecordTotalPages);
    }
  }, [pastRecordPage, pastRecordTotalPages]);
  const tpoPreviewSets = etsMockSets
    .filter((item) => /^(?:TPO\s+\d+|OG\s+1)$/i.test(item.title))
    .sort(
      (left, right) =>
        (left.mock_number ?? left.sort_order) -
        (right.mock_number ?? right.sort_order)
    );
  const originalMockPreviewSets = etsMockSets
    .filter((item) => /^Mock Test\s+\d+$/i.test(item.title))
    .sort(
      (left, right) =>
        (left.mock_number ?? left.sort_order) -
        (right.mock_number ?? right.sort_order)
    )
    .slice(0, 15);
  const randomMockRecords = mockRecords
    .filter((record) => isEtsMockRandomRecord(record, etsMockSets))
    .slice(0, 4);
  const previewPastRandomSetCount = getPastExamRandomSetCandidates(
    pastExamSets
  ).length;
  const previewRandomTypeOptions = [
    {
      type: "sentence" as const,
      label: "Build a Sentence",
      count: pastExamSets.filter((set) =>
        set.content.tasks?.some((task) => task.type === "sentence")
      ).length,
    },
    {
      type: "email" as const,
      label: "Email Writing",
      count: pastExamSets.filter((set) =>
        set.content.tasks?.some((task) => task.type === "email")
      ).length,
    },
    {
      type: "discussion" as const,
      label: "Academic Discussion",
      count: pastExamSets.filter((set) =>
        set.content.tasks?.some((task) => task.type === "discussion")
      ).length,
    },
  ];
  const unlockedPreviewEtsMockSets = etsMockSets.filter((set) =>
    unlockedEtsMockIds.includes(set.id)
  );
  const previewEtsMockRandomTypeOptions = [
    {
      type: "sentence" as const,
      label: "Build a Sentence",
      count: unlockedPreviewEtsMockSets.filter((set) =>
        set.content.tasks?.some((task) => task.type === "sentence")
      ).length,
    },
    {
      type: "email" as const,
      label: "Email Writing",
      count: unlockedPreviewEtsMockSets.filter((set) =>
        set.content.tasks?.some((task) => task.type === "email")
      ).length,
    },
    {
      type: "discussion" as const,
      label: "Academic Discussion",
      count: unlockedPreviewEtsMockSets.filter((set) =>
        set.content.tasks?.some((task) => task.type === "discussion")
      ).length,
    },
  ];
  const previewSentenceSetOptions = pastExamSets
    .flatMap((set) => {
      const tasks = Array.isArray(set.content.tasks) ? set.content.tasks : [];

      return tasks
        .filter((task) => task.type === "sentence")
        .map((task) => ({
          item: set,
          task,
          count: task.type === "sentence" ? task.questions.length : 0,
        }));
    })
    .sort((left, right) => {
      const leftTime = Date.parse(left.item.display_date || "");
      const rightTime = Date.parse(right.item.display_date || "");
      const dateDifference =
        (Number.isNaN(rightTime) ? Number.NEGATIVE_INFINITY : rightTime) -
        (Number.isNaN(leftTime) ? Number.NEGATIVE_INFINITY : leftTime);

      if (dateDifference !== 0) return dateDifference;

      return (left.item.sort_order || 0) - (right.item.sort_order || 0);
    });
  const previewEtsMockSentenceSetOptions = unlockedPreviewEtsMockSets
    .flatMap((set) => {
      const tasks = Array.isArray(set.content.tasks) ? set.content.tasks : [];

      return tasks
        .filter((task) => task.type === "sentence")
        .map((task) => ({
          item: set,
          task,
          count: task.type === "sentence" ? task.questions.length : 0,
        }));
    })
    .sort(
      (left, right) =>
        (left.item.mock_number ?? left.item.sort_order) -
        (right.item.mock_number ?? right.item.sort_order)
    );
  const emailTopicFilters = [...EMAIL_TOPIC_CATEGORIES];
  const discussionTopicFilters = [...DISCUSSION_TOPIC_CATEGORIES];
  const currentTopicFilters =
    previewPastBank === "email"
      ? emailTopicFilters
      : previewPastBank === "discussion"
        ? discussionTopicFilters
        : [];
  const activeTopicFilters = ["all", ...currentTopicFilters];

  function getSearchTypeForPastBank(type: PastExamPracticeType) {
    if (type === "sentence") return "Build a Sentence";
    if (type === "email") return "Email Writing";
    return "Academic Discussion";
  }

  function getPastBankForSearchType(type: EtsStylePastSearchType) {
    if (type === "Build a Sentence") return "sentence";
    if (type === "Email Writing") return "email";
    return "discussion";
  }

  function getPastExamSetTime(item: QuestionSet) {
    const time = Date.parse(item.display_date || "");
    return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
  }

  const pastSearchTaskType =
    pastSearchType === "Build a Sentence"
      ? "sentence"
      : pastSearchType === "Email Writing"
        ? "email"
        : "discussion";
  const activePastSearch = appliedPastSearch.trim().toLowerCase();

  function doesPastExamTaskMatchSearch(
    set: QuestionSet,
    task: QuestionSetTask,
    searchText: string
  ) {
    if (!searchText) return true;

    const setSearchableText = [
      set.title,
      set.display_date,
      set.content.description,
    ]
      .join(" ")
      .toLowerCase();

    if (setSearchableText.includes(searchText)) return true;

    if (task.type === "sentence") {
      return task.questions.some((question) =>
        [
          task.title,
          question.contextSpeaker,
          question.contextSentence,
          question.answerSpeaker,
          question.target,
          renderFullAnswer(question),
        ]
          .join(" ")
          .toLowerCase()
          .includes(searchText)
      );
    }

    return [
      task.title,
      getPastExamTaskCategory(task),
      getPastExamTaskDisplayTopic(task),
      JSON.stringify(task.prompt),
    ]
      .join(" ")
      .toLowerCase()
      .includes(searchText);
  }

  function isQuestionSetTaskDone(task: QuestionSetTask) {
    if (task.type === "sentence") {
      return sentenceBestScores.has(getSentenceSetKey(task.questions));
    }

    if (task.type === "email") {
      return bestScores.has(getPromptScoreKey("email", task.prompt));
    }

    return bestScores.has(getPromptScoreKey("discussion", task.prompt));
  }

  function matchesCompletionFilter(
    done: boolean,
    filter: "all" | "done" | "undone"
  ) {
    if (filter === "all") return true;
    return filter === "done" ? done : !done;
  }

  function isEtsMockSetDone(item: QuestionSet) {
    const tasks = Array.isArray(item.content.tasks) ? item.content.tasks : [];

    return (
      mockRecords.some((record) => isMockRecordForQuestionSet(record, item)) ||
      tasks.some((task) => isQuestionSetTaskDone(task))
    );
  }

  const previewPastBankEntries = previewPastBank
    ? pastExamSets
        .flatMap((set) => {
          const tasks = Array.isArray(set.content.tasks) ? set.content.tasks : [];

          return tasks.flatMap((task) => {
            if (task.type !== previewPastBank) return [];

            const topic =
              previewPastBank === "sentence"
                ? ""
                : getPastExamTaskTheme(task);

            if (
              previewTopicFilter !== "all" &&
              topic &&
              topic !== previewTopicFilter
            ) {
              return [];
            }

            if (
              activePastSearch &&
              !doesPastExamTaskMatchSearch(set, task, activePastSearch)
            ) {
              return [];
            }

            if (
              !matchesCompletionFilter(
                isQuestionSetTaskDone(task),
                previewCompletionFilter
              )
            ) {
              return [];
            }

            return [
              {
                key: `${set.id}-${task.type}-${task.title || "task"}`,
                title:
                  task.type === "sentence"
                    ? "Build a Sentence"
                    : getPastExamTaskDisplayTopic(task),
                description: `${set.display_date || "No date"}${
                  topic ? ` · ${topic}` : ""
                }`,
                item: set,
                task,
                topic:
                  task.type === "sentence"
                    ? "Build a Sentence"
                    : getPastExamTaskDisplayTopic(task),
                category:
                  task.type === "sentence"
                    ? task.questions.length > 0
                      ? `${task.questions.length} 题`
                      : ""
                    : topic || getPastExamTaskTheme(task),
                bestScore:
                  task.type === "sentence"
                    ? sentenceBestScores.get(getSentenceSetKey(task.questions))
                    : task.type === "email"
                      ? bestScores.get(getPromptScoreKey("email", task.prompt))
                      : bestScores.get(
                          getPromptScoreKey("discussion", task.prompt)
                        ),
                dateTime: getPastExamSetTime(set),
                sortOrder: set.sort_order || 0,
                selection: {
                  item: set,
                  type: previewPastBank,
                  task,
                } as PastExamPreviewSelection,
              },
            ];
          });
        })
        .sort((left, right) => {
          const direction = previewSortOrder === "desc" ? -1 : 1;
          const dateDifference = left.dateTime - right.dateTime;

          if (dateDifference !== 0) return dateDifference * direction;

          return (left.sortOrder - right.sortOrder) * direction;
        })
    : [];
  const allPreviewPastBankDateGroups = previewPastBankEntries.reduce(
    (groups, entry) => {
      const date = entry.item.display_date || "No date";
      const existing = groups.find((group) => group.date === date);

      if (existing) {
        existing.entries.push(entry);
      } else {
        groups.push({ date, entries: [entry] });
      }

      return groups;
    },
    [] as { date: string; entries: typeof previewPastBankEntries }[]
  );

  function getPreviewMonthKey(date: string) {
    const match = /^(\d{4})-(\d{2})/.exec(date);
    return match ? `${match[1]}-${match[2]}` : "undated";
  }

  function getPreviewMonthLabel(month: string) {
    if (month === "undated") return "未标注月份";

    const [year, monthNumber] = month.split("-");
    return `${year}年${Number(monthNumber)}月`;
  }

  const allPreviewPastBankMonthGroups = allPreviewPastBankDateGroups.reduce(
    (groups, dateGroup) => {
      const month = getPreviewMonthKey(dateGroup.date);
      const existing = groups.find((group) => group.month === month);

      if (existing) {
        existing.dateGroups.push(dateGroup);
        existing.count += dateGroup.entries.length;
      } else {
        groups.push({
          month,
          count: dateGroup.entries.length,
          dateGroups: [dateGroup],
        });
      }

      return groups;
    },
    [] as {
      month: string;
      count: number;
      dateGroups: typeof allPreviewPastBankDateGroups;
    }[]
  );
  const previewBankMonthsPerPage = 6;
  const previewPastBankTotalPages = Math.max(
    1,
    Math.ceil(allPreviewPastBankMonthGroups.length / previewBankMonthsPerPage)
  );
  const normalizedPreviewBankPage = Math.min(
    previewBankPage,
    previewPastBankTotalPages
  );
  const previewPastBankMonthGroups = allPreviewPastBankMonthGroups.slice(
    (normalizedPreviewBankPage - 1) * previewBankMonthsPerPage,
    normalizedPreviewBankPage * previewBankMonthsPerPage
  );

  useEffect(() => {
    if (previewBankPage > previewPastBankTotalPages) {
      setPreviewBankPage(previewPastBankTotalPages);
    }
  }, [previewBankPage, previewPastBankTotalPages]);

  function getPreviewRestoreState(): EtsStylePreviewRestoreState {
    return {
      libraryTab,
      pastBank: previewPastBank,
      topicFilter: previewTopicFilter,
      completionFilter: previewCompletionFilter,
      sortOrder: previewSortOrder,
      bankPage: normalizedPreviewBankPage,
      pastSearchType,
      pastSearchInput,
      appliedPastSearch,
    };
  }
  const searchedPastExamEntries = activePastSearch
    ? pastExamSets.flatMap((set) => {
        const tasks = Array.isArray(set.content.tasks) ? set.content.tasks : [];
        const setSearchableText = [
          set.title,
          set.display_date,
          set.content.description,
        ]
          .join(" ")
          .toLowerCase();
        const setMatches = setSearchableText.includes(activePastSearch);

        return tasks.flatMap((task) => {
          if (task.type !== pastSearchTaskType) return [];

          if (task.type === "sentence") {
            const questionMatches = task.questions.filter((question) =>
              [
                question.contextSpeaker,
                question.contextSentence,
                question.answerSpeaker,
                question.target,
                renderFullAnswer(question),
              ]
                .join(" ")
                .toLowerCase()
                .includes(activePastSearch)
            );
            const questionsToShow =
              questionMatches.length > 0
                ? questionMatches
                : setMatches
                  ? [undefined]
                  : [];

            return questionsToShow.map((question, index) => ({
              key: `${set.id}-sentence-${question?.id ?? index}`,
              title: question
                ? getPastExamTaskDisplayTopic(task, question)
                : getOfficialQuestionsDisplayText(set.title),
              description: `${pastSearchType} · ${set.display_date || "No date"}`,
              selection: {
                item: set,
                type: "sentence" as const,
                task,
                question,
              },
            }));
          }

          const taskSearchableText = [
            setSearchableText,
            task.title,
            JSON.stringify(task.prompt),
          ]
            .join(" ")
            .toLowerCase();

          if (!taskSearchableText.includes(activePastSearch)) return [];

          return [
            {
              key: `${set.id}-${task.type}-${task.title || "task"}`,
              title: getPastExamTaskDisplayTopic(task),
              description: `${pastSearchType} · ${set.display_date || "No date"}`,
              selection: {
                item: set,
                type: task.type,
                task,
              } as PastExamPreviewSelection,
            },
          ];
        });
      })
    : [];
  const filteredSearchedPastExamEntries = searchedPastExamEntries.filter(
    (entry) =>
      matchesCompletionFilter(
        isQuestionSetTaskDone(entry.selection.task),
        previewCompletionFilter
      )
  );

  function updatePastSearchInput(value: string) {
    setPastSearchInput(value);

    if (!value.trim()) {
      setAppliedPastSearch("");
      setPreviewBankPage(1);
      setPreviewExpandedMonths([]);
      setPreviewExpandedDates([]);
    }
  }

  function togglePreviewRandomType(type: PastExamPracticeType) {
    setPreviewRandomTypes((current) => {
      if (current.includes(type)) {
        return current.filter((item) => item !== type);
      }

      return [...current, type];
    });
  }

  function toggleAiPracticeType(type: PastExamPracticeType) {
    setSelectedAiPracticeTypes((current) =>
      current.includes(type)
        ? current.filter((item) => item !== type)
        : [...current, type]
    );
  }

  function startSelectedAiPracticeFromModal() {
    if (selectedAiPracticeTypes.length === 0) return;

    const orderedTypes = (
      ["sentence", "email", "discussion"] as PastExamPracticeType[]
    ).filter((type) => selectedAiPracticeTypes.includes(type));
    void onStartSelectedPractice(orderedTypes);
  }

  function startPreviewPastRandom() {
    if (
      previewPastRandomMode === "custom" &&
      previewRandomTypes.length === 0
    ) return;

    setPreviewRandomModal(null);
    onStartPastExamRandom({
      selectedTypes:
        previewPastRandomMode === "exam_set"
          ? ["sentence", "email", "discussion"]
          : previewRandomTypes,
      practiceMode: previewPastRandomMode,
      sentenceMode: previewSentenceRandomMode,
      sentenceSetId: previewSentenceSetId,
    });
  }

  function startPreviewEtsMockRandom() {
    if (previewRandomTypes.length === 0) return;

    setPreviewRandomModal(null);
    onStartEtsMockRandom({
      selectedTypes: previewRandomTypes,
      sentenceMode: previewSentenceRandomMode,
      sentenceSetId:
        previewSentenceRandomMode === "set"
          ? previewSentenceSetId || previewEtsMockSentenceSetOptions[0]?.item.id
          : undefined,
    });
  }

  function choosePreviewSentenceSetMode() {
    setPreviewSentenceRandomMode("set");

    const sentenceSetOptions =
      previewRandomModal === "mock"
        ? previewEtsMockSentenceSetOptions
        : previewSentenceSetOptions;
    if (
      !sentenceSetOptions.some(
        (option) => option.item.id === previewSentenceSetId
      ) &&
      sentenceSetOptions[0]
    ) {
      setPreviewSentenceSetId(sentenceSetOptions[0].item.id);
    }
  }

  function openPreviewPastBank(type: PastExamPracticeType) {
    setPreviewPastBank(type);
    setPreviewTopicFilter("all");
    setPreviewCompletionFilter("all");
    setPreviewSortOrder("desc");
    setPastSearchType(getSearchTypeForPastBank(type));
    setPastSearchInput("");
    setAppliedPastSearch("");
    setPreviewBankPage(1);
    setPreviewExpandedMonths([]);
    setPreviewExpandedDates([]);
  }

  function getPreviewPastBankTitle(type: PastExamPracticeType) {
    if (type === "sentence") return "Build a Sentence";
    if (type === "email") return "Email Writing";
    return "Academic Discussion";
  }

  function togglePreviewExpandedDate(date: string) {
    setPreviewExpandedDates((current) =>
      current.includes(date)
        ? current.filter((item) => item !== date)
        : [...current, date]
    );
  }

  function togglePreviewExpandedMonth(month: string) {
    setPreviewExpandedMonths((current) =>
      current.includes(month)
        ? current.filter((item) => item !== month)
        : [...current, month]
    );
  }

  const unreadNotificationCount = userNotifications.filter(
    (notification) => !notification.readAt
  ).length;
  const latestUnreadNotifications = userNotifications
    .filter((notification) => !notification.readAt)
    .slice(0, 5);
  const notificationPageCount = Math.max(
    1,
    Math.ceil(userNotifications.length / 6)
  );
  const visibleNotificationPage = Math.min(
    notificationPage,
    notificationPageCount
  );
  const paginatedNotifications = userNotifications.slice(
    (visibleNotificationPage - 1) * 6,
    visibleNotificationPage * 6
  );
  const selectedNotification =
    userNotifications.find(
      (notification) => notification.id === selectedNotificationId
    ) ||
    userNotifications[0] ||
    null;

  async function markNotificationRead(notificationId: string) {
    const readAt = new Date().toISOString();
    setUserNotifications((current) =>
      current.map((notification) =>
        notification.id === notificationId && !notification.readAt
          ? { ...notification, readAt }
          : notification
      )
    );

    const { error } = await supabase
      .from("user_notifications")
      .update({ read_at: readAt })
      .eq("id", notificationId)
      .is("read_at", null);
    if (error) console.error("Failed to mark notification as read:", error);
  }

  async function markAllNotificationsRead() {
    if (!user || unreadNotificationCount === 0) return;
    const readAt = new Date().toISOString();
    setUserNotifications((current) =>
      current.map((notification) =>
        notification.readAt ? notification : { ...notification, readAt }
      )
    );

    const { error } = await supabase
      .from("user_notifications")
      .update({ read_at: readAt })
      .eq("user_id", user.id)
      .is("read_at", null);
    if (error) console.error("Failed to mark notifications as read:", error);
  }

  function openNotification(notification: UserNotification) {
    if (!notification.readAt) void markNotificationRead(notification.id);
    setSelectedNotificationId(notification.id);
    const notificationIndex = userNotifications.findIndex(
      (item) => item.id === notification.id
    );
    if (notificationIndex >= 0) {
      setNotificationPage(Math.floor(notificationIndex / 6) + 1);
    }
    setShowNotifications(false);
    setShowNotificationDetail(true);
  }

  function openAllNotifications() {
    if (!selectedNotificationId && userNotifications[0]) {
      setSelectedNotificationId(userNotifications[0].id);
    }
    setNotificationPage(1);
    setShowNotifications(false);
    setShowNotificationDetail(true);
  }

  function goToNotificationPage(page: number) {
    const nextPage = Math.min(notificationPageCount, Math.max(1, page));
    const firstNotification = userNotifications[(nextPage - 1) * 6];
    setNotificationPage(nextPage);
    if (firstNotification) setSelectedNotificationId(firstNotification.id);
  }

  function followNotificationDestination(notification: UserNotification) {
    setShowNotificationDetail(false);

    if (notification.destination === "help") {
      goToPreviewPage("support");
      window.setTimeout(() => {
        const supportRecords = document.getElementById(
          "forge-support-records"
        ) as HTMLDetailsElement | null;
        if (supportRecords) {
          supportRecords.open = true;
          supportRecords.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 120);
    }
  }

  function renderNotificationBell() {
    return (
      <button
        type="button"
        className={`forge-notification-bell${
          unreadNotificationCount > 0 ? " has-unread" : ""
        }`}
        onClick={() => {
          const next = !showNotifications;
          setShowNotifications(next);
          if (next) setShowNotificationDetail(false);
        }}
        aria-label={
          unreadNotificationCount > 0
            ? `${unreadNotificationCount} 条未读通知`
            : "通知"
        }
        aria-expanded={showNotifications || showNotificationDetail}
        title="通知"
      >
        <MorphIcon
          icon={Bell}
          size={17}
          strokeWidth={2.1}
          reducedMotion="user"
          aria-hidden="true"
        />
        {unreadNotificationCount > 0 && (
          <span className="forge-notification-dot" aria-hidden="true" />
        )}
      </button>
    );
  }

  function renderSupportCenterButton() {
    return (
      <button
        type="button"
        className="forge-notification-bell"
        onClick={() => goToPreviewPage("support")}
        aria-label="联系客服"
        aria-current={previewPage === "support" ? "page" : undefined}
        title="联系客服"
      >
        <MorphIcon
          icon={Headphones}
          size={17}
          strokeWidth={2.1}
          reducedMotion="user"
          aria-hidden="true"
        />
      </button>
    );
  }

  function renderAuthBox() {
    if (isPasswordRecovery) {
      return (
        <div
          className="forge-auth-box"
          style={{
            ...cardStyle,
            padding: "16px 18px",
            marginBottom: "24px",
            display: "grid",
            gridTemplateColumns: "minmax(180px, 1fr) minmax(180px, 1fr) auto",
            gap: "12px",
            alignItems: "center",
          }}
        >
          <input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            placeholder="New password"
            style={{
              border: `1px solid ${line}`,
              borderRadius: softRadius,
              minHeight: "42px",
              padding: "0 12px",
              fontSize: "15px",
            }}
          />
          <input
            type="password"
            value={newPasswordConfirm}
            onChange={(event) => setNewPasswordConfirm(event.target.value)}
            placeholder="Confirm new password"
            style={{
              border: `1px solid ${line}`,
              borderRadius: softRadius,
              minHeight: "42px",
              padding: "0 12px",
              fontSize: "15px",
            }}
          />
          <button
            type="button"
            onClick={onUpdatePassword}
            disabled={isAuthLoading}
            style={{
              ...ctaStyle,
              minHeight: "42px",
              padding: "0 18px",
              fontSize: "14px",
              background: isAuthLoading ? "#9ca3af" : accent,
            }}
          >
            更新密码
          </button>
          {authMessage && (
            <p
              style={{
                gridColumn: "1 / -1",
                color:
                  authMessage.includes("success") ||
                  authMessage.includes("Please")
                    ? muted
                    : "#be123c",
                margin: 0,
                fontSize: "13px",
                fontWeight: 700,
              }}
            >
              {authMessage}
            </p>
          )}
        </div>
      );
    }

    if (user) {
      return (
        <div
          className="forge-desktop-user-bar"
          style={{
            position: "fixed",
            top: 0,
            left: sideWidth,
            right: 0,
            zIndex: 30,
            minHeight: "58px",
            padding: "17px 48px",
            boxSizing: "border-box",
            borderBottom: `1px solid ${line}`,
            background: "rgba(255, 255, 255, 0.96)",
            backdropFilter: "blur(14px)",
            color: accent,
            fontSize: "13px",
            fontWeight: 800,
            textAlign: "left",
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <span>Welcome, {user.email}</span>
          <button
            type="button"
            onClick={onSignOut}
            style={{
              border: `1px solid ${line}`,
              borderRadius: softRadius,
              background: "white",
              color: muted,
              padding: "4px 8px",
              fontSize: "12px",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            登出
          </button>
          <span style={{ marginLeft: "auto" }} />
          {renderSupportCenterButton()}
          {previewBackAvailable && (
            <button
              type="button"
              onClick={goBackPreviewPage}
              style={{
                border: `1px solid ${line}`,
                borderRadius: softRadius,
                background: "white",
                color: accent,
                padding: "5px 10px",
                fontSize: "12px",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              返回
            </button>
          )}
          {renderNotificationBell()}
        </div>
      );
    }

    return (
      <div
        className="forge-auth-box"
        style={{
          ...cardStyle,
          padding: "16px 18px",
          marginBottom: "24px",
          display: "grid",
          gridTemplateColumns: "minmax(180px, 1fr) minmax(160px, 0.8fr) auto auto",
          gap: "12px",
          alignItems: "center",
        }}
      >
        <input
          value={authEmail}
          onChange={(event) => setAuthEmail(event.target.value)}
          placeholder="Email"
          style={{
            border: `1px solid ${line}`,
            borderRadius: softRadius,
            minHeight: "42px",
            padding: "0 12px",
            fontSize: "15px",
          }}
        />
        <input
          type="password"
          value={authPassword}
          onChange={(event) => setAuthPassword(event.target.value)}
          placeholder="Password"
          style={{
            border: `1px solid ${line}`,
            borderRadius: softRadius,
            minHeight: "42px",
            padding: "0 12px",
            fontSize: "15px",
          }}
        />
        <button
          type="button"
          onClick={onSignIn}
          disabled={isAuthLoading}
          style={{
            ...ctaStyle,
            minHeight: "42px",
            padding: "0 18px",
            fontSize: "14px",
            background: isAuthLoading ? "#9ca3af" : accent,
          }}
        >
          登录
        </button>
        <button
          type="button"
          onClick={onSignUp}
          disabled={isAuthLoading}
          style={{
            minHeight: "42px",
            padding: "0 18px",
            border: `1px solid ${accent}`,
            borderRadius: softRadius,
            background: "white",
            color: accent,
            fontSize: "14px",
            fontWeight: 850,
            cursor: "pointer",
          }}
        >
          注册
        </button>
        <button
          type="button"
          onClick={() => {
            setShowForgotPassword(!showForgotPassword);
            setForgotPasswordEmail(forgotPasswordEmail || authEmail);
          }}
          style={{
            gridColumn: "1 / -1",
            justifySelf: "start",
            border: "none",
            background: "transparent",
            color: accent,
            padding: 0,
            fontSize: "13px",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          Forgot password?
        </button>
        {showForgotPassword && (
          <>
            <input
              value={forgotPasswordEmail}
              onChange={(event) => setForgotPasswordEmail(event.target.value)}
              placeholder="Email for password reset"
              style={{
                gridColumn: "1 / 3",
                border: `1px solid ${line}`,
                borderRadius: softRadius,
                minHeight: "42px",
                padding: "0 12px",
                fontSize: "15px",
              }}
            />
            <button
              type="button"
              onClick={onSendPasswordReset}
              disabled={isAuthLoading}
              style={{
                ...ctaStyle,
                gridColumn: "3 / 5",
                minHeight: "42px",
                padding: "0 18px",
                fontSize: "14px",
                background: isAuthLoading ? "#9ca3af" : accent,
              }}
            >
              发送重置邮件
            </button>
          </>
        )}
        {authMessage && (
          <p
            style={{
              gridColumn: "1 / -1",
              color: authMessage.includes("failed") ? "#be123c" : muted,
              margin: 0,
              fontSize: "13px",
              fontWeight: 700,
            }}
          >
            {authMessage}
          </p>
        )}
      </div>
    );
  }

  function renderLibraryToggle() {
    return (
      <div
        className="practice-library-switch"
        role="group"
        aria-label="题库类型切换"
      >
        <span
          aria-hidden="true"
          className={`practice-library-switch-indicator${
            libraryTab === "mock"
              ? " practice-library-switch-indicator--mock"
              : ""
          }`}
        />
        {[
          { key: "past" as const, label: "Official" },
          { key: "mock" as const, label: "Mock" },
        ].map((item) => {
          const selected = libraryTab === item.key;

          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setLibraryTab(item.key)}
              aria-pressed={selected}
              className={selected ? "is-selected" : undefined}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    );
  }

  function openPersonalizedPractice() {
    if (!isPro) {
      window.alert("个性化练习为 Pro 功能，请先兑换或升级会员。");
      return;
    }
    setSelectedPersonalizedTypes(["email", "discussion"]);
    setPersonalizedPreferredFocus(null);
    setShowPersonalizedPracticeSelector(true);
  }

  function openPersonalizedFromAnalysis(
    taskType: PersonalizedTaskType,
    topic: string
  ) {
    setPreviewPage("ai");
    setSelectedPersonalizedTypes([taskType]);
    setPersonalizedPreferredFocus({ taskType, topic });
    setShowPersonalizedPracticeSelector(true);
  }

  function togglePersonalizedPracticeType(type: PersonalizedTaskType) {
    setSelectedPersonalizedTypes((current) =>
      current.includes(type)
        ? current.filter((item) => item !== type)
        : [...current, type]
    );
  }

  async function startPersonalizedPracticeFromSelector() {
    if (selectedPersonalizedTypes.length === 0 || isStartingPersonalizedPractice) {
      return;
    }
    setIsStartingPersonalizedPractice(true);
    try {
      const started = await onStartPersonalizedPractice(
        selectedPersonalizedTypes,
        personalizedPreferredFocus
      );
      if (started) setShowPersonalizedPracticeSelector(false);
    } finally {
      setIsStartingPersonalizedPractice(false);
    }
  }

  function renderAiPage() {
    return (
      <>
        <section
          style={{
            ...cardStyle,
            marginBottom: "22px",
            padding: "20px 24px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "16px",
            flexWrap: "wrap",
          }}
        >
          <div>
            <h2 style={{ margin: "0 0 6px", fontSize: "20px" }}>
              单独练习计时模式
            </h2>
            <p style={{ margin: 0, color: muted }}>
              倒计时模式到点后会自动提交。
            </p>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            {(["countup", "countdown"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setPracticeTimerMode(mode)}
                style={{
                  padding: "10px 16px",
                  border:
                    practiceTimerMode === mode
                      ? `1px solid ${examGreen}`
                      : `1px solid ${line}`,
                  borderRadius: softRadius,
                  background: practiceTimerMode === mode ? examGreen : "white",
                  color: practiceTimerMode === mode ? "white" : ink,
                  fontWeight: 850,
                  cursor: "pointer",
                }}
              >
                {mode === "countup" ? "正计时" : "倒计时"}
              </button>
            ))}
          </div>
        </section>

        <article
          style={{
            ...cardStyle,
            padding: "24px 28px",
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: "28px",
            alignItems: "center",
          }}
        >
          <div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: "12px",
              }}
            >
              {[
                ["Build a Sentence", "客观得分"],
                ["Email Writing", "可选 AI 批改"],
                ["Academic Discussion", "可选 AI 批改"],
              ].map(([title, description]) => (
                <div
                  key={title}
                  style={{
                    borderLeft: `3px solid ${examGreen}`,
                    padding: "4px 14px",
                  }}
                >
                  <strong style={{ display: "block", fontSize: "16px" }}>
                    {title}
                  </strong>
                  <span style={{ color: muted, fontSize: "13px" }}>
                    {description}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowAiPracticeSelector(true)}
            style={{
              ...aiCtaStyle,
              minHeight: "48px",
              padding: "0 24px",
              fontSize: "16px",
              whiteSpace: "nowrap",
            }}
          >
            选择练习
          </button>
        </article>

        <article
          style={{
            ...cardStyle,
            padding: "24px 28px",
            marginTop: "22px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "24px",
            flexWrap: "wrap",
            textAlign: "left",
            background: "linear-gradient(135deg, #ffffff 0%, #f2f4ff 100%)",
          }}
        >
          <div style={{ flex: "1 1 420px", minWidth: 0, textAlign: "left" }}>
            <p style={{ margin: "0 0 7px", color: examGreen, fontSize: "12px", fontWeight: 900 }}>
              FORGE AI
            </p>
            <h2 style={{ margin: "0 0 8px", color: ink, fontSize: "24px", textAlign: "left" }}>
              Personalized Practice
            </h2>
            <p style={{ margin: 0, color: muted, lineHeight: 1.6, fontWeight: 700, textAlign: "left" }}>
              Practice what matters most. FORGE 根据近期表现选择下一道最适合的 Email 或 Discussion 练习。
            </p>
          </div>
          <button
            type="button"
            onClick={openPersonalizedPractice}
            style={{
              ...aiCtaStyle,
              minHeight: "48px",
              padding: "0 22px",
              whiteSpace: "nowrap",
              marginLeft: "auto",
            }}
          >
            {isPro ? "Start Practice" : "🔒 Pro"}
          </button>
        </article>

        <section
          id="forge-ai-practice-records"
          style={{
            ...cardStyle,
            marginTop: "22px",
            padding: "22px 24px",
            display: "grid",
            gap: "16px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "16px",
              flexWrap: "wrap",
            }}
          >
            <h3 style={{ margin: 0, fontSize: "20px" }}>练习记录</h3>
            <div style={{ display: "flex", gap: "7px", flexWrap: "wrap" }}>
              {([
                { type: "mock" as const, label: "完整练习" },
                { type: "sentence" as const, label: "Build a Sentence" },
                { type: "email" as const, label: "Email Writing" },
                {
                  type: "discussion" as const,
                  label: "Academic Discussion",
                },
              ]).map((item) => {
                const selected = aiRecordTypeFilters.includes(item.type);

                return (
                  <button
                    key={item.type}
                    type="button"
                    onClick={() => {
                      setAiRecordTypeFilters((current) =>
                        current.includes(item.type)
                          ? current.filter((type) => type !== item.type)
                          : [...current, item.type]
                      );
                      setAiRecordPage(1);
                    }}
                    style={{
                      border: `1px solid ${selected ? accent : line}`,
                      borderRadius: softRadius,
                      background: selected ? accent : "white",
                      color: selected ? "white" : ink,
                      padding: "7px 9px",
                      fontSize: "12px",
                      fontWeight: 850,
                      cursor: "pointer",
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  setAiRecordSortMode((mode) =>
                    mode === "score-desc" ? "score-asc" : "score-desc"
                  );
                  setAiRecordPage(1);
                }}
                style={{
                  border: `1px solid ${
                    aiRecordSortMode.startsWith("score") ? accent : line
                  }`,
                  borderRadius: softRadius,
                  background: aiRecordSortMode.startsWith("score")
                    ? accent
                    : "white",
                  color: aiRecordSortMode.startsWith("score") ? "white" : ink,
                  padding: "7px 9px",
                  fontSize: "12px",
                  fontWeight: 850,
                  cursor: "pointer",
                }}
              >
                分数{aiRecordSortMode === "score-asc" ? "低到高" : "高到低"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAiRecordSortMode((mode) =>
                    mode === "time-desc" ? "time-asc" : "time-desc"
                  );
                  setAiRecordPage(1);
                }}
                style={{
                  border: `1px solid ${
                    aiRecordSortMode.startsWith("time") ? accent : line
                  }`,
                  borderRadius: softRadius,
                  background: aiRecordSortMode.startsWith("time")
                    ? accent
                    : "white",
                  color: aiRecordSortMode.startsWith("time") ? "white" : ink,
                  padding: "7px 9px",
                  fontSize: "12px",
                  fontWeight: 850,
                  cursor: "pointer",
                }}
              >
                时间{aiRecordSortMode === "time-asc" ? "最早优先" : "最新优先"}
              </button>
            </div>
          </div>

          {pagedAiRecords.length === 0 ? (
            <div
              style={{
                border: `1px solid ${line}`,
                borderRadius: softRadius,
                background: "#fbfcff",
                padding: "16px",
                color: muted,
                fontWeight: 700,
              }}
            >
              暂无符合条件的练习记录。
            </div>
          ) : (
            <div style={{ display: "grid", gap: "8px" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1.2fr) 180px",
                  gap: "14px",
                  padding: "0 12px 6px",
                  color: muted,
                  fontSize: "13px",
                  fontWeight: 900,
                }}
              >
                <span>练习日期</span>
                <span>题型</span>
                <span style={{ textAlign: "right" }}>分数</span>
              </div>
              {pagedAiRecords.map((record) => {
                const scoreParts = getScoreDisplayParts(record.score);

                return (
                  <div
                    key={record.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpenRecordDetail(record.detail)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onOpenRecordDetail(record.detail);
                      }
                    }}
                    onContextMenu={(event) =>
                      onRecordContextMenu(event, record.deleteTarget)
                    }
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1.2fr) 180px",
                      gap: "14px",
                      alignItems: "center",
                      border: `1px solid ${line}`,
                      borderRadius: softRadius,
                      background: "#fbfcff",
                      padding: "12px",
                      color: ink,
                      fontSize: "14px",
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    <span>{new Date(record.date).toLocaleString()}</span>
                    <span>{record.typeLabel}</span>
                    <span
                      style={{
                        color: accent,
                        fontWeight: 900,
                        display: "grid",
                        gridTemplateColumns: "48px 16px 48px",
                        justifySelf: "end",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {scoreParts ? (
                        <>
                          <span style={{ textAlign: "right" }}>{scoreParts[0]}</span>
                          <span style={{ textAlign: "center" }}>/</span>
                          <span style={{ textAlign: "left" }}>{scoreParts[1]}</span>
                        </>
                      ) : (
                        <span style={{ gridColumn: "1 / -1", textAlign: "right" }}>
                          {record.score}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {filteredAiRecords.length > aiRecordsPerPage && (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: "14px",
              }}
            >
              <button
                type="button"
                disabled={normalizedAiRecordPage <= 1}
                onClick={() =>
                  setAiRecordPage((page) => Math.max(1, page - 1))
                }
                style={{
                  border: `1px solid ${line}`,
                  borderRadius: softRadius,
                  background:
                    normalizedAiRecordPage <= 1 ? "#f3f4f6" : "white",
                  color: normalizedAiRecordPage <= 1 ? "#9ca3af" : accent,
                  padding: "8px 14px",
                  fontSize: "13px",
                  fontWeight: 850,
                  cursor:
                    normalizedAiRecordPage <= 1 ? "not-allowed" : "pointer",
                }}
              >
                上一页
              </button>
              <span style={{ color: muted, fontSize: "13px", fontWeight: 800 }}>
                第 {normalizedAiRecordPage} / {aiRecordTotalPages} 页
              </span>
              <button
                type="button"
                disabled={normalizedAiRecordPage >= aiRecordTotalPages}
                onClick={() =>
                  setAiRecordPage((page) =>
                    Math.min(aiRecordTotalPages, page + 1)
                  )
                }
                style={{
                  border: `1px solid ${line}`,
                  borderRadius: softRadius,
                  background:
                    normalizedAiRecordPage >= aiRecordTotalPages
                      ? "#f3f4f6"
                      : "white",
                  color:
                    normalizedAiRecordPage >= aiRecordTotalPages
                      ? "#9ca3af"
                      : accent,
                  padding: "8px 14px",
                  fontSize: "13px",
                  fontWeight: 850,
                  cursor:
                    normalizedAiRecordPage >= aiRecordTotalPages
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                下一页
              </button>
            </div>
          )}
        </section>
      </>
    );
  }

  function renderDailyStatus(article: DailyArticle) {
    return article.publishDate < (todayDaily?.publishDate || "")
      ? "已学习"
      : "未学习";
  }

  function renderDailyTopicTag(article: DailyArticle) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "fit-content",
          minHeight: "34px",
          border: "none",
          borderRadius: softRadius,
          background: "#eefafa",
          color: examGreen,
          padding: "0 12px",
          fontSize: "14px",
          fontWeight: 950,
          whiteSpace: "nowrap",
        }}
      >
        {getDailyTopicCategory(article)}
      </span>
    );
  }

  function renderDailyCard(article: DailyArticle, featured = false) {
    return (
      <button
        key={article.id}
        type="button"
        onClick={() => openDailyArticle(article)}
        style={{
          ...cardStyle,
          padding: featured ? "30px" : "20px",
          textAlign: "left",
          cursor: "pointer",
          display: "grid",
          gap: featured ? "16px" : "10px",
          borderColor: featured ? accent : line,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "12px",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          {renderDailyTopicTag(article)}
          <span style={{ color: muted, fontSize: "13px", fontWeight: 800 }}>
            {article.publishDate} · {article.readingTime} min ·{" "}
            {article.relatedQuestionIds.length} related questions ·{" "}
            {renderDailyStatus(article)}
          </span>
        </div>
        <div>
          <h3
            style={{
              margin: "0 0 6px",
              fontSize: featured ? "30px" : "20px",
              lineHeight: 1.2,
            }}
          >
            {article.titleZh}
          </h3>
          <strong
            style={{
              display: "block",
              color: ink,
              fontSize: featured ? "22px" : "16px",
              lineHeight: 1.35,
            }}
          >
            {article.titleEn}
          </strong>
        </div>
        {article.subtitle && (
          <p style={{ margin: 0, color: muted, lineHeight: 1.6 }}>
            {article.subtitle}
          </p>
        )}
        {featured && (
          <span
            style={{
              ...aiCtaStyle,
              display: "inline-flex",
              width: "fit-content",
              alignItems: "center",
              minHeight: "44px",
              padding: "0 18px",
              fontSize: "15px",
            }}
          >
            开始今日学习
          </span>
        )}
      </button>
    );
  }

  function renderDailyLibraryRow(article: DailyArticle) {
    const relatedText =
      article.relatedQuestionIds.length > 0
        ? article.relatedQuestionIds.join("、")
        : "暂无关联";
    const status = renderDailyStatus(article);

    return (
      <button
        key={article.id}
        type="button"
        onClick={() => openDailyArticle(article)}
        style={{
          ...cardStyle,
          padding: "12px 14px",
          textAlign: "left",
          cursor: "pointer",
          display: "grid",
          gridTemplateColumns: "120px 110px minmax(220px, 1.4fr) 120px minmax(140px, 0.8fr) 90px",
          gap: "12px",
          alignItems: "center",
          minHeight: "58px",
        }}
      >
        <span style={{ color: muted, fontSize: "13px", fontWeight: 850 }}>
          {article.publishDate}
        </span>
        {renderDailyTopicTag(article)}
        <div style={{ minWidth: 0 }}>
          <strong
            style={{
              color: ink,
              fontSize: "16px",
              lineHeight: 1.25,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {article.titleZh}
          </strong>
        </div>
        <span style={{ color: ink, fontSize: "13px", fontWeight: 850 }}>
          {article.readingTime} minutes
        </span>
        <span
          title={relatedText}
          style={{
            color: muted,
            fontSize: "13px",
            fontWeight: 800,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          关联题目：{relatedText}
        </span>
        <span
          style={{
            border: `1px solid ${status === "已学习" ? examGreen : line}`,
            borderRadius: softRadius,
            color: status === "已学习" ? examGreen : muted,
            padding: "6px 8px",
            fontSize: "12px",
            fontWeight: 900,
            textAlign: "center",
            background: status === "已学习" ? "rgba(10, 127, 115, 0.08)" : "white",
          }}
        >
          {status}
        </span>
      </button>
    );
  }

  function renderDailyHomePage() {
    const recentDailyArticles = dailyArticles
      .filter((article) => article.slug !== todayDaily?.slug)
      .slice(0, 4);

    return (
      <div style={{ display: "grid", gap: "22px" }}>
        <section style={{ textAlign: "center" }}>
          <img
            src="/daily-logo-trimmed.png"
            alt="Daily"
            style={{
              display: "block",
              width: "118px",
              height: "auto",
              margin: "0 auto 8px",
              mixBlendMode: "multiply",
            }}
          />
        </section>

        {todayDaily ? (
          <section style={{ display: "grid", gap: "14px" }}>
            {renderDailyCard(todayDaily, true)}
          </section>
        ) : (
          <section style={{ ...cardStyle, padding: "28px", color: muted }}>
            今天的 Daily 正在准备中。
          </section>
        )}

        <section style={{ display: "grid", gap: "14px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "12px",
            }}
          >
            <strong style={{ color: ink, fontSize: "18px" }}>
              Recently on Daily
            </strong>
            <button
              type="button"
              onClick={() => setDailyView("library")}
              style={{
                border: "none",
                background: "transparent",
                color: accent,
                fontSize: "14px",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              View Daily Library →
            </button>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: "16px",
            }}
          >
            {recentDailyArticles.map((article) => renderDailyCard(article))}
          </div>
        </section>
      </div>
    );
  }

  function renderDailyLibraryPage() {
    return (
      <div style={{ display: "grid", gap: "20px" }}>
        <section style={{ ...cardStyle, padding: "24px", display: "grid", gap: "14px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "16px",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div>
              <h2 style={{ margin: "0 0 6px", fontSize: "26px" }}>
                Daily Library
              </h2>
              <p style={{ margin: 0, color: muted }}>
                探索过去的 Daily 话题，建立属于自己的写作素材库。
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDailyView("home")}
              style={{
                border: `1px solid ${line}`,
                borderRadius: softRadius,
                background: "white",
                color: accent,
                padding: "9px 12px",
                fontSize: "13px",
                fontWeight: 850,
                cursor: "pointer",
              }}
            >
              返回 Daily
            </button>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {dailyTopics.map((topic) => {
              const selected = dailyTopicFilter === topic;

              return (
                <button
                  key={topic}
                  type="button"
                  onClick={() => setDailyTopicFilter(topic)}
                  style={{
                    border: `1px solid ${selected ? accent : line}`,
                    borderRadius: softRadius,
                    background: selected ? accent : "white",
                    color: selected ? "white" : ink,
                    padding: "8px 10px",
                    fontSize: "13px",
                    fontWeight: 850,
                    cursor: "pointer",
                  }}
                >
                  {topic}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() =>
                setDailySortOrder((order) => (order === "desc" ? "asc" : "desc"))
              }
              style={{
                border: `1px solid ${line}`,
                borderRadius: softRadius,
                background: "white",
                color: accent,
                padding: "8px 10px",
                fontSize: "13px",
                fontWeight: 850,
                cursor: "pointer",
              }}
            >
              日期{dailySortOrder === "desc" ? "最新优先" : "最早优先"}
            </button>
          </div>
          <input
            value={dailySearchInput}
            onChange={(event) => setDailySearchInput(event.target.value)}
            placeholder="搜索 Title / Topic / Keywords / Core Ideas"
            style={{
              border: `1px solid ${line}`,
              borderRadius: softRadius,
              minHeight: "46px",
              padding: "0 14px",
              fontSize: "15px",
              outline: "none",
            }}
          />
        </section>

        {filteredDailyArticles.length === 0 ? (
          <div style={{ ...cardStyle, padding: "24px", color: muted }}>
            没有找到匹配的 Daily。
          </div>
        ) : (
          <div style={{ display: "grid", gap: "14px" }}>
            {filteredDailyArticles.map((article) => renderDailyLibraryRow(article))}
          </div>
        )}
      </div>
    );
  }

  function renderDailyLearningBlock(
    title: string,
    content: { label: string; text: string }[]
  ) {
    return (
      <section
        style={{
          ...cardStyle,
          padding: "24px",
          display: "grid",
          gap: "12px",
          textAlign: "left",
        }}
      >
        <h3 style={{ margin: 0, fontSize: "20px" }}>{title}</h3>
        {content.map((item) => (
          <div key={item.label}>
            <span
              style={{
                display: "inline-block",
                color: accent,
                fontSize: "12px",
                fontWeight: 950,
                marginBottom: "5px",
              }}
            >
              {item.label}
            </span>
            <p style={{ margin: 0, color: ink, lineHeight: 1.75 }}>
              {item.text}
            </p>
          </div>
        ))}
      </section>
    );
  }

  function renderDailyDetailPage() {
    if (!selectedDailyArticle) {
      return (
        <div style={{ ...cardStyle, padding: "24px", color: muted }}>
          这篇 Daily 暂时不存在。
        </div>
      );
    }

    const relatedQuestions = selectedDailyArticle.relatedQuestionIds
      .map((id) => pastExamSets.find((set) => set.id === id))
      .filter(Boolean)
      .sort((left, right) => {
        const leftTime = Date.parse(left?.display_date || "");
        const rightTime = Date.parse(right?.display_date || "");
        return (
          (Number.isNaN(rightTime) ? 0 : rightTime) -
          (Number.isNaN(leftTime) ? 0 : leftTime)
        );
      }) as QuestionSet[];
    const relatedQuestionsPerPage = 4;
    const relatedQuestionTotalPages = Math.max(
      1,
      Math.ceil(relatedQuestions.length / relatedQuestionsPerPage)
    );
    const normalizedDailyRelatedPage = Math.min(
      dailyRelatedPage,
      relatedQuestionTotalPages
    );
    const pagedRelatedQuestions = relatedQuestions.slice(
      (normalizedDailyRelatedPage - 1) * relatedQuestionsPerPage,
      normalizedDailyRelatedPage * relatedQuestionsPerPage
    );
    const dailySectionTabs = [
      { key: "perspectiveA" as const, label: "01 Background" },
      { key: "perspectiveB" as const, label: "02 Perspective A" },
      { key: "counterargument" as const, label: "03 Perspective B" },
      { key: "ideaBank" as const, label: "04 Counterargument" },
      { key: "practice" as const, label: "05 Idea Bank / Practice" },
    ];

    function renderActiveDailySection() {
      if (dailyDetailSection === "perspectiveA") {
        return renderDailyLearningBlock("01 Background", [
          { label: "Topic", text: selectedDailyArticle.topic },
          {
            label: "Difficulty",
            text: selectedDailyArticle.difficulty || "Intermediate",
          },
          {
            label: "Reading Time",
            text: `${selectedDailyArticle.readingTime} min`,
          },
          { label: "Focus", text: selectedDailyArticle.focus.join(" · ") },
          { label: "背景导入", text: selectedDailyArticle.background },
        ]);
      }

      if (dailyDetailSection === "perspectiveB") {
        return renderDailyLearningBlock("02 Perspective A", [
          { label: "观点", text: selectedDailyArticle.perspectiveA.claim },
          { label: "理由", text: selectedDailyArticle.perspectiveA.reasoning },
          { label: "解释", text: selectedDailyArticle.perspectiveA.explanation },
          { label: "例子", text: selectedDailyArticle.perspectiveA.example },
          {
            label: "结论",
            text: selectedDailyArticle.perspectiveA.conclusion || "",
          },
        ]);
      }

      if (dailyDetailSection === "counterargument") {
        return renderDailyLearningBlock("03 Perspective B", [
          { label: "观点", text: selectedDailyArticle.perspectiveB.claim },
          { label: "理由", text: selectedDailyArticle.perspectiveB.reasoning },
          { label: "解释", text: selectedDailyArticle.perspectiveB.explanation },
          { label: "例子", text: selectedDailyArticle.perspectiveB.example },
          {
            label: "结论",
            text: selectedDailyArticle.perspectiveB.conclusion || "",
          },
        ]);
      }

      if (dailyDetailSection === "ideaBank") {
        return renderDailyLearningBlock("04 Counterargument", [
          { label: "反驳对象", text: selectedDailyArticle.counterargument.target },
          { label: "承认", text: selectedDailyArticle.counterargument.concession },
          { label: "限制", text: selectedDailyArticle.counterargument.limitation },
          { label: "反驳", text: selectedDailyArticle.counterargument.rebuttal },
          { label: "结论", text: selectedDailyArticle.counterargument.conclusion },
          {
            label: "可迁移结构",
            text: `${selectedDailyArticle.counterargument.pattern} ${selectedDailyArticle.counterargument.patternUsage}`,
          },
        ]);
      }

      return (
        <section
          style={{
            ...cardStyle,
            padding: "24px",
            display: "grid",
            gap: "18px",
            textAlign: "left",
          }}
        >
          <div style={{ display: "grid", gap: "16px" }}>
            <h3 style={{ margin: 0, fontSize: "20px" }}>05 Idea Bank</h3>
            <div>
              <strong>核心观点</strong>
              <ul style={{ margin: "10px 0 0", color: ink, lineHeight: 1.7 }}>
                {selectedDailyArticle.ideaBank.ideas.map((idea) => (
                  <li key={idea}>{idea}</li>
                ))}
              </ul>
            </div>
            <div>
              <strong>Useful Expressions</strong>
              <div style={{ display: "grid", gap: "10px", marginTop: "10px" }}>
                {selectedDailyArticle.ideaBank.expressions.map((item) => (
                  <div
                    key={item.expression}
                    style={{
                      border: `1px solid ${line}`,
                      borderRadius: softRadius,
                      padding: "12px",
                      background: "#fbfcff",
                    }}
                  >
                    <strong>{item.expression}</strong>
                    <p
                      style={{ margin: "6px 0 0", color: muted, lineHeight: 1.6 }}
                    >
                      {item.meaning}
                      {item.usage ? ` · ${item.usage}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div
            style={{
              borderTop: `1px solid ${line}`,
              paddingTop: "18px",
              display: "grid",
              gap: "12px",
            }}
          >
            <h3 style={{ margin: 0, fontSize: "20px" }}>
              Put It Into Practice
            </h3>
            <p style={{ margin: 0, color: muted }}>
              刚刚学到的观点，可以用在这些题目中。
            </p>
            {relatedQuestions.length === 0 ? (
              <div style={{ color: muted, fontWeight: 700 }}>
                暂无手动关联的练习题。
              </div>
            ) : (
              <>
                {pagedRelatedQuestions.map((question) => {
                  const task =
                    question.content.tasks?.find(
                      (item) =>
                        item.type === "discussion" ||
                        item.type === "email" ||
                        item.type === "sentence"
                    ) || question.content.tasks?.[0];

                  if (!task) return null;

                  return (
                    <button
                      key={question.id}
                      type="button"
                      onClick={() => {
                        window.sessionStorage.setItem(
                          "forge-daily-detail-slug",
                          selectedDailyArticle.slug
                        );
                        onOpenPastExamSelection(
                          {
                            item: question,
                            type: task.type,
                            task,
                          },
                          { ...getPreviewRestoreState(), page: "daily" }
                        );
                      }}
                      style={{
                        ...cardStyle,
                        padding: "14px 16px",
                        textAlign: "left",
                        cursor: "pointer",
                        display: "grid",
                        gap: "6px",
                      }}
                    >
                      <span style={{ color: muted, fontSize: "12px", fontWeight: 850 }}>
                        {question.display_date || "No date"} ·{" "}
                        {task.type === "sentence"
                          ? "Build a Sentence"
                          : task.type === "email"
                            ? "Email Writing"
                            : "Academic Discussion"}
                      </span>
                      <strong style={{ color: ink }}>{question.title}</strong>
                    </button>
                  );
                })}
                {relatedQuestions.length > relatedQuestionsPerPage && (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: "10px",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ color: muted, fontSize: "13px", fontWeight: 800 }}>
                      {normalizedDailyRelatedPage} / {relatedQuestionTotalPages}
                    </span>
                    <button
                      type="button"
                      disabled={normalizedDailyRelatedPage <= 1}
                      onClick={() =>
                        setDailyRelatedPage((page) => Math.max(1, page - 1))
                      }
                      style={{
                        border: `1px solid ${line}`,
                        borderRadius: softRadius,
                        background: "white",
                        color:
                          normalizedDailyRelatedPage <= 1 ? "#9ca3af" : accent,
                        padding: "8px 12px",
                        fontSize: "13px",
                        fontWeight: 850,
                        cursor:
                          normalizedDailyRelatedPage <= 1
                            ? "not-allowed"
                            : "pointer",
                      }}
                    >
                      上一页
                    </button>
                    <button
                      type="button"
                      disabled={
                        normalizedDailyRelatedPage >= relatedQuestionTotalPages
                      }
                      onClick={() =>
                        setDailyRelatedPage((page) =>
                          Math.min(relatedQuestionTotalPages, page + 1)
                        )
                      }
                      style={{
                        border: `1px solid ${line}`,
                        borderRadius: softRadius,
                        background: "white",
                        color:
                          normalizedDailyRelatedPage >= relatedQuestionTotalPages
                            ? "#9ca3af"
                            : accent,
                        padding: "8px 12px",
                        fontSize: "13px",
                        fontWeight: 850,
                        cursor:
                          normalizedDailyRelatedPage >= relatedQuestionTotalPages
                            ? "not-allowed"
                            : "pointer",
                      }}
                    >
                      下一页
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      );
    }

    return (
      <div
        style={{
          maxWidth: "980px",
          margin: "0 auto",
          display: "grid",
          gap: "18px",
          textAlign: "left",
        }}
      >
        <button
          type="button"
          onClick={() => setDailyView(dailyDetailReturnView)}
          style={{
            width: "fit-content",
            border: `1px solid ${line}`,
            borderRadius: softRadius,
            background: "white",
            color: accent,
            padding: "9px 12px",
            fontSize: "13px",
            fontWeight: 850,
            cursor: "pointer",
          }}
        >
          返回
        </button>

        <section
          style={{
            ...cardStyle,
            padding: "28px",
            display: "grid",
            gap: "14px",
            textAlign: "left",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              flexWrap: "wrap",
            }}
          >
            {renderDailyTopicTag(selectedDailyArticle)}
            <span style={{ color: muted, fontSize: "13px", fontWeight: 850 }}>
              {selectedDailyArticle.difficulty} · {selectedDailyArticle.readingTime} min
            </span>
          </div>
          <h2 style={{ margin: 0, fontSize: "32px", lineHeight: 1.2 }}>
            {selectedDailyArticle.titleZh}
          </h2>
          <strong style={{ fontSize: "22px", lineHeight: 1.35 }}>
            {selectedDailyArticle.titleEn}
          </strong>
          <p style={{ margin: 0, color: muted, lineHeight: 1.7 }}>
            {selectedDailyArticle.background}
          </p>
        </section>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {dailySectionTabs.map((tab) => {
            const selected = dailyDetailSection === tab.key;

            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setDailyDetailSection(tab.key)}
                style={{
                  border: `1px solid ${selected ? accent : line}`,
                  borderRadius: softRadius,
                  background: selected ? accent : "white",
                  color: selected ? "white" : ink,
                  padding: "8px 10px",
                  fontSize: "13px",
                  fontWeight: 850,
                  cursor: "pointer",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {renderActiveDailySection()}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            disabled={!previousDaily}
            onClick={() => previousDaily && openDailyArticle(previousDaily)}
            style={{
              border: `1px solid ${line}`,
              borderRadius: softRadius,
              background: "white",
              color: previousDaily ? accent : "#9ca3af",
              padding: "10px 14px",
              fontWeight: 850,
              cursor: previousDaily ? "pointer" : "not-allowed",
            }}
          >
            Previous Daily
          </button>
          <button
            type="button"
            onClick={() => setDailyView("library")}
            style={{
              border: `1px solid ${accent}`,
              borderRadius: softRadius,
              background: "white",
              color: accent,
              padding: "10px 14px",
              fontWeight: 850,
              cursor: "pointer",
            }}
          >
            Back to Daily Library
          </button>
          <button
            type="button"
            disabled={!nextDaily}
            onClick={() => nextDaily && openDailyArticle(nextDaily)}
            style={{
              border: `1px solid ${line}`,
              borderRadius: softRadius,
              background: "white",
              color: nextDaily ? accent : "#9ca3af",
              padding: "10px 14px",
              fontWeight: 850,
              cursor: nextDaily ? "pointer" : "not-allowed",
            }}
          >
            Next Daily
          </button>
        </div>
      </div>
    );
  }

  function renderDailyPage() {
    const dailyComingSoon = true;

    if (dailyComingSoon) {
      return (
        <section
          style={{
            ...cardStyle,
            minHeight: "420px",
            padding: "48px 32px",
            display: "grid",
            placeItems: "center",
            textAlign: "center",
          }}
        >
          <div style={{ display: "grid", justifyItems: "center", gap: "16px" }}>
            <span
              aria-hidden="true"
              style={{
                width: "54px",
                height: "54px",
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                background: active,
                color: "#5365ff",
              }}
            >
              <MorphIcon
                icon={Sun}
                size={25}
                strokeWidth={2}
                reducedMotion="user"
              />
            </span>
            <p
              style={{
                margin: 0,
                color: examGreen,
                fontSize: "13px",
                fontWeight: 900,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              Daily
            </p>
            <h2 style={{ margin: 0, color: ink, fontSize: "38px" }}>
              Coming Soon
            </h2>
            <p style={{ margin: 0, color: muted, fontSize: "16px" }}>
              Daily 功能正在准备中，敬请期待。
            </p>
          </div>
        </section>
      );
    }

    if (dailyView === "detail") return renderDailyDetailPage();
    if (dailyView === "library") return renderDailyLibraryPage();
    return renderDailyHomePage();
  }

  function renderLibraryCard({
    title,
    description,
    action,
    meta,
    locked = false,
  }: {
    title: string;
    description: string;
    action: () => void | Promise<void>;
    meta?: string;
    locked?: boolean;
  }) {
    return (
      <button
        className="question-bank-library-card"
        key={title}
        type="button"
        onClick={locked ? () => goToPreviewPage("store") : action}
        style={{
          ...cardStyle,
          padding: "22px 24px",
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: "18px",
          alignItems: "center",
          textAlign: "left",
          cursor: "pointer",
          opacity: locked ? 0.78 : 1,
        }}
      >
        <span>
          <strong style={{ display: "block", fontSize: "22px" }}>{title}</strong>
          <span
            style={{
              display: "block",
              color: muted,
              marginTop: "6px",
              fontSize: "16px",
            }}
          >
            {description}
          </span>
        </span>
        <span style={{ color: accent, fontSize: "16px", fontWeight: 900 }}>
          {locked ? "🔒 PRO" : `${meta || "OPEN"} →`}
        </span>
      </button>
    );
  }

  function renderPastExamLibrary() {
    if (previewPastBank) {
      return (
        <div style={{ display: "grid", gap: "18px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              flexWrap: "nowrap",
              overflowX: "auto",
              paddingBottom: "2px",
            }}
          >
            <button
              type="button"
              onClick={() => setPreviewPastBank(null)}
              style={{
                border: `1px solid ${line}`,
                borderRadius: softRadius,
                background: "white",
                color: ink,
                padding: "10px 14px",
                fontSize: "14px",
                fontWeight: 850,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              返回上一层
            </button>

            <strong
              style={{
                fontSize: "16px",
                color: ink,
                whiteSpace: "nowrap",
                marginRight: "4px",
              }}
            >
              {getPreviewPastBankTitle(previewPastBank)}
            </strong>

            {activeTopicFilters.map((topic) => {
              const selected = previewTopicFilter === topic;
              const count =
                topic === "all"
                  ? pastExamSets.filter((set) =>
                      (set.content.tasks || []).some(
                        (task) => task.type === previewPastBank
                      )
                    ).length
                  : pastExamSets.filter((set) =>
                      (set.content.tasks || []).some(
                        (task) =>
                          task.type === previewPastBank &&
                          previewPastBank !== "sentence" &&
                          getPastExamTaskTheme(task) === topic
                      )
                    ).length;

              return (
                <button
                  key={topic}
                  type="button"
                  onClick={() => {
                    setPreviewTopicFilter(topic);
                    setPreviewBankPage(1);
                    setPreviewExpandedMonths([]);
                    setPreviewExpandedDates([]);
                  }}
                  style={{
                    border: `1px solid ${selected ? accent : line}`,
                    borderRadius: "999px",
                    background: selected ? accent : "white",
                    color: selected ? "white" : ink,
                    padding: "8px 12px",
                    fontSize: "13px",
                    fontWeight: 850,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {topic === "all" ? "全部主题" : topic}
                  {previewPastBank !== "sentence" ? ` ${count}` : ""}
                </button>
              );
            })}

            {([
              ["all", "全部"],
              ["done", "已做过"],
              ["undone", "未做过"],
            ] as const).map(([value, label]) => {
              const selected = previewCompletionFilter === value;

              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setPreviewCompletionFilter(value);
                    setPreviewBankPage(1);
                    setPreviewExpandedMonths([]);
                    setPreviewExpandedDates([]);
                  }}
                  style={{
                    border: `1px solid ${selected ? examGreen : line}`,
                    borderRadius: "999px",
                    background: selected ? examGreen : "white",
                    color: selected ? "white" : ink,
                    padding: "8px 12px",
                    fontSize: "13px",
                    fontWeight: 850,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {label}
                </button>
              );
            })}

            <button
              type="button"
              onClick={() =>
                {
                  setPreviewSortOrder((value) =>
                    value === "desc" ? "asc" : "desc"
                  );
                  setPreviewBankPage(1);
                  setPreviewExpandedMonths([]);
                  setPreviewExpandedDates([]);
                }
              }
              style={{
                border: `1px solid ${accent}`,
                borderRadius: softRadius,
                background: "white",
                color: accent,
                padding: "8px 12px",
                fontSize: "13px",
                fontWeight: 850,
                cursor: "pointer",
                whiteSpace: "nowrap",
                marginLeft: "auto",
              }}
            >
              {previewSortOrder === "desc" ? "最新优先" : "最早优先"}
            </button>
          </div>

          <div style={{ display: "grid", gap: "10px" }}>
            {previewPastBankEntries.length === 0 && (
              <div style={{ ...cardStyle, padding: "22px", color: muted }}>
                暂无符合筛选条件的题目。
              </div>
            )}
            {previewPastBankMonthGroups.map((monthGroup) => (
              <PastExamMonthGroup
                key={`preview-${previewPastBank}-${monthGroup.month}`}
                month={getPreviewMonthLabel(monthGroup.month)}
                count={monthGroup.count}
                unit={previewPastBank === "sentence" ? "套" : "题"}
                expanded={previewExpandedMonths.includes(monthGroup.month)}
                onToggle={() => togglePreviewExpandedMonth(monthGroup.month)}
              >
                {monthGroup.dateGroups.map((group) => (
                  <PastExamDateGroup
                    key={`preview-${previewPastBank}-${group.date}`}
                    date={group.date}
                    count={group.entries.length}
                    unit={previewPastBank === "sentence" ? "套" : "题"}
                    expanded={previewExpandedDates.includes(group.date)}
                    onToggle={() => togglePreviewExpandedDate(group.date)}
                  >
                    {group.entries.map((entry) => (
                      <PastExamListCard
                        key={entry.key}
                        date=""
                        topic={entry.topic}
                        category={entry.category}
                        bestScore={entry.bestScore}
                        onClick={() =>
                          onOpenPastExamSelection(
                            entry.selection,
                            getPreviewRestoreState()
                          )
                        }
                      />
                    ))}
                  </PastExamDateGroup>
                ))}
              </PastExamMonthGroup>
            ))}
          </div>

          {allPreviewPastBankMonthGroups.length > previewBankMonthsPerPage && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "14px",
                marginTop: "2px",
              }}
            >
              <button
                type="button"
                disabled={normalizedPreviewBankPage <= 1}
                onClick={() => {
                  setPreviewBankPage((page) => Math.max(1, page - 1));
                  setPreviewExpandedMonths([]);
                  setPreviewExpandedDates([]);
                  window.scrollTo({ top: 0, behavior: "auto" });
                }}
                style={{
                  border: `1px solid ${line}`,
                  borderRadius: softRadius,
                  background:
                    normalizedPreviewBankPage <= 1 ? "#f3f4f6" : "white",
                  color: normalizedPreviewBankPage <= 1 ? "#9ca3af" : accent,
                  padding: "10px 18px",
                  fontSize: "14px",
                  fontWeight: 850,
                  cursor:
                    normalizedPreviewBankPage <= 1 ? "not-allowed" : "pointer",
                }}
              >
                上一页
              </button>
              <span
                style={{
                  color: muted,
                  fontSize: "14px",
                  fontWeight: 800,
                }}
              >
                第 {normalizedPreviewBankPage} / {previewPastBankTotalPages} 页
              </span>
              <button
                type="button"
                disabled={normalizedPreviewBankPage >= previewPastBankTotalPages}
                onClick={() => {
                  setPreviewBankPage((page) =>
                    Math.min(previewPastBankTotalPages, page + 1)
                  );
                  setPreviewExpandedMonths([]);
                  setPreviewExpandedDates([]);
                  window.scrollTo({ top: 0, behavior: "auto" });
                }}
                style={{
                  border: `1px solid ${line}`,
                  borderRadius: softRadius,
                  background:
                    normalizedPreviewBankPage >= previewPastBankTotalPages
                      ? "#f3f4f6"
                      : "white",
                  color:
                    normalizedPreviewBankPage >= previewPastBankTotalPages
                      ? "#9ca3af"
                      : accent,
                  padding: "10px 18px",
                  fontSize: "14px",
                  fontWeight: 850,
                  cursor:
                    normalizedPreviewBankPage >= previewPastBankTotalPages
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                下一页
              </button>
            </div>
          )}
        </div>
      );
    }

    if (activePastSearch) {
      return (
        <div style={{ display: "grid", gap: "14px" }}>
          {filteredSearchedPastExamEntries.length === 0 && (
            <div style={{ ...cardStyle, padding: "22px", color: muted }}>
              没有找到匹配的题库。
            </div>
          )}
          {filteredSearchedPastExamEntries.map((entry) =>
            renderLibraryCard({
              title: entry.title,
              description: entry.description,
              action: () =>
                onOpenPastExamSelection(
                  entry.selection,
                  getPreviewRestoreState()
                ),
              meta: "进入",
            })
          )}
        </div>
      );
    }

    return (
      <div style={{ display: "grid", gap: "22px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: "18px",
          }}
        >
          {pastExamBankCards.map((item) => (
            <button
              className="question-bank-library-card question-bank-library-card--category"
              key={item.title}
              type="button"
              onClick={() => openPreviewPastBank(item.type)}
              style={{
                ...cardStyle,
                padding: "22px",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <h3 style={{ margin: "0 0 8px", fontSize: "22px" }}>
                {item.title}
              </h3>
              <p style={{ margin: "0 0 18px", color: muted }}>
                {item.description}
              </p>
              <span
                style={{
                  color: accent,
                  fontSize: "16px",
                  fontWeight: 900,
                }}
              >
                查看题库 →
              </span>
            </button>
          ))}
        </div>

        <section
          id="past-exam-practice-records"
          style={{
            ...cardStyle,
            padding: "22px 24px",
            display: "grid",
            gap: "16px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "16px",
              flexWrap: "wrap",
            }}
          >
            <h3 style={{ margin: 0, fontSize: "22px" }}>练习记录</h3>
            <div style={{ display: "flex", gap: "7px", flexWrap: "wrap" }}>
              {([
                { type: "mock" as const, label: "完整练习" },
                { type: "sentence" as const, label: "Build a Sentence" },
                { type: "email" as const, label: "Email Writing" },
                {
                  type: "discussion" as const,
                  label: "Academic Discussion",
                },
              ]).map((item) => {
                const selected = pastRecordTypeFilters.includes(item.type);

                return (
                  <button
                    key={item.type}
                    type="button"
                    onClick={() => {
                      setPastRecordTypeFilters((current) =>
                        current.includes(item.type)
                          ? current.filter((type) => type !== item.type)
                          : [...current, item.type]
                      );
                      setPastRecordPage(1);
                    }}
                    style={{
                      border: `1px solid ${selected ? accent : line}`,
                      borderRadius: softRadius,
                      background: selected ? accent : "white",
                      color: selected ? "white" : ink,
                      padding: "7px 9px",
                      fontSize: "12px",
                      fontWeight: 850,
                      cursor: "pointer",
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  setPastRecordSortMode((mode) =>
                    mode === "score-desc" ? "score-asc" : "score-desc"
                  );
                  setPastRecordPage(1);
                }}
                style={{
                  border: `1px solid ${
                    pastRecordSortMode.startsWith("score") ? accent : line
                  }`,
                  borderRadius: softRadius,
                  background: pastRecordSortMode.startsWith("score")
                    ? accent
                    : "white",
                  color: pastRecordSortMode.startsWith("score")
                    ? "white"
                    : ink,
                  padding: "7px 9px",
                  fontSize: "12px",
                  fontWeight: 850,
                  cursor: "pointer",
                }}
              >
                分数{pastRecordSortMode === "score-asc" ? "低到高" : "高到低"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPastRecordSortMode((mode) =>
                    mode === "time-desc" ? "time-asc" : "time-desc"
                  );
                  setPastRecordPage(1);
                }}
                style={{
                  border: `1px solid ${
                    pastRecordSortMode.startsWith("time") ? accent : line
                  }`,
                  borderRadius: softRadius,
                  background: pastRecordSortMode.startsWith("time")
                    ? accent
                    : "white",
                  color: pastRecordSortMode.startsWith("time") ? "white" : ink,
                  padding: "7px 9px",
                  fontSize: "12px",
                  fontWeight: 850,
                  cursor: "pointer",
                }}
              >
                时间{pastRecordSortMode === "time-asc" ? "最早优先" : "最新优先"}
              </button>
            </div>
          </div>

          {pagedPastExamRecordRows.length === 0 ? (
            <div
              style={{
                border: `1px solid ${line}`,
                borderRadius: softRadius,
                background: "#fbfcff",
                padding: "16px",
                color: muted,
                fontWeight: 700,
              }}
            >
              暂无符合条件的 Official Questions 练习记录。
            </div>
          ) : (
            <div style={{ display: "grid", gap: "8px" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "minmax(0, 1.2fr) minmax(0, 1.2fr) 180px",
                  gap: "14px",
                  padding: "0 12px 6px",
                  color: muted,
                  fontSize: "13px",
                  fontWeight: 900,
                }}
              >
                <span>练习日期</span>
                <span>题型</span>
                <span style={{ textAlign: "right" }}>分数</span>
              </div>
              {pagedPastExamRecordRows.map((record) => {
                const scoreParts = getScoreDisplayParts(record.score);

                return (
                  <div
                    key={record.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpenRecordDetail(record.detail)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onOpenRecordDetail(record.detail);
                      }
                    }}
                    onContextMenu={(event) =>
                      onRecordContextMenu(event, record.deleteTarget)
                    }
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "minmax(0, 1.2fr) minmax(0, 1.2fr) 180px",
                      gap: "14px",
                      alignItems: "center",
                      border: `1px solid ${line}`,
                      borderRadius: softRadius,
                      background: "#fbfcff",
                      padding: "12px",
                      color: ink,
                      fontSize: "14px",
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    <span>{new Date(record.date).toLocaleString()}</span>
                    <span>{record.typeLabel}</span>
                    <span
                      style={{
                        color: accent,
                        fontWeight: 900,
                        display: "grid",
                        gridTemplateColumns: "48px 16px 48px",
                        justifySelf: "end",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {scoreParts ? (
                        <>
                          <span style={{ textAlign: "right" }}>
                            {scoreParts[0]}
                          </span>
                          <span style={{ textAlign: "center" }}>/</span>
                          <span style={{ textAlign: "left" }}>
                            {scoreParts[1]}
                          </span>
                        </>
                      ) : (
                        <span
                          style={{ gridColumn: "1 / -1", textAlign: "right" }}
                        >
                          {record.score}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {filteredPastExamRecordRows.length > pastRecordsPerPage && (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: "14px",
              }}
            >
              <button
                type="button"
                disabled={normalizedPastRecordPage <= 1}
                onClick={() =>
                  setPastRecordPage((page) => Math.max(1, page - 1))
                }
                style={{
                  border: `1px solid ${line}`,
                  borderRadius: softRadius,
                  background:
                    normalizedPastRecordPage <= 1 ? "#f3f4f6" : "white",
                  color:
                    normalizedPastRecordPage <= 1 ? "#9ca3af" : accent,
                  padding: "8px 14px",
                  fontWeight: 850,
                  cursor:
                    normalizedPastRecordPage <= 1 ? "not-allowed" : "pointer",
                }}
              >
                上一页
              </button>
              <span style={{ color: muted, fontWeight: 800 }}>
                {normalizedPastRecordPage} / {pastRecordTotalPages}
              </span>
              <button
                type="button"
                disabled={normalizedPastRecordPage >= pastRecordTotalPages}
                onClick={() =>
                  setPastRecordPage((page) =>
                    Math.min(pastRecordTotalPages, page + 1)
                  )
                }
                style={{
                  border: `1px solid ${line}`,
                  borderRadius: softRadius,
                  background:
                    normalizedPastRecordPage >= pastRecordTotalPages
                      ? "#f3f4f6"
                      : "white",
                  color:
                    normalizedPastRecordPage >= pastRecordTotalPages
                      ? "#9ca3af"
                      : accent,
                  padding: "8px 14px",
                  fontWeight: 850,
                  cursor:
                    normalizedPastRecordPage >= pastRecordTotalPages
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                下一页
              </button>
            </div>
          )}
        </section>
      </div>
    );
  }

  function renderEtsMockLibrary() {
    const activeMockItems =
      etsMockLibrarySection === "tpo"
        ? tpoPreviewSets
        : originalMockPreviewSets;
    const filteredActiveMockItems = activeMockItems.filter((item) =>
      matchesCompletionFilter(
        isEtsMockSetDone(item),
        etsMockCompletionFilter
      )
    );
    const activeMockTitle =
      etsMockLibrarySection === "tpo" ? "TPO" : "ETS Mock";
    const activeMockEmptyMessage =
      etsMockLibrarySection === "tpo"
        ? "暂无 TPO 套题。"
        : "暂无 ETS Mock 套题。";

    return (
      <div style={{ display: "grid", gap: "22px" }}>
        <section style={{ display: "grid", gap: "14px" }}>
          <div className="ets-mock-library-heading">
            <div
              role="group"
              aria-label="ETS Mock 题库切换"
              className="ets-mock-library-switch"
            >
              <span
                aria-hidden="true"
                className={`ets-mock-library-switch-indicator ets-mock-library-switch-indicator--${etsMockLibrarySection}`}
              />
              {[
                { key: "tpo" as const, label: "TPO" },
                { key: "mock" as const, label: "ETS Mock" },
              ].map((item) => {
                const selected = etsMockLibrarySection === item.key;

                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setEtsMockLibrarySection(item.key)}
                    aria-pressed={selected}
                    className={selected ? "is-selected" : undefined}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
            <h3>{activeMockTitle}</h3>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              gap: "8px",
              flexWrap: "wrap",
            }}
          >
            {([
              ["all", "全部"],
              ["done", "已做过"],
              ["undone", "未做过"],
            ] as const).map(([value, label]) => {
              const selected = etsMockCompletionFilter === value;

              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setEtsMockCompletionFilter(value)}
                  style={{
                    border: `1px solid ${selected ? examGreen : line}`,
                    borderRadius: "999px",
                    background: selected ? examGreen : "white",
                    color: selected ? "white" : ink,
                    padding: "8px 12px",
                    fontSize: "13px",
                    fontWeight: 850,
                    cursor: "pointer",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {filteredActiveMockItems.map((item) =>
            renderLibraryCard({
              title: item.title,
              description: `${item.title} · 整套题练习`,
              action: () => onOpenEtsMockSet(item.id, getPreviewRestoreState()),
              meta: "套题",
              locked: !unlockedEtsMockIds.includes(item.id),
            })
          )}
          {filteredActiveMockItems.length === 0 && (
            <div style={{ ...cardStyle, padding: "22px", color: muted }}>
              {activeMockItems.length === 0
                ? activeMockEmptyMessage
                : "暂无符合筛选条件的套题。"}
            </div>
          )}
        </section>

        <section style={{ ...cardStyle, padding: "22px 24px" }}>
          <h3 style={{ margin: "0 0 14px", fontSize: "22px" }}>
            随机拼题记录
          </h3>
          {randomMockRecords.length === 0 && (
            <p style={{ margin: 0, color: muted }}>暂无随机拼题记录。</p>
          )}
          {randomMockRecords.map((record) => (
            <button
              key={`ets-random-${record.id}`}
              type="button"
              onClick={() =>
                onOpenRecordDetail({ kind: "mock-full", record })
              }
              style={{
                width: "100%",
                border: "none",
                borderTop: `1px solid ${line}`,
                background: "white",
                padding: "12px 0",
                display: "flex",
                justifyContent: "space-between",
                color: muted,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span>{new Date(record.created_at).toLocaleString()}</span>
              <strong style={{ color: accent }}>
                Final {Number(record.final_score).toFixed(1)} / 6.0
              </strong>
            </button>
          ))}
        </section>
      </div>
    );
  }

  function renderLibraryPage() {
    if (libraryTab === "past" && !hasQuestionBankAccess) {
      return (
        <>
          <div className="practice-library-switch-row">
            <div />
            {renderLibraryToggle()}
          </div>
          <section style={{ ...cardStyle, padding: "28px" }}>
            <span
              style={{
                display: "inline-flex",
                borderRadius: "999px",
                background: active,
                color: accent,
                padding: "7px 12px",
                fontSize: "12px",
                fontWeight: 950,
                marginBottom: "14px",
              }}
            >
              🔒 PRO CONTENT
            </span>
            <h2 style={{ margin: "0 0 8px", color: ink, fontSize: "26px" }}>
              升级 Pro 解锁完整 Official Questions 题库
            </h2>
            <p style={{ margin: "0 0 22px", color: muted, lineHeight: 1.7 }}>
              免费账户可以查看题库入口；Official Questions 内容、随机练习和完整模考仅向 Pro 开放。
            </p>
            <div style={{ display: "grid", gap: "12px", marginBottom: "22px" }}>
              {[
                ["Build a Sentence", "Official Questions 造句题与随机组题"],
                ["Email Writing", "历年邮件写作题库"],
                ["Academic Discussion", "历年学术讨论题库"],
              ].map(([title, description]) =>
                renderLibraryCard({
                  title,
                  description,
                  action: () => undefined,
                  locked: true,
                })
              )}
            </div>
            <button
              type="button"
              onClick={() => goToPreviewPage("store")}
              style={ctaStyle}
            >
              查看 Pro 方案
            </button>
          </section>
        </>
      );
    }

    return (
      <>
        <div className="practice-library-switch-row">
          <div />
          {renderLibraryToggle()}
        </div>

        <div style={{ marginBottom: "22px" }}>
          {libraryTab === "past"
            ? renderLibraryCard({
                title: "Official Questions 随机练习",
                description:
                  "可以自由随机题型，也可以随机选择同一场考试的完整 Set。",
                action: () => {
                  setPreviewRandomModal("past");
                  if (
                    previewSentenceRandomMode === "set" &&
                    !previewSentenceSetOptions.some(
                      (option) => option.item.id === previewSentenceSetId
                    )
                  ) {
                    setPreviewSentenceSetId(
                      previewSentenceSetOptions[0]?.item.id || ""
                    );
                  }
                },
                meta: "RANDOM",
              })
            : renderLibraryCard({
                title: "随机拼题练习",
                description:
                  "可随机练习一个或多个题型；造句支持随机 Set 或指定 Set。",
                action: () => {
                  setPreviewRandomModal("mock");
                  if (
                    previewSentenceRandomMode === "set" &&
                    !previewEtsMockSentenceSetOptions.some(
                      (option) => option.item.id === previewSentenceSetId
                    )
                  ) {
                    setPreviewSentenceSetId(
                      previewEtsMockSentenceSetOptions[0]?.item.id || ""
                    );
                  }
                },
                meta: "RANDOM",
                locked: unlockedEtsMockIds.length === 0,
              })}
        </div>

        {libraryTab === "past" && (
          <div style={{ ...cardStyle, padding: "24px 28px", marginBottom: "24px" }}>
            <div
              style={{
                display: "flex",
                gap: "10px",
                flexWrap: "wrap",
                marginBottom: "18px",
              }}
            >
              {(["Build a Sentence", "Email Writing", "Academic Discussion"] as const).map(
                (label) => {
                  const selected = pastSearchType === label;

                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => {
                        setPastSearchType(label);
                        if (previewPastBank) {
                          setPreviewPastBank(getPastBankForSearchType(label));
                          setPreviewTopicFilter("all");
                          setPreviewSortOrder("desc");
                          setPreviewBankPage(1);
                          setPreviewExpandedMonths([]);
                          setPreviewExpandedDates([]);
                        }
                        setPastSearchInput("");
                        setAppliedPastSearch("");
                      }}
                      style={{
                        border: `1px solid ${accent}`,
                        borderRadius: softRadius,
                        background: selected ? accent : "white",
                        color: selected ? "white" : accent,
                        padding: "10px 14px",
                        fontSize: "14px",
                        fontWeight: 850,
                        cursor: "pointer",
                      }}
                    >
                      {label}
                    </button>
                  );
                }
              )}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: "18px",
                alignItems: "center",
              }}
            >
              <input
                value={pastSearchInput}
                onChange={(event) => updatePastSearchInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    setAppliedPastSearch(pastSearchInput.trim());
                    setPreviewBankPage(1);
                    setPreviewExpandedMonths([]);
                    setPreviewExpandedDates([]);
                  }
                }}
                placeholder={`Search ${pastSearchType}`}
                style={{
                  border: `2px solid ${accent}`,
                  borderRadius: softRadius,
                  background: "white",
                  minHeight: "62px",
                  padding: "0 18px",
                  color: "#8a91aa",
                  textAlign: "left",
                  fontSize: "20px",
                  outline: "none",
                }}
              />
              <button
                type="button"
                onClick={() => {
                  setAppliedPastSearch(pastSearchInput.trim());
                  setPreviewBankPage(1);
                  setPreviewExpandedMonths([]);
                  setPreviewExpandedDates([]);
                }}
                style={ctaStyle}
              >
                SEARCH
              </button>
            </div>
          </div>
        )}

        {libraryTab === "past" ? renderPastExamLibrary() : renderEtsMockLibrary()}
      </>
    );
  }

  function renderHelpCenterPage() {
    const isSupportCenter = previewPage === "support";
    const supportStatusFlow: HelpSupportStatus[] = [
      "已提交",
      "处理中",
      "已处理",
      "已完成",
    ];

    async function submitSupportRequest() {
      if (!user) {
        window.alert("请先登录后再提交客服工单，以便同步处理进度。");
        return;
      }

      const replyEmail = (user?.email || helpSupportEmail).trim();

      if (!replyEmail) {
        window.alert("请填写用于接收回复的邮箱。");
        return;
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyEmail)) {
        window.alert("请填写有效的邮箱地址。");
        return;
      }

      if (!helpSupportMessage.trim()) {
        window.alert("请先写下你遇到的问题。");
        return;
      }

      setIsSubmittingSupportRequest(true);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        const response = await fetch("/api/support-ticket", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({ message: helpSupportMessage.trim() }),
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(payload.error || "客服工单提交失败，请稍后重试。");
        }

        const data = payload.ticket;
        if (data) {
          setHelpSupportTickets((current) => [
            {
              id: data.id,
              email: data.reply_email,
              message: data.message,
              createdAt: data.created_at,
              status: "已提交",
              cycle: Number(data.cycle || 1),
              supportReply: data.support_reply || "",
              repliedAt: data.replied_at || null,
              messages: (data.messages || []).map(
                (message: {
                  id: string;
                  sender: "user" | "support";
                  message: string;
                  cycle: number;
                  created_at: string;
                }) => ({
                  id: message.id,
                  sender: message.sender,
                  message: message.message,
                  cycle: Number(message.cycle || 1),
                  createdAt: message.created_at,
                })
              ),
            },
            ...current,
          ]);
        }
        setHelpSupportMessage("");
        if (!user?.email) setHelpSupportEmail("");
        window.alert("客服工单已提交，可在客服支持记录中查看处理进度和回复。");
      } catch (error) {
        console.error("Failed to submit support ticket:", error);
        window.alert(
          error instanceof Error
            ? error.message
            : "客服工单提交失败，请稍后重试。"
        );
      } finally {
        setIsSubmittingSupportRequest(false);
      }
    }

    async function submitSupportFollowUp(ticket: HelpSupportTicket) {
      const message = (supportFollowUpMessages[ticket.id] || "").trim();
      if (!message) {
        window.alert("请先填写你要继续提问的内容。");
        return;
      }

      setSubmittingSupportFollowUpId(ticket.id);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        const response = await fetch("/api/support-ticket", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({ ticketId: ticket.id, message }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "继续提问失败，请稍后重试。");
        }

        const data = payload.ticket;
        const statusLabels: Record<string, HelpSupportStatus> = {
          sent: "已提交",
          processing: "处理中",
          resolved: "已处理",
          closed: "已完成",
        };
        const updatedTicket: HelpSupportTicket = {
          id: data.id,
          email: data.reply_email,
          message: data.message,
          createdAt: data.created_at,
          status: statusLabels[data.status] || "已提交",
          cycle: Number(data.cycle || 1),
          supportReply: data.support_reply || "",
          repliedAt: data.replied_at || null,
          messages: (data.messages || []).map(
            (item: {
              id: string;
              sender: "user" | "support";
              message: string;
              cycle: number;
              created_at: string;
            }) => ({
              id: item.id,
              sender: item.sender,
              message: item.message,
              cycle: Number(item.cycle || 1),
              createdAt: item.created_at,
            })
          ),
        };

        setHelpSupportTickets((current) =>
          current.map((item) =>
            item.id === updatedTicket.id ? updatedTicket : item
          )
        );
        setSupportFollowUpMessages((current) => ({
          ...current,
          [ticket.id]: "",
        }));
        window.alert("你的补充问题已提交，工单已重新进入处理队列。");
      } catch (error) {
        console.error("Failed to submit support follow-up:", error);
        window.alert(
          error instanceof Error
            ? error.message
            : "继续提问失败，请稍后重试。"
        );
      } finally {
        setSubmittingSupportFollowUpId("");
      }
    }

    function renderHelpAnswer(item: { question: string; answer: string }) {
      const showScoringLinks = item.question === "FORGE 是怎么评分的？";

      return (
        <div style={{ marginTop: "12px" }}>
          <p
            style={{
              margin: 0,
              color: muted,
              lineHeight: 1.7,
              fontSize: "15px",
              whiteSpace: "pre-line",
            }}
          >
            {item.answer}
          </p>
          {showScoringLinks && (
            <div
              style={{
                display: "grid",
                gap: "8px",
                justifyItems: "start",
                marginTop: "14px",
              }}
            >
              <a
                href="/scoring-guide/email"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: examGreen,
                  fontSize: "14px",
                  fontWeight: 900,
                  textDecoration: "none",
                }}
              >
                点击查看 Email 评分标准
              </a>
              <a
                href="/scoring-guide/discussion"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: examGreen,
                  fontSize: "14px",
                  fontWeight: 900,
                  textDecoration: "none",
                }}
              >
                点击查看 Academic Discussion 评分标准
              </a>
            </div>
          )}
        </div>
      );
    }

    return (
      <div style={{ display: "grid", gap: "22px" }}>
        <section
          style={{
            ...cardStyle,
            padding: "26px 28px",
            display: "grid",
            gap: "18px",
          }}
        >
          <div>
            <h2 style={{ margin: "0 0 8px", fontSize: "28px" }}>
              {isSupportCenter ? "客服中心" : "Help Center"}
            </h2>
            <p style={{ margin: 0, color: muted, lineHeight: 1.6 }}>
              {isSupportCenter
                ? "创建客服工单、查看处理进度，并在已处理状态下继续提问。"
                : "搜索账户、Forge AI、Practice Tests、Daily、Analysis 和 Study Plan 相关问题。"}
            </p>
          </div>
          {!isSupportCenter && (
            <input
              value={helpSearchInput}
              onChange={(event) => setHelpSearchInput(event.target.value)}
              placeholder="搜索帮助文章"
              style={{
                border: `2px solid ${accent}`,
                borderRadius: softRadius,
                background: "white",
                minHeight: "56px",
                padding: "0 16px",
                color: ink,
                fontSize: "18px",
                outline: "none",
              }}
            />
          )}
        </section>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: isSupportCenter
              ? "minmax(0, 1fr)"
              : "260px minmax(0, 1fr)",
            gap: "22px",
            alignItems: "start",
          }}
        >
          {!isSupportCenter && <aside style={{ ...cardStyle, padding: "20px" }}>
            <strong
              style={{ display: "block", marginBottom: "14px", fontSize: "18px" }}
            >
              分类
            </strong>
            <div style={{ display: "grid", gap: "10px" }}>
              {helpCenterItems.map((section) => {
                const selected = activeHelpCategory === section.category;

                return (
                  <button
                    key={section.category}
                    type="button"
                    onClick={() => {
                      setActiveHelpCategory(section.category);
                      setHelpSearchInput("");
                    }}
                    style={{
                      border: `1px solid ${selected ? accent : line}`,
                      borderRadius: softRadius,
                      background: selected ? accent : "white",
                      color: selected ? "white" : accent,
                      padding: "10px 12px",
                      textAlign: "left",
                      fontSize: "14px",
                      fontWeight: 850,
                      cursor: "pointer",
                    }}
                  >
                    {section.category}
                  </button>
                );
              })}
            </div>
          </aside>}

          <div style={{ display: "grid", gap: "16px" }}>
            {!isSupportCenter && normalizedHelpSearch && helpSearchResults.length === 0 && (
              <div style={{ ...cardStyle, padding: "24px" }}>
                <strong style={{ display: "block", marginBottom: "8px" }}>
                  没有找到匹配的问题。
                </strong>
                <p style={{ margin: 0, color: muted, lineHeight: 1.6 }}>
                  可以换一个关键词，或通过下方入口前往客服中心。
                </p>
              </div>
            )}

            {!isSupportCenter && normalizedHelpSearch && helpSearchResults.length > 0 && (
              <section
                style={{ ...cardStyle, padding: "22px 24px" }}
              >
                <h3 style={{ margin: "0 0 14px", fontSize: "20px" }}>
                  搜索结果
                </h3>
                <div style={{ display: "grid", gap: "10px" }}>
                  {helpSearchResults.map((item) => (
                    <details
                      key={`${item.category}-${item.question}`}
                      style={{
                        border: `1px solid ${line}`,
                        borderRadius: softRadius,
                        background: "#fbfcff",
                        padding: "14px 16px",
                      }}
                    >
                      <summary
                        style={{
                          cursor: "pointer",
                          color: ink,
                          fontWeight: 900,
                          fontSize: "16px",
                        }}
                      >
                        {item.question}
                        <span
                          style={{
                            color: muted,
                            fontSize: "12px",
                            fontWeight: 800,
                            marginLeft: "10px",
                          }}
                        >
                          {item.category}
                        </span>
                      </summary>
                      {renderHelpAnswer(item)}
                    </details>
                  ))}
                </div>
              </section>
            )}

            {!isSupportCenter && !normalizedHelpSearch && filteredHelpQuestions.length > 0 && (
              <section
                key={activeHelpCenterSection.category}
                style={{ ...cardStyle, padding: "22px 24px" }}
              >
                <h3 style={{ margin: "0 0 14px", fontSize: "20px" }}>
                  {activeHelpCenterSection.category}
                </h3>
                <p style={{ margin: "0 0 14px", color: muted, lineHeight: 1.6 }}>
                  {activeHelpCenterSection.description}
                </p>
                <div style={{ display: "grid", gap: "10px" }}>
                  {filteredHelpQuestions.map((item) => (
                    <details
                      key={item.question}
                      style={{
                        border: `1px solid ${line}`,
                        borderRadius: softRadius,
                        background: "#fbfcff",
                        padding: "14px 16px",
                      }}
                    >
                      <summary
                        style={{
                          cursor: "pointer",
                          color: ink,
                          fontWeight: 900,
                          fontSize: "16px",
                        }}
                      >
                        {item.question}
                      </summary>
                      {renderHelpAnswer(item)}
                    </details>
                  ))}
                </div>
              </section>
            )}

            {!isSupportCenter && (
              <button
                type="button"
                onClick={() => goToPreviewPage("support")}
                style={{
                  ...cardStyle,
                  width: "100%",
                  padding: "22px 24px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "18px",
                  color: ink,
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                  <span
                    aria-hidden="true"
                    style={{
                      width: "38px",
                      height: "38px",
                      display: "grid",
                      placeItems: "center",
                      flex: "0 0 auto",
                      borderRadius: "50%",
                      background: "#eef8f8",
                      color: examGreen,
                    }}
                  >
                    <MorphIcon icon={Headphones} size={19} strokeWidth={2.1} reducedMotion="user" />
                  </span>
                  <span>
                    <strong style={{ display: "block", marginBottom: "5px", fontSize: "16px" }}>
                      需要联系客服？
                    </strong>
                    <span style={{ color: muted, fontSize: "13px", fontWeight: 700 }}>
                      前往客服中心创建工单或查看客服记录
                    </span>
                  </span>
                </span>
                <span style={{ color: examGreen, fontWeight: 900, whiteSpace: "nowrap" }}>
                  打开 →
                </span>
              </button>
            )}

            {isSupportCenter && (<details
              open
              style={{
                ...cardStyle,
                padding: "24px",
              }}
            >
              <summary
                style={{
                  cursor: "pointer",
                  color: ink,
                  fontSize: "16px",
                  fontWeight: 900,
                }}
              >
                创建客服工单
              </summary>
              <div
                style={{
                  display: "grid",
                  gap: "8px",
                  marginTop: "16px",
                }}
              >
                <label
                  style={{
                    color: ink,
                    fontSize: "14px",
                    fontWeight: 850,
                  }}
                >
                  账号邮箱
                </label>
                <input
                  value={user?.email || helpSupportEmail}
                  onChange={(event) => setHelpSupportEmail(event.target.value)}
                  disabled={Boolean(user?.email)}
                  placeholder="登录账号邮箱"
                  type="email"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    border: `1px solid ${line}`,
                    borderRadius: softRadius,
                    minHeight: "44px",
                    padding: "0 12px",
                    color: ink,
                    fontSize: "15px",
                    fontWeight: 750,
                    background: user?.email ? "#f8fafc" : "white",
                    outline: "none",
                  }}
                />
                <span
                  style={{
                    color: muted,
                    fontSize: "12px",
                    fontWeight: 750,
                  }}
                >
                  客服回复和处理进度会直接显示在下方工单记录中。
                </span>
              </div>
              <textarea
                value={helpSupportMessage}
                onChange={(event) => setHelpSupportMessage(event.target.value)}
                placeholder="描述一下你遇到的问题，例如：无法登录、题库搜索不到、练习记录没有显示..."
                rows={4}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  border: `1px solid ${line}`,
                  borderRadius: softRadius,
                  marginTop: "14px",
                  padding: "12px 14px",
                  color: ink,
                  fontSize: "15px",
                  lineHeight: 1.6,
                  resize: "vertical",
                  outline: "none",
                }}
              />
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  alignItems: "center",
                  gap: "16px",
                  marginTop: "16px",
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  onClick={submitSupportRequest}
                  disabled={isSubmittingSupportRequest}
                  style={{
                    ...ctaStyle,
                    minHeight: "44px",
                    padding: "0 18px",
                    fontSize: "14px",
                    opacity: isSubmittingSupportRequest ? 0.65 : 1,
                    cursor: isSubmittingSupportRequest ? "wait" : "pointer",
                  }}
                >
                  {isSubmittingSupportRequest ? "正在提交..." : "提交客服工单"}
                </button>
              </div>
            </details>)}

            {isSupportCenter && (<section
              id="forge-support-records"
              style={{
                ...cardStyle,
                padding: "24px",
              }}
            >
              <div
                style={{
                  color: ink,
                  fontSize: "16px",
                  fontWeight: 900,
                }}
              >
                客服支持记录
              </div>

              <p
                style={{
                  margin: "12px 0 0",
                  color: muted,
                  fontSize: "12px",
                  fontWeight: 750,
                }}
              >
                客服工单及对话记录自最后一次更新起保留一个月。
              </p>

              {helpSupportTickets.length === 0 && (
                <div
                  style={{
                    border: `1px solid ${line}`,
                    borderRadius: softRadius,
                    background: "#fbfcff",
                    marginTop: "16px",
                    padding: "16px",
                    color: muted,
                    fontWeight: 700,
                  }}
                >
                  暂无客服支持记录。
                </div>
              )}

              {helpSupportTickets.map((ticket) => {
                const statusIndex = supportStatusFlow.indexOf(ticket.status);
                const conversationMessages =
                  ticket.messages.length > 0
                    ? ticket.messages
                    : [
                        {
                          id: `${ticket.id}-initial`,
                          sender: "user" as const,
                          message: ticket.message,
                          cycle: 1,
                          createdAt: ticket.createdAt,
                        },
                        ...(ticket.supportReply
                          ? [
                              {
                                id: `${ticket.id}-legacy-reply`,
                                sender: "support" as const,
                                message: ticket.supportReply,
                                cycle: ticket.cycle,
                                createdAt:
                                  ticket.repliedAt || ticket.createdAt,
                              },
                            ]
                          : []),
                      ];

                const statusTone =
                  ticket.status === "已完成"
                    ? { color: "#667085", background: "#f2f4f7", border: "#d0d5dd" }
                    : ticket.status === "已处理"
                      ? { color: examGreen, background: "#ecfdf9", border: "#99e0d3" }
                      : { color: accent, background: "#f3f2ff", border: line };

                return (
                  <details
                    key={ticket.id}
                    open={selectedSupportTicketId === ticket.id}
                    style={{
                      border: `1px solid ${line}`,
                      borderRadius: softRadius,
                      background: "white",
                      marginTop: "16px",
                      overflow:
                        selectedSupportTicketId === ticket.id
                          ? "visible"
                          : "hidden",
                    }}
                  >
                    <summary
                      className="forge-support-ticket-row"
                      onClick={(event) => {
                        event.preventDefault();
                        setSelectedSupportTicketId(ticket.id);
                      }}
                      style={{
                        listStyle: "none",
                        cursor: "pointer",
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1fr) minmax(190px, 0.45fr) auto",
                        gap: "20px",
                        alignItems: "center",
                        padding: "15px 16px",
                        background: "#fbfcff",
                        textAlign: "left",
                      }}
                    >
                      <div className="forge-support-ticket-title" style={{ minWidth: 0 }}>
                        <strong
                          style={{
                            display: "block",
                            fontSize: "15px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {ticket.message.length > 64
                            ? `${ticket.message.slice(0, 64)}...`
                            : ticket.message}
                        </strong>
                      </div>
                      <span
                        className="forge-support-ticket-meta"
                        style={{
                          color: muted,
                          fontSize: "13px",
                          fontWeight: 700,
                          whiteSpace: "nowrap",
                          textAlign: "left",
                        }}
                      >
                        {new Date(ticket.createdAt).toLocaleString()} · 第{" "}
                        {ticket.cycle} 轮
                      </span>
                      <span
                        className="forge-support-ticket-status"
                        style={{ display: "flex", alignItems: "center", gap: "10px" }}
                      >
                        <span
                          style={{
                            border: `1px solid ${statusTone.border}`,
                            borderRadius: "999px",
                            color: statusTone.color,
                            background: statusTone.background,
                            padding: "5px 10px",
                            fontSize: "12px",
                            fontWeight: 900,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {ticket.status}
                        </span>
                        <span aria-hidden="true" style={{ color: muted, fontWeight: 900 }}>
                          ›
                        </span>
                      </span>
                    </summary>

                    <button
                      type="button"
                      className="forge-support-modal-backdrop"
                      onClick={() => setSelectedSupportTicketId("")}
                      aria-label="关闭工单详情"
                      style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 100,
                        border: 0,
                        background: "rgba(15, 23, 42, 0.46)",
                        cursor: "default",
                      }}
                    />

                    <div
                      role="dialog"
                      aria-modal="true"
                      aria-label="客服工单详情"
                      style={{
                        position: "fixed",
                        zIndex: 101,
                        left: "50%",
                        top: "50%",
                        transform: "translate(-50%, -50%)",
                        width: "min(760px, calc(100vw - 32px))",
                        maxHeight: "min(760px, calc(100svh - 40px))",
                        overflowY: "auto",
                        boxSizing: "border-box",
                        display: "grid",
                        gap: "14px",
                        padding: "24px",
                        border: `1px solid ${line}`,
                        borderRadius: "18px",
                        background: "white",
                        boxShadow: "0 28px 70px rgba(15, 23, 42, 0.24)",
                        color: ink,
                        textAlign: "left",
                      }}
                    >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: "18px",
                        paddingBottom: "14px",
                        borderBottom: `1px solid ${line}`,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <span style={{ color: examGreen, fontSize: "12px", fontWeight: 900 }}>
                          客服工单详情
                        </span>
                        <h3 style={{ margin: "6px 0 7px", fontSize: "20px", lineHeight: 1.4 }}>
                          {ticket.message}
                        </h3>
                        <span style={{ color: muted, fontSize: "13px", fontWeight: 700 }}>
                          {new Date(ticket.createdAt).toLocaleString()} · 第 {ticket.cycle} 轮 · {ticket.status}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedSupportTicketId("")}
                        aria-label="关闭工单详情"
                        style={{
                          width: "34px",
                          height: "34px",
                          flex: "0 0 auto",
                          border: `1px solid ${line}`,
                          borderRadius: "50%",
                          background: "white",
                          color: ink,
                          fontSize: "20px",
                          lineHeight: 1,
                          cursor: "pointer",
                        }}
                      >
                        ×
                      </button>
                    </div>

                    <div style={{ display: "grid", gap: "10px" }}>
                      {conversationMessages.map((message) => (
                      <div
                        key={message.id}
                        style={{
                          border: `1px solid ${line}`,
                          borderLeft: `4px solid ${
                            message.sender === "support" ? examGreen : accent
                          }`,
                          borderRadius: softRadius,
                          background:
                            message.sender === "support" ? "#f3fbfa" : "white",
                          padding: "14px 16px",
                          marginLeft: 0,
                          marginRight: 0,
                        }}
                      >
                        <strong
                          style={{
                            display: "block",
                            color:
                              message.sender === "support" ? examGreen : accent,
                            fontSize: "13px",
                            marginBottom: "7px",
                          }}
                        >
                          {message.sender === "support" ? "客服回复" : "我的提问"}
                          {` · 第 ${message.cycle} 轮 · ${new Date(
                            message.createdAt
                          ).toLocaleString()}`}
                        </strong>
                        <p
                          style={{
                            margin: 0,
                            color: ink,
                            lineHeight: 1.65,
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {message.message}
                        </p>
                      </div>
                      ))}
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                        gap: "8px",
                      }}
                    >
                      {supportStatusFlow.map((status, index) => (
                        <div
                          key={`${ticket.id}-${status}`}
                          style={{
                            borderRadius: softRadius,
                            background:
                              index <= statusIndex ? accent : "#edf0f7",
                            color: index <= statusIndex ? "white" : muted,
                            padding: "8px 6px",
                            textAlign: "center",
                            fontSize: "12px",
                            fontWeight: 900,
                          }}
                        >
                          {status}
                        </div>
                      ))}
                    </div>

                    {ticket.status === "已处理" && (
                      <div
                        style={{
                          borderTop: `1px solid ${line}`,
                          paddingTop: "14px",
                        }}
                      >
                        <strong
                          style={{ display: "block", color: ink, marginBottom: "8px" }}
                        >
                          继续提问
                        </strong>
                        <textarea
                          value={supportFollowUpMessages[ticket.id] || ""}
                          onChange={(event) =>
                            setSupportFollowUpMessages((current) => ({
                              ...current,
                              [ticket.id]: event.target.value,
                            }))
                          }
                          placeholder="如仍有问题，可以在这里补充说明..."
                          rows={3}
                          maxLength={5000}
                          style={{
                            width: "100%",
                            boxSizing: "border-box",
                            border: `1px solid ${line}`,
                            borderRadius: softRadius,
                            padding: "12px 14px",
                            color: ink,
                            fontSize: "14px",
                            lineHeight: 1.6,
                            resize: "vertical",
                            outline: "none",
                          }}
                        />
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "flex-end",
                            marginTop: "10px",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => void submitSupportFollowUp(ticket)}
                            disabled={submittingSupportFollowUpId === ticket.id}
                            style={{
                              ...ctaStyle,
                              minHeight: "40px",
                              padding: "0 16px",
                              fontSize: "13px",
                              opacity:
                                submittingSupportFollowUpId === ticket.id
                                  ? 0.65
                                  : 1,
                            }}
                          >
                            {submittingSupportFollowUpId === ticket.id
                              ? "正在提交..."
                              : "提交补充问题"}
                          </button>
                        </div>
                      </div>
                    )}

                    {ticket.status === "已完成" && (
                      <p
                        style={{
                          margin: 0,
                          color: muted,
                          fontSize: "13px",
                          fontWeight: 800,
                        }}
                      >
                        此工单已完成。如有新的问题，请创建新工单。
                      </p>
                    )}

                    <p
                      style={{
                        margin: 0,
                        color: muted,
                        fontSize: "12px",
                        fontWeight: 750,
                        textAlign: "left",
                      }}
                    >
                      {ticket.status === "已处理"
                        ? "客服已处理；如仍有疑问，可以继续提问。"
                        : ticket.status === "已完成"
                          ? "工单已结束。"
                          : "处理状态由客服后台更新，并会同步到这里。"}
                    </p>
                    </div>
                  </details>
                );
              })}
            </section>)}
          </div>
        </div>
      </div>
    );
  }

  function renderAiPracticeSelector() {
    if (!showAiPracticeSelector) return null;

    const options: Array<{
      type: PastExamPracticeType;
      label: string;
      count: number;
    }> = [
      {
        type: "sentence",
        label: "Build a Sentence",
        count: 10,
      },
      {
        type: "email",
        label: "Email Writing",
        count: 1,
      },
      {
        type: "discussion",
        label: "Academic Discussion",
        count: 1,
      },
    ];
    const selectedCount = selectedAiPracticeTypes.length;

    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15, 23, 42, 0.42)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          zIndex: 90,
        }}
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-practice-selector-title"
          style={{
            width: "min(520px, 100%)",
            background: "white",
            border: "1px solid #e2e8f0",
            borderRadius: "22px",
            padding: "24px",
            boxShadow: "0 24px 80px rgba(15, 23, 42, 0.22)",
          }}
        >
          <h2 id="ai-practice-selector-title" style={{ marginTop: 0 }}>
            AI 随机拼题练习
          </h2>
          <p style={{ color: "#64748b", lineHeight: 1.7 }}>
            至少选择一个部分。三个题型同时选择时会形成完整模考记录。
          </p>

          <div style={{ display: "grid", gap: "12px" }}>
            {options.map((option) => {
              const selected = selectedAiPracticeTypes.includes(option.type);

              return (
                <button
                  key={option.type}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleAiPracticeType(option.type)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "14px 16px",
                    borderRadius: "16px",
                    border: selected
                      ? `2px solid ${examGreen}`
                      : "1px solid #cbd5e1",
                    background: selected ? "#ecfeff" : "white",
                    color: "#111827",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  <span>{option.label}</span>
                  <span style={{ color: "#64748b" }}>
                    {option.count} 题
                  </span>
                </button>
              );
            })}
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "12px",
              marginTop: "24px",
            }}
          >
            <button
              type="button"
              onClick={() => setShowAiPracticeSelector(false)}
              style={{
                padding: "11px 18px",
                borderRadius: softRadius,
                border: `1px solid ${line}`,
                background: "white",
                color: ink,
                fontWeight: 850,
                cursor: "pointer",
              }}
            >
              取消
            </button>
            <button
              type="button"
              disabled={selectedCount === 0}
              onClick={startSelectedAiPracticeFromModal}
              style={{
                ...ctaStyle,
                minHeight: "44px",
                padding: "0 20px",
                background: selectedCount === 0 ? "#cbd5e1" : accent,
                cursor: selectedCount === 0 ? "not-allowed" : "pointer",
              }}
            >
              开始练习
            </button>
          </div>
        </section>
      </div>
    );
  }

  function renderPersonalizedPracticeSelector() {
    if (!showPersonalizedPracticeSelector) return null;

    const options: Array<{
      type: PersonalizedTaskType;
      label: string;
      description: string;
    }> = [
      {
        type: "email",
        label: "Email Writing",
        description: "邮件写作 · 1 题",
      },
      {
        type: "discussion",
        label: "Academic Discussion",
        description: "学术讨论 · 1 题",
      },
    ];

    return (
      <div
        onClick={(event) => {
          if (
            event.target === event.currentTarget &&
            !isStartingPersonalizedPractice
          ) {
            setShowPersonalizedPracticeSelector(false);
          }
        }}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15, 23, 42, 0.42)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          zIndex: 95,
        }}
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="personalized-practice-selector-title"
          style={{
            width: "min(520px, 100%)",
            background: "white",
            border: "1px solid #e2e8f0",
            borderRadius: "22px",
            padding: "24px",
            boxShadow: "0 24px 80px rgba(15, 23, 42, 0.22)",
            textAlign: "left",
          }}
        >
          <h2
            id="personalized-practice-selector-title"
            style={{ margin: "0 0 8px", color: ink, textAlign: "left" }}
          >
            选择个性化练习
          </h2>
          <p
            style={{
              margin: "0 0 20px",
              color: muted,
              lineHeight: 1.65,
              fontWeight: 700,
              textAlign: "left",
            }}
          >
            可以选择一个题型，也可以同时选择两个题型一起练习。
          </p>

          <div style={{ display: "grid", gap: "12px" }}>
            {options.map((option) => {
              const selected = selectedPersonalizedTypes.includes(option.type);
              return (
                <button
                  key={option.type}
                  type="button"
                  aria-pressed={selected}
                  disabled={isStartingPersonalizedPractice}
                  onClick={() => togglePersonalizedPracticeType(option.type)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "16px",
                    padding: "15px 16px",
                    borderRadius: "16px",
                    border: selected
                      ? `2px solid ${examGreen}`
                      : `1px solid ${line}`,
                    background: selected ? "#ecfdfb" : "white",
                    color: ink,
                    textAlign: "left",
                    fontWeight: 850,
                    cursor: isStartingPersonalizedPractice
                      ? "wait"
                      : "pointer",
                  }}
                >
                  <span>{option.label}</span>
                  <span
                    style={{
                      color: selected ? examGreen : muted,
                      fontSize: "13px",
                      fontWeight: 800,
                    }}
                  >
                    {option.description}
                  </span>
                </button>
              );
            })}
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "12px",
              marginTop: "24px",
            }}
          >
            <button
              type="button"
              disabled={isStartingPersonalizedPractice}
              onClick={() => setShowPersonalizedPracticeSelector(false)}
              style={{
                padding: "11px 18px",
                borderRadius: softRadius,
                border: `1px solid ${line}`,
                background: "white",
                color: ink,
                fontWeight: 850,
                cursor: isStartingPersonalizedPractice ? "wait" : "pointer",
              }}
            >
              取消
            </button>
            <button
              type="button"
              disabled={
                selectedPersonalizedTypes.length === 0 ||
                isStartingPersonalizedPractice
              }
              onClick={() => void startPersonalizedPracticeFromSelector()}
              style={{
                ...aiCtaStyle,
                minHeight: "44px",
                padding: "0 20px",
                background:
                  selectedPersonalizedTypes.length === 0
                    ? "#cbd5e1"
                    : examGreen,
                cursor:
                  selectedPersonalizedTypes.length === 0
                    ? "not-allowed"
                    : isStartingPersonalizedPractice
                      ? "wait"
                      : "pointer",
              }}
            >
              {isStartingPersonalizedPractice
                ? "正在匹配练习…"
                : selectedPersonalizedTypes.length === 2
                  ? "开始组合练习"
                  : "开始练习"}
            </button>
          </div>
        </section>
      </div>
    );
  }

  function renderPreviewRandomModal() {
    if (!previewRandomModal) return null;

    const isPastRandom = previewRandomModal === "past";
    const randomTypeOptions = isPastRandom
      ? previewRandomTypeOptions
      : previewEtsMockRandomTypeOptions;
    const randomSentenceSetOptions = isPastRandom
      ? previewSentenceSetOptions
      : previewEtsMockSentenceSetOptions;
    const isPastSetRandom =
      isPastRandom && previewPastRandomMode === "exam_set";
    const canStartRandom = isPastSetRandom
      ? previewPastRandomSetCount > 0
      : previewRandomTypes.length > 0 &&
        previewRandomTypes.every((type) =>
          randomTypeOptions.some(
            (option) => option.type === type && option.count > 0
          )
        );

    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15, 23, 42, 0.42)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          zIndex: 80,
        }}
      >
        <section
          style={{
            width: "min(520px, 100%)",
            background: "white",
            border: "1px solid #e2e8f0",
            borderRadius: "22px",
            padding: "24px",
            boxShadow: "0 24px 80px rgba(15, 23, 42, 0.22)",
          }}
        >
          <h2 style={{ marginTop: 0 }}>
            {isPastRandom ? "Official Questions 随机练习" : "随机拼题练习"}
          </h2>
          <p style={{ color: "#64748b", lineHeight: 1.7 }}>
            {isPastRandom
              ? isPastSetRandom
                ? "系统会随机选择同一场考试，并使用该场考试的造句、邮件和讨论组成完整练习。"
                : "至少选择一个部分。三个题型同时选择时会形成完整模考记录。"
              : "至少选择一个部分。造句抽取一整套 10 题，邮件和讨论各抽取 1 题。"}
          </p>

          {isPastRandom && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: "10px",
                marginBottom: "18px",
                padding: "5px",
                borderRadius: "16px",
                background: "#eef2f7",
              }}
            >
              {([
                ["custom", "自由随机"],
                ["exam_set", "随机 Set"],
              ] as const).map(([mode, label]) => {
                const active = previewPastRandomMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setPreviewPastRandomMode(mode)}
                    style={{
                      padding: "11px 14px",
                      border: "none",
                      borderRadius: "12px",
                      background: active ? "white" : "transparent",
                      color: active ? examGreen : "#64748b",
                      boxShadow: active
                        ? "0 5px 16px rgba(15, 23, 42, 0.10)"
                        : "none",
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}

          {!isPastSetRandom && <>
              <div style={{ display: "grid", gap: "12px" }}>
                {randomTypeOptions.map((option) => {
                  const selected = previewRandomTypes.includes(option.type);

                  return (
                    <button
                      key={option.type}
                      type="button"
                      onClick={() => togglePreviewRandomType(option.type)}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "14px 16px",
                        borderRadius: "16px",
                        border: selected
                          ? `2px solid ${examGreen}`
                          : "1px solid #cbd5e1",
                        background: selected ? "#ecfeff" : "white",
                        color: "#111827",
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      <span>{option.label}</span>
                      <span style={{ color: "#64748b" }}>
                        {option.count} 题
                      </span>
                    </button>
                  );
                })}
              </div>

              {previewRandomTypes.includes("sentence") && (
                <div
                  style={{
                    marginTop: "18px",
                    padding: "16px",
                    borderRadius: "18px",
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                  }}
                >
                  <div
                    style={{
                      fontWeight: 900,
                      marginBottom: "12px",
                      color: "#111827",
                    }}
                  >
                    Build a Sentence 抽题方式
                  </div>
                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => setPreviewSentenceRandomMode("mixed")}
                      style={{
                        padding: "10px 14px",
                        borderRadius: "999px",
                        border:
                          previewSentenceRandomMode === "mixed"
                            ? `2px solid ${examGreen}`
                            : "1px solid #cbd5e1",
                        background:
                          previewSentenceRandomMode === "mixed"
                            ? examGreen
                            : "white",
                        color:
                          previewSentenceRandomMode === "mixed"
                            ? "white"
                            : "#111827",
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      {isPastRandom ? "跨 Set 随机" : "随机 Set"}
                    </button>
                    {isPastRandom && (
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewSentenceRandomMode("random_set")
                        }
                        style={{
                          padding: "10px 14px",
                          borderRadius: "999px",
                          border:
                            previewSentenceRandomMode === "random_set"
                              ? `2px solid ${examGreen}`
                              : "1px solid #cbd5e1",
                          background:
                            previewSentenceRandomMode === "random_set"
                              ? examGreen
                              : "white",
                          color:
                            previewSentenceRandomMode === "random_set"
                              ? "white"
                              : "#111827",
                          fontWeight: 800,
                          cursor: "pointer",
                        }}
                      >
                        同一 Set 随机
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={choosePreviewSentenceSetMode}
                      style={{
                        padding: "10px 14px",
                        borderRadius: "999px",
                        border:
                          previewSentenceRandomMode === "set"
                            ? `2px solid ${examGreen}`
                            : "1px solid #cbd5e1",
                        background:
                          previewSentenceRandomMode === "set"
                            ? examGreen
                            : "white",
                        color:
                          previewSentenceRandomMode === "set"
                            ? "white"
                            : "#111827",
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      指定 Set
                    </button>
                  </div>

                  {previewSentenceRandomMode === "set" && (
                    <select
                      value={
                        previewSentenceSetId ||
                        randomSentenceSetOptions[0]?.item.id ||
                        ""
                      }
                      onChange={(event) =>
                        setPreviewSentenceSetId(event.target.value)
                      }
                      style={{
                        width: "100%",
                        marginTop: "12px",
                        padding: "12px 14px",
                        borderRadius: "14px",
                        border: "1px solid #cbd5e1",
                        background: "white",
                        fontWeight: 800,
                        color: "#111827",
                      }}
                    >
                      {randomSentenceSetOptions.map((option) => (
                        <option key={option.item.id} value={option.item.id}>
                          {isPastRandom
                            ? option.item.display_date || "No date"
                            : option.item.title} ({option.count} 题)
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
          </>}

          {isPastSetRandom && previewPastRandomSetCount === 0 && (
            <p style={{ color: "#be123c", fontWeight: 800 }}>
              当前题库没有同时包含三个题型的考试日期。
            </p>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "12px",
              marginTop: "24px",
            }}
          >
            <button
              type="button"
              onClick={() => setPreviewRandomModal(null)}
              style={{
                padding: "11px 18px",
                borderRadius: softRadius,
                border: `1px solid ${line}`,
                background: "white",
                color: ink,
                fontWeight: 850,
                cursor: "pointer",
              }}
            >
              取消
            </button>
            <button
              type="button"
              disabled={!canStartRandom}
              onClick={() => {
                if (isPastRandom) {
                  startPreviewPastRandom();
                  return;
                }
                startPreviewEtsMockRandom();
              }}
              style={{
                ...ctaStyle,
                minHeight: "44px",
                padding: "0 20px",
                background:
                  !canStartRandom ? "#cbd5e1" : accent,
                cursor:
                  !canStartRandom ? "not-allowed" : "pointer",
              }}
            >
              {isPastSetRandom ? "开始随机 Set" : "开始练习"}
            </button>
          </div>
        </section>
      </div>
    );
  }

  function renderStudyPlanPage() {
    const examDaysByMonth: Record<number, number[]> = {
      8: [22, 29, 30],
      9: [5, 13, 23, 30],
      10: [7, 17, 25, 31],
      11: [8, 14, 22, 28, 30],
      12: [6, 12, 20, 26],
    };
    const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    const daysInMonth = new Date(2026, studyPlanMonth, 0).getDate();
    const previousMonthDays = new Date(2026, studyPlanMonth - 1, 0).getDate();
    const firstWeekday = new Date(2026, studyPlanMonth - 1, 1).getDay();
    const visibleCellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
    const calendarDays = Array.from({ length: Math.max(42, visibleCellCount) }, (_, index) => {
      const dateNumber = index - firstWeekday + 1;

      if (dateNumber < 1) {
        return {
          day: previousMonthDays + dateNumber,
          muted: true,
          month: studyPlanMonth - 1,
          exam: false,
          currentMonth: false,
        };
      }

      if (dateNumber > daysInMonth) {
        return {
          day: dateNumber - daysInMonth,
          muted: true,
          month: studyPlanMonth + 1,
          exam: false,
          currentMonth: false,
        };
      }

      const cellDate = new Date(2026, studyPlanMonth - 1, dateNumber);
      const isPastDate = cellDate.getTime() < todayDate.getTime();

      return {
        day: dateNumber,
        muted: isPastDate,
        month: studyPlanMonth,
        exam:
          !isPastDate &&
          examDaysByMonth[studyPlanMonth]?.includes(dateNumber),
        currentMonth: true,
      };
    });
    const canGoPreviousMonth = studyPlanMonth > 7;
    const canGoNextMonth = studyPlanMonth < 12;
    const selectedExamDate = studyPlanExamDate
      ? new Date(`${studyPlanExamDate}T00:00:00`)
      : null;
    const daysUntilExam = selectedExamDate
      ? Math.max(
          0,
          Math.ceil(
            (selectedExamDate.getTime() - todayDate.getTime()) /
              (1000 * 60 * 60 * 24)
          )
        )
      : null;
    const todayKey = getPreviewDateKey();
    const todaySessions = practiceSessions.filter(
      (session) => getPreviewDateKey(new Date(session.date)) === todayKey
    );
    const practiceTypeLabels: Record<PracticeSession["type"], string> = {
      sentence: "Build a Sentence",
      email: "Email Writing",
      discussion: "Academic Discussion",
      mock: "Mock Test",
    };
    const todaySessionCounts = (
      Object.keys(practiceTypeLabels) as PracticeSession["type"][]
    )
      .map((type) => ({
        type,
        label: practiceTypeLabels[type],
        count: todaySessions.filter((session) => session.type === type).length,
      }))
      .filter((item) => item.count > 0);
    const latestPracticeSession = practiceSessions[0] || null;
    const setVisibleStudyPlanMonth = (month: number) => {
      const nextMonth = Math.min(12, Math.max(7, month));
      setStudyPlanMonth(nextMonth);
      setSelectedStudyPlanDate(`2026-${nextMonth}-1`);
      setHoveredStudyPlanDate("");
      setStudyPlanContextMenu(null);
    };
    const changeStudyPlanMonth = (direction: -1 | 1) => {
      const nextMonth = Math.min(12, Math.max(7, studyPlanMonth + direction));
      setVisibleStudyPlanMonth(nextMonth);
    };

    return (
      <div
        className="study-plan-layout"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 285px",
          gap: "18px",
          alignItems: "start",
        }}
      >
        <div className="study-plan-panels" style={{ display: "grid", gap: "14px" }}>
          <section style={{ ...cardStyle, padding: "22px", display: "grid", gap: "18px" }}>
            <div>
              <span
                style={{
                  color: accent,
                  fontSize: "12px",
                  fontWeight: 950,
                  textTransform: "uppercase",
                }}
              >
                Today's Plan
              </span>
              <h2 style={{ margin: "6px 0 0", fontSize: "24px" }}>
                今日学习
              </h2>
            </div>
            <div
              style={{
                border: `1px solid ${line}`,
                borderRadius: softRadius,
                padding: "16px",
                background: "#f8fafc",
                display: "flex",
                justifyContent: "space-between",
                gap: "14px",
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <strong style={{ color: ink, fontSize: "18px" }}>
                {daysUntilExam === null
                  ? "右键右侧福字添加考试日"
                  : `距离考试还有 ${daysUntilExam} 天`}
              </strong>
              {editingStudyPlanScore ? (
                <input
                  type="number"
                  min="1"
                  max="6"
                  step="0.5"
                  value={studyPlanTargetScore}
                  onChange={(event) =>
                    setStudyPlanTargetScore(event.target.value)
                  }
                  onBlur={handleWritingTargetScoreBlur}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleWritingTargetScoreBlur();
                  }}
                  autoFocus
                  style={{
                    width: "72px",
                    border: `1px solid ${line}`,
                    borderRadius: softRadius,
                    padding: "8px 10px",
                    color: accent,
                    fontSize: "13px",
                    fontWeight: 900,
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (isLearningProfileLoaded) setEditingStudyPlanScore(true);
                  }}
                  disabled={!isLearningProfileLoaded}
                  style={{
                    border: `1px solid ${line}`,
                    borderRadius: softRadius,
                    background: "white",
                    color: muted,
                    fontSize: "13px",
                    fontWeight: 850,
                    padding: "8px 10px",
                    cursor: isLearningProfileLoaded ? "pointer" : "wait",
                    opacity: isLearningProfileLoaded ? 1 : 0.68,
                  }}
                >
                  {isLearningProfileLoaded
                    ? `目标 ${studyPlanTargetScore || "XX"} 分`
                    : "目标分数读取中…"}
                </button>
              )}
            </div>
            <div style={{ display: "grid", gap: "10px" }}>
              <strong style={{ color: ink, fontSize: "16px" }}>
                今日已学习
              </strong>
              <div style={{ display: "grid", gap: "8px", color: muted, fontWeight: 800 }}>
                {todaySessionCounts.length > 0 ? (
                  todaySessionCounts.map((item) => (
                    <div
                      key={item.type}
                      style={{ display: "flex", justifyContent: "space-between" }}
                    >
                      <span>{item.label}</span>
                      <span>{item.count} 次</span>
                    </div>
                  ))
                ) : (
                  <span>今天还没有练习记录。</span>
                )}
              </div>
            </div>
          </section>

          <section style={{ ...cardStyle, padding: "20px", display: "grid", gap: "12px" }}>
            <div>
              <span
                style={{
                  color: accent,
                  fontSize: "12px",
                  fontWeight: 950,
                  textTransform: "uppercase",
                }}
              >
                Continue Learning
              </span>
              <h3 style={{ margin: "6px 0 0", fontSize: "20px" }}>
                继续学习
              </h3>
            </div>
            <div style={{ display: "grid", gap: "7px" }}>
              <strong style={{ color: ink }}>最近一次练习</strong>
              <span style={{ color: muted, fontWeight: 800 }}>
                {latestPracticeSession
                  ? practiceTypeLabels[latestPracticeSession.type]
                  : "暂无练习记录"}
              </span>
              <span style={{ color: ink, fontWeight: 900 }}>
                {latestPracticeSession
                  ? `得分 ${latestPracticeSession.score}`
                  : "完成练习后会在这里显示"}
              </span>
              <span style={{ color: muted, fontSize: "13px", fontWeight: 800 }}>
                {latestPracticeSession
                  ? new Date(latestPracticeSession.date).toLocaleString("zh-CN")
                  : ""}
              </span>
            </div>
            <button
              type="button"
              onClick={goToAiRecordSection}
              style={{
                border: 0,
                background: "transparent",
                color: examGreen,
                fontSize: "14px",
                fontWeight: 950,
                padding: 0,
                width: "fit-content",
                cursor: "pointer",
              }}
            >
              查看练习记录 →
            </button>
          </section>
        </div>
        <section
          className="study-plan-calendar"
          style={{
            ...cardStyle,
            overflow: "visible",
            padding: 0,
            maxWidth: "285px",
            width: "100%",
          }}
        >
          <div
            style={{
              minHeight: "34px",
              background: accent,
              color: "white",
              display: "grid",
              gridTemplateColumns: "32px 23px 1fr 23px 32px",
              alignItems: "center",
              padding: "0 9px",
              fontWeight: 900,
            }}
          >
            <button
              type="button"
              aria-label="上一年"
              disabled={!canGoPreviousMonth}
              onClick={() => setVisibleStudyPlanMonth(7)}
              style={calendarArrowStyle(!canGoPreviousMonth)}
            >
              ≪
            </button>
            <button
              type="button"
              aria-label="上个月"
              disabled={!canGoPreviousMonth}
              onClick={() => changeStudyPlanMonth(-1)}
              style={calendarArrowStyle(!canGoPreviousMonth)}
            >
              ‹
            </button>
            <strong style={{ textAlign: "center", fontSize: "13px" }}>
              2026年&nbsp;&nbsp;{studyPlanMonth}月
            </strong>
            <button
              type="button"
              aria-label="下个月"
              disabled={!canGoNextMonth}
              onClick={() => changeStudyPlanMonth(1)}
              style={calendarArrowStyle(!canGoNextMonth)}
            >
              ›
            </button>
            <button
              type="button"
              aria-label="下一年"
              disabled={!canGoNextMonth}
              onClick={() => setVisibleStudyPlanMonth(12)}
              style={calendarArrowStyle(!canGoNextMonth)}
            >
              ≫
            </button>
          </div>

          <div style={{ padding: "12px 15px 11px" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, 1fr)",
                textAlign: "center",
                marginBottom: "7px",
                color: "#242424",
                fontSize: "11px",
                fontWeight: 900,
              }}
            >
              {weekdays.map((weekday) => (
                <span key={weekday}>{weekday}</span>
              ))}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, 1fr)",
                rowGap: "5px",
                textAlign: "center",
              }}
            >
              {calendarDays.map((item, index) => {
                const dateKey = `2026-${item.month}-${item.day}`;
                const selected = selectedStudyPlanDate === dateKey;
                const hovered = hoveredStudyPlanDate === dateKey;
                const highlighted = selected || hovered;
                const cellBackground = selected
                  ? accent
                  : hovered
                    ? "#e9e9e9"
                    : "transparent";
                const contentColor = selected
                  ? item.exam
                    ? "white"
                    : "#f4b400"
                  : item.exam
                    ? accent
                    : item.muted
                      ? "#c9c9cd"
                      : "#5a5a5f";
                const calendarColumn = index % 7;
                const popoverHorizontalStyle: React.CSSProperties =
                  calendarColumn <= 1
                    ? { left: 0 }
                    : calendarColumn >= 5
                      ? { right: 0 }
                      : { left: "50%", transform: "translateX(-50%)" };

                return (
                  <div
                    key={`${item.day}-${index}`}
                    style={{
                      position: "relative",
                      minHeight: "26px",
                    }}
                  >
                    <button
                      type="button"
                      disabled={!item.currentMonth}
                      onClick={() => {
                        if (!item.currentMonth) return;

                        setSelectedStudyPlanDate(dateKey);
                        if (item.exam) {
                          const month = String(item.month).padStart(2, "0");
                          const day = String(item.day).padStart(2, "0");
                          setStudyPlanContextMenu({
                            date: `2026-${month}-${day}`,
                          });
                        } else {
                          setStudyPlanContextMenu(null);
                        }
                      }}
                      onContextMenu={(event) => {
                        if (!item.currentMonth || !item.exam) return;

                        event.preventDefault();
                        const month = String(item.month).padStart(2, "0");
                        const day = String(item.day).padStart(2, "0");
                        setSelectedStudyPlanDate(dateKey);
                        setStudyPlanContextMenu({
                          date: `2026-${month}-${day}`,
                        });
                      }}
                      onMouseEnter={() =>
                        item.currentMonth && setHoveredStudyPlanDate(dateKey)
                      }
                      onMouseLeave={() => setHoveredStudyPlanDate("")}
                      style={{
                        position: "relative",
                        width: "100%",
                        minHeight: "26px",
                        display: "grid",
                        placeItems: "center",
                        border: 0,
                        background: "transparent",
                        padding: 0,
                        color: contentColor,
                        fontSize: "12px",
                        fontWeight: 750,
                        cursor: item.currentMonth ? "pointer" : "default",
                      }}
                    >
                      <span
                        style={{
                          width: highlighted || item.exam ? "26px" : "auto",
                          height: highlighted || item.exam ? "25px" : "auto",
                          display: "grid",
                          placeItems: "center",
                          background: highlighted ? cellBackground : "transparent",
                          color: contentColor,
                        }}
                      >
                        {item.exam ? "福" : item.day}
                      </span>
                      {item.exam && (
                        <span
                          style={{
                            position: "absolute",
                            right: "12%",
                            top: "3px",
                            width: "5px",
                            height: "5px",
                            borderRadius: "999px",
                            background: selected ? "white" : accent,
                          }}
                        />
                      )}
                    </button>
                    {studyPlanContextMenu?.date ===
                      `2026-${String(item.month).padStart(2, "0")}-${String(
                        item.day
                      ).padStart(2, "0")}` && (
                      <div
                        style={{
                          position: "absolute",
                          top: "calc(100% + 5px)",
                          ...popoverHorizontalStyle,
                          zIndex: 120,
                          background: "white",
                          border: `1px solid ${line}`,
                          borderRadius: softRadius,
                          boxShadow: "0 12px 30px rgba(15, 23, 42, 0.16)",
                          padding: "6px",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            const nextExamDate = studyPlanContextMenu.date;
                            setStudyPlanExamDate(nextExamDate);
                            void saveLearningProfile({ examDate: nextExamDate });
                            setStudyPlanContextMenu(null);
                          }}
                          style={{
                            border: 0,
                            background: "transparent",
                            color: ink,
                            padding: "9px 12px",
                            borderRadius: softRadius,
                            fontSize: "13px",
                            fontWeight: 850,
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {studyPlanExamDate ? "更改考试日" : "添加考试日"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div
            style={{
              borderTop: `1px solid ${line}`,
              padding: "11px 15px",
              textAlign: "right",
              color: "#666",
              fontSize: "11px",
              fontWeight: 900,
            }}
          >
            <span style={{ color: accent }}>福</span>：托福网考考试日
          </div>
        </section>
      </div>
    );
  }

  const calendarArrowStyle = (disabled = false): React.CSSProperties => ({
    border: 0,
    background: disabled ? "rgba(255, 255, 255, 0.22)" : "transparent",
    color: "white",
    fontSize: "18px",
    fontWeight: 700,
    lineHeight: 1,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
    padding: "4px",
  });

  async function submitRedeemCode() {
    const normalizedCode = redeemCodeInput.trim().toUpperCase();
    setRedeemMessage("");
    setRedeemSucceeded(false);

    if (!user) {
      setRedeemMessage("请先登录再使用兑换码。");
      return;
    }

    if (!normalizedCode) {
      setRedeemMessage("请输入兑换码。");
      redeemInputRef.current?.focus();
      return;
    }

    setIsRedeemingCode(true);
    try {
      const result = await onRedeemCode(normalizedCode);
      setRedeemCodeInput("");
      setRedeemSucceeded(true);
      setRedeemMessage(result.message);
      if (redeemCelebrationTimerRef.current !== null) {
        window.clearTimeout(redeemCelebrationTimerRef.current);
      }
      setRedeemCelebrationId((current) => current + 1);
      redeemCelebrationTimerRef.current = window.setTimeout(() => {
        setRedeemCelebrationId(0);
        redeemCelebrationTimerRef.current = null;
      }, 5000);
      const { data: refreshedHistory, error: historyError } = await supabase
        .from("redeem_logs")
        .select(
          "id, reward_type, points_added, pro_days, subscription_expires_at, redeemed_at"
        )
        .eq("user_id", user.id)
        .order("redeemed_at", { ascending: false });

      if (historyError) {
        console.error("Failed to refresh redemption history:", historyError);
      } else {
        setRedemptionHistory(
          (refreshedHistory || []).map((item) => ({
            id: item.id,
            rewardType: item.reward_type === "pro" ? "pro" : "credits",
            creditsAdded: Number(item.points_added || 0),
            proDays: item.pro_days === null ? null : Number(item.pro_days),
            subscriptionExpiresAt: item.subscription_expires_at,
            redeemedAt: item.redeemed_at,
          }))
        );
      }
    } catch (error) {
      setRedeemMessage(
        error instanceof Error ? error.message : "兑换失败，请稍后重试。"
      );
    } finally {
      setIsRedeemingCode(false);
    }
  }

  function focusRedeemInput() {
    redeemInputRef.current?.focus();
    redeemInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function renderStorePage() {
    const storePlans = [
      {
        name: "Free",
        price: "¥0",
        description: "适合体验 FORGE 基础练习。",
        badge: isPro ? "Free" : "Current",
        features: ["基础 Writing Practice", "Daily Check-in · 限时 Credits 30 天有效", "使用 Credits 进行 AI Practice", "使用 Credits 进行 AI Grading"],
        limitations: ["Daily 完整学习系统", "Writing Ability Analysis", "Topic Mastery", "Personalized Practice", "Official Questions"],
        action: isPro ? "Free 方案" : "当前方案",
        featured: false,
      },
      {
        name: "FORGE Pro",
        price: "¥25 / month",
        description: "解锁完整 FORGE 学习系统。",
        badge: isPro ? "Current" : "Redeem Code",
        features: ["Free 的全部功能", "使用 Pro 兑换码开通并获得 25 永久 Credits", "Daily 完整内容与历史内容", "Writing Ability Analysis", "Topic Mastery", "Personalized Practice", "Official Questions", "Advanced Ability Analysis"],
        limitations: [],
        action: isPro ? "已开通" : "使用兑换码开通",
        featured: true,
      },
    ];
    const comparisonRows = [
      ["Writing Practice", "✓", "✓", "✓"],
      ["Daily Check-in", "30 天限时 Credits", "30 天限时 Credits", "30 天限时 Credits"],
      ["Daily Full Analysis", "Limited", "✓", "✓"],
      ["Writing Ability Analysis", "—", "✓", "✓"],
      ["Topic Mastery", "—", "✓", "✓"],
      ["Personalized Practice", "—", "✓", "✓"],
      ["Official Questions", "—", "✓", "✓"],
      ["AI Practice", "Uses Credits", "Uses Credits", "Uses Credits"],
      ["AI Writing Grading", "Uses Credits", "Uses Credits", "Uses Credits"],
      ["Pro Activation", "—", "使用兑换码", "使用兑换码"],
      ["Seasonal Pass Credits", "—", "—", "Summer 60 天 / Winter 30 天"],
      ["Credit Packs", "永久 Credits", "永久 Credits", "永久 Credits"],
    ];
    const seasonalPasses = [
      {
        name: "Summer Pass",
        price: "¥99",
        period: "July – August",
        credits: "200 Temporary Credits",
        validity: "限时 Credits · 60 天有效",
        action: "支付后兑换",
      },
      {
        name: "Winter Pass",
        price: "¥59",
        period: "Winter study season",
        credits: "100 Temporary Credits",
        validity: "限时 Credits · 30 天有效",
        action: "支付后兑换",
      },
    ];
    const creditPacks = [
      { name: "30 Credits", price: "¥29.9", base: "30 Permanent Credits", bonus: "", total: "永久有效", badge: "" },
      { name: "60 Credits", price: "¥49.9", base: "50 Permanent Credits", bonus: "+ 10 Permanent Bonus", total: "永久有效", badge: "Most Popular" },
      { name: "125 Credits", price: "¥99", base: "100 Permanent Credits", bonus: "+ 25 Permanent Bonus", total: "永久有效", badge: "Best Value" },
    ];
    const storeSectionTitleStyle: CSSProperties = {
      margin: 0,
      color: ink,
      fontSize: "22px",
      fontWeight: 950,
    };
    const mutedTextStyle: CSSProperties = {
      margin: 0,
      color: muted,
      fontSize: "14px",
      lineHeight: 1.6,
      fontWeight: 720,
    };

    function renderSectionHeader(title: string, subtitle?: string) {
      return (
        <div style={{ display: "grid", gap: "6px" }}>
          <h2 style={storeSectionTitleStyle}>{title}</h2>
          {subtitle && <p style={mutedTextStyle}>{subtitle}</p>}
        </div>
      );
    }

    return (
      <div style={{ display: "grid", gap: "18px" }}>
        <section
          style={{
            ...cardStyle,
            padding: "24px",
            display: "grid",
            gridTemplateColumns: "minmax(220px, 0.7fr) minmax(360px, 1.3fr)",
            gap: "20px",
            alignItems: "center",
          }}
        >
          <div>
            <h1 style={{ margin: "0 0 8px", fontSize: "34px", color: ink, fontWeight: 950 }}>
              Store
            </h1>
            <p style={mutedTextStyle}>支付完成后，使用兑换码开通 Pro 或领取 Credits。</p>
          </div>
          <div style={{ display: "grid", gap: "8px" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: "10px",
              }}
            >
              <input
                ref={redeemInputRef}
                id="redeem-code-input"
                aria-label="兑换码"
                value={redeemCodeInput}
                onChange={(event) => {
                  setRedeemCodeInput(event.target.value.toUpperCase());
                  setRedeemMessage("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !isRedeemingCode) {
                    void submitRedeemCode();
                  }
                }}
                placeholder="输入 Pro 或 Credits 兑换码"
                autoComplete="off"
                style={{
                  minWidth: 0,
                  minHeight: "48px",
                  border: `1px solid ${line}`,
                  borderRadius: softRadius,
                  padding: "0 15px",
                  background: "#fbfcff",
                  color: ink,
                  fontSize: "15px",
                  fontWeight: 800,
                  outlineColor: accent,
                }}
              />
              <button
                type="button"
                onClick={() => void submitRedeemCode()}
                disabled={isRedeemingCode}
                style={{
                  ...ctaStyle,
                  minWidth: "110px",
                  minHeight: "48px",
                  padding: "0 18px",
                  opacity: isRedeemingCode ? 0.65 : 1,
                  cursor: isRedeemingCode ? "wait" : "pointer",
                }}
              >
                {isRedeemingCode ? "兑换中…" : "立即兑换"}
              </button>
            </div>
            <div
              aria-live="polite"
              style={{
                minHeight: "20px",
                color: redeemSucceeded ? examGreen : "#b42318",
                fontSize: "13px",
                fontWeight: 800,
              }}
            >
              {redeemMessage}
            </div>
          </div>
        </section>

        <section
          style={{
            ...cardStyle,
            padding: "18px 22px",
            display: "grid",
            gridTemplateColumns: "1fr auto auto auto",
            gap: "18px",
            alignItems: "center",
          }}
        >
          <div>
            <p style={{ margin: "0 0 4px", color: muted, fontSize: "12px", fontWeight: 850 }}>
              Current Plan
            </p>
            <strong style={{ color: ink, fontSize: "22px" }}>
              {isPro ? "FORGE Pro" : "Free"}
            </strong>
          </div>
          <div style={{ color: muted, fontSize: "14px", fontWeight: 800 }}>Daily Check-in · 限时 Credit 30 天有效</div>
          <div style={{ color: muted, fontSize: "14px", fontWeight: 800 }}>Credits · 限时优先扣除</div>
          <button
            type="button"
            onClick={focusRedeemInput}
            style={{ ...ctaStyle, padding: "10px 16px", minHeight: "42px" }}
          >
            {isPro ? "兑换 Credits" : "兑换 Pro"}
          </button>
        </section>

        <section style={{ display: "grid", gap: "14px" }}>
          {renderSectionHeader("Choose Your Plan")}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(260px, 1fr))", gap: "16px" }}>
            {storePlans.map((plan) => (
              <article
                key={plan.name}
	                style={{
	                  ...cardStyle,
	                  padding: "22px",
	                  borderColor: plan.featured ? "#c6cbff" : line,
	                  background: plan.featured ? "#fbfbff" : "white",
	                  display: "grid",
	                  gridTemplateRows: "auto 58px 52px 1fr auto",
	                  gap: "14px",
	                  minHeight: "590px",
	                }}
	              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
                  <h3 style={{ margin: 0, color: ink, fontSize: "24px", fontWeight: 950 }}>{plan.name}</h3>
                  <span
                    style={{
                      borderRadius: "999px",
                      background: plan.featured ? active : "#eef8f7",
                      color: plan.featured ? "#5365ff" : examGreen,
                      padding: "6px 10px",
                      fontSize: "12px",
                      fontWeight: 900,
                    }}
                  >
                    {plan.badge}
                  </span>
                </div>
	                <strong
	                  style={{
	                    color: ink,
	                    fontSize: "28px",
	                    alignSelf: "center",
	                    textAlign: "center",
	                  }}
	                >
	                  {plan.price}
	                </strong>
	                <p style={{ ...mutedTextStyle, textAlign: "center" }}>{plan.description}</p>
	                <div
	                  style={{
	                    display: "grid",
	                    alignContent: "start",
	                    justifyItems: "center",
	                    gap: "14px",
	                    color: ink,
	                    fontSize: "14px",
	                    fontWeight: 780,
	                    textAlign: "center",
	                  }}
	                >
	                  {plan.features.map((feature) => (
	                    <span key={feature}>✓ {feature}</span>
	                  ))}
	                  {plan.limitations.map((feature) => (
                    <span key={feature} style={{ color: muted }}>— {feature}</span>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={plan.featured && !isPro ? focusRedeemInput : undefined}
                  disabled={!plan.featured || isPro}
                  style={{
                    ...ctaStyle,
                    background: plan.featured ? accent : "white",
                    color: plan.featured ? "white" : accent,
	                    border: plan.featured ? "none" : `1px solid ${line}`,
	                    padding: "11px 16px",
	                    minHeight: "44px",
	                    alignSelf: "end",
	                    opacity: !plan.featured || isPro ? 0.65 : 1,
	                    cursor: !plan.featured || isPro ? "default" : "pointer",
	                  }}
	                >
                  {plan.action}
                </button>
              </article>
            ))}
          </div>
        </section>

        <section style={{ ...cardStyle, padding: "22px", display: "grid", gap: "14px", overflowX: "auto" }}>
          {renderSectionHeader("Compare Plans", "Membership unlocks learning features. Credits are used for AI-powered actions.")}
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "720px", color: ink, fontSize: "14px" }}>
            <thead>
              <tr>
                {["Feature", "Free", "FORGE Pro", "Seasonal Pass"].map((heading) => (
                  <th
                    key={heading}
                    style={{
                      textAlign: "center",
                      padding: "12px",
                      borderBottom: `1px solid ${line}`,
                      background: heading === "FORGE Pro" ? active : "transparent",
                    }}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((row) => (
                <tr key={row[0]}>
                  {row.map((cell, index) => (
                    <td
                      key={`${row[0]}-${index}`}
                      style={{
                        padding: "12px",
                        borderBottom: `1px solid ${line}`,
                        color: index === 0 ? ink : muted,
                        fontWeight: index === 0 ? 850 : 780,
                      }}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section style={{ display: "grid", gap: "14px" }}>
          {renderSectionHeader("Seasonal Passes", "Pro access plus time-limited Credits for intensive study periods.")}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(260px, 1fr))", gap: "16px" }}>
            {seasonalPasses.map((pass) => (
              <article key={pass.name} style={{ ...cardStyle, padding: "20px", display: "grid", gap: "10px" }}>
                <h3 style={{ margin: 0, color: ink, fontSize: "22px", fontWeight: 950 }}>{pass.name}</h3>
                <strong style={{ color: ink, fontSize: "26px" }}>{pass.price}</strong>
                <p style={mutedTextStyle}>{pass.period}</p>
                <strong style={{ color: examGreen, fontSize: "18px" }}>{pass.credits}</strong>
                <p style={mutedTextStyle}>{pass.validity}</p>
                <p style={mutedTextStyle}>练习时会优先扣除限时 Credits。</p>
                <button type="button" onClick={focusRedeemInput} style={{ ...ctaStyle, background: "white", color: accent, border: `1px solid ${line}`, padding: "10px 16px" }}>
                  {pass.action}
                </button>
              </article>
            ))}
          </div>
        </section>

        <section id="credits" style={{ display: "grid", gap: "14px" }}>
          {renderSectionHeader("Credits", "充值获得的 Credits 永久有效。")}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(200px, 1fr))", gap: "16px" }}>
            {creditPacks.map((pack) => (
              <article key={pack.name} style={{ ...cardStyle, padding: "20px", display: "grid", gap: "10px" }}>
                <div style={{ minHeight: "26px" }}>
                  {pack.badge && (
                    <span style={{ borderRadius: "999px", background: active, color: "#5365ff", padding: "6px 10px", fontSize: "12px", fontWeight: 900 }}>
                      {pack.badge}
                    </span>
                  )}
                </div>
                <h3 style={{ margin: 0, color: ink, fontSize: "22px", fontWeight: 950 }}>{pack.name}</h3>
                <strong style={{ color: ink, fontSize: "26px" }}>{pack.price}</strong>
                <p style={mutedTextStyle}>{pack.base}</p>
                {pack.bonus && <p style={{ ...mutedTextStyle, color: examGreen }}>{pack.bonus}</p>}
                <strong style={{ color: accent }}>{pack.total}</strong>
                <button type="button" onClick={focusRedeemInput} style={{ ...ctaStyle, padding: "10px 16px" }}>使用兑换码</button>
              </article>
            ))}
          </div>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <div style={{ ...cardStyle, padding: "22px", display: "grid", gap: "12px" }}>
            {renderSectionHeader("How Credits Work")}
            {["签到领取：限时 Credits，30 天有效。", "Pro：支付后获得 Pro 兑换码。", "Credits：支付后获得永久 Credits 兑换码。", "季节 Pass：支付后使用限时兑换码。", "练习扣除：优先使用即将过期的限时 Credits，再使用永久 Credits。"].map((item) => (
              <p key={item} style={mutedTextStyle}>{item}</p>
            ))}
          </div>
          <div style={{ ...cardStyle, padding: "22px", display: "grid", gap: "12px" }}>
            {renderSectionHeader("Purchase History")}
            {redemptionHistory.length === 0 ? (
              <div style={{ border: `1px solid ${line}`, borderRadius: softRadius, padding: "16px", background: "#fbfcff", color: muted, fontWeight: 800 }}>
                暂无兑换记录。
              </div>
            ) : (
              <div style={{ display: "grid", gap: "8px" }}>
                {redemptionHistory.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      border: `1px solid ${line}`,
                      borderRadius: softRadius,
                      padding: "12px 14px",
                      background: "#fbfcff",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "14px",
                      color: ink,
                      fontWeight: 800,
                    }}
                  >
                    <span>
                      {item.rewardType === "pro"
                        ? `FORGE Pro · ${item.proDays || 0} 天 · +${item.creditsAdded} 永久 Credits`
                        : `永久 Credits · +${item.creditsAdded}`}
                    </span>
                    <span style={{ color: muted, whiteSpace: "nowrap" }}>
                      {new Date(item.redeemedAt).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    );
  }

  function renderAccountPage() {
    const accountInputStyle: CSSProperties = {
      width: "100%",
      boxSizing: "border-box",
      border: `1px solid ${line}`,
      borderRadius: softRadius,
      padding: "10px 12px",
      color: ink,
      fontSize: "14px",
      fontWeight: 750,
      background: "white",
    };
    const sectionTitleStyle: CSSProperties = {
      margin: "0 0 16px",
      color: ink,
      fontSize: "22px",
      fontWeight: 900,
    };
    const labelStyle: CSSProperties = {
      margin: "0 0 6px",
      color: muted,
      fontSize: "12px",
      fontWeight: 850,
      textTransform: "uppercase",
      letterSpacing: 0,
    };
    const normalizedExamDateForInput = studyPlanExamDate
      ? studyPlanExamDate
          .split("-")
          .map((part, index) =>
            index === 0 ? part : part.padStart(2, "0")
          )
          .join("-")
      : "";
    const accountStats = [
      { label: "已完成练习", value: `${completedPracticeCount} 次` },
      { label: "学习天数", value: `${learningDaysCount} 天` },
      { label: "完整模考", value: `${mockRecords.length} 次` },
      { label: "当前连续学习", value: `${getCurrentLearningStreak()} 天` },
    ];
    return (
      <div style={{ display: "grid", gap: "18px" }}>
        <section
          style={{
            ...cardStyle,
            padding: "22px 24px",
            display: "grid",
            gridTemplateColumns: "minmax(240px, 1fr) minmax(520px, 1.6fr) auto",
            gap: "20px",
            alignItems: "center",
          }}
        >
          <div>
            <h2 style={{ margin: "0 0 6px", fontSize: "24px", fontWeight: 950 }}>
              {accountDisplayName}
            </h2>
            <p style={{ margin: 0, color: muted, fontSize: "14px", fontWeight: 750 }}>
              {userEmail || "未登录"}
            </p>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(150px, 1fr))",
              gap: "12px",
            }}
          >
            <div>
              <p style={labelStyle}>会员到期日期</p>
              <strong style={{ fontSize: "20px" }}>
                {formatMembershipExpiry(subscriptionExpiresAt)}
              </strong>
            </div>
            <div>
              <p style={labelStyle}>TOEFL 目标分数</p>
              <strong style={{ fontSize: "20px" }}>
                {isLearningProfileLoaded
                  ? studyPlanTargetScore || "未设置"
                  : "读取中…"}
              </strong>
            </div>
            <div>
              <p style={labelStyle}>考试日期</p>
              <strong style={{ fontSize: "20px" }}>
                {formatAccountDate(studyPlanExamDate)}
              </strong>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsEditingAccountProfile((value) => !value)}
            style={{
              ...ctaStyle,
              background: "white",
              color: accent,
              border: `1px solid ${line}`,
              minHeight: "44px",
              padding: "10px 14px",
              whiteSpace: "nowrap",
            }}
          >
            编辑个人资料
          </button>
          {isEditingAccountProfile && (
            <div
              style={{
                gridColumn: "1 / -1",
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(180px, 1fr)) auto",
                gap: "12px",
                alignItems: "end",
                paddingTop: "16px",
                borderTop: `1px solid ${line}`,
              }}
            >
              <label>
                <p style={labelStyle}>姓名</p>
                <input
                  value={accountName}
                  onChange={(event) => setAccountName(event.target.value)}
                  placeholder={accountDisplayName}
                  style={accountInputStyle}
                />
              </label>
              <label>
                <p style={labelStyle}>目标分数</p>
                <input
                  type="number"
                  min="1"
                  max="6"
                  step="0.5"
                  value={studyPlanTargetScore}
                  onChange={(event) => setStudyPlanTargetScore(event.target.value)}
                  onBlur={() =>
                    setStudyPlanTargetScore((currentValue) =>
                      normalizeWritingTargetScore(currentValue) || "5.0"
                    )
                  }
                  placeholder="5.0"
                  inputMode="decimal"
                  style={accountInputStyle}
                />
              </label>
              <label>
                <p style={labelStyle}>考试日期</p>
                <input
                  type="date"
                  value={normalizedExamDateForInput}
                  onChange={(event) => setStudyPlanExamDate(event.target.value)}
                  style={accountInputStyle}
                />
              </label>
              <button
                type="button"
                onClick={async () => {
                  if (await saveLearningProfile()) {
                    setIsEditingAccountProfile(false);
                  }
                }}
                style={{
                  ...ctaStyle,
                  minHeight: "42px",
                  padding: "9px 16px",
                }}
              >
                保存
              </button>
            </div>
          )}
        </section>

        <section
          className="forge-motion-card"
          style={{
            ...cardStyle,
            padding: "18px 22px",
            display: "grid",
            gridTemplateColumns: "minmax(260px, 1fr) minmax(360px, 1.2fr) auto",
            gap: "18px",
            alignItems: "center",
          }}
        >
          <div>
            <p
              style={{
                margin: "0 0 6px",
                color: accent,
                fontSize: "13px",
                fontWeight: 900,
              }}
            >
              Daily Check-in
            </p>
            <h2 style={{ margin: 0, color: ink, fontSize: "22px", fontWeight: 950 }}>
              连续签到 {previewCheckInStreak} 天
            </h2>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: "10px",
            }}
          >
            {[
              [
                "限时积分",
                `${previewTemporaryCreditTotal} 分`,
                "每日签到 +1，30 天有效",
                examGreen,
              ],
              [
                "永久积分",
                `${previewPermanentCreditDisplayTotal} 分`,
                "里程碑和充值永久有效",
                accent,
              ],
              [
                "下一奖励",
                `${nextCheckInMilestone.days} 天 +${nextCheckInMilestone.bonus}`,
                `还差 ${Math.max(
                  0,
                  nextCheckInMilestone.days - previewCheckInStreak
                )} 天`,
                muted,
              ],
            ].map(([label, value, hint, valueColor]) => (
              <div
                key={label}
                style={{
                  border: `1px solid ${line}`,
                  borderRadius: softRadius,
                  background: "#fbfcff",
                  padding: "12px 14px",
                }}
              >
                <p style={{ margin: "0 0 5px", color: muted, fontSize: "12px", fontWeight: 850 }}>
                  {label}
                </p>
                <strong style={{ color: valueColor, fontSize: "18px" }}>{value}</strong>
                <p style={{ margin: "5px 0 0", color: muted, fontSize: "11px", fontWeight: 700 }}>
                  {hint}
                </p>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={handlePreviewCheckIn}
            disabled={hasCheckedInToday || isPreviewCheckInLoading}
            style={{
              ...aiCtaStyle,
              minHeight: "44px",
              padding: "10px 18px",
              background:
                hasCheckedInToday || isPreviewCheckInLoading
                  ? "#a7b2c6"
                  : examGreen,
              cursor:
                hasCheckedInToday || isPreviewCheckInLoading
                  ? "default"
                  : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {hasCheckedInToday
              ? "今日已签到"
              : isPreviewCheckInLoading
                ? "签到中…"
                : "签到 +1"}
          </button>
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(320px, 0.9fr) minmax(420px, 1.1fr)",
            gap: "18px",
          }}
        >
          <div style={{ ...cardStyle, padding: "22px 24px" }}>
            <h2 style={sectionTitleStyle}>备考档案 Study Profile</h2>
            <div style={{ display: "grid", gap: "14px" }}>
              {renderAccountFieldButton(
                "我的目标",
                `目标分 ${studyPlanTargetScore || "XX"}`,
                () => setIsEditingAccountProfile(true)
              )}
              {renderAccountFieldButton(
                "距离考试",
                daysUntilAccountExam === null
                  ? "未设置考试日期"
                  : `${daysUntilAccountExam} 天`,
                () => setIsEditingAccountProfile(true)
              )}
            </div>
          </div>

          <div style={{ ...cardStyle, padding: "22px 24px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "16px",
                alignItems: "center",
                marginBottom: "16px",
              }}
            >
              <h2 style={{ ...sectionTitleStyle, margin: 0 }}>学习概览</h2>
              <button
                type="button"
                onClick={goToAiRecordSection}
                style={{
                  border: 0,
                  background: "transparent",
                  color: accent,
                  fontSize: "14px",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                查看完整学习记录 →
              </button>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: "10px",
              }}
            >
              {accountStats.map((item) => (
                <div
                  key={item.label}
                  style={{
                    border: `1px solid ${line}`,
                    borderRadius: softRadius,
                    padding: "14px 12px",
                    background: "#fbfcff",
                  }}
                >
                  <p style={{ margin: "0 0 8px", color: muted, fontSize: "12px", fontWeight: 850 }}>
                    {item.label}
                  </p>
                  <strong style={{ fontSize: "22px", color: ink }}>
                    {item.value}
                  </strong>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section
          role="button"
          tabIndex={0}
          onClick={() => goToPreviewPage("store")}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              goToPreviewPage("store");
            }
          }}
          style={{
            ...cardStyle,
            padding: "22px 24px",
            cursor: "pointer",
            display: "grid",
            gap: "16px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "18px",
            }}
          >
            <div>
              <h2 style={{ ...sectionTitleStyle, margin: "0 0 8px" }}>
                Store 商店
              </h2>
              <p style={{ margin: 0, color: muted, fontSize: "14px", fontWeight: 750 }}>
                管理会员、Credits、季卡和购买记录。
              </p>
            </div>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                goToPreviewPage("store");
              }}
              style={{
                ...ctaStyle,
                minHeight: "42px",
                padding: "10px 16px",
                background: accent,
              }}
            >
              打开商店 →
            </button>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: "12px",
            }}
          >
            {[
              ["Membership", "管理 Official Questions 题库访问权限"],
              ["Credits", "用于 AI 批改与智能练习"],
              ["Seasonal Pass", "适合阶段性备考计划"],
            ].map(([label, value]) => (
              <div
                key={label}
                style={{
                  border: `1px solid ${line}`,
                  borderRadius: softRadius,
                  background: "#fbfcff",
                  padding: "14px 16px",
                }}
              >
                <p style={{ margin: "0 0 8px", color: accent, fontSize: "13px", fontWeight: 900 }}>
                  {label}
                </p>
                <strong style={{ color: ink, fontSize: "16px" }}>{value}</strong>
              </div>
            ))}
          </div>
        </section>

        <section style={{ ...cardStyle, padding: "22px 24px" }}>
          <h2 style={sectionTitleStyle}>账户设置</h2>
          <div style={{ display: "grid", gap: "12px" }}>
            {[
              ["个人资料", "编辑 →"],
              ["登录邮箱", maskedAccountEmail || "未登录"],
              ["修改密码", "修改 →"],
              ["界面语言", "简体中文"],
            ].map(([label, value]) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "18px",
                  alignItems: "center",
                  borderBottom: `1px solid ${line}`,
                  padding: "0 0 12px",
                  color: ink,
                  fontSize: "15px",
                  fontWeight: 850,
                }}
              >
                <span>{label}</span>
                <button
                  type="button"
                  onClick={() => {
                    if (label === "个人资料") setIsEditingAccountProfile(true);
                    if (label === "修改密码") setShowForgotPassword(true);
                  }}
                  style={{
                    border: 0,
                    background: "transparent",
                    color: label === "登录邮箱" || label === "界面语言" ? muted : accent,
                    font: "inherit",
                    cursor:
                      label === "登录邮箱" || label === "界面语言"
                        ? "default"
                        : "pointer",
                  }}
                >
                  {value}
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={onSignOut}
              style={{
                ...ctaStyle,
                background: "white",
                color: accent,
                border: `1px solid ${line}`,
                justifySelf: "start",
                minHeight: "42px",
                padding: "9px 16px",
              }}
            >
              退出登录
            </button>
            <button
              type="button"
              style={{
                border: 0,
                background: "transparent",
                color: "#be123c",
                justifySelf: "start",
                padding: 0,
                fontSize: "14px",
                fontWeight: 850,
                cursor: "pointer",
              }}
            >
              删除账户
            </button>
          </div>
        </section>
      </div>
    );
  }

 function renderCurrentPage() {
    if (previewPage === "daily") return renderDailyPage();
    if (previewPage === "library") return renderLibraryPage();
    if (previewPage === "records") {
      return window.location.pathname === "/mock-records"
        ? renderLibraryPage()
        : renderAiPage();
    }
    if (previewPage === "store") return renderStorePage();
    if (previewPage === "analytics") {
      return (
        <WritingAbilityAnalysisPage
          user={user}
          practiceRecords={records}
          mockRecords={mockRecords}
          pastExamSets={pastExamSets}
          isLoading={false}
          message=""
          onBackHome={() => goToPreviewPage("ai")}
          personalizedProfile={isPro ? personalizedProfile : null}
          onPracticeTopic={openPersonalizedFromAnalysis}
          embedded
        />
      );
    }
    if (previewPage === "calendar") {
      return renderStudyPlanPage();
    }
    if (previewPage === "account") {
      return renderAccountPage();
    }
    if (previewPage === "help" || previewPage === "support") {
      return renderHelpCenterPage();
    }
    return renderAiPage();
  }

  return (
    <div
      className="forge-app-shell"
      style={{
        minHeight: "100vh",
        background: shell,
        color: ink,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        position: "relative",
      }}
    >
      <style>
        {`
          @keyframes forgePreviewFadeIn {
            from { opacity: 0; transform: translateY(6px); }
            to { opacity: 1; transform: translateY(0); }
          }

          @keyframes forgeRedeemConfettiFall {
            0% {
              opacity: 0;
              transform: translate3d(0, -12vh, 0) rotate(0deg);
            }
            8% { opacity: 1; }
            86% { opacity: 1; }
            100% {
              opacity: 0;
              transform: translate3d(var(--confetti-drift), 112vh, 0)
                rotate(var(--confetti-turn));
            }
          }

          @keyframes forgeNotificationBellRing {
            0%, 72%, 100% { transform: rotate(0deg) translateY(0); }
            78% { transform: rotate(13deg) translateY(-1px); }
            84% { transform: rotate(-11deg) translateY(-1px); }
            90% { transform: rotate(8deg); }
            96% { transform: rotate(-4deg); }
          }

          .forge-notification-bell {
            position: relative;
            width: 32px;
            height: 32px;
            padding: 0;
            display: grid;
            place-items: center;
            border: 1px solid ${line};
            border-radius: 50%;
            background: white;
            color: ${accent};
            cursor: pointer;
          }

          .forge-notification-bell.has-unread svg {
            transform-origin: 50% 12%;
            animation: forgeNotificationBellRing 1.7s ease-in-out infinite;
          }

          .forge-notification-dot {
            position: absolute;
            top: 3px;
            right: 3px;
            width: 7px;
            height: 7px;
            border: 1.5px solid white;
            border-radius: 50%;
            background: #e5484d;
            box-sizing: content-box;
          }

          .forge-support-ticket-row::-webkit-details-marker {
            display: none;
          }

          .forge-support-ticket-row::marker {
            content: "";
          }

          .forge-support-modal-backdrop:hover,
          .forge-support-modal-backdrop:active {
            transform: none !important;
            filter: none !important;
            box-shadow: none !important;
          }

          .forge-notification-backdrop {
            position: fixed;
            inset: 0;
            z-index: 138;
            border: 0;
            background: rgba(18, 24, 43, 0.4);
            backdrop-filter: blur(4px);
            cursor: default;
          }

          .forge-notification-preview-backdrop {
            position: fixed;
            inset: 0;
            z-index: 138;
            border: 0;
            background: transparent;
            cursor: default;
          }

          .forge-notification-preview {
            position: fixed;
            top: 66px;
            right: 24px;
            z-index: 140;
            width: min(410px, calc(100vw - 28px));
            max-height: min(520px, calc(100vh - 86px));
            display: flex;
            flex-direction: column;
            overflow: hidden;
            border: 1px solid #e2e6ef;
            border-radius: 18px;
            background: #fbfcfe;
            box-shadow: 0 24px 70px rgba(31, 36, 64, 0.2), 0 4px 14px rgba(31, 36, 64, 0.06);
            animation: forgePreviewFadeIn 180ms ease-out both;
          }

          .forge-notification-preview::before {
            content: "";
            position: absolute;
            top: -7px;
            right: 20px;
            width: 13px;
            height: 13px;
            border-top: 1px solid #e2e6ef;
            border-left: 1px solid #e2e6ef;
            background: #f7fafc;
            transform: rotate(45deg);
          }

          .forge-notification-preview .forge-notification-list {
            overflow-y: auto;
            border: 0;
            padding: 8px;
            background: #fbfcfe;
          }

          .forge-notification-preview .forge-notification-panel-header strong {
            font-size: 16px;
          }

          .forge-notification-panel {
            position: fixed;
            top: 50%;
            left: 50%;
            z-index: 140;
            width: min(980px, calc(100vw - 48px));
            height: min(650px, calc(100vh - 88px));
            display: flex;
            flex-direction: column;
            overflow: hidden;
            border: 1px solid #e2e6ef;
            border-radius: 22px;
            background: #fbfcfe;
            box-shadow: 0 30px 90px rgba(25, 31, 56, 0.25), 0 8px 24px rgba(25, 31, 56, 0.08);
            transform: translate(-50%, -50%);
            animation: forgeNotificationModalIn 180ms ease-out both;
          }

          @keyframes forgeNotificationModalIn {
            from { opacity: 0; transform: translate(-50%, calc(-50% + 8px)); }
            to { opacity: 1; transform: translate(-50%, -50%); }
          }

          .forge-notification-panel-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 18px 22px;
            border-bottom: 1px solid #e8ebf2;
            background: linear-gradient(110deg, #f5fbfa 0%, #f8f8ff 100%);
          }

          .forge-notification-heading {
            display: grid;
            gap: 2px;
          }
          .forge-notification-heading strong {
            color: ${ink};
            font-size: 18px;
            letter-spacing: -0.01em;
          }
          .forge-notification-heading span {
            color: ${muted};
            font-size: 11px;
            font-weight: 650;
          }
          .forge-notification-panel-header-actions {
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .forge-notification-panel-header-actions button {
            border: 0;
            border-radius: 999px;
            background: transparent;
            padding: 7px 10px;
            color: ${examGreen};
            font-size: 12px;
            font-weight: 850;
            cursor: pointer;
          }
          .forge-notification-panel-header-actions .forge-notification-view-all {
            background: rgba(5, 128, 122, 0.09);
          }
          .forge-notification-panel-header-actions .forge-notification-close {
            width: 30px;
            height: 30px;
            display: grid;
            place-items: center;
            padding: 0;
            border: 1px solid #dfe3eb;
            border-radius: 50%;
            color: ${ink};
            font-size: 19px;
            line-height: 1;
          }

          .forge-notification-body {
            min-height: 0;
            flex: 1;
            display: grid;
            grid-template-columns: minmax(280px, 35%) minmax(0, 1fr);
          }
          .forge-notification-list-column {
            min-height: 0;
            display: flex;
            flex-direction: column;
            border-right: 1px solid #e8ebf2;
            background: #f5f7fa;
          }
          .forge-notification-list-column .forge-notification-list {
            min-height: 0;
            flex: 1;
            border-right: 0;
          }
          .forge-notification-list {
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 7px;
            padding: 12px;
            border-right: 1px solid #e8ebf2;
            background: #f5f7fa;
          }
          .forge-notification-pagination {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            padding: 10px 12px 12px;
            border-top: 1px solid #e6e9f0;
            color: ${muted};
            font-size: 11px;
            font-weight: 800;
          }
          .forge-notification-pagination button {
            width: 30px;
            height: 30px;
            display: grid;
            place-items: center;
            padding: 0;
            border: 1px solid #dce1e9;
            border-radius: 50%;
            background: white;
            color: ${examGreen};
            font-size: 19px;
            line-height: 1;
            cursor: pointer;
          }
          .forge-notification-pagination button:disabled {
            opacity: 0.35;
            cursor: default;
          }
          .forge-notification-item {
            width: 100%;
            display: grid;
            gap: 7px;
            flex: 0 0 auto;
            border: 1px solid transparent;
            border-radius: 12px;
            background: white;
            padding: 13px 14px;
            color: ${ink};
            text-align: left;
            cursor: pointer;
          }
          .forge-notification-item:hover { border-color: #dce4e8; }
          .forge-notification-item.is-unread {
            background: linear-gradient(135deg, #f2faf8, #f7f8ff);
          }
          .forge-notification-item.is-selected {
            position: relative;
            background: white;
            border-color: rgba(5, 128, 122, 0.38);
            box-shadow: 0 8px 20px rgba(42, 68, 83, 0.08);
          }
          .forge-notification-item.is-selected::before {
            content: "";
            position: absolute;
            top: 11px;
            bottom: 11px;
            left: -1px;
            width: 3px;
            border-radius: 0 3px 3px 0;
            background: ${examGreen};
          }
          .forge-notification-item-title {
            min-width: 0;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
          }
          .forge-notification-item strong {
            min-width: 0;
            overflow: hidden;
            color: ${ink};
            font-size: 13px;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .forge-notification-unread-mark {
            flex: 0 0 auto;
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: ${examGreen};
            box-shadow: 0 0 0 3px rgba(5, 128, 122, 0.1);
          }
          .forge-notification-item p {
            margin: 0;
            color: ${muted};
            font-size: 12px;
            line-height: 1.5;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
          }
          .forge-notification-item time { color: #9298aa; font-size: 10px; }
          .forge-notification-detail {
            min-width: 0;
            overflow-y: auto;
            padding: clamp(30px, 4vw, 52px);
            background:
              radial-gradient(circle at 100% 0%, rgba(83, 101, 255, 0.055), transparent 38%),
              white;
            text-align: left;
          }
          .forge-notification-detail time {
            display: block;
            margin-bottom: 18px;
            color: #9298aa;
            font-size: 12px;
          }
          .forge-notification-kind {
            display: inline-flex;
            align-items: center;
            margin-bottom: 16px;
            padding: 5px 9px;
            border: 1px solid rgba(5, 128, 122, 0.16);
            border-radius: 999px;
            background: rgba(5, 128, 122, 0.07);
            color: ${examGreen};
            font-size: 11px;
            font-weight: 850;
          }
          .forge-notification-detail h2 {
            margin: 0 0 22px;
            color: ${ink};
            font-size: clamp(22px, 3vw, 30px);
            line-height: 1.25;
          }
          .forge-notification-detail-message {
            margin: 0;
            color: ${muted};
            font-size: 15px;
            line-height: 1.9;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
          }
          .forge-notification-destination {
            margin-top: 28px;
            min-height: 42px;
            padding: 0 18px;
            border: 0;
            border-radius: 999px;
            background: ${examGreen};
            color: white;
            font-weight: 850;
            cursor: pointer;
          }
          .forge-notification-empty {
            margin: 0;
            padding: 38px 18px;
            color: ${muted};
            text-align: center;
            font-size: 13px;
          }

          .forge-redeem-confetti {
            position: fixed;
            inset: 0;
            z-index: 9999;
            overflow: hidden;
            pointer-events: none;
          }

          .forge-redeem-confetti-piece {
            position: absolute;
            top: -18px;
            animation-name: forgeRedeemConfettiFall;
            animation-timing-function: cubic-bezier(0.18, 0.66, 0.38, 1);
            animation-fill-mode: both;
            will-change: transform, opacity;
          }

          @keyframes forgeNavCpuGlow {
            0%, 100% { opacity: 0.18; transform: scale(0.55); }
            48% { opacity: 0.55; transform: scale(0.92); }
            72% { opacity: 0; transform: scale(1.42); }
          }

          @keyframes forgeNavCpuPulse {
            0%, 100% { filter: drop-shadow(0 0 0 rgba(83, 101, 255, 0)); }
            50% { filter: drop-shadow(0 0 4px rgba(83, 101, 255, 0.68)); }
          }

          @keyframes forgeNavSparkleCenter {
            0%, 4% { opacity: 0.3; transform: scale(0.64); }
            13%, 25% { opacity: 1; transform: scale(1.08); filter: drop-shadow(0 0 3px rgba(83, 101, 255, 0.7)); }
            35%, 100% { opacity: 0.28; transform: scale(0.78); filter: none; }
          }

          @keyframes forgeNavSparkleLowerLeft {
            0%, 29% { opacity: 0.25; transform: scale(0.56); }
            39%, 51% { opacity: 1; transform: scale(1.18); filter: drop-shadow(0 0 3px rgba(83, 101, 255, 0.72)); }
            61%, 100% { opacity: 0.25; transform: scale(0.72); filter: none; }
          }

          @keyframes forgeNavSparkleUpperRight {
            0%, 57% { opacity: 0.25; transform: scale(0.56); }
            67%, 79% { opacity: 1; transform: scale(1.16); filter: drop-shadow(0 0 3px rgba(83, 101, 255, 0.72)); }
            89%, 100% { opacity: 0.25; transform: scale(0.72); filter: none; }
          }

          @keyframes forgeNavSunSpin {
            to { transform: rotate(360deg); }
          }

          @keyframes forgeNavAtomOrbit {
            0% { transform: rotate(0deg) scale(0.94); }
            50% { transform: rotate(180deg) scale(1.07); }
            100% { transform: rotate(360deg) scale(0.94); }
          }

          @keyframes forgeNavCalendarCheck {
            0%, 18% { opacity: 0; transform: rotate(-45deg) scale(0.2); }
            36%, 68% { opacity: 1; transform: rotate(-45deg) scale(1); }
            86%, 100% { opacity: 0; transform: rotate(-45deg) scale(0.72); }
          }

          @keyframes forgeNavUserBreathe {
            0%, 100% { opacity: 0.74; transform: scale(0.92); }
            50% { opacity: 1; transform: scale(1.08); }
          }

          .forge-nav-icon {
            position: relative;
            isolation: isolate;
            overflow: visible;
          }

          .forge-nav-icon svg {
            position: relative;
            z-index: 1;
            transform-origin: center;
          }

          .forge-nav-icon--cpu.is-active::before {
            content: "";
            position: absolute;
            inset: 3px;
            z-index: 0;
            border-radius: 5px;
            background: radial-gradient(circle, rgba(83, 101, 255, 0.64) 0%, rgba(83, 101, 255, 0.12) 48%, transparent 72%);
            animation: forgeNavCpuGlow 1.7s ease-out infinite;
          }

          .forge-nav-icon--cpu.is-active svg {
            animation: forgeNavCpuPulse 1.7s ease-in-out infinite;
          }

          .forge-nav-icon--sparkles svg > * {
            transform-box: fill-box;
            transform-origin: center;
          }

          .forge-nav-icon--sparkles.is-active svg > path:first-child {
            animation: forgeNavSparkleCenter 2.7s ease-in-out infinite;
          }

          .forge-nav-icon--sparkles.is-active svg > circle {
            animation: forgeNavSparkleLowerLeft 2.7s ease-in-out infinite;
          }

          .forge-nav-icon--sparkles.is-active svg > path:nth-child(2),
          .forge-nav-icon--sparkles.is-active svg > path:nth-child(3) {
            animation: forgeNavSparkleUpperRight 2.7s ease-in-out infinite;
          }

          .forge-nav-icon--sun.is-active svg {
            animation: forgeNavSunSpin 4.8s linear infinite;
          }

          .forge-nav-icon--atom.is-active svg {
            animation: forgeNavAtomOrbit 3.2s linear infinite;
          }

          .forge-nav-icon--calendar.is-active::after {
            content: "";
            position: absolute;
            z-index: 2;
            top: 7px;
            left: 8px;
            width: 6px;
            height: 3px;
            border-left: 1.8px solid currentColor;
            border-bottom: 1.8px solid currentColor;
            border-radius: 0 0 0 1px;
            transform-origin: center;
            filter: drop-shadow(0 0 2px rgba(83, 101, 255, 0.45));
            animation: forgeNavCalendarCheck 2.2s ease-in-out infinite;
          }

          .forge-nav-icon--user.is-active svg {
            animation: forgeNavUserBreathe 2.2s ease-in-out infinite;
          }

          @media (prefers-reduced-motion: reduce) {
            .forge-nav-icon.is-active::before,
            .forge-nav-icon.is-active svg,
            .forge-notification-bell.has-unread svg,
            .forge-redeem-confetti-piece {
              animation: none !important;
            }
          }

          @media (max-width: 767px) {
            .forge-support-ticket-row {
              grid-template-columns: minmax(0, 1fr) auto !important;
              gap: 8px 12px !important;
            }
            .forge-support-ticket-meta {
              grid-column: 1;
              grid-row: 2;
              white-space: normal !important;
            }
            .forge-support-ticket-status {
              grid-column: 2;
              grid-row: 1 / span 2;
            }
            .forge-mobile-header-actions .forge-notification-bell {
              min-height: 32px;
              width: 32px;
              height: 32px;
              padding: 0;
              border-radius: 50%;
            }
            .forge-notification-panel {
              top: calc(50% + env(safe-area-inset-top) / 2);
              width: calc(100vw - 24px);
              height: min(720px, calc(100svh - 36px - env(safe-area-inset-top)));
              border-radius: 15px;
            }
            .forge-notification-preview {
              top: calc(68px + env(safe-area-inset-top));
              right: 14px;
              width: min(370px, calc(100vw - 28px));
              max-height: calc(100svh - 92px - env(safe-area-inset-top));
            }
            .forge-notification-body {
              grid-template-columns: 1fr;
              grid-template-rows: minmax(150px, 38%) minmax(0, 1fr);
            }
            .forge-notification-list {
              border-right: 0;
            }
            .forge-notification-list-column {
              border-right: 0;
              border-bottom: 1px solid #eceef5;
            }
            .forge-notification-detail {
              padding: 22px 20px 28px;
            }
          }

          .forge-preview-shell button,
          .forge-preview-shell a,
          .forge-preview-shell [role="button"] {
            transition: transform 180ms ease, filter 180ms ease, opacity 180ms ease, border-color 180ms ease, background-color 180ms ease, color 180ms ease, box-shadow 180ms ease;
          }

          .forge-preview-shell button:not(:disabled):hover,
          .forge-preview-shell [role="button"]:hover {
            transform: translateY(-2px);
            filter: brightness(1.02);
            box-shadow: 0 10px 22px rgba(52, 48, 125, 0.12);
          }

          .forge-preview-shell a:hover {
            transform: translateY(-1px);
            filter: brightness(1.03);
          }

          .forge-preview-shell button:not(:disabled):active,
          .forge-preview-shell a:active,
          .forge-preview-shell [role="button"]:active {
            transform: translateY(0) scale(0.99);
            filter: brightness(0.99);
          }

          .forge-preview-shell button:disabled {
            transform: none;
            box-shadow: none;
          }

          .forge-preview-shell button:focus-visible,
          .forge-preview-shell a:focus-visible,
          .forge-preview-shell [role="button"]:focus-visible {
            outline: 3px solid rgba(83, 101, 255, 0.24);
            outline-offset: 2px;
          }

          .forge-page-motion {
            animation: forgePreviewFadeIn 220ms ease both;
          }

          .forge-motion-card:hover {
            border-color: rgba(83, 101, 255, 0.38);
            box-shadow: 0 18px 34px rgba(52, 48, 125, 0.10);
          }
        `}
      </style>
      {redeemCelebrationId > 0 && (
        <div
          key={redeemCelebrationId}
          className="forge-redeem-confetti"
          aria-hidden="true"
        >
          {Array.from({ length: 112 }, (_, index) => {
            const colors = [
              "#5365ff",
              "#00756f",
              "#f4b400",
              "#ff7a59",
              "#b05cff",
              "#24a8e0",
            ];
            const left = (index * 37 + 11) % 101;
            const delay = ((index * 13) % 16) / 100;
            const duration = 4.46 + ((index * 17) % 38) / 100;
            const drift = ((index * 43) % 181) - 90;
            const turn = 420 + ((index * 71) % 520);
            const width = 8 + (index % 4) * 2;
            const height = index % 5 === 0 ? width : 11 + (index % 3) * 3;
            const confettiStyle = {
              left: `${left}%`,
              width: `${width}px`,
              height: `${height}px`,
              borderRadius: index % 5 === 0 ? "999px" : "2px",
              background: colors[index % colors.length],
              animationDelay: `${delay}s`,
              animationDuration: `${duration}s`,
              "--confetti-drift": `${drift}px`,
              "--confetti-turn": `${turn}deg`,
            } as CSSProperties;

            return (
              <span
                key={index}
                className="forge-redeem-confetti-piece"
                style={confettiStyle}
              />
            );
          })}
        </div>
      )}
      <header
        className={`forge-mobile-header${previewBackAvailable ? " has-back" : ""}`}
      >
        <img src="/forge-logo-trimmed.png" alt="FORGE" />
        <div className="forge-mobile-header-actions">
          {user && renderSupportCenterButton()}
          {previewBackAvailable && (
            <button
              type="button"
              className="forge-mobile-back"
              onClick={goBackPreviewPage}
              aria-label="返回上一页"
            >
              ‹ 返回
            </button>
          )}
          {user && renderNotificationBell()}
          <button type="button" onClick={() => goToPreviewPage("store")}>
            ◇ {previewCreditBalance}
          </button>
          <button type="button" onClick={() => goToPreviewPage("account")}>
            {isPro ? "Pro" : "Free"}
          </button>
        </div>
      </header>
      {showNotifications && user && (
        <>
          <button
            type="button"
            className="forge-notification-preview-backdrop"
            onClick={() => setShowNotifications(false)}
            aria-label="关闭未读通知预览"
          />
          <section
            className="forge-notification-preview"
            aria-label="未读通知预览"
          >
            <div className="forge-notification-panel-header">
              <div className="forge-notification-heading">
                <strong>Notifications</strong>
                <span>{unreadNotificationCount} 条未读通知</span>
              </div>
              <div className="forge-notification-panel-header-actions">
                <button
                  type="button"
                  className="forge-notification-view-all"
                  onClick={openAllNotifications}
                >
                  View All
                </button>
                {unreadNotificationCount > 0 && (
                  <button
                    type="button"
                    onClick={() => void markAllNotificationsRead()}
                  >
                    一键已读
                  </button>
                )}
              </div>
            </div>
            <div className="forge-notification-list" aria-label="未读通知列表">
              {isLoadingNotifications && userNotifications.length === 0 && (
                <p className="forge-notification-empty">正在加载通知...</p>
              )}
              {!isLoadingNotifications && latestUnreadNotifications.length === 0 && (
                <p className="forge-notification-empty">暂无未读通知</p>
              )}
              {latestUnreadNotifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  className="forge-notification-item is-unread"
                  onClick={() => openNotification(notification)}
                >
                  <div className="forge-notification-item-title">
                    <strong>{notification.title}</strong>
                    <span
                      className="forge-notification-unread-mark"
                      aria-label="未读"
                    />
                  </div>
                  <p>{notification.message}</p>
                  <time>
                    {new Date(notification.createdAt).toLocaleString("zh-CN")}
                  </time>
                </button>
              ))}
            </div>
          </section>
        </>
      )}
      {showNotificationDetail && user && (
        <>
          <button
            type="button"
            className="forge-notification-backdrop"
            onClick={() => setShowNotificationDetail(false)}
            aria-label="关闭通知详情"
          />
          <section
            className="forge-notification-panel"
            role="dialog"
            aria-modal="true"
            aria-label="通知中心"
          >
            <div className="forge-notification-panel-header">
              <div className="forge-notification-heading">
                <strong>Notification Center</strong>
                <span>{userNotifications.length} 条通知</span>
              </div>
              <div className="forge-notification-panel-header-actions">
                {unreadNotificationCount > 0 && (
                  <button
                    type="button"
                    onClick={() => void markAllNotificationsRead()}
                  >
                    全部已读
                  </button>
                )}
                <button
                  type="button"
                  className="forge-notification-close"
                  onClick={() => setShowNotificationDetail(false)}
                  aria-label="关闭通知中心"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="forge-notification-body">
              <div className="forge-notification-list-column">
                <div className="forge-notification-list" aria-label="通知列表">
                  {paginatedNotifications.map((notification) => (
                    <button
                      key={notification.id}
                      type="button"
                      className={`forge-notification-item${
                        notification.readAt ? "" : " is-unread"
                      }${
                        selectedNotification?.id === notification.id
                          ? " is-selected"
                          : ""
                      }`}
                      onClick={() => openNotification(notification)}
                      aria-pressed={selectedNotification?.id === notification.id}
                    >
                      <div className="forge-notification-item-title">
                        <strong>{notification.title}</strong>
                        {!notification.readAt && (
                          <span
                            className="forge-notification-unread-mark"
                            aria-label="未读"
                          />
                        )}
                      </div>
                      <p>{notification.message}</p>
                      <time>
                        {new Date(notification.createdAt).toLocaleString("zh-CN")}
                      </time>
                    </button>
                  ))}
                </div>
                {userNotifications.length > 6 && (
                  <nav
                    className="forge-notification-pagination"
                    aria-label="通知分页"
                  >
                    <button
                      type="button"
                      disabled={visibleNotificationPage === 1}
                      onClick={() =>
                        goToNotificationPage(visibleNotificationPage - 1)
                      }
                      aria-label="上一页"
                    >
                      ‹
                    </button>
                    <span>
                      {visibleNotificationPage} / {notificationPageCount}
                    </span>
                    <button
                      type="button"
                      disabled={visibleNotificationPage === notificationPageCount}
                      onClick={() =>
                        goToNotificationPage(visibleNotificationPage + 1)
                      }
                      aria-label="下一页"
                    >
                      ›
                    </button>
                  </nav>
                )}
              </div>
              <article className="forge-notification-detail" aria-live="polite">
                {selectedNotification ? (
                  <>
                    <span className="forge-notification-kind">
                      {selectedNotification.kind === "support_reply"
                        ? "客服回复"
                        : selectedNotification.kind === "admin_broadcast"
                          ? "FORGE 通知"
                          : "系统通知"}
                    </span>
                    <time>
                      {new Date(selectedNotification.createdAt).toLocaleString(
                        "zh-CN"
                      )}
                    </time>
                    <h2>{selectedNotification.title}</h2>
                    <p className="forge-notification-detail-message">
                      {selectedNotification.message}
                    </p>
                    {selectedNotification.destination === "help" && (
                      <button
                        type="button"
                        className="forge-notification-destination"
                        onClick={() =>
                          followNotificationDestination(selectedNotification)
                        }
                      >
                        查看客服记录
                      </button>
                    )}
                  </>
                ) : (
                  <p className="forge-notification-empty">选择一条通知查看详情</p>
                )}
              </article>
            </div>
          </section>
        </>
      )}
      <aside
	          className="forge-desktop-sidebar"
	          style={{
	            position: "fixed",
	            left: 0,
	            top: 0,
	            bottom: 0,
	            width: sideWidth,
	            background: "rgba(255, 255, 255, 0.94)",
	            borderRight: `1px solid ${line}`,
	            zIndex: 20,
	            padding: "22px 16px",
	            display: "flex",
	            flexDirection: "column",
	            gap: "6px",
	            boxShadow: "8px 0 28px rgba(52, 48, 125, 0.05)",
	          }}
	        >
        <div
          style={{
            padding: "0 4px 28px",
            display: "flex",
            alignItems: "center",
          }}
        >
          <img
            src="/forge-logo-trimmed.png"
            alt="FORGE"
            style={{
              width: "134px",
              height: "auto",
              display: "block",
              objectFit: "contain",
            }}
          />
        </div>
        {navItems.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => goToPreviewPage(item.key)}
            title={item.label}
            style={{
              border: "none",
              borderRadius: softRadius,
              background: previewPage === item.key ? active : "transparent",
              width: "100%",
              minHeight: "44px",
              display: "grid",
              gridTemplateColumns: "26px 1fr",
              gap: "11px",
              alignItems: "center",
              color: previewPage === item.key ? "#5365ff" : muted,
              fontSize: "13px",
              fontWeight: previewPage === item.key ? 900 : 750,
              lineHeight: 1.2,
              textAlign: "left",
              cursor: "pointer",
              padding: "10px 11px",
            }}
          >
            <span
              aria-hidden="true"
              className={`forge-nav-icon forge-nav-icon--${
                item.key === "ai" ? "cpu" :
                item.key === "library" ? "sparkles" :
                item.key === "daily" ? "sun" :
                item.key === "analytics" ? "atom" :
                item.key === "calendar" ? "calendar" :
                "user"
              }${previewPage === item.key ? " is-active" : ""}`}
              style={{
                width: "22px",
                height: "22px",
                borderRadius: "6px",
                border: `1px solid ${previewPage === item.key ? "#bfc6ff" : "#d7dbea"}`,
                display: "grid",
                placeItems: "center",
                background: previewPage === item.key ? "white" : "#fbfcff",
                color: previewPage === item.key ? "#5365ff" : "#7b8198",
                transition:
                  "color 160ms ease, border-color 160ms ease, background-color 160ms ease",
              }}
            >
              <MorphIcon
                icon={item.icon}
                size={15}
                strokeWidth={2}
                reducedMotion="user"
              />
            </span>
            <span>{item.label}</span>
          </button>
        ))}
	        <div
	          style={{
	            marginTop: "auto",
	            paddingTop: "18px",
	            borderTop: `1px solid ${line}`,
	            display: "grid",
	            gap: "14px",
	          }}
	        >
	          <a
	            href="https://toefl.neea.cn"
	            target="_blank"
	            rel="noopener noreferrer"
	            style={{
	              border: `1px solid ${line}`,
	              borderRadius: softRadius,
	              background: "white",
	              color: accent,
	              padding: "9px 10px",
	              textAlign: "center",
	              fontSize: "12px",
	              fontWeight: 900,
	              textDecoration: "none",
	              boxShadow: "0 8px 18px rgba(52, 48, 125, 0.05)",
	            }}
	          >
	            报名托福网考
	          </a>
	          <button
	            type="button"
	            onClick={() => goToPreviewPage("store")}
	            style={{
	              border: "none",
	              borderRadius: softRadius,
	              background: "linear-gradient(135deg, #f4f2ff, #fbfbff)",
	              boxShadow: "0 10px 26px rgba(83, 101, 255, 0.10)",
	              padding: "12px 13px",
	              display: "grid",
	              gridTemplateColumns: "24px 1fr",
	              gap: "10px",
	              alignItems: "center",
	              textAlign: "left",
	              cursor: "pointer",
	            }}
	          >
		            <span style={{ color: "#5365ff", fontSize: "18px", alignSelf: "start" }}>◇</span>
		            <span style={{ display: "grid", gap: "5px" }}>
		              <span style={{ color: muted, fontSize: "10px", fontWeight: 850 }}>
		                Credits · {previewCreditBalance}
		              </span>
		              <span style={{ display: "grid", gap: "3px" }}>
		                <span
		                  style={{
		                    display: "flex",
		                    justifyContent: "space-between",
		                    gap: "8px",
		                    color: examGreen,
		                    fontSize: "11px",
		                    fontWeight: 900,
		                  }}
		                >
		                  <span>限时积分</span>
		                  <strong>{previewTemporaryCreditTotal}</strong>
		                </span>
		                <span
		                  style={{
		                    display: "flex",
		                    justifyContent: "space-between",
		                    gap: "8px",
		                    color: accent,
		                    fontSize: "11px",
		                    fontWeight: 900,
		                  }}
		                >
		                  <span>永久积分</span>
		                  <strong>{previewPermanentCreditDisplayTotal}</strong>
		                </span>
		              </span>
		            </span>
		          </button>
	          <button
	            type="button"
	            onClick={() => goToPreviewPage("account")}
	            title="My Account"
	            style={{
	              border: "none",
	              borderRadius: softRadius,
	              background: previewPage === "account" ? active : "transparent",
	              width: "100%",
	              minHeight: "44px",
	              display: "grid",
	              gridTemplateColumns: "28px 1fr 12px",
	              gap: "10px",
	              alignItems: "center",
	              color: previewPage === "account" ? "#5365ff" : muted,
	              fontSize: "12px",
	              fontWeight: previewPage === "account" ? 900 : 750,
	              lineHeight: 1.2,
	              textAlign: "left",
	              cursor: "pointer",
	              padding: "8px 10px",
	            }}
	          >
	            <span
	              aria-hidden="true"
	              style={{
	                width: "24px",
	                height: "24px",
	                borderRadius: "999px",
	                display: "grid",
	                placeItems: "center",
	                fontSize: "10px",
	                fontWeight: 900,
	                background: "#778196",
	                color: "white",
	              }}
	            >
	              U
	            </span>
	            <span style={{ display: "grid", gap: "2px" }}>
	              <span style={{ color: ink, fontSize: "12px", fontWeight: 850 }}>
	                {accountDisplayName}
	              </span>
	              <span style={{ color: muted, fontSize: "10px", fontWeight: 750 }}>
                  {isPro ? "Pro" : "Free"}
                </span>
	            </span>
	            <span style={{ color: muted, fontSize: "12px" }}>⌄</span>
	          </button>
	          <button
	            type="button"
	            onClick={onSignOut}
	            style={{
	              border: "none",
	              background: "transparent",
	              color: muted,
	              display: "grid",
	              gridTemplateColumns: "24px 1fr",
	              gap: "10px",
	              alignItems: "center",
	              textAlign: "left",
	              padding: "8px 10px",
	              fontSize: "12px",
	              fontWeight: 800,
	              cursor: "pointer",
	            }}
	          >
	            <span style={{ fontSize: "15px" }}>↪</span>
	            <span>Log out</span>
	          </button>
	        </div>
	      </aside>

      <nav className="forge-mobile-bottom-nav" aria-label="Mobile navigation">
        {navItems.map((item) => {
          const isActive = previewPage === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => goToPreviewPage(item.key)}
              className={isActive ? "is-active" : undefined}
              aria-current={isActive ? "page" : undefined}
            >
              <span
                aria-hidden="true"
                className={`forge-nav-icon forge-nav-icon--${
                  item.key === "ai" ? "cpu" :
                  item.key === "library" ? "sparkles" :
                  item.key === "daily" ? "sun" :
                  item.key === "analytics" ? "atom" :
                  item.key === "calendar" ? "calendar" :
                  "user"
                }${isActive ? " is-active" : ""}`}
              >
                <MorphIcon
                  icon={item.icon}
                  size={19}
                  strokeWidth={2}
                  reducedMotion="user"
                />
              </span>
              <span>{item.mobileLabel}</span>
            </button>
          );
        })}
      </nav>

      <main className="forge-main-content" style={{ minWidth: 0, marginLeft: sideWidth }}>
        <section
          className="forge-main-section"
          style={{
            background: "white",
            minHeight: "100vh",
            padding: user ? "82px 48px 44px" : "24px 48px 44px",
            boxSizing: "border-box",
          }}
        >
          <div
            className="forge-main-inner"
            style={{
              maxWidth: "1440px",
              margin: "0 auto",
            }}
          >
            {renderAuthBox()}
            <div
              className={`forge-page-motion forge-mobile-page forge-mobile-page--${previewPage}`}
              key={previewPage}
            >
            {renderCurrentPage()}
            </div>
            {renderAiPracticeSelector()}
            {renderPersonalizedPracticeSelector()}
            {renderPreviewRandomModal()}
          </div>
        </section>
      </main>
    </div>
  );
}

// A simple paywall component displayed when the user has not purchased access
// to a given question library.
function AccessPaywall({
  title,
  description,
  onBackHome,
}: {
  title: string;
  description: string;
  onBackHome: () => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onBackHome}
        style={{
          padding: "10px 16px",
          border: "1px solid #cbd5e1",
          borderRadius: "12px",
          background: "white",
          fontWeight: 700,
          cursor: "pointer",
          marginBottom: "24px",
        }}
      >
        返回首页
      </button>
      <section
        style={{
          background: "white",
          border: "1px solid #e2e8f0",
          borderRadius: "20px",
          padding: "24px",
          marginBottom: "24px",
          boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
        }}
      >
        <h1 style={{ marginTop: 0 }}>{title}</h1>
        <p style={{ color: "#64748b", lineHeight: 1.8 }}>{description}</p>
        <p style={{ color: "#be123c", marginTop: "16px" }}>
          当前账户为 Free。请升级 Pro 后再访问此内容。
        </p>
      </section>
    </>
  );
}

function PastExamDetailPage({
  examId,
  examSet,
  message,
  onStart,
  onBack,
}: {
  examId: string;
  examSet: QuestionSet | null;
  message: string;
  onStart: () => void;
  onBack: () => void;
}) {

  return (
    <div style={{ textAlign: "left" }}>
      <button
        type="button"
        onClick={onBack}
        style={{
          padding: "10px 16px",
          border: "1px solid #cbd5e1",
          borderRadius: "12px",
          background: "white",
          fontWeight: 700,
          cursor: "pointer",
          marginBottom: "24px",
        }}
      >
        返回 Official Questions
      </button>

      <section
        style={{
          background: "white",
          border: "1px solid #e2e8f0",
          borderRadius: "20px",
          padding: "24px",
          marginBottom: "24px",
          boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
        }}
      >
        <h1 style={{ marginTop: 0 }}>
          {getOfficialQuestionsDisplayText(examSet?.title) ||
            "Official Questions"}
        </h1>

        <p style={{ color: "#64748b", lineHeight: 1.8 }}>
          当前 Official Questions ID：{examId}
        </p>

        <p style={{ color: "#64748b", lineHeight: 1.8 }}>
          日期：{examSet?.display_date || "No date"}
        </p>

        {message && (
          <p style={{ color: "#be123c", fontWeight: 700 }}>
        {message}
      </p>
    )}

    <button
      type="button"
      onClick={onStart}
      style={{
        padding: "12px 18px",
        border: "none",
        borderRadius: "14px",
        background: "#111827",
        color: "white",
        fontWeight: 800,
        cursor: "pointer",
        marginTop: "12px",
      }}
    >
      开始完整练习
    </button>



      </section>

      <section
        style={{
          background: "white",
          border: "1px solid #e2e8f0",
          borderRadius: "20px",
          padding: "24px",
          boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Question Content</h2>

        <QuestionSetContentPreview content={examSet?.content || {}} />

      </section>
    </div>
  );
}

function EtsMockDetailPage({
  mockId,
  mockSet,
  message,
  mockRecords,
  onOpenRecordDetail,
  onRecordContextMenu,
  onStart,
  onStartSingle,
  onBack,
  embedded = false,
}: {
  mockId: string;
  mockSet: QuestionSet | null;
  message: string;
  mockRecords: MockRecord[];
  onOpenRecordDetail: (detail: PastExamRecordDetail) => void;
  onRecordContextMenu: (
    event: MouseEvent<HTMLElement>,
    target: DeleteRecordTarget
  ) => void;
  onStart: () => void;
  onStartSingle: (
    type: PastExamPracticeType,
    task: QuestionSetTask
  ) => void;
  onBack: () => void;
  embedded?: boolean;
}) {
  const mockTasks = Array.isArray(mockSet?.content.tasks)
    ? mockSet.content.tasks
    : [];
  const availablePreviewTypes = (
    ["sentence", "email", "discussion"] as PastExamPracticeType[]
  ).filter((type) => mockTasks.some((task) => task.type === type));
  const [previewType, setPreviewType] = useState<PastExamPracticeType>(
    availablePreviewTypes[0] || "sentence"
  );

  useEffect(() => {
    setPreviewType(availablePreviewTypes[0] || "sentence");
  }, [mockSet?.id]);

  const selectedPreviewTask = mockTasks.find(
    (task) => task.type === previewType
  );
  const setRecordLinks = mockSet
    ? mockRecords
        .filter((record) => isMockRecordForQuestionSet(record, mockSet))
        .map((record) => ({
          id: record.id,
          createdAt: record.created_at,
          finalScore: Number(record.final_score),
          sentenceScore: Number(record.sentence_score),
          emailScore: record.email_score,
          discussionScore: record.discussion_score,
          detail: {
            kind: "mock-full" as const,
            record,
          },
        }))
        .sort(
          (left, right) =>
            Date.parse(right.createdAt || "") - Date.parse(left.createdAt || "")
        )
    : [];


  return (
    <div style={{ textAlign: "left" }}>
      {!embedded && (
        <button
          type="button"
          onClick={onBack}
          style={{
            padding: "10px 16px",
            border: "1px solid #cbd5e1",
            borderRadius: "12px",
            background: "white",
            fontWeight: 700,
            cursor: "pointer",
            marginBottom: "24px",
          }}
        >
          返回 ETS Mock 列表
        </button>
      )}

      <section
        style={{
          background: "white",
          border: "1px solid #e2e8f0",
          borderRadius: "20px",
          padding: "24px",
          marginBottom: "24px",
          boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
        }}
      >
        <h1 style={{ marginTop: 0 }}>
          {mockSet?.title || `Mock Test ${mockId}`}
        </h1>

        {message && (
          <p style={{ color: "#be123c", fontWeight: 700 }}>
          {message}
        </p>
      )}

      <button
        type="button"
        onClick={onStart}
        style={{
          padding: "12px 18px",
          border: "none",
          borderRadius: "14px",
          background: "#111827",
          color: "white",
          fontWeight: 800,
          cursor: "pointer",
          marginTop: "12px",
        }}
      >
        开始完整练习
      </button>
      </section>

      <section
        style={{
          background: "white",
          border: "1px solid #e2e8f0",
          borderRadius: "20px",
          padding: "24px",
          boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flexWrap: "wrap",
            marginBottom: "20px",
          }}
        >
          {availablePreviewTypes.map((type) => {
            const label =
              type === "sentence"
                ? "Build a Sentence"
                : type === "email"
                ? "Email Writing"
                : "Academic Discussion";
            const isActive = previewType === type;

            return (
              <button
                key={type}
                type="button"
                onClick={() => setPreviewType(type)}
                aria-pressed={isActive}
                style={{
                  border: `1px solid ${isActive ? "#4338ca" : "#cbd5e1"}`,
                  borderRadius: "12px",
                  background: isActive ? "#4338ca" : "white",
                  color: isActive ? "white" : "#312e81",
                  padding: "10px 16px",
                  fontWeight: 850,
                  cursor: "pointer",
                  transition: "background 160ms ease, color 160ms ease, border-color 160ms ease",
                }}
              >
                {label}
              </button>
            );
          })}
          {selectedPreviewTask && (
            <button
              type="button"
              onClick={() => onStartSingle(previewType, selectedPreviewTask)}
              style={{
                marginLeft: "auto",
                border: "none",
                borderRadius: "12px",
                background: "#00756f",
                color: "white",
                padding: "11px 18px",
                fontWeight: 850,
                cursor: "pointer",
              }}
            >
              练习此题型
            </button>
          )}
        </div>

        <QuestionSetContentPreview
          content={{
            ...mockSet?.content,
            tasks: selectedPreviewTask ? [selectedPreviewTask] : [],
          }}
        />
      </section>

      <section
        style={{
          background: "white",
          border: "1px solid #e2e8f0",
          borderRadius: "20px",
          padding: "24px",
          marginTop: "24px",
          boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
        }}
      >
        <h2 style={{ marginTop: 0 }}>练习记录</h2>

        {setRecordLinks.length === 0 && (
          <p style={{ margin: 0, color: "#64748b", lineHeight: 1.7 }}>
            暂无这套题的练习记录。
          </p>
        )}

        {setRecordLinks.length > 0 && (
          <div style={{ display: "grid", gap: "10px" }}>
            {setRecordLinks.map((record) => (
              <button
                key={record.id}
                type="button"
                onClick={() => onOpenRecordDetail(record.detail)}
                onContextMenu={(event) =>
                  onRecordContextMenu(event, {
                    source: "mock",
                    id: record.id,
                    label: "ETS 套题模考",
                  })
                }
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto auto",
                  gap: "14px",
                  alignItems: "center",
                  padding: "14px 16px",
                  borderRadius: "14px",
                  border: "1px solid #e2e8f0",
                  background: "#f8fafc",
                  color: "#111827",
                  cursor: "pointer",
                  fontWeight: 800,
                  textAlign: "left",
                }}
              >
                <span style={{ color: "#64748b" }}>
                  {new Date(record.createdAt).toLocaleString()}
                </span>
                <span style={{ color: "#312e81" }}>
                  Final{" "}
                  {Number.isNaN(record.finalScore)
                    ? "-"
                    : record.finalScore.toFixed(1)}{" "}
                  / 6.0
                </span>
                <span style={{ color: "#64748b", fontSize: "14px" }}>
                  Sentence{" "}
                  {Number.isNaN(record.sentenceScore)
                    ? "-"
                    : record.sentenceScore.toFixed(1)}{" "}
                  · Email {record.emailScore} · Discussion {record.discussionScore}
                </span>
                <span style={{ color: "#00756f" }}>查看详情</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function QuestionSetContentPreview({ content }: { content: QuestionSetContent }) {
  const tasks = Array.isArray(content.tasks) ? content.tasks : [];

  if (tasks.length === 0) {
    return (
      <p style={{ color: "#64748b", lineHeight: 1.8 }}>
        这套题暂时还没有录入具体题目。之后可以在 Supabase 的
        question_sets.content.tasks 中继续补充。
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gap: "18px" }}>
      {tasks.map((task, index) => {
        if (task.type === "sentence") {
          return (
            <section
              key={`${task.type}-${index}`}
              style={{
                padding: "18px",
                borderRadius: "16px",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
              }}
            >
              <h3 style={{ marginTop: 0 }}>{task.title}</h3>

              <p style={{ color: "#64748b" }}>
                共 {task.questions.length} 道 Build a Sentence 题。
              </p>

              <div style={{ display: "grid", gap: "12px" }}>
                {task.questions.slice(0, 3).map((question, qIndex) => (
                  <div
                    key={`${question.target}-${qIndex}`}
                    style={{
                      background: "white",
                      border: "1px solid #e2e8f0",
                      borderRadius: "14px",
                      padding: "14px",
                    }}
                  >
                    <strong>Question {qIndex + 1}</strong>
                    <p style={{ lineHeight: 1.7, marginBottom: "6px" }}>
                      {question.contextSpeaker}: {question.contextSentence}
                    </p>
                    <div style={{ lineHeight: 1.9, margin: 0 }}>
                      {question.answerSpeaker}:{" "}
                      {question.parts.map((part, partIndex) =>
                        part.type === "fixed" ? (
                          <span key={`fixed-${partIndex}`}>{part.text} </span>
                        ) : (
                          <span
                            key={`blank-${partIndex}`}
                            aria-label="待填写"
                            style={{
                              display: "inline-block",
                              width: "72px",
                              borderBottom: "2px solid #475569",
                              margin: "0 6px",
                              transform: "translateY(-4px)",
                            }}
                          />
                        )
                      )}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "8px",
                        marginTop: "12px",
                      }}
                    >
                      {question.chunks.map((chunk, chunkIndex) => (
                        <span
                          key={`${chunk}-${chunkIndex}`}
                          style={{
                            padding: "5px 9px",
                            borderRadius: "8px",
                            background: "#eef2f7",
                            color: "#475569",
                            fontSize: "14px",
                            fontWeight: 700,
                          }}
                        >
                          {chunk}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        }

        if (task.type === "email") {
          const theme = getPastExamTaskTheme(task);
          return (
            <section
              key={`${task.type}-${index}`}
              style={{
                padding: "18px",
                borderRadius: "16px",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "16px",
                  marginBottom: "18px",
                }}
              >
                <h3 style={{ margin: 0 }}>{task.title}</h3>
                <span
                  style={{
                    flexShrink: 0,
                    padding: "6px 12px",
                    borderRadius: "999px",
                    background: "#eef8f8",
                    color: "#00756f",
                    fontSize: "14px",
                    fontWeight: 850,
                  }}
                >
                  {theme}
                </span>
              </div>

              <p style={{ color: "#475569", lineHeight: 1.8 }}>
                {task.prompt.scenario}
              </p>

              <strong>{task.prompt.task}</strong>

              <ul style={{ lineHeight: 1.8 }}>
                {task.prompt.requirements.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          );
        }

        if (task.type === "discussion") {
          const theme = getPastExamTaskTheme(task);
          return (
            <section
              key={`${task.type}-${index}`}
              style={{
                padding: "18px",
                borderRadius: "16px",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "16px",
                  marginBottom: "18px",
                }}
              >
                <h3 style={{ margin: 0 }}>{task.title}</h3>
                <span
                  style={{
                    flexShrink: 0,
                    padding: "6px 12px",
                    borderRadius: "999px",
                    background: "#eef8f8",
                    color: "#00756f",
                    fontSize: "14px",
                    fontWeight: 850,
                  }}
                >
                  {theme}
                </span>
              </div>

              <p style={{ color: "#475569", lineHeight: 1.8 }}>
                <strong>Professor:</strong> {task.prompt.professor}
              </p>

              <p style={{ color: "#475569", lineHeight: 1.8 }}>
                <strong>{task.prompt.studentOneName}:</strong>{" "}
                {task.prompt.studentOnePost}
              </p>

              <p style={{ color: "#475569", lineHeight: 1.8 }}>
                <strong>{task.prompt.studentTwoName}:</strong>{" "}
                {task.prompt.studentTwoPost}
              </p>

            </section>
          );
        }

        return null;
      })}
    </div>
  );
}

// A unified page that displays all locally recorded practice sessions. Each
// entry shows the practice type, the duration, the achieved score (or
// "未完成"), and the date. This allows users to get a quick overview of
// how long they have spent on each practice and how they performed.
export default App;
