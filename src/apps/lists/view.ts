import {
  buildMap,
  edgeAction,
  edgeApp,
  edgeNode,
  edgePop,
  inputEdges,
  rootBackToHome,
  siblingListEdges,
  signedOut,
  type MapFragment,
} from "../../app-kit/index.ts";
import type {
  AppLocation,
  AppServerContext,
  NavEdge,
  NavigationMap,
  NodePayload,
  RefreshExtras,
  RefreshResult,
} from "../../core/types.ts";
import {
  CREATE_EDIT_NODE_ID,
  CREATE_NODE_ID,
  CREATE_RESULT_NODE_ID,
  LISTS_APP_ID,
  activeItemNodeId,
  addEditNodeId,
  addNodeId,
  addResultNodeId,
  catalogListNodeId,
  completedEmptyNodeId,
  completedItemNodeId,
  completedOpenNodeId,
  deleteConfirmNodeId,
  deleteNodeId,
  deletedNodeId,
  firstLineLabel,
  itemDoneNodeId,
  itemIdFromNode,
  itemRestoredNodeId,
  itemUndoNodeId,
  listIdFromNode,
  parseListsNode,
  type ListsNode,
} from "./ids.ts";
import type { FirstActiveItem, ListItemRecord, ListRecord, ListsStore } from "./types.ts";

export type ListsViewDeps = {
  readonly rootAppId: string;
  readonly store: ListsStore;
};

const CREATE_LABEL = "Create a list";
const ADD_LABEL = "Add an item";
const COMPLETED_OPEN_LABEL = "Completed items";
const DELETE_LABEL = "Delete this list";
const DELETE_CONFIRM_LABEL = "This list will be permanently deleted.";
const DELETED_LABEL = "List deleted.";
const COMPLETED_STATUS_LABEL = "Completed.";
const UNDO_LABEL = "Undo complete";
const RESTORED_LABEL = "Restored.";
const EMPTY_COMPLETED_LABEL = "No completed items.";
const SIGNED_OUT_TEXT = "Sign in to use Lists.";
const EMPTY_LIST_LABEL = "Empty list";
const EMPTY_ITEM_LABEL = "Empty item";
const SAVING_LABEL = "Saving…";

type GraphState = {
  readonly lists: readonly ListRecord[];
  readonly firstActive: readonly FirstActiveItem[];
  readonly focus: FocusList | null;
};

type FocusList = {
  readonly list: ListRecord;
  readonly active: readonly ListItemRecord[];
  readonly completed: readonly ListItemRecord[];
};

/**
 * Build the catalog + optional interior graph for the current owner.
 */
export async function buildListsView(
  deps: ListsViewDeps,
  tipId: string,
  stackDepth: number,
  extras: RefreshExtras = {},
  ctx?: AppServerContext,
): Promise<RefreshResult> {
  const ownerId = ctx?.userId ?? null;
  if (!ownerId) {
    return signedOutLists(deps, ctx);
  }

  if (extras.action) {
    return applyAction(deps, ownerId, tipId, stackDepth, extras);
  }

  const state = await loadState(deps, ownerId, tipId);
  return viewFromState(deps, state, tipId, stackDepth);
}

export async function openListsPath(
  deps: ListsViewDeps,
  path: string,
  ctx?: AppServerContext,
): Promise<RefreshResult> {
  const ownerId = ctx?.userId ?? null;
  if (!ownerId) {
    return signedOutLists(deps, ctx);
  }
  const lists = await deps.store.listLists(ownerId);
  const tipId = await tipIdForPath(deps, ownerId, path, lists);
  const state = await loadState(deps, ownerId, tipId);
  return viewFromState(deps, state, tipId, 1);
}

function signedOutLists(deps: ListsViewDeps, ctx: AppServerContext | undefined): RefreshResult {
  return signedOut({
    accountAppId: ctx?.accountAppId ?? deps.rootAppId,
    rootAppId: deps.rootAppId,
    appId: LISTS_APP_ID,
    text: SIGNED_OUT_TEXT,
  });
}

