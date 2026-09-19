import type {
  AppModule,
  AppServerContext,
  RefreshExtras,
  RefreshResult,
} from "../../core/types.ts";
import { NODE, WEATHER_APP_ID, WEATHER_APP_LABEL } from "./ids.ts";
import { buildWeatherView, openWeatherPath, type WeatherViewDeps } from "./view.ts";
import {
  createSqliteWeatherStore,
  DEFAULT_WEATHER_DB_PATH,
  openWeatherDatabase,
} from "./store.ts";
import { createNwsWeatherClient } from "./nwsClient.ts";
import type { WeatherClient, WeatherStore } from "./types.ts";

export type WeatherAppDeps = {
  readonly rootAppId: string;
  readonly store: WeatherStore;
  readonly client: WeatherClient;
  readonly close?: () => void;
};

export type WeatherApp = AppModule & { close(): void };

export type StartWeatherAppOptions = {
  readonly rootAppId: string;
  readonly dbPath?: string;
  readonly fetch?: typeof fetch;
};

/** Opens Weather's own SQLite file and returns the AppModule. */
export function startWeatherApp(options: StartWeatherAppOptions): WeatherApp {
  const db = openWeatherDatabase(options.dbPath ?? DEFAULT_WEATHER_DB_PATH);
  return createWeatherApp({
    rootAppId: options.rootAppId,
    store: createSqliteWeatherStore(db),
    client: createNwsWeatherClient({ fetch: options.fetch }),
    close: () => db.close(),
  });
}

/**
 * Weather as a portable AppModule.
 * One ZIP per signed-in user; current plus daily forecast from a live lookup.
 * Persistence is entirely behind `deps.store`. NWS lives behind `deps.client`.
 * Signed-out (`ctx.userId` null) is a sign-in node; no lookup and no zip write.
 */
export function createWeatherApp(deps: WeatherAppDeps): WeatherApp {
  const viewDeps: WeatherViewDeps = {
    rootAppId: deps.rootAppId,
    store: deps.store,
    client: deps.client,
  };

  return {
    id: WEATHER_APP_ID,
    label: WEATHER_APP_LABEL,
    open(path: string, extras: RefreshExtras = {}, ctx?: AppServerContext): Promise<RefreshResult> {
      return openWeatherPath(viewDeps, path, extras, ctx);
    },
    refresh(
      nodeId: string,
      extras: RefreshExtras = {},
      ctx?: AppServerContext,
    ): Promise<RefreshResult> {
      return buildWeatherView(viewDeps, nodeId || NODE.current, extras, ctx);
    },
    close() {
      deps.close?.();
    },
  };
}

export type { WeatherClient, WeatherDay, WeatherSnapshot, WeatherStore } from "./types.ts";
export { WEATHER_APP_ID, WEATHER_APP_LABEL, NODE, dayNodeId, parseZip, placeLabel } from "./ids.ts";
export { WeatherClientError } from "./types.ts";
export { DEFAULT_WEATHER_DB_PATH, openWeatherDatabase, createSqliteWeatherStore } from "./store.ts";
