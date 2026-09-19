import type {
  AppModule,
  AppServerContext,
  RefreshExtras,
  RefreshResult,
} from "../../core/types.ts";
import { GMAIL_APP_ID, GMAIL_APP_LABEL } from "./ids.ts";
import { buildGmailView, openGmailPath, type GmailViewDeps } from "./view.ts";
import {
  createSqliteGmailStore,
  DEFAULT_GMAIL_DB_PATH,
  openGmailDatabase,
} from "./store.ts";
import { createGmailApiClient } from "./gmailClient.ts";
import type { GmailClient, GmailStore } from "./types.ts";

export type GmailAppDeps = {
  readonly rootAppId: string;
  readonly store: GmailStore;
  readonly client: GmailClient;
  readonly close?: () => void;
};

export type GmailApp = AppModule & { close(): void };

export type StartGmailAppOptions = {
  readonly rootAppId: string;
  readonly dbPath?: string;
  readonly fetch?: typeof fetch;
};

export function startGmailApp(options: StartGmailAppOptions): GmailApp {
  const db = openGmailDatabase(options.dbPath ?? DEFAULT_GMAIL_DB_PATH);
  return createGmailApp({
    rootAppId: options.rootAppId,
    store: createSqliteGmailStore(db),
    client: createGmailApiClient({ fetch: options.fetch }),
    close: () => db.close(),
  });
}

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
      nodeId: string,
      extras: RefreshExtras = {},
      ctx?: AppServerContext,
    ): Promise<RefreshResult> {
      return buildGmailView(viewDeps, nodeId || null, extras, ctx);
    },
    close() {
      deps.close?.();
    },
  };
}

export type { ComposeDraft, GmailClient, GmailStore, InboxMessage } from "./types.ts";
export { GMAIL_APP_ID, GMAIL_APP_LABEL, GMAIL_OAUTH_SLOT, NODE } from "./ids.ts";
export { GMAIL_OAUTH_PROVIDER } from "./oauth.ts";
export { DEFAULT_GMAIL_DB_PATH, openGmailDatabase, createSqliteGmailStore } from "./store.ts";
