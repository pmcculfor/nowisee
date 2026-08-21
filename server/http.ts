import type { AppRpc, WireExtras } from "../src/apps/rpc.ts";
import type { StackEntry } from "../src/core/types.ts";
import { AppNotFoundError } from "./errors.ts";

export type AppHttpRequest = {
  readonly method: string;
  readonly url: string;
  readonly body?: unknown;
};

export type AppHttpResponse = {
  readonly status: number;
  readonly body: unknown;
};

const OPEN_RE = /^\/api\/apps\/([^/]+)\/open\/?$/;
const REFRESH_RE = /^\/api\/apps\/([^/]+)\/refresh\/?$/;

export function isAppApiUrl(url: string): boolean {
  const path = url.split("?")[0] ?? "";
  return OPEN_RE.test(path) || REFRESH_RE.test(path);
}

export async function handleAppHttp(
  rpc: AppRpc,
  req: AppHttpRequest,
): Promise<AppHttpResponse> {
  if (req.method !== "POST") {
    return { status: 405, body: { error: "Method not allowed" } };
  }

  const path = (req.url.split("?")[0] ?? "").replace(/\/+$/, "") || "/";
  const openMatch = OPEN_RE.exec(path);
  if (openMatch) {
    const appId = decodeAppId(openMatch[1]!);
    const parsed = parseOpenBody(req.body);
    if (!parsed.ok) {
      return { status: 400, body: { error: parsed.error } };
    }
    return callRpc(() => rpc.open(appId, parsed.path, parsed.extras));
  }

  const refreshMatch = REFRESH_RE.exec(path);
  if (refreshMatch) {
    const appId = decodeAppId(refreshMatch[1]!);
    const parsed = parseRefreshBody(req.body);
    if (!parsed.ok) {
      return { status: 400, body: { error: parsed.error } };
    }
    return callRpc(() => rpc.refresh(appId, parsed.stack, parsed.extras));
  }

  return { status: 404, body: { error: "Not found" } };
}

async function callRpc(run: () => Promise<unknown>): Promise<AppHttpResponse> {
  try {
    const body = await run();
    return { status: 200, body };
  } catch (err) {
    if (err instanceof AppNotFoundError) {
      return { status: 404, body: { error: err.message } };
    }
    return { status: 500, body: { error: "App RPC failed" } };
  }
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
