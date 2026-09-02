import {
  buildMap,
  edgeAction,
  edgeApp,
  edgeNode,
  edgePop,
  homeCatalogPath,
  siblingListEdges,
} from "../../app-kit/index.ts";
import type {
  AppDescriptor,
  AppLocation,
  AppServerContext,
  NodePayload,
  RefreshExtras,
  RefreshResult,
} from "../../core/types.ts";
import {
  ADD_EMPTY_ID,
  ADD_MENU_ID,
  addAddedNodeId,
  addAppNodeId,
  appNodeId,
  HOME_APP_ID,
  MANAGE_NODE_ID,
  MANAGE_SIGNED_OUT_ID,
  parseAddAddedNodeId,
  parseAddAppNodeId,
  parseAppNodeId,
  parseRemoveAppNodeId,
  parseRemoveRemovedNodeId,
  parseReorderAppNodeId,
  parseReorderMoveId,
  parseReorderMovingId,
  REMOVE_EMPTY_ID,
  REMOVE_MENU_ID,
  removeAppNodeId,
  removeRemovedNodeId,
  REORDER_MENU_ID,
  REORDER_TOO_FEW_ID,
  reorderAppNodeId,
  reorderMoveDownId,
  reorderMoveUpId,
  reorderMovingId,
  ROOT_NODE_ID,
} from "./ids.ts";
import {
  addableApps,
  canManage,
  catalogPeers,
  defaultVisible,
  removableApps,
  visibleFromStore,
} from "./membership.ts";
import type { HomeStore } from "./types.ts";

export type HomeViewDeps = {
  readonly store?: HomeStore;
};

const MANAGE_LABEL = "Manage Apps";
const ADD_LABEL = "Add Apps";
const REMOVE_LABEL = "Remove Apps";
const REORDER_LABEL = "Reorder Apps";
const SIGNED_OUT_TEXT = "Sign in to manage apps.";
const ADDED_TEXT = "App added to home screen";
const REMOVED_TEXT = "App removed from home screen";
const NO_ADD_TEXT = "No apps to add.";
const NO_REMOVE_TEXT = "No apps to remove.";
const TOO_FEW_REORDER_TEXT = "Need two or more apps to reorder.";
const MOVE_UP_LABEL = "Move up";
const MOVE_DOWN_LABEL = "Move down";

type HomeSession = {
  readonly peers: readonly AppDescriptor[];
  readonly visible: readonly AppDescriptor[];
  readonly ownerId: string | null;
  readonly accountAppId: string;
  readonly hasDirectory: boolean;
};

export async function openHomePath(
  deps: HomeViewDeps,
  path: string,
  extras: RefreshExtras = {},
  ctx?: AppServerContext,
): Promise<RefreshResult> {
  const session = await loadSession(deps, ctx);
  if (!session.hasDirectory) {
    return syntheticRoot();
  }
  if (!session.ownerId && isManagePath(path)) {
    return signedOutManageView(session);
  }
  return viewForTip(deps, session, tipIdForPath(path, session), extras);
}

export async function buildHomeView(
  deps: HomeViewDeps,
  tipId: string | undefined,
  extras: RefreshExtras = {},
  ctx?: AppServerContext,
): Promise<RefreshResult> {
  const session = await loadSession(deps, ctx);
  if (!session.hasDirectory) {
    return syntheticRoot();
  }
  if (!session.ownerId && isManageTip(tipId)) {
    return signedOutManageView(session);
  }
  return viewForTip(deps, session, tipId, extras);
}

async function viewForTip(
  deps: HomeViewDeps,
  session: HomeSession,
  tipId: string | undefined,
  extras: RefreshExtras,
): Promise<RefreshResult> {
  if (extras.action && session.ownerId) {
    return applyAction(deps, session, tipId ?? "", extras);
  }
  return render(session, tipId);
}

