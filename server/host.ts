import { FIRST_PARTY_APPS, type StartedApp } from "./firstPartyApps.ts";
import type { AppRpc, WireExtras } from "../src/apps/rpc.ts";
import { AppRegistry } from "../src/core/registry.ts";
import type {
  AppDescriptor,
  AppModule,
  AppServerContext,
  HomeRole,
  RefreshExtras,
  RefreshResult,
  StackEntry,
} from "../src/core/types.ts";
import type { Db } from "./db/index.ts";
import { openDatabase } from "./db/index.ts";
import { AppNotFoundError } from "./errors.ts";
import { buildAppContext, type CookieSlot } from "./identity/context.ts";
import { createIdentityService, type IdentityService } from "./identity/service.ts";
import { lockboxKeyringFromEnv, type LockboxKeyring } from "./lockbox/crypto.ts";
import {
  createSilentMailer,
  DEV_OTP_PEPPER,
  mailerFromEnv,
  otpPepperFromEnv,
  type Mailer,
} from "./mail/index.ts";
import { createLockboxService, type LockboxService } from "./lockbox/service.ts";
import { createOAuthBroker, type OAuthBroker } from "./oauth/broker.ts";
import type { OAuthProviderConfig } from "./oauth/providers.ts";
import { envOAuthSecrets, type OAuthSecrets } from "./oauth/secrets.ts";

export type AppHostOptions = {
  readonly rootAppId?: string;
  readonly accountAppId?: string;
  /** Host identity database, or a file path. Default `:memory:`. */
  readonly db?: Db | string;
  /**
   * When true (the default), pack apps open `:memory:` and lockbox/OAuth grants
   * stay empty unless the caller passes them. Production must pass `false`.
   * Do not infer this from whether `db` is a handle or a path.
   */
  readonly ephemeral?: boolean;
  readonly allowRegistration?: boolean;
  readonly identityAppIds?: readonly string[];
  readonly lockboxAppIds?: readonly string[];
  readonly oauthAppIds?: readonly string[];
  readonly directoryAppIds?: readonly string[];
  readonly lockboxKeys?: LockboxKeyring;
  readonly oauthProviders?: readonly OAuthProviderConfig[];
  readonly oauthSecrets?: OAuthSecrets;
  readonly fetch?: typeof fetch;
  readonly extraApps?: readonly AppModule[];
  readonly configuredOrigin?: string;
  readonly mailer?: Mailer;
  readonly otpPepper?: Uint8Array;
};

export type NowiseeHost = {
  readonly rootAppId: string;
  readonly accountAppId: string;
  readonly identityAppIds: ReadonlySet<string>;
  readonly lockboxAppIds: ReadonlySet<string>;
  readonly oauthAppIds: ReadonlySet<string>;
  readonly directoryAppIds: ReadonlySet<string>;
  readonly configuredOrigin: string | undefined;
  readonly identity: IdentityService;
  readonly oauth?: OAuthBroker;
  readonly db: Db;
  open(
    appId: string,
    path: string,
    extras: WireExtras,
    ctx?: AppServerContext,
  ): Promise<RefreshResult>;
  refresh(
    appId: string,
    stack: readonly StackEntry[],
    extras: WireExtras,
    ctx?: AppServerContext,
  ): Promise<RefreshResult>;
  /**
   * Resolve the session, grant ctx, invoke the app, and record any issued cookie
   * on `slot`. Used by the HTTP layer.
   */
  dispatch(
    kind: "open" | "refresh",
    args: {
      readonly appId: string;
      readonly path?: string;
      readonly stack?: readonly StackEntry[];
      readonly extras: WireExtras;
      readonly token: string | null;
      readonly slot: CookieSlot;
    },
  ): Promise<RefreshResult>;
  close(): void;
};

/**
 * In-process open/refresh for apps that run on the server.
 * First-party apps come from the pack list; the host only loops.
 */
