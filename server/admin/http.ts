import type { Db } from "../db/index.ts";
import { readSessionToken } from "../cookie.ts";
import { checkCsrf, expectedOriginFromRequest } from "../csrf.ts";
import type { NowiseeHost } from "../host.ts";
import type { AppHttpResponse, HeadersLike, SessionHttpRequest } from "../http.ts";
import { HOUR_MS } from "../usage.ts";
import { ADMIN_PAGE_HTML } from "./page.ts";
import {
  adminActivity,
  adminLogins,
  adminSummary,
  adminUserDetail,
  adminUsers,
  parseRange,
  toCsv,
  type RangeId,
} from "./queries.ts";

const ADMIN_HEADERS = {
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
} as const;

export function isAdminUrl(url: string): boolean {
  const path = pathOnly(url);
  return path === "/admin" || path.startsWith("/admin/");
}

export async function handleAdminHttp(
  host: NowiseeHost,
  req: SessionHttpRequest,
): Promise<AppHttpResponse> {
  const path = pathOnly(req.url);
  if (req.method === "GET") {
    if (path !== "/admin") {
      return notFound();
    }
    const allowed = await adminSession(host, req);
    if (!allowed) {
      return notFound();
    }
    return {
      status: 200,
      body: ADMIN_PAGE_HTML,
      headers: {
        ...ADMIN_HEADERS,
        "Content-Type": "text/html; charset=utf-8",
      },
    };
  }

  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const expectedOrigin = expectedOriginFromRequest(host.configuredOrigin);
  const csrf = checkCsrf({
    contentType: header(req.headers, "content-type"),
    origin: header(req.headers, "origin"),
    expectedOrigin,
  });
  if (!csrf.ok) {
    return json(403, { error: csrf.reason === "origin" ? "Invalid origin" : "Invalid content type" });
  }

  const allowed = await adminSession(host, req);
  if (!allowed) {
    return notFound();
  }

  const rec = asRecord(req.body);
  const range = parseRange(rec.range);
  const now = Date.now();
  const q = typeof rec.q === "string" ? rec.q : "";
  const appId = typeof rec.appId === "string" ? rec.appId : "";
  const userId = typeof rec.userId === "string" ? rec.userId : "";
  const sessionId = typeof rec.sessionId === "string" ? rec.sessionId : "";
  const filters = {
    appId: appId || undefined,
    userId: userId || undefined,
    sessionId: sessionId || undefined,
  };

  if (path === "/admin/api/summary") {
    return json(200, adminSummary(host.db, now, range));
  }
  if (path === "/admin/api/users") {
    return json(200, adminUsers(host.db, now, range, q));
  }
  if (path === "/admin/api/user") {
    if (!userId) {
      return json(400, { error: "userId is required" });
    }
    const detail = adminUserDetail(host.db, now, range, userId);
    if (!detail) {
      return notFound();
    }
    return json(200, detail);
  }
  if (path === "/admin/api/logins") {
    return json(200, adminLogins(host.db, now, range));
  }
  if (path === "/admin/api/activity") {
    return json(200, adminActivity(host.db, now, range, filters));
  }
  if (path === "/admin/export/users") {
    return csv("nowisee-users.csv", usersCsv(host.db, now, range, q));
  }
  if (path === "/admin/export/logins") {
    return csv("nowisee-logins.csv", loginsCsv(host.db, now, range));
  }
  if (path === "/admin/export/activity") {
    return csv("nowisee-activity.csv", activityCsv(host.db, now, range, filters));
  }
  return notFound();
}

async function adminSession(host: NowiseeHost, req: SessionHttpRequest): Promise<boolean> {
  const token = readSessionToken(header(req.headers, "cookie"));
  const live = await host.identity.lookup(token);
  return host.isAdmin(live?.userId ?? null);
}

function usersCsv(db: Db, now: number, range: RangeId, q: string): string {
  const rows = adminUsers(db, now, range, q);
  return toCsv(
    ["email", "created_at", "last_login_at", "last_activity_hour", "opens", "refreshes", "actions"],
    rows.map((row) => [
      row.email,
      iso(row.createdAt),
      iso(row.lastLoginAt),
      hourIso(row.lastHour),
      row.opens,
      row.refreshes,
      row.actions,
    ]),
  );
}

function loginsCsv(db: Db, now: number, range: RangeId): string {
  const rows = adminLogins(db, now, range);
  return toCsv(
    ["at", "email", "kind", "ip", "session_id"],
    rows.map((row) => [iso(row.at), row.email, row.kind, row.ip, row.sessionId]),
  );
}

function activityCsv(
  db: Db,
  now: number,
  range: RangeId,
  filters: { appId?: string; userId?: string; sessionId?: string },
): string {
  const rows = adminActivity(db, now, range, filters, 100_000).sessions;
  return toCsv(
    ["hour", "app", "session_id", "email", "ip", "opens", "refreshes", "actions"],
    rows.map((row) => [
      hourIso(row.hour),
      row.appId,
      row.sessionId,
      row.email,
      row.ip,
      row.opens,
      row.refreshes,
      row.actions,
    ]),
  );
}

function iso(ms: number | null): string {
  return ms == null ? "" : new Date(ms).toISOString();
}

function hourIso(hour: number | null): string {
  return hour == null ? "" : new Date(hour * HOUR_MS).toISOString();
}

function pathOnly(url: string): string {
  return (url.split("?")[0] ?? "").replace(/\/+$/, "") || "/";
}

function asRecord(body: unknown): Record<string, unknown> {
  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  return {};
}

function header(headers: HeadersLike, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function notFound(): AppHttpResponse {
  return json(404, { error: "Not found" });
}

function json(status: number, body: unknown): AppHttpResponse {
  return {
    status,
    body,
    headers: {
      ...ADMIN_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
    },
  };
}

function csv(filename: string, body: string): AppHttpResponse {
  return {
    status: 200,
    body,
    headers: {
      ...ADMIN_HEADERS,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  };
}
