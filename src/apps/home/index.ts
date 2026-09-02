import type {
  AppModule,
  AppServerContext,
  RefreshExtras,
  RefreshResult,
  StackEntry,
} from "../../core/types.ts";
import { HOME_APP_ID } from "./ids.ts";
import { buildHomeView, openHomePath, type HomeViewDeps } from "./view.ts";
import type { HomeStore } from "./types.ts";

export type HomeAppDeps = {
  readonly store?: HomeStore;
  readonly close?: () => void;
};

export type HomeApp = AppModule & { close(): void };

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
      stack: readonly StackEntry[],
      extras: RefreshExtras = {},
      ctx?: AppServerContext,
    ): Promise<RefreshResult> {
      const tipId = stack[stack.length - 1]?.nodeId;
      return buildHomeView(viewDeps, tipId, extras, ctx);
    },
    close() {
      deps.close?.();
    },
  };
}

export type { HomeStore } from "./types.ts";
export { HOME_APP_ID } from "./ids.ts";
