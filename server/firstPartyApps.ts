import type { AppModule } from "../src/core/types.ts";
import { startAccountApp, DEFAULT_ACCOUNT_DB_PATH } from "../src/apps/account/store.ts";
import { startBibleApp, DEFAULT_BIBLE_DB_PATH } from "../src/apps/bible/store.ts";
import { GMAIL_OAUTH_PROVIDER } from "../src/apps/gmail/oauth.ts";
import { startGmailApp, DEFAULT_GMAIL_DB_PATH } from "../src/apps/gmail/store.ts";
import { createHelpApp } from "../src/apps/help/index.ts";
import { createHomeApp } from "../src/apps/home.ts";
import { startNotesApp, DEFAULT_NOTES_DB_PATH } from "../src/apps/notes/store.ts";
import type { OAuthProviderConfig } from "./oauth/providers.ts";

/** Host-level facts at process start. Apps that own files interpret `ephemeral`. */
export type HostStart = {
  readonly rootAppId: string;
  readonly ephemeral: boolean;
};

export type StartedApp = AppModule & { close?: () => void };

/**
 * One row per first-party app. The host loops this list; it does not name start functions.
 * `ctx` grants (`directory`, `identity`, `lockbox`, `oauth`) are declared here.
 */
export type AppPack = {
  start(host: HostStart): StartedApp;
  readonly directory?: boolean;
  readonly identity?: boolean;
  readonly lockbox?: boolean;
  readonly oauth?: OAuthProviderConfig;
};

export function packStorePath(host: HostStart, persistentPath: string): string {
  return host.ephemeral ? ":memory:" : persistentPath;
}

export const FIRST_PARTY_APPS: readonly AppPack[] = [
  {
    directory: true,
    start: (host) => createHomeApp({ rootAppId: host.rootAppId }),
  },
  {
    start: (host) => createHelpApp({ rootAppId: host.rootAppId }),
  },
  {
    start: (host) =>
      startBibleApp({
        rootAppId: host.rootAppId,
        dbPath: packStorePath(host, DEFAULT_BIBLE_DB_PATH),
      }),
  },
  {
    start: (host) =>
      startNotesApp({
        rootAppId: host.rootAppId,
        dbPath: packStorePath(host, DEFAULT_NOTES_DB_PATH),
      }),
  },
  {
    lockbox: true,
    oauth: GMAIL_OAUTH_PROVIDER,
    start: (host) =>
      startGmailApp({
        rootAppId: host.rootAppId,
        dbPath: packStorePath(host, DEFAULT_GMAIL_DB_PATH),
      }),
  },
  {
    identity: true,
    start: (host) =>
      startAccountApp({
        rootAppId: host.rootAppId,
        dbPath: packStorePath(host, DEFAULT_ACCOUNT_DB_PATH),
      }),
  },
];
