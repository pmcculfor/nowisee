import { inputEdges, type MapFragment } from "../../../app-kit/index.ts";
import type { NodePayload } from "../../../core/types.ts";
import { SEARCH_POLICY } from "../catalog.ts";
import { searchId, searchInputId, searchWorkingId } from "../ids.ts";
import { tokenize } from "../search.ts";
import { addNode, displayedVerse, type ViewSession } from "./helpers.ts";

export function addSearchInput(
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
): void {
  addNode(payloads, { id: searchInputId(), label: "", kind: "input" });
  addNode(payloads, { id: searchId(), label: "Search" });
  addNode(payloads, { id: searchWorkingId(), label: "Searching…" });
  fragments.push(
    inputEdges(searchInputId(), {
      commitTo: searchWorkingId(),
      backTo: "pop",
      action: true,
      commitStackBehavior: "replace",
    }),
  );
}

export function searchHits(session: ViewSession, version: string, query: string) {
  const tokens = tokenize(query);
  if (tokens.length === 0) {
    return [];
  }
  return session.deps.store
    .searchVerses(version, tokens, SEARCH_POLICY.maxHits)
    .map((hit) => displayedVerse(session.deps.store, version, hit));
}

export function emptySearchLabel(query: string): string {
  return tokenize(query).length === 0 ? "Enter a search." : "No verses matched.";
}
