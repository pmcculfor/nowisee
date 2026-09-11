import {
  buildMap,
  edgeNode,
  inputEdges,
  rootBackToHome,
  siblingListEdges,
  signedOut,
} from "../../app-kit/index.ts";
import type {
  AppLocation,
  AppServerContext,
  NavigationMap,
  NodePayload,
  RefreshExtras,
  RefreshResult,
} from "../../core/types.ts";
import {
  NODE,
  WEATHER_APP_ID,
  dayNodeId,
  parseDayNodeId,
  parseZip,
  placeLabel,
} from "./ids.ts";
import { WeatherClientError, type WeatherClient, type WeatherSnapshot, type WeatherStore } from "./types.ts";

export type WeatherViewDeps = {
  readonly rootAppId: string;
  readonly store: WeatherStore;
  readonly client: WeatherClient;
};

const SIGNED_OUT_TEXT = "Sign in to use Weather.";
const SETUP_LABEL = "Enter your zip code.";
const NOT_FOUND_LABEL = "That zip code was not found.";
const LOAD_ERROR_LABEL = "Could not load weather.";
const SAVING_LABEL = "Saving…";

export async function openWeatherPath(
  deps: WeatherViewDeps,
  path: string,
  extras: RefreshExtras = {},
  ctx?: AppServerContext,
): Promise<RefreshResult> {
  return buildWeatherView(deps, tipIdForPath(path), extras, ctx);
}

export async function buildWeatherView(
  deps: WeatherViewDeps,
  tipId: string,
  extras: RefreshExtras = {},
  ctx?: AppServerContext,
): Promise<RefreshResult> {
  const userId = ctx?.userId ?? null;
  if (!userId) {
    return signedOutWeather(deps, ctx);
  }

  if (extras.action) {
    return applyAction(deps, userId, tipId, extras);
  }

  const zip = await deps.store.getZip(userId);
  if (!zip) {
    return setupView(deps, tipId);
  }

  return weatherFromLookup(deps, zip, tipId, extras.signal);
}

function signedOutWeather(deps: WeatherViewDeps, ctx: AppServerContext | undefined): RefreshResult {
  return signedOut({
    accountAppId: ctx?.accountAppId ?? deps.rootAppId,
    rootAppId: deps.rootAppId,
    appId: WEATHER_APP_ID,
    text: SIGNED_OUT_TEXT,
  });
}

async function applyAction(
  deps: WeatherViewDeps,
  userId: string,
  tipId: string,
  extras: RefreshExtras,
): Promise<RefreshResult> {
  if (tipId !== NODE.zipSave) {
    const zip = await deps.store.getZip(userId);
    if (!zip) {
      return setupView(deps, tipId);
    }
    return weatherFromLookup(deps, zip, tipId, extras.signal);
  }

  const savedZip = await deps.store.getZip(userId);
  if (extras.inputText === undefined) {
    if (!savedZip) {
      return setupView(deps, NODE.setupEdit);
    }
    return weatherFromLookup(deps, savedZip, NODE.placeEdit, extras.signal);
  }

  const parsed = parseZip(extras.inputText);
  if (!parsed) {
    return notFoundView(savedZip, extras.inputText);
  }

  try {
    const snapshot = await deps.client.lookup(parsed);
    await deps.store.setZip(userId, parsed);
    return weatherView(deps, snapshot, parsed, NODE.current);
  } catch (err) {
    if (isAbort(err)) {
      throw err;
    }
    if (isWeatherCode(err, "not-found")) {
      return notFoundView(savedZip, parsed);
    }
    if (!savedZip) {
      return loadErrorSetup();
    }
    return loadErrorWeather(deps);
  }
}

