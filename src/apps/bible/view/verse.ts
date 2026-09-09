import {
  edgeAction,
  edgeNode,
  edgePop,
  siblingListEdges,
  type MapFragment,
} from "../../../app-kit/index.ts";
import type { NodePayload } from "../../../core/types.ts";
import {
  SEARCH_POLICY,
  VERSE_OPTIONS,
  contextSeq,
  optionLabel,
  type VerseSequence,
} from "../catalog.ts";
import {
  chapterLabel,
  missingVerseLabel,
  verseContextLabel,
  verseNumberLabel,
  verseRefLabel,
} from "../canon.ts";
import {
  chapterId,
  commentaryListId,
  commentaryWorkId,
  optionId,
  searchLimitedId,
  signInId,
  verseNodeId,
  verseVersionPickId,
  versionPickId,
} from "../ids.ts";
import { searchLimitedLabel } from "./search.ts";
import type { BibleRef, CanonRef, VerseReading } from "../types.ts";
import {
  addNode,
  activeVersion,
  bookLabel,
  listedCommentaries,
  listedVersions,
  slotVerseId,
  withDisplayVersion,
  type ViewSession,
} from "./helpers.ts";

export function addVerseLevel(
  session: ViewSession,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  seq: VerseSequence,
  ref: BibleRef,
): void {
  const versionId = ref.versionId;
  const siblings = siblingReadings(session, seq, versionId);
  const ids = sequenceIds(seq, siblings);
  const focusIndex = siblings.findIndex((r) => sameCanon(canonReading(r), ref));
  const around =
    seq.type === "search" && focusIndex >= 0
      ? { index: focusIndex, radius: SEARCH_POLICY.siblingRadius }
      : undefined;
  addSequenceWindow(session, payloads, fragments, seq, versionId, siblings, ids, around);
  fragments.push(siblingListEdges(ids, { wrap: seq.type === "chapter" || seq.type === "context", around }));

  const tip = verseNodeId(seq, ref);
  const enter = verseEnter(seq, ref);
  fragments.push({
    [tip]: {
      ...(enter ? { enter } : {}),
      back:
        seq.type === "chapter" ? edgeNode(chapterId(ref.bookId, ref.chapter), "replace") : edgePop(),
    },
  });
  if (seq.type === "search") {
    addVerseLevel(session, payloads, fragments, contextSeq(ref.bookId, ref.chapter), ref);
  } else {
    addOptionPayloads(session, payloads, seq, ref);
  }
  if (seq.type === "chapter") {
    addNode(payloads, {
      id: chapterId(ref.bookId, ref.chapter),
      label: chapterLabel(ref.chapter),
    });
  }
}

function verseEnter(seq: VerseSequence, ref: CanonRef) {
  if (seq.type === "search") {
    return edgeNode(verseNodeId(contextSeq(ref.bookId, ref.chapter), ref), "push");
  }
  const firstOption = VERSE_OPTIONS[0];
  return firstOption ? edgeNode(optionId(ref, firstOption.type, seq), "replace") : undefined;
}

function sameCanon(a: CanonRef, b: CanonRef): boolean {
  return a.bookId === b.bookId && a.chapter === b.chapter && a.verse === b.verse;
}

function canonReading(row: VerseReading): CanonRef {
  return { bookId: row.bookId, chapter: row.chapter, verse: row.verse };
}

function toRef(versionId: number, row: VerseReading): BibleRef {
  return { versionId, bookId: row.bookId, chapter: row.chapter, verse: row.verse };
}

export function addSearchLimited(
  session: ViewSession,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  queryId: number,
  versionId: number,
): void {
  const seq: VerseSequence = { type: "search", queryId };
  const siblings = siblingReadings(session, seq, versionId);
  const ids = sequenceIds(seq, siblings);
  const limitedId = searchLimitedId(queryId);
  addNode(payloads, { id: limitedId, label: searchLimitedLabel() });
  fragments.push({ [limitedId]: { back: edgePop() } });
  const focusIndex = ids.indexOf(limitedId);
  if (focusIndex < 0) {
    return;
  }
  const around = { index: focusIndex, radius: SEARCH_POLICY.siblingRadius };
  addSequenceWindow(session, payloads, fragments, seq, versionId, siblings, ids, around);
  fragments.push(siblingListEdges(ids, { wrap: false, around }));
}

