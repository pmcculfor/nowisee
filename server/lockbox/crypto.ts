import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export type LockboxKeyring = {
  readonly currentId: string;
  readonly keys: Readonly<Record<string, Uint8Array>>;
};

export type SealedBlob = {
  readonly keyId: string;
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
};

export function parseLockboxKey(raw: string): Uint8Array {
  const key = Buffer.from(raw, "base64");
  if (key.byteLength !== KEY_LENGTH) {
    throw new Error("NOWISEE_LOCKBOX_KEY must be 32 bytes, base64-encoded");
  }
  return new Uint8Array(key);
}

export function lockboxKeyringFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): LockboxKeyring | undefined {
  const raw = env.NOWISEE_LOCKBOX_KEY;
  if (!raw) {
    return undefined;
  }
  const id = env.NOWISEE_LOCKBOX_KEY_ID?.trim() || "v1";
  return { currentId: id, keys: { [id]: parseLockboxKey(raw) } };
}

export function associatedData(userId: string, appId: string, slot: string): Uint8Array {
  return new TextEncoder().encode(`${userId}\0${appId}\0${slot}`);
}

export function seal(
  keyring: LockboxKeyring,
  plaintext: Uint8Array,
  aad: Uint8Array,
): SealedBlob {
  const key = requireKey(keyring, keyring.currentId);
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    keyId: keyring.currentId,
    nonce: new Uint8Array(nonce),
    ciphertext: new Uint8Array(Buffer.concat([encrypted, tag])),
  };
}

export function open(
  keyring: LockboxKeyring,
  blob: SealedBlob,
  aad: Uint8Array,
): Uint8Array {
  const key = requireKey(keyring, blob.keyId);
  if (blob.ciphertext.byteLength < TAG_LENGTH) {
    throw new DecryptFailedError();
  }
  const data = blob.ciphertext.subarray(0, blob.ciphertext.byteLength - TAG_LENGTH);
  const tag = blob.ciphertext.subarray(blob.ciphertext.byteLength - TAG_LENGTH);
  try {
    const decipher = createDecipheriv(ALGORITHM, key, blob.nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return new Uint8Array(Buffer.concat([decipher.update(data), decipher.final()]));
  } catch {
    throw new DecryptFailedError();
  }
}

export class DecryptFailedError extends Error {
  readonly code = "decrypt-failed" as const;
  constructor() {
    super("Lockbox decrypt failed");
    this.name = "DecryptFailedError";
  }
}

function requireKey(keyring: LockboxKeyring, id: string): Uint8Array {
  const key = keyring.keys[id];
  if (!key || key.byteLength !== KEY_LENGTH) {
    throw new Error(`Unknown or invalid lockbox key id: ${id}`);
  }
  return key;
}
