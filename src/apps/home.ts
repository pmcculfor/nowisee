import {
  buildMap,
  edgeApp,
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
const HELP_NODE_ID = "home:help";

export type HomeAppDeps = {
  /** Plain descriptors only — never pass the registry object. */
  readonly listEnabled: (userId?: string | null) => readonly AppDescriptor[];
  readonly rootAppId: string;
};

/**
 * Home is an ordinary AppModule. It lists enabled apps from an injected
 * catalog callback and links to them with `app` edges — never foreign node ids.
 */
export function createHomeApp(deps: HomeAppDeps): AppModule {
  return {
    id: HOME_APP_ID,
    label: "Home",
    open(path: string, _extras?: RefreshExtras, ctx?: AppServerContext): RefreshResult {
      return viewForPath(deps, path, ctx?.userId ?? null);
    },
    refresh(stack: readonly StackEntry[], _extras?: RefreshExtras, ctx?: AppServerContext): RefreshResult {
      const tipId = stack[stack.length - 1]?.nodeId;
      return viewForTip(deps, tipId, ctx?.userId ?? null);
    },
  };
}

function peerApps(deps: HomeAppDeps, userId: string | null): AppDescriptor[] {
  return deps.listEnabled(userId).filter((app) => app.id !== deps.rootAppId);
}

function appNodeId(appId: string): string {
  return `home:app:${appId}`;
}

function helpLabel(): string {
  return [
    "Help.",
    "The arrow keys navigate.",
    "Up and Down move between items.",
    "Right opens.",
    "Left goes back.",
    "On a typing screen, type in the box. Enter makes a new line. Move to Done to save, or to Cancel to go back.",
    "On a phone with VoiceOver, touch the top, bottom, left, or right edge of the screen to navigate. On a typing screen, swipe to Done or Cancel.",
  ].join(" ");
}

function catalog(
  deps: HomeAppDeps,
  userId: string | null,
): {
  ids: string[];
  payloads: Map<string, NodePayload>;
  appIdByNode: Map<string, string>;
} {
  const payloads = new Map<string, NodePayload>();
  const appIdByNode = new Map<string, string>();
  const ids: string[] = [];

  const peers = peerApps(deps, userId);
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

  ids.push(HELP_NODE_ID);
  payloads.set(HELP_NODE_ID, {
    id: HELP_NODE_ID,
    label: helpLabel(),
  });

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

function viewForPath(deps: HomeAppDeps, path: string, userId: string | null): RefreshResult {
  const cat = catalog(deps, userId);

  if (path === "/help") {
    return resultForCatalog(cat, HELP_NODE_ID);
  }

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
  userId: string | null,
): RefreshResult {
  const cat = catalog(deps, userId);
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
  if (tipId === HELP_NODE_ID) {
    return { appId: HOME_APP_ID, path: "/help" };
  }
  if (tipId === ROOT_NODE_ID) {
    return { appId: HOME_APP_ID, path: "/" };
  }
  const appId = appIdByNode.get(tipId);
  if (appId) {
    return { appId: HOME_APP_ID, path: `/app/${appId}` };
  }
  return { appId: HOME_APP_ID, path: "/" };
}
