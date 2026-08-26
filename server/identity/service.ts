import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { AuthOutcome, RequestSignInOutcome } from "../../src/core/types.ts";
import type { Db } from "../db/index.ts";
import type { Mailer } from "../mail/types.ts";
import {
  SIGN_IN_CODE_MAX_ATTEMPTS,
  SIGN_IN_CODE_TTL_MS,
  generateSignInCode,
  normalizeSignInCode,
  signInCodeEmailText,
} from "./code.ts";

const IDLE_MS = 14 * 24 * 60 * 60 * 1000;
const ABSOLUTE_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_EMAIL_LENGTH = 254;
const THROTTLE_BURST_MS = 30 * 1000;
const THROTTLE_HOUR_MS = 60 * 60 * 1000;
const THROTTLE_BURST_MAX = 1;
const THROTTLE_EMAIL_HOUR_MAX = 5;
const THROTTLE_SESSION_HOUR_MAX = 10;
const OTP_PEPPER_BYTES = 32;
const SIGN_IN_MAIL_SUBJECT = "Your Nowisee sign-in code";

export type IssuedToken = {
  readonly value: string;
  readonly expiresAt: number;
};

export type ResolveResult = {
  readonly sessionId: string;
  readonly userId: string | null;
  readonly issuedToken?: IssuedToken;
};

export type AuthServiceResult =
  | { ok: true; userId: string; issuedToken: IssuedToken }
  | Extract<AuthOutcome, { ok: false }>;

export interface IdentityService {
  resolve(token: string | null): Promise<ResolveResult>;
  requestSignIn(sessionId: string, email: string): Promise<RequestSignInOutcome>;
  verifySignIn(sessionId: string, code: string): Promise<AuthServiceResult>;
  signOut(sessionId: string): Promise<{ issuedToken: null }>;
}

type SessionRow = {
  id: string;
  token_hash: string;
  user_id: string | null;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  idle_expires_at: number;
};

type ChallengeRow = {
  session_id: string;
  email: string;
  code_hash: string;
  expires_at: number;
  attempt_count: number;
  created_at: number;
};

type ThrottleRow = {
  key: string;
  window_start: number;
  count: number;
};

export type IdentityServiceOptions = {
  readonly db: Db;
  readonly mailer: Mailer;
  readonly otpPepper: Uint8Array;
  readonly allowRegistration?: boolean;
  readonly now?: () => number;
};