async function tipIdForPath(
  deps: ListsViewDeps,
  ownerId: string,
  path: string,
  lists: readonly ListRecord[],
): Promise<string> {
  if (path === "/create/edit") {
    return CREATE_EDIT_NODE_ID;
  }
  if (path === "/create") {
    return CREATE_NODE_ID;
  }

  const catalogMatch = /^\/l\/([^/]+)\/?$/.exec(path);
  if (catalogMatch) {
    const id = catalogMatch[1]!;
    if (lists.some((l) => l.id === id)) {
      return catalogListNodeId(id);
    }
    return defaultCatalogTip(lists);
  }

  const listRoot = /^\/list\/([^/]+)\/?$/.exec(path);
  if (listRoot) {
    return interiorDefaultTip(deps, ownerId, listRoot[1]!, lists);
  }

  const listRest = /^\/list\/([^/]+)\/(.+)$/.exec(path);
  if (listRest) {
    const listId = listRest[1]!;
    const rest = listRest[2]!.replace(/\/$/, "");
    if (!lists.some((l) => l.id === listId)) {
      return defaultCatalogTip(lists);
    }
    if (rest === "add") {
      return addNodeId(listId);
    }
    if (rest === "add/edit") {
      return addEditNodeId(listId);
    }
    if (rest === "completed") {
      const completed = await deps.store.listItems(ownerId, listId, "completed");
      if (completed.length === 0) {
        return completedEmptyNodeId(listId);
      }
      return completedItemNodeId(completed[0]!.id);
    }
    if (rest === "delete") {
      return deleteNodeId(listId);
    }
    if (rest === "delete/confirm") {
      return deleteConfirmNodeId(listId);
    }
    const itemMatch = /^item\/([^/]+)$/.exec(rest);
    if (itemMatch) {
      const item = await deps.store.getItem(ownerId, itemMatch[1]!);
      if (item && item.listId === listId && item.completedAt == null) {
        return activeItemNodeId(item.id);
      }
      return interiorDefaultTip(deps, ownerId, listId, lists);
    }
    const completedItemMatch = /^completed\/([^/]+)$/.exec(rest);
    if (completedItemMatch) {
      const item = await deps.store.getItem(ownerId, completedItemMatch[1]!);
      if (item && item.listId === listId && item.completedAt != null) {
        return completedItemNodeId(item.id);
      }
      const completed = await deps.store.listItems(ownerId, listId, "completed");
      if (completed.length === 0) {
        return completedEmptyNodeId(listId);
      }
      return completedItemNodeId(completed[0]!.id);
    }
    return interiorDefaultTip(deps, ownerId, listId, lists);
  }

  return defaultCatalogTip(lists);
}

function defaultCatalogTip(lists: readonly ListRecord[]): string {
  if (lists.length === 0) {
    return CREATE_NODE_ID;
  }
  return catalogListNodeId(lists[0]!.id);
}

async function interiorDefaultTip(
  deps: ListsViewDeps,
  ownerId: string,
  listId: string,
  lists: readonly ListRecord[],
): Promise<string> {
  if (!lists.some((l) => l.id === listId)) {
    return defaultCatalogTip(lists);
  }
  const active = await deps.store.listItems(ownerId, listId, "active");
  if (active.length === 0) {
    return addNodeId(listId);
  }
  return activeItemNodeId(active[0]!.id);
}

function interiorDefaultFromFocus(focus: FocusList): string {
  if (focus.active.length === 0) {
    return addNodeId(focus.list.id);
  }
  return activeItemNodeId(focus.active[0]!.id);
}

async function loadState(deps: ListsViewDeps, ownerId: string, tipId: string): Promise<GraphState> {
  const lists = await deps.store.listLists(ownerId);
  const firstActive = await deps.store.firstActiveItems(ownerId);
  const focusId = await resolveFocusListId(deps, ownerId, tipId, lists);
  if (!focusId) {
    return { lists, firstActive, focus: null };
  }
  const list = lists.find((l) => l.id === focusId) ?? (await deps.store.getList(ownerId, focusId));
  if (!list) {
    return { lists, firstActive, focus: null };
  }
  const [active, completed] = await Promise.all([
    deps.store.listItems(ownerId, list.id, "active"),
    deps.store.listItems(ownerId, list.id, "completed"),
  ]);
  return { lists, firstActive, focus: { list, active, completed } };
}

