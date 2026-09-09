const handlers = {
  "credits": () => import("../../api/credits.js"),
  "delete-record": () => import("../../api/delete-record.js"),
  "generate-academic-discussion": () =>
    import("../../lib/generate-academic-discussion-handler.js"),
  "generate-email-prompt": () =>
    import("../../lib/generate-email-prompt-handler.js"),
  "generate-sentences": () => import("../../api/generate-sentences.js"),
  "personalized-practice": () =>
    import("../../lib/personalized-practice-handler.js"),
  "question-sets": () => import("../../api/question-sets.js"),
  "redeem-code": () => import("../../api/redeem-code.js"),
  "save-sentence-record": () => import("../../api/save-sentence-record.js"),
  "score-academic-discussion": () =>
    import("../../lib/score-academic-discussion-handler.js"),
  "score-email-writing": () =>
    import("../../lib/score-email-writing-handler.js"),
  "start-mock-test": () => import("../../api/start-mock-test.js"),
  "submit-mock-test": () => import("../../api/submit-mock-test.js"),
  "support-ticket": () => import("../../api/support-ticket.js"),
  "support-admin": () => import("../../api/support-admin.js"),
};

const aiRoutes = new Set([
  "generate-academic-discussion",
  "generate-email-prompt",
  "generate-sentences",
  "score-academic-discussion",
  "score-email-writing",
  "start-mock-test",
  "submit-mock-test",
]);

function getChineseAiError(route, status, upstreamMessage = "") {
  const message = String(upstreamMessage || "");

  if (/location is not supported|failed_precondition/i.test(message)) {
    return "AI 服务暂时无法在当前服务器区域使用，请稍后重试。";
  }

  if (status === 401 || /sign in|unauthorized/i.test(message)) {
    return "请先登录后再使用 AI 功能。";
  }

  if (status === 402 || /not enough (points|credits)/i.test(message)) {
    return "积分不足，请兑换积分后再试。";
  }

  if (status === 429 || /quota|rate limit|resource_exhausted/i.test(message)) {
    return "AI 服务当前请求较多，请稍后再试。";
  }

  if (/invalid json|unexpected end|incomplete/i.test(message)) {
    return "AI 返回的内容不完整，请重新生成。";
  }

  if (route.startsWith("score-") || route === "submit-mock-test") {
    return "AI 批改暂时失败，请稍后重试。";
  }

  return "AI 题目生成暂时失败，请稍后重试。";
}

async function proxyAiRequest(context, route) {
  const origin = String(context.env.VERCEL_AI_ORIGIN || "").replace(/\/$/, "");

  if (!origin) {
    return Response.json(
      { error: "AI 服务尚未完成配置，请联系管理员。" },
      { status: 503 }
    );
  }

  const incomingUrl = new URL(context.request.url);
  const upstreamUrl = `${origin}/api/${encodeURIComponent(route)}${incomingUrl.search}`;
  const headers = new Headers(context.request.headers);
  headers.delete("host");
  headers.delete("cf-connecting-ip");
  headers.delete("cf-ipcountry");
  headers.delete("cf-ray");
  headers.delete("cf-visitor");

  let upstreamResponse;

  try {
    upstreamResponse = await fetch(
      new Request(upstreamUrl, {
        method: context.request.method,
        headers,
        body:
          context.request.method === "GET" || context.request.method === "HEAD"
            ? undefined
            : context.request.body,
        redirect: "manual",
      })
    );
  } catch (error) {
    console.error("AI proxy request failed", {
      route,
      message: error instanceof Error ? error.message : String(error),
    });

    return Response.json(
      { error: "AI 服务连接失败，请检查网络后稍后重试。" },
      { status: 502 }
    );
  }

  if (upstreamResponse.ok) {
    return upstreamResponse;
  }

  const contentType = upstreamResponse.headers.get("content-type") || "";
  let upstreamMessage = "";

  if (contentType.includes("application/json")) {
    const payload = await upstreamResponse.clone().json().catch(() => null);
    upstreamMessage = payload?.error || payload?.message || "";
  } else {
    upstreamMessage = await upstreamResponse.clone().text().catch(() => "");
  }

  console.error("AI upstream request failed", {
    route,
    status: upstreamResponse.status,
    message: upstreamMessage.slice(0, 300),
  });

  return Response.json(
    {
      error: getChineseAiError(route, upstreamResponse.status, upstreamMessage),
    },
    { status: upstreamResponse.status }
  );
}

function createHeaderObject(headers) {
  const result = {};

  for (const [key, value] of headers.entries()) {
    result[key.toLowerCase()] = value;
  }

  return result;
}

async function createRequestShim(request) {
  const contentType = request.headers.get("content-type") || "";
  let body = {};

  if (request.method !== "GET" && request.method !== "HEAD") {
    if (contentType.includes("application/json")) {
      body = await request.json().catch(() => ({}));
    } else {
      body = await request.text();
    }
  }

  return {
    method: request.method,
    headers: createHeaderObject(request.headers),
    body,
    query: Object.fromEntries(new URL(request.url).searchParams.entries()),
  };
}

function createResponseShim() {
  let statusCode = 200;
  const headers = new Headers();

  return {
    status(code) {
      statusCode = code;
      return this;
    },
    setHeader(name, value) {
      headers.set(name, value);
      return this;
    },
    json(data) {
      headers.set("content-type", "application/json; charset=utf-8");
      return new Response(JSON.stringify(data), { status: statusCode, headers });
    },
    send(data) {
      return new Response(data, { status: statusCode, headers });
    },
    end(data = "") {
      return new Response(data, { status: statusCode, headers });
    },
  };
}

export async function onRequest(context) {
  const route = Array.isArray(context.params.path)
    ? context.params.path[0]
    : context.params.path;
  const loadHandler = handlers[route];

  if (!loadHandler) {
    return Response.json({ error: "未找到该接口。" }, { status: 404 });
  }

  if (aiRoutes.has(route)) {
    return proxyAiRequest(context, route);
  }

  globalThis.process = {
    ...(globalThis.process || {}),
    env: {
      ...((globalThis.process && globalThis.process.env) || {}),
      ...context.env,
    },
  };

  const { default: handler } = await loadHandler();

  if (typeof handler !== "function") {
    return Response.json({ error: "接口暂时不可用，请稍后重试。" }, { status: 500 });
  }

  const req = await createRequestShim(context.request);
  const res = createResponseShim();

  return handler(req, res);
}
