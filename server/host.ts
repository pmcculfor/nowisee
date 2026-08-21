import { createBibleApp } from "../src/apps/bible/index.ts";
import type { KjvData } from "../src/apps/bible/types.ts";
import kjvJson from "../src/apps/bible/data/kjv.json" with { type: "json" };
import { createHomeApp } from "../src/apps/home.ts";
import type { AppRpc, WireExtras } from "../src/apps/rpc.ts";
import { AppRegistry } from "../src/core/registry.ts";
import type { RefreshExtras, RefreshResult } from "../src/core/types.ts";
import { AppNotFoundError } from "./errors.ts";

export type AppHostOptions = {
  readonly rootAppId?: string;
  readonly kjv?: KjvData;
};

/**
 * In-process open/refresh for apps that run on the server.
 * Home and Bible only in this slice — Notes is not registered.
 */
export function createAppHost(options: AppHostOptions = {}): AppRpc {
  const rootAppId = options.rootAppId ?? "home";
  const registry = new AppRegistry();
  registry.register(
    createHomeApp({
      listEnabled: () => registry.listEnabled(),
      rootAppId,
    }),
  );
  registry.register(
    createBibleApp({
      rootAppId,
      data: options.kjv ?? (kjvJson as KjvData),
    }),
  );

  return {
    async open(appId, path, extras) {
      return invoke(registry, appId, (app) => app.open(path, toRefreshExtras(extras)));
    },
    async refresh(appId, stack, extras) {
      return invoke(registry, appId, (app) => app.refresh(stack, toRefreshExtras(extras)));
    },
  };
}

async function invoke(
  registry: AppRegistry,
  appId: string,
  run: (app: NonNullable<ReturnType<AppRegistry["get"]>>) => Promise<RefreshResult> | RefreshResult,
): Promise<RefreshResult> {
  const app = registry.get(appId);
  if (!app) {
    throw new AppNotFoundError(appId);
  }
  return run(app);
}

function toRefreshExtras(extras: WireExtras): RefreshExtras {
  const out: RefreshExtras = {};
  if (extras.inputText !== undefined) {
    out.inputText = extras.inputText;
  }
  if (extras.action) {
    out.action = true;
  }
  return out;
}
