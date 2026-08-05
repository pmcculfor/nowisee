import { edgeApp } from "./edges.ts";
import type { MapFragment } from "./lists.ts";

/**
 * `back` from an app root experience as an `app` edge to the root app.
 * `rootId` is the node id that should expose this back edge.
 */
export function rootBackToHome(rootId: string, rootAppId: string): MapFragment {
  return {
    [rootId]: {
      back: edgeApp({ appId: rootAppId, path: "/" }),
    },
  };
}
