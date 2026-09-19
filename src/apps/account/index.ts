import type {
  AppModule,
  AppServerContext,
  RefreshExtras,
  RefreshResult,
} from "../../core/types.ts";
import { ACCOUNT_APP_ID } from "./ids.ts";
import type { AccountFlowStore } from "./types.ts";
import { openAccount, refreshAccount, type AccountViewDeps } from "./view.ts";
import {
  createAccountFlowStore,
  DEFAULT_ACCOUNT_DB_PATH,
  openAccountDatabase,
} from "./store.ts";

export type AccountAppDeps = {
  readonly rootAppId: string;
  readonly flow: AccountFlowStore;
  readonly close?: () => void;
};

export type AccountApp = AppModule & { close(): void };

export type StartAccountAppOptions = {
  readonly rootAppId: string;
  readonly dbPath?: string;
};

/** Opens Account's own SQLite file and returns the AppModule. */
export function startAccountApp(options: StartAccountAppOptions): AccountApp {
  const db = openAccountDatabase(options.dbPath ?? DEFAULT_ACCOUNT_DB_PATH);
  return createAccountApp({
    rootAppId: options.rootAppId,
    flow: createAccountFlowStore(db),
    close: () => db.close(),
  });
}

export function createAccountApp(deps: AccountAppDeps): AccountApp {
  const viewDeps: AccountViewDeps = {
    rootAppId: deps.rootAppId,
    flow: deps.flow,
  };

  return {
    id: ACCOUNT_APP_ID,
    label: "Account",
    open(path: string, _extras?: RefreshExtras, ctx?: AppServerContext): Promise<RefreshResult> {
      return openAccount(viewDeps, path, ctx);
    },
    refresh(
      nodeId: string,
      extras: RefreshExtras = {},
      ctx?: AppServerContext,
    ): Promise<RefreshResult> {
      return refreshAccount(viewDeps, nodeId, extras, ctx);
    },
    close() {
      deps.close?.();
    },
  };
}

export type { AccountFlowStore } from "./types.ts";
export { ACCOUNT_APP_ID } from "./ids.ts";
export { DEFAULT_ACCOUNT_DB_PATH, openAccountDatabase, createAccountFlowStore } from "./store.ts";
