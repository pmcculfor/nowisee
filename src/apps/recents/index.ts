import type {
  AppModule,
  AppServerContext,
  RefreshExtras,
  RefreshResult,
} from "../../core/types.ts";
import { RECENTS_APP_ID, RECENTS_APP_LABEL } from "./ids.ts";
import { openRecents, refreshRecents, type RecentsViewDeps } from "./view.ts";

export type RecentsAppDeps = {
  readonly rootAppId: string;
};

export function createRecentsApp(deps: RecentsAppDeps): AppModule {
  const viewDeps: RecentsViewDeps = { rootAppId: deps.rootAppId };
  return {
    id: RECENTS_APP_ID,
    label: RECENTS_APP_LABEL,
    open(_path: string, extras: RefreshExtras = {}, ctx?: AppServerContext): RefreshResult {
      return openRecents(viewDeps, extras, ctx);
    },
    refresh(
      nodeId: string,
      extras: RefreshExtras = {},
      ctx?: AppServerContext,
    ): RefreshResult {
      return refreshRecents(viewDeps, nodeId, extras, ctx);
    },
  };
}

export { RECENTS_APP_ID, RECENTS_APP_LABEL } from "./ids.ts";
