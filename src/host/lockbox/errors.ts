export type LockboxErrorCode =
  | "not-signed-in"
  | "invalid-slot"
  | "too-large"
  | "decrypt-failed"
  | "missing-key";

export class LockboxError extends Error {
  readonly code: LockboxErrorCode;
  constructor(code: LockboxErrorCode, message?: string) {
    super(message ?? code);
    this.name = "LockboxError";
    this.code = code;
  }
}

export const SLOT_PATTERN = /^[a-z0-9][a-z0-9:_-]{0,63}$/;
export const MAX_BLOB_BYTES = 8 * 1024;

export function assertSlot(slot: string): void {
  if (!SLOT_PATTERN.test(slot)) {
    throw new LockboxError("invalid-slot");
  }
}
