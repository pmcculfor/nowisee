import { afterEach, describe, expect, it } from "vitest";
import { createNowiseeHost, type NowiseeHost } from "../server/host.ts";
import { handleSessionHttp } from "../server/http.ts";
import { SCRYPT_TEST } from "../server/identity/hash.ts";
import { NODE } from "../src/apps/account/ids.ts";
import type { AppModule, AppServerContext, RefreshResult } from "../src/core/types.ts";
import { fixtureKjv } from "./helpers/kjvFixture.ts";

const ORIGIN = "http://localhost:5173";

function makeHost(extra?: { extraApps?: AppModule[]; identityAppIds?: string[] }): NowiseeHost {
  return createNowiseeHost({
    bibleSeed: fixtureKjv,
    scrypt: SCRYPT_TEST,
    configuredOrigin: ORIGIN,
    extraApps: extra?.extraApps,
    identityAppIds: extra?.identityAppIds,
  });
}

function headers(cookie?: string): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": "application/json",
    origin: ORIGIN,
    host: "localhost:5173",
  };
  if (cookie) {
    h.cookie = cookie;
  }
  return h;
}

function cookieFrom(setCookie: string | undefined): string | undefined {
  return setCookie?.split(";")[0];
}

describe("Account app", () => {
  let h: NowiseeHost;
  afterEach(() => {
    h?.close();
  });

  it("signed-out open starts on Sign in or register; signed-in open starts on Settings", async () => {
    h = makeHost();
    const opened = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/account/open",
      headers: headers(),
      body: { path: "/" },
    });
    expect(opened.status).toBe(200);
    const body = opened.body as RefreshResult;
    expect(body.node.id).toBe(NODE.start);
    expect(body.node.label).toBe("Sign in or register");
    expect(body.navigationMap[NODE.start]?.enter).toEqual({
      kind: "node",
      toNodeId: NODE.emailPrompt,
      stackBehavior: "push",
    });
    expect(body.warm.find((n) => n.id === NODE.emailPrompt)?.label).toBe("Please enter your email.");
    expect(body.warm.find((n) => n.id === NODE.passwordPrompt)?.label).toBe(
      "Please enter your password.",
    );
    expect(body.warm.find((n) => n.id === NODE.password)?.secret).toBe(true);
    expect(body.warm.find((n) => n.id === NODE.email)?.autocomplete).toBe("username");

    const cookie = cookieFrom(opened.headers?.["Set-Cookie"]);
    await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/account/refresh",
      headers: headers(cookie),
      body: {
        stack: [{ nodeId: NODE.passwordPrompt, label: "Please enter your password.", location: null }],
        extras: { action: true, inputText: "user@example.com" },
      },
    });
    const signedIn = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/account/refresh",
      headers: headers(cookie),
      body: {
        stack: [
          { nodeId: NODE.start, label: "Sign in or register", location: null },
          { nodeId: NODE.emailPrompt, label: "Please enter your email.", location: null },
          { nodeId: NODE.email, label: "", location: null },
          { nodeId: NODE.passwordPrompt, label: "Please enter your password.", location: null },
          { nodeId: NODE.password, label: "", location: null },
          { nodeId: NODE.auth, label: "Signing in…", location: null },
        ],
        extras: { action: true, inputText: "password1" },
      },
    });
    const signedBody = signedIn.body as RefreshResult;
    expect(signedBody.node.label).toBe("You are signed in as user@example.com.");
    expect(signedBody.location).toBeNull();
    expect(signedBody.navigationMap[NODE.auth]?.enter).toEqual({
      kind: "app",
      to: { appId: "home", path: "/" },
    });

    const nextCookie = cookieFrom(signedIn.headers?.["Set-Cookie"]) ?? cookie;
    const settings = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/account/open",
      headers: headers(nextCookie),
      body: { path: "/" },
    });
    const settingsBody = settings.body as RefreshResult;
    expect(settingsBody.node.id).toBe(NODE.settings);
    expect(settingsBody.node.label).toContain("Settings");
    expect(settingsBody.warm.map((n) => n.id)).toContain(NODE.signOut);
  });

  it("sign-in action sets exactly one Set-Cookie with a rotated token", async () => {
    h = makeHost();
    const start = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/account/open",
      headers: headers(),
      body: { path: "/" },
    });
    const anon = cookieFrom(start.headers?.["Set-Cookie"])!;
    await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/account/refresh",
      headers: headers(anon),
      body: {
        stack: [{ nodeId: NODE.passwordPrompt, label: "Please enter your password.", location: null }],
        extras: { action: true, inputText: "pat@example.com" },
      },
    });
    const action = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/account/refresh",
      headers: headers(anon),
      body: {
        stack: [{ nodeId: NODE.auth, label: "Signing in…", location: null }],
        extras: { action: true, inputText: "password1" },
      },
    });
    expect(action.status).toBe(200);
    const setCookie = action.headers?.["Set-Cookie"];
    expect(setCookie).toBeTruthy();
    expect(setCookie!.split(",").filter((p) => p.includes("__Host-nowisee_session="))).toHaveLength(1);
    expect(cookieFrom(setCookie)).not.toBe(anon);
    const body = action.body as RefreshResult;
    expect(body.node.label).toContain("You are signed in as pat@example.com.");
  });

  it("a short password is unsuccessful sign-in, and back pops to the existing password node", async () => {
    h = makeHost();
    const start = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/account/open",
      headers: headers(),
      body: { path: "/" },
    });
    const cookie = cookieFrom(start.headers?.["Set-Cookie"]);
    await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/account/refresh",
      headers: headers(cookie),
      body: {
        stack: [{ nodeId: NODE.passwordPrompt, label: "Please enter your password.", location: null }],
        extras: { action: true, inputText: "short@example.com" },
      },
    });
    const failed = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/account/refresh",
      headers: headers(cookie),
      body: {
        stack: [
          { nodeId: NODE.password, label: "", location: null },
          { nodeId: NODE.auth, label: "Signing in…", location: null },
        ],
        extras: { action: true, inputText: "short" },
      },
    });
    const body = failed.body as RefreshResult;
    expect(body.node.label).toBe("Sign-in was unsuccessful.");
    expect(body.node.label).not.toContain("too short");
    expect(body.navigationMap[NODE.auth]?.back).toEqual({ kind: "node", stackBehavior: "pop" });
    expect(body.navigationMap[NODE.auth]?.enter).toEqual({ kind: "node", stackBehavior: "pop" });
    expect(body.navigationMap[NODE.auth]?.back).not.toHaveProperty("toNodeId");
  });

  it("does not grant ctx.identity to a non-allowed app", async () => {
    const seen: Array<AppServerContext | undefined> = [];
    const probe: AppModule = {
      id: "probe",
      label: "Probe",
      open(_path, _extras, ctx) {
        seen.push(ctx);
        return {
          navigationMap: {},
          warm: [],
          node: { id: "probe:root", label: ctx?.identity ? "has-identity" : "no-identity" },
          location: { appId: "probe", path: "/" },
        };
      },
      refresh(_stack, _extras, ctx) {
        seen.push(ctx);
        return {
          navigationMap: {},
          warm: [],
          node: { id: "probe:root", label: ctx?.identity ? "has-identity" : "no-identity" },
          location: { appId: "probe", path: "/" },
        };
      },
    };
    h = makeHost({ extraApps: [probe], identityAppIds: ["account"] });
    const out = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/probe/open",
      headers: headers(),
      body: { path: "/" },
    });
    expect(out.status).toBe(200);
    expect((out.body as RefreshResult).node.label).toBe("no-identity");
    expect(seen[0]?.identity).toBeUndefined();
    expect(seen[0]?.sessionId).toBeTruthy();
    expect(seen[0]?.userId).toBeNull();
  });

  it("Home lists Account by its registered label when signed out", async () => {
    h = makeHost();
    const opened = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/home/open",
      headers: headers(),
      body: { path: "/" },
    });
    const home = opened.body as RefreshResult;
    expect(home.warm.map((n) => n.label)).toEqual([
      "Bible",
      "Account",
      expect.stringContaining("Help."),
    ]);
  });

  it("Bible still works with an anonymous session", async () => {
    h = makeHost();
    const out = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/bible/open",
      headers: headers(),
      body: { path: "/kjv/Genesis/1/1" },
    });
    expect(out.status).toBe(200);
    const body = out.body as RefreshResult;
    expect(body.node.label).toContain("In the beginning");
    expect(body.location).toEqual({ appId: "bible", path: "/kjv/Genesis/1/1" });
  });
});
