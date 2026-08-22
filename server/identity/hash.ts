import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

export type ScryptParams = {
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly maxmem: number;
  readonly keylen: number;
};

/** OWASP floor as of 2026. ~128 MiB; maxmem must be raised past Node's 32 MiB default. */
export const SCRYPT_PRODUCTION: ScryptParams = {
  N: 2 ** 17,
  r: 8,
  p: 1,
  maxmem: 256 * 1024 * 1024,
  keylen: 32,
};

/** Fast params for unit tests. Production host must not use these. */
export const SCRYPT_TEST: ScryptParams = {
  N: 16,
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024,
  keylen: 32,
};

const SALT_BYTES = 16;

export type PasswordRecord = {
  readonly algo: "scrypt";
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly salt: Uint8Array;
  readonly hash: Uint8Array;
};

class HashGate {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly max: number;

  constructor(max: number) {
    this.max = max;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => {
        this.waiting.push(resolve);
      });
    }
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

function scryptAsync(
  password: string,
  salt: Uint8Array,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(derivedKey);
    });
  });
}

export function createHashGate(concurrency: number): HashGate {
  return new HashGate(concurrency);
}

export async function hashPassword(
  password: string,
  params: ScryptParams,
  gate: HashGate,
  salt: Uint8Array = randomBytes(SALT_BYTES),
): Promise<PasswordRecord> {
  const hash = await gate.run(() =>
    scryptAsync(password, salt, params.keylen, {
      N: params.N,
      r: params.r,
      p: params.p,
      maxmem: params.maxmem,
    }),
  );
  return { algo: "scrypt", N: params.N, r: params.r, p: params.p, salt, hash };
}

export async function verifyPassword(
  password: string,
  record: PasswordRecord,
  params: ScryptParams,
  gate: HashGate,
): Promise<boolean> {
  const derived = await gate.run(() =>
    scryptAsync(password, record.salt, record.hash.byteLength, {
      N: record.N,
      r: record.r,
      p: record.p,
      maxmem: params.maxmem,
    }),
  );
  if (derived.byteLength !== record.hash.byteLength) {
    return false;
  }
  return timingSafeEqual(Buffer.from(derived), Buffer.from(record.hash));
}

/** Spend a hash even when no user exists, so missing-email vs wrong-password is not a timing oracle. */
export async function dummyVerify(password: string, params: ScryptParams, gate: HashGate): Promise<void> {
  const salt = Buffer.alloc(SALT_BYTES, 1);
  await gate.run(() =>
    scryptAsync(password, salt, params.keylen, {
      N: params.N,
      r: params.r,
      p: params.p,
      maxmem: params.maxmem,
    }),
  );
}

export function paramsMatch(record: PasswordRecord, params: ScryptParams): boolean {
  return record.N === params.N && record.r === params.r && record.p === params.p;
}
