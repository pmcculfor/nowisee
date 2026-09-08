import { inputEdges, type MapFragment } from "../../../app-kit/index.ts";
import type { NodePayload } from "../../../core/types.ts";
import { SEARCH_POLICY } from "../catalog.ts";
import { searchId, searchInputId, searchWorkingId } from "../ids.ts";
import { tokenize } from "../search.ts";
import type { SearchHit } from "../types.ts";
import { addNode, type ViewSession } from "./helpers.ts";

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

export function searchHits(session: ViewSession, versionId: number, query: string): readonly SearchHit[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) {
    return [];
  }
  return session.deps.store.searchVerses(versionId, tokens, SEARCH_POLICY.maxHits);
}

export function emptySearchLabel(query: string): string {
  return tokenize(query).length === 0 ? "Enter a search." : "No verses matched.";
}

export function searchLimitedLabel(): string {
  return `search limited to ${SEARCH_POLICY.maxHits} results.`;
}
