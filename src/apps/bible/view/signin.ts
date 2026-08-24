import { edgeApp, edgePop, type MapFragment } from "../../../app-kit/index.ts";
import type { AppLocation, NodePayload, RefreshResult } from "../../../core/types.ts";
import { signInId } from "../ids.ts";
import { addNode, type ViewSession } from "./helpers.ts";

export function signInResult(session: ViewSession, location: AppLocation | null): RefreshResult {
  const id = signInId();
  const node = { id, label: "Sign in to bookmark." };
  return {
    node,
    warm: [node],
    navigationMap: {
      [id]: {
        enter: edgeApp({ appId: session.accountAppId, path: "/" }),
        back: edgePop(),
      },
    },
    location,
  };
}

export function addSignIn(
  session: ViewSession,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
): void {
  addNode(payloads, { id: signInId(), label: "Sign in to bookmark." });
  fragments.push({
    [signInId()]: {
      enter: edgeApp({ appId: session.accountAppId, path: "/" }),
      back: edgePop(),
    },
  });
}
