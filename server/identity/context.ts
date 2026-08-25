import type {
  AppDescriptor,
  AppModule,
  AppServerContext,
  DirectoryCapability,
  IdentityCapability,
  LockboxCapability,
  OAuthCapability,
} from "../../src/core/types.ts";
import { bindLockbox } from "../lockbox/capability.ts";
import type { LockboxService } from "../lockbox/service.ts";
import { bindOAuth } from "../oauth/capability.ts";
import type { OAuthBroker } from "../oauth/broker.ts";
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

export function bindDirectory(list: () => readonly AppDescriptor[]): DirectoryCapability {
  return {
    list() {
      return list();
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
  readonly directoryAppIds?: ReadonlySet<string>;
  readonly directory?: () => readonly AppDescriptor[];
  readonly lockboxAppIds?: ReadonlySet<string>;
  readonly lockbox?: LockboxService;
  readonly oauthAppIds?: ReadonlySet<string>;
  readonly oauth?: OAuthBroker;
}): AppServerContext {
  const ctx: {
    userId: string | null;
    sessionId: string;
    accountAppId: string;
    identity?: IdentityCapability;
    lockbox?: LockboxCapability;
    oauth?: OAuthCapability;
    directory?: DirectoryCapability;
  } = {
    userId: args.userId,
    sessionId: args.sessionId,
    accountAppId: args.accountAppId,
  };
  if (args.identityAppIds.has(args.app.id)) {
    ctx.identity = bindIdentity(args.identity, args.sessionId, args.slot);
  }
  if (args.directory && args.directoryAppIds?.has(args.app.id)) {
    ctx.directory = bindDirectory(args.directory);
  }
  if (args.lockbox && args.lockboxAppIds?.has(args.app.id)) {
    ctx.lockbox = bindLockbox(args.lockbox, args.userId, args.app.id);
  }
  if (args.oauth && args.oauthAppIds?.has(args.app.id)) {
    ctx.oauth = bindOAuth(args.oauth, {
      userId: args.userId,
      sessionId: args.sessionId,
      appId: args.app.id,
    });
  }
  return ctx;
}
