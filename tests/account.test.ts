import { afterEach, describe, expect, it } from "vitest";
import { handleSessionHttp } from "../server/http.ts";
import { NODE } from "../src/apps/account/ids.ts";
import { TUTORIAL_APP_LABEL } from "../src/apps/tutorial/ids.ts";
import type { AppModule, RefreshResult } from "../src/core/types.ts";
import { capturingMailer, type CapturingMailer } from "./helpers/signIn.ts";
import { startTestFleet, type TestFleet } from "./helpers/fleet.ts";

const ORIGIN = "http://localhost:5173";

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

function identityProbe(): AppModule {
  return {
    id: "probe",
    label: "Probe",
    async open(_path, _extras, ctx) {
      try {
        await ctx?.identity?.requestSignIn("x@example.com");
        return {
          navigationMap: {},
          warm: [],
          node: { id: "probe:root", label: "has-identity" },
          location: { appId: "probe", path: "/" },
        };
      } catch (err) {
        const code =
          typeof err === "object" && err !== null && "code" in err
            ? String((err as { code: unknown }).code)
            : "unknown";
        return {
          navigationMap: {},
          warm: [],
          node: { id: "probe:root", label: code },
          location: { appId: "probe", path: "/" },
        };
      }
    },
    refresh() {
      return {
        navigationMap: {},
        warm: [],
        node: { id: "probe:root", label: "probe" },
        location: { appId: "probe", path: "/" },
      };
    },
  };
}

describe("Account app", () => {
  let fleet: TestFleet;
  let mailer: CapturingMailer;

  afterEach(async () => {
    await fleet?.close();
  });

  async function boot(apps: readonly ("account" | "home" | "bible")[] = ["account"]) {
    mailer = capturingMailer();
    fleet = await startTestFleet({
      apps,
      mailer,
      configuredOrigin: ORIGIN,
    });
    return fleet.host;
  }

  it("signed-out open starts on the email prompt; signed-in open starts on Settings", async () => {
    const h = await boot();
    const opened = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/account/open",
      headers: headers(),
      body: { path: "/" },
    });
    expect(opened.status).toBe(200);
    const body = opened.body as RefreshResult;
    expect(body.node.id).toBe(NODE.start);
    expect(body.node.label).toBe("Enter your email on the next screen to sign in or register.");
    expect(body.navigationMap[NODE.start]?.enter).toEqual({
      kind: "node",
      toNodeId: NODE.email,
      stackBehavior: "push",
    });
    expect(body.warm.find((n) => n.id === NODE.codePrompt)?.label).toBe(
      "We sent a sign-in code to that email. Enter it on the next screen.",
    );
    expect(body.warm.find((n) => n.id === NODE.code)?.secret).toBeUndefined();
    expect(body.warm.find((n) => n.id === NODE.code)?.kind).toBe("input");
    expect(body.warm.find((n) => n.id === NODE.email)?.autocomplete).toBe("username");

    const cookie = cookieFrom(opened.headers?.["Set-Cookie"]);
    await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/account/refresh",
      headers: headers(cookie),
      body: {
        nodeId: NODE.codePrompt,
        extras: { action: { triggerId: NODE.email }, inputText: "user@example.com" },
      },
    });
    const signedIn = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/account/refresh",
      headers: headers(cookie),
      body: {
        nodeId: NODE.auth,
        extras: { action: { triggerId: NODE.code }, inputText: mailer.lastCode() },
      },
    });
    const signedBody = signedIn.body as RefreshResult;
    expect(signedBody.node.label).toBe("You are signed in as user@example.com.");
    expect(signedBody.location).toBeNull();
    expect(signedBody.navigationMap[NODE.auth]?.enter).toEqual({
      kind: "app",
      to: { appId: "home", path: "/app/account" },
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
    const h = await boot();
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
        nodeId: NODE.codePrompt,
        extras: { action: { triggerId: NODE.email }, inputText: "pat@example.com" },
      },
    });
    const action = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/account/refresh",
      headers: headers(anon),
      body: {
        nodeId: NODE.auth,
        extras: { action: { triggerId: NODE.code }, inputText: mailer.lastCode() },
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

  it("a wrong code is unsuccessful sign-in, and back pops to the existing code node", async () => {
    const h = await boot();
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
        nodeId: NODE.codePrompt,
        extras: { action: { triggerId: NODE.email }, inputText: "short@example.com" },
      },
    });
    const failed = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/account/refresh",
      headers: headers(cookie),
      body: {
        nodeId: NODE.auth,
        extras: { action: { triggerId: NODE.code }, inputText: "zzz000" },
      },
    });
    const body = failed.body as RefreshResult;
    expect(body.node.label).toBe("Sign-in was unsuccessful.");
    expect(body.navigationMap[NODE.auth]?.back).toEqual({ kind: "node", stackBehavior: "pop" });
    expect(body.navigationMap[NODE.auth]?.enter).toEqual({ kind: "node", stackBehavior: "pop" });
    expect(body.navigationMap[NODE.auth]?.back).not.toHaveProperty("toNodeId");
  });

  it("a throttled code request pops back to email", async () => {
    const h = await boot();
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
        nodeId: NODE.codePrompt,
        extras: { action: { triggerId: NODE.email }, inputText: "wait@example.com" },
      },
    });
    const throttled = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/account/refresh",
      headers: headers(cookie),
      body: {
        nodeId: NODE.codePrompt,
        extras: { action: { triggerId: NODE.email }, inputText: "wait@example.com" },
      },
    });
    const body = throttled.body as RefreshResult;
    expect(body.node.label).toBe("Please wait before requesting another sign-in code.");
    expect(body.navigationMap[NODE.codePrompt]?.back).toEqual({ kind: "node", stackBehavior: "pop" });
    expect(body.navigationMap[NODE.codePrompt]?.enter).toEqual({ kind: "node", stackBehavior: "pop" });
  });

  it("does not grant identity APIs to a non-Account app", async () => {
    mailer = capturingMailer();
    fleet = await startTestFleet({
      apps: [],
      probes: [{ app: identityProbe() }],
      mailer,
      configuredOrigin: ORIGIN,
    });
    const out = await handleSessionHttp(fleet.host, {
      method: "POST",
      url: "/api/apps/probe/open",
      headers: headers(),
      body: { path: "/" },
    });
    expect(out.status).toBe(200);
    expect((out.body as RefreshResult).node.label).toBe("forbidden");
  });

  it("Home lists Account by its registered label when signed out", async () => {
    const h = await boot(["home", "account"]);
    const opened = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/home/open",
      headers: headers(),
      body: { path: "/" },
    });
    const home = opened.body as RefreshResult;
    expect(home.warm.map((n) => n.label)).toEqual([
      TUTORIAL_APP_LABEL,
      "Bible",
      "Notes",
      "Lists",
      "Weather",
      "Account",
      "Manage Apps",
    ]);
  });

  it("Bible still works with an anonymous session", async () => {
    const h = await boot(["bible"]);
    const out = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/bible/open",
      headers: headers(),
      body: { path: "/Genesis/1/1" },
    });
    expect(out.status).toBe(200);
    const body = out.body as RefreshResult;
    expect(body.node.label).toContain("In the beginning");
    expect(body.location).toEqual({ appId: "bible", path: "/Genesis/1/1" });
  });
});
