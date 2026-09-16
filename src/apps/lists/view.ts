import {
  buildMap,
  edgeAction,
  edgeApp,
  edgeNode,
  edgePop,
  edgePushTransient,
  edgeStay,
  inputEdges,
  rootBackToHome,
  siblingListEdges,
  signedOut,
  type MapFragment,
} from "../../app-kit/index.ts";
import type {
  AppLocation,
  AppServerContext,
  NavigationMap,
  NodePayload,
  OpenResult,
  RefreshExtras,
  RefreshResult,
  StackEntry,
} from "../../core/types.ts";
import { isActionExtras } from "../../core/types.ts";
import {
  CREATE_EDIT_NODE_ID,
  CREATE_NODE_ID,
  LISTS_APP_ID,
  activeItemNodeId,
  addEditNodeId,
  addNodeId,
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
const LIST_ADD_FRAME = "list-add";

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
  extras: RefreshExtras = {},
  ctx?: AppServerContext,
): Promise<RefreshResult> {
  const ownerId = ctx?.userId ?? null;
  if (!ownerId) {
    return signedOutLists(deps, ctx);
  }

  if (isActionExtras(extras)) {
    await applyAction(deps, ownerId, tipId, extras);
  }

  const state = await loadState(deps, ownerId, tipId);
  const view = viewFromState(deps, state, tipId);
  const trigger = isActionExtras(extras) ? parseListsNode(extras.action.triggerId) : null;
  if (
    trigger &&
    (trigger.kind === "itemUndo" || trigger.kind === "completedItem") &&
    view.node.id === tipId
  ) {
    const labeled = withTipLabel(view, RESTORED_LABEL);
    return {
      ...labeled,
      navigationMap: {
        ...labeled.navigationMap,
        [tipId]: { back: edgePop(), enter: edgePop() },
      },
    };
  }
  return view;
}

export async function openListsPath(
  deps: ListsViewDeps,
  path: string,
  ctx?: AppServerContext,
): Promise<OpenResult> {
  const ownerId = ctx?.userId ?? null;
  if (!ownerId) {
    return signedOutLists(deps, ctx);
  }
  const lists = await deps.store.listLists(ownerId);
  const tipId = await tipIdForPath(deps, ownerId, path, lists);
  const state = await loadState(deps, ownerId, tipId);
  const view = viewFromState(deps, state, tipId);
  const stack = interiorAncestry(state, view);
  return stack ? { ...view, stack } : view;
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
  extras: RefreshExtras,
): Promise<void> {
  const triggerId = extras.action?.triggerId ?? tipId;
  const trigger = parseListsNode(triggerId);

  if (trigger?.kind === "createEdit") {
    const title = extras.inputText?.trim() ?? "";
    if (title.length === 0) {
      return;
    }
    const minted = parseListsNode(tipId);
    const mintedId = minted && "listId" in minted ? minted.listId : undefined;
    await deps.store.createList(ownerId, title, mintedId);
    return;
  }

  if (trigger?.kind === "addEdit") {
    const body = extras.inputText?.trim() ?? "";
    if (body.length === 0) {
      return;
    }
    await deps.store.createItem(ownerId, trigger.listId, body);
    return;
  }

  if (trigger?.kind === "itemDone") {
    await deps.store.completeItem(ownerId, trigger.itemId);
    return;
  }

  if (
    trigger?.kind === "itemUndo" ||
    trigger?.kind === "completedItem"
  ) {
    await deps.store.restoreItem(ownerId, trigger.itemId);
    return;
  }

  if (trigger?.kind === "deleted") {
    await deps.store.deleteList(ownerId, trigger.listId);
  }
}

function withTipLabel(result: RefreshResult, label: string): RefreshResult {
  return {
    ...result,
    node: { ...result.node, label },
    warm: result.warm.map((n) => (n.id === result.node.id ? { ...n, label } : n)),
  };
}

