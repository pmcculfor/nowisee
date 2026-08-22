import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../server/db/index.ts";
import { SCRYPT_PRODUCTION, SCRYPT_TEST } from "../server/identity/hash.ts";
import { createIdentityService, hashToken } from "../server/identity/service.ts";

function service(db: Db) {
  return createIdentityService({ db, scrypt: SCRYPT_TEST, hashConcurrency: 2 });
}

describe("identity service", () => {
  let db: Db | undefined;
  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it("resolve with no token creates an anonymous session, not a user", async () => {
    db = openDatabase({ path: ":memory:" });
    const id = service(db);
    const first = await id.resolve(null);
    expect(first.userId).toBeNull();
    expect(first.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(first.issuedToken?.value).toBeTruthy();
    expect(first.issuedToken!.value).toHaveLength(43); // 32 bytes base64url

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
    const id = service(db);
    const created = await id.resolve(null);
    const again = await id.resolve(created.issuedToken!.value);
    expect(again.sessionId).toBe(created.sessionId);
    expect(again.userId).toBeNull();
    expect(again.issuedToken).toBeUndefined();
  });

  it("dead or unknown token mints a new anonymous session", async () => {
    db = openDatabase({ path: ":memory:" });
    const id = service(db);
    const dead = await id.resolve("not-a-real-token");
    expect(dead.userId).toBeNull();
    expect(dead.issuedToken?.value).toBeTruthy();
  });

  it("sign-in rotates the token and keeps the session row", async () => {
    db = openDatabase({ path: ":memory:" });
    const id = service(db);
    const anon = await id.resolve(null);
    const registered = await id.register(anon.sessionId, "Ada@Example.com", "password1");
    expect(registered.ok).toBe(true);
    if (!registered.ok) {
      return;
    }
    expect(registered.issuedToken.value).not.toBe(anon.issuedToken!.value);

    const sessions = db.all<{ id: string; user_id: string }>("SELECT id, user_id FROM sessions");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.id).toBe(anon.sessionId);
    expect(sessions[0]!.user_id).toBe(registered.userId);

    const old = await id.resolve(anon.issuedToken!.value);
    expect(old.sessionId).not.toBe(anon.sessionId);
    expect(old.userId).toBeNull();

    const fresh = await id.resolve(registered.issuedToken.value);
    expect(fresh.sessionId).toBe(anon.sessionId);
    expect(fresh.userId).toBe(registered.userId);

    const user = db.get<{ email: string }>("SELECT email FROM users WHERE id = ?", registered.userId);
    expect(user?.email).toBe("ada@example.com");
  });

  it("sign-in rejects unknown email and wrong password with the same reason", async () => {
    db = openDatabase({ path: ":memory:" });
    const id = service(db);
    const anon = await id.resolve(null);
    await id.register(anon.sessionId, "a@b.co", "password1");
    const unknown = await id.signIn(anon.sessionId, "nobody@b.co", "password1");
    const wrong = await id.signIn(anon.sessionId, "a@b.co", "wrongpass");
    expect(unknown).toEqual({ ok: false, reason: "invalid-credentials" });
    expect(wrong).toEqual({ ok: false, reason: "invalid-credentials" });
  });

  it("changePassword drops every session for that user", async () => {
    db = openDatabase({ path: ":memory:" });
    const id = service(db);
    const a = await id.resolve(null);
    const registered = await id.register(a.sessionId, "a@b.co", "password1");
    expect(registered.ok).toBe(true);
    if (!registered.ok) {
      return;
    }
    const b = await id.resolve(null);
    await id.signIn(b.sessionId, "a@b.co", "password1");

    const before = db.all<{ id: string }>("SELECT id FROM sessions WHERE user_id = ?", registered.userId);
    expect(before).toHaveLength(2);

    const changed = await id.changePassword(a.sessionId, "password1", "password2");
    expect(changed.ok).toBe(true);
    if (!changed.ok) {
      return;
    }

    const oldA = await id.resolve(registered.issuedToken.value);
    expect(oldA.userId).toBeNull();
    const other = db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM sessions WHERE id = ?",
      b.sessionId,
    );
    expect(other?.n).toBe(0);

    const next = await id.resolve(changed.issuedToken.value);
    expect(next.userId).toBe(registered.userId);
  });

  it("duplicate email is email-taken; short password is weak-password", async () => {
    db = openDatabase({ path: ":memory:" });
    const id = service(db);
    const a = await id.resolve(null);
    await id.register(a.sessionId, "a@b.co", "password1");
    const taken = await id.register(a.sessionId, "a@b.co", "password1");
    expect(taken).toEqual({ ok: false, reason: "email-taken" });
    const weak = await id.register(a.sessionId, "c@d.co", "short");
    expect(weak).toEqual({ ok: false, reason: "weak-password" });
  });

  it("gated registration returns registration-closed", async () => {
    db = openDatabase({ path: ":memory:" });
    const id = createIdentityService({
      db,
      scrypt: SCRYPT_TEST,
      allowRegistration: false,
    });
    const anon = await id.resolve(null);
    const result = await id.register(anon.sessionId, "a@b.co", "password1");
    expect(result).toEqual({ ok: false, reason: "registration-closed" });
  });

  it("production scrypt params are the OWASP floor", () => {
    expect(SCRYPT_PRODUCTION).toEqual({
      N: 2 ** 17,
      r: 8,
      p: 1,
      maxmem: 256 * 1024 * 1024,
      keylen: 32,
    });
  });
});
