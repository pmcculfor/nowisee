import { parseListen, requiredEnv } from "./appEnv.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppModule, AppServerContext, RefreshExtras, WireExtras } from "../core/types.ts";
import {
  createIdentityClient,
  createLockboxClient,
  createOAuthClient,
} from "./capClient.ts";
import {
  verifyWireCtx,
  WIRE_API_VERSION,
  type WireAppBody,
  type WireCtx,
} from "./wireCtx.ts";
import { listenHttp, type ListeningServer } from "./listenHttp.ts";
import { BodyTooLargeError, MalformedJsonError, readJsonBody } from "./readBody.ts";

export type ServeAppOptions = {
  readonly listen: { host: string; port: number } | "ephemeral";
  readonly hostSigningPub: string;
  readonly capabilityUrl: string;
};

export type ServingApp = ListeningServer & {
  readonly app: AppModule;
};

/**
 * HTTP front for one AppModule. Verifies the host signature, hydrates ctx
 * (directory snapshot + capability HTTP wrappers), then calls open/refresh.
 */
export async function serveApp(app: AppModule, options: ServeAppOptions): Promise<ServingApp> {
  const server = await listenHttp((req, res) => handleAppHttp(app, options, req, res), options.listen);
  return { ...server, app };
}

/** Process entry: read listen/signing/cap env and serve until SIGTERM. */
export async function runAppMain(app: AppModule): Promise<void> {
  const serving = await serveApp(app, {
    listen: parseListen(requiredEnv("NOWISEE_LISTEN")),
    hostSigningPub: requiredEnv("NOWISEE_HOST_SIGNING_PUB"),
    capabilityUrl: requiredEnv("NOWISEE_HOST_CAPABILITY_URL"),
  });
  console.log(`${app.id} listening on ${serving.origin}`);
  const shutdown = () => {
    void serving.close().then(() => {
      if ("close" in app && typeof (app as { close?: () => void }).close === "function") {
        (app as { close: () => void }).close();
      }
      process.exit(0);
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

async function handleAppHttp(
  app: AppModule,
  options: ServeAppOptions,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const path = (req.url?.split("?")[0] ?? "").replace(/\/+$/, "") || "/";
  if (path === "/health") {
    if (req.method !== "GET" && req.method !== "HEAD") {
      writeJson(res, 405, { error: "Method not allowed" });
      return;
    }
    writeJson(res, 200, { ok: true });
    return;
  }
  if (req.method !== "POST") {
    writeJson(res, 405, { error: "Method not allowed" });
    return;
  }
  if (path !== "/open" && path !== "/refresh") {
    writeJson(res, 404, { error: "Not found" });
    return;
  }

  let raw: unknown;
  try {
    raw = await readJsonBody(req);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      writeJson(res, 413, { error: "Request body too large" });
      return;
    }
    if (err instanceof MalformedJsonError) {
      writeJson(res, 400, { error: "Invalid JSON" });
      return;
    }
    throw err;
  }

  const parsed = parseBody(raw);
  if (!parsed.ok) {
    writeJson(res, 400, { error: parsed.error });
    return;
  }

  try {
    verifyWireCtx(app.id, parsed.body.ctx, options.hostSigningPub);
  } catch (err) {
    writeJson(res, 400, { error: err instanceof Error ? err.message : "invalid-signature" });
    return;
  }

  const extras = toRefreshExtras(parsed.extras);
  const ctx = hydrateCtx(parsed.body.ctx, options.capabilityUrl);
  try {
    const result =
      path === "/open"
        ? await app.open(parsed.body.path ?? "/", extras, ctx)
        : await app.refresh(parsed.body.nodeId ?? "", extras, ctx);
    writeJson(res, 200, result);
  } catch (err) {
    console.error("app RPC failed", err);
    writeJson(res, 500, { error: "App RPC failed" });
  }
}

function hydrateCtx(wire: WireCtx, capabilityUrl: string): AppServerContext {
  const directory = wire.directory;
  return {
    userId: wire.userId,
    sessionId: wire.sessionId,
    accountAppId: wire.accountAppId,
    identity: createIdentityClient(capabilityUrl, wire.requestId),
    lockbox: createLockboxClient(capabilityUrl, wire.requestId),
    oauth: createOAuthClient(capabilityUrl, wire.requestId),
    ...(directory
      ? {
          directory: {
            list() {
              return directory;
            },
          },
        }
      : {}),
  };
}

function parseBody(
  raw: unknown,
): { ok: true; body: WireAppBody; extras: WireExtras } | { ok: false; error: string } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "body must be an object" };
  }
  const rec = raw as Record<string, unknown>;
  if (rec.apiVersion !== WIRE_API_VERSION) {
    return { ok: false, error: "apiVersion must be 1" };
  }
  const ctx = parseCtx(rec.ctx);
  if (!ctx.ok) {
    return ctx;
  }
  const extras = parseExtras(rec.extras);
  if (!extras.ok) {
    return extras;
  }
  const body: {
    apiVersion: number;
    ctx: WireCtx;
    extras: unknown;
    path?: string;
    nodeId?: string;
  } = {
    apiVersion: WIRE_API_VERSION,
    ctx: ctx.ctx,
    extras: extras.extras,
  };
  if (rec.path !== undefined) {
    if (typeof rec.path !== "string") {
      return { ok: false, error: "path must be a string" };
    }
    body.path = rec.path;
  }
  if (rec.nodeId !== undefined) {
    if (typeof rec.nodeId !== "string") {
      return { ok: false, error: "nodeId must be a string" };
    }
    body.nodeId = rec.nodeId;
  }
  return { ok: true, body, extras: extras.extras };
}

