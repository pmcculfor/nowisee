import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../db/index.ts";
import { associatedData, open, seal, type LockboxKeyring } from "../lockbox/crypto.ts";

export type OAuthStateRow = {
  readonly stateHash: string;
  readonly sessionId: string;
  readonly userId: string;
  readonly appId: string;
  readonly slot: string;
  readonly authorizeUrl: string;
  readonly returnPath: string;
  readonly expiresAt: number;
  readonly verifierKeyId: string;
  readonly verifierNonce: Uint8Array;
  readonly verifierCiphertext: Uint8Array;
};

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const MAX_LIVE_PER_SESSION = 20;

export function hashOAuthState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export function mintOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

export function mintPkceVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function sweepExpiredOAuthStates(db: Db, now: number): void {
  db.run("DELETE FROM oauth_states WHERE expires_at <= ?", now);
}

export function findLiveOAuthState(
  db: Db,
  sessionId: string,
  appId: string,
  slot: string,
  now: number,
): OAuthStateRow | undefined {
  const row = db.get<RawStateRow>(
    `SELECT state_hash, session_id, user_id, app_id, slot, authorize_url, return_path,
            expires_at, code_verifier_key_id, code_verifier_nonce, code_verifier_ciphertext
     FROM oauth_states
     WHERE session_id = ? AND app_id = ? AND slot = ? AND expires_at > ?`,
    sessionId,
    appId,
    slot,
    now,
  );
  return row ? toRow(row) : undefined;
}

export function getOAuthStateByHash(
  db: Db,
  stateHash: string,
  now: number,
): OAuthStateRow | undefined {
  const row = db.get<RawStateRow>(
    `SELECT state_hash, session_id, user_id, app_id, slot, authorize_url, return_path,
            expires_at, code_verifier_key_id, code_verifier_nonce, code_verifier_ciphertext
     FROM oauth_states
     WHERE state_hash = ? AND expires_at > ?`,
    stateHash,
    now,
  );
  return row ? toRow(row) : undefined;
}

export function deleteOAuthState(db: Db, stateHash: string): void {
  db.run("DELETE FROM oauth_states WHERE state_hash = ?", stateHash);
}

export function upsertOAuthState(
  db: Db,
  keyring: LockboxKeyring,
  args: {
    readonly state: string;
    readonly sessionId: string;
    readonly userId: string;
    readonly appId: string;
    readonly slot: string;
    readonly verifier: string;
    readonly authorizeUrl: string;
    readonly returnPath: string;
    readonly now: number;
  },
): void {
  const stateHash = hashOAuthState(args.state);
  const sealed = seal(keyring, new TextEncoder().encode(args.verifier), verifierAad(stateHash));
  db.transaction(() => {
    db.run(
      "DELETE FROM oauth_states WHERE session_id = ? AND app_id = ? AND slot = ?",
      args.sessionId,
      args.appId,
      args.slot,
    );
    const live = db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM oauth_states WHERE session_id = ? AND expires_at > ?",
      args.sessionId,
      args.now,
    );
    if (Number(live?.n ?? 0) >= MAX_LIVE_PER_SESSION) {
      const oldest = db.get<{ state_hash: string }>(
        "SELECT state_hash FROM oauth_states WHERE session_id = ? ORDER BY expires_at ASC LIMIT 1",
        args.sessionId,
      );
      if (oldest) {
        db.run("DELETE FROM oauth_states WHERE state_hash = ?", oldest.state_hash);
      }
    }
    db.run(
      `INSERT INTO oauth_states (
         state_hash, session_id, user_id, app_id, slot,
         code_verifier_key_id, code_verifier_nonce, code_verifier_ciphertext,
         authorize_url, return_path, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      stateHash,
      args.sessionId,
      args.userId,
      args.appId,
      args.slot,
      sealed.keyId,
      sealed.nonce,
      sealed.ciphertext,
      args.authorizeUrl,
      args.returnPath,
      args.now + OAUTH_STATE_TTL_MS,
    );
  });
}

export function decryptPkceVerifier(keyring: LockboxKeyring, row: OAuthStateRow): string {
  const bytes = open(
    keyring,
    {
      keyId: row.verifierKeyId,
      nonce: row.verifierNonce,
      ciphertext: row.verifierCiphertext,
    },
    verifierAad(row.stateHash),
  );
  return new TextDecoder().decode(bytes);
}

function verifierAad(stateHash: string): Uint8Array {
  return associatedData("oauth-state", stateHash, "pkce");
}

type RawStateRow = {
  state_hash: string;
  session_id: string;
  user_id: string;
  app_id: string;
  slot: string;
  authorize_url: string;
  return_path: string;
  expires_at: number;
  code_verifier_key_id: string;
  code_verifier_nonce: Uint8Array;
  code_verifier_ciphertext: Uint8Array;
};

function toRow(row: RawStateRow): OAuthStateRow {
  return {
    stateHash: row.state_hash,
    sessionId: row.session_id,
    userId: row.user_id,
    appId: row.app_id,
    slot: row.slot,
    authorizeUrl: row.authorize_url,
    returnPath: row.return_path,
    expiresAt: row.expires_at,
    verifierKeyId: row.code_verifier_key_id,
    verifierNonce: asBytes(row.code_verifier_nonce),
    verifierCiphertext: asBytes(row.code_verifier_ciphertext),
  };
}

function asBytes(value: Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? new Uint8Array(value) : Uint8Array.from(value);
}
