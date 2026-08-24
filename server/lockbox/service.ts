import type { Db } from "../db/index.ts";
import {
  associatedData,
  DecryptFailedError,
  open,
  seal,
  type LockboxKeyring,
} from "./crypto.ts";
import { assertSlot, LockboxError, MAX_BLOB_BYTES } from "./errors.ts";
import { lockboxDelete, lockboxGet, lockboxPut } from "./store.ts";

export type LockboxService = {
  get(userId: string, appId: string, slot: string): Uint8Array | null;
  put(userId: string, appId: string, slot: string, plaintext: Uint8Array): void;
  delete(userId: string, appId: string, slot: string): void;
};

export function createLockboxService(args: {
  readonly db: Db;
  readonly keyring: LockboxKeyring;
  readonly now?: () => number;
}): LockboxService {
  const now = args.now ?? Date.now;
  return {
    get(userId, appId, slot) {
      assertSlot(slot);
      const row = lockboxGet(args.db, userId, appId, slot);
      if (!row) {
        return null;
      }
      try {
        const plaintext = open(args.keyring, row, associatedData(userId, appId, slot));
        if (row.keyId !== args.keyring.currentId) {
          const resealed = seal(args.keyring, plaintext, associatedData(userId, appId, slot));
          lockboxPut(args.db, { userId, appId, slot, blob: resealed, now: now() });
        }
        return plaintext;
      } catch (err) {
        if (err instanceof DecryptFailedError) {
          throw new LockboxError("decrypt-failed");
        }
        throw err;
      }
    },
    put(userId, appId, slot, plaintext) {
      assertSlot(slot);
      if (plaintext.byteLength > MAX_BLOB_BYTES) {
        throw new LockboxError("too-large");
      }
      const blob = seal(args.keyring, plaintext, associatedData(userId, appId, slot));
      lockboxPut(args.db, { userId, appId, slot, blob, now: now() });
    },
    delete(userId, appId, slot) {
      assertSlot(slot);
      lockboxDelete(args.db, userId, appId, slot);
    },
  };
}
