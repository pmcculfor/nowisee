import type {
  AppModule,
  AppServerContext,
  RefreshExtras,
  RefreshResult,
} from "../../core/types.ts";
import { CREATE_NODE_ID, LISTS_APP_ID } from "./ids.ts";
import {
  buildListsView,
  openListsPath,
  type ListsViewDeps,
} from "./view.ts";
import {
  createSqliteListsStore,
  DEFAULT_LISTS_DB_PATH,
  openListsDatabase,
} from "./store.ts";
import type { ListsStore } from "./types.ts";

export type ListsAppDeps = {
  readonly rootAppId: string;
  readonly store: ListsStore;
  readonly close?: () => void;
};

export type ListsApp = AppModule & { close(): void };

export type StartListsAppOptions = {
  readonly rootAppId: string;
  readonly dbPath?: string;
};

/** Opens Lists' own SQLite file and returns the AppModule. */
export function startListsApp(options: StartListsAppOptions): ListsApp {
  const db = openListsDatabase(options.dbPath ?? DEFAULT_LISTS_DB_PATH);
  return createListsApp({
    rootAppId: options.rootAppId,
    store: createSqliteListsStore(db),
    close: () => db.close(),
  });
}

/**
 * Lists as a portable AppModule.
 * Catalog of list titles; enter a list to browse items. Complete / restore /
 * delete run only when `extras.action` is set.
 * Signed-out (`ctx.userId` null) is a sign-in node; no rows are written.
 */
export function createListsApp(deps: ListsAppDeps): ListsApp {
  const viewDeps: ListsViewDeps = {
    rootAppId: deps.rootAppId,
    store: deps.store,
  };

  return {
    id: LISTS_APP_ID,
    label: "Lists",
    open(path: string, _extras: RefreshExtras = {}, ctx?: AppServerContext): Promise<RefreshResult> {
      return openListsPath(viewDeps, path, ctx);
    },
    refresh(
      nodeId: string,
      extras: RefreshExtras = {},
      ctx?: AppServerContext,
    ): Promise<RefreshResult> {
      return buildListsView(viewDeps, nodeId || CREATE_NODE_ID, extras, ctx);
    },
    close() {
      deps.close?.();
    },
  };
}

export type { FirstActiveItem, ListItemRecord, ListRecord, ListsStore } from "./types.ts";
export { firstLineLabel, LISTS_APP_ID } from "./ids.ts";
export { DEFAULT_LISTS_DB_PATH, openListsDatabase, createSqliteListsStore } from "./store.ts";