async function resolveFocusListId(
  deps: ListsViewDeps,
  ownerId: string,
  tipId: string,
  lists: readonly ListRecord[],
): Promise<string | null> {
  const parsed = parseListsNode(tipId);
  if (!parsed) {
    return lists[0]?.id ?? null;
  }
  const fromList = listIdFromNode(parsed);
  if (fromList) {
    return fromList;
  }
  const itemId = itemIdFromNode(parsed);
  if (itemId) {
    const item = await deps.store.getItem(ownerId, itemId);
    return item?.listId ?? null;
  }
  return null;
}

async function applyAction(
  deps: ListsViewDeps,
  ownerId: string,
  tipId: string,
  stackDepth: number,
  extras: RefreshExtras,
): Promise<RefreshResult> {
  const parsed = parseListsNode(tipId);

  if (parsed?.kind === "createResult") {
    const title = extras.inputText?.trim() ?? "";
    if (title.length === 0) {
      const state = await loadState(deps, ownerId, CREATE_NODE_ID);
      return viewFromState(deps, state, CREATE_NODE_ID, stackDepth);
    }
    const created = await deps.store.createList(ownerId, title);
    const state = await loadState(deps, ownerId, addNodeId(created.id));
    return viewFromState(deps, state, addNodeId(created.id), stackDepth);
  }

  if (parsed?.kind === "addResult") {
    const body = extras.inputText?.trim() ?? "";
    const addId = addNodeId(parsed.listId);
    if (body.length === 0) {
      const state = await loadState(deps, ownerId, addId);
      return viewFromState(deps, state, addId, stackDepth);
    }
    await deps.store.createItem(ownerId, parsed.listId, body);
    const state = await loadState(deps, ownerId, addId);
    return viewFromState(deps, state, addId, stackDepth);
  }

  if (parsed?.kind === "itemDone") {
    await deps.store.completeItem(ownerId, parsed.itemId);
    const state = await loadState(deps, ownerId, tipId);
    return viewFromState(deps, state, tipId, stackDepth);
  }

  if (parsed?.kind === "itemRestored") {
    await deps.store.restoreItem(ownerId, parsed.itemId);
    const state = await loadState(deps, ownerId, tipId);
    return viewFromState(deps, state, tipId, stackDepth);
  }

  if (parsed?.kind === "deleted") {
    await deps.store.deleteList(ownerId, parsed.listId);
    const lists = await deps.store.listLists(ownerId);
    const firstActive = await deps.store.firstActiveItems(ownerId);
    return viewFromState(deps, { lists, firstActive, focus: null }, tipId, stackDepth);
  }

  const state = await loadState(deps, ownerId, tipId);
  return viewFromState(deps, state, tipId, stackDepth);
}

function viewFromState(
  deps: ListsViewDeps,
  state: GraphState,
  requestedTipId: string,
  stackDepth: number,
): RefreshResult {
  const payloads = new Map<string, NodePayload>();

  payloads.set(CREATE_NODE_ID, { id: CREATE_NODE_ID, label: CREATE_LABEL });
  payloads.set(CREATE_EDIT_NODE_ID, { id: CREATE_EDIT_NODE_ID, label: "", kind: "input" });
  payloads.set(CREATE_RESULT_NODE_ID, { id: CREATE_RESULT_NODE_ID, label: SAVING_LABEL });

  for (const list of state.lists) {
    const id = catalogListNodeId(list.id);
    payloads.set(id, {
      id,
      label: firstLineLabel(list.title, EMPTY_LIST_LABEL),
    });
  }
  for (const first of state.firstActive) {
    if (state.focus?.list.id === first.listId) {
      continue;
    }
    const id = activeItemNodeId(first.itemId);
    payloads.set(id, { id, label: firstLineLabel(first.body, EMPTY_ITEM_LABEL) });
  }

  if (state.focus) {
    addFocusPayloads(payloads, state.focus);
  }

  const parsed = parseListsNode(requestedTipId);
  if (parsed?.kind === "deleted") {
    payloads.set(requestedTipId, { id: requestedTipId, label: DELETED_LABEL });
  }

  let tipId = requestedTipId;
  if (!payloads.has(tipId)) {
    tipId = repairTip(state, parsed);
  } else {
    tipId = coerceTip(state, parsed, tipId);
  }
  const tip = payloads.get(tipId)!;

  return {
    navigationMap: buildNavigationMap(deps.rootAppId, state, payloads, stackDepth),
    warm: [...payloads.values()],
    node: tip,
    location: locationFor(tipId, state),
  };
}