function parseCtx(value: unknown): { ok: true; ctx: WireCtx } | { ok: false; error: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "ctx must be an object" };
  }
  const rec = value as Record<string, unknown>;
  if (rec.userId !== null && typeof rec.userId !== "string") {
    return { ok: false, error: "ctx.userId must be a string or null" };
  }
  if (typeof rec.sessionId !== "string" || rec.sessionId.length === 0) {
    return { ok: false, error: "ctx.sessionId must be a non-empty string" };
  }
  if (typeof rec.accountAppId !== "string" || rec.accountAppId.length === 0) {
    return { ok: false, error: "ctx.accountAppId must be a non-empty string" };
  }
  if (typeof rec.requestId !== "string" || rec.requestId.length === 0) {
    return { ok: false, error: "ctx.requestId must be a non-empty string" };
  }
  if (typeof rec.exp !== "number" || !Number.isFinite(rec.exp)) {
    return { ok: false, error: "ctx.exp must be a number" };
  }
  if (typeof rec.sig !== "string" || rec.sig.length === 0) {
    return { ok: false, error: "ctx.sig must be a non-empty string" };
  }
  const ctx: {
    userId: string | null;
    sessionId: string;
    accountAppId: string;
    directory?: WireCtx["directory"];
    requestId: string;
    exp: number;
    sig: string;
  } = {
    userId: rec.userId as string | null,
    sessionId: rec.sessionId,
    accountAppId: rec.accountAppId,
    requestId: rec.requestId,
    exp: rec.exp,
    sig: rec.sig,
  };
  if (rec.directory !== undefined) {
    if (!Array.isArray(rec.directory)) {
      return { ok: false, error: "ctx.directory must be an array" };
    }
    ctx.directory = rec.directory as WireCtx["directory"];
  }
  return { ok: true, ctx };
}

function parseExtras(
  value: unknown,
): { ok: true; extras: WireExtras } | { ok: false; error: string } {
  if (value === undefined) {
    return { ok: true, extras: {} };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "extras must be an object" };
  }
  const rec = value as { inputText?: unknown; action?: unknown; parkedAppIds?: unknown };
  const extras: {
    inputText?: string;
    action?: { triggerId: string };
    parkedAppIds?: readonly string[];
  } = {};
  if (rec.inputText !== undefined) {
    if (typeof rec.inputText !== "string") {
      return { ok: false, error: "extras.inputText must be a string" };
    }
    extras.inputText = rec.inputText;
  }
  if (rec.action !== undefined) {
    if (rec.action === null || typeof rec.action !== "object" || Array.isArray(rec.action)) {
      return { ok: false, error: "extras.action must be an object with triggerId" };
    }
    const triggerId = (rec.action as { triggerId?: unknown }).triggerId;
    if (typeof triggerId !== "string" || triggerId.length === 0) {
      return { ok: false, error: "extras.action.triggerId must be a non-empty string" };
    }
    extras.action = { triggerId };
  }
  if (rec.parkedAppIds !== undefined) {
    if (!Array.isArray(rec.parkedAppIds) || !rec.parkedAppIds.every((id) => typeof id === "string")) {
      return { ok: false, error: "extras.parkedAppIds must be an array of strings" };
    }
    extras.parkedAppIds = rec.parkedAppIds;
  }
  return { ok: true, extras };
}

function toRefreshExtras(extras: WireExtras): RefreshExtras {
  const out: RefreshExtras = {};
  if (extras.inputText !== undefined) {
    out.inputText = extras.inputText;
  }
  if (extras.action) {
    out.action = { triggerId: extras.action.triggerId };
  }
  if (extras.parkedAppIds) {
    out.parkedAppIds = extras.parkedAppIds;
  }
  return out;
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Length", Buffer.byteLength(json));
  res.end(json);
}
