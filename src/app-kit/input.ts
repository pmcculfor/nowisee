import type { NavEdge } from "../core/types.ts";
import { edgeAction, edgeNode, edgePop, type EdgeFlags } from "./edges.ts";
import type { MapFragment } from "./lists.ts";

export type InputEdgesOptions = {
  /** Destination node for commit (`enter` + `passInputText`). */
  readonly commitTo: string;
  /**
   * Abandon via `back`:
   * - string → replace to that node id
   * - `{ pop: true }` → pop edge
   */
  readonly backTo: string | { readonly pop: true };
  /** When true, commit edge also carries `action: true` (e.g. Send). */
  readonly action?: boolean;
  readonly commitStackBehavior?: "push" | "replace";
};

/**
 * `enter` (+ `passInputText`) / `back` from an input node.
 */
export function inputEdges(inputId: string, opts: InputEdgesOptions): MapFragment {
  const commitFlags: EdgeFlags = {
    passInputText: true,
    ...(opts.action ? { action: true } : {}),
  };
  const stackBehavior = opts.commitStackBehavior ?? "push";

  const enter: NavEdge = opts.action
    ? edgeAction(opts.commitTo, { stackBehavior, passInputText: true })
    : edgeNode(opts.commitTo, stackBehavior, commitFlags);

  let back: NavEdge;
  if (typeof opts.backTo === "object") {
    back = edgePop();
  } else {
    back = edgeNode(opts.backTo, "replace");
  }

  return {
    [inputId]: {
      enter,
      back,
    },
  };
}
