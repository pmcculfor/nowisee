import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { NowiseeHost } from "../server/host.ts";
import { handleSessionHttp } from "../server/http.ts";
import type { LockboxKeyring } from "../server/lockbox/crypto.ts";
import { handleOAuthHttp } from "../server/oauth/http.ts";
import { mapOAuthSecrets } from "../server/oauth/secrets.ts";
import type { AppModule, AppServerContext, RefreshResult } from "../src/core/types.ts";
import { capturingMailer, signInForTest, type CapturingMailer } from "./helpers/signIn.ts";
import { startTestFleet, type TestFleet } from "./helpers/fleet.ts";

const ORIGIN = "http://localhost:5173";

function testKeyring(): LockboxKeyring {
  return { currentId: "v1", keys: { v1: new Uint8Array(32).fill(9) } };
}

function emptyRefresh(appId: string, label = appId): RefreshResult {
  return {
    navigationMap: {},
    warm: [],
    node: { id: `${appId}:root`, label },
    location: { appId, path: "/" },
  };
}

function capCode(err: unknown): string {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code: unknown }).code)
    : "unknown";
}

function oauthProbe(id: string): AppModule {
  return {
    id,
    label: id,
    open(path, _extras, ctx) {
      return runOauth(id, path, ctx);
    },
    refresh(nodeId, _extras, ctx) {
      return runOauth(id, nodeId, ctx);
    },
  };
}

async function runOauth(
  id: string,
  op: string,
  ctx: AppServerContext | undefined,
): Promise<RefreshResult> {
  const oauth = ctx?.oauth;
  if (!oauth) {
    return emptyRefresh(id, "no-oauth");
  }
  const path = op.startsWith("/") ? op : `/${op}`;
  try {
    if (path === "/start") {
      const started = await oauth.start({ slot: "personal" });
      return emptyRefresh(id, started.authorizeUrl);
    }
    if (path === "/status") {
      return emptyRefresh(id, await oauth.status("personal"));
    }
    if (path === "/token") {
      return emptyRefresh(id, await oauth.getAccessToken("personal"));
    }
    if (path === "/disconnect") {
      await oauth.disconnect("personal");
      return emptyRefresh(id, "disconnected");
    }
    return emptyRefresh(id, "ok");
  } catch (err) {
    return emptyRefresh(id, capCode(err));
  }
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

let currentMailer: CapturingMailer;

async function signIn(
  host: NowiseeHost,
  email: string,
): Promise<{ cookie: string; userId: string; sessionId: string }> {
  return signInForTest(host, currentMailer, email);
}

type MockIdp = {
  origin: string;
  tokenPosts: Array<Record<string, string>>;
  refreshCount: number;
  close: () => Promise<void>;
};

function startMockIdp(opts?: {
  codeExpiresIn?: number;
  onRefresh?: (body: Record<string, string>) => Record<string, unknown>;
}): Promise<MockIdp> {
  const tokenPosts: Array<Record<string, string>> = [];
  const state = { refreshCount: 0 };
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString("utf8")));
      tokenPosts.push(body);
      const path = req.url ?? "/";
      if (path === "/revoke") {
        res.statusCode = 200;
        res.end("ok");
        return;
      }
      res.setHeader("Content-Type", "application/json");
      if (body.grant_type === "refresh_token") {
        state.refreshCount += 1;
        const payload = opts?.onRefresh
          ? opts.onRefresh(body)
          : {
              access_token: `access-refreshed-${state.refreshCount}`,
              refresh_token: `refresh-rotated-${state.refreshCount}`,
              expires_in: 3600,
              token_type: "Bearer",
            };
        res.statusCode = typeof payload.error === "string" ? 400 : 200;
        res.end(JSON.stringify(payload));
        return;
      }
      if (body.grant_type === "authorization_code") {
        if (!body.code_verifier || !body.redirect_uri) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "invalid_request" }));
          return;
        }
        if (path === "/token-b" && body.code !== "code-b") {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "invalid_grant" }));
          return;
        }
        if (path !== "/token-b" && body.code === "code-b") {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "invalid_grant" }));
          return;
        }
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            access_token: "access-1",
            refresh_token: "refresh-1",
            expires_in: opts?.codeExpiresIn ?? 3600,
            token_type: "Bearer",
            scope: "email",
          }),
        );
        return;
      }
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "unsupported_grant_type" }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        origin: `http://127.0.0.1:${port}`,
        tokenPosts,
        get refreshCount() {
          return state.refreshCount;
        },
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
  });
}

