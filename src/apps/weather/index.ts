import type {
  AppModule,
  AppServerContext,
  RefreshExtras,
  RefreshResult,
  StackEntry,
} from "../../core/types.ts";
import { NODE, WEATHER_APP_ID, WEATHER_APP_LABEL } from "./ids.ts";
import { buildWeatherView, openWeatherPath, type WeatherViewDeps } from "./view.ts";
import type { WeatherClient, WeatherStore } from "./types.ts";

export type WeatherAppDeps = {
  readonly rootAppId: string;
  readonly store: WeatherStore;
  readonly client: WeatherClient;
  readonly close?: () => void;
};

export type WeatherApp = AppModule & { close(): void };

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
      stack: readonly StackEntry[],
      extras: RefreshExtras = {},
      ctx?: AppServerContext,
    ): Promise<RefreshResult> {
      const tipId = stack[stack.length - 1]?.nodeId ?? NODE.current;
      return buildWeatherView(viewDeps, tipId, extras, ctx);
    },
    close() {
      deps.close?.();
    },
  };
}

export type { WeatherClient, WeatherDay, WeatherSnapshot, WeatherStore } from "./types.ts";
export { WEATHER_APP_ID, WEATHER_APP_LABEL, NODE, dayNodeId, parseZip, placeLabel } from "./ids.ts";
export { WeatherClientError } from "./types.ts";