function sequenceIds(seq: VerseSequence, siblings: readonly VerseReading[]): string[] {
  const ids = siblings.map((r) => verseNodeId(seq, canonReading(r)));
  if (seq.type === "search" && siblings.length >= SEARCH_POLICY.maxHits) {
    ids.push(searchLimitedId(seq.queryId));
  }
  return ids;
}

function addSequenceWindow(
  session: ViewSession,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  seq: VerseSequence,
  versionId: number,
  siblings: readonly VerseReading[],
  ids: readonly string[],
  around: { readonly index: number; readonly radius: number } | undefined,
): void {
  const start = around ? Math.max(0, around.index - around.radius) : 0;
  const end = around ? Math.min(ids.length, around.index + around.radius + 1) : ids.length;
  for (let i = start; i < end; i++) {
    if (i < siblings.length) {
      addNode(payloads, versePayload(session, seq, toRef(versionId, siblings[i]!)));
      continue;
    }
    if (seq.type === "search") {
      const limitedId = searchLimitedId(seq.queryId);
      addNode(payloads, { id: limitedId, label: searchLimitedLabel() });
      fragments.push({ [limitedId]: { back: edgePop() } });
    }
  }
}

function siblingReadings(session: ViewSession, seq: VerseSequence, versionId: number): VerseReading[] {
  const store = session.deps.store;
  if (seq.type === "chapter" || seq.type === "context") {
    const chapter = store.getChapter(seq.bookId, seq.chapter);
    if (!chapter) {
      return [];
    }
    return [...store.listVerseReadings(versionId, chapter.id)];
  }
  if (seq.type === "bookmarks" && session.userId) {
    return store.listBookmarks(session.userId).map((b) => ({
      verseId: b.verseId,
      bookId: b.bookId,
      chapter: b.chapter,
      verse: b.verse,
      text: store.getVerseText(versionId, b.verseId),
    }));
  }
  if (seq.type === "search" && session.sessionId) {
    return [...store.listSearchHitReadings(seq.queryId, session.sessionId)];
  }
  return [];
}

export function versePayload(session: ViewSession, seq: VerseSequence, ref: BibleRef): NodePayload {
  const slot = session.deps.store.getVerseSlot(ref.bookId, ref.chapter, ref.verse);
  const text = slot ? session.deps.store.getVerseText(ref.versionId, slot.id) : null;
  const labelText = verseDisplayText(session, ref, text);
  if (seq.type === "chapter") {
    return {
      id: verseNodeId(seq, ref),
      label: text === null ? labelText : verseNumberLabel(ref.verse, text),
    };
  }
  if (seq.type === "context") {
    return {
      id: verseNodeId(seq, ref),
      label: text === null ? labelText : verseContextLabel(ref.verse, text),
    };
  }
  return {
    id: verseNodeId(seq, ref),
    label: text === null ? labelText : verseRefLabel(bookLabel(session.deps.store, ref.bookId), ref, text),
  };
}

function warmMenuVerse(
  session: ViewSession,
  payloads: Map<string, NodePayload>,
  seq: VerseSequence,
  ref: CanonRef,
): void {
  const version = activeVersion(session);
  if (!version) {
    return;
  }
  addNode(payloads, versePayload(session, seq, withDisplayVersion(ref, version.id)));
}

function verseDisplayText(session: ViewSession, ref: BibleRef, text: string | null): string {
  if (text !== null) {
    return text;
  }
  const version = session.deps.store.getVersion(ref.versionId);
  return missingVerseLabel(bookLabel(session.deps.store, ref.bookId), ref, version?.label ?? "");
}

