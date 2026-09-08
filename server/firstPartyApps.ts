import type { AppModule, HomeRole } from "../src/core/types.ts";
import { startAccountApp, DEFAULT_ACCOUNT_DB_PATH } from "../src/apps/account/store.ts";
import { startBibleApp, DEFAULT_BIBLE_DB_PATH } from "../src/apps/bible/store.ts";
import { GMAIL_OAUTH_PROVIDER } from "../src/apps/gmail/oauth.ts";
import { startGmailApp, DEFAULT_GMAIL_DB_PATH } from "../src/apps/gmail/store.ts";
import { createHelpApp } from "../src/apps/help/index.ts";
import { startHomeApp, DEFAULT_HOME_DB_PATH } from "../src/apps/home/store.ts";
import { startNotesApp, DEFAULT_NOTES_DB_PATH } from "../src/apps/notes/store.ts";
import { createRecentsApp } from "../src/apps/recents/index.ts";
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
 * `homeRole` is Home-list policy (not the shell root). Omit = `"optional"`.
 * `parkable` is Recents-list policy. Omit = true. Navigator still parks everyone.
 */
export type AppPack = {
  start(host: HostStart): StartedApp;
  readonly directory?: boolean;
  readonly identity?: boolean;
  readonly lockbox?: boolean;
  readonly oauth?: OAuthProviderConfig;
  readonly homeRole?: HomeRole;
  readonly parkable?: boolean;
};

export function packStorePath(host: HostStart, persistentPath: string): string {
  return host.ephemeral ? ":memory:" : persistentPath;
}

export const FIRST_PARTY_APPS: readonly AppPack[] = [
  {
    directory: true,
    homeRole: "internal",
    start: (host) =>
      startHomeApp({
        dbPath: packStorePath(host, DEFAULT_HOME_DB_PATH),
      }),
  },
  {
    directory: true,
    homeRole: "internal",
    parkable: false,
    start: (host) => createRecentsApp({ rootAppId: host.rootAppId }),
  },
  {
    homeRole: "default",
    start: (host) => createHelpApp({ rootAppId: host.rootAppId }),
  },
  {
    homeRole: "default",
    start: (host) =>
      startBibleApp({
        rootAppId: host.rootAppId,
        dbPath: packStorePath(host, DEFAULT_BIBLE_DB_PATH),
      }),
  },
  {
    homeRole: "default",
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
    homeRole: "required",
    start: (host) =>
      startAccountApp({
        rootAppId: host.rootAppId,
        dbPath: packStorePath(host, DEFAULT_ACCOUNT_DB_PATH),
      }),
  },
];
