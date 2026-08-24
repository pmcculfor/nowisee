import { startAccountApp } from "../src/apps/account/store.ts";
import { startBibleApp } from "../src/apps/bible/store.ts";
import type { KjvData } from "../src/apps/bible/types.ts";
import { createHelpApp } from "../src/apps/help/index.ts";
import { createHomeApp } from "../src/apps/home.ts";
import { startNotesApp } from "../src/apps/notes/store.ts";
import type { AppRpc, WireExtras } from "../src/apps/rpc.ts";
import { AppRegistry } from "../src/core/registry.ts";
import type {
  AppModule,
  AppServerContext,
  RefreshExtras,
  RefreshResult,
  StackEntry,
} from "../src/core/types.ts";
import type { Db } from "./db/index.ts";
import { openDatabase } from "./db/index.ts";
import { AppNotFoundError } from "./errors.ts";
import { buildAppContext, type CookieSlot } from "./identity/context.ts";
import type { ScryptParams } from "./identity/hash.ts";
import { createIdentityService, type IdentityService } from "./identity/service.ts";
import { lockboxKeyringFromEnv, type LockboxKeyring } from "./lockbox/crypto.ts";
import { createLockboxService, type LockboxService } from "./lockbox/service.ts";
import { createOAuthBroker, type OAuthBroker } from "./oauth/broker.ts";
import type { OAuthProviderConfig } from "./oauth/providers.ts";
import { envOAuthSecrets, type OAuthSecrets } from "./oauth/secrets.ts";

export type AppHostOptions = {
  readonly rootAppId?: string;
  readonly accountAppId?: string;
  /** Seed Bible's own database (tests). Production seeds from bundled KJV on first open. */
  readonly bibleSeed?: KjvData;
  readonly bibleDb?: string;
  readonly accountDb?: string;
  readonly notesDb?: string;
  /** Host identity database, or a file path. Default `:memory:`. */
  readonly db?: Db | string;
  readonly allowRegistration?: boolean;
  readonly identityAppIds?: readonly string[];
  readonly lockboxAppIds?: readonly string[];
  readonly oauthAppIds?: readonly string[];
  readonly lockboxKeys?: LockboxKeyring;
  readonly oauthProviders?: readonly OAuthProviderConfig[];
  readonly oauthSecrets?: OAuthSecrets;
  readonly fetch?: typeof fetch;
  readonly scrypt?: ScryptParams;
  readonly hashConcurrency?: number;
  readonly extraApps?: readonly AppModule[];
  readonly configuredOrigin?: string;
};

export type NowiseeHost = {
  readonly rootAppId: string;
  readonly accountAppId: string;
  readonly identityAppIds: ReadonlySet<string>;
  readonly lockboxAppIds: ReadonlySet<string>;
  readonly oauthAppIds: ReadonlySet<string>;
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
 * Home, Help, Bible, Notes, and Account.
 */
export function createNowiseeHost(options: AppHostOptions = {}): NowiseeHost {
  const rootAppId = options.rootAppId ?? "home";
  const accountAppId = options.accountAppId ?? "account";
  const identityAppIds = new Set(options.identityAppIds ?? [accountAppId]);
  const lockboxAppIds = new Set(options.lockboxAppIds ?? []);
  const oauthAppIds = new Set(options.oauthAppIds ?? []);
  const db = resolveDb(options.db);
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
      providers: options.oauthProviders ?? [],
      secrets: options.oauthSecrets ?? envOAuthSecrets(),
      configuredOrigin: options.configuredOrigin,
      fetch: options.fetch,
    });
  }
  const identity = createIdentityService({
    db,
    scrypt: options.scrypt,
    hashConcurrency: options.hashConcurrency,
    allowRegistration: options.allowRegistration,
  });

  const bible = startBibleApp({
    rootAppId,
    dbPath: options.bibleDb ?? defaultAppDbPath(options.db, "bible"),
    seed: options.bibleSeed,
  });
  const notes = startNotesApp({
    rootAppId,
    dbPath: options.notesDb ?? defaultAppDbPath(options.db, "notes"),
  });
  const account = startAccountApp({
    rootAppId,
    dbPath: options.accountDb ?? defaultAppDbPath(options.db, "account"),
  });

  const registry = new AppRegistry();
  registry.register(
    createHomeApp({
      listEnabled: () => registry.listEnabled(),
      rootAppId,
    }),
  );
  registry.register(createHelpApp({ rootAppId }));
  registry.register(bible);
  registry.register(notes);
  registry.register(account);
  for (const extra of options.extraApps ?? []) {
    registry.register(extra);
  }

  async function open(
    appId: string,
    path: string,
    extras: WireExtras,
    ctx?: AppServerContext,
  ): Promise<RefreshResult> {
    return invoke(registry, appId, (app) => app.open(path, toRefreshExtras(extras), ctx));
  }

  async function refresh(
    appId: string,
    stack: readonly StackEntry[],
    extras: WireExtras,
    ctx?: AppServerContext,
  ): Promise<RefreshResult> {
    return invoke(registry, appId, (app) => app.refresh(stack, toRefreshExtras(extras), ctx));
  }

  return {
    rootAppId,
    accountAppId,
    identityAppIds,
    lockboxAppIds,
    oauthAppIds,
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
      bible.close();
      notes.close();
      account.close();
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

function defaultAppDbPath(hostDb: Db | string | undefined, appId: string): string {
  if (hostDb && typeof hostDb === "object") {
    return ":memory:";
  }
  if (hostDb === undefined || hostDb === ":memory:") {
    return ":memory:";
  }
  return `data/apps/${appId}.db`;
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
