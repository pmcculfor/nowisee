import type { NavEdge, NavIntent, NavigationMap } from "../core/types.ts";
import { edgeNode } from "./edges.ts";

export type MapFragment = Readonly<
  Record<string, Readonly<Partial<Record<NavIntent, NavEdge>>>>
>;

/**
 * Assemble the nested `fromNodeId → intent → edge` structure.
 * Later fragments overwrite earlier ones for the same (from, intent).
 */
export function buildMap(...parts: ReadonlyArray<MapFragment | NavigationMap>): NavigationMap {
  const out: Record<string, Record<string, NavEdge>> = {};

  for (const part of parts) {
    for (const [from, intents] of Object.entries(part)) {
      for (const intent of Object.keys(intents) as NavIntent[]) {
        const edge = intents[intent];
        if (edge) {
          write(out, from, intent, edge);
        }
      }
    }
  }

  return out;
}

function write(
  out: Record<string, Record<string, NavEdge>>,
  from: string,
  intent: string,
  edge: NavEdge,
): void {
  const row = out[from] ?? (out[from] = {});
  row[intent] = edge;
}

/**
 * Build prev/next replace edges for a sibling list.
 * When `wrap` is false (default), ends omit the outward edge (silent no-op).
 */
export function siblingListEdges(
  ids: readonly string[],
  opts: { readonly wrap?: boolean } = {},
): MapFragment {
  const wrap = opts.wrap === true;
  const fragment: Record<string, Partial<Record<NavIntent, NavEdge>>> = {};

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const edges: Partial<Record<NavIntent, NavEdge>> = {};

    if (i > 0) {
      edges.prev = edgeNode(ids[i - 1]!, "replace");
    } else if (wrap && ids.length > 1) {
      edges.prev = edgeNode(ids[ids.length - 1]!, "replace");
    }

    if (i < ids.length - 1) {
      edges.next = edgeNode(ids[i + 1]!, "replace");
    } else if (wrap && ids.length > 1) {
      edges.next = edgeNode(ids[0]!, "replace");
    }

    fragment[id] = edges;
  }

  return fragment;
}
