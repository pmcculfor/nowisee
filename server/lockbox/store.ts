import type { Db } from "../db/index.ts";
import type { SealedBlob } from "./crypto.ts";

export type LockboxRow = SealedBlob & {
  readonly userId: string;
  readonly appId: string;
  readonly slot: string;
  readonly updatedAt: number;
};

export function lockboxGet(
  db: Db,
  userId: string,
  appId: string,
  slot: string,
): LockboxRow | undefined {
  const row = db.get<{
    key_id: string;
    nonce: Uint8Array;
    ciphertext: Uint8Array;
    updated_at: number;
  }>(
    `SELECT key_id, nonce, ciphertext, updated_at
     FROM lockbox WHERE user_id = ? AND app_id = ? AND slot = ?`,
    userId,
    appId,
    slot,
  );
  if (!row) {
    return undefined;
  }
  return {
    userId,
    appId,
    slot,
    keyId: row.key_id,
    nonce: asBytes(row.nonce),
    ciphertext: asBytes(row.ciphertext),
    updatedAt: row.updated_at,
  };
}

export function lockboxPut(
  db: Db,
  args: {
    readonly userId: string;
    readonly appId: string;
    readonly slot: string;
    readonly blob: SealedBlob;
    readonly now: number;
  },
): void {
  db.run(
    `INSERT INTO lockbox (user_id, app_id, slot, key_id, nonce, ciphertext, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, app_id, slot) DO UPDATE SET
       key_id = excluded.key_id,
       nonce = excluded.nonce,
       ciphertext = excluded.ciphertext,
       updated_at = excluded.updated_at`,
    args.userId,
    args.appId,
    args.slot,
    args.blob.keyId,
    args.blob.nonce,
    args.blob.ciphertext,
    args.now,
  );
}

export function lockboxDelete(db: Db, userId: string, appId: string, slot: string): void {
  db.run("DELETE FROM lockbox WHERE user_id = ? AND app_id = ? AND slot = ?", userId, appId, slot);
}

function asBytes(value: Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? new Uint8Array(value) : Uint8Array.from(value);
}
