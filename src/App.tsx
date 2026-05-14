import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

type Page =
  | "home"
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
  | "past-exam-detail"
  | "ets-mock-practice"
  | "ets-mock-detail";

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

type Question = {
  id: number;
  contextSpeaker: string;
  contextSentence: string;
  answerSpeaker: string;
  target: string;
  parts: Part[];
  chunks: string[];
  explanation: string;
};

type EmailPrompt = {
  title: string;
  scenario: string;
  task: string;
  requirements: string[];
  suggestedLength: string;
};

type DiscussionPrompt = {
  title: string;
  professor: string;
  studentOneName: string;
  studentOnePost: string;
  studentTwoName: string;
  studentTwoPost: string;
  question: string;
  suggestedLength: string;
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
};
type MockSentenceQuestion = Question;

type MockTestData = {
  sentenceQuestions: MockSentenceQuestion[];
  emailPrompt: EmailPrompt;
  discussionPrompt: DiscussionPrompt;
  cost?: number;
  balance?: number;
};

type MockResult = {
  recordId?: string;
  sentenceScore: number;
  emailScore: string;
  discussionScore: string;
  finalScore: number;
  emailFeedback: WritingFeedback;
  discussionFeedback: WritingFeedback;
  knowledgeAnalysis: string[];
  studyAdvice: string[];
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
const EMAIL_SCORING_COST = 3;
const DISCUSSION_SCORING_COST = 3;
const announcements = [
  {
    id: 1,
    tag: "优惠",
    title: "新用户体验兑换码",
    content: "输入兑换码 TOEFL 可获得 10 points，用于体验写作批改或完整模考。",
    date: "2026-05-13",
  },
  {
    id: 2,
    tag: "功能更新",
    title: "Full Mock Test 已上线",
    content:
      "现在可以完成 Build a Sentence、Email Writing 和 Academic Discussion 三部分完整模考，并获得 6 分制总分、知识点分析和备考建议。",
    date: "2026-05-13",
  },
];


const sampleEmailPrompt: EmailPrompt = {
  title: "Email Writing Practice",
  scenario:
    "You received an email from your professor about missing a class presentation. Your professor says that the presentation was an important part of your final grade.",
  task: "Write a reply to your professor.",
  requirements: [
    "Apologize for missing the presentation.",
    "Explain why you were absent.",
    "Ask whether you can make up the presentation.",
  ],
  suggestedLength: "Recommended length: 100–150 words",
};


const sampleDiscussionPrompt: DiscussionPrompt = {
  title: "Academic Discussion Practice",
  professor:
    "We've been discussing whether universities should require students to take courses outside their major. Some people believe these courses help students become more well-rounded, while others think students should focus only on their chosen field.",
  studentOneName: "Kelly",
  studentOnePost:
    "I think students should take courses outside their major because they may discover new interests. For example, a science student might take an art history class and develop a better understanding of culture.",
  studentTwoName: "Andrew",
  studentTwoPost:
    "I disagree. College is already expensive and stressful, so students should spend most of their time on courses that directly help their future careers.",
  question:
    "Do you think universities should require students to take courses outside their major? Why or why not?",
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

function normalizeQuestions(apiQuestions: Question[]) {
  return apiQuestions.map((question, index) => {
    const validParts = Array.isArray(question.parts)
      ? question.parts.filter(isValidPart)
      : [];

    const fallback = fallbackQuestions[index % fallbackQuestions.length];
    const finalParts = validParts.length > 0 ? validParts : fallback.parts;

    return {
      id: index + 1,
      contextSpeaker: question.contextSpeaker || "A",
      contextSentence: question.contextSentence || fallback.contextSentence,
      answerSpeaker: question.answerSpeaker || "B",
      target: question.target || fallback.target,
      parts: finalParts,
      chunks: getBlankAnswers({ ...fallback, parts: finalParts }),
      explanation:
        question.explanation ||
        "This question tests sentence structure and logical connection between two speakers.",
    };
  });
}

async function generateQuestionsFromAPI(
  count: number,
  level: string,
  topic: string
) {
  const response = await fetch("/api/generate-sentences", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      count,
      level,
      topic,
    }),
  });

  if (!response.ok) {
    throw new Error("API request failed");
  }

  const data = await response.json();

  if (!Array.isArray(data.questions)) {
    throw new Error("Invalid API response");
  }

  return normalizeQuestions(data.questions as Question[]);
}

async function generateEmailPromptWithAPI(level: string, topic: string) {
  const response = await fetch("/api/generate-email-prompt", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      level,
      topic,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to generate email prompt");
  }

  return (await response.json()) as EmailPrompt;
}

async function generateAcademicDiscussionWithAPI(level: string, topic: string) {
  const response = await fetch("/api/generate-academic-discussion", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      level,
      topic,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to generate academic discussion prompt");
  }

  return (await response.json()) as DiscussionPrompt;
}

