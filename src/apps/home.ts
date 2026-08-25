import {
  buildMap,
  edgeApp,
  homeCatalogPath,
  siblingListEdges,
} from "../app-kit/index.ts";
import type {
  AppDescriptor,
  AppModule,
  AppServerContext,
  NavigationMap,
  NodePayload,
  RefreshExtras,
  RefreshResult,
  StackEntry,
} from "../core/types.ts";

const HOME_APP_ID = "home";
const ROOT_NODE_ID = "home:root";

export type HomeAppDeps = {
  readonly rootAppId: string;
};

/**
 * Home is an ordinary AppModule. It lists installed apps from `ctx.directory`
 * and links to them with `app` edges — never foreign node ids.
 */
export function createHomeApp(deps: HomeAppDeps): AppModule {
  return {
    id: HOME_APP_ID,
    label: "Home",
    open(path: string, _extras?: RefreshExtras, ctx?: AppServerContext): RefreshResult {
      return viewForPath(deps, path, ctx);
    },
    refresh(stack: readonly StackEntry[], _extras?: RefreshExtras, ctx?: AppServerContext): RefreshResult {
      const tipId = stack[stack.length - 1]?.nodeId;
      return viewForTip(deps, tipId, ctx);
    },
  };
}

function peerApps(deps: HomeAppDeps, ctx?: AppServerContext): AppDescriptor[] {
  const list = ctx?.directory?.list() ?? [];
  return list.filter((app) => app.id !== deps.rootAppId);
}

function appNodeId(appId: string): string {
  return `home:app:${appId}`;
}

function catalog(
  deps: HomeAppDeps,
  ctx?: AppServerContext,
): {
  ids: string[];
  payloads: Map<string, NodePayload>;
  appIdByNode: Map<string, string>;
} {
  const payloads = new Map<string, NodePayload>();
  const appIdByNode = new Map<string, string>();
  const ids: string[] = [];

  const peers = peerApps(deps, ctx);
  if (peers.length === 0) {
    ids.push(ROOT_NODE_ID);
    payloads.set(ROOT_NODE_ID, {
      id: ROOT_NODE_ID,
      label: "Home",
    });
  }

  for (const app of peers) {
    const id = appNodeId(app.id);
    ids.push(id);
    payloads.set(id, { id, label: app.label });
    appIdByNode.set(id, app.id);
  }

  return { ids, payloads, appIdByNode };
}

function buildNavigationMap(
  ids: readonly string[],
  appIdByNode: ReadonlyMap<string, string>,
): NavigationMap {
  const enterFragments = ids.flatMap((id) => {
    const appId = appIdByNode.get(id);
    if (!appId) {
      return [];
    }
    return [
      {
        [id]: { enter: edgeApp({ appId, path: "/" }) },
      },
    ];
  });

  // No `back` edges — already home (silent no-op).
  return buildMap(siblingListEdges(ids, { wrap: true }), ...enterFragments);
}

function viewForPath(deps: HomeAppDeps, path: string, ctx?: AppServerContext): RefreshResult {
  const cat = catalog(deps, ctx);

  const appMatch = /^\/app\/([^/]+)\/?$/.exec(path);
  if (appMatch) {
    const nodeId = appNodeId(appMatch[1]!);
    if (cat.appIdByNode.has(nodeId)) {
      return resultForCatalog(cat, nodeId);
    }
  }

  return resultForCatalog(cat, cat.ids[0]!);
}

function viewForTip(
  deps: HomeAppDeps,
  tipId: string | undefined,
  ctx?: AppServerContext,
): RefreshResult {
  const cat = catalog(deps, ctx);
  if (tipId && cat.payloads.has(tipId)) {
    return resultForCatalog(cat, tipId);
  }
  return resultForCatalog(cat, cat.ids[0]!);
}

function resultForCatalog(
  cat: ReturnType<typeof catalog>,
  tipId: string,
): RefreshResult {
  const tip = cat.payloads.get(tipId) ?? cat.payloads.get(cat.ids[0]!)!;
  const warm = cat.ids.map((id) => cat.payloads.get(id)!);
  const navigationMap = buildNavigationMap(cat.ids, cat.appIdByNode);

  return {
    navigationMap,
    warm,
    node: tip,
    location: locationFor(tip.id, cat.appIdByNode),
  };
}

function locationFor(
  tipId: string,
  appIdByNode: ReadonlyMap<string, string>,
): { appId: string; path: string } {
  if (tipId === ROOT_NODE_ID) {
    return { appId: HOME_APP_ID, path: "/" };
  }
  const appId = appIdByNode.get(tipId);
  if (appId) {
    return { appId: HOME_APP_ID, path: homeCatalogPath(appId) };
  }
  return { appId: HOME_APP_ID, path: "/" };
}