function addFocusPayloads(payloads: Map<string, NodePayload>, focus: FocusList): void {
  const listId = focus.list.id;
  payloads.set(deleteNodeId(listId), { id: deleteNodeId(listId), label: DELETE_LABEL });
  payloads.set(deleteConfirmNodeId(listId), {
    id: deleteConfirmNodeId(listId),
    label: DELETE_CONFIRM_LABEL,
  });
  payloads.set(completedOpenNodeId(listId), {
    id: completedOpenNodeId(listId),
    label: COMPLETED_OPEN_LABEL,
  });
  payloads.set(completedEmptyNodeId(listId), {
    id: completedEmptyNodeId(listId),
    label: EMPTY_COMPLETED_LABEL,
  });
  payloads.set(addNodeId(listId), { id: addNodeId(listId), label: ADD_LABEL });
  payloads.set(addEditNodeId(listId), { id: addEditNodeId(listId), label: "", kind: "input" });
  payloads.set(addResultNodeId(listId), { id: addResultNodeId(listId), label: SAVING_LABEL });
  payloads.set(deletedNodeId(listId), { id: deletedNodeId(listId), label: DELETED_LABEL });

  const allItems = [...focus.active, ...focus.completed];
  for (const item of allItems) {
    payloads.set(itemDoneNodeId(item.id), {
      id: itemDoneNodeId(item.id),
      label: COMPLETED_STATUS_LABEL,
    });
    payloads.set(itemUndoNodeId(item.id), {
      id: itemUndoNodeId(item.id),
      label: UNDO_LABEL,
    });
    payloads.set(itemRestoredNodeId(item.id), {
      id: itemRestoredNodeId(item.id),
      label: RESTORED_LABEL,
    });
  }
  for (const item of focus.active) {
    const id = activeItemNodeId(item.id);
    payloads.set(id, { id, label: firstLineLabel(item.body, EMPTY_ITEM_LABEL) });
  }
  for (const item of focus.completed) {
    const id = completedItemNodeId(item.id);
    payloads.set(id, { id, label: firstLineLabel(item.body, EMPTY_ITEM_LABEL) });
  }
}

function coerceTip(state: GraphState, parsed: ListsNode | null, tipId: string): string {
  if (!parsed || !state.focus) {
    return tipId;
  }
  if (parsed.kind === "activeItem") {
    const stillActive = state.focus.active.some((i) => i.id === parsed.itemId);
    if (!stillActive) {
      return interiorDefaultFromFocus(state.focus);
    }
  }
  if (parsed.kind === "completedItem") {
    const stillCompleted = state.focus.completed.some((i) => i.id === parsed.itemId);
    if (!stillCompleted) {
      return completedListTip(state.focus);
    }
  }
  return tipId;
}

function repairTip(state: GraphState, parsed: ListsNode | null): string {
  if (parsed?.kind === "deleted") {
    return defaultCatalogTip(state.lists);
  }
  if (state.focus) {
    if (
      parsed?.kind === "completedItem" ||
      parsed?.kind === "completedEmpty" ||
      parsed?.kind === "itemRestored"
    ) {
      return completedListTip(state.focus);
    }
    return interiorDefaultFromFocus(state.focus);
  }
  return defaultCatalogTip(state.lists);
}

function completedListTip(focus: FocusList): string {
  if (focus.completed.length === 0) {
    return completedEmptyNodeId(focus.list.id);
  }
  return completedItemNodeId(focus.completed[0]!.id);
}

