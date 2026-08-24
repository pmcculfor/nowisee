import { edgePop, type MapFragment } from "../../../app-kit/index.ts";
import type { NodePayload } from "../../../core/types.ts";
import { bookmarksEmptyId, bookmarksId } from "../ids.ts";
import { addNode } from "./helpers.ts";

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
