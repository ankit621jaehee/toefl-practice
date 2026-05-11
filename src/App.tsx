import { useMemo, useState } from "react";

type Chunk = {

  id: string;

  text: string;

};

type Question = {

  id: number;

  contextSpeaker: string;

  contextSentence: string;

  answerSpeaker: string;

  answerPrefix: string;

  answerSuffix: string;

  target: string;

  chunks: string[];

  explanation: string;

};

const fallbackQuestions: Question[] = [

  {

    id: 1,

    contextSpeaker: "A",

    contextSentence: "What was the highlight of your trip?",

    answerSpeaker: "B",

    answerPrefix: "The",

    answerSuffix: "fantastic.",

    target: "The tour guides who showed us around the old city were fantastic.",

    chunks: ["tour guides", "who", "showed us around", "the", "old city", "were"],

    explanation:

      "A 问旅行中最精彩的部分，B 用 The tour guides 作主语，who showed us around the old city 是定语从句，were fantastic 是谓语和表语。",

  },

  {

    id: 2,

    contextSpeaker: "A",

    contextSentence: "Why did the student visit the writing center?",

    answerSpeaker: "B",

    answerPrefix: "She",

    answerSuffix: "before submitting it.",

    target: "She wanted a tutor to review her research paper before submitting it.",

    chunks: ["wanted", "a tutor", "to review", "her", "research paper"],

    explanation:

      "A 问原因，B 回答目的。wanted a tutor to review... 是 wanted + 宾语 + to do 结构。",

  },

  {

    id: 3,

    contextSpeaker: "A",

    contextSentence:

      "The research team collected far more data than they expected.",

    answerSpeaker: "B",

    answerPrefix: "Could",

    answerSuffix: "more quickly?",

    target:

      "Could artificial intelligence help researchers analyze the data more quickly?",

    chunks: ["artificial intelligence", "help", "researchers", "analyze", "the data"],

    explanation:

      "A 是陈述句，B 是自然追问。Could + 主语 + 动词原形构成一般疑问句。",

  },

  {

    id: 4,

    contextSpeaker: "A",

    contextSentence:

      "The city expanded its public transportation system to reduce pollution.",

    answerSpeaker: "B",

    answerPrefix: "However,",

    answerSuffix: "driving.",

    target: "However, many people still prefer driving.",

    chunks: ["many people", "still", "prefer"],

    explanation:

      "A 说明城市扩建公共交通，B 用 however 转折，说明很多人仍然更喜欢开车。",

  },

  {

    id: 5,

    contextSpeaker: "A",

    contextSentence: "What can students do if they feel overwhelmed?",

    answerSpeaker: "B",

    answerPrefix: "Regular exercise",

    answerSuffix: "sleep quality.",

    target:

      "Regular exercise not only reduces stress but also improves sleep quality.",

    chunks: ["not only", "reduces", "stress", "but also", "improves"],

    explanation:

      "A 问学生压力大时可以做什么，B 给出建议。not only...but also... 连接两个并列谓语。",

  },

];

function shuffle<T>(list: T[]) {

  return [...list].sort(() => Math.random() - 0.5);

}

function makeChunks(question: Question) {

  return question.chunks.map((text, index) => ({

    id: `${question.id}-${index}-${text}`,

    text,

  }));

}

