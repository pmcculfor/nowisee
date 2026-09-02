export const HOME_APP_ID = "home";

export const ROOT_NODE_ID = "home:root";
export const MANAGE_NODE_ID = "home:manage";
export const ADD_MENU_ID = "home:manage:add";
export const REMOVE_MENU_ID = "home:manage:remove";
export const REORDER_MENU_ID = "home:manage:reorder";
export const MANAGE_SIGNED_OUT_ID = "home:manage:signed-out";
export const ADD_EMPTY_ID = "home:manage:add:empty";
export const REMOVE_EMPTY_ID = "home:manage:remove:empty";
export const REORDER_TOO_FEW_ID = "home:manage:reorder:empty";

export function appNodeId(appId: string): string {
  return `home:app:${appId}`;
}

export function parseAppNodeId(nodeId: string): string | null {
  const m = /^home:app:(.+)$/.exec(nodeId);
  return m?.[1] ?? null;
}

export function addAppNodeId(appId: string): string {
  return `home:manage:add:app:${appId}`;
}

export function parseAddAppNodeId(nodeId: string): string | null {
  const m = /^home:manage:add:app:(.+)$/.exec(nodeId);
  return m?.[1] ?? null;
}

export function addAddedNodeId(appId: string): string {
  return `home:manage:add:added:${appId}`;
}

export function parseAddAddedNodeId(nodeId: string): string | null {
  const m = /^home:manage:add:added:(.+)$/.exec(nodeId);
  return m?.[1] ?? null;
}

export function removeAppNodeId(appId: string): string {
  return `home:manage:remove:app:${appId}`;
}

export function parseRemoveAppNodeId(nodeId: string): string | null {
  const m = /^home:manage:remove:app:(.+)$/.exec(nodeId);
  return m?.[1] ?? null;
}

export function removeRemovedNodeId(appId: string): string {
  return `home:manage:remove:removed:${appId}`;
}

export function parseRemoveRemovedNodeId(nodeId: string): string | null {
  const m = /^home:manage:remove:removed:(.+)$/.exec(nodeId);
  return m?.[1] ?? null;
}

export function reorderAppNodeId(appId: string): string {
  return `home:manage:reorder:app:${appId}`;
}

export function parseReorderAppNodeId(nodeId: string): string | null {
  const m = /^home:manage:reorder:app:(.+)$/.exec(nodeId);
  return m?.[1] ?? null;
}

export function reorderMoveUpId(appId: string): string {
  return `home:manage:reorder:move:${appId}:up`;
}

export function reorderMoveDownId(appId: string): string {
  return `home:manage:reorder:move:${appId}:down`;
}

export function parseReorderMoveId(
  nodeId: string,
): { appId: string; dir: "up" | "down" } | null {
  const m = /^home:manage:reorder:move:(.+):(up|down)$/.exec(nodeId);
  if (!m) {
    return null;
  }
  return { appId: m[1]!, dir: m[2] as "up" | "down" };
}

export function reorderMovingId(appId: string, dir: "up" | "down"): string {
  return `home:manage:reorder:moving:${appId}:${dir}`;
}

export function parseReorderMovingId(
  nodeId: string,
): { appId: string; dir: "up" | "down" } | null {
  const m = /^home:manage:reorder:moving:(.+):(up|down)$/.exec(nodeId);
  if (!m) {
    return null;
  }
  return { appId: m[1]!, dir: m[2] as "up" | "down" };
}
