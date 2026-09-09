import { edgePop, type MapFragment } from "../../../app-kit/index.ts";
import type { AppLocation, NodePayload, RefreshResult } from "../../../core/types.ts";
import { testamentLabel } from "../catalog.ts";
import { bookPathSegment } from "../canon.ts";
import {
  bookmarksEmptyId,
  bookmarksId,
  bookId as bookNodeId,
  chapterId,
  commentaryChunkId,
  commentaryWorkId,
  commentaryListId,
  optionId,
  searchEmptyId,
  searchId,
  searchInputId,
  searchLimitedId,
  searchWorkingId,
  signInId,
  testamentId,
  verseVersionPickId,
  versionPickId,
  versionsHeadingId,
  type ParsedNode,
} from "../ids.ts";
import { addBookLevel, addChapterLevel, addRootLevel } from "./root.ts";
import { addBookmarksEmpty } from "./bookmarks.ts";
import { addCommentaryWorks, commentaryChunkLabel } from "./commentary.ts";
import {
  activeVersion,
  addNode,
  searchQueryVersion,
  verseLocation,
  withDisplayVersion,
  type ViewSession,
} from "./helpers.ts";
import { addSearchInput, emptySearchLabel, searchLimitedLabel } from "./search.ts";
import { addSignIn } from "./signin.ts";
import {
  addOptionLevel,
  addRootVersionList,
  addSearchLimited,
  addVerseLevel,
  addVerseVersionList,
  optionNodeLabel,
  versePayload,
} from "./verse.ts";

type KindRow = {
  version(session: ViewSession, parsed: ParsedNode): number | null;
  location(session: ViewSession, parsed: ParsedNode, version: number): AppLocation | null;
  payload(session: ViewSession, parsed: ParsedNode, version: number): NodePayload;
  addLevel?(
    session: ViewSession,
    payloads: Map<string, NodePayload>,
    fragments: MapFragment[],
    parsed: ParsedNode,
    version: number,
  ): void;
  directView?(session: ViewSession, parsed: ParsedNode, version: number): RefreshResult;
};

function asKind<K extends ParsedNode["kind"]>(
  parsed: ParsedNode,
  _kind: K,
): Extract<ParsedNode, { kind: K }> {
  return parsed as Extract<ParsedNode, { kind: K }>;
}

function active(session: ViewSession): number | null {
  return activeVersion(session)?.id ?? null;
}

function loc(session: ViewSession, path: string): AppLocation {
  return { appId: session.deps.appId, path };
}

function rootLoc(session: ViewSession): AppLocation {
  return loc(session, "/");
}

function bookmarksLoc(session: ViewSession): AppLocation {
  return loc(session, "/bookmarks");
}

function searchLoc(session: ViewSession): AppLocation {
  return loc(session, "/search");
}

function seqLocation(session: ViewSession, parsed: ParsedNode): AppLocation {
  if (!("ref" in parsed)) {
    throw new Error("Bible view: expected a verse-tree node");
  }
  if ("seq" in parsed) {
    return verseLocation(session.deps.appId, session.deps.store, parsed.seq, parsed.ref);
  }
  return verseLocation(
    session.deps.appId,
    session.deps.store,
    { type: "chapter", bookId: parsed.ref.bookId, chapter: parsed.ref.chapter },
    parsed.ref,
  );
}

function addRootPlain(
  session: ViewSession,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
): void {
  addRootLevel(session, payloads, fragments);
}

function addSearchEmpty(
  session: ViewSession,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  parsed: ParsedNode,
): void {
  const queryId = asKind(parsed, "search-empty").queryId;
  const query = session.sessionId
    ? (session.deps.store.getSearchQuery(queryId, session.sessionId)?.query ?? "")
    : "";
  const id = searchEmptyId(queryId);
  addNode(payloads, { id, label: emptySearchLabel(query) });
  fragments.push({ [id]: { back: edgePop() } });
}