export function addOptionLevel(
  session: ViewSession,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  seq: VerseSequence,
  ref: CanonRef,
): void {
  const optionIds = VERSE_OPTIONS.map((option) => optionId(ref, option.type, seq));
  addOptionPayloads(session, payloads, seq, ref);
  warmMenuVerse(session, payloads, seq, ref);
  fragments.push(siblingListEdges(optionIds, { wrap: true }));
  for (const option of VERSE_OPTIONS) {
    const id = optionId(ref, option.type, seq);
    fragments.push({
      [id]: {
        enter: optionEnter(session, seq, ref, option.type),
        back: edgeNode(verseNodeId(seq, ref), "replace"),
      },
    });
  }
}

function addOptionPayloads(
  session: ViewSession,
  payloads: Map<string, NodePayload>,
  seq: VerseSequence,
  ref: CanonRef,
): void {
  for (const option of VERSE_OPTIONS) {
    addNode(payloads, {
      id: optionId(ref, option.type, seq),
      label: optionNodeLabel(session, ref, option.type),
    });
  }
}

export function optionEnter(
  session: ViewSession,
  seq: VerseSequence,
  ref: CanonRef,
  option: "copy" | "bookmark" | "versions" | "commentary",
) {
  if (option === "copy") {
    return edgeAction(optionId(ref, "copy", seq), { stackBehavior: "replace" });
  }
  if (option === "bookmark") {
    if (!session.userId) {
      return edgeNode(signInId(), "push");
    }
    return edgeAction(optionId(ref, "bookmark", seq), { stackBehavior: "replace" });
  }
  if (option === "versions") {
    const firstVersion = listedVersions(session)[0];
    if (!firstVersion) {
      return undefined;
    }
    return edgeNode(verseVersionPickId(ref, firstVersion.id, seq), "replace");
  }
  const firstWork = listedCommentaries(session)[0];
  if (!firstWork) {
    return edgeNode(commentaryListId(ref), "push");
  }
  return edgeNode(commentaryWorkId(ref, firstWork.id), "push");
}

export function optionNodeLabel(
  session: ViewSession,
  ref: CanonRef,
  option: "copy" | "bookmark" | "versions" | "commentary",
): string {
  if (option === "bookmark" && session.userId) {
    const verseId = slotVerseId(session.deps.store, ref);
    if (verseId !== null && session.deps.store.isBookmarked(session.userId, verseId)) {
      return "Remove bookmark";
    }
  }
  return optionLabel(option);
}

export function addVerseVersionList(
  session: ViewSession,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  seq: VerseSequence,
  ref: CanonRef,
): void {
  const versions = listedVersions(session);
  const ids = versions.map((v) => verseVersionPickId(ref, v.id, seq));
  addOptionPayloads(session, payloads, seq, ref);
  warmMenuVerse(session, payloads, seq, ref);
  for (const item of versions) {
    addNode(payloads, {
      id: verseVersionPickId(ref, item.id, seq),
      label: item.label,
    });
  }
  fragments.push(siblingListEdges(ids, { wrap: true }));
  for (const item of versions) {
    const id = verseVersionPickId(ref, item.id, seq);
    fragments.push({
      [id]: {
        enter: edgeAction(id, { stackBehavior: "replace" }),
        back: edgeNode(optionId(ref, "versions", seq), "replace"),
      },
    });
  }
}

export function addRootVersionList(
  session: ViewSession,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
): void {
  const versions = listedVersions(session);
  const ids = versions.map((v) => versionPickId(v.id));
  for (const item of versions) {
    addNode(payloads, { id: versionPickId(item.id), label: item.label });
  }
  fragments.push(siblingListEdges(ids, { wrap: true }));
  for (const item of versions) {
    const id = versionPickId(item.id);
    fragments.push({
      [id]: {
        enter: edgeAction(id, { stackBehavior: "replace" }),
        back: edgePop(),
      },
    });
  }
}
