import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

const root = resolve(".");
const port = 5173;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

createServer(async (request, response) => {
  try {
    let requestPath = decodeURIComponent(request.url.split("?")[0]);
    if (requestPath === "/") requestPath = "/index.html";

    const filePath = resolve(root, requestPath.replace(/^\/+/, ""));
    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end();
      return;
    }

    const body = await readFile(filePath);
    response.writeHead(200, { "Content-Type": types[extname(filePath)] || "text/plain; charset=utf-8" });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Gomoku Poker: http://127.0.0.1:${port}`);
});
