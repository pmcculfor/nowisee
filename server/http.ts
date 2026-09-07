import type { WireExtras } from "../src/apps/rpc.ts";
import type { StackEntry } from "../src/core/types.ts";
import { readSessionToken, serializeSessionCookie } from "./cookie.ts";
import { checkCsrf, expectedOriginFromRequest } from "./csrf.ts";
import { AppNotFoundError } from "./errors.ts";
import type { NowiseeHost } from "./host.ts";
import type { CookieSlot } from "./identity/context.ts";

export type AppHttpResponse = {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Readonly<Record<string, string>>;
};

export type SessionHttpRequest = {
  readonly method: string;
  readonly url: string;
  readonly headers: HeadersLike;
  readonly body?: unknown;
};

export type HeadersLike = {
  readonly [name: string]: string | string[] | undefined;
};

const API_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
} as const;

const OPEN_RE = /^\/api\/apps\/([^/]+)\/open\/?$/;
const REFRESH_RE = /^\/api\/apps\/([^/]+)\/refresh\/?$/;

export function isAppApiUrl(url: string): boolean {
  const path = url.split("?")[0] ?? "";
  return OPEN_RE.test(path) || REFRESH_RE.test(path);
}

function decodeAppId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function parseOpenBody(
  body: unknown,
): { ok: true; path: string; extras: WireExtras } | { ok: false; error: string } {
  if (body === undefined || body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Expected a JSON object" };
  }
  const rec = body as { path?: unknown; extras?: unknown };
  if (typeof rec.path !== "string" || rec.path.length === 0) {
    return { ok: false, error: "path must be a non-empty string" };
  }
  const extras = parseExtras(rec.extras);
  if (!extras.ok) {
    return extras;
  }
  return { ok: true, path: rec.path, extras: extras.extras };
}

function parseRefreshBody(
  body: unknown,
):
  | { ok: true; stack: StackEntry[]; extras: WireExtras }
  | { ok: false; error: string } {
  if (body === undefined || body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Expected a JSON object" };
  }
  const rec = body as { stack?: unknown; extras?: unknown };
  const stack = parseStack(rec.stack);
  if (!stack.ok) {
    return stack;
  }
  const extras = parseExtras(rec.extras);
  if (!extras.ok) {
    return extras;
  }
  return { ok: true, stack: stack.stack, extras: extras.extras };
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
  const rec = value as { inputText?: unknown; action?: unknown };
  const extras: { inputText?: string; action?: boolean } = {};
  if (rec.inputText !== undefined) {
    if (typeof rec.inputText !== "string") {
      return { ok: false, error: "extras.inputText must be a string" };
    }
    extras.inputText = rec.inputText;
  }
  if (rec.action !== undefined) {
    if (rec.action !== true) {
      return { ok: false, error: "extras.action must be true when present" };
    }
    extras.action = true;
  }
  return { ok: true, extras };
}

function parseStack(
  value: unknown,
): { ok: true; stack: StackEntry[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: "stack must be an array" };
  }
  const stack: StackEntry[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, error: "stack entries must be objects" };
    }
    const rec = entry as { nodeId?: unknown; label?: unknown; location?: unknown };
    if (typeof rec.nodeId !== "string" || rec.nodeId.length === 0) {
      return { ok: false, error: "stack entry nodeId must be a non-empty string" };
    }
    if (typeof rec.label !== "string") {
      return { ok: false, error: "stack entry label must be a string" };
    }
    let location: StackEntry["location"] = null;
    if (rec.location !== undefined && rec.location !== null) {
      if (typeof rec.location !== "object" || Array.isArray(rec.location)) {
        return { ok: false, error: "stack entry location must be an object or null" };
      }
      const loc = rec.location as { appId?: unknown; path?: unknown };
      if (typeof loc.appId !== "string" || typeof loc.path !== "string") {
        return { ok: false, error: "location needs appId and path strings" };
      }
      location = { appId: loc.appId, path: loc.path };
    }
    stack.push({ nodeId: rec.nodeId, label: rec.label, location });
  }
  return { ok: true, stack };
}

/**
 * Full /api pipeline: CSRF, session cookie, ctx, at most one Set-Cookie.
 * Never logs the body — emails and sign-in codes arrive in extras.inputText.
 */
export async function handleSessionHttp(
  host: NowiseeHost,
  req: SessionHttpRequest,
): Promise<AppHttpResponse> {
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const expectedOrigin = expectedOriginFromRequest(host.configuredOrigin);
  const csrf = checkCsrf({
    contentType: header(req.headers, "content-type"),
    origin: header(req.headers, "origin"),
    expectedOrigin: expectedOrigin,
  });
  if (!csrf.ok) {
    return json(403, { error: csrf.reason === "origin" ? "Invalid origin" : "Invalid content type" });
  }

  const path = (req.url.split("?")[0] ?? "").replace(/\/+$/, "") || "/";
  const token = readSessionToken(header(req.headers, "cookie"));
  const slot: CookieSlot = {};

  const openMatch = OPEN_RE.exec(path);
  if (openMatch) {
    const appId = decodeAppId(openMatch[1]!);
    const parsed = parseOpenBody(req.body);
    if (!parsed.ok) {
      return json(400, { error: parsed.error });
    }
    return callHost(host, slot, () =>
      host.dispatch("open", {
        appId,
        path: parsed.path,
        extras: parsed.extras,
        token,
        slot,
      }),
    );
  }

  const refreshMatch = REFRESH_RE.exec(path);
  if (refreshMatch) {
    const appId = decodeAppId(refreshMatch[1]!);
    const parsed = parseRefreshBody(req.body);
    if (!parsed.ok) {
      return json(400, { error: parsed.error });
    }
    return callHost(host, slot, () =>
      host.dispatch("refresh", {
        appId,
        stack: parsed.stack,
        extras: parsed.extras,
        token,
        slot,
      }),
    );
  }

  return json(404, { error: "Not found" });
}

async function callHost(
  _host: NowiseeHost,
  slot: CookieSlot,
  run: () => Promise<unknown>,
): Promise<AppHttpResponse> {
  try {
    const body = await run();
    return json(200, body, cookieHeader(slot));
  } catch (err) {
    if (err instanceof AppNotFoundError) {
      return json(404, { error: err.message }, cookieHeader(slot));
    }
    return json(500, { error: "App RPC failed" }, cookieHeader(slot));
  }
}

function cookieHeader(slot: CookieSlot): Record<string, string> | undefined {
  if (slot.issued === undefined) {
    return undefined;
  }
  if (slot.issued === null) {
    return { "Set-Cookie": serializeSessionCookie(null) };
  }
  return { "Set-Cookie": serializeSessionCookie(slot.issued.value, slot.issued.expiresAt) };
}

function json(
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): AppHttpResponse {
  return {
    status,
    body,
    headers: { ...API_HEADERS, ...extraHeaders },
  };
}

function header(headers: HeadersLike, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}
