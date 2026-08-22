import { edgeApp } from "./edges.ts";
import type { RefreshResult } from "../core/types.ts";
import { buildMap } from "./lists.ts";

export type SignedOutOptions = {
  readonly accountAppId: string;
  readonly rootAppId: string;
  readonly text: string;
};

const SIGNED_OUT_ID = "kit:signed-out";

/**
 * Complete RefreshResult for a signed-out user-scoped app.
 * enter → Account; back → Home. Optional — apps import this; Navigator never calls it.
 */
export function signedOut(opts: SignedOutOptions): RefreshResult {
  const node = { id: SIGNED_OUT_ID, label: opts.text };
  return {
    node,
    warm: [node],
    navigationMap: buildMap({
      [SIGNED_OUT_ID]: {
        enter: edgeApp({ appId: opts.accountAppId, path: "/" }),
        back: edgeApp({ appId: opts.rootAppId, path: "/" }),
      },
    }),
    location: null,
  };
}
