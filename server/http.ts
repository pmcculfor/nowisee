import type { WireExtras } from "../src/apps/rpc.ts";
import { readSessionToken, serializeSessionCookie } from "./cookie.ts";
import { checkCsrf, expectedOriginFromRequest } from "./csrf.ts";
import { AppNotFoundError } from "./errors.ts";
import { UnsafeLocatorError, type NowiseeHost } from "./host.ts";
import type { CookieSlot } from "./identity/context.ts";
import { clientIpFromRequest } from "./clientIp.ts";
import { header, type HeadersLike } from "./headers.ts";

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
  readonly remoteAddress?: string;
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
): { ok: true; nodeId: string; extras: WireExtras } | { ok: false; error: string } {
  if (body === undefined || body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Expected a JSON object" };
  }
  const rec = body as { nodeId?: unknown; stack?: unknown; extras?: unknown };
  if (rec.stack !== undefined) {
    return { ok: false, error: "stack is not allowed; send nodeId" };
  }
  if (typeof rec.nodeId !== "string" || rec.nodeId.length === 0) {
    return { ok: false, error: "nodeId must be a non-empty string" };
  }
  const extras = parseExtras(rec.extras);
  if (!extras.ok) {
    return extras;
  }
  return { ok: true, nodeId: rec.nodeId, extras: extras.extras };
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
  const extras: WireExtras & {
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
    const parsedAction = parseAction(rec.action);
    if (!parsedAction.ok) {
      return parsedAction;
    }
    extras.action = parsedAction.action;
  }
  if (rec.parkedAppIds !== undefined) {
    if (!Array.isArray(rec.parkedAppIds) || !rec.parkedAppIds.every((id) => typeof id === "string")) {
      return { ok: false, error: "extras.parkedAppIds must be an array of strings" };
    }
    extras.parkedAppIds = rec.parkedAppIds;
  }
  return { ok: true, extras };
}

function parseAction(
  value: unknown,
): { ok: true; action: { triggerId: string } } | { ok: false; error: string } {
  if (value === true || value === false) {
    return { ok: false, error: "extras.action must be an object with triggerId" };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "extras.action must be an object with triggerId" };
  }
  const triggerId = (value as { triggerId?: unknown }).triggerId;
  if (typeof triggerId !== "string" || triggerId.length === 0) {
    return { ok: false, error: "extras.action.triggerId must be a non-empty string" };
  }
  return { ok: true, action: { triggerId } };
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
  const clientIp = clientIpFromRequest({
    forwardedFor: header(req.headers, "x-forwarded-for"),
    remoteAddress: req.remoteAddress,
  });
  const slot: CookieSlot = { clientIp };

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
        clientIp,
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
        nodeId: parsed.nodeId,
        extras: parsed.extras,
        token,
        slot,
        clientIp,
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
    if (err instanceof UnsafeLocatorError) {
      return json(500, { error: "App RPC failed" }, cookieHeader(slot));
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
