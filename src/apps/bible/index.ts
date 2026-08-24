import type {
  AppModule,
  AppServerContext,
  RefreshExtras,
  RefreshResult,
  StackEntry,
} from "../../core/types.ts";
import type { BibleStore } from "./types.ts";
import { openBibleView, refreshBibleView, type BibleViewDeps } from "./view/index.ts";

export const BIBLE_APP_ID = "bible";

export type BibleAppDeps = {
  readonly rootAppId: string;
  readonly store: BibleStore;
};

export type BibleApp = AppModule & { close(): void };

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
    open(path: string, extras: RefreshExtras = {}, ctx?: AppServerContext): RefreshResult {
      return openBibleView(viewDeps, path, extras, ctx);
    },
    refresh(
      stack: readonly StackEntry[],
      extras: RefreshExtras = {},
      ctx?: AppServerContext,
    ): RefreshResult {
      const tipId = stack[stack.length - 1]?.nodeId;
      if (!tipId) {
        return openBibleView(viewDeps, "/", extras, ctx);
      }
      return refreshBibleView(viewDeps, tipId, extras, ctx);
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
  BibleVerse,
  BibleVersion,
} from "./types.ts";
