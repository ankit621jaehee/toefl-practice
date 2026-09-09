export const GEMINI_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3-flash",
];

function isRetryableGeminiError(error) {
  const message = error?.message || String(error);

  return (
    message.includes("429") ||
    message.includes("503") ||
    message.includes("RESOURCE_EXHAUSTED") ||
    message.includes("UNAVAILABLE") ||
    message.toLowerCase().includes("quota") ||
    message.toLowerCase().includes("rate limit") ||
    message.toLowerCase().includes("high demand") ||
    message.toLowerCase().includes("temporarily unavailable")
  );
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function generateContentWithModelFallback(ai, options) {
  let lastError;

  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await ai.models.generateContent({
          ...options,
          model,
        });

        return {
          response,
          modelUsed: model,
        };
      } catch (error) {
        lastError = error;

        console.error(
          `Gemini model failed: ${model}, attempt ${attempt + 1}`,
          error
        );

        if (!isRetryableGeminiError(error)) {
          throw error;
        }

        await wait(900 * (attempt + 1));
      }
    }
  }

  throw lastError;
}