async function applyAction(
  deps: HomeViewDeps,
  session: HomeSession,
  tipId: string,
  _extras: RefreshExtras,
): Promise<RefreshResult> {
  const store = deps.store;
  const ownerId = session.ownerId;
  if (!store || !ownerId) {
    return render(session, tipId);
  }

  const addedId = parseAddAddedNodeId(tipId);
  if (addedId) {
    const next = await mutate(store, ownerId, session, (ids) => {
      if (!ids.includes(addedId) && canAddId(session, addedId)) {
        ids.push(addedId);
      }
    });
    return addStatusView(next, addedId);
  }

  const removedId = parseRemoveRemovedNodeId(tipId);
  if (removedId) {
    const next = await mutate(store, ownerId, session, (ids) => {
      const app = session.peers.find((a) => a.id === removedId);
      if (app && canManage(app)) {
        const i = ids.indexOf(removedId);
        if (i >= 0) {
          ids.splice(i, 1);
        }
      }
    });
    return removeStatusView(next, removedId);
  }

  const moving = parseReorderMovingId(tipId);
  if (moving) {
    const next = await mutate(store, ownerId, session, (ids) => {
      const i = ids.indexOf(moving.appId);
      if (i < 0) {
        return;
      }
      const j = moving.dir === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= ids.length) {
        return;
      }
      const tmp = ids[i]!;
      ids[i] = ids[j]!;
      ids[j] = tmp;
    });
    return reorderListView(next, reorderAppNodeId(moving.appId));
  }

  return render(session, tipId);
}

async function mutate(
  store: HomeStore,
  ownerId: string,
  session: HomeSession,
  edit: (ids: string[]) => void,
): Promise<HomeSession> {
  const ids = session.visible.map((app) => app.id);
  edit(ids);
  await store.save(ownerId, ids);
  const stored = await store.list(ownerId);
  return {
    ...session,
    visible: visibleFromStore(session.peers, stored),
  };
}

function canAddId(session: HomeSession, appId: string): boolean {
  const app = session.peers.find((a) => a.id === appId);
  return Boolean(app && canManage(app));
}

async function loadSession(
  deps: HomeViewDeps,
  ctx?: AppServerContext,
): Promise<HomeSession> {
  const hasDirectory = Boolean(ctx?.directory);
  const list = ctx?.directory?.list() ?? [];
  const peers = catalogPeers(list);
  const ownerId = ctx?.userId ?? null;
  let visible: readonly AppDescriptor[];
  if (!ownerId) {
    visible = defaultVisible(peers);
  } else {
    const stored = deps.store ? await deps.store.list(ownerId) : [];
    visible = visibleFromStore(peers, stored);
  }
  return {
    peers,
    visible,
    ownerId,
    accountAppId: ctx?.accountAppId ?? HOME_APP_ID,
    hasDirectory,
  };
}

function isManagePath(path: string): boolean {
  return path === "/manage" || path.startsWith("/manage/");
}

function isManageTip(tipId: string | undefined): boolean {
  return Boolean(tipId?.startsWith("home:manage"));
}

function tipIdForPath(path: string, session: HomeSession): string {
  const addApp = /^\/manage\/add\/([^/]+)\/?$/.exec(path);
  if (addApp) {
    return addAppNodeId(addApp[1]!);
  }
  if (path === "/manage/add" || path === "/manage/add/") {
    return ADD_MENU_ID;
  }
  const removeApp = /^\/manage\/remove\/([^/]+)\/?$/.exec(path);
  if (removeApp) {
    return removeAppNodeId(removeApp[1]!);
  }
  if (path === "/manage/remove" || path === "/manage/remove/") {
    return REMOVE_MENU_ID;
  }
  const reorderApp = /^\/manage\/reorder\/([^/]+)\/?$/.exec(path);
  if (reorderApp) {
    return reorderAppNodeId(reorderApp[1]!);
  }
  if (path === "/manage/reorder" || path === "/manage/reorder/") {
    return REORDER_MENU_ID;
  }
  if (path === "/manage" || path === "/manage/") {
    return MANAGE_NODE_ID;
  }
  const appMatch = /^\/app\/([^/]+)\/?$/.exec(path);
  if (appMatch) {
    return appNodeId(appMatch[1]!);
  }
  return homeListIds(session)[0] ?? ROOT_NODE_ID;
}

