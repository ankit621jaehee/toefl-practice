from pathlib import Path
import re

app_path = Path("src/App.tsx")
app = app_path.read_text()

new_score_discussion = r'''async function scoreAcademicDiscussionWithAPI(prompt: unknown, answer: string) {
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
}'''

app = re.sub(
    r"async function scoreAcademicDiscussionWithAPI\(prompt: unknown, answer: string\) \{[\s\S]*?\n\}\n\nfunction isQuestionComplete",
    new_score_discussion + "\n\nfunction isQuestionComplete",
    app,
)

new_submit_discussion = r'''async function submitDiscussionWriting() {
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
  }'''

app = re.sub(
    r"async function submitDiscussionWriting\(\) \{[\s\S]*?\n  \}\n\n  const cardStyle",
    new_submit_discussion + "\n\n  const cardStyle",
    app,
)

app = app.replace(
    """          grammarCorrections={feedback.grammarCorrections}
          improvedVersion={feedback.improvedVersion}""",
    """          grammarCorrections={feedback.grammarCorrections}
          actionPlan={feedback.actionPlan}
          improvedVersion={feedback.improvedVersion}""",
)

new_feedback_box = r'''function FeedbackBox({
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
}'''

app = re.sub(
    r"function FeedbackBox\(\{[\s\S]*?\n\}\n\nfunction AuthPanel",
    new_feedback_box + "\n\nfunction AuthPanel",
    app,
)

app_path.write_text(app)

