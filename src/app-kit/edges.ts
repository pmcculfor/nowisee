import type { AppLocation, NavEdge, StackBehavior } from "../core/types.ts";

export type EdgeFlags = {
  readonly passInputText?: boolean;
  readonly action?: boolean;
};

const NEEDS_DEST: ReadonlySet<StackBehavior> = new Set([
  "push",
  "replace",
  "pushTransient",
]);

/** Node edge with a destination (push / replace / pushTransient). */
export function edgeNode(
  toNodeId: string,
  stackBehavior: "push" | "replace" | "pushTransient",
  flags: EdgeFlags & { readonly frame?: string } = {},
): NavEdge {
  const { frame, ...rest } = flags;
  return {
    kind: "node",
    toNodeId,
    stackBehavior,
    ...(frame !== undefined ? { frame } : {}),
    ...rest,
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

/** Refresh the current tip in place. Omits toNodeId. */
export function edgeStay(flags: EdgeFlags = {}): NavEdge {
  return {
    kind: "node",
    stackBehavior: "stay",
    ...flags,
  };
}

/** Push onto a named overlay. `frame` is required. */
export function edgePushTransient(
  toNodeId: string,
  frame: string,
  flags: EdgeFlags = {},
): NavEdge {
  return edgeNode(toNodeId, "pushTransient", { ...flags, frame });
}

/** Pop every trailing entry in the innermost frame. Omits toNodeId. */
export function edgePopTransient(flags: EdgeFlags = {}): NavEdge {
  return {
    kind: "node",
    stackBehavior: "popTransient",
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

/** Resume a parked app: restore stack, then refresh. */
export function edgeResume(appId: string): NavEdge {
  return { kind: "resume", appId };
}

/** Leave Nowisee entirely. */
export function edgeExternal(href: string): NavEdge {
  return {
    kind: "external",
    href,
  };
}

export type EdgeActionOpts = {
  readonly stackBehavior?: Exclude<StackBehavior, "pop" | "popTransient">;
  readonly passInputText?: boolean;
  readonly frame?: string;
};

/**
 * One-line button press: node edge with `action: true`.
 * Default stackBehavior is `push` (typical status-node landing).
 * For stay / popTransient use `edgeStay({ action: true })` / `edgePopTransient({ action: true })`.
 */
export function edgeAction(toNodeId: string, opts: EdgeActionOpts = {}): NavEdge {
  const behavior = opts.stackBehavior ?? "push";
  if (!NEEDS_DEST.has(behavior)) {
    return {
      kind: "node",
      stackBehavior: behavior,
      passInputText: opts.passInputText,
      action: true,
      ...(opts.frame !== undefined ? { frame: opts.frame } : {}),
    };
  }
  return edgeNode(toNodeId, behavior as "push" | "replace" | "pushTransient", {
    passInputText: opts.passInputText,
    action: true,
    frame: opts.frame,
  });
}
