import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE_NAME } from "../server/cookie.ts";
import { createNowiseeHost, type NowiseeHost } from "../server/host.ts";
import { handleSessionHttp } from "../server/http.ts";
import { SCRYPT_TEST } from "../server/identity/hash.ts";
import type { LockboxKeyring } from "../server/lockbox/crypto.ts";
import { handleOAuthHttp } from "../server/oauth/http.ts";
import { mapOAuthSecrets } from "../server/oauth/secrets.ts";
import type { AppModule, AppServerContext, RefreshResult } from "../src/core/types.ts";
import { fixtureKjv } from "./helpers/kjvFixture.ts";

const ORIGIN = "http://localhost:5173";

function testKeyring(): LockboxKeyring {
  return { currentId: "v1", keys: { v1: new Uint8Array(32).fill(9) } };
}

function emptyRefresh(appId: string): RefreshResult {
  return {
    navigationMap: {},
    warm: [],
    node: { id: `${appId}:root`, label: appId },
    location: { appId, path: "/" },
  };
}

function probe(id: string, seen: AppServerContext[]): AppModule {
  return {
    id,
    label: id,
    async open(_path, _extras, ctx) {
      seen.push(ctx as AppServerContext);
      return emptyRefresh(id);
    },
    async refresh(_stack, _extras, ctx) {
      seen.push(ctx as AppServerContext);
      return emptyRefresh(id);
    },
  };
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

async function signIn(
  host: NowiseeHost,
  email: string,
): Promise<{ cookie: string; userId: string }> {
  const anon = await host.identity.resolve(null);
  const registered = await host.identity.register(anon.sessionId, email, "password12");
  expect(registered.ok).toBe(true);
  if (!registered.ok) {
    throw new Error("register failed");
  }
  return {
    cookie: `${SESSION_COOKIE_NAME}=${registered.issuedToken.value}`,
    userId: registered.userId,
  };
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
  let idp: MockIdp | undefined;

  afterEach(async () => {
    h?.close();
    await idp?.close();
    idp = undefined;
  });

  async function hostFor(apps: string[]): Promise<Record<string, AppServerContext[]>> {
    const seen: Record<string, AppServerContext[]> = {};
    const extraApps = apps.map((id) => {
      seen[id] = [];
      return probe(id, seen[id]!);
    });
    h = createNowiseeHost({
      bibleSeed: fixtureKjv,
      scrypt: SCRYPT_TEST,
      configuredOrigin: ORIGIN,
      extraApps,
      lockboxKeys: testKeyring(),
      oauthAppIds: apps,
      oauthProviders: apps.map((id) => ({
        appId: id,
        authorizationEndpoint: `${idp!.origin}/authorize`,
        tokenEndpoint: `${idp!.origin}/token-${id === "probe-b" ? "b" : "a"}`,
        revokeEndpoint: `${idp!.origin}/revoke`,
        scopes: ["email"],
        extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
      })),
      oauthSecrets: mapOAuthSecrets(
        Object.fromEntries(
          apps.map((id) => [id, { clientId: `${id}-id`, clientSecret: `${id}-secret` }]),
        ),
      ),
    });
    return seen;
  }

  it("builds a PKCE authorize URL and reuses it until the callback", async () => {
    idp = await startMockIdp();
    const seen = await hostFor(["probe"]);
    const alice = await signIn(h, "alice@example.com");
    await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/probe/open",
      headers: headers(alice.cookie),
      body: { path: "/" },
    });
    const oauth = seen.probe![0]!.oauth!;
    const first = await oauth.start({ slot: "personal" });
    const url = new URL(first.authorizeUrl);
    expect(url.origin + url.pathname).toBe(`${idp.origin}/authorize`);
    expect(url.searchParams.get("client_id")).toBe("probe-id");
    expect(url.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/oauth/callback`);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("email");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(url.searchParams.get("access_type")).toBe("offline");
    const second = await oauth.start({ slot: "personal" });
    expect(second.authorizeUrl).toBe(first.authorizeUrl);
    expect(await oauth.status("personal")).toBe("missing");
  });

  it("unsigned-in start fails", async () => {
    idp = await startMockIdp();
    const seen = await hostFor(["probe"]);
    await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/probe/open",
      headers: headers(),
      body: { path: "/" },
    });
    await expect(seen.probe![0]!.oauth!.start({ slot: "personal" })).rejects.toMatchObject({
      code: "not-signed-in",
    });
  });

  it("callback stores tokens; redirect body and Location never contain them", async () => {
    idp = await startMockIdp();
    const seen = await hostFor(["probe"]);
    const alice = await signIn(h, "alice@example.com");
    await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/probe/open",
      headers: headers(alice.cookie),
      body: { path: "/" },
    });
    const oauth = seen.probe![0]!.oauth!;
    const started = await oauth.start({ slot: "personal" });
    const state = new URL(started.authorizeUrl).searchParams.get("state")!;
    const out = await handleOAuthHttp(h, {
      method: "GET",
      url: `/oauth/callback?code=ok&state=${state}`,
      headers: { cookie: alice.cookie },
    });
    expect(out.status).toBe(302);
    expect(out.body).toBe("");
    expect(out.headers?.["Cache-Control"]).toBe("no-store");
    expect(out.headers?.["X-Frame-Options"]).toBe("DENY");
    expect(out.headers?.Location).toBe(`${ORIGIN}/#/probe`);
    expect(JSON.stringify(out)).not.toContain("access-1");
    expect(JSON.stringify(out)).not.toContain("refresh-1");
    expect(idp.tokenPosts[0]?.code_verifier).toBeTruthy();
    expect(idp.tokenPosts[0]?.redirect_uri).toBe(`${ORIGIN}/oauth/callback`);
    expect(await oauth.status("personal")).toBe("ready");
    expect(await oauth.getAccessToken("personal")).toBe("access-1");
    expect(idp.refreshCount).toBe(0);
  });

  it("rejects bad state, replay, access_denied, session mismatch, and mix-up", async () => {
    idp = await startMockIdp();
    const seen = await hostFor(["probe", "probe-b"]);
    const alice = await signIn(h, "alice@example.com");
    const bob = await signIn(h, "bob@example.com");
    await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/probe/open",
      headers: headers(alice.cookie),
      body: { path: "/" },
    });
    const oauth = seen.probe![0]!.oauth!;

    const bad = await handleOAuthHttp(h, {
      method: "GET",
      url: "/oauth/callback?code=ok&state=not-a-real-state",
      headers: { cookie: alice.cookie },
    });
    expect(bad.headers?.Location).toBe(`${ORIGIN}/#/`);

    const started = await oauth.start({ slot: "personal" });
    const state = new URL(started.authorizeUrl).searchParams.get("state")!;
    const denied = await handleOAuthHttp(h, {
      method: "GET",
      url: `/oauth/callback?error=access_denied&state=${state}`,
      headers: { cookie: alice.cookie },
    });
    expect(denied.headers?.Location).toBe(`${ORIGIN}/#/probe`);
    expect(await oauth.status("personal")).toBe("missing");

    const started2 = await oauth.start({ slot: "personal" });
    const state2 = new URL(started2.authorizeUrl).searchParams.get("state")!;
    const mismatch = await handleOAuthHttp(h, {
      method: "GET",
      url: `/oauth/callback?code=ok&state=${state2}`,
      headers: { cookie: bob.cookie },
    });
    expect(mismatch.headers?.Location).toBe(`${ORIGIN}/#/`);
    expect(await oauth.status("personal")).toBe("missing");

    await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/probe-b/open",
      headers: headers(alice.cookie),
      body: { path: "/" },
    });
    const oauthB = seen["probe-b"]![0]!.oauth!;
    const startedA = await oauth.start({ slot: "personal" });
    const stateA = new URL(startedA.authorizeUrl).searchParams.get("state")!;
    const mix = await handleOAuthHttp(h, {
      method: "GET",
      url: `/oauth/callback?code=code-b&state=${stateA}`,
      headers: { cookie: alice.cookie },
    });
    expect(mix.headers?.Location).toBe(`${ORIGIN}/#/probe`);
    expect(await oauth.status("personal")).toBe("missing");
    expect(await oauthB.status("personal")).toBe("missing");

    const started3 = await oauth.start({ slot: "personal" });
    const state3 = new URL(started3.authorizeUrl).searchParams.get("state")!;
    const ok = await handleOAuthHttp(h, {
      method: "GET",
      url: `/oauth/callback?code=ok&state=${state3}`,
      headers: { cookie: alice.cookie },
    });
    expect(ok.headers?.Location).toBe(`${ORIGIN}/#/probe`);
    const replay = await handleOAuthHttp(h, {
      method: "GET",
      url: `/oauth/callback?code=ok&state=${state3}`,
      headers: { cookie: alice.cookie },
    });
    expect(replay.headers?.Location).toBe(`${ORIGIN}/#/`);
  });

  it("skips refresh when unexpired and disconnects", async () => {
    idp = await startMockIdp();
    const seen = await hostFor(["probe"]);
    const alice = await signIn(h, "alice@example.com");
    await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/probe/open",
      headers: headers(alice.cookie),
      body: { path: "/" },
    });
    const oauth = seen.probe![0]!.oauth!;
    const started = await oauth.start({ slot: "personal" });
    const state = new URL(started.authorizeUrl).searchParams.get("state")!;
    await handleOAuthHttp(h, {
      method: "GET",
      url: `/oauth/callback?code=ok&state=${state}`,
      headers: { cookie: alice.cookie },
    });
    expect(await oauth.getAccessToken("personal")).toBe("access-1");
    expect(await oauth.getAccessToken("personal")).toBe("access-1");
    expect(idp.refreshCount).toBe(0);
    await oauth.disconnect("personal");
    expect(await oauth.status("personal")).toBe("missing");
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
    const seen = await hostFor(["probe"]);
    const alice = await signIn(h, "alice@example.com");
    await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/probe/open",
      headers: headers(alice.cookie),
      body: { path: "/" },
    });
    const oauth = seen.probe![0]!.oauth!;
    const started = await oauth.start({ slot: "personal" });
    const state = new URL(started.authorizeUrl).searchParams.get("state")!;
    await handleOAuthHttp(h, {
      method: "GET",
      url: `/oauth/callback?code=ok&state=${state}`,
      headers: { cookie: alice.cookie },
    });
    const [a, b] = await Promise.all([oauth.getAccessToken("personal"), oauth.getAccessToken("personal")]);
    expect(a).toBe("access-refreshed");
    expect(b).toBe("access-refreshed");
    expect(idp.refreshCount).toBe(1);

    await idp.close();
    idp = await startMockIdp({
      codeExpiresIn: 1,
      onRefresh: () => ({ error: "invalid_grant" }),
    });
    h.close();
    const seen2 = await hostFor(["probe"]);
    const carol = await signIn(h, "carol@example.com");
    await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/probe/open",
      headers: headers(carol.cookie),
      body: { path: "/" },
    });
    const oauth2 = seen2.probe![0]!.oauth!;
    const started2 = await oauth2.start({ slot: "personal" });
    const state2 = new URL(started2.authorizeUrl).searchParams.get("state")!;
    await handleOAuthHttp(h, {
      method: "GET",
      url: `/oauth/callback?code=ok&state=${state2}`,
      headers: { cookie: carol.cookie },
    });
    await expect(oauth2.getAccessToken("personal")).rejects.toMatchObject({
      code: "needs-reconnect",
    });
    expect(await oauth2.status("personal")).toBe("missing");
  });
});
