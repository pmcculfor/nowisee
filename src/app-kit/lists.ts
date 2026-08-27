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

export type SiblingListOptions = {
  readonly wrap?: boolean;
  /**
   * Emit map rows only for ids within `radius` of `index`.
   * Prev/next still address the full `ids` list (including the neighbor
   * just outside the window).
   */
  readonly around?: { readonly index: number; readonly radius: number };
};

/**
 * Build prev/next replace edges for a sibling list.
 * When `wrap` is false (default), ends omit the outward edge (silent no-op).
 */
export function siblingListEdges(
  ids: readonly string[],
  opts: SiblingListOptions = {},
): MapFragment {
  const wrap = opts.wrap === true;
  const around = opts.around;
  if (
    around &&
    (around.radius < 0 || around.index < 0 || around.index >= ids.length)
  ) {
    return {};
  }
  const start = around ? Math.max(0, around.index - around.radius) : 0;
  const end = around ? Math.min(ids.length, around.index + around.radius + 1) : ids.length;
  const fragment: Record<string, Partial<Record<NavIntent, NavEdge>>> = {};

  for (let i = start; i < end; i++) {
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
