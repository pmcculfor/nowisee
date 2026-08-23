import type {
  AppModule,
  RefreshExtras,
  RefreshResult,
  StackEntry,
} from "../../core/types.ts";
import { HELP_APP_ID, HELP_APP_LABEL } from "./ids.ts";
import { openHelp, refreshHelp, type HelpViewDeps } from "./view.ts";

export type HelpAppDeps = {
  readonly rootAppId: string;
};

export function createHelpApp(deps: HelpAppDeps): AppModule {
  const viewDeps: HelpViewDeps = { rootAppId: deps.rootAppId };

  return {
    id: HELP_APP_ID,
    label: HELP_APP_LABEL,
    open(path: string, extras: RefreshExtras = {}): RefreshResult {
      return openHelp(viewDeps, path, extras);
    },
    refresh(stack: readonly StackEntry[], extras: RefreshExtras = {}): RefreshResult {
      const tipId = stack[stack.length - 1]?.nodeId;
      return refreshHelp(viewDeps, tipId, extras);
    },
  };
}

export { HELP_APP_ID, HELP_APP_LABEL, NODE } from "./ids.ts";