function render(session: HomeSession, tipId: string | undefined): RefreshResult {
  const id = tipId ?? homeListIds(session)[0] ?? ROOT_NODE_ID;

  if (id === MANAGE_SIGNED_OUT_ID) {
    return signedOutManageView(session);
  }
  if (id === ADD_MENU_ID || id === REMOVE_MENU_ID || id === REORDER_MENU_ID) {
    return manageMenuView(session, id);
  }
  if (id === ADD_EMPTY_ID || parseAddAppNodeId(id) || parseAddAddedNodeId(id)) {
    if (parseAddAddedNodeId(id)) {
      return addStatusView(session, parseAddAddedNodeId(id)!);
    }
    return addListView(session, id);
  }
  if (id === REMOVE_EMPTY_ID || parseRemoveAppNodeId(id) || parseRemoveRemovedNodeId(id)) {
    if (parseRemoveRemovedNodeId(id)) {
      return removeStatusView(session, parseRemoveRemovedNodeId(id)!);
    }
    return removeListView(session, id);
  }
  if (
    id === REORDER_TOO_FEW_ID ||
    parseReorderAppNodeId(id) ||
    parseReorderMoveId(id) ||
    parseReorderMovingId(id)
  ) {
    const moving = parseReorderMovingId(id);
    if (moving) {
      return reorderListView(session, reorderAppNodeId(moving.appId));
    }
    const move = parseReorderMoveId(id);
    if (move) {
      return reorderMoveView(session, move.appId, move.dir);
    }
    return reorderListView(session, id);
  }
  return catalogView(session, id);
}

function homeListIds(session: HomeSession): string[] {
  const ids = session.visible.map((app) => appNodeId(app.id));
  ids.push(MANAGE_NODE_ID);
  return ids;
}

function catalogView(session: HomeSession, requestedTipId: string): RefreshResult {
  const ids = homeListIds(session);
  const payloads = new Map<string, NodePayload>();
  const appIdByNode = new Map<string, string>();

  if (session.visible.length === 0 && !session.hasDirectory) {
    return syntheticRoot();
  }

  for (const app of session.visible) {
    const id = appNodeId(app.id);
    payloads.set(id, { id, label: app.label });
    appIdByNode.set(id, app.id);
  }
  payloads.set(MANAGE_NODE_ID, { id: MANAGE_NODE_ID, label: MANAGE_LABEL });

  let tipId = requestedTipId;
  if (!payloads.has(tipId)) {
    tipId = ids[0] ?? ROOT_NODE_ID;
  }
  if (tipId === ROOT_NODE_ID && ids.length > 0) {
    tipId = ids[0]!;
  }
  if (!payloads.has(tipId)) {
    payloads.set(ROOT_NODE_ID, { id: ROOT_NODE_ID, label: "Home" });
    return {
      node: payloads.get(ROOT_NODE_ID)!,
      warm: [payloads.get(ROOT_NODE_ID)!],
      navigationMap: {},
      location: { appId: HOME_APP_ID, path: "/" },
    };
  }

  const tip = payloads.get(tipId)!;
  const enterManage = session.ownerId
    ? edgeNode(ADD_MENU_ID, "push")
    : edgeNode(MANAGE_SIGNED_OUT_ID, "push");

  const enterFragments = ids.flatMap((id) => {
    const appId = appIdByNode.get(id);
    if (appId) {
      return [{ [id]: { enter: edgeApp({ appId, path: "/" }) } }];
    }
    if (id === MANAGE_NODE_ID) {
      return [{ [id]: { enter: enterManage } }];
    }
    return [];
  });

  return {
    node: tip,
    warm: ids.map((id) => payloads.get(id)!),
    navigationMap: buildMap(siblingListEdges(ids, { wrap: true }), ...enterFragments),
    location: locationFor(tip.id),
  };
}

