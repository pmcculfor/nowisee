import { edgePop, type MapFragment } from "../../../app-kit/index.ts";
import type { AppLocation, NodePayload, RefreshResult } from "../../../core/types.ts";
import { testamentLabel } from "../catalog.ts";
import { bookPathSegment } from "../canon.ts";
import {
  bookmarkStatusId,
  bookmarksEmptyId,
  bookmarksId,
  bookId as bookNodeId,
  chapterId,
  commentaryChunkId,
  commentaryWorkId,
  commentaryListId,
  copyStatusId,
  optionId,
  searchEmptyId,
  searchId,
  searchInputId,
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
import { idleCopyStatus } from "./copy.ts";
import {
  activeVersion,
  addNode,
  displayedVerse,
  verseLocation,
  type ViewSession,
} from "./helpers.ts";
import { addSearchInput, emptySearchLabel } from "./search.ts";
import { addSignIn } from "./signin.ts";
import {
  addOptionLevel,
  addRootVersionList,
  addVerseLevel,
  addVerseVersionList,
  optionNodeLabel,
  versePayload,
} from "./verse.ts";

type KindRow = {
  version(session: ViewSession, parsed: ParsedNode): string | null;
  location(session: ViewSession, parsed: ParsedNode, version: string): AppLocation | null;
  payload(session: ViewSession, parsed: ParsedNode, version: string): NodePayload;
  addLevel?(
    session: ViewSession,
    payloads: Map<string, NodePayload>,
    fragments: MapFragment[],
    parsed: ParsedNode,
    version: string,
  ): void;
  directView?(session: ViewSession, parsed: ParsedNode, version: string): RefreshResult;
};

function asKind<K extends ParsedNode["kind"]>(
  parsed: ParsedNode,
  _kind: K,
): Extract<ParsedNode, { kind: K }> {
  return parsed as Extract<ParsedNode, { kind: K }>;
}

function active(session: ViewSession): string | null {
  return activeVersion(session);
}

function parsedVersion(_session: ViewSession, parsed: ParsedNode): string | null {
  return "version" in parsed ? parsed.version : null;
}

function loc(session: ViewSession, path: string): AppLocation {
  return { appId: session.deps.appId, path };
}

function versionRoot(session: ViewSession, _parsed: ParsedNode, version: string): AppLocation {
  return loc(session, `/${version}`);
}

function bookmarksLoc(session: ViewSession): AppLocation {
  return loc(session, "/bookmarks");
}

function searchLoc(session: ViewSession): AppLocation {
  return loc(session, "/search");
}

function verseLocFromParsed(session: ViewSession, parsed: ParsedNode): AppLocation {
  if (!("version" in parsed) || !("ref" in parsed)) {
    throw new Error("Bible view: expected a verse-tree node");
  }
  return verseLocation(session.deps.appId, parsed.version, parsed.ref);
}

function addRootPlain(
  session: ViewSession,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  _parsed: ParsedNode,
  version: string,
): void {
  addRootLevel(session, payloads, fragments, version);
}

function addSearchEmpty(
  session: ViewSession,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  parsed: ParsedNode,
): void {
  const queryId = asKind(parsed, "search-empty").queryId;
  const query = session.sessionId
    ? (session.deps.store.getSearchQuery(queryId, session.sessionId) ?? "")
    : "";
  const id = searchEmptyId(queryId);
  addNode(payloads, { id, label: emptySearchLabel(query) });
  fragments.push({ [id]: { back: edgePop() } });
}

function bookmarkIdle(session: ViewSession, parsed: ParsedNode): RefreshResult {
  const ref = asKind(parsed, "bookmark-status").ref;
  const statusId = bookmarkStatusId(ref);
  const bookmarked = session.userId ? session.deps.store.isBookmarked(session.userId, ref) : false;
  const label = bookmarked ? "Bookmarked" : "Bookmark removed";
  return {
    navigationMap: { [statusId]: { back: edgePop() } },
    warm: [{ id: statusId, label }],
    node: { id: statusId, label },
    location: null,
  };
}

/**
 * One row per `ParsedNode` kind. `buildBibleView` looks this up once instead of
 * switching on kind in payload / version / location / neighborhood separately.
 */
export const KIND: Record<ParsedNode["kind"], KindRow> = {
  testament: {
    version: parsedVersion,
    location: versionRoot,
    payload: (_s, parsed) => {
      const n = asKind(parsed, "testament");
      return { id: testamentId(n.version, n.testament), label: testamentLabel(n.testament) };
    },
    addLevel: (s, pay, frag, parsed, version) => {
      addRootLevel(s, pay, frag, version, asKind(parsed, "testament").testament);
    },
  },
  bookmarks: {
    version: active,
    location: (s) => bookmarksLoc(s),
    payload: () => ({ id: bookmarksId(), label: "Bookmarks" }),
    addLevel: addRootPlain,
  },
  "bookmarks-empty": {
    version: active,
    location: (s) => bookmarksLoc(s),
    payload: () => ({ id: bookmarksEmptyId(), label: "No bookmarks yet." }),
    addLevel: (_s, pay, frag) => {
      addBookmarksEmpty(pay, frag);
    },
  },
  search: {
    version: active,
    location: (s) => searchLoc(s),
    payload: () => ({ id: searchId(), label: "Search" }),
    addLevel: addRootPlain,
  },
  "search-input": {
    version: active,
    location: (s) => searchLoc(s),
    payload: () => ({ id: searchInputId(), label: "", kind: "input" }),
    addLevel: (_s, pay, frag) => {
      addSearchInput(pay, frag);
    },
  },
  "search-working": {
    version: active,
    location: (s) => searchLoc(s),
    payload: () => ({ id: searchWorkingId(), label: "Searching…" }),
    addLevel: (_s, pay, frag) => {
      addNode(pay, { id: searchWorkingId(), label: "Searching…" });
      frag.push({ [searchWorkingId()]: { back: edgePop() } });
    },
  },
  "search-empty": {
    version: active,
    location: (s) => searchLoc(s),
    payload: (_s, parsed) => ({
      id: searchEmptyId(asKind(parsed, "search-empty").queryId),
      label: "No verses matched.",
    }),
    addLevel: (s, pay, frag, parsed) => {
      addSearchEmpty(s, pay, frag, parsed);
    },
  },
  "versions-heading": {
    version: active,
    location: versionRoot,
    payload: () => ({ id: versionsHeadingId(), label: "Version" }),
    addLevel: addRootPlain,
  },
  "version-pick": {
    version: active,
    location: versionRoot,
    payload: (s, parsed) => {
      const id = asKind(parsed, "version-pick").versionId;
      return { id: versionPickId(id), label: s.deps.store.getVersion(id)?.label ?? id };
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
    version: parsedVersion,
    location: (s, parsed) => {
      const n = asKind(parsed, "book");
      return loc(s, `/${n.version}/${bookPathSegment(n.bookId)}`);
    },
    payload: (s, parsed) => {
      const n = asKind(parsed, "book");
      return {
        id: bookNodeId(n.version, n.bookId),
        label: s.deps.store.getBook(n.version, n.bookId)?.name ?? n.bookId,
      };
    },
    addLevel: (s, pay, frag, parsed) => {
      const n = asKind(parsed, "book");
      addBookLevel(s, pay, frag, n.version, n.bookId);
    },
  },
  chapter: {
    version: parsedVersion,
    location: (s, parsed) => {
      const n = asKind(parsed, "chapter");
      return loc(s, `/${n.version}/${bookPathSegment(n.bookId)}/${n.chapter}`);
    },
    payload: (_s, parsed) => {
      const n = asKind(parsed, "chapter");
      return {
        id: chapterId(n.version, n.bookId, n.chapter),
        label: `${n.chapter} (chapter)`,
      };
    },
    addLevel: (s, pay, frag, parsed) => {
      const n = asKind(parsed, "chapter");
      addChapterLevel(s, pay, frag, n.version, n.bookId, n.chapter);
    },
  },
  verse: {
    version: (s, parsed) => asKind(parsed, "verse").ref.version || active(s),
    location: (s, parsed, version) => {
      const n = asKind(parsed, "verse");
      const ref = displayedVerse(s.deps.store, version, n.ref);
      return verseLocation(s.deps.appId, ref.version, ref);
    },
    payload: (s, parsed, version) => {
      const n = asKind(parsed, "verse");
      return versePayload(s, n.seq, displayedVerse(s.deps.store, version, n.ref));
    },
    addLevel: (s, pay, frag, parsed, version) => {
      const n = asKind(parsed, "verse");
      addVerseLevel(s, pay, frag, n.seq, displayedVerse(s.deps.store, version, n.ref));
    },
  },
  option: {
    version: parsedVersion,
    location: verseLocFromParsed,
    payload: (s, parsed) => {
      const n = asKind(parsed, "option");
      return {
        id: optionId(n.version, n.ref, n.option),
        label: optionNodeLabel(s, n.ref, n.option),
      };
    },
    addLevel: (s, pay, frag, parsed) => {
      const n = asKind(parsed, "option");
      addOptionLevel(s, pay, frag, n.version, n.ref);
    },
  },
  "copy-status": {
    version: parsedVersion,
    location: () => null,
    payload: (_s, parsed) => {
      const n = asKind(parsed, "copy-status");
      return { id: copyStatusId(n.version, n.ref), label: "Copied" };
    },
    directView: (_s, parsed) => {
      const n = asKind(parsed, "copy-status");
      return idleCopyStatus(n.version, n.ref);
    },
  },
  "bookmark-status": {
    version: active,
    location: () => null,
    payload: (_s, parsed) => {
      const n = asKind(parsed, "bookmark-status");
      return { id: bookmarkStatusId(n.ref), label: "Bookmarked" };
    },
    directView: (s, parsed) => bookmarkIdle(s, parsed),
  },
  "verse-version-pick": {
    version: parsedVersion,
    location: verseLocFromParsed,
    payload: (s, parsed) => {
      const n = asKind(parsed, "verse-version-pick");
      return {
        id: verseVersionPickId(n.version, n.ref, n.targetVersionId),
        label: s.deps.store.getVersion(n.targetVersionId)?.label ?? n.targetVersionId,
      };
    },
    addLevel: (s, pay, frag, parsed) => {
      const n = asKind(parsed, "verse-version-pick");
      addVerseVersionList(s, pay, frag, n.version, n.ref);
    },
  },
  "commentary-list": {
    version: parsedVersion,
    location: verseLocFromParsed,
    payload: (_s, parsed) => {
      const n = asKind(parsed, "commentary-list");
      return { id: commentaryListId(n.version, n.ref), label: "Commentary" };
    },
    addLevel: (s, pay, frag, parsed) => {
      const n = asKind(parsed, "commentary-list");
      addCommentaryWorks(s, pay, frag, n.version, n.ref);
    },
  },
  "commentary-work": {
    version: parsedVersion,
    location: verseLocFromParsed,
    payload: (s, parsed) => {
      const n = asKind(parsed, "commentary-work");
      return {
        id: commentaryWorkId(n.version, n.ref, n.commentaryId),
        label: s.deps.store.getCommentary(n.commentaryId)?.label ?? n.commentaryId,
      };
    },
    addLevel: (s, pay, frag, parsed) => {
      const n = asKind(parsed, "commentary-work");
      addCommentaryWorks(s, pay, frag, n.version, n.ref);
    },
  },
  "commentary-chunk": {
    version: parsedVersion,
    location: verseLocFromParsed,
    payload: (s, parsed) => {
      const n = asKind(parsed, "commentary-chunk");
      return {
        id: commentaryChunkId(n.version, n.ref, n.commentaryId, n.index),
        label: commentaryChunkLabel(s, n.ref, n.commentaryId, n.index),
      };
    },
    addLevel: (s, pay, frag, parsed) => {
      const n = asKind(parsed, "commentary-chunk");
      addCommentaryWorks(s, pay, frag, n.version, n.ref);
    },
  },
};
