import { afterEach, describe, expect, it } from "vitest";
import { createNowiseeHost } from "../server/host.ts";
import { handleSessionHttp } from "../server/http.ts";
import {
  associatedData,
  open,
  seal,
  type LockboxKeyring,
} from "../server/lockbox/crypto.ts";
import { LockboxError, MAX_BLOB_BYTES } from "../server/lockbox/errors.ts";
import { generateHostSigningKeyPair } from "../src/apps/wireCtx.ts";
import type { AppModule, AppServerContext, RefreshResult } from "../src/core/types.ts";
import { capturingMailer, TEST_OTP_PEPPER, signInForTest, type CapturingMailer } from "./helpers/signIn.ts";
import { startTestFleet, type ProbeSpec, type TestFleet } from "./helpers/fleet.ts";

const ORIGIN = "http://localhost:5173";

function testKeyring(): LockboxKeyring {
  return { currentId: "v1", keys: { v1: new Uint8Array(32).fill(7) } };
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

function lockboxProbe(): AppModule {
  return {
    id: "probe",
    label: "Probe",
    async open(path, extras, ctx) {
      return runLockbox("probe", path, extras, ctx);
    },
    async refresh(nodeId, extras, ctx) {
      return runLockbox("probe", nodeId, extras, ctx);
    },
  };
}

function notesSpy(): AppModule {
  return {
    id: "notes-spy",
    label: "Spy",
    async open(_path, _extras, ctx) {
      return runLockbox("notes-spy", "/get", {}, ctx);
    },
    async refresh(_nodeId, extras, ctx) {
      return runLockbox("notes-spy", "/get", extras, ctx);
    },
  };
}

async function runLockbox(
  appId: string,
  op: string,
  extras: { inputText?: string } | undefined,
  ctx: AppServerContext | undefined,
): Promise<RefreshResult> {
  const lockbox = ctx?.lockbox;
  if (!lockbox) {
    return emptyRefresh(appId, "no-lockbox");
  }
  try {
    if (op === "/put" || op.endsWith("/put")) {
      await lockbox.put("personal", new TextEncoder().encode(extras?.inputText ?? "alice-secret"));
      return emptyRefresh(appId, "stored");
    }
    if (op === "/get" || op.endsWith("/get")) {
      const got = await lockbox.get("personal");
      if (!got) {
        return emptyRefresh(appId, "null");
      }
      return emptyRefresh(appId, new TextDecoder().decode(got));
    }
    if (op === "/unsigned") {
      await lockbox.get("personal");
      return emptyRefresh(appId, "ok");
    }
    if (op === "/invalid-slot") {
      await lockbox.put("Personal", new Uint8Array([1]));
      return emptyRefresh(appId, "ok");
    }
    if (op === "/too-large") {
      await lockbox.put("personal", new Uint8Array(MAX_BLOB_BYTES + 1));
      return emptyRefresh(appId, "ok");
    }
    return emptyRefresh(appId, "ok");
  } catch (err) {
    return emptyRefresh(appId, capCode(err));
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

describe("lockbox", () => {
  let fleet: TestFleet;
  let mailer: CapturingMailer;

  afterEach(async () => {
    await fleet?.close();
  });

  async function boot(probes: readonly ProbeSpec[]) {
    mailer = capturingMailer();
    fleet = await startTestFleet({
      apps: ["notes"],
      probes,
      mailer,
      configuredOrigin: ORIGIN,
      lockboxKeys: testKeyring(),
    });
    return fleet.host;
  }

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

  it("throws missing-key when the blob's key is not in the ring", () => {
    const v1 = testKeyring();
    const aad = associatedData("user-a", "probe", "personal");
    const blob = seal(v1, new TextEncoder().encode("secret-token"), aad);
    const v2: LockboxKeyring = { currentId: "v2", keys: { v2: new Uint8Array(32).fill(9) } };
    try {
      open(v2, blob, aad);
      expect.unreachable("expected missing-key");
    } catch (err) {
      expect(err).toBeInstanceOf(LockboxError);
      expect((err as LockboxError).code).toBe("missing-key");
    }
  });

  it("isolates other users and other apps; Notes lockbox is 403", async () => {
    const h = await boot([
      { app: lockboxProbe(), grantLockbox: true },
      { app: notesSpy() },
    ]);
    const alice = await signInForTest(h, mailer, "alice@example.com");
    const stored = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/probe/open",
      headers: headers(alice.cookie),
      body: { path: "/put", extras: { inputText: "alice-secret" } },
    });
    expect((stored.body as RefreshResult).node.label).toBe("stored");

    const bob = await signInForTest(h, mailer, "bob@example.com");
    const bobGet = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/probe/open",
      headers: headers(bob.cookie),
      body: { path: "/get" },
    });
    expect((bobGet.body as RefreshResult).node.label).toBe("null");

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
    const bobCopied = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/probe/open",
      headers: headers(bob.cookie),
      body: { path: "/get" },
    });
    expect((bobCopied.body as RefreshResult).node.label).toBe("decrypt-failed");

    const notesOut = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/notes-spy/open",
      headers: headers(alice.cookie),
      body: { path: "/" },
    });
    expect((notesOut.body as RefreshResult).node.label).toBe("forbidden");
  });

  it("unsigned-in lockbox throws; blob size is capped; invalid slots are rejected", async () => {
    const h = await boot([{ app: lockboxProbe(), grantLockbox: true }]);
    const unsigned = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/probe/open",
      headers: headers(),
      body: { path: "/unsigned" },
    });
    expect((unsigned.body as RefreshResult).node.label).toBe("not-signed-in");

    const alice = await signInForTest(h, mailer, "ada@example.com");
    const slot = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/probe/open",
      headers: headers(alice.cookie),
      body: { path: "/invalid-slot" },
    });
    expect((slot.body as RefreshResult).node.label).toBe("invalid-slot");
    const large = await handleSessionHttp(h, {
      method: "POST",
      url: "/api/apps/probe/open",
      headers: headers(alice.cookie),
      body: { path: "/too-large" },
    });
    expect((large.body as RefreshResult).node.label).toBe("too-large");
  });

  it("production host requires a lockbox key when signing is configured", async () => {
    const prevKey = process.env.NOWISEE_LOCKBOX_KEY;
    const prevId = process.env.NOWISEE_LOCKBOX_KEY_ID;
    delete process.env.NOWISEE_LOCKBOX_KEY;
    delete process.env.NOWISEE_LOCKBOX_KEY_ID;
    const keys = generateHostSigningKeyPair();
    try {
      await expect(
        createNowiseeHost({
          ephemeral: false,
          mailer: capturingMailer(),
          otpPepper: TEST_OTP_PEPPER,
          configuredOrigin: ORIGIN,
          hostSigningKey: keys.privateKey,
        }),
      ).rejects.toThrow(/NOWISEE_LOCKBOX_KEY/);
    } finally {
      if (prevKey !== undefined) {
        process.env.NOWISEE_LOCKBOX_KEY = prevKey;
      }
      if (prevId !== undefined) {
        process.env.NOWISEE_LOCKBOX_KEY_ID = prevId;
      }
    }
  });
});
