import { inputEdges, type MapFragment } from "../../../app-kit/index.ts";
import type { NodePayload } from "../../../core/types.ts";
import { SEARCH_POLICY } from "../catalog.ts";
import { searchEmptyId, searchId, searchInputId, searchWorkingId, verseNodeId } from "../ids.ts";
import { tokenize } from "../search.ts";
import type { SearchHit } from "../types.ts";
import {
  activeVersion,
  addNode,
  type ActionContribution,
  type ViewSession,
} from "./helpers.ts";

/**
 * Done on the search input. Records the query, then names where to land: the
 * first hit, or the empty-result node. Signed out, nothing is recorded, so the
 * empty node carries query id 0.
 */
export function applySearchAction(session: ViewSession): ActionContribution | null {
  const version = activeVersion(session);
  if (!version) {
    return null;
  }
  if (!session.sessionId) {
    return { tipId: searchEmptyId(0) };
  }
  const query = session.extras.inputText ?? "";
  const hits = searchHits(session, version.id, query);
  const queryId = session.deps.store.createSearchQuery(session.sessionId, query, version.id, hits);
  const first = hits[0];
  return {
    tipId: first ? verseNodeId({ type: "search", queryId }, first) : searchEmptyId(queryId),
  };
}

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
      commitStackBehavior: "push",
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
