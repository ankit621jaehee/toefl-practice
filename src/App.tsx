import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

type Page =
  | "home"
  | "sentence"
  | "email"
  | "discussion"
  | "records"
  | "record-detail";

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
  const [selectedRecord, setSelectedRecord] = useState<PracticeRecord | null>(
  null
);
  const [showPointsModal, setShowPointsModal] = useState(false);


  const [page, setPage] = useState<Page>("home");

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
            />


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
      description: "适合轻量体验 Email / Discussion 批改功能。",
    },
    {
      name: "练习套餐",
      points: 60,
      description: "适合一段时间内稳定进行写作练习。",
    },
    {
      name: "强化套餐",
      points: 150,
      description: "适合高频练习和集中备考阶段使用。",
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
          请联系客服进行选购。客服会根据你选择的 points 套餐提供兑换码。
        </p>

        <div style={{ display: "grid", gap: "12px", marginBottom: "24px" }}>
          {packages.map((item) => (
            <div
              key={item.name}
              style={{
                padding: "18px",
                border: "1px solid #e2e8f0",
                borderRadius: "18px",
                background: "#f8fafc",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "12px",
                  alignItems: "center",
                  marginBottom: "8px",
                }}
              >
                <strong style={{ fontSize: "17px" }}>{item.name}</strong>
                <strong>{item.points} points</strong>
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
            扫码联系客服
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

export default App;