async function startMockTestWithAPI(level = "medium", topic = "general") {
  const {

    data: { session },

  } = await supabase.auth.getSession();

  if (!session?.access_token) {

    throw new Error("Please sign in before starting a mock test.");

  }

  const response = await fetch("/api/start-mock-test", {

    method: "POST",

    headers: {

      "Content-Type": "application/json",

      Authorization: `Bearer ${session.access_token}`,

    },

    body: JSON.stringify({

      level,

      topic,

    }),

  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Failed to start mock test");
  }

  return data as MockTestData;
}


async function scoreEmailWritingWithAPI(prompt: unknown, answer: string) {
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

async function scoreAcademicDiscussionWithAPI(prompt: unknown, answer: string) {
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
  return slots.every((slot) => slot !== null);
}

function isQuestionCorrect(question: Question, slots: (Chunk | null)[]) {
  const answers = getBlankAnswers(question);

  return slots.every((slot, index) => slot?.text === answers[index]);
}

function renderFullAnswer(question: Question) {
  return question.parts
    .map((part) => {
      if (part.type === "fixed") return part.text;
      return part.answer;
    })
    .join(" ")
    .replace(/\s+([?.!,])/g, "$1");
}

function countWords(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [points, setPoints] = useState(0);
  const [redeemCode, setRedeemCode] = useState("");
  const [redeemMessage, setRedeemMessage] = useState("");
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [records, setRecords] = useState<PracticeRecord[]>([]);
  const [isLoadingRecords, setIsLoadingRecords] = useState(false);
  const [recordMessage, setRecordMessage] = useState(""); 
  const [mockTestData, setMockTestData] = useState<MockTestData | null>(null);
  const [selectedPastExamId, setSelectedPastExamId] = useState("");
  const [selectedEtsMockId, setSelectedEtsMockId] = useState("");
  const [pastExamSets, setPastExamSets] = useState<QuestionSet[]>([]);
  const [etsMockSets, setEtsMockSets] = useState<QuestionSet[]>([]);
  const [questionAttempts, setQuestionAttempts] = useState<QuestionAttempt[]>([]);
  const [isLoadingQuestionSets, setIsLoadingQuestionSets] = useState(false);
  const [questionSetMessage, setQuestionSetMessage] = useState("");
  const [activeQuestionSetId, setActiveQuestionSetId] = useState("");
  const [activeQuestionSourceType, setActiveQuestionSourceType] = useState<
    "past_exam" | "ets_mock" | ""
  >("");



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

    if (hash === "records") {

      setPageState("records");

      return;

    }

    if (hash === "mock-records") {

      setPageState("mock-records");

      return;

    }

    setPageState("home");

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
  const [mockDragged, setMockDragged] = useState<Chunk | null>(null); 


  const [mockEmailAnswer, setMockEmailAnswer] = useState("");
  const [mockDiscussionAnswer, setMockDiscussionAnswer] = useState("");
  const [mockResult, setMockResult] = useState<MockResult | null>(null);
  const [isStartingMock, setIsStartingMock] = useState(false);
  const [isSubmittingMock, setIsSubmittingMock] = useState(false);
  const [mockMessage, setMockMessage] = useState("");
  const [mockRecords, setMockRecords] = useState<MockRecord[]>([]);
  const [isLoadingMockRecords, setIsLoadingMockRecords] = useState(false);
  const [mockRecordMessage, setMockRecordMessage] = useState("");
  const [selectedMockRecord, setSelectedMockRecord] =
  useState<MockRecord | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<PracticeRecord | null>(
  null
);
  const [showPointsModal, setShowPointsModal] = useState(false);


  const [page, setPageState] = useState<Page>(() => {

  const path = window.location.pathname;

  if (path === "/past-exam") return "past-exam";

  if (path.startsWith("/past-exam/")) return "past-exam-detail";

  if (path === "/ets-mock-practice") return "ets-mock-practice";

  if (path.startsWith("/ets-mock-practice/")) return "ets-mock-detail";

  if (path === "/records") return "records";

  if (path === "/mock-records") return "mock-records";

  return "home";

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

function setPage(nextPage: Page) {

  setPageState(nextPage);

  const pathMap: Partial<Record<Page, string>> = {

    home: "/",

    records: "/records",

    "mock-records": "/mock-records",

    "past-exam": "/past-exam",

    "ets-mock-practice": "/ets-mock-practice",

  };

  const nextPath = pathMap[nextPage];

  if (nextPath) {

    window.history.pushState({}, "", nextPath);

  }

}

 useEffect(() => {
  const path = window.location.pathname;

  if (path.startsWith("/past-exam/")) {
    const id = path.replace("/past-exam/", "").split('/')[0];
    setSelectedPastExamId(id);
  }

  if (path.startsWith("/ets-mock-practice/")) {
    const id = path.replace("/ets-mock-practice/", "").split('/')[0];
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
      setPoints(0);
    }
  }

  loadUser();

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    const currentUser = session?.user ?? null;
    setUser(currentUser);

    if (currentUser) {
      loadPoints(currentUser.id);
    } else {
      setPoints(0);
    }
  });

  return () => {
    subscription.unsubscribe();
  };
}, []);

  useEffect(() => {

  if (

    page === "past-exam" ||

    page === "past-exam-detail" ||

    page === "ets-mock-practice" ||

    page === "ets-mock-detail"

  ) {

    loadQuestionSets();

    loadQuestionAttempts();

  }

}, [page, user]);



async function loadPoints(userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("points")
    .eq("id", userId)
    .single();

  if (error) {
    console.error("Failed to load points:", error.message);
    setPoints(0);
    return;
  }

  setPoints(data?.points ?? 0);
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

async function handleSignOut() {
  await supabase.auth.signOut();
  setUser(null);
  setPoints(0);
  setAuthMessage("Signed out.");
}

async function handleRedeemCode() {

  if (!user) {
    setRedeemMessage("Please sign in first.");
    return;
  }

  if (!redeemCode.trim()) {
    setRedeemMessage("Please enter a redeem code.");
    return;
  }

  setIsRedeeming(true);
  setRedeemMessage("");

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setRedeemMessage("Your login session has expired. Please sign in again.");
      setIsRedeeming(false);
      return;
    }

    const response = await fetch("/api/redeem-code", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        code: redeemCode,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      setRedeemMessage(data.error || "Failed to redeem code.");
      setIsRedeeming(false);
      return;
    }

    setPoints(data.balance ?? points);
    setRedeemCode("");
    setRedeemMessage(data.message || "Redeemed successfully.");
  } catch (error) {
    console.error("Redeem failed:", error);
    setRedeemMessage("Failed to redeem code. Please try again.");
  } finally {
    setIsRedeeming(false);
  }
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

  const { data, error } = await supabase

    .from("question_sets")

    .select(

      "id, source_type, title, display_date, mock_number, sort_order, content, created_at"

    )

    .eq("status", "published")

    .order("source_type", { ascending: true })

    .order("sort_order", { ascending: true })

    .order("display_date", { ascending: false });

  if (error) {

    setQuestionSetMessage(error.message);

    setIsLoadingQuestionSets(false);

    return;

  }

  const sets = (data || []) as QuestionSet[];

  setPastExamSets(sets.filter((item) => item.source_type === "past_exam"));

  setEtsMockSets(sets.filter((item) => item.source_type === "ets_mock"));

  setIsLoadingQuestionSets(false);

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

function getPracticedIds(sourceType: "past_exam" | "ets_mock") {

  return questionAttempts

    .filter((attempt) => attempt.source_type === sourceType)

    .map((attempt) => attempt.question_set_id);

}

function getPastExamSetById(id: string) {
  return pastExamSets.find((item) => item.id === id) || null;
}

function getEtsMockSetById(id: string) {
  return etsMockSets.find((item) => item.id === id) || null;
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

function handleStartEtsMockPractice(questionSet: QuestionSet | null) {
  if (!questionSet) {
    setQuestionSetMessage("This mock test is not available yet.");
    return;
  }

  try {
    const data = buildMockTestDataFromQuestionSet(questionSet);

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

async function handleStartMockTest() {
  if (!user) {
    setMockMessage("Please sign in before starting a mock test.");
    return;
  }

  setIsStartingMock(true);
  setMockMessage("");
  setMockResult(null);
  setMockTestData(null);
  setMockSentenceSlots({});
  setMockSentenceBanks({});
  setMockDragged(null);
  setMockEmailAnswer("");
  setMockDiscussionAnswer("");

  try {
    const data = await startMockTestWithAPI("medium", "general campus and daily life");

    setMockTestData(data);
    setMockSentenceSlots(createInitialSlots(data.sentenceQuestions));
    setMockSentenceBanks(createBankOrders(data.sentenceQuestions));

    if (typeof data.balance === "number") {   
      setPoints(data.balance);
    } else if (user) {
      await loadPoints(user.id);
    }

    setPage("mock");


  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to start mock test.";

    setMockMessage(message);
  } finally {
    setIsStartingMock(false);
  }
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

  if (!mockEmailAnswer.trim() || !mockDiscussionAnswer.trim()) {
    setMockMessage("Please complete both writing tasks before submitting.");
    return;
  }

  setIsSubmittingMock(true);
  setMockMessage("");

  try {
    const sentenceAnswers = Object.fromEntries(
      mockTestData.sentenceQuestions.map((question) => [
        String(question.id),
        (mockSentenceSlots[question.id] || [])
          .filter((slot): slot is Chunk => slot !== null)
          .map((slot) => slot.text),
      ])
    );
    const result = await submitMockTestWithAPI({
      sentenceQuestions: mockTestData.sentenceQuestions,
      sentenceAnswers,
      emailPrompt: mockTestData.emailPrompt,
      emailAnswer: mockEmailAnswer,
      discussionPrompt: mockTestData.discussionPrompt,
      discussionAnswer: mockDiscussionAnswer,
    });

    setMockResult(result);
    await saveQuestionAttempt(result);

    if (typeof result.balance === "number") {
      setPoints(result.balance);
    } else if (user) {
      await loadPoints(user.id);
    }

    setPage("mock-result");
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
}: {
  sentenceQuestions: MockSentenceQuestion[];
  sentenceAnswers: Record<string, string[]>;
  emailPrompt: EmailPrompt;
  emailAnswer: string;
  discussionPrompt: DiscussionPrompt;
  discussionAnswer: string;
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
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Failed to submit mock test");
  }

  return data as MockResult;
}

  const [questions, setQuestions] = useState<Question[]>(fallbackQuestions);
  const [questionCount, setQuestionCount] = useState(5);
  const [level, setLevel] = useState("Medium");
  const [topic, setTopic] = useState("Mixed");

  const [currentIndex, setCurrentIndex] = useState(0);
  const [slotsByQuestion, setSlotsByQuestion] = useState(() =>
    createInitialSlots(fallbackQuestions)
  );
  const [bankOrders, setBankOrders] = useState(() =>
    createBankOrders(fallbackQuestions)
  );

  const [isLoading, setIsLoading] = useState(false);
  const [apiMessage, setApiMessage] = useState("");
  const [dragged, setDragged] = useState<Chunk | null>(null);

  const [isSubmitted, setIsSubmitted] = useState(false);
  const [results, setResults] = useState<Record<number, number>>({});

  const [currentEmailPrompt, setCurrentEmailPrompt] =
    useState<EmailPrompt>(sampleEmailPrompt);
  const [isGeneratingEmailPrompt, setIsGeneratingEmailPrompt] = useState(false);
  const [emailAnswer, setEmailAnswer] = useState("");
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
      .map((slot) => slot.id);

    return (bankOrders[currentQuestion.id] || []).filter(
      (chunk) => !usedIds.includes(chunk.id)
    );
  }, [bankOrders, currentQuestion.id, currentSlots]);

  const totalScore = Object.values(results).reduce(
    (sum, score) => sum + score,
    0
  );

  const completedCount = questions.filter((question) =>
    isQuestionComplete(slotsByQuestion[question.id] || [])
  ).length;

  const currentQuestionScore = results[currentQuestion.id];
  const currentQuestionCorrect = isSubmitted && currentQuestionScore === 0.5;

  const emailWordCount = countWords(emailAnswer);
  const discussionWordCount = countWords(discussionAnswer);

  function updateCurrentSlots(newSlots: (Chunk | null)[]) {
    setSlotsByQuestion({
      ...slotsByQuestion,
      [currentQuestion.id]: newSlots,
    });
  }

  function placeChunk(chunk: Chunk, slotIndex: number) {
    if (isSubmitted) return;

    const newSlots = [...currentSlots];
    newSlots[slotIndex] = chunk;

    updateCurrentSlots(newSlots);
  }

  function removeChunk(slotIndex: number) {
    if (isSubmitted) return;

    const newSlots = [...currentSlots];
    newSlots[slotIndex] = null;

    updateCurrentSlots(newSlots);
  }

  function resetCurrentQuestion() {
    if (isSubmitted) return;

    updateCurrentSlots(makeEmptySlots(currentQuestion));
  }

  function previousQuestion() {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setDragged(null);
    }
  }

  function nextQuestion() {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setDragged(null);
    }
  }

  function submitAll() {
    const unfinishedQuestions = questions.filter(
      (question) => !isQuestionComplete(slotsByQuestion[question.id] || [])
    );

    if (unfinishedQuestions.length > 0) {
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

      finalResults[question.id] = correct ? 0.5 : 0;
    });

    setResults(finalResults);
    setIsSubmitted(true);
  }

  function restartAll() {
    setSlotsByQuestion(createInitialSlots(questions));
    setBankOrders(createBankOrders(questions));
    setCurrentIndex(0);
    setDragged(null);
    setResults({});
    setIsSubmitted(false);
  }

  async function startNewPractice() {
    setIsLoading(true);
    setApiMessage("");

    try {
      const generated = await generateQuestionsFromAPI(
        questionCount,
        level,
        topic
      );

      setQuestions(generated);
      setSlotsByQuestion(createInitialSlots(generated));
      setBankOrders(createBankOrders(generated));
      setCurrentIndex(0);
      setDragged(null);
      setResults({});
      setIsSubmitted(false);
      setApiMessage("已成功由 Gemini 生成新题组。");
      setPage("sentence");
    } catch (error) {
      const fallback = fallbackQuestions.slice(0, questionCount);

      setQuestions(fallback);
      setSlotsByQuestion(createInitialSlots(fallback));
      setBankOrders(createBankOrders(fallback));
      setCurrentIndex(0);
      setDragged(null);
      setResults({});
      setIsSubmitted(false);
      setApiMessage(
        "API 暂时不可用，已使用本地示例题。部署到 Vercel 并配置 Gemini API Key 后即可自动生成。"
      );
      setPage("sentence");
    } finally {
      setIsLoading(false);
    }
  }

  async function generateNewEmailPrompt() {
    setEmailAnswer("");
    setEmailSubmitted(false);
    setEmailFeedback(null);
    setIsGeneratingEmailPrompt(true);

    try {
      const prompt = await generateEmailPromptWithAPI(level, topic);
      setCurrentEmailPrompt(prompt);
    } catch (error) {
      setCurrentEmailPrompt(sampleEmailPrompt);
    } finally {
      setIsGeneratingEmailPrompt(false);
    }
  }

  async function generateNewDiscussionPrompt() {
    setDiscussionAnswer("");
    setDiscussionSubmitted(false);
    setDiscussionFeedback(null);
    setIsGeneratingDiscussionPrompt(true);

    try {
      const prompt = await generateAcademicDiscussionWithAPI(level, topic);
      setCurrentDiscussionPrompt(prompt);
    } catch (error) {
      setCurrentDiscussionPrompt(sampleDiscussionPrompt);
    } finally {
      setIsGeneratingDiscussionPrompt(false);
    }
  }

  async function startEmailPractice() {
    setPage("email");
    await generateNewEmailPrompt();
  }

  async function startDiscussionPractice() {
    setPage("discussion");
    await generateNewDiscussionPrompt();
  }

  async function submitEmailWriting() {
    if (emailWordCount === 0) return;

    setIsScoringEmail(true);
    setEmailSubmitted(false);
    setEmailFeedback(null);

    try {
      const feedback = await scoreEmailWritingWithAPI(
        currentEmailPrompt,
        emailAnswer
      );

      setEmailFeedback(feedback);
      setEmailSubmitted(true);

      if (typeof feedback.balance === "number") {
        setPoints(feedback.balance);
      } else if (user) {
        await loadPoints(user.id);
      } 
    } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "AI scoring failed. Please try again.";

        setEmailFeedback({
          score: "评分失败",
          strengths: [],
          problems: [message],
          grammarCorrections: [],
          actionPlan: [],
          improvedVersion: "",
          sampleAnswer: "",
        });
        setEmailSubmitted(true);
    } finally {
        setIsScoringEmail(false);
    }
  } 

  async function submitDiscussionWriting() {
    if (discussionWordCount === 0) return;

    setIsScoringDiscussion(true);
    setDiscussionSubmitted(false);
    setDiscussionFeedback(null);

    try {
      const feedback = await scoreAcademicDiscussionWithAPI(
        currentDiscussionPrompt,
        discussionAnswer
      );

      setDiscussionFeedback(feedback);
      setDiscussionSubmitted(true);

      if (typeof feedback.balance === "number") {
        setPoints(feedback.balance);
      } else if (user) {
        await loadPoints(user.id);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "AI scoring failed. Please try again.";

      setDiscussionFeedback({
        score: "评分失败",
        strengths: [],
        problems: [message],
        grammarCorrections: [],
        actionPlan: [],
        improvedVersion: "",
        sampleAnswer: "",
      });
      setDiscussionSubmitted(true);
    } finally {
      setIsScoringDiscussion(false);
    }
  }

  const cardStyle = {
    padding: "26px",
    border: "1px solid #e2e8f0",
    borderRadius: "22px",
    background: "#f8fafc",
  };

  const primaryButtonStyle = {
    padding: "12px 24px",
    border: "none",
    borderRadius: "12px",
    background: "#111827",
    color: "white",
    fontWeight: 700,
    cursor: "pointer",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f8fafc",
        padding: "60px",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: "980px",
          margin: "0 auto",
          background: "white",
          padding: "40px",
          borderRadius: "24px",
          boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
        }}
      >
        <h1 style={{ fontSize: "36px", marginBottom: "10px" }}>
          TOEFL Practice Lab
        </h1>

        {page === "home" && (
          <>
            <p style={{ color: "#64748b", marginBottom: "30px" }}>
              选择练习板块。现在可以练 Build a Sentence、Email Writing 和
              Academic Discussion。
            </p>


            <AuthPanel
              user={user}
              points={points}
              authEmail={authEmail}
              authPassword={authPassword}
              authMessage={authMessage}
              isAuthLoading={isAuthLoading}
              redeemCode={redeemCode}
              redeemMessage={redeemMessage}
              isRedeeming={isRedeeming}
              setAuthEmail={setAuthEmail}
              setAuthPassword={setAuthPassword}
              setRedeemCode={setRedeemCode}
              onSignUp={handleSignUp}
              onSignIn={handleSignIn}
              onSignOut={handleSignOut}
              onRedeemCode={handleRedeemCode}
              onShowPointsModal={() => setShowPointsModal(true)}
              onViewRecords={async () => {
                setPage("records");
                await loadPracticeRecords();
              }}
              onViewMockRecords={async () => {
                await loadMockRecords();
                setPage("mock-records");
              }}
            />
            <AnnouncementBoard />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: "20px",
              }}
            >
              <div style={cardStyle}>
                <h2 style={{ marginTop: 0 }}>Build a Sentence</h2>
                <p style={{ color: "#64748b", lineHeight: 1.7 }}>
                  A/B 对话补全。根据语境把词块拖到横线上，训练句序、搭配和语法结构。
                </p>

                <PracticeControls
                  questionCount={questionCount}
                  setQuestionCount={setQuestionCount}
                  level={level}
                  setLevel={setLevel}
                  topic={topic}
                  setTopic={setTopic}
                  disabled={isLoading}
                />

                <button
                  onClick={startNewPractice}
                  disabled={isLoading}
                  style={{
                    ...primaryButtonStyle,
                    background: isLoading ? "#cbd5e1" : "#111827",
                    cursor: isLoading ? "not-allowed" : "pointer",
                  }}
                >
                  {isLoading ? "正在生成..." : "开始练习"}
                </button>
              </div>

              <div style={cardStyle}>
                <h2 style={{ marginTop: 0 }}>Email Writing</h2>
                <p style={{ color: "#64748b", lineHeight: 1.7 }}>
                  练习 TOEFL 邮件写作。进入后自动随机生成邮件写作题，并提供 AI
                  评分。
                </p>
                <p style={{ color: "#475569", fontWeight: 700 }}>
                  AI 批改消耗：{EMAIL_SCORING_COST} points
                </p>
                <button
                  onClick={startEmailPractice}
                  disabled={isGeneratingEmailPrompt}
                  style={{
                    ...primaryButtonStyle,
                    background: isGeneratingEmailPrompt ? "#cbd5e1" : "#111827",
                    cursor: isGeneratingEmailPrompt ? "not-allowed" : "pointer",
                  }}
                >
                  {isGeneratingEmailPrompt ? "正在生成..." : "进入邮件写作"}
                </button>
              </div>

              <div style={cardStyle}>
                <h2 style={{ marginTop: 0 }}>Academic Discussion</h2>
                <p style={{ color: "#64748b", lineHeight: 1.7 }}>
                  练习 TOEFL 学术讨论写作。进入后自动随机生成讨论题，并提供 AI
                  评分。
                </p>
                <p style={{ color: "#475569", fontWeight: 700 }}>
                  AI 批改消耗：{DISCUSSION_SCORING_COST} points
                </p>

                <button
                  onClick={startDiscussionPractice}
                  disabled={isGeneratingDiscussionPrompt}
                  style={{
                    ...primaryButtonStyle,
                    background: isGeneratingDiscussionPrompt
                      ? "#cbd5e1"
                      : "#111827",
                    cursor: isGeneratingDiscussionPrompt
                      ? "not-allowed"
                      : "pointer",
                  }}
                >
                  {isGeneratingDiscussionPrompt ? "正在生成..." : "进入学术讨论"}
                </button>
              </div>
              <div style={cardStyle}>
                <h2 style={{ marginTop: 0 }}>Full Mock Test</h2>
                <p style={{ color: "#64748b", lineHeight: 1.7 }}>
                  完整完成 Build a Sentence、Email Writing 和 Academic Discussion，最后获得新 TOEFL 6 分制总分、知识点分析和备考建议。
                </p>
                <p style={{ color: "#475569", fontWeight: 700 }}>
                  完整模考消耗：10 points
                </p>
                <button
                  onClick={handleStartMockTest}
                  disabled={isStartingMock}
                  style={{
                    ...primaryButtonStyle,
                    background: isStartingMock ? "#cbd5e1" : "#111827",
                    cursor: isStartingMock ? "not-allowed" : "pointer",
                  }}
                >
                  {isStartingMock ? "正在生成模考..." : "开始完整模考"}
                  </button>
                  {mockMessage && (
                    <p style={{ color: "#be123c", fontWeight: 700, marginBottom: 0 }}>
                      {mockMessage}
                    </p>
                  )}
                </div>
                <div style={cardStyle}>
                  <h2 style={{ marginTop: 0 }}>TOEFL Past Exam</h2>

                  <p style={{ color: "#64748b", lineHeight: 1.7 }}>
                    练习 TOEFL 改革真题，适合用于熟悉真实考试题型。
                  </p>

                  <button
                    onClick={() => window.open("/past-exam", "_blank")}
                    style={primaryButtonStyle}
                  >
                    进入真题练习
                  </button>
                </div>

                <div style={cardStyle}>
                  <h2 style={{ marginTop: 0 }}>ETS Mock Practice</h2>

                  <p style={{ color: "#64748b", lineHeight: 1.7 }}>
                    使用 ETS 官方20套模拟题进行写作练习。
                  </p>

                  <button
                    onClick={() => window.open("/ets-mock-practice", "_blank")}
                    style={primaryButtonStyle}
                  >
                    进入模拟真题
                  </button>
                </div>
            </div>

          </>
        )}

        {page === "sentence" && (
          <SentencePractice
            questions={questions}
            currentIndex={currentIndex}
            setCurrentIndex={setCurrentIndex}
            slotsByQuestion={slotsByQuestion}
            currentSlots={currentSlots}
            currentAnswers={currentAnswers}
            currentQuestion={currentQuestion}
            currentBank={currentBank}
            completedCount={completedCount}
            totalScore={totalScore}
            isSubmitted={isSubmitted}
            results={results}
            dragged={dragged}
            setDragged={setDragged}
            apiMessage={apiMessage}
            currentQuestionCorrect={currentQuestionCorrect}
            currentQuestionScore={currentQuestionScore}
            setPage={setPage}
            previousQuestion={previousQuestion}
            nextQuestion={nextQuestion}
            resetCurrentQuestion={resetCurrentQuestion}
            submitAll={submitAll}
            restartAll={restartAll}
            removeChunk={removeChunk}
            placeChunk={placeChunk}
          />
        )}

        {page === "email" && (
          <WritingPracticePage
            title={currentEmailPrompt.title}
            submitCost={EMAIL_SCORING_COST}
            isGenerating={isGeneratingEmailPrompt}
            onGenerateNew={generateNewEmailPrompt}
            promptBlock={
              <>
                <p
                  style={{
                    color: "#64748b",
                    lineHeight: 1.8,
                    marginBottom: "24px",
                  }}
                >
                  {currentEmailPrompt.scenario}
                </p>

                <div
                  style={{
                    padding: "22px",
                    borderRadius: "18px",
                    background: "#f1f5f9",
                    marginBottom: "24px",
                  }}
                >
                  <strong>{currentEmailPrompt.task}</strong>

                  <ul style={{ lineHeight: 1.8 }}>
                    {currentEmailPrompt.requirements.map((requirement) => (
                      <li key={requirement}>{requirement}</li>
                    ))}
                  </ul>

                  <p style={{ color: "#64748b", marginBottom: 0 }}>
                    {currentEmailPrompt.suggestedLength}
                  </p>
                </div>
              </>
            }
            answer={emailAnswer}
            setAnswer={(value) => {
              setEmailAnswer(value);
              setEmailSubmitted(false);
            }}
            wordCount={emailWordCount}
            placeholder="Write your email here..."
            isScoring={isScoringEmail}
            onSubmit={submitEmailWriting}
            submitted={emailSubmitted}
            feedback={emailFeedback}
            setPage={setPage}
          />
        )}

        {page === "discussion" && (
          <WritingPracticePage
            title={currentDiscussionPrompt.title}
            submitCost={DISCUSSION_SCORING_COST}
            isGenerating={isGeneratingDiscussionPrompt}
            onGenerateNew={generateNewDiscussionPrompt}
            promptBlock={
              <>
                <div
                  style={{
                    padding: "22px",
                    borderRadius: "18px",
                    background: "#f1f5f9",
                    marginBottom: "18px",
                    lineHeight: 1.8,
                  }}
                >
                  <strong>Professor</strong>
                  <p style={{ marginBottom: 0 }}>
                    {currentDiscussionPrompt.professor}
                  </p>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                    gap: "18px",
                    marginBottom: "18px",
                  }}
                >
                  <div
                    style={{
                      padding: "20px",
                      borderRadius: "18px",
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      lineHeight: 1.8,
                    }}
                  >
                    <strong>{currentDiscussionPrompt.studentOneName}</strong>
                    <p style={{ marginBottom: 0 }}>
                      {currentDiscussionPrompt.studentOnePost}
                    </p>
                  </div>

                  <div
                    style={{
                      padding: "20px",
                      borderRadius: "18px",
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      lineHeight: 1.8,
                    }}
                  >
                    <strong>{currentDiscussionPrompt.studentTwoName}</strong>
                    <p style={{ marginBottom: 0 }}>
                      {currentDiscussionPrompt.studentTwoPost}
                    </p>
                  </div>
                </div>

                <div
                  style={{
                    padding: "22px",
                    borderRadius: "18px",
                    background: "#eef2ff",
                    color: "#312e81",
                    marginBottom: "24px",
                    lineHeight: 1.8,
                  }}
                >
                  <strong>Question</strong>
                  <p>{currentDiscussionPrompt.question}</p>
                  <p style={{ marginBottom: 0 }}>
                    {currentDiscussionPrompt.suggestedLength}
                  </p>
                </div>
              </>
            }
            answer={discussionAnswer}
            setAnswer={(value) => {
              setDiscussionAnswer(value);
              setDiscussionSubmitted(false);
            }}
            wordCount={discussionWordCount}
            placeholder="Write your academic discussion response here..."
            isScoring={isScoringDiscussion}
            onSubmit={submitDiscussionWriting}
            submitted={discussionSubmitted}
            feedback={discussionFeedback}
            setPage={setPage}
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
            onCancel={() => setPage("home")}
          />
        )}
        {page === "mock-result" && mockResult && (
          <MockResultPage
            result={mockResult}
            onBackHome={() => setPage("home")}
            onViewRecords={async () => {
              await loadMockRecords();
              setPage("mock-records");
            }}
          />
        )}

        {page === "mock-records" && (
          <MockRecordsPage
            records={mockRecords}
            isLoading={isLoadingMockRecords}
            message={mockRecordMessage}
            onBackHome={() => setPage("home")}
            onOpenRecord={(record) => {
              setSelectedMockRecord(record);
              setPage("mock-record-detail");
            }}
          />
        )}

        {page === "mock-record-detail" && selectedMockRecord && (
          <MockRecordDetailPage
            record={selectedMockRecord}
            onClose={() => {
              setSelectedMockRecord(null);
              setPage("mock-records");
            }}
          />
        )}

        {page === "past-exam" && (



          <PastExamPage

            items={pastExamSets}

            practicedIds={getPracticedIds("past_exam")}

            isLoading={isLoadingQuestionSets}

            message={questionSetMessage}

            onBackHome={() => setPage("home")}

            onStart={(id) => {

              setSelectedPastExamId(id);

              setPageState("past-exam-detail");

              window.history.pushState({}, "", `/past-exam/${id}`);

            }}

          />



        )}
        
        {page === "past-exam-detail" && (
          <PastExamDetailPage
            examId={selectedPastExamId}
            examSet={getPastExamSetById(selectedPastExamId)}
            onBack={() => {
              setPageState("past-exam");
              window.history.pushState({}, "", "/past-exam");
            }}
          />
        )}

        {page === "ets-mock-practice" && (

          <EtsMockPracticePage
            items={etsMockSets}
            practicedIds={getPracticedIds("ets_mock")}
            isLoading={isLoadingQuestionSets}
            message={questionSetMessage}
            onBackHome={() => setPage("home")}
            onStart={(id) => {
              setSelectedEtsMockId(id);
              setPageState("ets-mock-detail");
              window.history.pushState({}, "", `/ets-mock-practice/${id}`);
            }}
          />



        )}
        
        {page === "ets-mock-detail" && (
          <EtsMockDetailPage
            mockId={selectedEtsMockId}
            mockSet={getEtsMockSetById(selectedEtsMockId)}
            message={questionSetMessage}
            onStart={() => {
              handleStartEtsMockPractice(getEtsMockSetById(selectedEtsMockId));
            }}
            onBack={() => {
              setPageState("ets-mock-practice");
              window.history.pushState({}, "", "/ets-mock-practice");
            }}
          />
        )}















        {page === "records" && (
          <PracticeRecordsPage
            records={records}
            isLoading={isLoadingRecords}
            message={recordMessage}
            setPage={setPage}
            onOpenRecord={(record) => {
              setSelectedRecord(record);
              setPage("record-detail");
            }}
          />
        )}
        {page === "record-detail" && selectedRecord && (
          <PracticeRecordDetailPage
            record={selectedRecord}
            onClose={() => {
              setSelectedRecord(null);
              setPage("records");
            }}
          />
        )}

      </div>
       {showPointsModal && (

        <PointsModal onClose={() => setShowPointsModal(false)} />

      )}
    </div>
  );
}

