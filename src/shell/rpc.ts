import type { ActionExtras, AppRpc, RefreshExtras, RefreshResult, WireExtras } from "../core/types.ts";

export type { AppRpc, WireExtras };

export function toWireExtras(extras: RefreshExtras): WireExtras {
  const wire: {
    inputText?: string;
    action?: ActionExtras;
    parkedAppIds?: readonly string[];
  } = {};
  if (extras.inputText !== undefined) {
    wire.inputText = extras.inputText;
  }
  if (extras.action) {
    wire.action = { triggerId: extras.action.triggerId };
  }
  if (extras.parkedAppIds) {
    wire.parkedAppIds = extras.parkedAppIds;
  }
  return wire;
}

/** Same-origin POST /api/apps/:id/open|refresh. */
export function createFetchRpc(): AppRpc {
  async function post(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<RefreshResult> {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      throw new Error(`Nowisee app RPC failed (${res.status})`);
    }
    return (await res.json()) as RefreshResult;
  }

  return {
    open(appId, path, extras, signal) {
      return post(
        `/api/apps/${encodeURIComponent(appId)}/open`,
        { path, extras },
        signal,
      );
    },
    refresh(appId, nodeId, extras, signal) {
      return post(
        `/api/apps/${encodeURIComponent(appId)}/refresh`,
        { nodeId, extras },
        signal,
      );
    },
  };
}
