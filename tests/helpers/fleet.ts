import { setLocator, upsertApp } from "../../server/catalog.ts";
import {
  createNowiseeHost,
  hostRpc,
  type AppHostOptions,
  type NowiseeHost,
} from "../../server/host.ts";
import type { OAuthProviderConfig } from "../../server/oauth/providers.ts";
import { startAccountApp } from "../../src/apps/account/index.ts";
import { startBibleApp } from "../../src/apps/bible/index.ts";
import { startGmailApp } from "../../src/apps/gmail/index.ts";
import { startHomeApp } from "../../src/apps/home/index.ts";
import { startListsApp } from "../../src/apps/lists/index.ts";
import { startNotesApp } from "../../src/apps/notes/index.ts";
import { createRecentsApp } from "../../src/apps/recents/index.ts";
import { serveApp, type ServingApp } from "../../src/apps/serve.ts";
import { createTutorialApp } from "../../src/apps/tutorial/index.ts";
import { startWeatherApp } from "../../src/apps/weather/index.ts";
import type { AppRpc } from "../../src/apps/rpc.ts";
import type { AppModule } from "../../src/core/types.ts";

export const FIRST_PARTY_APP_IDS = [
  "home",
  "recents",
  "tutorial",
  "bible",
  "notes",
  "lists",
  "weather",
  "gmail",
  "account",
] as const;

export type FirstPartyAppId = (typeof FIRST_PARTY_APP_IDS)[number];

export type ProbeSpec = {
  readonly app: AppModule;
  readonly grantLockbox?: boolean;
  readonly grantOauth?: boolean;
  readonly grantDirectory?: boolean;
  readonly oauthProvider?: OAuthProviderConfig;
  readonly label?: string;
  readonly homeRole?: "internal" | "required" | "default" | "optional";
  readonly parkable?: boolean;
};

export type TestFleet = {
  readonly host: NowiseeHost;
  readonly rpc: AppRpc;
  close(): Promise<void>;
};

export type StartTestFleetOptions = AppHostOptions & {
  readonly apps?: readonly FirstPartyAppId[];
  readonly probes?: readonly ProbeSpec[];
};

/**
 * Host + capability port + in-process app listeners on ephemeral ports.
 * Locators are written into app_catalog. close() shuts listeners then the host.
 */
export async function startTestFleet(options: StartTestFleetOptions = {}): Promise<TestFleet> {
  const rootAppId = options.rootAppId ?? "home";
  const host = await createNowiseeHost(options);
  const servings: ServingApp[] = [];
  const ids = options.apps ?? FIRST_PARTY_APP_IDS;

  try {
    for (const id of ids) {
      const app = startFirstPartyApp(id, { rootAppId, fetch: options.fetch });
      const serving = await serveApp(app, {
        listen: "ephemeral",
        hostSigningPub: host.hostSigningPublicKey,
        capabilityUrl: host.capabilityOrigin,
      });
      servings.push(serving);
      setLocator(host.db, id, serving.origin);
    }
    for (const probe of options.probes ?? []) {
      const serving = await serveApp(probe.app, {
        listen: "ephemeral",
        hostSigningPub: host.hostSigningPublicKey,
        capabilityUrl: host.capabilityOrigin,
      });
      servings.push(serving);
      upsertApp(host.db, {
        appId: probe.app.id,
        locator: serving.origin,
        label: probe.label ?? probe.app.label,
        grantLockbox: probe.grantLockbox,
        grantOauth: probe.grantOauth,
        grantDirectory: probe.grantDirectory,
        oauthProvider: probe.oauthProvider,
        homeRole: probe.homeRole,
        parkable: probe.parkable,
      });
    }
  } catch (err) {
    await closeFleet(host, servings);
    throw err;
  }

  let closed = false;
  return {
    host,
    rpc: hostRpc(host),
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      await closeFleet(host, servings);
    },
  };
}

function startFirstPartyApp(
  id: FirstPartyAppId,
  opts: { rootAppId: string; fetch?: typeof fetch },
): AppModule {
  switch (id) {
    case "home":
      return startHomeApp({ dbPath: ":memory:" });
    case "recents":
      return createRecentsApp({ rootAppId: opts.rootAppId });
    case "tutorial":
      return createTutorialApp({ rootAppId: opts.rootAppId });
    case "bible":
      return startBibleApp({ rootAppId: opts.rootAppId, dbPath: ":memory:" });
    case "notes":
      return startNotesApp({ rootAppId: opts.rootAppId, dbPath: ":memory:" });
    case "lists":
      return startListsApp({ rootAppId: opts.rootAppId, dbPath: ":memory:" });
    case "weather":
      return startWeatherApp({ rootAppId: opts.rootAppId, dbPath: ":memory:", fetch: opts.fetch });
    case "gmail":
      return startGmailApp({ rootAppId: opts.rootAppId, dbPath: ":memory:", fetch: opts.fetch });
    case "account":
      return startAccountApp({ rootAppId: opts.rootAppId, dbPath: ":memory:" });
  }
}

async function closeFleet(host: NowiseeHost, servings: readonly ServingApp[]): Promise<void> {
  for (const serving of servings) {
    await serving.close();
    const closer = serving.app as AppModule & { close?: () => void };
    closer.close?.();
  }
  await host.close();
}
