import type {
  AppModule,
  AppServerContext,
  OpenResult,
  RefreshExtras,
  RefreshResult,
} from "../../core/types.ts";
import type { BibleStore, BibleSeed } from "./types.ts";
import { openBibleView, refreshBibleView, type BibleViewDeps } from "./view/index.ts";
import { ensureCatalog, type EnsureCatalogOptions } from "./import.ts";
import { MEMORY_SEED } from "./memorySeed.ts";
import {
  createSqliteBibleStore,
  DEFAULT_BIBLE_DB_PATH,
  openBibleDatabase,
} from "./store.ts";

export const BIBLE_APP_ID = "bible";

export type BibleAppDeps = {
  readonly rootAppId: string;
  readonly store: BibleStore;
};

export type BibleApp = AppModule & { close(): void };

export type StartBibleAppOptions = {
  readonly rootAppId: string;
  readonly dbPath?: string;
  readonly seed?: BibleSeed;
  readonly rawDir?: string;
};

/** Opens Bible's own SQLite file and returns the AppModule. */
export function startBibleApp(options: StartBibleAppOptions): BibleApp {
  const dbPath = options.dbPath ?? DEFAULT_BIBLE_DB_PATH;
  const db = openBibleDatabase(dbPath);
  const catalog: EnsureCatalogOptions = {
    seed: options.seed ?? (dbPath === ":memory:" ? MEMORY_SEED : undefined),
    rawDir: options.rawDir,
  };
  ensureCatalog(db, catalog);
  const store = createSqliteBibleStore(db);
  return createBibleApp({ rootAppId: options.rootAppId, store });
}

/**
 * Bible as a portable AppModule.
 * Domain data and graph shape stay here — core never knows about verses.
 * Persistence is behind `deps.store` (opened by the app's SQLite helper).
 */
export function createBibleApp(deps: BibleAppDeps): BibleApp {
  const viewDeps: BibleViewDeps = {
    store: deps.store,
    rootAppId: deps.rootAppId,
    appId: BIBLE_APP_ID,
  };

  return {
    id: BIBLE_APP_ID,
    label: "Bible",
    open(path: string, extras: RefreshExtras = {}, ctx?: AppServerContext): OpenResult {
      return openBibleView(viewDeps, path, extras, ctx);
    },
    refresh(
      nodeId: string,
      extras: RefreshExtras = {},
      ctx?: AppServerContext,
    ): RefreshResult {
      if (!nodeId) {
        return openBibleView(viewDeps, "/", extras, ctx);
      }
      return refreshBibleView(viewDeps, nodeId, extras, ctx);
    },
    close() {
      deps.store.close();
    },
  };
}

export type {
  BibleBook,
  BibleRef,
  BibleSeed,
  BibleStore,
  BibleVersion,
} from "./types.ts";
export { DEFAULT_BIBLE_DB_PATH, openBibleDatabase, createSqliteBibleStore } from "./store.ts";