export function createNowiseeHost(options: AppHostOptions = {}): NowiseeHost {
  const rootAppId = options.rootAppId ?? "home";
  const accountAppId = options.accountAppId ?? "account";
  const ephemeral = options.ephemeral ?? true;
  const db = resolveDb(options.db);

  const mailer =
    options.mailer ??
    (ephemeral
      ? createSilentMailer()
      : mailerFromEnv({ configuredOrigin: options.configuredOrigin, fetch: options.fetch }));
  const otpPepper =
    options.otpPepper ?? (ephemeral ? DEV_OTP_PEPPER : otpPepperFromEnv());
  const identity = createIdentityService({
    db,
    mailer,
    otpPepper,
    allowRegistration: options.allowRegistration,
  });

  const registry = new AppRegistry();
  const started: StartedApp[] = [];
  const homeRoleByAppId = new Map<string, HomeRole>();
  const hostStart = { rootAppId, ephemeral };
  for (const pack of FIRST_PARTY_APPS) {
    const app = pack.start(hostStart);
    registry.register(app);
    started.push(app);
    if (pack.homeRole) {
      homeRoleByAppId.set(app.id, pack.homeRole);
    }
  }
  for (const extra of options.extraApps ?? []) {
    registry.register(extra);
  }

  function listDirectory(): readonly AppDescriptor[] {
    return registry.listDescriptors().map((d) => {
      const homeRole = homeRoleByAppId.get(d.id);
      return homeRole ? { id: d.id, label: d.label, homeRole } : d;
    });
  }

  const catalogIdentity: string[] = [];
  const catalogLockbox: string[] = [];
  const catalogOauth: string[] = [];
  const catalogDirectory: string[] = [];
  const catalogProviders: OAuthProviderConfig[] = [];
  for (let i = 0; i < FIRST_PARTY_APPS.length; i++) {
    const pack = FIRST_PARTY_APPS[i]!;
    const app = started[i]!;
    if (pack.identity) {
      catalogIdentity.push(app.id);
    }
    if (pack.lockbox) {
      catalogLockbox.push(app.id);
    }
    if (pack.oauth) {
      catalogOauth.push(app.id);
      catalogProviders.push(pack.oauth);
    }
    if (pack.directory) {
      catalogDirectory.push(app.id);
    }
  }

  const identityAppIds = new Set(options.identityAppIds ?? catalogIdentity);
  const directoryAppIds = new Set(options.directoryAppIds ?? catalogDirectory);
  const lockboxAppIds = new Set(options.lockboxAppIds ?? (ephemeral ? [] : catalogLockbox));
  const oauthAppIds = new Set(options.oauthAppIds ?? (ephemeral ? [] : catalogOauth));
  const oauthProviders = options.oauthProviders ?? (ephemeral ? [] : catalogProviders);

  const keyring = options.lockboxKeys ?? lockboxKeyringFromEnv();
  if ((lockboxAppIds.size > 0 || oauthAppIds.size > 0) && !keyring) {
    throw new Error(
      "NOWISEE_LOCKBOX_KEY is required when lockboxAppIds or oauthAppIds is non-empty",
    );
  }
  const lockbox: LockboxService | undefined = keyring
    ? createLockboxService({ db, keyring })
    : undefined;
  let oauth: OAuthBroker | undefined;
  if (oauthAppIds.size > 0) {
    if (!options.configuredOrigin) {
      throw new Error("configuredOrigin is required when oauthAppIds is non-empty");
    }
    if (!lockbox || !keyring) {
      throw new Error("Lockbox keyring is required for OAuth");
    }
    oauth = createOAuthBroker({
      db,
      lockbox,
      keyring,
      providers: oauthProviders,
      secrets: options.oauthSecrets ?? envOAuthSecrets(),
      configuredOrigin: options.configuredOrigin,
      fetch: options.fetch,
    });
  }

  async function resolveCtx(app: AppModule, ctx?: AppServerContext): Promise<AppServerContext> {
    if (ctx) {
      return ctx;
    }
    const resolved = await identity.resolve(null);
    return buildAppContext({
      userId: resolved.userId,
      sessionId: resolved.sessionId,
      accountAppId,
      app,
      identityAppIds,
      identity,
      slot: {},
      directoryAppIds,
      directory: listDirectory,
      lockboxAppIds,
      lockbox,
      oauthAppIds,
      oauth,
    });
  }

  async function open(
    appId: string,
    path: string,
    extras: WireExtras,
    ctx?: AppServerContext,
  ): Promise<RefreshResult> {
    return invoke(registry, appId, async (app) =>
      app.open(path, toRefreshExtras(extras), await resolveCtx(app, ctx)),
    );
  }

  async function refresh(
    appId: string,
    stack: readonly StackEntry[],
    extras: WireExtras,
    ctx?: AppServerContext,
  ): Promise<RefreshResult> {
    return invoke(registry, appId, async (app) =>
      app.refresh(stack, toRefreshExtras(extras), await resolveCtx(app, ctx)),
    );
  }

  return {
    rootAppId,
    accountAppId,
    identityAppIds,
    lockboxAppIds,
    oauthAppIds,
    directoryAppIds,
    configuredOrigin: options.configuredOrigin,
    identity,
    oauth,
    db,
    open,
    refresh,
    async dispatch(kind, args) {
      const resolved = await identity.resolve(args.token);
      if (resolved.issuedToken) {
        args.slot.issued = resolved.issuedToken;
      }
      const app = registry.get(args.appId);
      if (!app) {
        throw new AppNotFoundError(args.appId);
      }
      const ctx = buildAppContext({
        userId: resolved.userId,
        sessionId: resolved.sessionId,
        accountAppId,
        app,
        identityAppIds,
        identity,
        slot: args.slot,
        directoryAppIds,
        directory: listDirectory,
        lockboxAppIds,
        lockbox,
        oauthAppIds,
        oauth,
      });
      if (kind === "open") {
        return app.open(args.path ?? "/", toRefreshExtras(args.extras), ctx);
      }
      return app.refresh(args.stack ?? [], toRefreshExtras(args.extras), ctx);
    },
    close() {
      for (const app of started) {
        app.close?.();
      }
      db.close();
    },
  };
}

/** Same as createNowiseeHost but shaped as the client AppRpc (no ctx, no cookies). */
export function createAppHost(options: AppHostOptions = {}): AppRpc {
  const host = createNowiseeHost(options);
  return {
    async open(appId, path, extras) {
      return host.open(appId, path, extras);
    },
    async refresh(appId, stack, extras) {
      return host.refresh(appId, stack, extras);
    },
  };
}

async function invoke(
  registry: AppRegistry,
  appId: string,
  run: (app: NonNullable<ReturnType<AppRegistry["get"]>>) => Promise<RefreshResult> | RefreshResult,
): Promise<RefreshResult> {
  const app = registry.get(appId);
  if (!app) {
    throw new AppNotFoundError(appId);
  }
  return run(app);
}

function resolveDb(db: Db | string | undefined): Db {
  if (db && typeof db === "object") {
    return db;
  }
  return openDatabase({ path: typeof db === "string" ? db : ":memory:" });
}

function toRefreshExtras(extras: WireExtras): RefreshExtras {
  const out: RefreshExtras = {};
  if (extras.inputText !== undefined) {
    out.inputText = extras.inputText;
  }
  if (extras.action) {
    out.action = true;
  }
  return out;
}