function manageMenuView(session: HomeSession, requestedTipId: string): RefreshResult {
  const menuIds = [ADD_MENU_ID, REMOVE_MENU_ID, REORDER_MENU_ID];
  const payloads: Record<string, NodePayload> = {
    [ADD_MENU_ID]: { id: ADD_MENU_ID, label: ADD_LABEL },
    [REMOVE_MENU_ID]: { id: REMOVE_MENU_ID, label: REMOVE_LABEL },
    [REORDER_MENU_ID]: { id: REORDER_MENU_ID, label: REORDER_LABEL },
  };
  const tipId = menuIds.includes(requestedTipId) ? requestedTipId : ADD_MENU_ID;
  const addable = addableApps(session.peers, session.visible);
  const removable = removableApps(session.visible);
  const reorderable = session.visible;
  const addEnter =
    addable.length === 0
      ? edgeNode(ADD_EMPTY_ID, "push")
      : edgeNode(addAppNodeId(addable[0]!.id), "push");
  const removeEnter =
    removable.length === 0
      ? edgeNode(REMOVE_EMPTY_ID, "push")
      : edgeNode(removeAppNodeId(removable[0]!.id), "push");
  const reorderEnter =
    reorderable.length < 2
      ? edgeNode(REORDER_TOO_FEW_ID, "push")
      : edgeNode(reorderAppNodeId(reorderable[0]!.id), "push");

  return {
    node: payloads[tipId]!,
    warm: menuIds.map((id) => payloads[id]!),
    navigationMap: buildMap(siblingListEdges(menuIds, { wrap: false }), {
      [ADD_MENU_ID]: { enter: addEnter, back: edgePop() },
      [REMOVE_MENU_ID]: { enter: removeEnter, back: edgePop() },
      [REORDER_MENU_ID]: { enter: reorderEnter, back: edgePop() },
    }),
    location: locationFor(tipId),
  };
}

function addListView(session: HomeSession, requestedTipId: string): RefreshResult {
  const addable = addableApps(session.peers, session.visible);
  if (addable.length === 0) {
    const node = { id: ADD_EMPTY_ID, label: NO_ADD_TEXT };
    return {
      node,
      warm: [node],
      navigationMap: buildMap({ [ADD_EMPTY_ID]: { back: edgePop() } }),
      location: locationFor(ADD_EMPTY_ID),
    };
  }
  const ids = addable.map((app) => addAppNodeId(app.id));
  const payloads = new Map<string, NodePayload>();
  for (const app of addable) {
    const id = addAppNodeId(app.id);
    payloads.set(id, { id, label: app.label });
  }
  let tipId = requestedTipId;
  if (!payloads.has(tipId)) {
    tipId = ids[0]!;
  }
  const enterFragments = addable.map((app) => ({
    [addAppNodeId(app.id)]: {
      enter: edgeAction(addAddedNodeId(app.id)),
      back: edgePop(),
    },
  }));
  const statusWarm = addable.map((app) => ({
    id: addAddedNodeId(app.id),
    label: ADDED_TEXT,
  }));
  return {
    node: payloads.get(tipId)!,
    warm: [...ids.map((id) => payloads.get(id)!), ...statusWarm],
    navigationMap: buildMap(siblingListEdges(ids, { wrap: false }), ...enterFragments),
    location: locationFor(tipId),
  };
}

function removeListView(session: HomeSession, requestedTipId: string): RefreshResult {
  const removable = removableApps(session.visible);
  if (removable.length === 0) {
    const node = { id: REMOVE_EMPTY_ID, label: NO_REMOVE_TEXT };
    return {
      node,
      warm: [node],
      navigationMap: buildMap({ [REMOVE_EMPTY_ID]: { back: edgePop() } }),
      location: locationFor(REMOVE_EMPTY_ID),
    };
  }
  const ids = removable.map((app) => removeAppNodeId(app.id));
  const payloads = new Map<string, NodePayload>();
  for (const app of removable) {
    const id = removeAppNodeId(app.id);
    payloads.set(id, { id, label: app.label });
  }
  let tipId = requestedTipId;
  if (!payloads.has(tipId)) {
    tipId = ids[0]!;
  }
  const enterFragments = removable.map((app) => ({
    [removeAppNodeId(app.id)]: {
      enter: edgeAction(removeRemovedNodeId(app.id)),
      back: edgePop(),
    },
  }));
  const statusWarm = removable.map((app) => ({
    id: removeRemovedNodeId(app.id),
    label: REMOVED_TEXT,
  }));
  return {
    node: payloads.get(tipId)!,
    warm: [...ids.map((id) => payloads.get(id)!), ...statusWarm],
    navigationMap: buildMap(siblingListEdges(ids, { wrap: false }), ...enterFragments),
    location: locationFor(tipId),
  };
}

