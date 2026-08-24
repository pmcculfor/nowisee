import { edgeNode, edgePop, siblingListEdges, type MapFragment } from "../../../app-kit/index.ts";
import type { NodePayload } from "../../../core/types.ts";
import { commentarySectionId, commentaryWorkId } from "../ids.ts";
import type { CanonRef, CommentarySection } from "../types.ts";
import { addNode, type ViewSession } from "./helpers.ts";

export function addCommentaryWorks(
  session: ViewSession,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  version: string,
  ref: CanonRef,
): void {
  const works = session.deps.store.listCommentaries();
  const ids = works.map((work) => commentaryWorkId(version, ref, work.id));
  for (const work of works) {
    addNode(payloads, {
      id: commentaryWorkId(version, ref, work.id),
      label: work.label,
    });
    const section = session.deps.store.findSection(work.id, ref);
    addNode(payloads, {
      id: commentarySectionId(version, ref, work.id),
      label: commentaryLabel(section, work.label),
    });
  }
  fragments.push(siblingListEdges(ids, { wrap: true }));
  for (const work of works) {
    fragments.push({
      [commentaryWorkId(version, ref, work.id)]: {
        enter: edgeNode(commentarySectionId(version, ref, work.id), "push"),
        back: edgePop(),
      },
      [commentarySectionId(version, ref, work.id)]: {
        back: edgePop(),
      },
    });
  }
}

export function commentaryLabel(section: CommentarySection | undefined, workLabel: string): string {
  if (!section) {
    return `No commentary for this verse in ${workLabel}.`;
  }
  return section.body;
}
