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
import { addNode, listedCommentaries, type ViewSession } from "./helpers.ts";

export function addCommentaryWorks(
  session: ViewSession,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  version: string,
  ref: CanonRef,
): void {
  const works = listedCommentaries(session);
  const ids = works.map((work) => commentaryWorkId(version, ref, work.id));
  fragments.push(siblingListEdges(ids, { wrap: true }));

  for (const work of works) {
    addNode(payloads, {
      id: commentaryWorkId(version, ref, work.id),
      label: work.label,
    });
    const section = session.deps.store.findSection(work.id, ref);
    const chunks = splitText(commentaryLabel(section, work.label));
    const chunkIds = chunks.map((_, index) => commentaryChunkId(version, ref, work.id, index));
    fragments.push({
      [commentaryWorkId(version, ref, work.id)]: {
        ...(chunkIds[0] ? { enter: edgeAction(chunkIds[0]) } : {}),
        back: edgePop(),
      },
    });
    fragments.push(siblingListEdges(chunkIds, { wrap: false }));
    chunks.forEach((label, index) => {
      const id = commentaryChunkId(version, ref, work.id, index);
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
  commentaryId: string,
  index: number,
): string {
  const work = session.deps.store.getCommentary(commentaryId);
  const section = session.deps.store.findSection(commentaryId, ref);
  const chunks = splitText(commentaryLabel(section, work?.label ?? commentaryId));
  return chunks[index] ?? chunks[0] ?? commentaryLabel(section, work?.label ?? commentaryId);
}
