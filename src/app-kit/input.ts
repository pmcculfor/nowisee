import type { NavEdge } from "../core/types.ts";
import { edgeAction, edgeNode, edgePop, type EdgeFlags } from "./edges.ts";
import type { MapFragment } from "./lists.ts";

export type InputEdgesOptions = {
  /** Destination node for the commit edge (`passInputText`, optional `action`). */
  readonly commitTo: string;
  /**
   * Cancel (`back`): a node id to replace to, or `"pop"` for a pop edge.
   */
  readonly backTo: string | "pop";
  /** When true, commit edge also carries `action: true` (e.g. Save / Send). */
  readonly action?: boolean;
  readonly commitStackBehavior?: "push" | "replace";
};

/**
 * Commit / leave edges from an input node.
 * Done (`enter`) commits; Cancel (`back`) abandons via `backTo`.
 */
export function inputEdges(inputId: string, opts: InputEdgesOptions): MapFragment {
  const commitFlags: EdgeFlags = {
    passInputText: true,
    ...(opts.action ? { action: true } : {}),
  };
  const stackBehavior = opts.commitStackBehavior ?? "push";

  const commit: NavEdge = opts.action
    ? edgeAction(opts.commitTo, { stackBehavior, passInputText: true })
    : edgeNode(opts.commitTo, stackBehavior, commitFlags);

  const back: NavEdge = opts.backTo === "pop" ? edgePop() : edgeNode(opts.backTo, "replace");

  return {
    [inputId]: {
      enter: commit,
      back,
    },
  };
}
