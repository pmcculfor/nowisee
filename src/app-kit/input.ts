import type { NavEdge } from "../core/types.ts";
import { edgeAction, edgeNode, edgePop, type EdgeFlags } from "./edges.ts";
import type { MapFragment } from "./lists.ts";

export type InputEdgesOptions = {
  /** Destination node for the commit edge (`passInputText`, optional `action`). */
  readonly commitTo: string;
  /**
   * Which intent commits.
   * - `"enter"` (default): `enter` commits (Done); `back` abandons via `backTo` (Cancel)
   * - `"back"`: `back` commits; `enter` is omitted. Prefer `"enter"` — the
   *   shell's Done button fires `enter`.
   */
  readonly commitOn?: "enter" | "back";
  /**
   * Abandon via `back` when `commitOn` is `"enter"`:
   * - string → replace to that node id
   * - `{ pop: true }` → pop edge
   * Required when `commitOn` is `"enter"`; ignored when `commitOn` is `"back"`.
   */
  readonly backTo?: string | { readonly pop: true };
  /** When true, commit edge also carries `action: true` (e.g. Save / Send). */
  readonly action?: boolean;
  readonly commitStackBehavior?: "push" | "replace";
};

/**
 * Commit / leave edges from an input node.
 */
export function inputEdges(inputId: string, opts: InputEdgesOptions): MapFragment {
  const commitOn = opts.commitOn ?? "enter";
  const commitFlags: EdgeFlags = {
    passInputText: true,
    ...(opts.action ? { action: true } : {}),
  };
  const stackBehavior = opts.commitStackBehavior ?? "push";

  const commit: NavEdge = opts.action
    ? edgeAction(opts.commitTo, { stackBehavior, passInputText: true })
    : edgeNode(opts.commitTo, stackBehavior, commitFlags);

  if (commitOn === "back") {
    return {
      [inputId]: {
        back: commit,
      },
    };
  }

  if (opts.backTo === undefined) {
    throw new Error('inputEdges: backTo is required when commitOn is "enter"');
  }

  let back: NavEdge;
  if (typeof opts.backTo === "object") {
    back = edgePop();
  } else {
    back = edgeNode(opts.backTo, "replace");
  }

  return {
    [inputId]: {
      enter: commit,
      back,
    },
  };
}
