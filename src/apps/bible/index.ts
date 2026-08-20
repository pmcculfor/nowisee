import type {
  AppModule,
  RefreshExtras,
  RefreshResult,
  StackEntry,
} from "../../core/types.ts";
import { parseNodeId } from "./ids.ts";
import type { KjvData } from "./types.ts";
import {
  buildBibleView,
  parseBiblePath,
  resolveCopyStatus,
  type BibleViewDeps,
} from "./view.ts";

export type BibleAppDeps = {
  readonly rootAppId: string;
  readonly data: KjvData;
};

/**
 * KJV Bible as a portable AppModule.
 * Domain data and graph shape stay here — core never knows about verses.
 */
export function createBibleApp(deps: BibleAppDeps): AppModule {
  const viewDeps: BibleViewDeps = {
    data: deps.data,
    rootAppId: deps.rootAppId,
  };

  return {
    id: "bible",
    label: "Bible",
    open(path: string): RefreshResult {
      const tipId = parseBiblePath(deps.data, path);
      return buildBibleView(viewDeps, tipId);
    },
    refresh(
      stack: readonly StackEntry[],
      extras: RefreshExtras = {},
    ): Promise<RefreshResult> | RefreshResult {
      const tipId = stack[stack.length - 1]?.nodeId ?? parseBiblePath(deps.data, "/");
      const parsed = parseNodeId(tipId);
      if (parsed?.kind === "copy-status" && extras.action) {
        return resolveCopyStatus(viewDeps, parsed.ref, extras);
      }
      return buildBibleView(viewDeps, tipId);
    },
  };
}

export type { KjvData, KjvBook, BibleRef } from "./types.ts";
