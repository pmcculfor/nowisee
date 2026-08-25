import type { RefreshResult } from "../core/types.ts";
import { edgeApp } from "./edges.ts";
import { edgeToHome } from "./home.ts";
import { buildMap } from "./lists.ts";

export type SignedOutOptions = {
  readonly accountAppId: string;
  readonly rootAppId: string;
  /** App being left — Home opens this catalog row. */
  readonly appId: string;
  readonly text: string;
};

const SIGNED_OUT_ID = "kit:signed-out";

/**
 * Complete RefreshResult for a signed-out user-scoped app.
 * enter → Account; back → this app's Home row. Optional — apps import this; Navigator never calls it.
 */
export function signedOut(opts: SignedOutOptions): RefreshResult {
  const node = { id: SIGNED_OUT_ID, label: opts.text };
  return {
    node,
    warm: [node],
    navigationMap: buildMap({
      [SIGNED_OUT_ID]: {
        enter: edgeApp({ appId: opts.accountAppId, path: "/" }),
        back: edgeToHome(opts.rootAppId, opts.appId),
      },
    }),
    location: null,
  };
}