function reorderListView(session: HomeSession, requestedTipId: string): RefreshResult {
  const apps = session.visible;
  if (apps.length < 2) {
    const node = { id: REORDER_TOO_FEW_ID, label: TOO_FEW_REORDER_TEXT };
    return {
      node,
      warm: [node],
      navigationMap: buildMap({ [REORDER_TOO_FEW_ID]: { back: edgePop() } }),
      location: locationFor(REORDER_TOO_FEW_ID),
    };
  }
  const ids = apps.map((app) => reorderAppNodeId(app.id));
  const payloads = new Map<string, NodePayload>();
  for (const app of apps) {
    const id = reorderAppNodeId(app.id);
    payloads.set(id, { id, label: app.label });
  }
  let tipId = requestedTipId;
  if (!payloads.has(tipId)) {
    tipId = ids[0]!;
  }
  const enterFragments = apps.map((app, index) => {
    const id = reorderAppNodeId(app.id);
    const dest =
      index === 0 ? reorderMoveDownId(app.id) : reorderMoveUpId(app.id);
    return {
      [id]: {
        enter: edgeNode(dest, "replace"),
        back: edgePop(),
      },
    };
  });
  const moveWarm = apps.flatMap((app, index) => {
    const nodes: NodePayload[] = [];
    if (index > 0) {
      const id = reorderMoveUpId(app.id);
      nodes.push({ id, label: MOVE_UP_LABEL });
    }
    if (index < apps.length - 1) {
      const id = reorderMoveDownId(app.id);
      nodes.push({ id, label: MOVE_DOWN_LABEL });
    }
    const up = reorderMovingId(app.id, "up");
    const down = reorderMovingId(app.id, "down");
    nodes.push({ id: up, label: app.label }, { id: down, label: app.label });
    return nodes;
  });
  return {
    node: payloads.get(tipId)!,
    warm: [...ids.map((id) => payloads.get(id)!), ...moveWarm],
    navigationMap: buildMap(siblingListEdges(ids, { wrap: false }), ...enterFragments),
    location: locationFor(tipId),
  };
}

function reorderMoveView(
  session: HomeSession,
  appId: string,
  preferred: "up" | "down",
): RefreshResult {
  const apps = session.visible;
  const index = apps.findIndex((app) => app.id === appId);
  if (index < 0) {
    return reorderListView(session, reorderAppNodeId(appId));
  }
  const app = apps[index]!;
  const canUp = index > 0;
  const canDown = index < apps.length - 1;
  const upId = reorderMoveUpId(appId);
  const downId = reorderMoveDownId(appId);
  const listId = reorderAppNodeId(appId);
  const menuIds: string[] = [];
  if (canUp) {
    menuIds.push(upId);
  }
  if (canDown) {
    menuIds.push(downId);
  }
  if (menuIds.length === 0) {
    return reorderListView(session, listId);
  }
  const payloads = new Map<string, NodePayload>([
    [upId, { id: upId, label: MOVE_UP_LABEL }],
    [downId, { id: downId, label: MOVE_DOWN_LABEL }],
    [listId, { id: listId, label: app.label }],
    [reorderMovingId(appId, "up"), { id: reorderMovingId(appId, "up"), label: app.label }],
    [reorderMovingId(appId, "down"), { id: reorderMovingId(appId, "down"), label: app.label }],
  ]);
  const want = preferred === "up" && canUp ? upId : preferred === "down" && canDown ? downId : menuIds[0]!;
  return {
    node: payloads.get(want)!,
    warm: [
      ...menuIds.map((id) => payloads.get(id)!),
      payloads.get(listId)!,
      payloads.get(reorderMovingId(appId, "up"))!,
      payloads.get(reorderMovingId(appId, "down"))!,
    ],
    navigationMap: buildMap(
      siblingListEdges(menuIds, { wrap: false }),
      canUp
        ? {
            [upId]: {
              enter: edgeAction(reorderMovingId(appId, "up"), { stackBehavior: "replace" }),
              back: edgeNode(listId, "replace"),
            },
          }
        : {},
      canDown
        ? {
            [downId]: {
              enter: edgeAction(reorderMovingId(appId, "down"), { stackBehavior: "replace" }),
              back: edgeNode(listId, "replace"),
            },
          }
        : {},
    ),
    location: locationFor(listId),
  };
}

