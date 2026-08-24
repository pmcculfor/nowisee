import type { AppHttpResponse, HeadersLike } from "../http.ts";
import { readSessionToken } from "../cookie.ts";
import type { NowiseeHost } from "../host.ts";

const CALLBACK_PATH = "/oauth/callback";
const EVENTS_RE = /^\/oauth\/([^/]+)\/events\/?$/;

export function isOAuthUrl(url: string): boolean {
  const path = (url.split("?")[0] ?? "").replace(/\/+$/, "") || "/";
  return path === CALLBACK_PATH || EVENTS_RE.test(path);
}

export async function handleOAuthHttp(
  host: NowiseeHost,
  req: {
    readonly method: string;
    readonly url: string;
    readonly headers: HeadersLike;
    readonly body?: string;
  },
): Promise<AppHttpResponse> {
  const path = (req.url.split("?")[0] ?? "").replace(/\/+$/, "") || "/";
  const events = EVENTS_RE.exec(path);
  if (events) {
    if (req.method !== "POST") {
      return { status: 405, body: "", headers: { "Cache-Control": "no-store" } };
    }
    if (!host.oauth) {
      return { status: 404, body: "", headers: { "Cache-Control": "no-store" } };
    }
    const appId = decodeURIComponent(events[1]!);
    const result = await host.oauth.handleProviderEvent({
      appId,
      headers: flattenHeaders(req.headers),
      body: req.body ?? "",
    });
    return {
      status: result.status,
      body: result.body,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    };
  }

  if (path !== CALLBACK_PATH) {
    return { status: 404, body: "", headers: { "Cache-Control": "no-store" } };
  }
  if (req.method !== "GET") {
    return { status: 405, body: "", headers: { "Cache-Control": "no-store" } };
  }
  if (!host.oauth) {
    return redirect(host, "/");
  }

  const token = readSessionToken(header(req.headers, "cookie"));
  const resolved = token
    ? await host.identity.resolve(token)
    : { sessionId: "", userId: null as string | null };
  const query = new URL(req.url, "http://nowisee.local").searchParams;
  const result = await host.oauth.handleCallback({
    sessionId: resolved.sessionId,
    userId: resolved.userId,
    state: query.get("state"),
    code: query.get("code"),
    error: query.get("error"),
  });
  return {
    status: 302,
    body: "",
    headers: {
      Location: result.location,
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
    },
  };
}

function redirect(host: NowiseeHost, hashPath: string): AppHttpResponse {
  const origin = (host.configuredOrigin ?? "").replace(/\/+$/, "");
  return {
    status: 302,
    body: "",
    headers: {
      Location: `${origin}/#${hashPath}`,
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
    },
  };
}

function header(headers: HeadersLike, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function flattenHeaders(headers: HeadersLike): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      out[key.toLowerCase()] = value;
    } else if (Array.isArray(value) && value[0]) {
      out[key.toLowerCase()] = value[0];
    }
  }
  return out;
}
