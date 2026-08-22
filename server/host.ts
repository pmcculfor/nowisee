import { createAccountApp } from "../src/apps/account/index.ts";
import { createBibleApp } from "../src/apps/bible/index.ts";
import type { KjvData } from "../src/apps/bible/types.ts";
import kjvJson from "../src/apps/bible/data/kjv.json" with { type: "json" };
import { createHomeApp } from "../src/apps/home.ts";
import type { AppRpc, WireExtras } from "../src/apps/rpc.ts";
import { AppRegistry } from "../src/core/registry.ts";
import type {
  AppDescriptor,
  AppModule,
  AppServerContext,
  RefreshExtras,
  RefreshResult,
  StackEntry,
} from "../src/core/types.ts";
import { createAccountFlowStore } from "./accountFlow.ts";
import type { Db } from "./db/index.ts";
import { openDatabase } from "./db/index.ts";
import { AppNotFoundError } from "./errors.ts";
import { buildAppContext, type CookieSlot } from "./identity/context.ts";
import type { ScryptParams } from "./identity/hash.ts";
import { createIdentityService, type IdentityService } from "./identity/service.ts";

export type AppHostOptions = {
  readonly rootAppId?: string;
  readonly accountAppId?: string;
  readonly kjv?: KjvData;
  /** Open database, or a file path. Default `:memory:`. */
  readonly db?: Db | string;
  readonly allowRegistration?: boolean;
  readonly identityAppIds?: readonly string[];
  readonly scrypt?: ScryptParams;
  readonly hashConcurrency?: number;
  readonly extraApps?: readonly AppModule[];
  readonly configuredOrigin?: string;
};

export type NowiseeHost = {
  readonly rootAppId: string;
  readonly accountAppId: string;
  readonly identityAppIds: ReadonlySet<string>;
  readonly configuredOrigin: string | undefined;
  readonly identity: IdentityService;
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
 * Home, Bible, and Account. Notes is not registered.
 */
export function createNowiseeHost(options: AppHostOptions = {}): NowiseeHost {
  const rootAppId = options.rootAppId ?? "home";
  const accountAppId = options.accountAppId ?? "account";
  const identityAppIds = new Set(options.identityAppIds ?? [accountAppId]);
  const db = resolveDb(options.db);
  const identity = createIdentityService({
    db,
    scrypt: options.scrypt,
    hashConcurrency: options.hashConcurrency,
    allowRegistration: options.allowRegistration,
  });
  const flow = createAccountFlowStore(db);

  const registry = new AppRegistry();
  registry.register(
    createHomeApp({
      listEnabled: (userId) => catalogFor(registry, accountAppId, userId ?? null),
      rootAppId,
    }),
  );
  registry.register(
    createBibleApp({
      rootAppId,
      data: options.kjv ?? (kjvJson as KjvData),
    }),
  );
  registry.register(
    createAccountApp({
      rootAppId,
      flow,
    }),
  );
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
    configuredOrigin: options.configuredOrigin,
    identity,
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
      });
      if (kind === "open") {
        return app.open(args.path ?? "/", toRefreshExtras(args.extras), ctx);
      }
      return app.refresh(args.stack ?? [], toRefreshExtras(args.extras), ctx);
    },
    close() {
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

function catalogFor(
  registry: AppRegistry,
  accountAppId: string,
  userId: string | null,
): AppDescriptor[] {
  return registry.listEnabled().map((app) => {
    if (app.id !== accountAppId) {
      return app;
    }
    return { id: app.id, label: userId ? "Account" : "Sign in" };
  });
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
