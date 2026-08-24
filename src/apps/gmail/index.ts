import type {
  AppModule,
  AppServerContext,
  RefreshExtras,
  RefreshResult,
  StackEntry,
} from "../../core/types.ts";
import { GMAIL_APP_ID, GMAIL_APP_LABEL } from "./ids.ts";
import { buildGmailView, openGmailPath, type GmailViewDeps } from "./view.ts";
import type { GmailClient, GmailStore } from "./types.ts";

export type GmailAppDeps = {
  readonly rootAppId: string;
  readonly store: GmailStore;
  readonly client: GmailClient;
  readonly close?: () => void;
};

export type GmailApp = AppModule & { close(): void };

export function createGmailApp(deps: GmailAppDeps): GmailApp {
  const viewDeps: GmailViewDeps = {
    rootAppId: deps.rootAppId,
    store: deps.store,
    client: deps.client,
  };

  return {
    id: GMAIL_APP_ID,
    label: GMAIL_APP_LABEL,
    open(path: string, extras: RefreshExtras = {}, ctx?: AppServerContext): Promise<RefreshResult> {
      return openGmailPath(viewDeps, path, extras, ctx);
    },
    refresh(
      stack: readonly StackEntry[],
      extras: RefreshExtras = {},
      ctx?: AppServerContext,
    ): Promise<RefreshResult> {
      const tipId = stack[stack.length - 1]?.nodeId ?? null;
      return buildGmailView(viewDeps, tipId, extras, ctx);
    },
    close() {
      deps.close?.();
    },
  };
}

export type { ComposeDraft, GmailClient, GmailStore, InboxMessage } from "./types.ts";
export { GMAIL_APP_ID, GMAIL_APP_LABEL, GMAIL_OAUTH_SLOT, NODE } from "./ids.ts";
export { GMAIL_OAUTH_PROVIDER, productionGmailGrants } from "./oauth.ts";
