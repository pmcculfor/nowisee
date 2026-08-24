import type { LockboxCapability } from "../../src/core/types.ts";
import { LockboxError } from "./errors.ts";
import type { LockboxService } from "./service.ts";

export function bindLockbox(
  service: LockboxService,
  userId: string | null,
  appId: string,
): LockboxCapability {
  return {
    async get(slot) {
      requireUser(userId);
      return service.get(userId, appId, slot);
    },
    async put(slot, plaintext) {
      requireUser(userId);
      service.put(userId, appId, slot, plaintext);
    },
    async delete(slot) {
      requireUser(userId);
      service.delete(userId, appId, slot);
    },
  };
}

function requireUser(userId: string | null): asserts userId is string {
  if (!userId) {
    throw new LockboxError("not-signed-in");
  }
}
