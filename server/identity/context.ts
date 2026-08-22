import type { AppModule, AppServerContext, IdentityCapability } from "../../src/core/types.ts";
import type { AuthServiceResult, IdentityService, IssuedToken } from "./service.ts";

export type CookieSlot = {
  issued?: IssuedToken | null;
};

export function bindIdentity(
  service: IdentityService,
  sessionId: string,
  slot: CookieSlot,
): IdentityCapability {
  function take(
    result: AuthServiceResult,
  ): Extract<AuthServiceResult, { ok: false }> | { ok: true; userId: string } {
    if (result.ok) {
      slot.issued = result.issuedToken;
      return { ok: true, userId: result.userId };
    }
    return result;
  }

  return {
    async register(email: string, password: string) {
      return take(await service.register(sessionId, email, password));
    },
    async signIn(email: string, password: string) {
      return take(await service.signIn(sessionId, email, password));
    },
    async signOut() {
      await service.signOut(sessionId);
      slot.issued = null;
    },
  };
}

export function buildAppContext(args: {
  readonly userId: string | null;
  readonly sessionId: string;
  readonly accountAppId: string;
  readonly app: AppModule;
  readonly identityAppIds: ReadonlySet<string>;
  readonly identity: IdentityService;
  readonly slot: CookieSlot;
}): AppServerContext {
  const ctx: {
    userId: string | null;
    sessionId: string;
    accountAppId: string;
    identity?: IdentityCapability;
  } = {
    userId: args.userId,
    sessionId: args.sessionId,
    accountAppId: args.accountAppId,
  };
  if (args.identityAppIds.has(args.app.id)) {
    ctx.identity = bindIdentity(args.identity, args.sessionId, args.slot);
  }
  return ctx;
}
