import type {
  AppModule,
  RefreshExtras,
  RefreshResult,
  StackEntry,
} from "../../core/types.ts";
import { parseNodeId } from "./ids.ts";
import type { BibleStore } from "./types.ts";
import {
  buildBibleView,
  parseBiblePath,
  resolveCopyStatus,
  type BibleViewDeps,
} from "./view.ts";

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
  };

  return {
    id: "bible",
    label: "Bible",
    open(path: string): RefreshResult {
      const tipId = parseBiblePath(deps.store, path);
      return buildBibleView(viewDeps, tipId);
    },
    refresh(
      stack: readonly StackEntry[],
      extras: RefreshExtras = {},
    ): Promise<RefreshResult> | RefreshResult {
      const tipId = stack[stack.length - 1]?.nodeId ?? parseBiblePath(deps.store, "/");
      const parsed = parseNodeId(tipId);
      if (parsed?.kind === "copy-status" && extras.action) {
        return resolveCopyStatus(viewDeps, parsed.ref);
      }
      return buildBibleView(viewDeps, tipId);
    },
    close() {
      deps.store.close();
    },
  };
}

export type { BibleBook, BibleRef, BibleStore, BibleVerse, BibleVersion, KjvBook, KjvData } from "./types.ts";
