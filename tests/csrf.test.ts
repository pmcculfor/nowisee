import { afterEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE_NAME } from "../server/cookie.ts";
import { createNowiseeHost, type NowiseeHost } from "../server/host.ts";
import { handleSessionHttp } from "../server/http.ts";
import { SCRYPT_TEST } from "../server/identity/hash.ts";
import { fixtureKjv } from "./helpers/kjvFixture.ts";

const ORIGIN = "http://localhost:5173";

function host(): NowiseeHost {
  return createNowiseeHost({
    kjv: fixtureKjv,
    scrypt: SCRYPT_TEST,
    configuredOrigin: ORIGIN,
  });
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "application/json",
    origin: ORIGIN,
    host: "localhost:5173",
    ...extra,
  };
}

describe("CSRF layers", () => {
  let h: NowiseeHost;
  afterEach(() => {
    h?.close();
  });

  it("rejects a non-JSON Content-Type even with a valid Origin", async () => {
    h = host();
    const out = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/home/open",
      headers: headers({ "content-type": "text/plain" }),
      body: { path: "/" },
    });
    expect(out.status).toBe(403);
    expect(out.body).toEqual({ error: "Invalid content type" });
  });

  it("rejects a missing Origin even with application/json", async () => {
    h = host();
    const out = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/home/open",
      headers: {
        "content-type": "application/json",
        host: "localhost:5173",
      },
      body: { path: "/" },
    });
    expect(out.status).toBe(403);
    expect(out.body).toEqual({ error: "Invalid origin" });
  });

  it("rejects a foreign Origin even with application/json", async () => {
    h = host();
    const out = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/home/open",
      headers: headers({ origin: "https://evil.example" }),
      body: { path: "/" },
    });
    expect(out.status).toBe(403);
    expect(out.body).toEqual({ error: "Invalid origin" });
  });

  it("accepts same-origin JSON and sets SameSite=Lax on the session cookie", async () => {
    h = host();
    const out = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/home/open",
      headers: headers(),
      body: { path: "/" },
    });
    expect(out.status).toBe(200);
    const cookie = out.headers?.["Set-Cookie"] ?? "";
    expect(cookie.startsWith(`${SESSION_COOKIE_NAME}=`)).toBe(true);
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toMatch(/Domain=/i);
    expect(out.headers?.["Cache-Control"]).toBe("no-store");
    expect(out.headers).not.toHaveProperty("Access-Control-Allow-Credentials");
  });
});