function buildNavigationMap(
  rootAppId: string,
  state: GraphState,
  payloads: Map<string, NodePayload>,
  stackDepth: number,
): NavigationMap {
  const catalogIds = [CREATE_NODE_ID, ...state.lists.map((l) => catalogListNodeId(l.id))];
  const fragments: MapFragment[] = [
    siblingListEdges(catalogIds, { wrap: false }),
    {
      [CREATE_NODE_ID]: {
        enter: edgeNode(CREATE_EDIT_NODE_ID, "replace"),
      },
    },
    inputEdges(CREATE_EDIT_NODE_ID, {
      commitTo: CREATE_RESULT_NODE_ID,
      backTo: CREATE_NODE_ID,
      action: true,
      commitStackBehavior: "replace",
    }),
    rootBackToHome(CREATE_RESULT_NODE_ID, rootAppId, LISTS_APP_ID),
  ];

  for (const id of catalogIds) {
    fragments.push(rootBackToHome(id, rootAppId, LISTS_APP_ID));
    if (id === CREATE_NODE_ID) {
      continue;
    }
    const parsed = parseListsNode(id);
    if (parsed?.kind !== "catalogList") {
      continue;
    }
    const enterTo = enterFromCatalog(state, parsed.listId);
    fragments.push({
      [id]: {
        enter: edgeNode(enterTo, "push"),
      },
    });
  }

  if (state.focus) {
    fragments.push(...focusFragments(state.focus, stackDepth));
  }

  const deletedId = [...payloads.keys()].find((id) => parseListsNode(id)?.kind === "deleted");
  if (deletedId) {
    fragments.push({
      [deletedId]: {
        back: edgeApp({ appId: LISTS_APP_ID, path: "/" }),
        enter: edgeApp({ appId: LISTS_APP_ID, path: "/" }),
      },
    });
  }

  return buildMap(...fragments);
}

function enterFromCatalog(state: GraphState, listId: string): string {
  if (state.focus?.list.id === listId) {
    return interiorDefaultFromFocus(state.focus);
  }
  const first = state.firstActive.find((row) => row.listId === listId);
  if (first) {
    return activeItemNodeId(first.itemId);
  }
  return addNodeId(listId);
}

function focusFragments(focus: FocusList, stackDepth: number): MapFragment[] {
  const listId = focus.list.id;
  const catalogId = catalogListNodeId(listId);
  const back = interiorBack(stackDepth, catalogId);
  const interiorIds = [
    deleteNodeId(listId),
    completedOpenNodeId(listId),
    addNodeId(listId),
    ...focus.active.map((i) => activeItemNodeId(i.id)),
  ];

  const fragments: MapFragment[] = [
    siblingListEdges(interiorIds, { wrap: false }),
    {
      [deleteNodeId(listId)]: {
        enter: edgeNode(deleteConfirmNodeId(listId), "push"),
        back,
      },
    },
    {
      [deleteConfirmNodeId(listId)]: {
        enter: edgeAction(deletedNodeId(listId)),
        back: edgePop(),
      },
    },
    {
      [completedOpenNodeId(listId)]: {
        enter: edgeNode(
          focus.completed.length === 0
            ? completedEmptyNodeId(listId)
            : completedItemNodeId(focus.completed[0]!.id),
          "push",
        ),
        back,
      },
    },
    {
      [completedEmptyNodeId(listId)]: {
        back: stackDepth > 1 ? edgePop() : edgeNode(completedOpenNodeId(listId), "replace"),
      },
    },
    {
      [addNodeId(listId)]: {
        enter: edgeNode(addEditNodeId(listId), "replace"),
        back,
      },
    },
    inputEdges(addEditNodeId(listId), {
      commitTo: addResultNodeId(listId),
      backTo: addNodeId(listId),
      action: true,
      commitStackBehavior: "replace",
    }),
    {
      [addResultNodeId(listId)]: {
        back,
      },
    },
  ];

  for (const item of focus.active) {
    const id = activeItemNodeId(item.id);
    const doneId = itemDoneNodeId(item.id);
    const undoId = itemUndoNodeId(item.id);
    const restoredId = itemRestoredNodeId(item.id);
    fragments.push({
      [id]: {
        enter: edgeAction(doneId),
        back,
      },
    });
    fragments.push({
      [doneId]: {
        back: edgePop(),
        enter: edgePop(),
        next: edgeNode(undoId, "replace"),
      },
    });
    fragments.push({
      [undoId]: {
        prev: edgeNode(doneId, "replace"),
        enter: edgeAction(restoredId, { stackBehavior: "replace" }),
        back: edgePop(),
      },
    });
    fragments.push({
      [restoredId]: {
        back: edgePop(),
        enter: edgePop(),
      },
    });
  }

  const completedIds = focus.completed.map((i) => completedItemNodeId(i.id));
  if (completedIds.length > 0) {
    fragments.push(siblingListEdges(completedIds, { wrap: false }));
  }
  const completedBack =
    stackDepth > 1 ? edgePop() : edgeNode(completedOpenNodeId(listId), "replace");
  for (const item of focus.completed) {
    const id = completedItemNodeId(item.id);
    const restoredId = itemRestoredNodeId(item.id);
    const doneId = itemDoneNodeId(item.id);
    const undoId = itemUndoNodeId(item.id);
    fragments.push({
      [id]: {
        enter: edgeAction(restoredId, { stackBehavior: "replace" }),
        back: completedBack,
      },
    });
    fragments.push({
      [doneId]: {
        back: edgePop(),
        enter: edgePop(),
        next: edgeNode(undoId, "replace"),
      },
    });
    fragments.push({
      [undoId]: {
        prev: edgeNode(doneId, "replace"),
        enter: edgeAction(restoredId, { stackBehavior: "replace" }),
        back: edgePop(),
      },
    });
    fragments.push({
      [restoredId]: {
        back: edgePop(),
        enter: edgePop(),
      },
    });
  }

  return fragments;
}

