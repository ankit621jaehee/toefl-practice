import { mkdir, writeFile } from "node:fs/promises";

const workerSource = `export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);

    if (response.status !== 404) {
      return response;
    }

    const url = new URL(request.url);
    const accept = request.headers.get("accept") || "";

    if (request.method === "GET" && !url.pathname.includes(".") && accept.includes("text/html")) {
      return env.ASSETS.fetch(new Request(new URL("/", url), request));
    }

    return response;
  }
};
`;

await mkdir("dist/server", { recursive: true });
await writeFile("dist/server/index.js", workerSource);
