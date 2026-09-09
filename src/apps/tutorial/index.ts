import type {
  AppModule,
  RefreshExtras,
  RefreshResult,
  StackEntry,
} from "../../core/types.ts";
import { TUTORIAL_APP_ID, TUTORIAL_APP_LABEL } from "./ids.ts";
import { openTutorial, refreshTutorial, type TutorialViewDeps } from "./view.ts";

export type TutorialAppDeps = {
  readonly rootAppId: string;
};

export function createTutorialApp(deps: TutorialAppDeps): AppModule {
  const viewDeps: TutorialViewDeps = { rootAppId: deps.rootAppId };

  return {
    id: TUTORIAL_APP_ID,
    label: TUTORIAL_APP_LABEL,
    open(path: string, extras: RefreshExtras = {}): RefreshResult {
      return openTutorial(viewDeps, path, extras);
    },
    refresh(stack: readonly StackEntry[], extras: RefreshExtras = {}): RefreshResult {
      const tipId = stack[stack.length - 1]?.nodeId;
      return refreshTutorial(viewDeps, tipId, extras);
    },
  };
}

export { NODE, TUTORIAL_APP_ID, TUTORIAL_APP_LABEL } from "./ids.ts";