function addStatusView(_session: HomeSession, appId: string): RefreshResult {
  const node = { id: addAddedNodeId(appId), label: ADDED_TEXT };
  return {
    node,
    warm: [node],
    navigationMap: buildMap({ [node.id]: { back: edgePop() } }),
    location: null,
  };
}

function removeStatusView(_session: HomeSession, appId: string): RefreshResult {
  const node = { id: removeRemovedNodeId(appId), label: REMOVED_TEXT };
  return {
    node,
    warm: [node],
    navigationMap: buildMap({ [node.id]: { back: edgePop() } }),
    location: null,
  };
}

function signedOutManageView(session: HomeSession): RefreshResult {
  const node = { id: MANAGE_SIGNED_OUT_ID, label: SIGNED_OUT_TEXT };
  return {
    node,
    warm: [node],
    navigationMap: buildMap({
      [MANAGE_SIGNED_OUT_ID]: {
        enter: edgeApp({ appId: session.accountAppId, path: "/" }),
        back: edgePop(),
      },
    }),
    location: { appId: HOME_APP_ID, path: "/manage" },
  };
}

function syntheticRoot(): RefreshResult {
  const node = { id: ROOT_NODE_ID, label: "Home" };
  return {
    node,
    warm: [node],
    navigationMap: {},
    location: { appId: HOME_APP_ID, path: "/" },
  };
}

function locationFor(tipId: string): AppLocation | null {
  if (tipId === ROOT_NODE_ID) {
    return { appId: HOME_APP_ID, path: "/" };
  }
  if (tipId === MANAGE_NODE_ID || tipId === MANAGE_SIGNED_OUT_ID) {
    return { appId: HOME_APP_ID, path: "/manage" };
  }
  if (tipId === ADD_MENU_ID || tipId === ADD_EMPTY_ID) {
    return { appId: HOME_APP_ID, path: "/manage/add" };
  }
  if (tipId === REMOVE_MENU_ID || tipId === REMOVE_EMPTY_ID) {
    return { appId: HOME_APP_ID, path: "/manage/remove" };
  }
  if (tipId === REORDER_MENU_ID || tipId === REORDER_TOO_FEW_ID) {
    return { appId: HOME_APP_ID, path: "/manage/reorder" };
  }
  const catalogApp = parseAppNodeId(tipId);
  if (catalogApp) {
    return { appId: HOME_APP_ID, path: homeCatalogPath(catalogApp) };
  }
  const addApp = parseAddAppNodeId(tipId);
  if (addApp) {
    return { appId: HOME_APP_ID, path: `/manage/add/${addApp}` };
  }
  const remApp = parseRemoveAppNodeId(tipId);
  if (remApp) {
    return { appId: HOME_APP_ID, path: `/manage/remove/${remApp}` };
  }
  const reoApp = parseReorderAppNodeId(tipId);
  if (reoApp) {
    return { appId: HOME_APP_ID, path: `/manage/reorder/${reoApp}` };
  }
  const move = parseReorderMoveId(tipId);
  if (move) {
    return { appId: HOME_APP_ID, path: `/manage/reorder/${move.appId}` };
  }
  return null;
}