import { buildMap, edgeApp, edgeNode, edgeResume, type MapFragment } from "../../app-kit/index.ts";
import type {
  AppDescriptor,
  AppServerContext,
  NavigationMap,
  NavEdge,
  NodePayload,
  RefreshExtras,
  RefreshResult,
  StackEntry,
} from "../../core/types.ts";
import { appRowId, EMPTY_NODE_ID, HOME_NODE_ID } from "./ids.ts";

export type RecentsViewDeps = {
  readonly rootAppId: string;
};

const EMPTY_LABEL = "No recent apps. Navigate left or up to go Home.";

export function openRecents(
  deps: RecentsViewDeps,
  extras: RefreshExtras,
  ctx?: AppServerContext,
): RefreshResult {
  return viewFor(deps, extras.parkedAppIds ?? [], undefined, ctx);
}

export function refreshRecents(
  deps: RecentsViewDeps,
  stack: readonly StackEntry[],
  extras: RefreshExtras,
  ctx?: AppServerContext,
): RefreshResult {
  const tipId = stack[stack.length - 1]?.nodeId;
  return viewFor(deps, extras.parkedAppIds ?? [], tipId, ctx);
}

function viewFor(
  deps: RecentsViewDeps,
  parkedAppIds: readonly string[],
  tipId: string | undefined,
  ctx?: AppServerContext,
): RefreshResult {
  const rows = listedApps(deps, parkedAppIds, ctx);
  const callerId = parkedAppIds[0];
  const payloads = payloadsFor(rows);
  const firstId = rows[0] ? appRowId(rows[0].id) : undefined;
  const tip =
    (tipId && payloads.get(tipId)) ||
    (firstId ? payloads.get(firstId) : undefined) ||
    payloads.get(EMPTY_NODE_ID)!;

  return {
    navigationMap: recentsMap(deps, rows, callerId),
    warm: [...payloads.values()],
    node: tip,
    location: null,
  };
}

function listedApps(
  deps: RecentsViewDeps,
  parkedAppIds: readonly string[],
  ctx?: AppServerContext,
): AppDescriptor[] {
  const directory = ctx?.directory?.list() ?? [];
  const byId = new Map(directory.map((app) => [app.id, app]));
  const rows: AppDescriptor[] = [];
  for (const id of parkedAppIds) {
    if (id === deps.rootAppId) {
      continue;
    }
    const desc = byId.get(id);
    if (!desc || desc.parkable === false) {
      continue;
    }
    rows.push(desc);
  }
  return rows;
}

function payloadsFor(rows: readonly AppDescriptor[]): Map<string, NodePayload> {
  const payloads = new Map<string, NodePayload>();
  payloads.set(EMPTY_NODE_ID, { id: EMPTY_NODE_ID, label: EMPTY_LABEL });
  payloads.set(HOME_NODE_ID, { id: HOME_NODE_ID, label: "Home" });
  for (const app of rows) {
    const id = appRowId(app.id);
    payloads.set(id, { id, label: app.label });
  }
  return payloads;
}

function recentsMap(
  deps: RecentsViewDeps,
  rows: readonly AppDescriptor[],
  callerId: string | undefined,
): NavigationMap {
  const openHome = edgeApp({ appId: deps.rootAppId, path: "/" });
  const back: NavEdge = callerId ? edgeResume(callerId) : openHome;
  const homeRow = edgeNode(HOME_NODE_ID, "replace");
  const belowHome = rows.length > 0 ? edgeNode(appRowId(rows[0]!.id), "replace") : edgeNode(EMPTY_NODE_ID, "replace");

  const fragment: Record<string, MapFragment[string]> = {
    [HOME_NODE_ID]: {
      enter: openHome,
      back,
      next: belowHome,
    },
  };

  if (rows.length === 0) {
    fragment[EMPTY_NODE_ID] = { prev: homeRow, back };
    return buildMap(fragment);
  }

  const ids = rows.map((row) => appRowId(row.id));
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const id = ids[i]!;
    const edges: Record<string, NavEdge> = {
      enter: edgeResume(row.id),
      back,
    };
    if (i === 0) {
      edges.prev = homeRow;
    } else {
      edges.prev = edgeNode(ids[i - 1]!, "replace");
    }
    if (i < ids.length - 1) {
      edges.next = edgeNode(ids[i + 1]!, "replace");
    } else if (ids.length > 1) {
      edges.next = edgeNode(ids[0]!, "replace");
    }
    fragment[id] = edges;
  }
  return buildMap(fragment);
}
