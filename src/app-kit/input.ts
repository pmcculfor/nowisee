import type { NavEdge, StackBehavior } from "../core/types.ts";
import {
  edgeAction,
  edgeNode,
  edgePop,
  edgePopTransient,
  edgeStay,
  type EdgeFlags,
} from "./edges.ts";
import type { MapFragment } from "./lists.ts";

export type InputCommitBehavior = Extract<
  StackBehavior,
  "push" | "replace" | "stay" | "pushTransient" | "popTransient"
>;

export type InputEdgesOptions = {
  /**
   * Destination for push / replace / pushTransient commits.
   * Omit when commitStackBehavior is stay or popTransient.
   */
  readonly commitTo?: string;
  /**
   * Cancel (`back`): a node id to replace to, `"pop"`, or `"popTransient"`.
   */
  readonly backTo: string | "pop" | "popTransient";
  /** When true, commit edge also carries `action: true` (e.g. Save / Send). */
  readonly action?: boolean;
  readonly commitStackBehavior?: InputCommitBehavior;
  /** Required when commitStackBehavior is pushTransient. */
  readonly commitFrame?: string;
};

/**
 * Commit / leave edges from an input node.
 * Done (`enter`) commits; Cancel (`back`) abandons via `backTo`.
 */
export function inputEdges(inputId: string, opts: InputEdgesOptions): MapFragment {
  const flags: EdgeFlags = {
    passInputText: true,
    ...(opts.action ? { action: true } : {}),
  };
  const stackBehavior: InputCommitBehavior = opts.commitStackBehavior ?? "push";
  const commit = commitEdge(opts, flags, stackBehavior);
  const back: NavEdge =
    opts.backTo === "pop"
      ? edgePop()
      : opts.backTo === "popTransient"
        ? edgePopTransient()
        : edgeNode(opts.backTo, "replace");

  return {
    [inputId]: {
      enter: commit,
      back,
    },
  };
}

function commitEdge(
  opts: InputEdgesOptions,
  flags: EdgeFlags,
  stackBehavior: InputCommitBehavior,
): NavEdge {
  if (stackBehavior === "stay") {
    return edgeStay(flags);
  }
  if (stackBehavior === "popTransient") {
    return edgePopTransient(flags);
  }
  const dest = opts.commitTo;
  if (!dest) {
    return edgeStay(flags);
  }
  if (stackBehavior === "pushTransient") {
    return edgeNode(dest, "pushTransient", {
      ...flags,
      frame: opts.commitFrame ?? "",
    });
  }
  if (opts.action) {
    return edgeAction(dest, { stackBehavior, passInputText: true });
  }
  return edgeNode(dest, stackBehavior, flags);
}