function PracticeControls({
  questionCount,
  setQuestionCount,
  level,
  setLevel,
  topic,
  setTopic,
  disabled,
  hideCount,
}: {
  questionCount: number;
  setQuestionCount: (count: number) => void;
  level: string;
  setLevel: (level: string) => void;
  topic: string;
  setTopic: (topic: string) => void;
  disabled: boolean;
  hideCount?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "10px",
        marginBottom: "18px",
      }}
    >
      {!hideCount && (
        <select
          value={questionCount}
          onChange={(e) => setQuestionCount(Number(e.target.value))}
          disabled={disabled}
          style={{
            padding: "10px 14px",
            border: "1px solid #cbd5e1",
            borderRadius: "12px",
            background: "white",
            fontWeight: 700,
          }}
        >
          <option value={5}>5题</option>
          <option value={10}>10题</option>
        </select>
      )}

      <select
        value={level}
        onChange={(e) => setLevel(e.target.value)}
        disabled={disabled}
        style={{
          padding: "10px 14px",
          border: "1px solid #cbd5e1",
          borderRadius: "12px",
          background: "white",
          fontWeight: 700,
        }}
      >
        <option value="Mixed">Mixed</option>
        <option value="Easy">Easy</option>
        <option value="Medium">Medium</option>
        <option value="Hard">Hard</option>
      </select>

      <select
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        disabled={disabled}
        style={{
          padding: "10px 14px",
          border: "1px solid #cbd5e1",
          borderRadius: "12px",
          background: "white",
          fontWeight: 700,
        }}
      >
        <option value="Mixed">Mixed</option>
        <option value="Travel">Travel</option>
        <option value="Campus Life">Campus Life</option>
        <option value="Academic Discussion">Academic Discussion</option>
        <option value="Technology">Technology</option>
        <option value="Environment">Environment</option>
        <option value="Health">Health</option>
      </select>
    </div>
  );
}

