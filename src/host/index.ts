/**
 * Production entry: serve the SPA from dist/ and /api on one origin.
 *
 *   npm run build && npm start
 *
 * Nowisee runs only on a server. There are no local-machine defaults: every
 * value below is read from the environment, and a missing one fails the boot.
 *
 * Environment (required):
 *   PORT                         listen port
 *   NOWISEE_DB                   host identity SQLite file
 *   NOWISEE_ORIGIN               public origin for CSRF, e.g. https://nowisee.app
 *   NOWISEE_MAIL_FROM            From: header for Resend
 *   NOWISEE_RESEND_API_KEY       Resend API key
 *   NOWISEE_OTP_PEPPER           32-byte HMAC key, base64
 *   NOWISEE_HOST_SIGNING_KEY     Ed25519 PKCS8 DER, base64
 *   NOWISEE_CAPABILITY_LISTEN    loopback host:port for capability RPCs
 *
 * Environment (required when lockbox / OAuth apps are granted):
 *   NOWISEE_LOCKBOX_KEY          32-byte AES key, base64
 *   NOWISEE_LOCKBOX_KEY_ID       key id for the key above
 *
 * Environment (optional):
 *   NOWISEE_OAUTH_<APP>_CLIENT_ID / _CLIENT_SECRET  OAuth app credentials (not lockbox)
 *   NOWISEE_ADMIN_EMAILS         comma-separated emails allowed to open /admin
 *   NOWISEE_TLS_CERT             optional PEM path; with NOWISEE_TLS_KEY enables HTTPS
 *   NOWISEE_TLS_KEY              optional PEM path
 *   NOWISEE_IOS_TEAM_ID          Apple Team ID for apple-app-site-association (Gmail Connect)
 */

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync, existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createNowiseeHost } from "./host.ts";
import { handleSessionHttp, isAppApiUrl } from "./http.ts";
import { handleOAuthHttp, isOAuthUrl } from "./oauth/http.ts";
import { handleAdminHttp, isAdminUrl } from "./admin/http.ts";
import { adminEmailsFromEnv } from "./admin/emails.ts";
import { BodyTooLargeError, MalformedJsonError, readJsonBody } from "./readBody.ts";
import { appleAppSiteAssociation, appleTeamId, pageFile, siteTarget } from "./site.ts";

const DIST = resolve(process.cwd(), "dist");

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const PORT = Number(required("PORT"));
if (!Number.isInteger(PORT) || PORT <= 0) {
  throw new Error("PORT must be a positive integer");
}
const DB_PATH = required("NOWISEE_DB");

const host = await createNowiseeHost({
  db: DB_PATH,
  ephemeral: false,
  configuredOrigin: required("NOWISEE_ORIGIN"),
  adminEmails: adminEmailsFromEnv(),
  capabilityListen: required("NOWISEE_CAPABILITY_LISTEN"),
  hostSigningKey: required("NOWISEE_HOST_SIGNING_KEY"),
});

async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? "/";
  if (isOAuthUrl(url)) {
    await handleOAuth(req, res);
    return;
  }
  if (isAdminUrl(url)) {
    await handleAdmin(req, res);
    return;
  }
  if (isAppApiUrl(url)) {
    await handleApi(req, res);
    return;
  }
  await serveSite(req.method ?? "GET", url, res);
}

async function handleAdmin(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const out = await handleAdminHttp(host, {
      method: req.method ?? "GET",
      url: req.url ?? "/",
      headers: req.headers,
      body: await readJsonBody(req),
      remoteAddress: req.socket.remoteAddress,
    });
    writeHttp(res, out);
  } catch (err) {
    writeRequestFailure(res, err, "admin");
  }
}
async function handleOAuth(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const out = await handleOAuthHttp(host, {
      method: req.method ?? "GET",
      url: req.url ?? "/",
      headers: req.headers,
    });
    const body = typeof out.body === "string" ? out.body : "";
    res.statusCode = out.status;
    for (const [key, value] of Object.entries(out.headers ?? {})) {
      res.setHeader(key, value);
    }
    res.setHeader("Content-Length", Buffer.byteLength(body));
    res.end(body);
  } catch {
    writeRaw(res, 500, "");
  }
}

async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const out = await handleSessionHttp(host, {
      method: req.method ?? "GET",
      url: req.url ?? "/",
      headers: req.headers,
      body: await readJsonBody(req),
      remoteAddress: req.socket.remoteAddress,
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
    writeRequestFailure(res, err, "api");
  }
}

/**
 * A bad request is the client's fault and says so; anything else is ours and is
 * a 500 with a log line. Never report our own crash as `400 Invalid JSON`.
 */
function writeRequestFailure(res: ServerResponse, err: unknown, surface: string): void {
  if (err instanceof BodyTooLargeError) {
    writeError(res, 413, "Request body too large");
    return;
  }
  if (err instanceof MalformedJsonError) {
    writeError(res, 400, "Invalid JSON");
    return;
  }
  console.error(`${surface} request failed`, err);
  writeError(res, 500, "Internal error");
}

async function serveSite(method: string, url: string, res: ServerResponse): Promise<void> {
  if (method !== "GET" && method !== "HEAD") {
    writeError(res, 405, "Method not allowed");
    return;
  }
  const target = siteTarget(url, DIST);
  if (target.kind === "bad-request") {
    writeError(res, 400, "Bad request");
    return;
  }
  if (target.kind === "forbidden") {
    writeError(res, 403, "Forbidden");
    return;
  }
  if (target.kind === "not-found") {
    writeError(res, 404, "Not found");
    return;
  }
  if (target.kind === "association") {
    const teamId = appleTeamId(process.env.NOWISEE_IOS_TEAM_ID);
    if (!teamId) {
      writeError(res, 404, "Not found");
      return;
    }
    const body = appleAppSiteAssociation(teamId);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Length", Buffer.byteLength(body));
    if (method === "HEAD") {
      res.end();
      return;
    }
    res.end(body);
    return;
  }
  if (target.kind === "page") {
    await sendFile(res, pageFile(DIST), "text/html; charset=utf-8", method);
    return;
  }
  await sendFile(res, target.file, target.type, method);
}

async function sendFile(
  res: ServerResponse,
  file: string,
  type: string,
  method: string,
): Promise<void> {
  try {
    const info = await stat(file);
    if (info.isDirectory()) {
      writeError(res, 404, "Not found");
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", type);
    res.setHeader("Content-Length", info.size);
    if (method === "HEAD") {
      res.end();
      return;
    }
    res.end(await readFile(file));
  } catch {
    writeError(res, 404, "Not found");
  }
}

function writeHttp(
  res: ServerResponse,
  out: { status: number; body: unknown; headers?: Readonly<Record<string, string>> },
): void {
  const payload = typeof out.body === "string" ? out.body : JSON.stringify(out.body);
  res.statusCode = out.status;
  for (const [key, value] of Object.entries(out.headers ?? {})) {
    res.setHeader(key, value);
  }
  if (!res.getHeader("Content-Type")) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
  }
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.end(payload);
}

function writeRaw(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Length", Buffer.byteLength(message));
  res.end(message);
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