async function weatherFromLookup(
  deps: WeatherViewDeps,
  zip: string,
  tipId: string,
  signal: AbortSignal | undefined,
): Promise<RefreshResult> {
  try {
    const snapshot = await deps.client.lookup(zip, signal);
    return weatherView(deps, snapshot, zip, tipId);
  } catch (err) {
    if (isAbort(err)) {
      throw err;
    }
    if (isWeatherCode(err, "not-found")) {
      return notFoundView(zip, zip);
    }
    return loadErrorWeather(deps);
  }
}

function setupView(deps: WeatherViewDeps, requestedTipId: string): RefreshResult {
  const setup: NodePayload = { id: NODE.setup, label: SETUP_LABEL };
  const edit: NodePayload = { id: NODE.setupEdit, label: "", kind: "input" };
  const saving: NodePayload = { id: NODE.zipSave, label: SAVING_LABEL };
  const payloads = new Map<string, NodePayload>([
    [NODE.setup, setup],
    [NODE.setupEdit, edit],
    [NODE.zipSave, saving],
  ]);

  let tipId = requestedTipId;
  if (!payloads.has(tipId) || tipId === NODE.zipSave) {
    tipId = NODE.setup;
  }
  const tip = payloads.get(tipId)!;

  return {
    node: tip,
    warm: [...payloads.values()],
    navigationMap: buildMap(
      {
        [NODE.setup]: {
          enter: edgeNode(NODE.setupEdit, "replace"),
        },
      },
      inputEdges(NODE.setupEdit, {
        commitTo: NODE.zipSave,
        backTo: NODE.setup,
        action: true,
        commitStackBehavior: "replace",
      }),
      rootBackToHome(NODE.setup, deps.rootAppId, WEATHER_APP_ID),
      rootBackToHome(NODE.zipSave, deps.rootAppId, WEATHER_APP_ID),
    ),
    location: locationFor(tipId),
  };
}

function weatherView(
  deps: WeatherViewDeps,
  snapshot: WeatherSnapshot,
  zip: string,
  requestedTipId: string,
): RefreshResult {
  const listIds = [NODE.place, NODE.current, ...snapshot.days.map((d) => dayNodeId(d.date))];
  const payloads = new Map<string, NodePayload>();

  payloads.set(NODE.place, { id: NODE.place, label: placeLabel(zip) });
  payloads.set(NODE.current, { id: NODE.current, label: snapshot.currentLabel });
  payloads.set(NODE.placeEdit, { id: NODE.placeEdit, label: zip, kind: "input" });
  payloads.set(NODE.zipSave, { id: NODE.zipSave, label: SAVING_LABEL });

  for (const day of snapshot.days) {
    const id = dayNodeId(day.date);
    payloads.set(id, { id, label: day.label });
  }

  let tipId = requestedTipId;
  if (tipId === NODE.zipSave || tipId === NODE.setup || tipId === NODE.setupEdit) {
    tipId = NODE.current;
  }
  if (!payloads.has(tipId)) {
    tipId = NODE.current;
  }
  const tip = payloads.get(tipId)!;

  return {
    node: tip,
    warm: [...payloads.values()],
    navigationMap: weatherMap(deps.rootAppId, listIds),
    location: locationFor(tipId),
  };
}

function weatherMap(rootAppId: string, listIds: readonly string[]): NavigationMap {
  return buildMap(
    siblingListEdges(listIds, { wrap: false }),
    {
      [NODE.place]: {
        enter: edgeNode(NODE.placeEdit, "replace"),
      },
    },
    inputEdges(NODE.placeEdit, {
      commitTo: NODE.zipSave,
      backTo: NODE.place,
      action: true,
      commitStackBehavior: "replace",
    }),
    ...listIds.map((id) => rootBackToHome(id, rootAppId, WEATHER_APP_ID)),
    rootBackToHome(NODE.zipSave, rootAppId, WEATHER_APP_ID),
  );
}

