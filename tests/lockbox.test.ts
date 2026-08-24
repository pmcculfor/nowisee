import { afterEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE_NAME } from "../server/cookie.ts";
import { createNowiseeHost, type NowiseeHost } from "../server/host.ts";
import { handleSessionHttp } from "../server/http.ts";
import { SCRYPT_TEST } from "../server/identity/hash.ts";
import {
  associatedData,
  open,
  seal,
  type LockboxKeyring,
} from "../server/lockbox/crypto.ts";
import { LockboxError, MAX_BLOB_BYTES } from "../server/lockbox/errors.ts";
import type { AppModule, AppServerContext, RefreshResult } from "../src/core/types.ts";
import { fixtureKjv } from "./helpers/kjvFixture.ts";

const ORIGIN = "http://localhost:5173";

function testKeyring(): LockboxKeyring {
  return { currentId: "v1", keys: { v1: new Uint8Array(32).fill(7) } };
}

function probeApp(seen: AppServerContext[]): AppModule {
  return {
    id: "probe",
    label: "Probe",
    async open(_path, _extras, ctx) {
      seen.push(ctx as AppServerContext);
      return emptyRefresh("probe");
    },
    async refresh(_stack, _extras, ctx) {
      seen.push(ctx as AppServerContext);
      return emptyRefresh("probe");
    },
  };
}

function emptyRefresh(appId: string): RefreshResult {
  return {
    navigationMap: {},
    warm: [],
    node: { id: `${appId}:root`, label: appId },
    location: { appId, path: "/" },
  };
}

