import type { NavEdge, NavIntent, NavigationMap, NodePayload } from "../core/types.ts";
import { buildMap, type MapFragment } from "./lists.ts";

export type NeighborhoodNeighbor = {
  readonly intent: NavIntent;
  readonly edge: NavEdge;
};

export type CollectNeighborhoodOptions = {
  readonly tipId: string;
  /** Edges authored from a visited node. */
  readonly neighbors: (nodeId: string) => readonly NeighborhoodNeighbor[];
  /** Payload for a node id, if available / worth warming. */
  readonly payload: (nodeId: string) => NodePayload | undefined;
  /** How many hops from tip to expand (tip = depth 0). */
  readonly depth: number;
  /** Cap on warm payloads collected. */
  readonly maxNodes: number;
};

/**
 * Callback-driven walk from `tipId` → warm payloads + map fragment.
 * Does not talk to Navigator; apps pass the callbacks and merge the result.
 */
export function collectNeighborhood(opts: CollectNeighborhoodOptions): {
  warm: NodePayload[];
  navigationMap: NavigationMap;
} {
  const warm: NodePayload[] = [];
  const warmIds = new Set<string>();
  const fragments: MapFragment[] = [];
  const visited = new Set<string>();

  type QueueItem = { id: string; depth: number };
  const queue: QueueItem[] = [{ id: opts.tipId, depth: 0 }];

  while (queue.length > 0 && warmIds.size < opts.maxNodes) {
    const item = queue.shift()!;
    if (visited.has(item.id)) {
      continue;
    }
    visited.add(item.id);

    const payload = opts.payload(item.id);
    if (payload && !warmIds.has(payload.id)) {
      warm.push(payload);
      warmIds.add(payload.id);
      if (warmIds.size >= opts.maxNodes) {
        // Still record edges from this node if we just admitted it; then stop expanding.
      }
    }

    const edges = opts.neighbors(item.id);
    if (edges.length > 0) {
      const row: Record<string, NavEdge> = {};
      for (const n of edges) {
        row[n.intent] = n.edge;
      }
      fragments.push({ [item.id]: row });
    }

    if (item.depth >= opts.depth || warmIds.size >= opts.maxNodes) {
      continue;
    }

    for (const n of edges) {
      const nextId = destinationNodeId(n.edge);
      if (nextId && !visited.has(nextId)) {
        queue.push({ id: nextId, depth: item.depth + 1 });
      }
    }
  }

  return {
    warm,
    navigationMap: buildMap(...fragments),
  };
}

function destinationNodeId(edge: NavEdge): string | undefined {
  if (edge.kind === "node" && edge.stackBehavior !== "pop") {
    return edge.toNodeId;
  }
  return undefined;
}