function notFoundView(savedZip: string | null, attempted: string): RefreshResult {
  const node: NodePayload = { id: NODE.notFound, label: NOT_FOUND_LABEL };
  if (savedZip) {
    const edit: NodePayload = { id: NODE.placeEdit, label: parseZip(attempted) ?? attempted.trim(), kind: "input" };
    const header: NodePayload = { id: NODE.place, label: placeLabel(savedZip) };
    return {
      node,
      warm: [node, edit, header],
      navigationMap: buildMap({
        [NODE.notFound]: {
          enter: edgeNode(NODE.placeEdit, "replace"),
          back: edgeNode(NODE.place, "replace"),
        },
      }),
      location: null,
    };
  }

  const edit: NodePayload = { id: NODE.setupEdit, label: parseZip(attempted) ?? attempted.trim(), kind: "input" };
  const prompt: NodePayload = { id: NODE.setup, label: SETUP_LABEL };
  return {
    node,
    warm: [node, edit, prompt],
    navigationMap: buildMap({
      [NODE.notFound]: {
        enter: edgeNode(NODE.setupEdit, "replace"),
        back: edgeNode(NODE.setup, "replace"),
      },
    }),
    location: null,
  };
}

function loadErrorWeather(deps: WeatherViewDeps): RefreshResult {
  const node: NodePayload = { id: NODE.loadError, label: LOAD_ERROR_LABEL };
  return {
    node,
    warm: [node],
    navigationMap: buildMap(
      {
        [NODE.loadError]: {
          enter: edgeNode(NODE.current, "replace"),
        },
      },
      rootBackToHome(NODE.loadError, deps.rootAppId, WEATHER_APP_ID),
    ),
    location: { appId: WEATHER_APP_ID, path: "/" },
  };
}

function loadErrorSetup(): RefreshResult {
  const node: NodePayload = { id: NODE.loadError, label: LOAD_ERROR_LABEL };
  const edit: NodePayload = { id: NODE.setupEdit, label: "", kind: "input" };
  const prompt: NodePayload = { id: NODE.setup, label: SETUP_LABEL };
  return {
    node,
    warm: [node, edit, prompt],
    navigationMap: buildMap({
      [NODE.loadError]: {
        enter: edgeNode(NODE.setupEdit, "replace"),
        back: edgeNode(NODE.setup, "replace"),
      },
    }),
    location: null,
  };
}

function tipIdForPath(path: string): string {
  if (path === "/setup/edit") {
    return NODE.setupEdit;
  }
  if (path === "/setup") {
    return NODE.setup;
  }
  if (path === "/place/edit") {
    return NODE.placeEdit;
  }
  if (path === "/place") {
    return NODE.place;
  }
  if (path === "/now" || path === "/") {
    return NODE.current;
  }
  const day = /^\/day\/(\d{4}-\d{2}-\d{2})\/?$/.exec(path);
  if (day) {
    return dayNodeId(day[1]!);
  }
  return NODE.current;
}

function locationFor(tipId: string): AppLocation | null {
  if (tipId === NODE.setup) {
    return { appId: WEATHER_APP_ID, path: "/setup" };
  }
  if (tipId === NODE.setupEdit) {
    return { appId: WEATHER_APP_ID, path: "/setup/edit" };
  }
  if (tipId === NODE.place) {
    return { appId: WEATHER_APP_ID, path: "/place" };
  }
  if (tipId === NODE.placeEdit) {
    return { appId: WEATHER_APP_ID, path: "/place/edit" };
  }
  if (tipId === NODE.current) {
    return { appId: WEATHER_APP_ID, path: "/now" };
  }
  if (tipId === NODE.zipSave) {
    return null;
  }
  const date = parseDayNodeId(tipId);
  if (date) {
    return { appId: WEATHER_APP_ID, path: `/day/${date}` };
  }
  return { appId: WEATHER_APP_ID, path: "/" };
}

function isWeatherCode(err: unknown, code: WeatherClientError["code"]): boolean {
  return err instanceof WeatherClientError && err.code === code;
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}
