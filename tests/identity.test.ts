import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../server/db/index.ts";
import { SIGN_IN_CODE_TTL_MS } from "../server/identity/code.ts";
import { createIdentityService, hashToken, type IdentityService } from "../server/identity/service.ts";
import { capturingMailer, TEST_OTP_PEPPER, type CapturingMailer } from "./helpers/signIn.ts";

function service(
  db: Db,
  extra?: {
    allowRegistration?: boolean;
    now?: () => number;
    mailer?: CapturingMailer;
  },
): { id: IdentityService; mailer: CapturingMailer } {
  const mailer = extra?.mailer ?? capturingMailer();
  return {
    id: createIdentityService({
      db,
      mailer,
      otpPepper: TEST_OTP_PEPPER,
      allowRegistration: extra?.allowRegistration,
      now: extra?.now,
    }),
    mailer,
  };
}

describe("identity service", () => {
  let db: Db | undefined;
  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it("resolve with no token creates an anonymous session, not a user", async () => {
    db = openDatabase({ path: ":memory:" });
    const { id } = service(db);
    const first = await id.resolve(null);
    expect(first.userId).toBeNull();
    expect(first.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(first.issuedToken?.value).toBeTruthy();
    expect(first.issuedToken!.value).toHaveLength(43);

    const stored = db.get<{ token_hash: string; user_id: string | null }>(
      "SELECT token_hash, user_id FROM sessions WHERE id = ?",
      first.sessionId,
    );
    expect(stored?.user_id).toBeNull();
    expect(stored?.token_hash).toBe(hashToken(first.issuedToken!.value));
    expect(stored?.token_hash).not.toBe(first.issuedToken!.value);
  });

  it("resolve with a live token returns the same session and no new cookie", async () => {
    db = openDatabase({ path: ":memory:" });
    const { id } = service(db);
    const created = await id.resolve(null);
    const again = await id.resolve(created.issuedToken!.value);
    expect(again.sessionId).toBe(created.sessionId);
    expect(again.userId).toBeNull();
    expect(again.issuedToken).toBeUndefined();
  });

  it("dead or unknown token mints a new anonymous session", async () => {
    db = openDatabase({ path: ":memory:" });
    const { id } = service(db);
    const dead = await id.resolve("not-a-real-token");
    expect(dead.userId).toBeNull();
    expect(dead.issuedToken?.value).toBeTruthy();
  });

  it("verifySignIn rotates the token, keeps the session row, and creates the user", async () => {
    db = openDatabase({ path: ":memory:" });
    const { id, mailer } = service(db);
    const anon = await id.resolve(null);
    const requested = await id.requestSignIn(anon.sessionId, "Ada@Example.com");
    expect(requested).toEqual({ ok: true });
    expect(mailer.messages[0]?.subject).toBe("Your Now I See sign-in code");
    expect(mailer.messages[0]?.text).toMatch(/^Your Now I See sign-in code is /);
    const verified = await id.verifySignIn(anon.sessionId, mailer.lastCode());
    expect(verified.ok).toBe(true);
    if (!verified.ok) {
      return;
    }
    expect(verified.issuedToken.value).not.toBe(anon.issuedToken!.value);

    const sessions = db.all<{ id: string; user_id: string }>("SELECT id, user_id FROM sessions");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.id).toBe(anon.sessionId);
    expect(sessions[0]!.user_id).toBe(verified.userId);

    const old = await id.resolve(anon.issuedToken!.value);
    expect(old.sessionId).not.toBe(anon.sessionId);
    expect(old.userId).toBeNull();

    const fresh = await id.resolve(verified.issuedToken.value);
    expect(fresh.sessionId).toBe(anon.sessionId);
    expect(fresh.userId).toBe(verified.userId);

    const user = db.get<{ email: string }>("SELECT email FROM users WHERE id = ?", verified.userId);
    expect(user?.email).toBe("ada@example.com");
  });

  it("stores an HMAC of the code, not the digits", async () => {
    db = openDatabase({ path: ":memory:" });
    const { id, mailer } = service(db);
    const anon = await id.resolve(null);
    await id.requestSignIn(anon.sessionId, "a@b.co");
    const code = mailer.lastCode();
    const row = db.get<{ code_hash: string }>(
      "SELECT code_hash FROM login_challenges WHERE session_id = ?",
      anon.sessionId,
    );
    expect(row?.code_hash).toBeTruthy();
    expect(row?.code_hash).not.toBe(code);
    expect(row?.code_hash).toHaveLength(64);
  });

  it("accepts spaced and uppercase codes", async () => {
    db = openDatabase({ path: ":memory:" });
    const { id, mailer } = service(db);
    const anon = await id.resolve(null);
    await id.requestSignIn(anon.sessionId, "a@b.co");
    const code = mailer.lastCode();
    const spaced = `${code[0]} ${code[1]} ${code[2]} ${code[3]} ${code[4]} ${code[5]}`.toUpperCase();
    const verified = await id.verifySignIn(anon.sessionId, spaced);
    expect(verified.ok).toBe(true);
  });

  it("a second verify of the same code fails", async () => {
    db = openDatabase({ path: ":memory:" });
    const { id, mailer } = service(db);
    const anon = await id.resolve(null);
    await id.requestSignIn(anon.sessionId, "a@b.co");
    const code = mailer.lastCode();
    expect((await id.verifySignIn(anon.sessionId, code)).ok).toBe(true);
    expect(await id.verifySignIn(anon.sessionId, code)).toEqual({
      ok: false,
      reason: "invalid-credentials",
    });
  });

  it("five failed attempts lock the challenge", async () => {
    db = openDatabase({ path: ":memory:" });
    const { id, mailer } = service(db);
    const anon = await id.resolve(null);
    await id.requestSignIn(anon.sessionId, "a@b.co");
    const code = mailer.lastCode();
    for (let i = 0; i < 5; i++) {
      expect(await id.verifySignIn(anon.sessionId, "zzz000")).toEqual({
        ok: false,
        reason: "invalid-credentials",
      });
    }
    expect(await id.verifySignIn(anon.sessionId, code)).toEqual({
      ok: false,
      reason: "invalid-credentials",
    });
  });

  it("requestSignIn is throttled if called twice within 30 seconds", async () => {
    db = openDatabase({ path: ":memory:" });
    const { id } = service(db);
    const anon = await id.resolve(null);
    expect(await id.requestSignIn(anon.sessionId, "a@b.co")).toEqual({ ok: true });
    expect(await id.requestSignIn(anon.sessionId, "a@b.co")).toEqual({
      ok: false,
      reason: "throttled",
    });
  });

  it("an expired challenge cannot be verified", async () => {
    db = openDatabase({ path: ":memory:" });
    let at = 1_000_000;
    const { id, mailer } = service(db, { now: () => at });
    const anon = await id.resolve(null);
    await id.requestSignIn(anon.sessionId, "a@b.co");
    const code = mailer.lastCode();
    at += SIGN_IN_CODE_TTL_MS + 1;
    expect(await id.verifySignIn(anon.sessionId, code)).toEqual({
      ok: false,
      reason: "invalid-credentials",
    });
  });

  it("closed registration does not send mail for an unknown email", async () => {
    db = openDatabase({ path: ":memory:" });
    const { id, mailer } = service(db, { allowRegistration: false });
    const anon = await id.resolve(null);
    expect(await id.requestSignIn(anon.sessionId, "nobody@b.co")).toEqual({ ok: true });
    expect(mailer.messages).toHaveLength(0);
    expect(await id.verifySignIn(anon.sessionId, "aaa000")).toEqual({
      ok: false,
      reason: "invalid-credentials",
    });
  });

  it("requestSignIn does not rotate the cookie", async () => {
    db = openDatabase({ path: ":memory:" });
    const { id } = service(db);
    const anon = await id.resolve(null);
    const requested = await id.requestSignIn(anon.sessionId, "a@b.co");
    expect(requested).toEqual({ ok: true });
    expect("issuedToken" in requested).toBe(false);
    const again = await id.resolve(anon.issuedToken!.value);
    expect(again.sessionId).toBe(anon.sessionId);
    expect(again.userId).toBeNull();
  });

  it("malformed email is invalid-credentials", async () => {
    db = openDatabase({ path: ":memory:" });
    const { id } = service(db);
    const anon = await id.resolve(null);
    expect(await id.requestSignIn(anon.sessionId, "not-an-email")).toEqual({
      ok: false,
      reason: "invalid-credentials",
    });
  });
});
