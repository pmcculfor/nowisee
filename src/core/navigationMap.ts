import type { NavEdge, NavIntent, NavigationMap } from "./types.ts";

/**
 * Holds the current navigation map from the last successful refresh/open.
 * Nested structure: fromNodeId → intent → edge (no delimiter).
 */
export class NavigationMapStore {
  private map: NavigationMap = {};

  lookup(fromNodeId: string, intent: NavIntent): NavEdge | undefined {
    return this.map[fromNodeId]?.[intent];
  }

  replace(map: NavigationMap): void {
    this.map = map;
  }

  /** Test/debug helper — not part of the app-facing contract. */
  snapshot(): NavigationMap {
    return this.map;
  }
}
