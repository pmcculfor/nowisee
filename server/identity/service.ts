import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AuthOutcome } from "../../src/core/types.ts";
import type { Db } from "../db/index.ts";
import {
  dummyVerify,
  hashPassword,
  paramsMatch,
  verifyPassword,
  type ScryptParams,
  createHashGate,
  SCRYPT_PRODUCTION,
} from "./hash.ts";

const IDLE_MS = 14 * 24 * 60 * 60 * 1000;
const ABSOLUTE_MS = 90 * 24 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const MAX_EMAIL_LENGTH = 254;

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
  register(sessionId: string, email: string, password: string): Promise<AuthServiceResult>;
  signIn(sessionId: string, email: string, password: string): Promise<AuthServiceResult>;
  signOut(sessionId: string): Promise<{ issuedToken: null }>;
  changePassword(
    sessionId: string,
    currentPassword: string,
    nextPassword: string,
  ): Promise<AuthServiceResult>;
}

type UserRow = {
  id: string;
  email: string;
  password_algo: string;
  password_n: number;
  password_r: number;
  password_p: number;
  password_salt: Uint8Array;
  password_hash: Uint8Array;
};

type SessionRow = {
  id: string;
  token_hash: string;
  user_id: string | null;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  idle_expires_at: number;
};

export type IdentityServiceOptions = {
  readonly db: Db;
  readonly scrypt?: ScryptParams;
  readonly hashConcurrency?: number;
  readonly allowRegistration?: boolean;
  readonly now?: () => number;
};

export function createIdentityService(options: IdentityServiceOptions): IdentityService {
  const db = options.db;
  const scrypt = options.scrypt ?? SCRYPT_PRODUCTION;
  const gate = createHashGate(options.hashConcurrency ?? 2);
  const allowRegistration = options.allowRegistration !== false;
  const now = options.now ?? Date.now;

  function sweep(at: number): void {
    db.run("DELETE FROM sessions WHERE expires_at < ? OR idle_expires_at < ?", at, at);
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

    async register(sessionId, email, password) {
      if (!allowRegistration) {
        return { ok: false, reason: "registration-closed" };
      }
      const normalized = normalizeEmail(email);
      const weak = validateCredentials(normalized, password);
      if (weak) {
        return weak;
      }
      const existing = db.get<{ id: string }>("SELECT id FROM users WHERE email = ?", normalized);
      if (existing) {
        return { ok: false, reason: "email-taken" };
      }
      const record = await hashPassword(password, scrypt, gate);
      const userId = randomUUID();
      const at = now();
      try {
        db.run(
          `INSERT INTO users (id, email, password_algo, password_n, password_r, password_p, password_salt, password_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          userId,
          normalized,
          record.algo,
          record.N,
          record.r,
          record.p,
          record.salt,
          record.hash,
          at,
        );
      } catch {
        return { ok: false, reason: "email-taken" };
      }
      const issuedToken = rotateOntoUser(sessionId, userId, at);
      return { ok: true, userId, issuedToken };
    },

    async signIn(sessionId, email, password) {
      const normalized = normalizeEmail(email);
      const weak = validateCredentials(normalized, password);
      if (weak) {
        return weak;
      }
      const user = db.get<UserRow>(
        `SELECT id, email, password_algo, password_n, password_r, password_p, password_salt, password_hash
         FROM users WHERE email = ?`,
        normalized,
      );
      if (!user) {
        await dummyVerify(password, scrypt, gate);
        return { ok: false, reason: "invalid-credentials" };
      }
      const record = {
        algo: "scrypt" as const,
        N: user.password_n,
        r: user.password_r,
        p: user.password_p,
        salt: asBytes(user.password_salt),
        hash: asBytes(user.password_hash),
      };
      const ok = await verifyPassword(password, record, scrypt, gate);
      if (!ok) {
        return { ok: false, reason: "invalid-credentials" };
      }
      if (!paramsMatch(record, scrypt)) {
        const upgraded = await hashPassword(password, scrypt, gate);
        db.run(
          `UPDATE users SET password_algo = ?, password_n = ?, password_r = ?, password_p = ?, password_salt = ?, password_hash = ?
           WHERE id = ?`,
          upgraded.algo,
          upgraded.N,
          upgraded.r,
          upgraded.p,
          upgraded.salt,
          upgraded.hash,
          user.id,
        );
      }
      const issuedToken = rotateOntoUser(sessionId, user.id, now());
      return { ok: true, userId: user.id, issuedToken };
    },

    async signOut(sessionId) {
      db.run("DELETE FROM sessions WHERE id = ?", sessionId);
      return { issuedToken: null };
    },

    async changePassword(sessionId, currentPassword, nextPassword) {
      const session = db.get<SessionRow>(
        "SELECT id, token_hash, user_id, created_at, last_seen_at, expires_at, idle_expires_at FROM sessions WHERE id = ?",
        sessionId,
      );
      if (!session?.user_id) {
        return { ok: false, reason: "invalid-credentials" };
      }
      const nextCheck = validateCredentials("ok@example.com", nextPassword);
      if (nextCheck) {
        return nextCheck;
      }
      const user = db.get<UserRow>(
        `SELECT id, email, password_algo, password_n, password_r, password_p, password_salt, password_hash
         FROM users WHERE id = ?`,
        session.user_id,
      );
      if (!user) {
        return { ok: false, reason: "invalid-credentials" };
      }
      const record = {
        algo: "scrypt" as const,
        N: user.password_n,
        r: user.password_r,
        p: user.password_p,
        salt: asBytes(user.password_salt),
        hash: asBytes(user.password_hash),
      };
      const ok = await verifyPassword(currentPassword, record, scrypt, gate);
      if (!ok) {
        return { ok: false, reason: "invalid-credentials" };
      }
      const upgraded = await hashPassword(nextPassword, scrypt, gate);
      const at = now();
      const token = mintToken();
      const expiresAt = at + ABSOLUTE_MS;
      const newSessionId = randomUUID();
      db.transaction(() => {
        db.run(
          `UPDATE users SET password_algo = ?, password_n = ?, password_r = ?, password_p = ?, password_salt = ?, password_hash = ?
           WHERE id = ?`,
          upgraded.algo,
          upgraded.N,
          upgraded.r,
          upgraded.p,
          upgraded.salt,
          upgraded.hash,
          user.id,
        );
        db.run("DELETE FROM sessions WHERE user_id = ?", user.id);
        db.run(
          `INSERT INTO sessions (id, token_hash, user_id, created_at, last_seen_at, expires_at, idle_expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          newSessionId,
          hashToken(token),
          user.id,
          at,
          at,
          expiresAt,
          at + IDLE_MS,
        );
      });
      return { ok: true, userId: user.id, issuedToken: { value: token, expiresAt } };
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

function validateCredentials(
  email: string,
  password: string,
): Extract<AuthOutcome, { ok: false }> | null {
  if (!isEmail(email)) {
    return { ok: false, reason: "invalid-credentials" };
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, reason: "weak-password" };
  }
  return null;
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
