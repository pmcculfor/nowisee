import {
  edgeAction,
  edgeNode,
  edgePop,
  siblingListEdges,
  type MapFragment,
} from "../../../app-kit/index.ts";
import type { NodePayload } from "../../../core/types.ts";
import { XREF_POLICY, xrefSeq } from "../catalog.ts";
import { verseNodeId, xrefEmptyId, xrefPhraseId, xrefWorkId } from "../ids.ts";
import type { CanonRef } from "../types.ts";
import {
  addNode,
  addWindowedNodes,
  listedXrefWorks,
  siblingWindow,
  slotVerseId,
  type ViewSession,
} from "./helpers.ts";

export function addXrefEmpty(
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  ref: CanonRef,
): void {
  const id = xrefEmptyId(ref);
  addNode(payloads, { id, label: xrefEmptyLabel() });
  fragments.push({ [id]: { back: edgePop() } });
}

export function addXrefWorks(
  session: ViewSession,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  ref: CanonRef,
  versionId: number,
): void {
  const works = listedXrefWorks(session);
  const ids = works.map((work) => xrefWorkId(ref, work.id));
  fragments.push(siblingListEdges(ids, { wrap: true }));
  const verseId = slotVerseId(session.deps.store, ref);
  for (const work of works) {
    const id = xrefWorkId(ref, work.id);
    addNode(payloads, { id, label: work.label });
    const phrases =
      verseId === null ? [] : session.deps.store.listXrefPhrases(work.id, verseId);
    const first = phrases[0];
    fragments.push({
      [id]: {
        ...(first ? { enter: edgeAction(xrefPhraseId(ref, work.id, first.id)) } : {}),
        back: edgePop(),
      },
    });
  }
  const focus = works[0];
  if (focus && verseId !== null) {
    addXrefPhrases(session, payloads, fragments, ref, versionId, focus.id, undefined);
  }
}

export function addXrefPhrases(
  session: ViewSession,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  ref: CanonRef,
  versionId: number,
  workId: number,
  focusPhraseId: number | undefined,
): void {
  const verseId = slotVerseId(session.deps.store, ref);
  const phrases =
    verseId === null ? [] : [...session.deps.store.listXrefPhrases(workId, verseId)];
  if (phrases.length === 0) {
    addXrefEmpty(payloads, fragments, ref);
    return;
  }
  const ids = phrases.map((phrase) => xrefPhraseId(ref, workId, phrase.id));
  const focusId =
    focusPhraseId !== undefined
      ? xrefPhraseId(ref, workId, focusPhraseId)
      : ids[0]!;
  const around = siblingWindow(ids, focusId, XREF_POLICY.siblingRadius);
  fragments.push(siblingListEdges(ids, { wrap: false, around }));
  addWindowedNodes(payloads, ids, around, (id, index) => ({
    id,
    label: phrases[index]!.phrase,
  }));
  const start = around ? Math.max(0, around.index - around.radius) : 0;
  const end = around ? Math.min(ids.length, around.index + around.radius + 1) : ids.length;
  for (let i = start; i < end; i++) {
    const phrase = phrases[i]!;
    const first = session.deps.store.listXrefRefReadings(phrase.id, versionId)[0];
    fragments.push({
      [ids[i]!]: {
        ...(first ? { enter: edgeNode(verseNodeId(xrefSeq(phrase.id), first), "push") } : {}),
        back: edgePop(),
      },
    });
  }
}

export function xrefEmptyLabel(): string {
  return "No cross-references for this verse.";
}

export function xrefPhraseLabel(session: ViewSession, phraseId: number): string {
  return session.deps.store.getXrefPhrase(phraseId)?.phrase ?? String(phraseId);
}
