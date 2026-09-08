import {
  edgeAction,
  edgePop,
  siblingListEdges,
  splitText,
  type MapFragment,
} from "../../../app-kit/index.ts";
import type { NodePayload } from "../../../core/types.ts";
import { commentaryChunkId, commentaryWorkId } from "../ids.ts";
import type { CanonRef, CommentarySection } from "../types.ts";
import { addNode, listedCommentaries, slotVerseId, type ViewSession } from "./helpers.ts";

export function addCommentaryWorks(
  session: ViewSession,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  versionId: number,
  ref: CanonRef,
): void {
  const works = listedCommentaries(session);
  const ids = works.map((work) => commentaryWorkId(versionId, ref, work.id));
  fragments.push(siblingListEdges(ids, { wrap: true }));
  const verseId = slotVerseId(session.deps.store, ref);

  for (const work of works) {
    addNode(payloads, {
      id: commentaryWorkId(versionId, ref, work.id),
      label: work.label,
    });
    const section =
      verseId === null ? undefined : session.deps.store.findSection(work.id, verseId);
    const chunks = splitText(commentaryLabel(section, work.label));
    const chunkIds = chunks.map((_, index) => commentaryChunkId(versionId, ref, work.id, index));
    fragments.push({
      [commentaryWorkId(versionId, ref, work.id)]: {
        ...(chunkIds[0] ? { enter: edgeAction(chunkIds[0]) } : {}),
        back: edgePop(),
      },
    });
    fragments.push(siblingListEdges(chunkIds, { wrap: false }));
    chunks.forEach((label, index) => {
      const id = commentaryChunkId(versionId, ref, work.id, index);
      addNode(payloads, { id, label });
      fragments.push({
        [id]: { back: edgePop() },
      });
    });
  }
}

export function commentaryLabel(section: CommentarySection | undefined, workLabel: string): string {
  if (!section) {
    return `No commentary for this verse in ${workLabel}.`;
  }
  return section.body;
}

export function commentaryChunkLabel(
  session: ViewSession,
  ref: CanonRef,
  commentaryId: number,
  index: number,
): string {
  const work = session.deps.store.getCommentary(commentaryId);
  const verseId = slotVerseId(session.deps.store, ref);
  const section =
    verseId === null ? undefined : session.deps.store.findSection(commentaryId, verseId);
  const fallback = work?.label ?? String(commentaryId);
  const chunks = splitText(commentaryLabel(section, fallback));
  return chunks[index] ?? chunks[0] ?? commentaryLabel(section, fallback);
}
