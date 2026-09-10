import type {
  AppModule,
  AppServerContext,
  RefreshExtras,
  RefreshResult,
  StackEntry,
} from "../../core/types.ts";
import { CREATE_NODE_ID, LISTS_APP_ID } from "./ids.ts";
import {
  buildListsView,
  openListsPath,
  type ListsViewDeps,
} from "./view.ts";
import type { ListsStore } from "./types.ts";

export type ListsAppDeps = {
  readonly rootAppId: string;
  readonly store: ListsStore;
  readonly close?: () => void;
};

export type ListsApp = AppModule & { close(): void };

/**
 * Lists as a portable AppModule.
 * Catalog of list titles; enter a list to browse items. Complete / restore /
 * delete run only when `extras.action` is true.
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
      stack: readonly StackEntry[],
      extras: RefreshExtras = {},
      ctx?: AppServerContext,
    ): Promise<RefreshResult> {
      const tipId = stack[stack.length - 1]?.nodeId ?? CREATE_NODE_ID;
      return buildListsView(viewDeps, tipId, stack.length, extras, ctx);
    },
    close() {
      deps.close?.();
    },
  };
}

export type { FirstActiveItem, ListItemRecord, ListRecord, ListsStore } from "./types.ts";
export { firstLineLabel, LISTS_APP_ID } from "./ids.ts";
