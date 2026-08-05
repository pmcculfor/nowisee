import type { AppLocation, NavEdge, StackBehavior } from "../core/types.ts";

export type EdgeFlags = {
  readonly passInputText?: boolean;
  readonly action?: boolean;
};

/** Node edge with push or replace (toNodeId required). */
export function edgeNode(
  toNodeId: string,
  stackBehavior: Exclude<StackBehavior, "pop">,
  flags: EdgeFlags = {},
): NavEdge {
  return {
    kind: "node",
    toNodeId,
    stackBehavior,
    ...flags,
  };
}

/** Pop edge — omits toNodeId; stack tip after pop wins. */
export function edgePop(flags: EdgeFlags = {}): NavEdge {
  return {
    kind: "node",
    stackBehavior: "pop",
    ...flags,
  };
}

/** Cross-app (or same-app location) edge. */
export function edgeApp(to: AppLocation, flags: EdgeFlags = {}): NavEdge {
  return {
    kind: "app",
    to,
    ...flags,
  };
}

/** Leave Nowisee entirely. */
export function edgeExternal(href: string): NavEdge {
  return {
    kind: "external",
    href,
  };
}

/**
 * One-line button press: node edge with `action: true`.
 * Default stackBehavior is `push` (typical status-node landing).
 */
export function edgeAction(
  toNodeId: string,
  opts: {
    readonly stackBehavior?: Exclude<StackBehavior, "pop">;
    readonly passInputText?: boolean;
  } = {},
): NavEdge {
  return edgeNode(toNodeId, opts.stackBehavior ?? "push", {
    passInputText: opts.passInputText,
    action: true,
  });
}
