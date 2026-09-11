import { afterEach, describe, expect, it } from "vitest";
import { clientIpFromRequest } from "../server/clientIp.ts";
import { SESSION_COOKIE_NAME } from "../server/cookie.ts";
import { createNowiseeHost, type NowiseeHost } from "../server/host.ts";
import { handleSessionHttp } from "../server/http.ts";
import { parseAdminEmails } from "../server/admin/emails.ts";
import { handleAdminHttp } from "../server/admin/http.ts";
import { hourBucket } from "../server/usage.ts";
import { capturingMailer, signInForTest, type CapturingMailer } from "./helpers/signIn.ts";

const ORIGIN = "http://localhost:5173";
const ADMIN_EMAIL = "admin@example.com";

function apiHeaders(cookie?: string, extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": "application/json",
    origin: ORIGIN,
    host: "localhost:5173",
    ...extra,
  };
  if (cookie) {
    h.cookie = cookie;
  }
  return h;
}

function makeHost(): { host: NowiseeHost; mailer: CapturingMailer } {
  const mailer = capturingMailer();
  return {
    mailer,
    host: createNowiseeHost({
      mailer,
      configuredOrigin: ORIGIN,
      adminEmails: [ADMIN_EMAIL],
    }),
  };
}

describe("client IP", () => {
  it("uses the last X-Forwarded-For hop and strips an IPv4-mapped prefix", () => {
    expect(
      clientIpFromRequest({
        forwardedFor: "1.2.3.4, 203.0.113.8",
        remoteAddress: "127.0.0.1",
      }),
    ).toBe("203.0.113.8");
    expect(clientIpFromRequest({ remoteAddress: "::ffff:192.0.2.10" })).toBe("192.0.2.10");
  });
});

describe("admin emails", () => {
  it("splits, lowercases, and de-duplicates", () => {
    expect(parseAdminEmails("Ada@Example.com, other@x.co; ADA@example.com")).toEqual([
      "ada@example.com",
      "other@x.co",
    ]);
  });
});