function viewFromState(
  deps: ListsViewDeps,
  state: GraphState,
  requestedTipId: string,
): RefreshResult {
  const payloads = new Map<string, NodePayload>();

  payloads.set(CREATE_NODE_ID, { id: CREATE_NODE_ID, label: CREATE_LABEL });
  payloads.set(CREATE_EDIT_NODE_ID, { id: CREATE_EDIT_NODE_ID, label: "", kind: "input" });

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
  if (parsed?.kind === "completedItem" && !payloads.has(requestedTipId)) {
    payloads.set(requestedTipId, { id: requestedTipId, label: RESTORED_LABEL });
  }

  let tipId = requestedTipId;
  if (!payloads.has(tipId)) {
    tipId = repairTip(state, parsed);
  } else {
    tipId = coerceTip(state, parsed, tipId);
  }
  const tip = payloads.get(tipId)!;

  return {
    navigationMap: buildNavigationMap(deps.rootAppId, state, payloads),
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
  return tipId;
}

function repairTip(state: GraphState, parsed: ListsNode | null): string {
  if (parsed?.kind === "deleted") {
    return defaultCatalogTip(state.lists);
  }
  if (state.focus) {
    if (
      parsed?.kind === "completedItem" || parsed?.kind === "completedEmpty"
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
): NavigationMap {
  const catalogIds = [CREATE_NODE_ID, ...state.lists.map((l) => catalogListNodeId(l.id))];
  const mintedListId = crypto.randomUUID();
  const fragments: MapFragment[] = [
    siblingListEdges(catalogIds, { wrap: false }),
    {
      [CREATE_NODE_ID]: {
        enter: edgeNode(CREATE_EDIT_NODE_ID, "replace"),
      },
    },
    inputEdges(CREATE_EDIT_NODE_ID, {
      commitTo: addNodeId(mintedListId),
      backTo: CREATE_NODE_ID,
      action: true,
      commitStackBehavior: "replace",
    }),
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
    fragments.push(...focusFragments(state.focus));
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

function focusFragments(focus: FocusList): MapFragment[] {
  const listId = focus.list.id;
  const back = edgePop();
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
        back: edgePop(),
      },
    },
    {
      [addNodeId(listId)]: {
        enter: edgePushTransient(addEditNodeId(listId), LIST_ADD_FRAME),
        back,
      },
    },
    inputEdges(addEditNodeId(listId), {
      backTo: "popTransient",
      action: true,
      commitStackBehavior: "popTransient",
    }),
  ];

  for (const item of focus.active) {
    const id = activeItemNodeId(item.id);
    const doneId = itemDoneNodeId(item.id);
    const undoId = itemUndoNodeId(item.id);
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
        enter: edgeStay({ action: true }),
        back: edgePop(),
      },
    });
  }

  const completedIds = focus.completed.map((i) => completedItemNodeId(i.id));
  if (completedIds.length > 0) {
    fragments.push(siblingListEdges(completedIds, { wrap: false }));
  }
  const completedBack = edgePop();
  for (const item of focus.completed) {
    const id = completedItemNodeId(item.id);
    const doneId = itemDoneNodeId(item.id);
    const undoId = itemUndoNodeId(item.id);
    fragments.push({
      [id]: {
        enter: edgeStay({ action: true }),
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
        enter: edgeStay({ action: true }),
        back: edgePop(),
      },
    });
  }

  return fragments;
}

function interiorAncestry(state: GraphState, view: RefreshResult): readonly StackEntry[] | undefined {
  if (!state.focus) {
    return undefined;
  }
  const parsed = parseListsNode(view.node.id);
  if (!parsed || parsed.kind === "catalogList") {
    return undefined;
  }
  const listId = state.focus.list.id;
  const catalogId = catalogListNodeId(listId);
  return [
    {
      nodeId: catalogId,
      label: firstLineLabel(state.focus.list.title, EMPTY_LIST_LABEL),
      location: { appId: LISTS_APP_ID, path: `/l/${listId}` },
    },
    {
      nodeId: view.node.id,
      label: view.node.label,
      location: view.location,
    },
  ];
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
    case "itemDone":
    case "itemUndo":
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
