import {
  edgeAction,
  edgeNode,
  edgePop,
  siblingListEdges,
  type MapFragment,
} from "../../../app-kit/index.ts";
import type { NodePayload } from "../../../core/types.ts";
import { XREF_POLICY, contextSeq } from "../catalog.ts";
import { missingVerseLabel, verseRefLabel } from "../canon.ts";
import { verseNodeId, xrefEmptyId, xrefPhraseId, xrefRefId, xrefWorkId } from "../ids.ts";
import type { CanonRef, XrefTarget } from "../types.ts";
import {
  addNode,
  addWindowedNodes,
  bookLabel,
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
  fragments.push(siblingListEdges(ids, { wrap: true, around }));
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
        ...(first
          ? { enter: edgeNode(xrefRefId(ref, workId, phrase.id, first.sortOrder), "push") }
          : {}),
        back: edgePop(),
      },
    });
  }
}

export function addXrefRefs(
  session: ViewSession,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  ref: CanonRef,
  versionId: number,
  workId: number,
  phraseId: number,
  focusSortOrder: number | undefined,
): void {
  addXrefPhrases(session, payloads, fragments, ref, versionId, workId, phraseId);
  const targets = [...session.deps.store.listXrefRefReadings(phraseId, versionId)];
  const ids = targets.map((row) => xrefRefId(ref, workId, phraseId, row.sortOrder));
  if (ids.length === 0) {
    return;
  }
  const focusId =
    focusSortOrder !== undefined
      ? xrefRefId(ref, workId, phraseId, focusSortOrder)
      : ids[0]!;
  const around = siblingWindow(ids, focusId, XREF_POLICY.siblingRadius);
  fragments.push(siblingListEdges(ids, { wrap: false, around }));
  addWindowedNodes(payloads, ids, around, (_id, index) =>
    xrefRefPayload(session, ref, workId, phraseId, targets[index]!, versionId),
  );
  const start = around ? Math.max(0, around.index - around.radius) : 0;
  const end = around ? Math.min(ids.length, around.index + around.radius + 1) : ids.length;
  for (let i = start; i < end; i++) {
    const target = targets[i]!;
    const related = verseNodeId(contextSeq(target.bookId, target.chapter), target);
    fragments.push({
      [ids[i]!]: {
        enter: edgeNode(related, "push"),
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

export function xrefRefLabelFor(
  session: ViewSession,
  phraseId: number,
  sortOrder: number,
  versionId: number,
): string {
  const target = session.deps.store
    .listXrefRefReadings(phraseId, versionId)
    .find((row) => row.sortOrder === sortOrder);
  if (!target) {
    return String(sortOrder);
  }
  return xrefTargetLabel(session, target, versionId);
}

function xrefRefPayload(
  session: ViewSession,
  ref: CanonRef,
  workId: number,
  phraseId: number,
  target: XrefTarget,
  versionId: number,
): NodePayload {
  return {
    id: xrefRefId(ref, workId, phraseId, target.sortOrder),
    label: xrefTargetLabel(session, target, versionId),
  };
}

function xrefTargetLabel(session: ViewSession, target: XrefTarget, versionId: number): string {
  const book = bookLabel(session.deps.store, target.bookId);
  if (target.text === null) {
    const version = session.deps.store.getVersion(versionId);
    return missingVerseLabel(book, target, version?.label ?? "");
  }
  return verseRefLabel(book, target, target.text);
}
