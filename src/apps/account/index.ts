import type {
  AppModule,
  AppServerContext,
  RefreshExtras,
  RefreshResult,
  StackEntry,
} from "../../core/types.ts";
import { ACCOUNT_APP_ID } from "./ids.ts";
import type { AccountFlowStore } from "./types.ts";
import { openAccount, refreshAccount, type AccountViewDeps } from "./view.ts";

export type AccountAppDeps = {
  readonly rootAppId: string;
  readonly flow: AccountFlowStore;
};

export function createAccountApp(deps: AccountAppDeps): AppModule {
  const viewDeps: AccountViewDeps = {
    rootAppId: deps.rootAppId,
    flow: deps.flow,
  };

  return {
    id: ACCOUNT_APP_ID,
    label: "Account",
    open(path: string, _extras?: RefreshExtras, ctx?: AppServerContext): Promise<RefreshResult> {
      return openAccount(viewDeps, path, ctx);
    },
    refresh(
      stack: readonly StackEntry[],
      extras: RefreshExtras = {},
      ctx?: AppServerContext,
    ): Promise<RefreshResult> {
      return refreshAccount(viewDeps, stack, extras, ctx);
    },
  };
}

export type { AccountFlowStore } from "./types.ts";
export { ACCOUNT_APP_ID } from "./ids.ts";