function interiorBack(stackDepth: number, catalogNodeId: string): NavEdge {
  if (stackDepth > 1) {
    return edgePop();
  }
  return edgeNode(catalogNodeId, "replace");
}

function locationFor(tipId: string, state: GraphState): AppLocation | null {
  const parsed = parseListsNode(tipId);
  if (!parsed) {
    return { appId: LISTS_APP_ID, path: "/" };
  }
  switch (parsed.kind) {
    case "create":
      return { appId: LISTS_APP_ID, path: "/create" };
    case "createEdit":
      return { appId: LISTS_APP_ID, path: "/create/edit" };
    case "createResult":
    case "addResult":
    case "itemDone":
    case "itemUndo":
    case "itemRestored":
    case "deleted":
      return null;
    case "catalogList":
      return { appId: LISTS_APP_ID, path: `/l/${parsed.listId}` };
    case "add":
      return { appId: LISTS_APP_ID, path: `/list/${parsed.listId}/add` };
    case "addEdit":
      return { appId: LISTS_APP_ID, path: `/list/${parsed.listId}/add/edit` };
    case "completedOpen":
      return { appId: LISTS_APP_ID, path: `/list/${parsed.listId}/completed` };
    case "completedEmpty":
      return { appId: LISTS_APP_ID, path: `/list/${parsed.listId}/completed` };
    case "delete":
      return { appId: LISTS_APP_ID, path: `/list/${parsed.listId}/delete` };
    case "deleteConfirm":
      return { appId: LISTS_APP_ID, path: `/list/${parsed.listId}/delete/confirm` };
    case "activeItem": {
      const listId = itemListId(state, parsed.itemId);
      if (!listId) {
        return { appId: LISTS_APP_ID, path: "/" };
      }
      return { appId: LISTS_APP_ID, path: `/list/${listId}/item/${parsed.itemId}` };
    }
    case "completedItem": {
      const listId = itemListId(state, parsed.itemId);
      if (!listId) {
        return { appId: LISTS_APP_ID, path: "/" };
      }
      return { appId: LISTS_APP_ID, path: `/list/${listId}/completed/${parsed.itemId}` };
    }
  }
}

function itemListId(state: GraphState, itemId: string): string | null {
  if (!state.focus) {
    return null;
  }
  const hit =
    state.focus.active.find((i) => i.id === itemId) ??
    state.focus.completed.find((i) => i.id === itemId);
  return hit?.listId ?? state.focus.list.id;
}