backend = r'''import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";

const DISCUSSION_SCORE_COST = 3;

function createAdminClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("Missing SUPABASE_URL");
  }

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization || "";

  if (!authHeader.startsWith("Bearer ")) {
    return "";
  }

  return authHeader.replace("Bearer ", "").trim();
}

function countWords(text) {
  return String(text || "").trim()
    ? String(text || "").trim().split(/\s+/).length
    : 0;
}

function clampScore(score) {
  const number = Number(score);

  if (Number.isNaN(number)) return 0;

  return Math.max(0, Math.min(5, number));
}

function roundToOneDecimal(score) {
  return Math.round(score * 10) / 10;
}

function formatScore(score) {
  return `${roundToOneDecimal(score).toFixed(1)} / 5.0`;
}

function applyMinimumLengthCap(score, wordCount) {
  let finalScore = score;

  if (wordCount < 5) {
    finalScore = Math.min(finalScore, 0.5);
  } else if (wordCount < 10) {
    finalScore = Math.min(finalScore, 1.0);
  } else if (wordCount < 30) {
    finalScore = Math.min(finalScore, 2.0);
  } else if (wordCount < 60) {
    finalScore = Math.min(finalScore, 3.0);
  } else if (wordCount < 80) {
    finalScore = Math.min(finalScore, 3.5);
  } else if (wordCount < 100) {
    finalScore = Math.min(finalScore, 4.0);
  }

  return finalScore;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Gemini returned invalid JSON: ${text.slice(0, 300)}`);
  }
}

function calculateDiscussionScore(json, wordCount) {
  const opinionScore = clampScore(json.opinionScore);
  const developmentScore = clampScore(json.developmentScore);
  const languageScore = clampScore(json.languageScore);
  const naturalnessScore = clampScore(json.naturalnessScore);

  let score =
    opinionScore * 0.35 +
    developmentScore * 0.3 +
    languageScore * 0.25 +
    naturalnessScore * 0.1;

  score = applyMinimumLengthCap(score, wordCount);

  return formatScore(score);
}

async function getUserFromToken(supabaseAdmin, token) {
  if (!token) return null;

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) return null;

  return user;
}

async function getUserProfile(supabaseAdmin, userId) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("points")
    .eq("id", userId)
    .single();

  if (error || !data) {
    throw new Error("User profile not found.");
  }

  return data;
}

async function deductPoints(supabaseAdmin, userId, currentPoints, cost) {
  const newBalance = currentPoints - cost;

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({
      points: newBalance,
    })
    .eq("id", userId);

  if (error) {
    throw error;
  }

  return newBalance;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  try {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("Missing GEMINI_API_KEY environment variable");
    }

    const supabaseAdmin = createAdminClient();
    const token = getBearerToken(req);
    const user = await getUserFromToken(supabaseAdmin, token);

    if (!user) {
      return res.status(401).json({
        error: "Please sign in before using AI scoring.",
      });
    }

    const profile = await getUserProfile(supabaseAdmin, user.id);

    if (profile.points < DISCUSSION_SCORE_COST) {
      return res.status(402).json({
        error: `Not enough points. Academic Discussion scoring costs ${DISCUSSION_SCORE_COST} points.`,
        balance: profile.points,
        cost: DISCUSSION_SCORE_COST,
      });
    }

    const { prompt, answer } = req.body || {};

    if (!prompt || !answer) {
      return res.status(400).json({
        error: "Missing prompt or answer",
      });
    }

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    const wordCount = countWords(answer);

    const scoringPrompt = `
You are a strict but fair TOEFL Academic Discussion evaluator.

Evaluate the student's academic discussion response.

Important scoring principle:
Do not over-focus on word count once the response reaches around 100 words.
Word count is mainly used to identify clearly incomplete responses.
A response with 100+ words should be scored mainly based on opinion, contribution, development, organization, language, and naturalness.

Student word count: ${wordCount}

Score each dimension from 0.0 to 5.0 using one decimal place.

Dimension 1: opinionScore
- Does the student clearly answer the professor's question?
- Is there a clear opinion or position?
- Does the response stay on topic?

Dimension 2: developmentScore
- Does the student give reasons, explanations, or examples?
- Does the response contribute something new to the discussion?
- Does it connect to or respond to the classmates' ideas when useful?

Dimension 3: languageScore
- Grammar accuracy.
- Vocabulary.
- Sentence control.
- Clarity.

Dimension 4: naturalnessScore
- Academic discussion style.
- Naturalness.
- Logical flow.

Minimum length rules:
- If fewer than 5 words, all dimension scores should be very low.
- If 5 to 9 words, the response is extremely incomplete.
- If 10 to 29 words, the response is clearly incomplete.
- If 30 to 59 words, the response may be partially complete but underdeveloped.
- If 60 to 99 words, the response can be acceptable but probably lacks development.
- If 100 words or more, do not penalize mainly for length.

Be consistent:
Use the same standards every time.
Do not give a high score to a very short response just because it has few grammar mistakes.
Do not be overly harsh on a complete 100+ word response only because it is not very long.
A strong response should express an opinion and support it.

Feedback quality rules:
1. Do not give generic comments like "good job" or "improve grammar" unless you explain exactly why.
2. Every strength should mention a specific feature of the student's response.
3. Every problem should identify a specific weakness and explain how it affects the score.
4. Grammar corrections should only include real issues from the student's response.
5. If the student's response has few grammar errors, focus on style, clarity, development, and naturalness instead.
6. The improvedVersion should preserve the student's original meaning and improve it, not replace it with a completely unrelated model answer.
7. The sampleAnswer should be a separate high-scoring answer for the prompt.
8. The actionPlan should give 3 short, practical steps for improving the next response.
9. Use clear and direct language suitable for a TOEFL learner.

Academic discussion prompt:
${JSON.stringify(prompt)}

Student response:
${answer}

Return valid JSON only. No markdown.

Return this exact JSON structure:
{
  "opinionScore": 4.0,
  "developmentScore": 4.0,
  "languageScore": 4.0,
  "naturalnessScore": 4.0,
  "strengths": [
    "Specific strength based on the student's response.",
    "Specific strength based on the student's response.",
    "Specific strength based on the student's response."
  ],
  "problems": [
    "Specific problem and why it matters.",
    "Specific problem and why it matters.",
    "Specific problem and why it matters."
  ],
  "grammarCorrections": [
    {
      "original": "student's original phrase or sentence",
      "corrected": "corrected phrase or sentence",
      "explanation": "brief explanation"
    }
  ],
  "actionPlan": [
    "Start with a clear opinion in the first sentence.",
    "Develop one reason with a concrete example.",
    "Connect your idea to one classmate's post when possible."
  ],
  "improvedVersion": "A polished version that preserves the student's original meaning.",
  "sampleAnswer": "A separate strong sample academic discussion response for this prompt."
}
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: scoringPrompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    });

    const text = response.text || "";

    if (!text.trim()) {
      throw new Error("Gemini returned empty response");
    }

    const json = safeJsonParse(text);
    const finalScore = calculateDiscussionScore(json, wordCount);

    const newBalance = await deductPoints(
      supabaseAdmin,
      user.id,
      profile.points,
      DISCUSSION_SCORE_COST
    );

    return res.status(200).json({
      score: finalScore,
      strengths: normalizeArray(json.strengths),
      problems: normalizeArray(json.problems),
      grammarCorrections: normalizeArray(json.grammarCorrections),
      actionPlan: normalizeArray(json.actionPlan),
      improvedVersion: json.improvedVersion || "",
      sampleAnswer: json.sampleAnswer || "",
      cost: DISCUSSION_SCORE_COST,
      balance: newBalance,
    });
  } catch (error) {
    console.error("Academic discussion scoring error:", error);

    const message = error?.message || String(error);

    if (message.includes("429") || message.toLowerCase().includes("quota")) {
      return res.status(429).json({
        error: "AI scoring quota exceeded. Please try again later.",
        details: message,
      });
    }

    return res.status(500).json({
      error: error?.message || "Failed to score academic discussion",
      details: String(error),
    });
  }
}
'''

Path("api/score-academic-discussion.js").write_text(backend)

print("Patched src/App.tsx and api/score-academic-discussion.js")
