import { edgePop, type MapFragment } from "../../../app-kit/index.ts";
import type { NodePayload } from "../../../core/types.ts";
import { bookmarksEmptyId, bookmarksId } from "../ids.ts";
import type { CanonRef } from "../types.ts";
import { addNode, slotVerseId, type ActionContribution, type ViewSession } from "./helpers.ts";

/** Signed out, the Bookmark option is a plain node; there is nothing to toggle. */
export function toggleBookmark(session: ViewSession, ref: CanonRef): ActionContribution | null {
  if (!session.userId) {
    return null;
  }
  const verseId = slotVerseId(session.deps.store, ref);
  if (verseId === null) {
    return { statusLabel: "Bookmark failed: verse not found." };
  }
  session.deps.store.toggleBookmark(session.userId, verseId);
  return null;
}

export function addBookmarksEmpty(
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
): void {
  addNode(payloads, { id: bookmarksEmptyId(), label: "No bookmarks yet." });
  addNode(payloads, { id: bookmarksId(), label: "Bookmarks" });
  fragments.push({
    [bookmarksEmptyId()]: { back: edgePop() },
  });
}