function SentencePractice({
  questions,
  currentIndex,
  setCurrentIndex,
  slotsByQuestion,
  currentSlots,
  currentAnswers,
  currentQuestion,
  currentBank,
  completedCount,
  totalScore,
  isSubmitted,
  results,
  dragged,
  setDragged,
  apiMessage,
  currentQuestionCorrect,
  currentQuestionScore,
  setPage,
  previousQuestion,
  nextQuestion,
  resetCurrentQuestion,
  submitAll,
  restartAll,
  removeChunk,
  placeChunk,
}: {
  questions: Question[];
  currentIndex: number;
  setCurrentIndex: (index: number) => void;
  slotsByQuestion: Record<number, (Chunk | null)[]>;
  currentSlots: (Chunk | null)[];
  currentAnswers: string[];
  currentQuestion: Question;
  currentBank: Chunk[];
  completedCount: number;
  totalScore: number;
  isSubmitted: boolean;
  results: Record<number, number>;
  dragged: Chunk | null;
  setDragged: (chunk: Chunk | null) => void;
  apiMessage: string;
  currentQuestionCorrect: boolean;
  currentQuestionScore: number | undefined;
  setPage: (page: Page) => void;
  previousQuestion: () => void;
  nextQuestion: () => void;
  resetCurrentQuestion: () => void;
  submitAll: () => void;
  restartAll: () => void;
  removeChunk: (slotIndex: number) => void;
  placeChunk: (chunk: Chunk, slotIndex: number) => void;
}) {
  return (
    <>
      <button
        onClick={() => setPage("home")}
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

      <p style={{ color: "#64748b", marginBottom: "24px" }}>
        A/B 对话补全。把词块拖到 B 句横线上。全部题目完成后统一批改。每题
        0.5 分，错一空即为 0。
      </p>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "16px",
          marginBottom: "30px",
          padding: "16px 20px",
          background: "#f1f5f9",
          borderRadius: "16px",
          fontWeight: 700,
        }}
      >
        <span>
          Question {currentIndex + 1} / {questions.length}
        </span>

        <span>
          已完成：{completedCount} / {questions.length}
        </span>

        <span>
          {isSubmitted
            ? `总分：${totalScore} / ${questions.length * 0.5}`
            : "尚未提交"}
        </span>
      </div>

      <div style={{ display: "flex", gap: "8px", marginBottom: "28px" }}>
        {questions.map((question, index) => {
          const slots = slotsByQuestion[question.id] || [];
          const complete = isQuestionComplete(slots);
          const score = results[question.id];

          let background = "white";
          let color = "#334155";
          let borderColor = "#cbd5e1";

          if (index === currentIndex) {
            background = "#111827";
            color = "white";
            borderColor = "#111827";
          } else if (isSubmitted && score === 0) {
            background = "#fff1f2";
            color = "#be123c";
            borderColor = "#f43f5e";
          } else if (complete) {
            background = "#eef2ff";
            color = "#312e81";
            borderColor = "#c7d2fe";
          }

          return (
            <button
              key={question.id}
              onClick={() => setCurrentIndex(index)}
              style={{
                width: "42px",
                height: "42px",
                borderRadius: "12px",
                border: `1px solid ${borderColor}`,
                background,
                color,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              {index + 1}
            </button>
          );
        })}
      </div>

      <div
        style={{
          fontSize: "26px",
          lineHeight: "2.2",
          fontWeight: 700,
          marginBottom: "36px",
        }}
      >
        <div>
          {currentQuestion.contextSpeaker}: {currentQuestion.contextSentence}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
          <span>{currentQuestion.answerSpeaker}:</span>

          {(() => {
            let blankIndex = 0;

            return currentQuestion.parts.map((part, partIndex) => {
              if (part.type === "fixed") {
                return <span key={`fixed-${partIndex}`}>{part.text}</span>;
              }

              const slotIndex = blankIndex;
              blankIndex += 1;

              const slot = currentSlots[slotIndex];
              const slotIsWrong =
                isSubmitted && slot?.text !== currentAnswers[slotIndex];

              return (
                <button
                  key={`blank-${partIndex}`}
                  onClick={() => removeChunk(slotIndex)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragged) {
                      placeChunk(dragged, slotIndex);
                      setDragged(null);
                    }
                  }}
                  style={{
                    minWidth: "120px",
                    minHeight: "42px",
                    border: "2px solid",
                    borderColor: slotIsWrong ? "#f43f5e" : "#cbd5e1",
                    borderRadius: "12px",
                    background: slotIsWrong
                      ? "#fff1f2"
                      : slot
                      ? "#eef2ff"
                      : "white",
                    color: slotIsWrong ? "#be123c" : "#111827",
                    fontSize: "18px",
                    fontWeight: 700,
                    cursor: isSubmitted ? "default" : "pointer",
                  }}
                >
                  {slot?.text || ""}
                </button>
              );
            });
          })()}
        </div>
      </div>

      <div
        style={{
          background: "#f1f5f9",
          padding: "20px",
          borderRadius: "18px",
          marginBottom: "24px",
        }}
      >
        <div
          style={{
            fontSize: "14px",
            color: "#64748b",
            marginBottom: "12px",
          }}
        >
          可选词 / Word Bank
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
          {currentBank.map((chunk) => (
            <button
              key={chunk.id}
              draggable={!isSubmitted}
              onDragStart={() => setDragged(chunk)}
              onClick={() => {
                const emptyIndex = currentSlots.findIndex(
                  (slot) => slot === null
                );

                if (emptyIndex !== -1) {
                  placeChunk(chunk, emptyIndex);
                }
              }}
              style={{
                padding: "10px 16px",
                border: "1px solid #cbd5e1",
                borderRadius: "999px",
                background: "white",
                fontSize: "16px",
                fontWeight: 600,
                cursor: isSubmitted ? "default" : "grab",
              }}
            >
              {chunk.text}
            </button>
          ))}

          {currentBank.length === 0 && (
            <span style={{ color: "#64748b" }}>本题词库已清空。</span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
        <button
          onClick={previousQuestion}
          disabled={currentIndex === 0}
          style={{
            padding: "12px 20px",
            border: "1px solid #cbd5e1",
            borderRadius: "12px",
            background: "white",
            fontWeight: 700,
            cursor: currentIndex === 0 ? "not-allowed" : "pointer",
          }}
        >
          上一题
        </button>

        <button
          onClick={nextQuestion}
          disabled={currentIndex === questions.length - 1}
          style={{
            padding: "12px 20px",
            border: "1px solid #cbd5e1",
            borderRadius: "12px",
            background: "white",
            fontWeight: 700,
            cursor:
              currentIndex === questions.length - 1 ? "not-allowed" : "pointer",
          }}
        >
          下一题
        </button>

        <button
          onClick={resetCurrentQuestion}
          disabled={isSubmitted}
          style={{
            padding: "12px 20px",
            border: "1px solid #cbd5e1",
            borderRadius: "12px",
            background: "white",
            fontWeight: 700,
            cursor: isSubmitted ? "not-allowed" : "pointer",
          }}
        >
          清空本题
        </button>

        <button
          onClick={submitAll}
          disabled={isSubmitted}
          style={{
            padding: "12px 20px",
            border: "none",
            borderRadius: "12px",
            background: isSubmitted ? "#cbd5e1" : "#111827",
            color: "white",
            fontWeight: 700,
            cursor: isSubmitted ? "not-allowed" : "pointer",
          }}
        >
          提交全部并批改
        </button>

        <button
          onClick={restartAll}
          style={{
            padding: "12px 20px",
            border: "1px solid #cbd5e1",
            borderRadius: "12px",
            background: "white",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          重新开始
        </button>
      </div>

      {apiMessage && (
        <div
          style={{
            marginTop: "20px",
            padding: "16px 20px",
            borderRadius: "16px",
            background: "#eef2ff",
            color: "#312e81",
            fontWeight: 700,
          }}
        >
          {apiMessage}
        </div>
      )}

      {isSubmitted && (
        <div
          style={{
            marginTop: "24px",
            padding: "20px",
            borderRadius: "18px",
            background: currentQuestionCorrect ? "#f8fafc" : "#fff1f2",
            color: currentQuestionCorrect ? "#334155" : "#be123c",
            fontWeight: 700,
          }}
        >
          当前题得分：{currentQuestionScore} / 0.5
        </div>
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
  submitCost,
  isGenerating,
  onGenerateNew,
  promptBlock,
  answer,
  setAnswer,
  wordCount,
  placeholder,
  isScoring,
  onSubmit,
  submitted,
  feedback,
  setPage,
}: {
  title: string;
  submitCost: number;
  isGenerating: boolean;
  onGenerateNew: () => void;
  promptBlock: ReactNode;
  answer: string;
  setAnswer: (value: string) => void;
  wordCount: number;
  placeholder: string;
  isScoring: boolean;
  onSubmit: () => void;
  submitted: boolean;
  feedback: WritingFeedback | null;
  setPage: (page: Page) => void;
}) {
  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "12px",
          flexWrap: "wrap",
          marginBottom: "24px",
        }}
      >
        <button
          onClick={() => setPage("home")}
          style={{
            padding: "10px 16px",
            border: "1px solid #cbd5e1",
            borderRadius: "12px",
            background: "white",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          返回首页
        </button>

        <button
          onClick={onGenerateNew}
          disabled={isGenerating || isScoring}
          style={{
            padding: "10px 16px",
            border: "none",
            borderRadius: "12px",
            background: isGenerating || isScoring ? "#cbd5e1" : "#111827",
            color: "white",
            fontWeight: 700,
            cursor: isGenerating || isScoring ? "not-allowed" : "pointer",
          }}
        >
          {isGenerating ? "正在生成..." : "换一题"}
        </button>
      </div>

      <h2 style={{ fontSize: "28px", marginBottom: "10px" }}>{title}</h2>

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
        promptBlock
      )}

      <textarea
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        placeholder={placeholder}
        disabled={isGenerating || isScoring}
        style={{
          width: "100%",
          minHeight: "280px",
          padding: "18px",
          borderRadius: "18px",
          border: "1px solid #cbd5e1",
          fontSize: "16px",
          lineHeight: 1.7,
          resize: "vertical",
          boxSizing: "border-box",
          background: isGenerating || isScoring ? "#f8fafc" : "white",
        }}
      />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: "14px",
          marginBottom: "24px",
        }}
      >
        <div>
           <span style={{ color: "#64748b", fontWeight: 700 }}>
            Word Count: {wordCount}
          </span>
          <div style={{ color: "#64748b", fontSize: "14px", marginTop: "6px" }}>
            AI scoring costs {submitCost} points.
          </div>
        </div>

        <button
          onClick={onSubmit}
          disabled={wordCount === 0 || isScoring || isGenerating}
          style={{
            padding: "12px 24px",
            border: "none",
            borderRadius: "12px",
            background:
              wordCount === 0 || isScoring || isGenerating
                ? "#cbd5e1"
                : "#111827",
            color: "white",
            fontWeight: 700,
            cursor:
              wordCount === 0 || isScoring || isGenerating
                ? "not-allowed"
                : "pointer",
          }}
        >
          {isScoring ? "正在评分..." : `提交并查看反馈（-${submitCost} points）`}
        </button>
      </div>

      {submitted && feedback && (
        <FeedbackBox
          score={feedback.score}
          strengths={feedback.strengths}
          problems={feedback.problems}
          grammarCorrections={feedback.grammarCorrections}
          actionPlan={feedback.actionPlan}
          improvedVersion={feedback.improvedVersion}
          sampleAnswer={feedback.sampleAnswer}
        />
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
  sampleAnswer,
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
  sampleAnswer?: string;
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
      <h3 style={{ marginTop: 0 }}>AI Feedback: {score}</h3>

      <strong>Strengths</strong>
      <ul style={{ lineHeight: 1.8 }}>
        {strengths.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <strong>Problems</strong>
      <ul style={{ lineHeight: 1.8 }}>
        {problems.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      {grammarCorrections && grammarCorrections.length > 0 && (
        <>
          <strong>Grammar Corrections</strong>
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
                  <strong>Original:</strong> {item.original}
                </div>
                <div>
                  <strong>Corrected:</strong> {item.corrected}
                </div>
                <div style={{ color: "#64748b" }}>
                  <strong>Why:</strong> {item.explanation}
                </div>
              </div>
            ))}
          </div>
          <br />
        </>
      )}

      {actionPlan && actionPlan.length > 0 && (
        <>
          <strong>Action Plan</strong>
          <ul style={{ lineHeight: 1.8 }}>
            {actionPlan.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      )}

      <strong>Improved Version</strong>
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

      {sampleAnswer && (
        <>
          <strong>Sample Answer</strong>
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
            {sampleAnswer}
          </pre>
        </>
      )}
    </div>
  );
}

function AuthPanel({
  user,
  points,
  authEmail,
  authPassword,
  authMessage,
  isAuthLoading,
  redeemCode,
  redeemMessage,
  isRedeeming,
  setAuthEmail,
  setAuthPassword,
  setRedeemCode,
  onSignUp,
  onSignIn,
  onSignOut,
  onRedeemCode,
  onViewRecords,
  onShowPointsModal,
  onViewMockRecords,
}: {
  user: User | null;
  points: number;
  authEmail: string;
  authPassword: string;
  authMessage: string;
  isAuthLoading: boolean;
  redeemCode: string;
  redeemMessage: string;
  isRedeeming: boolean;
  setAuthEmail: (value: string) => void;
  setAuthPassword: (value: string) => void;
  setRedeemCode: (value: string) => void;
  onSignUp: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onRedeemCode: () => void;
  onViewRecords:()=> void;
  onShowPointsModal: () => void;
  onViewMockRecords: () => void;
}) {
  return (
    <section
      style={{
        background: "#ffffff",
        border: "1px solid #e5e7eb",
        borderRadius: "24px",
        padding: "24px",
        marginBottom: "24px",
        boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
      }}
    >
      <div
        style={{
          fontSize: "13px",
          fontWeight: 700,
          color: "#64748b",
          marginBottom: "8px",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        Account
      </div>

      {user ? (
        <>
          <h2 style={{ marginTop: 0 }}>Welcome back</h2>
          <p style={{ color: "#64748b" }}>Signed in as {user.email}</p>
          <p style={{ color: "#64748b", fontWeight: 700 }}>
            Current points: {points}
          </p>
          <div
            style={{
              display: "flex",
              gap: "12px",
              flexWrap: "wrap",
              marginTop: "12px",
              marginBottom: "16px",
            }}
          >
            <button type="button" onClick={onShowPointsModal}>
              Get Points
            </button>
          </div>





          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(220px, 1fr) auto",
              gap: "12px",
              marginTop: "16px",
              alignItems: "center",
            }}
          >
            <input
              value={redeemCode}
              onChange={(event) => setRedeemCode(event.target.value)}
              placeholder="Enter redeem code"
              type="text"
              style={{
                width: "100%",
                border: "1px solid #d8dee8",
                borderRadius: "14px",
                padding: "12px 14px",
                fontSize: "14px",
                boxSizing: "border-box",
                textTransform: "uppercase",
              }}
            />

            <button type="button" onClick={onRedeemCode} disabled={isRedeeming}>
              {isRedeeming ? "Redeeming..." : "Redeem"}
            </button>
          </div>

          {redeemMessage && (
            <p style={{ color: "#64748b", marginTop: "12px" }}>
              {redeemMessage}
            </p>
          )}




          <div
            style={{
              display: "flex",
              gap: "12px",
              flexWrap: "wrap",
              marginTop: "16px",
            }}
          >

            <button type="button" onClick={onViewMockRecords}>
              View Mock Records
            </button>

            <button type="button" onClick={onViewRecords}>
              View Practice Records
            </button>
            
            <button type="button" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </>
      ) : (
        <>
          <h2 style={{ marginTop: 0 }}>Sign in to use your points</h2>
          <p style={{ color: "#64748b" }}>
            Create an account or sign in before using practice credits.
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "12px",
              marginTop: "16px",
            }}
          >
            <input
              value={authEmail}
              onChange={(event) => setAuthEmail(event.target.value)}
              placeholder="Email"
              type="email"
              style={{
                width: "100%",
                border: "1px solid #d8dee8",
                borderRadius: "14px",
                padding: "12px 14px",
                fontSize: "14px",
                boxSizing: "border-box",
              }}
            />

            <input
              value={authPassword}
              onChange={(event) => setAuthPassword(event.target.value)}
              placeholder="Password"
              type="password"
              style={{
                width: "100%",
                border: "1px solid #d8dee8",
                borderRadius: "14px",
                padding: "12px 14px",
                fontSize: "14px",
                boxSizing: "border-box",
              }}
            />
          </div>

          <div
            style={{
              display: "flex",
              gap: "12px",
              flexWrap: "wrap",
              marginTop: "14px",
            }}
          >
            <button type="button" onClick={onSignIn} disabled={isAuthLoading}>
              Sign in
            </button>

            <button type="button" onClick={onSignUp} disabled={isAuthLoading}>
              Sign up
            </button>
          </div>

          {authMessage && (
            <p style={{ color: "#64748b", marginTop: "14px" }}>
              {authMessage}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function PracticeRecordsPage({
  records,
  isLoading,
  message,
  setPage,
  onOpenRecord,
}: {
  records: PracticeRecord[];
  isLoading: boolean;
  message: string;
  setPage: (page: Page) => void;
  onOpenRecord: (record: PracticeRecord) => void;
}) {
  function formatPracticeType(type: string) {
    if (type === "email") return "Email Writing";
    if (type === "discussion") return "Academic Discussion";
    return type;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setPage("home")}
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

      <h2 style={{ fontSize: "28px", marginBottom: "10px" }}>
        Practice Records
      </h2>

      <p style={{ color: "#64748b", marginBottom: "24px" }}>
        点击任意记录查看题目、答案和详细反馈。
      </p>

      {isLoading && <p style={{ color: "#64748b" }}>Loading records...</p>}
      {message && <p style={{ color: "#be123c" }}>{message}</p>}

      {!isLoading && records.length === 0 && (
        <p style={{ color: "#64748b" }}>No practice records yet.</p>
      )}

      <div style={{ display: "grid", gap: "12px" }}>
        {records.map((record) => (
          <button
            key={record.id}
            type="button"
            onClick={() => onOpenRecord(record)}
            style={{
              width: "100%",
              border: "1px solid #e2e8f0",
              borderRadius: "18px",
              background: "#f8fafc",
              padding: "18px 20px",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.4fr 1.6fr 0.8fr auto",
                gap: "14px",
                alignItems: "center",
              }}
            >
              <strong>{formatPracticeType(record.practice_type)}</strong>

              <span style={{ color: "#64748b" }}>
                {new Date(record.created_at).toLocaleString()}
              </span>

              <span style={{ fontWeight: 800, color: "#312e81" }}>
                {record.score}
              </span>

              <span style={{ color: "#64748b", fontWeight: 700 }}>
                查看详情 →
              </span>
            </div>
          </button>
        ))}
      </div>
    </>
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

function PracticeRecordDetailPage({
  record,
  onClose,
}: {
  record: PracticeRecord;
  onClose: () => void;
}) {
  function formatPracticeType(type: string) {
    if (type === "email") return "Email Writing";
    if (type === "discussion") return "Academic Discussion";
    return type;
  }

  function renderPrompt() {
    if (record.practice_type === "email") {
      const prompt = record.prompt as EmailPrompt;

      return (
        <div style={{ lineHeight: 1.8 }}>
          <p>{prompt.scenario}</p>

          <div
            style={{
              padding: "16px",
              borderRadius: "14px",
              background: "white",
              border: "1px solid #e2e8f0",
            }}
          >
            <strong>{prompt.task}</strong>

            {Array.isArray(prompt.requirements) && (
              <ul>
                {prompt.requirements.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}

            <p style={{ color: "#64748b", marginBottom: 0 }}>
              {prompt.suggestedLength}
            </p>
          </div>
        </div>
      );
    }

    if (record.practice_type === "discussion") {
      const prompt = record.prompt as DiscussionPrompt;

      return (
        <div style={{ display: "grid", gap: "14px", lineHeight: 1.8 }}>
          <div
            style={{
              padding: "16px",
              borderRadius: "14px",
              background: "white",
              border: "1px solid #e2e8f0",
            }}
          >
            <strong>Professor</strong>
            <p style={{ marginBottom: 0 }}>{prompt.professor}</p>
          </div>

          <div
            style={{
              padding: "16px",
              borderRadius: "14px",
              background: "white",
              border: "1px solid #e2e8f0",
            }}
          >
            <strong>{prompt.studentOneName}</strong>
            <p style={{ marginBottom: 0 }}>{prompt.studentOnePost}</p>
          </div>

          <div
            style={{
              padding: "16px",
              borderRadius: "14px",
              background: "white",
              border: "1px solid #e2e8f0",
            }}
          >
            <strong>{prompt.studentTwoName}</strong>
            <p style={{ marginBottom: 0 }}>{prompt.studentTwoPost}</p>
          </div>

          <div
            style={{
              padding: "16px",
              borderRadius: "14px",
              background: "#eef2ff",
              color: "#312e81",
            }}
          >
            <strong>Question</strong>
            <p>{prompt.question}</p>
            <p style={{ marginBottom: 0 }}>{prompt.suggestedLength}</p>
          </div>
        </div>
      );
    }

    return (
      <pre
        style={{
          whiteSpace: "pre-wrap",
          background: "white",
          padding: "14px",
          borderRadius: "14px",
          lineHeight: 1.7,
          overflowX: "auto",
          border: "1px solid #e2e8f0",
        }}
      >
        {JSON.stringify(record.prompt, null, 2)}
      </pre>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={onClose}
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
        关闭
      </button>

      <div
        style={{
          padding: "22px",
          borderRadius: "20px",
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          marginBottom: "24px",
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: "10px" }}>
          {formatPracticeType(record.practice_type)}
        </h2>

        <div style={{ color: "#64748b", lineHeight: 1.8 }}>
          <div>时间：{new Date(record.created_at).toLocaleString()}</div>
          <div>评分：{record.score}</div>
          <div>消耗积分：{record.points_spent} points</div>
        </div>
      </div>

      <section style={{ marginBottom: "24px" }}>
        <h3>Question</h3>
        {renderPrompt()}
      </section>

      <section style={{ marginBottom: "24px" }}>
        <h3>Your Answer</h3>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            background: "white",
            padding: "16px",
            borderRadius: "14px",
            lineHeight: 1.8,
            border: "1px solid #e2e8f0",
          }}
        >
          {record.answer}
        </pre>
      </section>

      <section>
        <h3>Feedback</h3>
        <FeedbackBox
          score={record.feedback.score}
          strengths={record.feedback.strengths || []}
          problems={record.feedback.problems || []}
          grammarCorrections={record.feedback.grammarCorrections || []}
          actionPlan={record.feedback.actionPlan || []}
          improvedVersion={record.feedback.improvedVersion || ""}
          sampleAnswer={record.feedback.sampleAnswer || ""}
        />
      </section>
    </>
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

  message,

  onSubmit,

  onCancel,

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

  dragged: Chunk | null;

  setDragged: (chunk: Chunk | null) => void;

  emailAnswer: string;

  setEmailAnswer: (value: string) => void;

  discussionAnswer: string;

  setDiscussionAnswer: (value: string) => void;

  isSubmitting: boolean;

  message: string;

  onSubmit: () => void;

  onCancel: () => void;

}) {

  const cardStyle = {

    background: "white",

    border: "1px solid #e2e8f0",

    borderRadius: "20px",

    padding: "24px",

    marginBottom: "24px",

    boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",

  };

  const primaryButtonStyle = {

    border: "none",

    borderRadius: "14px",

    color: "white",

    fontWeight: 800,

    fontSize: "15px",

    padding: "12px 18px",

    cursor: "pointer",

  };

  const secondaryButtonStyle = {

    padding: "12px 20px",

    border: "1px solid #cbd5e1",

    borderRadius: "12px",

    background: "white",

    fontWeight: 700,

    cursor: "pointer",

  };

  const [mockPart, setMockPart] = useState<"sentence" | "email" | "discussion">(

    "sentence"

  );

  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(0);

  const [timeLeft, setTimeLeft] = useState(6 * 60);
  const onSubmitRef = useRef(onSubmit);

  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  useEffect(() => {
    if (isSubmitting) return;

    const timer = window.setInterval(() => {
      setTimeLeft((previous) => {
        if (previous <= 1) {
          window.clearInterval(timer);

          if (mockPart === "sentence") {
            setMockPart("email");
            setCurrentSentenceIndex(0);
            window.scrollTo({ top: 0, behavior: "smooth" });
            return 7 * 60;
          }

          if (mockPart === "email") {
            setMockPart("discussion");
            window.scrollTo({ top: 0, behavior: "smooth" });
            return 10 * 60;
          } 

          if (mockPart === "discussion") {
            onSubmitRef.current();
            return 0;
          }
        }

        return previous - 1;
      });
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [mockPart, isSubmitting]);

  function formatTime(seconds: number) {

    const minutes = Math.floor(seconds / 60);
    const restSeconds = seconds % 60;
    return `${minutes}:${String(restSeconds).padStart(2, "0")}`;
  }

  function goToEmailPart() {

    setMockPart("email");
    setTimeLeft(7 * 60);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goToDiscussionPart() {

    setMockPart("discussion");

    setTimeLeft(10 * 60);

    window.scrollTo({ top: 0, behavior: "smooth" });

  }

  function goToNextSentence() {

    if (currentSentenceIndex < data.sentenceQuestions.length - 1) {

      setCurrentSentenceIndex((previous) => previous + 1);

      window.scrollTo({ top: 0, behavior: "smooth" });

      return;

    }

    goToEmailPart();

  }

  function updateQuestionSlots(questionId: number, newSlots: (Chunk | null)[]) {

    setSentenceSlots((previous) => ({

      ...previous,

      [questionId]: newSlots,

    }));

  }

  function placeChunk(question: Question, chunk: Chunk, slotIndex: number) {

    const currentSlots = sentenceSlots[question.id] || makeEmptySlots(question);

    const newSlots = [...currentSlots];

    const oldSlotIndex = newSlots.findIndex((slot) => slot?.id === chunk.id);

    if (oldSlotIndex !== -1) {

      newSlots[oldSlotIndex] = null;

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

      .map((slot) => slot.id);

    return (sentenceBanks[question.id] || []).filter(

      (chunk) => !usedIds.includes(chunk.id)

    );

  }

  const emailWordCount = emailAnswer.trim()

    ? emailAnswer.trim().split(/\s+/).length

    : 0;

  const discussionWordCount = discussionAnswer.trim()

    ? discussionAnswer.trim().split(/\s+/).length

    : 0;

  const currentQuestion = data.sentenceQuestions[currentSentenceIndex];

  return (

    <>

      <button

        type="button"

        onClick={onCancel}

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

      <div

        style={{

          ...cardStyle,

          position: "sticky",

          top: "12px",

          zIndex: 20,

        }}

      >

        <h1 style={{ marginTop: 0 }}>Full Mock Test</h1>

        <p style={{ color: "#64748b", lineHeight: 1.8 }}>

          完整模考分为三个部分：Build a Sentence 6分钟、Email Writing

          7分钟、Academic Discussion 10分钟。时间到后会自动进入下一部分。

        </p>

        <div

          style={{

            display: "flex",

            justifyContent: "space-between",

            gap: "16px",

            flexWrap: "wrap",

            alignItems: "center",

          }}

        >

          <strong style={{ color: "#312e81" }}>

            Current Part:{" "}

            {mockPart === "sentence"

              ? "Part 1 Build a Sentence"

              : mockPart === "email"

                ? "Part 2 Email Writing"

                : "Part 3 Academic Discussion"}

          </strong>

          <strong

            style={{

              fontSize: "26px",

              color: timeLeft <= 60 ? "#be123c" : "#111827",

            }}

          >

            {formatTime(timeLeft)}

          </strong>

        </div>

        <p style={{ color: "#475569", fontWeight: 800 }}>

          Submit Mock Test：-10 points

        </p>

      </div>

      {mockPart === "sentence" && currentQuestion && (

        <section style={cardStyle}>

          <h2 style={{ marginTop: 0 }}>Part 1 Build a Sentence</h2>

          <p style={{ color: "#64748b", lineHeight: 1.7 }}>

            A/B 对话补全。把词块拖到 B 句横线上，或点击词块自动填入第一个空格。

            共 10 题，每题 0.5 分，错一空即为 0。本部分限时 6 分钟。

          </p>

          <div

            style={{

              display: "flex",

              justifyContent: "space-between",

              gap: "16px",

              marginBottom: "24px",

              padding: "16px 20px",

              background: "#f1f5f9",

              borderRadius: "16px",

              fontWeight: 700,

            }}

          >

            <span>

              Question {currentSentenceIndex + 1} /{" "}

              {data.sentenceQuestions.length}

            </span>

            <span>

              已完成：

              {

                data.sentenceQuestions.filter((item) =>

                  isQuestionComplete(sentenceSlots[item.id] || [])

                ).length

              }{" "}

              / {data.sentenceQuestions.length}

            </span>

          </div>

          <div style={{ display: "flex", gap: "8px", marginBottom: "28px" }}>

            {data.sentenceQuestions.map((question, index) => {

              const slots = sentenceSlots[question.id] || [];

              const complete = isQuestionComplete(slots);

              let background = "white";

              let color = "#334155";

              let borderColor = "#cbd5e1";

              if (index === currentSentenceIndex) {

                background = "#111827";

                color = "white";

                borderColor = "#111827";

              } else if (complete) {

                background = "#eef2ff";

                color = "#312e81";

                borderColor = "#c7d2fe";

              }

              return (

                <button

                  key={question.id}

                  type="button"

                  onClick={() => setCurrentSentenceIndex(index)}

                  style={{

                    width: "42px",

                    height: "42px",

                    borderRadius: "12px",

                    border: `1px solid ${borderColor}`,

                    background,

                    color,

                    fontWeight: 800,

                    cursor: "pointer",

                  }}

                >

                  {index + 1}

                </button>

              );

            })}

          </div>

          {(() => {

            const question = currentQuestion;

            const currentSlots =

              sentenceSlots[question.id] || makeEmptySlots(question);

            const currentBank = getAvailableBank(question);

            return (

              <>

                <div

                  style={{

                    fontSize: "24px",

                    lineHeight: "2.2",

                    fontWeight: 700,

                    marginBottom: "36px",

                  }}

                >

                  <div>

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

                            <span key={`fixed-${partIndex}`}>{part.text}</span>

                          );

                        }

                        const slotIndex = blankIndex;

                        blankIndex += 1;

                        const slot = currentSlots[slotIndex];

                        return (

                          <button

                            key={`blank-${partIndex}`}

                            type="button"

                            onClick={() => removeChunk(question, slotIndex)}

                            onDragOver={(event) => event.preventDefault()}

                            onDrop={() => {

                              if (dragged) {

                                placeChunk(question, dragged, slotIndex);

                                setDragged(null);

                              }

                            }}

                            style={{

                              minWidth: "120px",

                              minHeight: "42px",

                              border: "2px solid #cbd5e1",

                              borderRadius: "12px",

                              background: slot ? "#eef2ff" : "white",

                              color: "#111827",

                              fontSize: "18px",

                              fontWeight: 700,

                              cursor: "pointer",

                            }}

                          >

                            {slot?.text || ""}

                          </button>

                        );

                      });

                    })()}

                  </div>

                </div>

                <div

                  style={{

                    background: "#f1f5f9",

                    padding: "20px",

                    borderRadius: "18px",

                    marginBottom: "24px",

                  }}

                >

                  <div

                    style={{

                      fontSize: "14px",

                      color: "#64748b",

                      marginBottom: "12px",

                    }}

                  >

                    可选词 / Word Bank

                  </div>

                  <div

                    style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}

                  >

                    {currentBank.map((chunk) => (

                      <button

                        key={chunk.id}

                        type="button"

                        draggable

                        onDragStart={() => setDragged(chunk)}

                        onDragEnd={() => setDragged(null)}

                        onClick={() => {

                          const emptyIndex = currentSlots.findIndex(

                            (slot) => slot === null

                          );

                          if (emptyIndex !== -1) {

                            placeChunk(question, chunk, emptyIndex);

                          }

                        }}

                        style={{

                          padding: "10px 16px",

                          border: "1px solid #cbd5e1",

                          borderRadius: "999px",

                          background: "white",

                          fontSize: "16px",

                          fontWeight: 600,

                          cursor: "grab",

                        }}

                      >

                        {chunk.text}

                      </button>

                    ))}

                    {currentBank.length === 0 && (

                      <span style={{ color: "#64748b" }}>本题词库已清空。</span>

                    )}

                  </div>

                </div>

                <div

                  style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}

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

      {mockPart === "email" && (

        <section style={cardStyle}>

          <h2 style={{ marginTop: 0 }}>Part 2 Write an Email</h2>

          <p style={{ color: "#64748b", lineHeight: 1.8 }}>

            {data.emailPrompt.scenario}

          </p>

          <div

            style={{

              padding: "16px",

              borderRadius: "14px",

              background: "#f8fafc",

              border: "1px solid #e2e8f0",

              marginBottom: "16px",

            }}

          >

            <strong>{data.emailPrompt.task}</strong>

            <ul style={{ lineHeight: 1.8 }}>

              {data.emailPrompt.requirements.map((item) => (

                <li key={item}>{item}</li>

              ))}

            </ul>

            <p style={{ color: "#64748b", marginBottom: 0 }}>

              {data.emailPrompt.suggestedLength}

            </p>

          </div>

          <textarea

            value={emailAnswer}

            onChange={(event) => setEmailAnswer(event.target.value)}

            placeholder="Write your email here..."

            style={{

              width: "100%",

              minHeight: "220px",

              padding: "16px",

              borderRadius: "16px",

              border: "1px solid #cbd5e1",

              fontSize: "15px",

              lineHeight: 1.7,

              boxSizing: "border-box",

            }}

          />

          <p style={{ color: "#64748b", fontWeight: 700 }}>

            Word Count: {emailWordCount}

          </p>

          <button

            type="button"

            onClick={goToDiscussionPart}

            style={{

              ...primaryButtonStyle,

              background: "#111827",

              marginTop: "12px",

            }}

          >

            Next: Academic Discussion

          </button>

        </section>

      )}

      {mockPart === "discussion" && (

        <section style={cardStyle}>

          <h2 style={{ marginTop: 0 }}>Part 3 Academic Discussion</h2>

          <div style={{ display: "grid", gap: "14px", lineHeight: 1.8 }}>

            <div

              style={{

                padding: "16px",

                borderRadius: "14px",

                background: "#f8fafc",

                border: "1px solid #e2e8f0",

              }}

            >

              <strong>Professor</strong>

              <p style={{ marginBottom: 0 }}>

                {data.discussionPrompt.professor}

              </p>

            </div>

            <div

              style={{

                padding: "16px",

                borderRadius: "14px",

                background: "#f8fafc",

                border: "1px solid #e2e8f0",

              }}

            >

              <strong>{data.discussionPrompt.studentOneName}</strong>

              <p style={{ marginBottom: 0 }}>

                {data.discussionPrompt.studentOnePost}

              </p>

            </div>

            <div

              style={{

                padding: "16px",

                borderRadius: "14px",

                background: "#f8fafc",

                border: "1px solid #e2e8f0",

              }}

            >

              <strong>{data.discussionPrompt.studentTwoName}</strong>

              <p style={{ marginBottom: 0 }}>

                {data.discussionPrompt.studentTwoPost}

              </p>

            </div>

            <div

              style={{

                padding: "16px",

                borderRadius: "14px",

                background: "#eef2ff",

                color: "#312e81",

              }}

            >

              <strong>Question</strong>

              <p>{data.discussionPrompt.question}</p>

              <p style={{ marginBottom: 0 }}>

                {data.discussionPrompt.suggestedLength}

              </p>

            </div>

          </div>

          <textarea

            value={discussionAnswer}

            onChange={(event) => setDiscussionAnswer(event.target.value)}

            placeholder="Write your discussion response here..."

            style={{

              width: "100%",

              minHeight: "240px",

              padding: "16px",

              borderRadius: "16px",

              border: "1px solid #cbd5e1",

              fontSize: "15px",

              lineHeight: 1.7,

              boxSizing: "border-box",

              marginTop: "16px",

            }}

          />

          <p style={{ color: "#64748b", fontWeight: 700 }}>

            Word Count: {discussionWordCount}

          </p>

          {message && (

            <p style={{ color: "#be123c", fontWeight: 700 }}>{message}</p>

          )}

          <button

            type="button"

            onClick={onSubmit}

            disabled={isSubmitting}

            style={{

              ...primaryButtonStyle,

              width: "100%",

              padding: "16px",

              background: isSubmitting ? "#cbd5e1" : "#111827",

              cursor: isSubmitting ? "not-allowed" : "pointer",

              marginTop: "10px",

            }}

          >

            {isSubmitting ? "正在评分并生成报告..." : "提交完整模考（-10 points）"}

          </button>

        </section>

      )}

    </>

  );

}



function MockResultPage({
  result,
  onBackHome,
  onViewRecords,
}: {
  result: MockResult;
  onBackHome: () => void;
  onViewRecords: () => void;
}) {
  const cardStyle = {
    background: "white",
    border: "1px solid #e2e8f0",
    borderRadius: "20px",
    padding: "24px",
    marginBottom: "24px",
    boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
  };

  const secondaryButtonStyle = {
    padding: "12px 18px",
    border: "1px solid #cbd5e1",
    borderRadius: "14px",
    background: "white",
    fontWeight: 800,
    cursor: "pointer",
  };

  const primaryButtonStyle = {
    padding: "12px 18px",
    border: "none",
    borderRadius: "14px",
    background: "#111827",
    color: "white",
    fontWeight: 800,
    cursor: "pointer",
  };

  return (
    <>
      <div
        style={{
          ...cardStyle,
          background: "linear-gradient(135deg, #eef2ff, #ffffff)",
        }}
      >
        <h1 style={{ marginTop: 0 }}>Mock Test Result</h1>

        <p
          style={{
            fontSize: "42px",
            fontWeight: 900,
            color: "#312e81",
            margin: "14px 0",
          }}
        >
          {result.finalScore.toFixed(1)} / 6.0
        </p>

        <p style={{ color: "#64748b", lineHeight: 1.8 }}>
          这是根据 Build a Sentence 25%、Email Writing 35%、Academic Discussion
          40% 折算出的新 TOEFL 6 分制模考总分。
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "14px",
            marginTop: "20px",
          }}
        >
          <div
            style={{
              padding: "16px",
              borderRadius: "16px",
              background: "white",
              border: "1px solid #e2e8f0",
            }}
          >
            <strong>Build a Sentence</strong>
            <p style={{ fontSize: "24px", fontWeight: 900 }}>
              {result.sentenceScore.toFixed(1)} / 5.0
            </p>
            <p style={{ color: "#64748b", marginBottom: 0 }}>Weight: 25%</p>
          </div>

          <div
            style={{
              padding: "16px",
              borderRadius: "16px",
              background: "white",
              border: "1px solid #e2e8f0",
            }}
          >
            <strong>Email Writing</strong>
            <p style={{ fontSize: "24px", fontWeight: 900 }}>
              {result.emailScore}
            </p>
            <p style={{ color: "#64748b", marginBottom: 0 }}>Weight: 35%</p>
          </div>

          <div
            style={{
              padding: "16px",
              borderRadius: "16px",
              background: "white",
              border: "1px solid #e2e8f0",
            }}
          >
            <strong>Academic Discussion</strong>
            <p style={{ fontSize: "24px", fontWeight: 900 }}>
              {result.discussionScore}
            </p>
            <p style={{ color: "#64748b", marginBottom: 0 }}>Weight: 40%</p>
          </div>
        </div>

        <p style={{ color: "#475569", fontWeight: 700 }}>
          Points spent: {result.cost ?? 10}
        </p>
      </div>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Knowledge Analysis</h2>

        {result.knowledgeAnalysis.length > 0 ? (
          <ul style={{ lineHeight: 1.8 }}>
            {result.knowledgeAnalysis.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p style={{ color: "#64748b" }}>No knowledge analysis available.</p>
        )}
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Study Advice</h2>

        {result.studyAdvice.length > 0 ? (
          <ul style={{ lineHeight: 1.8 }}>
            {result.studyAdvice.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p style={{ color: "#64748b" }}>No study advice available.</p>
        )}
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Email Writing Feedback</h2>

        <FeedbackBox
          score={result.emailFeedback.score}
          strengths={result.emailFeedback.strengths || []}
          problems={result.emailFeedback.problems || []}
          grammarCorrections={result.emailFeedback.grammarCorrections || []}
          actionPlan={result.emailFeedback.actionPlan || []}
          improvedVersion={result.emailFeedback.improvedVersion || ""}
          sampleAnswer={result.emailFeedback.sampleAnswer || ""}
        />
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Academic Discussion Feedback</h2>

        <FeedbackBox
          score={result.discussionFeedback.score}
          strengths={result.discussionFeedback.strengths || []}
          problems={result.discussionFeedback.problems || []}
          grammarCorrections={result.discussionFeedback.grammarCorrections || []}
          actionPlan={result.discussionFeedback.actionPlan || []}
          improvedVersion={result.discussionFeedback.improvedVersion || ""}
          sampleAnswer={result.discussionFeedback.sampleAnswer || ""}
        />
      </section>

      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
        <button type="button" onClick={onBackHome} style={secondaryButtonStyle}>
          返回首页
        </button>

        <button type="button" onClick={onViewRecords} style={primaryButtonStyle}>
          查看模考记录
        </button>
      </div>
    </>
  );
}

function MockRecordsPage({
  records,
  isLoading,
  message,
  onBackHome,
  onOpenRecord,
}: {
  records: MockRecord[];
  isLoading: boolean;
  message: string;
  onBackHome: () => void;
  onOpenRecord: (record: MockRecord) => void;
}) {
  const cardStyle = {
    background: "white",
    border: "1px solid #e2e8f0",
    borderRadius: "20px",
    padding: "24px",
    marginBottom: "24px",
    boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
  };

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

      <div style={cardStyle}>
        <h1 style={{ marginTop: 0 }}>Mock Records</h1>
        <p style={{ color: "#64748b", lineHeight: 1.8 }}>
          这里会单独显示完整模考记录。点击任意记录可以查看题目、答案、反馈、知识点分析和备考建议。
        </p>
      </div>

      {isLoading && <p style={{ color: "#64748b" }}>Loading mock records...</p>}

      {message && <p style={{ color: "#be123c", fontWeight: 700 }}>{message}</p>}

      {!isLoading && records.length === 0 && (
        <p style={{ color: "#64748b" }}>No mock records yet.</p>
      )}

      <div style={{ display: "grid", gap: "12px" }}>
        {records.map((record) => (
          <button
            key={record.id}
            type="button"
            onClick={() => onOpenRecord(record)}
            style={{
              width: "100%",
              border: "1px solid #e2e8f0",
              borderRadius: "18px",
              background: "#f8fafc",
              padding: "18px 20px",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.4fr 1fr 1fr 1fr auto",
                gap: "14px",
                alignItems: "center",
              }}
            >
              <span style={{ color: "#64748b" }}>
                {new Date(record.created_at).toLocaleString()}
              </span>

              <strong style={{ color: "#312e81" }}>
                Final {Number(record.final_score).toFixed(1)} / 6.0
              </strong>

              <span>Sentence {Number(record.sentence_score).toFixed(1)} / 5.0</span>

              <span>Email {record.email_score}</span>

              <span style={{ color: "#64748b", fontWeight: 700 }}>
                查看详情 →
              </span>
            </div>

            <div
              style={{
                marginTop: "10px",
                color: "#64748b",
                fontSize: "14px",
              }}
            >
              Discussion {record.discussion_score} · Points spent:{" "}
              {record.points_spent}
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

function MockRecordDetailPage({
  record,
  onClose,
}: {
  record: MockRecord;
  onClose: () => void;
}) {
  const cardStyle = {
    background: "white",
    border: "1px solid #e2e8f0",
    borderRadius: "20px",
    padding: "24px",
    marginBottom: "24px",
    boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
  };

  function normalizeText(text: string) {
    return String(text || "")
      .trim()
      .toLowerCase()
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[.,!?;:]/g, "")
      .replace(/\s+/g, " ");
  }

  return (
    <>
      <button
        type="button"
        onClick={onClose}
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
        关闭
      </button>

      <div
        style={{
          ...cardStyle,
          background: "linear-gradient(135deg, #eef2ff, #ffffff)",
        }}
      >
        <h1 style={{ marginTop: 0 }}>Mock Test Detail</h1>

        <p
          style={{
            fontSize: "42px",
            fontWeight: 900,
            color: "#312e81",
            margin: "14px 0",
          }}
        >
          {Number(record.final_score).toFixed(1)} / 6.0
        </p>

        <div style={{ color: "#64748b", lineHeight: 1.8 }}>
          <div>时间：{new Date(record.created_at).toLocaleString()}</div>
          <div>Build a Sentence：{Number(record.sentence_score).toFixed(1)} / 5.0</div>
          <div>Email Writing：{record.email_score}</div>
          <div>Academic Discussion：{record.discussion_score}</div>
          <div>消耗积分：{record.points_spent} points</div>
        </div>
      </div>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Knowledge Analysis</h2>

        {record.knowledge_analysis.length > 0 ? (
          <ul style={{ lineHeight: 1.8 }}>
            {record.knowledge_analysis.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p style={{ color: "#64748b" }}>No knowledge analysis available.</p>
        )}
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Study Advice</h2>

        {record.study_advice.length > 0 ? (
          <ul style={{ lineHeight: 1.8 }}>
            {record.study_advice.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p style={{ color: "#64748b" }}>No study advice available.</p>
        )}
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Part 1 Build a Sentence</h2>

        <div style={{ display: "grid", gap: "14px" }}>
          {record.sentence_questions.map((question, index) => {
            const userChunks = record.sentence_answers[question.id] || [];
            const userAnswer = Array.isArray(userChunks) ? userChunks.join(" ") : "";
            const isCorrect =
              normalizeText(userAnswer) === normalizeText(question.target);

            return (
              <div
                key={question.id}
                style={{
                  padding: "16px",
                  borderRadius: "16px",
                  background: "#f8fafc",
                  border: `1px solid ${isCorrect ? "#bbf7d0" : "#fecdd3"}`,
                }}
              >
                <strong>
                  Question {index + 1} · {isCorrect ? "Correct" : "Incorrect"}
                </strong>

                <p style={{ lineHeight: 1.7 }}>
                  <strong>{question.contextSpeaker}:</strong> {question.contextSentence}
                </p>

                <p style={{ lineHeight: 1.7 }}>
                  <strong>Your answer:</strong>{" "}
                  {userAnswer || <span style={{ color: "#be123c" }}>No answer</span>}
                </p>

                <p style={{ lineHeight: 1.7 }}>
                  <strong>Correct answer:</strong> {question.target}
                </p>

                <p style={{ color: "#64748b", marginBottom: 0 }}>
                  Chunks: {question.chunks.join(" / ")}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Part 2 Email Writing</h2>

        <p style={{ color: "#64748b", lineHeight: 1.8 }}>
          {record.email_prompt.scenario}
        </p>

        <div
          style={{
            padding: "16px",
            borderRadius: "14px",
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            marginBottom: "16px",
          }}
        >
          <strong>{record.email_prompt.task}</strong>
          <ul style={{ lineHeight: 1.8 }}>
            {record.email_prompt.requirements.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p style={{ color: "#64748b", marginBottom: 0 }}>
            {record.email_prompt.suggestedLength}
          </p>
        </div>

        <h3>Your Answer</h3>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            background: "#f8fafc",
            padding: "16px",
            borderRadius: "14px",
            lineHeight: 1.8,
            border: "1px solid #e2e8f0",
          }}
        >
          {record.email_answer}
        </pre>

        <h3>Feedback</h3>
        <FeedbackBox
          score={record.email_feedback.score}
          strengths={record.email_feedback.strengths || []}
          problems={record.email_feedback.problems || []}
          grammarCorrections={record.email_feedback.grammarCorrections || []}
          actionPlan={record.email_feedback.actionPlan || []}
          improvedVersion={record.email_feedback.improvedVersion || ""}
          sampleAnswer={record.email_feedback.sampleAnswer || ""}
        />
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Part 3 Academic Discussion</h2>

        <div style={{ display: "grid", gap: "14px", lineHeight: 1.8 }}>
          <div
            style={{
              padding: "16px",
              borderRadius: "14px",
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
            }}
          >
            <strong>Professor</strong>
            <p style={{ marginBottom: 0 }}>{record.discussion_prompt.professor}</p>
          </div>

          <div
            style={{
              padding: "16px",
              borderRadius: "14px",
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
            }}
          >
            <strong>{record.discussion_prompt.studentOneName}</strong>
            <p style={{ marginBottom: 0 }}>
              {record.discussion_prompt.studentOnePost}
            </p>
          </div>

          <div
            style={{
              padding: "16px",
              borderRadius: "14px",
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
            }}
          >
            <strong>{record.discussion_prompt.studentTwoName}</strong>
            <p style={{ marginBottom: 0 }}>
              {record.discussion_prompt.studentTwoPost}
            </p>
          </div>

          <div
            style={{
              padding: "16px",
              borderRadius: "14px",
              background: "#eef2ff",
              color: "#312e81",
            }}
          >
            <strong>Question</strong>
            <p>{record.discussion_prompt.question}</p>
            <p style={{ marginBottom: 0 }}>
              {record.discussion_prompt.suggestedLength}
            </p>
          </div>
        </div>

        <h3>Your Answer</h3>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            background: "#f8fafc",
            padding: "16px",
            borderRadius: "14px",
            lineHeight: 1.8,
            border: "1px solid #e2e8f0",
          }}
        >
          {record.discussion_answer}
        </pre>

        <h3>Feedback</h3>
        <FeedbackBox
          score={record.discussion_feedback.score}
          strengths={record.discussion_feedback.strengths || []}
          problems={record.discussion_feedback.problems || []}
          grammarCorrections={record.discussion_feedback.grammarCorrections || []}
          actionPlan={record.discussion_feedback.actionPlan || []}
          improvedVersion={record.discussion_feedback.improvedVersion || ""}
          sampleAnswer={record.discussion_feedback.sampleAnswer || ""}
        />
      </section>
    </>
  );
}

function AnnouncementBoard() {
  return (
    <section
      style={{
        background: "linear-gradient(135deg, #eef2ff, #ffffff)",
        border: "1px solid #c7d2fe",
        borderRadius: "22px",
        padding: "24px",
        marginBottom: "28px",
        boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "16px",
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: "18px",
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Announcements</h2>
          <p style={{ color: "#64748b", marginBottom: 0 }}>
            最新活动、优惠兑换码和功能更新会放在这里。
          </p>
        </div>

        <span
          style={{
            padding: "8px 12px",
            borderRadius: "999px",
            background: "#312e81",
            color: "white",
            fontWeight: 800,
            fontSize: "14px",
          }}
        >
          Latest
        </span>
      </div>

      <div style={{ display: "grid", gap: "14px" }}>
        {announcements.map((item) => (
          <article
            key={item.id}
            style={{
              background: "white",
              border: "1px solid #e2e8f0",
              borderRadius: "18px",
              padding: "18px",
            }}
          >
            <div
              style={{
                display: "flex",
                gap: "10px",
                alignItems: "center",
                flexWrap: "wrap",
                marginBottom: "8px",
              }}
            >
              <span
                style={{
                  padding: "5px 10px",
                  borderRadius: "999px",
                  background: "#eef2ff",
                  color: "#312e81",
                  fontWeight: 800,
                  fontSize: "13px",
                }}
              >
                {item.tag}
              </span>

              <span style={{ color: "#94a3b8", fontSize: "14px" }}>
                {item.date}
              </span>
            </div>

            <h3 style={{ marginTop: 0, marginBottom: "8px" }}>{item.title}</h3>

            <p style={{ color: "#475569", lineHeight: 1.8, marginBottom: 0 }}>
              {item.content}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}



function getPageFromPath(): Page {
  const path = window.location.pathname;

  if (path.includes("/toefl-past-exam")) 
    return "past-exam";
  if (path.includes("/ets-mock-practice")) 
    return "ets-mock-practice";
  if (path.includes("/build-a-sentence")) 
    return "sentence";
  if (path.includes("/email-writing")) 
    return "email";
  if (path.includes("/academic-discussion")) 
    return "discussion";
  if (path.includes("/full-mock-test")) 
    return "mock";

  return "home";
}

function PastExamPage({

  items,

  practicedIds,
  isLoading,
  message,
  onBackHome,
  onStart,

}: {

  items: QuestionSet[];
  practicedIds: string[];
  isLoading: boolean;
  message: string;
  onBackHome: () => void;
  onStart: (id: string) => void;

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

        <h1 style={{ marginTop: 0 }}>TOEFL Past Exam</h1>

        <p style={{ color: "#64748b", lineHeight: 1.8 }}>

          toefl改革真题

        </p>

      </section>

      {isLoading && <p style={{ color: "#64748b" }}>Loading question sets...</p>}

      {message && <p style={{ color: "#be123c", fontWeight: 700 }}>{message}</p>}

      {!isLoading && items.length === 0 && (
        <p style={{ color: "#64748b" }}>No question sets available yet.</p>
      )}


      <div style={{ display: "grid", gap: "12px" }}>

        {items.map((item) => {

          const practiced = practicedIds.includes(item.id);

          return (

            <div

              key={item.id}

              style={{

                display: "grid",

                gridTemplateColumns: "1.2fr 1fr auto",

                gap: "16px",

                alignItems: "center",

                background: "#f8fafc",

                border: "1px solid #e2e8f0",

                borderRadius: "18px",

                padding: "18px 20px",

              }}

            >

              <div>

                <strong>{item.display_date || 'No date'}</strong>

                <p style={{ color: "#64748b", marginBottom: 0 }}>

                  {item.title}

                </p>

              </div>

              <span

                style={{

                  color: practiced ? "#166534" : "#64748b",

                  fontWeight: 800,

                }}

              >

                {practiced ? "已练习" : "未练习"}

              </span>

              <button

                type="button"

                onClick={() => onStart(item.id)}

                style={{

                  padding: "10px 16px",

                  border: "none",

                  borderRadius: "12px",

                  background: "#111827",

                  color: "white",

                  fontWeight: 800,

                  cursor: "pointer",

                }}

              >

                {practiced ? "再次练习" : "开始练习"}

              </button>

            </div>

          );

        })}

      </div>

    </>

  );

}

function EtsMockPracticePage({

  items,

  practicedIds,
  isLoading,
  message,
  onBackHome,

  onStart,

}: {

  items: QuestionSet[];
  practicedIds: string[];
  isLoading: boolean;
  message: string,
  onBackHome: () => void;

  onStart: (id: string) => void;

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

        <h1 style={{ marginTop: 0 }}>ETS Mock Practice</h1>

        <p style={{ color: "#64748b", lineHeight: 1.8 }}>

          ETS 风格模拟真题练习，共 20 套。练习记录将保存在本页面下。

        </p>

      </section>

        {isLoading && <p style={{ color: "#64748b" }}>Loading question sets...</p>}

        {message && <p style={{ color: "#be123c", fontWeight: 700 }}>{message}</p>}

        {!isLoading && items.length === 0 && (

          <p style={{ color: "#64748b" }}>No mock practice sets available yet.</p>

        )}

      <div style={{ display: "grid", gap: "12px" }}>

        {items.map((item) => {

          const practiced = practicedIds.includes(item.id);

          return (

            <div

              key={item.id}

              style={{

                display: "grid",

                gridTemplateColumns: "1.2fr 1fr auto",

                gap: "16px",

                alignItems: "center",

                background: "#f8fafc",

                border: "1px solid #e2e8f0",

                borderRadius: "18px",

                padding: "18px 20px",

              }}

            >

              <strong>{item.title}</strong>

              <span

                style={{

                  color: practiced ? "#166534" : "#64748b",

                  fontWeight: 800,

                }}

              >

                {practiced ? "已练习" : "未练习"}

              </span>

              <button

                type="button"

                onClick={() => onStart(item.id)}

                style={{

                  padding: "10px 16px",

                  border: "none",

                  borderRadius: "12px",

                  background: "#111827",

                  color: "white",

                  fontWeight: 800,

                  cursor: "pointer",

                }}

              >

                {practiced ? "再次练习" : "开始练习"}

              </button>

            </div>

          );

        })}

      </div>

    </>

  );

}

function PastExamDetailPage({
  examId,
  examSet,
  onBack,
}: {
  examId: string;
  examSet: QuestionSet | null;
  onBack: () => void;
}) {

  return (
    <>
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
        返回真题列表
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
          {examSet?.title || "TOEFL Past Exam"}
        </h1>

        <p style={{ color: "#64748b", lineHeight: 1.8 }}>
          当前真题 ID：{examId}
        </p>

        <p style={{ color: "#64748b", lineHeight: 1.8 }}>
          日期：{examSet?.display_date || "No date"}
        </p>
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
    </>
  );
}

function EtsMockDetailPage({
  mockId,
  mockSet,
  message,
  onStart,
  onBack,
}: {
  mockId: string;
  mockSet: QuestionSet | null;
  message: string;
  onStart: () => void;
  onBack: () => void;
}) {


  return (
    <>
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
        返回模拟真题列表
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
          {mockSet?.title || `Mock Test ${mockId}`}
        </h1>

        <p style={{ color: "#64748b", lineHeight: 1.8 }}>
          当前模拟真题 ID：{mockId}
        </p>

        <p style={{ color: "#64748b", lineHeight: 1.8 }}>
          Mock Number：{mockSet?.mock_number || mockId}
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

       <QuestionSetContentPreview content={mockSet?.content || {}} />
      </section>
    </>
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
                    <p style={{ lineHeight: 1.7, margin: 0 }}>
                      {question.answerSpeaker}: {question.target}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          );
        }

        if (task.type === "email") {
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

              <p style={{ color: "#312e81", fontWeight: 700 }}>
                {task.prompt.question}
              </p>
            </section>
          );
        }

        return null;
      })}
    </div>
  );
}

export default App;