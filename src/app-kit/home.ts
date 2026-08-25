import { edgeApp } from "./edges.ts";
import type { MapFragment } from "./lists.ts";
import type { NavEdge } from "../core/types.ts";

/** Home addresses a catalog row as `/app/:id`. */
export function homeCatalogPath(appId: string): string {
  return `/app/${appId}`;
}

/** `app` edge to the leaving app's row on Home. */
export function edgeToHome(rootAppId: string, fromAppId: string): NavEdge {
  return edgeApp({ appId: rootAppId, path: homeCatalogPath(fromAppId) });
}

/**
 * `back` from an app root experience as an `app` edge to that app's Home row.
 * `rootId` is the node id that should expose this back edge.
 * `fromAppId` is the app being left.
 */
export function rootBackToHome(rootId: string, rootAppId: string, fromAppId: string): MapFragment {
  return {
    [rootId]: {
      back: edgeToHome(rootAppId, fromAppId),
    },
  };
}