function makeEmptySlots(question: Question) {

  return Array(question.chunks.length).fill(null) as (Chunk | null)[];

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

function normalizeQuestions(apiQuestions: Question[]) {

  return apiQuestions.map((question, index) => {

    return {

      id: index + 1,

      contextSpeaker: question.contextSpeaker || "A",

      contextSentence:

        question.contextSentence || "What was the main point of the conversation?",

      answerSpeaker: question.answerSpeaker || "B",

      answerPrefix: question.answerPrefix || "",

      answerSuffix: question.answerSuffix || "",

      target: question.target || "",

      chunks: Array.isArray(question.chunks) ? question.chunks : [],

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

function isQuestionComplete(slots: (Chunk | null)[]) {

  return slots.every((slot) => slot !== null);

}

function isQuestionCorrect(question: Question, slots: (Chunk | null)[]) {

  return slots.every((slot, index) => slot?.text === question.chunks[index]);

}

export default function App() {

  const [page, setPage] = useState<"home" | "practice">("home");

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

  const currentQuestion = questions[currentIndex];

  const currentSlots = slotsByQuestion[currentQuestion.id] || [];

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

  const currentQuestionCorrect =

    isSubmitted && currentQuestionScore === 0.5;

  function updateCurrentSlots(newSlots: (Chunk | null)[]) {

    setSlotsByQuestion({

      ...slotsByQuestion,

      [currentQuestion.id]: newSlots,

    });

  }

  function placeChunk(chunk: Chunk, slotIndex: number) {

    if (isSubmitted) return;

    const newSlots = [...currentSlots];

    const oldChunk = newSlots[slotIndex];

    newSlots[slotIndex] = chunk;

    if (oldChunk) {

      // 被替换的词会自动回到词库，因为 currentBank 是根据 slots 动态计算的

    }

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

      setApiMessage("已成功由Gemini生成新题组。");

      setPage("practice");

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

        "API 暂时不可用，已使用本地示例题。部署到 Vercel 并配置 API Key 后即可自动生成。"

      );

      setPage("practice");

    } finally {

      setIsLoading(false);

    }

  }

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

          TOEFL Build a Sentence

        </h1>

        {page === "home" && (

          <>

            <p style={{ color: "#64748b", marginBottom: "30px" }}>

              选择题量、难度和主题，然后开始一组 TOEFL Build a Sentence

              对话补全练习。每题 0.5 分，错一空即为 0。

            </p>

            <div

              style={{

                display: "flex",

                flexWrap: "wrap",

                gap: "12px",

                marginBottom: "24px",

              }}

            >

              <select

                value={questionCount}

                onChange={(e) => setQuestionCount(Number(e.target.value))}

                disabled={isLoading}

                style={{

                  padding: "12px 16px",

                  border: "1px solid #cbd5e1",

                  borderRadius: "12px",

                  background: "white",

                  fontWeight: 700,

                }}

              >

                <option value={5}>5题</option>

                <option value={10}>10题</option>

              </select>

              <select

                value={level}

                onChange={(e) => setLevel(e.target.value)}

                disabled={isLoading}

                style={{

                  padding: "12px 16px",

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

                disabled={isLoading}

                style={{

                  padding: "12px 16px",

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

              <button

                onClick={startNewPractice}

                disabled={isLoading}

                style={{

                  padding: "12px 24px",

                  border: "none",

                  borderRadius: "12px",

                  background: isLoading ? "#cbd5e1" : "#111827",

                  color: "white",

                  fontWeight: 700,

                  cursor: isLoading ? "not-allowed" : "pointer",

                }}

              >

                {isLoading ? "正在生成..." : "开始练习"}

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

          </>

        )}

        {page === "practice" && (

          <>

            <p style={{ color: "#64748b", marginBottom: "24px" }}>

              A/B 对话补全。把词块拖到 B 句横线上。全部题目完成后统一批改。

              每题 0.5 分，错一空即为 0。

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

            <div

              style={{

                display: "flex",

                gap: "8px",

                marginBottom: "28px",

              }}

            >

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

                <span>{currentQuestion.answerPrefix}</span>

                {currentSlots.map((slot, index) => {

                  const slotIsWrong =

                    isSubmitted && slot?.text !== currentQuestion.chunks[index];

                  return (

                    <button

                      key={index}

                      onClick={() => removeChunk(index)}

                      onDragOver={(e) => e.preventDefault()}

                      onDrop={() => {

                        if (dragged) {

                          placeChunk(dragged, index);

                          setDragged(null);

                        }

                      }}

                      style={{

                        minWidth: "150px",

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

                })}

                <span>{currentQuestion.answerSuffix}</span>

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

                onClick={() => setPage("home")}

                style={{

                  padding: "12px 20px",

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

                    currentIndex === questions.length - 1

                      ? "not-allowed"

                      : "pointer",

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

                {currentQuestion.answerSpeaker}: {currentQuestion.target}

                <br />

                <br />

                <strong>解析：</strong>

                {currentQuestion.explanation}

              </div>

            )}

          </>

        )}

      </div>

    </div>

  );

}