describe("usage recording and admin console", () => {
  let h: NowiseeHost;
  afterEach(() => {
    h?.close();
  });

  it("counts opens, refreshes, and actions hourly by session, overwrites ip, and promotes user_id", async () => {
    const made = makeHost();
    h = made.host;
    const opened = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/home/open",
      headers: apiHeaders(undefined, { "x-forwarded-for": "203.0.113.10" }),
      body: { path: "/", ip: "1.1.1.1" },
      remoteAddress: "127.0.0.1",
    });
    expect(opened.status).toBe(200);
    const cookie = opened.headers?.["Set-Cookie"]?.split(";")[0];
    expect(cookie?.startsWith(`${SESSION_COOKIE_NAME}=`)).toBe(true);

    const refreshed = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/home/refresh",
      headers: apiHeaders(cookie, { "x-forwarded-for": "198.51.100.20" }),
      body: { stack: [{ nodeId: "home:catalog:0", label: "x", location: null }] },
    });
    expect(refreshed.status).toBe(200);

    const token = cookie!.slice(`${SESSION_COOKIE_NAME}=`.length);
    const live = await h.identity.lookup(token);
    expect(live?.sessionId).toBeTruthy();
    await h.identity.requestSignIn(live!.sessionId, "user@example.com");
    const verified = await h.identity.verifySignIn(
      live!.sessionId,
      made.mailer.lastCode(),
      "192.0.2.44",
    );
    expect(verified.ok).toBe(true);
    if (!verified.ok) {
      return;
    }
    const signedCookie = `${SESSION_COOKIE_NAME}=${verified.issuedToken.value}`;

    const afterSignIn = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/notes/refresh",
      headers: apiHeaders(signedCookie, { "x-forwarded-for": "192.0.2.44" }),
      body: {
        stack: [{ nodeId: "notes:empty", label: "x", location: null }],
        extras: { action: true },
      },
    });
    expect(afterSignIn.status).toBe(200);

    const hour = hourBucket(Date.now());
    const home = h.db.get<{
      opens: number;
      refreshes: number;
      actions: number;
      user_id: string | null;
      ip: string;
      session_id: string;
    }>(
      "SELECT opens, refreshes, actions, user_id, ip, session_id FROM usage_hourly WHERE hour = ? AND app_id = ?",
      hour,
      "home",
    );
    expect(home?.opens).toBe(1);
    expect(home?.refreshes).toBe(1);
    expect(home?.actions).toBe(0);
    expect(home?.user_id).toBeNull();
    expect(home?.ip).toBe("198.51.100.20");

    const notes = h.db.get<{
      opens: number;
      refreshes: number;
      actions: number;
      user_id: string | null;
      ip: string;
    }>(
      "SELECT opens, refreshes, actions, user_id, ip FROM usage_hourly WHERE hour = ? AND app_id = ?",
      hour,
      "notes",
    );
    expect(notes).toEqual({
      opens: 0,
      refreshes: 0,
      actions: 1,
      user_id: verified.userId,
      ip: "192.0.2.44",
    });

    const sameSession = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/home/open",
      headers: apiHeaders(signedCookie, { "x-forwarded-for": "192.0.2.44" }),
      body: { path: "/" },
    });
    expect(sameSession.status).toBe(200);
    const homeAfter = h.db.get<{ user_id: string | null; opens: number }>(
      "SELECT user_id, opens FROM usage_hourly WHERE hour = ? AND app_id = ? AND session_id = ?",
      hour,
      "home",
      live!.sessionId,
    );
    expect(homeAfter?.user_id).toBe(verified.userId);
    expect(homeAfter?.opens).toBe(2);
  });

  it("does not mint a session for GET /admin and 404s non-admins", async () => {
    const made = makeHost();
    h = made.host;
    const missing = await handleAdminHttp(h, {
      method: "GET",
      url: "/admin",
      headers: {},
    });
    expect(missing.status).toBe(404);
    expect(h.db.all("SELECT id FROM sessions")).toHaveLength(0);

    const stranger = await signInForTest(h, made.mailer, "stranger@example.com");
    const denied = await handleAdminHttp(h, {
      method: "GET",
      url: "/admin",
      headers: { cookie: stranger.cookie },
    });
    expect(denied.status).toBe(404);
    expect(String(denied.body)).not.toContain("Admin console");
  });

  it("serves the dashboard to an allowlisted session and rejects CSRF on POSTs", async () => {
    const made = makeHost();
    h = made.host;
    const admin = await signInForTest(h, made.mailer, ADMIN_EMAIL);

    const page = await handleAdminHttp(h, {
      method: "GET",
      url: "/admin",
      headers: { cookie: admin.cookie },
    });
    expect(page.status).toBe(200);
    expect(page.headers?.["Content-Type"]).toContain("text/html");
    expect(page.body).toContain("Admin console");
    expect(page.headers?.["X-Frame-Options"]).toBe("DENY");

    const csrf = await handleAdminHttp(h, {
      method: "POST",
      url: "/admin/api/summary",
      headers: { cookie: admin.cookie, "content-type": "application/json" },
      body: { range: "7d" },
    });
    expect(csrf.status).toBe(403);

    const summary = await handleAdminHttp(h, {
      method: "POST",
      url: "/admin/api/summary",
      headers: apiHeaders(admin.cookie),
      body: { range: "all" },
    });
    expect(summary.status).toBe(200);
    const body = summary.body as { usersTotal: number; logins: number };
    expect(body.usersTotal).toBe(1);
    expect(body.logins).toBe(1);

    const exportUsers = await handleAdminHttp(h, {
      method: "POST",
      url: "/admin/export/users",
      headers: apiHeaders(admin.cookie),
      body: { range: "all" },
    });
    expect(exportUsers.status).toBe(200);
    expect(exportUsers.headers?.["Content-Type"]).toContain("text/csv");
    expect(String(exportUsers.body)).toContain(ADMIN_EMAIL);
  });

  it("404s admin POSTs when the allowlist is empty", async () => {
    const mailer = capturingMailer();
    h = createNowiseeHost({ mailer, configuredOrigin: ORIGIN });
    const admin = await signInForTest(h, mailer, ADMIN_EMAIL);
    const out = await handleAdminHttp(h, {
      method: "POST",
      url: "/admin/api/summary",
      headers: apiHeaders(admin.cookie),
      body: { range: "all" },
    });
    expect(out.status).toBe(404);
  });
});
