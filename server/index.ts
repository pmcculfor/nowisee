/**
 * Production entry: serve the SPA from dist/ and /api on one origin.
 *
 *   npm run build && npm start
 *
 * Environment:
 *   PORT              listen port (default 3000)
 *   NOWISEE_DB        SQLite file path (default data/nowisee.db)
 *   NOWISEE_ORIGIN    public origin for CSRF, e.g. https://example.com
 *   NOWISEE_TLS_CERT  optional PEM path; with NOWISEE_TLS_KEY enables HTTPS
 *   NOWISEE_TLS_KEY   optional PEM path
 */

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync, existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { createNowiseeHost } from "./host.ts";
import { handleSessionHttp, isAppApiUrl } from "./http.ts";
import { SCRYPT_PRODUCTION } from "./identity/hash.ts";
import { BodyTooLargeError, readLimitedBody } from "./readBody.ts";

const DIST = resolve(process.cwd(), "dist");
const PORT = Number(process.env.PORT ?? "3000");
const DB_PATH = process.env.NOWISEE_DB ?? "data/nowisee.db";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

const host = createNowiseeHost({
  db: DB_PATH,
  scrypt: SCRYPT_PRODUCTION,
  configuredOrigin: process.env.NOWISEE_ORIGIN,
});

async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? "/";
  if (isAppApiUrl(url)) {
    await handleApi(req, res);
    return;
  }
  await serveStatic(url, res);
}

async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const raw = req.method === "POST" ? await readLimitedBody(req) : "";
    let body: unknown;
    if (raw.length > 0) {
      body = JSON.parse(raw) as unknown;
    }
    const out = await handleSessionHttp(host, {
      method: req.method ?? "GET",
      url: req.url ?? "/",
      headers: req.headers,
      body,
      encrypted: Boolean((req.socket as { encrypted?: boolean }).encrypted),
    });
    const json = JSON.stringify(out.body);
    res.statusCode = out.status;
    for (const [key, value] of Object.entries(out.headers ?? {})) {
      res.setHeader(key, value);
    }
    if (!res.getHeader("Content-Type")) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
    }
    res.setHeader("Content-Length", Buffer.byteLength(json));
    res.end(json);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      writeError(res, 413, "Request body too large");
      return;
    }
    writeError(res, 400, "Invalid JSON");
  }
}

async function serveStatic(url: string, res: ServerResponse): Promise<void> {
  const pathOnly = decodeURIComponent((url.split("?")[0] ?? "/"));
  const relative = pathOnly === "/" ? "index.html" : pathOnly.replace(/^\/+/, "");
  const resolved = resolve(DIST, normalize(relative));
  if (!(resolved === DIST || resolved.startsWith(DIST + sep))) {
    writeError(res, 403, "Forbidden");
    return;
  }
  try {
    const info = await stat(resolved);
    const file = info.isDirectory() ? join(resolved, "index.html") : resolved;
    const data = await readFile(file);
    const type = MIME[extname(file)] ?? "application/octet-stream";
    res.statusCode = 200;
    res.setHeader("Content-Type", type);
    res.setHeader("Content-Length", data.byteLength);
    res.end(data);
  } catch {
    writeError(res, 404, "Not found");
  }
}

function writeError(res: ServerResponse, status: number, message: string): void {
  const json = JSON.stringify({ error: message });
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Length", Buffer.byteLength(json));
  res.end(json);
}

const certPath = process.env.NOWISEE_TLS_CERT;
const keyPath = process.env.NOWISEE_TLS_KEY;
const useTls = Boolean(certPath && keyPath && existsSync(certPath) && existsSync(keyPath));

const server = useTls
  ? createHttpsServer(
      { cert: readFileSync(certPath!), key: readFileSync(keyPath!) },
      (req, res) => {
        void handler(req, res);
      },
    )
  : createHttpServer((req, res) => {
      void handler(req, res);
    });

server.listen(PORT, () => {
  const scheme = useTls ? "https" : "http";
  console.log(`Nowisee listening on ${scheme}://localhost:${PORT}`);
});
