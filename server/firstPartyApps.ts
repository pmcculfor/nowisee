import type { AppModule, HomeRole } from "../src/core/types.ts";
import { startAccountApp, DEFAULT_ACCOUNT_DB_PATH } from "../src/apps/account/store.ts";
import { startBibleApp, DEFAULT_BIBLE_DB_PATH } from "../src/apps/bible/store.ts";
import { GMAIL_OAUTH_PROVIDER } from "../src/apps/gmail/oauth.ts";
import { startGmailApp, DEFAULT_GMAIL_DB_PATH } from "../src/apps/gmail/store.ts";
import { createTutorialApp } from "../src/apps/tutorial/index.ts";
import { startHomeApp, DEFAULT_HOME_DB_PATH } from "../src/apps/home/store.ts";
import { startListsApp, DEFAULT_LISTS_DB_PATH } from "../src/apps/lists/store.ts";
import { startNotesApp, DEFAULT_NOTES_DB_PATH } from "../src/apps/notes/store.ts";
import { createRecentsApp } from "../src/apps/recents/index.ts";
import { startWeatherApp, DEFAULT_WEATHER_DB_PATH } from "../src/apps/weather/store.ts";
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

/** Started apps plus the capability grants their pack rows declare. */
export type FirstPartyCatalog = {
  readonly apps: readonly StartedApp[];
  readonly identity: readonly string[];
  readonly lockbox: readonly string[];
  readonly oauth: readonly string[];
  readonly directory: readonly string[];
  readonly providers: readonly OAuthProviderConfig[];
  readonly homeRoleByAppId: ReadonlyMap<string, HomeRole>;
  readonly parkableByAppId: ReadonlyMap<string, boolean>;
};

/**
 * Start every first-party app and read its grants in the same pass, so a pack
 * row and the app it started are never paired by array position.
 */
export function startFirstPartyApps(host: HostStart): FirstPartyCatalog {
  const apps: StartedApp[] = [];
  const identity: string[] = [];
  const lockbox: string[] = [];
  const oauth: string[] = [];
  const directory: string[] = [];
  const providers: OAuthProviderConfig[] = [];
  const homeRoleByAppId = new Map<string, HomeRole>();
  const parkableByAppId = new Map<string, boolean>();

  for (const pack of FIRST_PARTY_APPS) {
    const app = pack.start(host);
    apps.push(app);
    if (pack.identity) {
      identity.push(app.id);
    }
    if (pack.lockbox) {
      lockbox.push(app.id);
    }
    if (pack.oauth) {
      oauth.push(app.id);
      providers.push(pack.oauth);
    }
    if (pack.directory) {
      directory.push(app.id);
    }
    if (pack.homeRole) {
      homeRoleByAppId.set(app.id, pack.homeRole);
    }
    if (pack.parkable === false) {
      parkableByAppId.set(app.id, false);
    }
  }

  return {
    apps,
    identity,
    lockbox,
    oauth,
    directory,
    providers,
    homeRoleByAppId,
    parkableByAppId,
  };
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
    start: (host) => createTutorialApp({ rootAppId: host.rootAppId }),
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
    homeRole: "default",
    start: (host) =>
      startListsApp({
        rootAppId: host.rootAppId,
        dbPath: packStorePath(host, DEFAULT_LISTS_DB_PATH),
      }),
  },
  {
    homeRole: "default",
    start: (host) =>
      startWeatherApp({
        rootAppId: host.rootAppId,
        dbPath: packStorePath(host, DEFAULT_WEATHER_DB_PATH),
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