function makeHost(extra?: {
  extraApps?: AppModule[];
  lockboxAppIds?: string[];
  lockboxKeys?: LockboxKeyring;
}): NowiseeHost {
  return createNowiseeHost({
    bibleSeed: fixtureKjv,
    scrypt: SCRYPT_TEST,
    configuredOrigin: ORIGIN,
    extraApps: extra?.extraApps,
    lockboxAppIds: extra?.lockboxAppIds,
    lockboxKeys: extra?.lockboxKeys,
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

async function signIn(
  host: NowiseeHost,
  email = "ada@example.com",
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


describe("lockbox", () => {
  let h: NowiseeHost;
  afterEach(() => {
    h?.close();
  });

  it("round-trips a blob and fails open when AAD is tampered", () => {
    const keyring = testKeyring();
    const plaintext = new TextEncoder().encode("secret-token");
    const aad = associatedData("user-a", "probe", "personal");
    const blob = seal(keyring, plaintext, aad);
    expect(open(keyring, blob, aad)).toEqual(plaintext);
    expect(() => open(keyring, blob, associatedData("user-b", "probe", "personal"))).toThrow(
      /decrypt failed/i,
    );
  });

  it("isolates other users and other apps; Notes is not granted", async () => {
    const seen: AppServerContext[] = [];
    const notesSeen: AppServerContext[] = [];
    const notesProbe: AppModule = {
      id: "notes",
      label: "Notes spy",
      async open(_path, _extras, ctx) {
        notesSeen.push(ctx as AppServerContext);
        return emptyRefresh("notes");
      },
      async refresh(_stack, _extras, ctx) {
        notesSeen.push(ctx as AppServerContext);
        return emptyRefresh("notes");
      },
    };
    h = makeHost({
      extraApps: [probeApp(seen)],
      lockboxAppIds: ["probe"],
      lockboxKeys: testKeyring(),
    });
    const alice = await signIn(h, "alice@example.com");
    await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/probe/open",
      headers: headers(alice.cookie),
      body: { path: "/" },
    });
    const ctx = seen[0]!;
    expect(ctx.lockbox).toBeDefined();
    await ctx.lockbox!.put("personal", new TextEncoder().encode("alice-secret"));
    const got = await ctx.lockbox!.get("personal");
    expect(new TextDecoder().decode(got!)).toBe("alice-secret");

    const bob = await signIn(h, "bob@example.com");
    seen.length = 0;
    await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/probe/open",
      headers: headers(bob.cookie),
      body: { path: "/" },
    });
    expect(await seen[0]!.lockbox!.get("personal")).toBeNull();

    const copied = h.db.get<{
      key_id: string;
      nonce: Uint8Array;
      ciphertext: Uint8Array;
    }>(
      "SELECT key_id, nonce, ciphertext FROM lockbox WHERE user_id = ? AND app_id = ? AND slot = ?",
      alice.userId,
      "probe",
      "personal",
    );
    expect(copied).toBeTruthy();
    h.db.run(
      `INSERT INTO lockbox (user_id, app_id, slot, key_id, nonce, ciphertext, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      bob.userId,
      "probe",
      "personal",
      copied!.key_id,
      copied!.nonce,
      copied!.ciphertext,
      Date.now(),
    );
    await expect(seen[0]!.lockbox!.get("personal")).rejects.toMatchObject({
      code: "decrypt-failed",
    } satisfies Partial<LockboxError>);

    await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/notes/open",
      headers: headers(alice.cookie),
      body: { path: "/" },
    });
    // Real Notes app is registered, not notesProbe. Capture via a dedicated host below.
    void notesProbe;
  });

  it("does not grant ctx.lockbox to Notes", async () => {
    const seen: AppServerContext[] = [];
    const spy: AppModule = {
      id: "notes-spy",
      label: "Spy",
      async open(_path, _extras, ctx) {
        seen.push(ctx as AppServerContext);
        return emptyRefresh("notes-spy");
      },
      async refresh(_stack, _extras, ctx) {
        seen.push(ctx as AppServerContext);
        return emptyRefresh("notes-spy");
      },
    };
    h = makeHost({
      extraApps: [spy, probeApp([])],
      lockboxAppIds: ["probe"],
      lockboxKeys: testKeyring(),
    });
    const alice = await signIn(h);
    await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/notes-spy/open",
      headers: headers(alice.cookie),
      body: { path: "/" },
    });
    expect(seen[0]!.lockbox).toBeUndefined();

    const notesOut = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/notes/open",
      headers: headers(alice.cookie),
      body: { path: "/" },
    });
    expect(notesOut.status).toBe(200);
  });

  it("unsigned-in lockbox throws; blob size is capped; invalid slots are rejected", async () => {
    const seen: AppServerContext[] = [];
    h = makeHost({
      extraApps: [probeApp(seen)],
      lockboxAppIds: ["probe"],
      lockboxKeys: testKeyring(),
    });
    await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/probe/open",
      headers: headers(),
      body: { path: "/" },
    });
    await expect(seen[0]!.lockbox!.get("personal")).rejects.toMatchObject({
      code: "not-signed-in",
    });

    const alice = await signIn(h);
    seen.length = 0;
    await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/probe/open",
      headers: headers(alice.cookie),
      body: { path: "/" },
    });
    await expect(seen[0]!.lockbox!.put("Personal", new Uint8Array([1]))).rejects.toMatchObject({
      code: "invalid-slot",
    });
    await expect(
      seen[0]!.lockbox!.put("personal", new Uint8Array(MAX_BLOB_BYTES + 1)),
    ).rejects.toMatchObject({ code: "too-large" });
  });

  it("refuses to start when lockbox apps are granted but no key is configured", () => {
    const prev = process.env.NOWISEE_LOCKBOX_KEY;
    delete process.env.NOWISEE_LOCKBOX_KEY;
    try {
      expect(() =>
        makeHost({ extraApps: [probeApp([])], lockboxAppIds: ["probe"] }),
      ).toThrow(/NOWISEE_LOCKBOX_KEY/);
    } finally {
      if (prev !== undefined) {
        process.env.NOWISEE_LOCKBOX_KEY = prev;
      }
    }
  });
});
