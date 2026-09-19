import type {
  AppModule,
  AppServerContext,
  RefreshExtras,
  RefreshResult,
} from "../../core/types.ts";
import { HOME_APP_ID } from "./ids.ts";
import { buildHomeView, openHomePath, type HomeViewDeps } from "./view.ts";
import {
  createSqliteHomeStore,
  DEFAULT_HOME_DB_PATH,
  openHomeDatabase,
} from "./store.ts";
import type { HomeStore } from "./types.ts";

export type HomeAppDeps = {
  readonly store?: HomeStore;
  readonly close?: () => void;
};

export type HomeApp = AppModule & { close(): void };

export type StartHomeAppOptions = {
  readonly dbPath?: string;
};

/** Opens Home's own SQLite file and returns the AppModule. */
export function startHomeApp(options: StartHomeAppOptions = {}): HomeApp {
  const db = openHomeDatabase(options.dbPath ?? DEFAULT_HOME_DB_PATH);
  return createHomeApp({
    store: createSqliteHomeStore(db),
    close: () => db.close(),
  });
}

/**
 * Home is an ordinary AppModule. It lists installed apps from `ctx.directory`
 * (with `homeRole`) and links to them with `app` edges — never foreign node ids.
 */
export function createHomeApp(deps: HomeAppDeps = {}): HomeApp {
  const viewDeps: HomeViewDeps = { store: deps.store };

  return {
    id: HOME_APP_ID,
    label: "Home",
    open(
      path: string,
      extras: RefreshExtras = {},
      ctx?: AppServerContext,
    ): Promise<RefreshResult> {
      return openHomePath(viewDeps, path, extras, ctx);
    },
    refresh(
      nodeId: string,
      extras: RefreshExtras = {},
      ctx?: AppServerContext,
    ): Promise<RefreshResult> {
      return buildHomeView(viewDeps, nodeId || undefined, extras, ctx);
    },
    close() {
      deps.close?.();
    },
  };
}

export type { HomeStore } from "./types.ts";
export { HOME_APP_ID } from "./ids.ts";
export { DEFAULT_HOME_DB_PATH, openHomeDatabase, createSqliteHomeStore } from "./store.ts";
