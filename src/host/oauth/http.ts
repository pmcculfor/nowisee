import type { AppHttpResponse } from "../http.ts";
import { readSessionToken } from "../cookie.ts";
import { header, type HeadersLike } from "../headers.ts";
import type { NowiseeHost } from "../host.ts";

const CALLBACK_PATH = "/oauth/callback";

export function isOAuthUrl(url: string): boolean {
  const path = (url.split("?")[0] ?? "").replace(/\/+$/, "") || "/";
  return path === CALLBACK_PATH;
}

export async function handleOAuthHttp(
  host: NowiseeHost,
  req: {
    readonly method: string;
    readonly url: string;
    readonly headers: HeadersLike;
  },
): Promise<AppHttpResponse> {
  const path = (req.url.split("?")[0] ?? "").replace(/\/+$/, "") || "/";
  if (path !== CALLBACK_PATH) {
    return { status: 404, body: "", headers: { "Cache-Control": "no-store" } };
  }
  if (req.method !== "GET") {
    return { status: 405, body: "", headers: { "Cache-Control": "no-store" } };
  }
  if (!host.oauth) {
    return redirectHome(host);
  }

  const token = readSessionToken(header(req.headers, "cookie"));
  const resolved = token ? await host.identity.lookup(token) : null;
  const query = new URL(req.url, "http://nowisee.local").searchParams;
  const result = await host.oauth.handleCallback({
    sessionId: resolved?.sessionId ?? "",
    userId: resolved?.userId ?? null,
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

function redirectHome(host: NowiseeHost): AppHttpResponse {
  const origin = (host.configuredOrigin ?? "").replace(/\/+$/, "");
  return {
    status: 302,
    body: "",
    headers: {
      Location: `${origin}/`,
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
    },
  };
}
