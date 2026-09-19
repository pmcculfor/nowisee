import type { NavEdge } from "../../src/core/types.ts";

export type NodeEdge = Extract<NavEdge, { kind: "node" }>;

/**
 * Narrow a map edge to a node edge. `toNodeId` exists only on that kind, so a
 * test reading it has to say which kind it expected; an `app` or `external`
 * edge reads as `undefined` rather than silently type-checking.
 */
export function nodeEdge(edge: NavEdge | undefined): NodeEdge | undefined {
  return edge?.kind === "node" ? edge : undefined;
}
