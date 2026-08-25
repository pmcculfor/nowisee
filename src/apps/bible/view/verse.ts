import {
  edgeAction,
  edgeApp,
  edgeNode,
  edgePop,
  siblingListEdges,
  type MapFragment,
} from "../../../app-kit/index.ts";
import type { NodePayload } from "../../../core/types.ts";
import { SEARCH_POLICY, VERSE_OPTIONS, optionLabel, type VerseSequence } from "../catalog.ts";
import { bookPathSegment, chapterLabel, verseNumberLabel, verseRefLabel } from "../canon.ts";
import {
  bookmarkStatusId,
  chapterId,
  commentaryListId,
  commentaryWorkId,
  copyStatusId,
  optionId,
  signInId,
  verseNodeId,
  verseVersionPickId,
  versionPickId,
} from "../ids.ts";
import { tokenize } from "../search.ts";
import type { BibleRef, CanonRef } from "../types.ts";
import {
  addNode,
  bookLabel,
  clampVerse,
  displayedVerse,
  listedCommentaries,
  listedVersions,
  type ViewSession,
} from "./helpers.ts";

export function addVerseLevel(
  session: ViewSession,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  seq: VerseSequence,
  ref: BibleRef,
): void {
  const version = ref.version;
  const siblings = siblingRefs(session, seq, version);
  const ids = siblings.map((r) => verseNodeId(seq, r));
  for (const sibling of siblings) {
    addNode(payloads, versePayload(session, seq, sibling));
  }
  fragments.push(siblingListEdges(ids, { wrap: seq.type === "chapter" }));

  const tip = verseNodeId(seq, ref);
  const firstOption = VERSE_OPTIONS[0];
  fragments.push({
    [tip]: {
      ...(firstOption
        ? { enter: edgeNode(optionId(version, ref, firstOption.type), "push") }
        : {}),
      back:
        seq.type === "chapter"
          ? edgeNode(chapterId(version, ref.bookId, ref.chapter), "replace")
          : edgePop(),
    },
  });
  addOptionPayloads(session, payloads, version, ref);
  if (seq.type === "chapter") {
    addNode(payloads, {
      id: chapterId(version, ref.bookId, ref.chapter),
      label: chapterLabel(ref.chapter),
    });
  }
}

function siblingRefs(session: ViewSession, seq: VerseSequence, version: string): BibleRef[] {
  const store = session.deps.store;
  if (seq.type === "chapter") {
    return store.listVerses(seq.versionId, seq.bookId, seq.chapter).map((v) => v);
  }
  if (seq.type === "bookmarks" && session.userId) {
    return store.listBookmarks(session.userId).map((b) => displayedVerse(store, version, b));
  }
  if (seq.type === "search" && session.sessionId) {
    const query = store.getSearchQuery(seq.queryId, session.sessionId);
    if (!query) {
      return [];
    }
    const tokens = tokenize(query);
    return store.searchVerses(version, tokens, SEARCH_POLICY.maxHits).map((hit) =>
      displayedVerse(store, version, hit),
    );
  }
  return [];
}

export function versePayload(
  session: ViewSession,
  seq: VerseSequence,
  ref: BibleRef,
): NodePayload {
  const verse = session.deps.store.getVerse(ref);
  const text = verse?.text ?? "";
  const label =
    seq.type === "chapter"
      ? verseNumberLabel(ref.verse, text)
      : verseRefLabel(bookLabel(session.deps.store, ref.version, ref.bookId), ref, text);
  return { id: verseNodeId(seq, ref), label };
}

export function addOptionLevel(
  session: ViewSession,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  version: string,
  ref: CanonRef,
): void {
  const optionIds = VERSE_OPTIONS.map((option) => optionId(version, ref, option.type));
  addOptionPayloads(session, payloads, version, ref);
  fragments.push(siblingListEdges(optionIds, { wrap: true }));
  for (const option of VERSE_OPTIONS) {
    const id = optionId(version, ref, option.type);
    fragments.push({
      [id]: {
        enter: optionEnter(session, version, ref, option.type),
        back: edgePop(),
      },
    });
  }
}

export function addOptionPayloads(
  session: ViewSession,
  payloads: Map<string, NodePayload>,
  version: string,
  ref: CanonRef,
): void {
  for (const option of VERSE_OPTIONS) {
    addNode(payloads, {
      id: optionId(version, ref, option.type),
      label: optionNodeLabel(session, ref, option.type),
    });
  }
}

export function optionEnter(
  session: ViewSession,
  version: string,
  ref: CanonRef,
  option: "copy" | "bookmark" | "versions" | "commentary",
) {
  if (option === "copy") {
    return edgeAction(copyStatusId(version, ref));
  }
  if (option === "bookmark") {
    if (!session.userId) {
      return edgeNode(signInId(), "push");
    }
    return edgeAction(bookmarkStatusId(ref));
  }
  if (option === "versions") {
    const firstVersion = listedVersions(session)[0];
    if (!firstVersion) {
      return undefined;
    }
    return edgeNode(verseVersionPickId(version, ref, firstVersion.id), "push");
  }
  const firstWork = listedCommentaries(session)[0];
  if (!firstWork) {
    return edgeNode(commentaryListId(version, ref), "push");
  }
  return edgeNode(commentaryWorkId(version, ref, firstWork.id), "push");
}

export function optionNodeLabel(
  session: ViewSession,
  ref: CanonRef,
  option: "copy" | "bookmark" | "versions" | "commentary",
): string {
  if (option === "bookmark" && session.userId && session.deps.store.isBookmarked(session.userId, ref)) {
    return "Remove bookmark";
  }
  return optionLabel(option);
}

export function addVerseVersionList(
  session: ViewSession,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  version: string,
  ref: CanonRef,
): void {
  const versions = listedVersions(session);
  const ids = versions.map((v) => verseVersionPickId(version, ref, v.id));
  for (const item of versions) {
    addNode(payloads, {
      id: verseVersionPickId(version, ref, item.id),
      label: item.label,
    });
  }
  fragments.push(siblingListEdges(ids, { wrap: true }));
  for (const item of versions) {
    const clamped =
      clampVerse(session.deps.store, item.id, ref.bookId, ref.chapter, ref.verse) ?? {
        version: item.id,
        bookId: ref.bookId,
        chapter: ref.chapter,
        verse: ref.verse,
      };
    fragments.push({
      [verseVersionPickId(version, ref, item.id)]: {
        enter: edgeApp(
          {
            appId: session.deps.appId,
            path: `/${item.id}/${bookPathSegment(clamped.bookId)}/${clamped.chapter}/${clamped.verse}`,
          },
          { action: true },
        ),
        back: edgePop(),
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
    fragments.push({
      [versionPickId(item.id)]: {
        enter: edgeApp({ appId: session.deps.appId, path: `/${item.id}` }, { action: true }),
        back: edgePop(),
      },
    });
  }
}