function verseDisplayVersion(session: ViewSession, parsed: ParsedNode): number | null {
  const n = asKind(parsed, "verse");
  if (n.seq.type === "search") {
    return searchQueryVersion(session, n.seq.queryId) ?? active(session);
  }
  return active(session);
}

/**
 * One row per `ParsedNode` kind. `buildBibleView` looks this up once instead of
 * switching on kind in payload / version / location / neighborhood separately.
 */
export const KIND: Record<ParsedNode["kind"], KindRow> = {
  testament: {
    version: active,
    location: rootLoc,
    payload: (_s, parsed) => {
      const n = asKind(parsed, "testament");
      return { id: testamentId(n.testament), label: testamentLabel(n.testament) };
    },
    addLevel: (s, pay, frag, parsed) => {
      addRootLevel(s, pay, frag, asKind(parsed, "testament").testament);
    },
  },
  bookmarks: {
    version: active,
    location: bookmarksLoc,
    payload: () => ({ id: bookmarksId(), label: "Bookmarks" }),
    addLevel: addRootPlain,
  },
  "bookmarks-empty": {
    version: active,
    location: bookmarksLoc,
    payload: () => ({ id: bookmarksEmptyId(), label: "No bookmarks yet." }),
    addLevel: (_s, pay, frag) => {
      addBookmarksEmpty(pay, frag);
    },
  },
  search: {
    version: active,
    location: searchLoc,
    payload: () => ({ id: searchId(), label: "Search" }),
    addLevel: addRootPlain,
  },
  "search-input": {
    version: active,
    location: searchLoc,
    payload: () => ({ id: searchInputId(), label: "", kind: "input" }),
    addLevel: (_s, pay, frag) => {
      addSearchInput(pay, frag);
    },
  },
  "search-working": {
    version: active,
    location: searchLoc,
    payload: () => ({ id: searchWorkingId(), label: "Searching…" }),
    addLevel: (_s, pay, frag) => {
      addNode(pay, { id: searchWorkingId(), label: "Searching…" });
      frag.push({ [searchWorkingId()]: { back: edgePop() } });
    },
  },
  "search-empty": {
    version: active,
    location: searchLoc,
    payload: (_s, parsed) => ({
      id: searchEmptyId(asKind(parsed, "search-empty").queryId),
      label: "No verses matched.",
    }),
    addLevel: (s, pay, frag, parsed) => {
      addSearchEmpty(s, pay, frag, parsed);
    },
  },
  "search-limited": {
    version: (s, parsed) =>
      searchQueryVersion(s, asKind(parsed, "search-limited").queryId) ?? active(s),
    location: searchLoc,
    payload: (_s, parsed) => ({
      id: searchLimitedId(asKind(parsed, "search-limited").queryId),
      label: searchLimitedLabel(),
    }),
    addLevel: (s, pay, frag, parsed, version) => {
      addSearchLimited(s, pay, frag, asKind(parsed, "search-limited").queryId, version);
    },
  },
  "versions-heading": {
    version: active,
    location: rootLoc,
    payload: () => ({ id: versionsHeadingId(), label: "Version" }),
    addLevel: addRootPlain,
  },
  "version-pick": {
    version: active,
    location: rootLoc,
    payload: (s, parsed) => {
      const id = asKind(parsed, "version-pick").versionId;
      return { id: versionPickId(id), label: s.deps.store.getVersion(id)?.label ?? String(id) };
    },
    addLevel: (s, pay, frag) => {
      addRootVersionList(s, pay, frag);
    },
  },
  signin: {
    version: active,
    location: () => null,
    payload: () => ({ id: signInId(), label: "Sign in to bookmark." }),
    addLevel: (s, pay, frag) => {
      addSignIn(s, pay, frag);
    },
  },
  book: {
    version: active,
    location: (s, parsed) => {
      const n = asKind(parsed, "book");
      const book = s.deps.store.getBook(n.bookId);
      return loc(s, `/${bookPathSegment(book?.label ?? String(n.bookId))}`);
    },
    payload: (s, parsed) => {
      const n = asKind(parsed, "book");
      return {
        id: bookNodeId(n.bookId),
        label: s.deps.store.getBook(n.bookId)?.label ?? String(n.bookId),
      };
    },
    addLevel: (s, pay, frag, parsed) => {
      addBookLevel(s, pay, frag, asKind(parsed, "book").bookId);
    },
  },
  chapter: {
    version: active,
    location: (s, parsed) => {
      const n = asKind(parsed, "chapter");
      const book = s.deps.store.getBook(n.bookId);
      return loc(s, `/${bookPathSegment(book?.label ?? String(n.bookId))}/${n.chapter}`);
    },
    payload: (_s, parsed) => {
      const n = asKind(parsed, "chapter");
      return {
        id: chapterId(n.bookId, n.chapter),
        label: `${n.chapter} (chapter)`,
      };
    },
    addLevel: (s, pay, frag, parsed, version) => {
      const n = asKind(parsed, "chapter");
      addChapterLevel(s, pay, frag, version, n.bookId, n.chapter);
    },
  },
  verse: {
    version: verseDisplayVersion,
    location: (s, parsed) => {
      const n = asKind(parsed, "verse");
      return verseLocation(s.deps.appId, s.deps.store, n.seq, n.ref);
    },
    payload: (s, parsed, version) => {
      const n = asKind(parsed, "verse");
      return versePayload(s, n.seq, withDisplayVersion(n.ref, version));
    },
    addLevel: (s, pay, frag, parsed, version) => {
      const n = asKind(parsed, "verse");
      addVerseLevel(s, pay, frag, n.seq, withDisplayVersion(n.ref, version));
    },
  },
  option: {
    version: active,
    location: seqLocation,
    payload: (s, parsed) => {
      const n = asKind(parsed, "option");
      return {
        id: optionId(n.ref, n.option, n.seq),
        label: optionNodeLabel(s, n.ref, n.option),
      };
    },
    addLevel: (s, pay, frag, parsed) => {
      const n = asKind(parsed, "option");
      addOptionLevel(s, pay, frag, n.seq, n.ref);
    },
  },
  "verse-version-pick": {
    version: active,
    location: seqLocation,
    payload: (s, parsed) => {
      const n = asKind(parsed, "verse-version-pick");
      return {
        id: verseVersionPickId(n.ref, n.targetVersionId, n.seq),
        label: s.deps.store.getVersion(n.targetVersionId)?.label ?? String(n.targetVersionId),
      };
    },
    addLevel: (s, pay, frag, parsed) => {
      const n = asKind(parsed, "verse-version-pick");
      addVerseVersionList(s, pay, frag, n.seq, n.ref);
    },
  },
  "commentary-list": {
    version: active,
    location: seqLocation,
    payload: (_s, parsed) => {
      const n = asKind(parsed, "commentary-list");
      return { id: commentaryListId(n.ref), label: "Commentary" };
    },
    addLevel: (s, pay, frag, parsed) => {
      addCommentaryWorks(s, pay, frag, asKind(parsed, "commentary-list").ref);
    },
  },
  "commentary-work": {
    version: active,
    location: seqLocation,
    payload: (s, parsed) => {
      const n = asKind(parsed, "commentary-work");
      return {
        id: commentaryWorkId(n.ref, n.commentaryId),
        label: s.deps.store.getCommentary(n.commentaryId)?.label ?? String(n.commentaryId),
      };
    },
    addLevel: (s, pay, frag, parsed) => {
      addCommentaryWorks(s, pay, frag, asKind(parsed, "commentary-work").ref);
    },
  },
  "commentary-chunk": {
    version: active,
    location: seqLocation,
    payload: (s, parsed) => {
      const n = asKind(parsed, "commentary-chunk");
      return {
        id: commentaryChunkId(n.ref, n.commentaryId, n.index),
        label: commentaryChunkLabel(s, n.ref, n.commentaryId, n.index),
      };
    },
    addLevel: (s, pay, frag, parsed) => {
      addCommentaryWorks(s, pay, frag, asKind(parsed, "commentary-chunk").ref);
    },
  },
};