export function createIdentityService(options: IdentityServiceOptions): IdentityService {
  const db = options.db;
  const mailer = options.mailer;
  const pepper = asBytes(options.otpPepper);
  if (pepper.byteLength !== OTP_PEPPER_BYTES) {
    throw new Error("otpPepper must be 32 bytes");
  }
  const allowRegistration = options.allowRegistration !== false;
  const now = options.now ?? Date.now;

  function sweep(at: number): void {
    db.run("DELETE FROM sessions WHERE expires_at < ? OR idle_expires_at < ?", at, at);
    db.run("DELETE FROM login_challenges WHERE expires_at < ?", at);
  }

  function mintAnonymous(at: number): ResolveResult {
    const sessionId = randomUUID();
    const token = mintToken();
    const expiresAt = at + ABSOLUTE_MS;
    db.run(
      `INSERT INTO sessions (id, token_hash, user_id, created_at, last_seen_at, expires_at, idle_expires_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?)`,
      sessionId,
      hashToken(token),
      at,
      at,
      expiresAt,
      at + IDLE_MS,
    );
    return { sessionId, userId: null, issuedToken: { value: token, expiresAt } };
  }

  function rotateOntoUser(sessionId: string, userId: string, at: number): IssuedToken {
    const token = mintToken();
    const expiresAt = at + ABSOLUTE_MS;
    const tokenHash = hashToken(token);
    const updated = db.run(
      `UPDATE sessions
       SET user_id = ?, token_hash = ?, last_seen_at = ?, expires_at = ?, idle_expires_at = ?
       WHERE id = ?`,
      userId,
      tokenHash,
      at,
      expiresAt,
      at + IDLE_MS,
      sessionId,
    );
    if (Number(updated.changes) === 0) {
      db.run(
        `INSERT INTO sessions (id, token_hash, user_id, created_at, last_seen_at, expires_at, idle_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        sessionId,
        tokenHash,
        userId,
        at,
        at,
        expiresAt,
        at + IDLE_MS,
      );
    }
    return { value: token, expiresAt };
  }

  function hashCode(code: string): string {
    return createHmac("sha256", pepper).update(code).digest("hex");
  }

  function codesEqual(left: string, right: string): boolean {
    const a = Buffer.from(left, "hex");
    const b = Buffer.from(right, "hex");
    if (a.byteLength !== b.byteLength) {
      return false;
    }
    return timingSafeEqual(a, b);
  }

  function dummyCompare(): void {
    codesEqual(hashCode("aaa000"), hashCode("aaa000"));
  }

  function takeThrottle(key: string, windowMs: number, max: number, at: number): boolean {
    const row = db.get<ThrottleRow>(
      "SELECT key, window_start, count FROM login_throttles WHERE key = ?",
      key,
    );
    if (!row || at - row.window_start >= windowMs) {
      db.run(
        `INSERT INTO login_throttles (key, window_start, count) VALUES (?, ?, 1)
         ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 1`,
        key,
        at,
      );
      return true;
    }
    if (row.count >= max) {
      return false;
    }
    db.run("UPDATE login_throttles SET count = count + 1 WHERE key = ?", key);
    return true;
  }

  return {
    async resolve(token) {
      const at = now();
      sweep(at);
      if (!token) {
        return mintAnonymous(at);
      }
      const row = db.get<SessionRow>(
        "SELECT id, token_hash, user_id, created_at, last_seen_at, expires_at, idle_expires_at FROM sessions WHERE token_hash = ?",
        hashToken(token),
      );
      if (!row || row.expires_at <= at || row.idle_expires_at <= at) {
        return mintAnonymous(at);
      }
      db.run(
        "UPDATE sessions SET last_seen_at = ?, idle_expires_at = ? WHERE id = ?",
        at,
        at + IDLE_MS,
        row.id,
      );
      return { sessionId: row.id, userId: row.user_id };
    },

    async requestSignIn(sessionId, email) {
      const at = now();
      sweep(at);
      const normalized = normalizeEmail(email);
      if (!isEmail(normalized)) {
        dummyCompare();
        return { ok: false, reason: "invalid-credentials" };
      }
      if (!takeThrottle(`session-burst:${sessionId}`, THROTTLE_BURST_MS, THROTTLE_BURST_MAX, at)) {
        return { ok: false, reason: "throttled" };
      }
      if (!takeThrottle(`email-hour:${normalized}`, THROTTLE_HOUR_MS, THROTTLE_EMAIL_HOUR_MAX, at)) {
        return { ok: false, reason: "throttled" };
      }
      if (!takeThrottle(`session-hour:${sessionId}`, THROTTLE_HOUR_MS, THROTTLE_SESSION_HOUR_MAX, at)) {
        return { ok: false, reason: "throttled" };
      }

      const existing = db.get<{ id: string }>("SELECT id FROM users WHERE email = ?", normalized);
      const shouldSend = Boolean(existing) || allowRegistration;
      const code = generateSignInCode();
      const codeHash = hashCode(code);
      db.run("DELETE FROM login_challenges WHERE session_id = ?", sessionId);

      if (!shouldSend) {
        dummyCompare();
        return { ok: true };
      }

      const expiresAt = at + SIGN_IN_CODE_TTL_MS;
      db.run(
        `INSERT INTO login_challenges (session_id, email, code_hash, expires_at, attempt_count, created_at)
         VALUES (?, ?, ?, ?, 0, ?)`,
        sessionId,
        normalized,
        codeHash,
        expiresAt,
        at,
      );
      try {
        await mailer.send({
          to: normalized,
          subject: SIGN_IN_MAIL_SUBJECT,
          text: signInCodeEmailText(code),
        });
      } catch {
        db.run("DELETE FROM login_challenges WHERE session_id = ?", sessionId);
        console.error("sign-in mail failed");
      }
      return { ok: true };
    },

    async verifySignIn(sessionId, code) {
      const at = now();
      sweep(at);
      const compact = normalizeSignInCode(code);
      const challenge = db.get<ChallengeRow>(
        `SELECT session_id, email, code_hash, expires_at, attempt_count, created_at
         FROM login_challenges WHERE session_id = ?`,
        sessionId,
      );
      if (!compact || !challenge || challenge.expires_at <= at) {
        dummyCompare();
        if (challenge && challenge.expires_at <= at) {
          db.run("DELETE FROM login_challenges WHERE session_id = ?", sessionId);
        }
        return { ok: false, reason: "invalid-credentials" };
      }
      if (challenge.attempt_count >= SIGN_IN_CODE_MAX_ATTEMPTS) {
        dummyCompare();
        db.run("DELETE FROM login_challenges WHERE session_id = ?", sessionId);
        return { ok: false, reason: "invalid-credentials" };
      }
      if (!codesEqual(challenge.code_hash, hashCode(compact))) {
        const attempts = challenge.attempt_count + 1;
        if (attempts >= SIGN_IN_CODE_MAX_ATTEMPTS) {
          db.run("DELETE FROM login_challenges WHERE session_id = ?", sessionId);
        } else {
          db.run(
            "UPDATE login_challenges SET attempt_count = ? WHERE session_id = ?",
            attempts,
            sessionId,
          );
        }
        return { ok: false, reason: "invalid-credentials" };
      }

      db.run("DELETE FROM login_challenges WHERE session_id = ?", sessionId);
      const user = db.get<{ id: string }>("SELECT id FROM users WHERE email = ?", challenge.email);
      if (user) {
        const issuedToken = rotateOntoUser(sessionId, user.id, at);
        return { ok: true, userId: user.id, issuedToken };
      }
      if (!allowRegistration) {
        dummyCompare();
        return { ok: false, reason: "invalid-credentials" };
      }
      const userId = randomUUID();
      try {
        db.run(
          "INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)",
          userId,
          challenge.email,
          at,
        );
      } catch {
        dummyCompare();
        return { ok: false, reason: "invalid-credentials" };
      }
      const issuedToken = rotateOntoUser(sessionId, userId, at);
      return { ok: true, userId, issuedToken };
    },

    async signOut(sessionId) {
      db.run("DELETE FROM sessions WHERE id = ?", sessionId);
      return { issuedToken: null };
    },
  };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isEmail(email: string): boolean {
  if (email.length < 3 || email.length > MAX_EMAIL_LENGTH) {
    return false;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function asBytes(value: Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : Uint8Array.from(value);
}