describe("oauth broker", () => {
  let h: NowiseeHost;
  let fleet: TestFleet;
  let idp: MockIdp | undefined;

  afterEach(async () => {
    await fleet?.close();
    await idp?.close();
    idp = undefined;
  });

  async function hostFor(apps: string[]): Promise<void> {
    currentMailer = capturingMailer();
    fleet = await startTestFleet({
      apps: [],
      probes: apps.map((id) => ({
        app: oauthProbe(id),
        grantOauth: true,
        grantLockbox: true,
        oauthProvider: {
          appId: id,
          authorizationEndpoint: `${idp!.origin}/authorize`,
          tokenEndpoint: `${idp!.origin}/token-${id === "probe-b" ? "b" : "a"}`,
          revokeEndpoint: `${idp!.origin}/revoke`,
          scopes: ["email"],
          extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
        },
      })),
      mailer: currentMailer,
      configuredOrigin: ORIGIN,
      lockboxKeys: testKeyring(),
      oauthSecrets: mapOAuthSecrets(
        Object.fromEntries(
          apps.map((id) => [id, { clientId: `${id}-id`, clientSecret: `${id}-secret` }]),
        ),
      ),
    });
    h = fleet.host;
  }

  async function openLabel(appId: string, path: string, cookie?: string): Promise<string> {
    const out = await handleSessionHttp(h, {
      method: "POST",
      url: `/api/apps/${appId}/open`,
      headers: headers(cookie),
      body: { path },
    });
    return (out.body as RefreshResult).node.label;
  }

  it("builds a PKCE authorize URL and reuses it until the callback", async () => {
    idp = await startMockIdp();
    await hostFor(["probe"]);
    const alice = await signIn(h, "alice@example.com");
    const first = await openLabel("probe", "/start", alice.cookie);
    const url = new URL(first);
    expect(url.origin + url.pathname).toBe(`${idp.origin}/authorize`);
    expect(url.searchParams.get("client_id")).toBe("probe-id");
    expect(url.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/oauth/callback`);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("email");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(url.searchParams.get("access_type")).toBe("offline");
    const second = await openLabel("probe", "/start", alice.cookie);
    expect(second).toBe(first);
    expect(await openLabel("probe", "/status", alice.cookie)).toBe("missing");
  });

  it("unsigned-in start fails", async () => {
    idp = await startMockIdp();
    await hostFor(["probe"]);
    expect(await openLabel("probe", "/start")).toBe("not-signed-in");
  });

  it("callback stores tokens; redirect body and Location never contain them", async () => {
    idp = await startMockIdp();
    await hostFor(["probe"]);
    const alice = await signIn(h, "alice@example.com");
    const started = await openLabel("probe", "/start", alice.cookie);
    const state = new URL(started).searchParams.get("state")!;
    const out = await handleOAuthHttp(h, {
      method: "GET",
      url: `/oauth/callback?code=ok&state=${state}`,
      headers: { cookie: alice.cookie },
    });
    expect(out.status).toBe(302);
    expect(out.body).toBe("");
    expect(out.headers?.["Cache-Control"]).toBe("no-store");
    expect(out.headers?.["X-Frame-Options"]).toBe("DENY");
    expect(out.headers?.Location).toBe(`${ORIGIN}/probe`);
    expect(JSON.stringify(out)).not.toContain("access-1");
    expect(JSON.stringify(out)).not.toContain("refresh-1");
    expect(idp.tokenPosts[0]?.code_verifier).toBeTruthy();
    expect(idp.tokenPosts[0]?.redirect_uri).toBe(`${ORIGIN}/oauth/callback`);
    expect(await openLabel("probe", "/status", alice.cookie)).toBe("ready");
    expect(await openLabel("probe", "/token", alice.cookie)).toBe("access-1");
    expect(idp.refreshCount).toBe(0);
  });

  it("rejects bad state, replay, access_denied, session mismatch, and mix-up", async () => {
    idp = await startMockIdp();
    await hostFor(["probe", "probe-b"]);
    const alice = await signIn(h, "alice@example.com");
    const bob = await signIn(h, "bob@example.com");

    const bad = await handleOAuthHttp(h, {
      method: "GET",
      url: "/oauth/callback?code=ok&state=not-a-real-state",
      headers: { cookie: alice.cookie },
    });
    expect(bad.headers?.Location).toBe(`${ORIGIN}/`);

    const started = await openLabel("probe", "/start", alice.cookie);
    const state = new URL(started).searchParams.get("state")!;
    const denied = await handleOAuthHttp(h, {
      method: "GET",
      url: `/oauth/callback?error=access_denied&state=${state}`,
      headers: { cookie: alice.cookie },
    });
    expect(denied.headers?.Location).toBe(`${ORIGIN}/probe`);
    expect(await openLabel("probe", "/status", alice.cookie)).toBe("missing");

    const started2 = await openLabel("probe", "/start", alice.cookie);
    const state2 = new URL(started2).searchParams.get("state")!;
    const mismatch = await handleOAuthHttp(h, {
      method: "GET",
      url: `/oauth/callback?code=ok&state=${state2}`,
      headers: { cookie: bob.cookie },
    });
    expect(mismatch.headers?.Location).toBe(`${ORIGIN}/`);
    expect(await openLabel("probe", "/status", alice.cookie)).toBe("missing");

    const startedA = await openLabel("probe", "/start", alice.cookie);
    const stateA = new URL(startedA).searchParams.get("state")!;
    const mix = await handleOAuthHttp(h, {
      method: "GET",
      url: `/oauth/callback?code=code-b&state=${stateA}`,
      headers: { cookie: alice.cookie },
    });
    expect(mix.headers?.Location).toBe(`${ORIGIN}/probe`);
    expect(await openLabel("probe", "/status", alice.cookie)).toBe("missing");
    expect(await openLabel("probe-b", "/status", alice.cookie)).toBe("missing");

    const started3 = await openLabel("probe", "/start", alice.cookie);
    const state3 = new URL(started3).searchParams.get("state")!;
    const ok = await handleOAuthHttp(h, {
      method: "GET",
      url: `/oauth/callback?code=ok&state=${state3}`,
      headers: { cookie: alice.cookie },
    });
    expect(ok.headers?.Location).toBe(`${ORIGIN}/probe`);
    const replay = await handleOAuthHttp(h, {
      method: "GET",
      url: `/oauth/callback?code=ok&state=${state3}`,
      headers: { cookie: alice.cookie },
    });
    expect(replay.headers?.Location).toBe(`${ORIGIN}/`);
  });

  it("skips refresh when unexpired and disconnects", async () => {
    idp = await startMockIdp();
    await hostFor(["probe"]);
    const alice = await signIn(h, "alice@example.com");
    const started = await openLabel("probe", "/start", alice.cookie);
    const state = new URL(started).searchParams.get("state")!;
    await handleOAuthHttp(h, {
      method: "GET",
      url: `/oauth/callback?code=ok&state=${state}`,
      headers: { cookie: alice.cookie },
    });
    expect(await openLabel("probe", "/token", alice.cookie)).toBe("access-1");
    expect(await openLabel("probe", "/token", alice.cookie)).toBe("access-1");
    expect(idp.refreshCount).toBe(0);
    expect(await openLabel("probe", "/disconnect", alice.cookie)).toBe("disconnected");
    expect(await openLabel("probe", "/status", alice.cookie)).toBe("missing");
  });

  it("refreshes under a mutex; invalid_grant clears the slot", async () => {
    idp = await startMockIdp({
      codeExpiresIn: 1,
      onRefresh: () => ({
        access_token: "access-refreshed",
        refresh_token: "refresh-rotated",
        expires_in: 3600,
      }),
    });
    await hostFor(["probe"]);
    const alice = await signIn(h, "alice@example.com");
    const started = await openLabel("probe", "/start", alice.cookie);
    const state = new URL(started).searchParams.get("state")!;
    await handleOAuthHttp(h, {
      method: "GET",
      url: `/oauth/callback?code=ok&state=${state}`,
      headers: { cookie: alice.cookie },
    });
    const [a, b] = await Promise.all([
      openLabel("probe", "/token", alice.cookie),
      openLabel("probe", "/token", alice.cookie),
    ]);
    expect(a).toBe("access-refreshed");
    expect(b).toBe("access-refreshed");
    expect(idp.refreshCount).toBe(1);

    await idp.close();
    idp = await startMockIdp({
      codeExpiresIn: 1,
      onRefresh: () => ({ error: "invalid_grant" }),
    });
    await fleet.close();
    await hostFor(["probe"]);
    const carol = await signIn(h, "carol@example.com");
    const started2 = await openLabel("probe", "/start", carol.cookie);
    const state2 = new URL(started2).searchParams.get("state")!;
    await handleOAuthHttp(h, {
      method: "GET",
      url: `/oauth/callback?code=ok&state=${state2}`,
      headers: { cookie: carol.cookie },
    });
    expect(await openLabel("probe", "/token", carol.cookie)).toBe("needs-reconnect");
    expect(await openLabel("probe", "/status", carol.cookie)).toBe("missing");
  });

  it("expired callback cookie does not mint a session or Set-Cookie", async () => {
    idp = await startMockIdp();
    await hostFor(["probe"]);
    const alice = await signIn(h, "alice@example.com");
    const before = h.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM sessions")!.n;
    h.db.run("UPDATE sessions SET expires_at = 0 WHERE id = ?", alice.sessionId);
    const out = await handleOAuthHttp(h, {
      method: "GET",
      url: "/oauth/callback?code=ok&state=whatever",
      headers: { cookie: alice.cookie },
    });
    expect(out.status).toBe(302);
    expect(out.headers).not.toHaveProperty("Set-Cookie");
    expect(h.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM sessions")!.n).toBeLessThanOrEqual(
      before,
    );
  });
});
