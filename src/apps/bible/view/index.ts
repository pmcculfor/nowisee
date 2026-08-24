import { buildMap, edgePop, rootBackToHome, type MapFragment } from "../../../app-kit/index.ts";
import type {
  AppLocation,
  AppServerContext,
  NodePayload,
  RefreshExtras,
  RefreshResult,
} from "../../../core/types.ts";
import { testamentLabel } from "../catalog.ts";
import { bookPathSegment } from "../canon.ts";
import {
  bookmarkStatusId,
  bookmarksEmptyId,
  bookmarksId,
  bookId as bookNodeId,
  chapterId,
  commentarySectionId,
  commentaryWorkId,
  commentaryListId,
  copyStatusId,
  optionId,
  parseNodeId,
  searchEmptyId,
  searchId,
  searchInputId,
  searchWorkingId,
  signInId,
  testamentId,
  verseVersionListId,
  verseVersionPickId,
  versionPickId,
  versionsHeadingId,
  verseNodeId,
  type ParsedNode,
} from "../ids.ts";
import type { CanonRef } from "../types.ts";
import { addBookLevel, addChapterLevel, addRootLevel } from "./root.ts";
import { addBookmarksEmpty } from "./bookmarks.ts";
import { addCommentaryWorks, commentaryLabel } from "./commentary.ts";
import { idleCopyStatus, resolveCopyStatus } from "./copy.ts";
import {
  activeVersion,
  addNode,
  displayedVerse,
  verseLocation,
  viewSession,
  type BibleViewDeps,
  type ViewSession,
} from "./helpers.ts";
import { emptyId, parseBiblePath } from "./path.ts";
import { addSearchInput, emptySearchLabel, searchHits } from "./search.ts";
import { addSignIn, signInResult } from "./signin.ts";
import {
  addOptionLevel,
  addRootVersionList,
  addVerseLevel,
  addVerseVersionList,
  optionNodeLabel,
  versePayload,
} from "./verse.ts";

export type { BibleViewDeps };

export function openBibleView(
  deps: BibleViewDeps,
  path: string,
  extras: RefreshExtras = {},
  ctx?: AppServerContext,
): RefreshResult {
  const session = viewSession(deps, extras, ctx);
  if (extras.action && session.userId) {
    writePrefFromPath(session, path);
  }
  return buildBibleView(session, parseBiblePath(session, path));
}

export function refreshBibleView(
  deps: BibleViewDeps,
  tipId: string,
  extras: RefreshExtras = {},
  ctx?: AppServerContext,
): RefreshResult {
  const session = viewSession(deps, extras, ctx);
  if (extras.action) {
    const acted = applyAction(session, tipId);
    if (acted) {
      return acted;
    }
  }
  return buildBibleView(session, tipId);
}

function writePrefFromPath(session: ViewSession, path: string): void {
  const versionId = path.replace(/^\/+/, "").split("/").filter(Boolean)[0];
  if (versionId && session.userId && session.deps.store.getVersion(versionId)) {
    session.deps.store.setActiveVersionId(session.userId, versionId);
  }
}

function applyAction(session: ViewSession, tipId: string): RefreshResult | null {
  const parsed = parseNodeId(tipId);
  if (!parsed) {
    return null;
  }
  if (parsed.kind === "copy-status") {
    return resolveCopyStatus(session, parsed.version, parsed.ref);
  }
  if (parsed.kind === "bookmark-status") {
    return applyBookmarkToggle(session, parsed.ref);
  }
  if (parsed.kind === "search-working") {
    return applySearch(session);
  }
  return null;
}

function applyBookmarkToggle(session: ViewSession, ref: CanonRef): RefreshResult {
  const statusId = bookmarkStatusId(ref);
  if (!session.userId) {
    return signInResult(session, { appId: session.deps.appId, path: "/bookmarks" });
  }
  const result = session.deps.store.toggleBookmark(session.userId, ref);
  const label = result === "added" ? "Bookmarked" : "Bookmark removed";
  return {
    navigationMap: { [statusId]: { back: edgePop() } },
    warm: [{ id: statusId, label }],
    node: { id: statusId, label },
    location: null,
  };
}

function applySearch(session: ViewSession): RefreshResult {
  const query = session.extras.inputText ?? "";
  const version = activeVersion(session);
  if (!session.sessionId) {
    const id = searchEmptyId("none");
    const label = emptySearchLabel(query);
    return {
      navigationMap: { [id]: { back: edgePop() } },
      warm: [{ id, label }],
      node: { id, label },
      location: { appId: session.deps.appId, path: "/search" },
    };
  }
  const queryId = session.deps.store.createSearchQuery(session.sessionId, query);
  const hits = searchHits(session, version, query);
  if (hits.length === 0) {
    const id = searchEmptyId(queryId);
    const label = emptySearchLabel(query);
    return {
      navigationMap: { [id]: { back: edgePop() } },
      warm: [{ id, label }],
      node: { id, label },
      location: { appId: session.deps.appId, path: "/search" },
    };
  }
  return buildBibleView(session, verseNodeId({ type: "search", queryId }, hits[0]!));
}

export function buildBibleView(session: ViewSession, tipId: string): RefreshResult {
  if (tipId === emptyId()) {
    return emptyBibleView(session);
  }

  const parsed = parseNodeId(tipId);
  if (!parsed) {
    return buildBibleView(session, parseBiblePath(session, "/"));
  }

  const version = versionFor(session, parsed);
  const payloads = new Map<string, NodePayload>();
  const fragments: MapFragment[] = [];

  switch (parsed.kind) {
    case "testament":
      addRootLevel(session, payloads, fragments, version, parsed.testament);
      break;
    case "bookmarks":
    case "search":
    case "versions-heading":
      addRootLevel(session, payloads, fragments, version);
      break;
    case "bookmarks-empty":
      addBookmarksEmpty(payloads, fragments);
      break;
    case "search-input":
      addSearchInput(payloads, fragments);
      break;
    case "search-working":
      addNode(payloads, { id: searchWorkingId(), label: "Searching…" });
      fragments.push({ [searchWorkingId()]: { back: edgePop() } });
      break;
    case "search-empty":
      addSearchEmpty(session, payloads, fragments, parsed.queryId);
      break;
    case "version-pick":
      addRootVersionList(session, payloads, fragments);
      break;
    case "signin":
      addSignIn(session, payloads, fragments);
      break;
    case "book":
      addBookLevel(session, payloads, fragments, parsed.version, parsed.bookId);
      break;
    case "chapter":
      addChapterLevel(session, payloads, fragments, parsed.version, parsed.bookId, parsed.chapter);
      break;
    case "verse": {
      const ref = displayedVerse(session.deps.store, version, parsed.ref);
      addVerseLevel(session, payloads, fragments, parsed.seq, ref);
      break;
    }
    case "option":
      addOptionLevel(session, payloads, fragments, parsed.version, parsed.ref);
      break;
    case "copy-status":
      return idleCopyStatus(parsed.version, parsed.ref);
    case "bookmark-status":
      return bookmarkIdle(session, parsed.ref);
    case "verse-version-list":
    case "verse-version-pick":
      addVerseVersionList(session, payloads, fragments, parsed.version, parsed.ref);
      break;
    case "commentary-list":
    case "commentary-work":
    case "commentary-section":
      addCommentaryWorks(session, payloads, fragments, parsed.version, parsed.ref);
      break;
  }

  const tip = payloads.get(tipId) ?? payloadFor(session, parsed, version);
  addNode(payloads, tip);
  return {
    navigationMap: buildMap(...fragments),
    warm: [...payloads.values()],
    node: tip,
    location: locationFor(session, parsed, version),
  };
}

function addSearchEmpty(
  session: ViewSession,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  queryId: string,
): void {
  const query = session.sessionId
    ? (session.deps.store.getSearchQuery(queryId, session.sessionId) ?? "")
    : "";
  const id = searchEmptyId(queryId);
  addNode(payloads, { id, label: emptySearchLabel(query) });
  fragments.push({ [id]: { back: edgePop() } });
}

function bookmarkIdle(session: ViewSession, ref: CanonRef): RefreshResult {
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

function payloadFor(session: ViewSession, parsed: ParsedNode, version: string): NodePayload {
  switch (parsed.kind) {
    case "testament":
      return { id: testamentId(parsed.version, parsed.testament), label: testamentLabel(parsed.testament) };
    case "bookmarks":
      return { id: bookmarksId(), label: "Bookmarks" };
    case "bookmarks-empty":
      return { id: bookmarksEmptyId(), label: "No bookmarks yet." };
    case "search":
      return { id: searchId(), label: "Search" };
    case "search-input":
      return { id: searchInputId(), label: "", kind: "input" };
    case "search-working":
      return { id: searchWorkingId(), label: "Searching…" };
    case "search-empty":
      return { id: searchEmptyId(parsed.queryId), label: "No verses matched." };
    case "versions-heading":
      return { id: versionsHeadingId(), label: "Version" };
    case "version-pick":
      return {
        id: versionPickId(parsed.versionId),
        label: session.deps.store.getVersion(parsed.versionId)?.label ?? parsed.versionId,
      };
    case "signin":
      return { id: signInId(), label: "Sign in to bookmark." };
    case "book":
      return {
        id: bookNodeId(parsed.version, parsed.bookId),
        label: session.deps.store.getBook(parsed.version, parsed.bookId)?.name ?? parsed.bookId,
      };
    case "chapter":
      return { id: chapterId(parsed.version, parsed.bookId, parsed.chapter), label: `${parsed.chapter} (chapter)` };
    case "verse":
      return versePayload(session, parsed.seq, displayedVerse(session.deps.store, version, parsed.ref));
    case "option":
      return {
        id: optionId(parsed.version, parsed.ref, parsed.option),
        label: optionNodeLabel(session, parsed.ref, parsed.option),
      };
    case "copy-status":
      return { id: copyStatusId(parsed.version, parsed.ref), label: "Copied" };
    case "bookmark-status":
      return { id: bookmarkStatusId(parsed.ref), label: "Bookmarked" };
    case "verse-version-list":
      return { id: verseVersionListId(parsed.version, parsed.ref), label: "Versions" };
    case "verse-version-pick":
      return {
        id: verseVersionPickId(parsed.version, parsed.ref, parsed.targetVersionId),
        label: session.deps.store.getVersion(parsed.targetVersionId)?.label ?? parsed.targetVersionId,
      };
    case "commentary-list":
      return { id: commentaryListId(parsed.version, parsed.ref), label: "Commentary" };
    case "commentary-work":
      return {
        id: commentaryWorkId(parsed.version, parsed.ref, parsed.commentaryId),
        label: session.deps.store.getCommentary(parsed.commentaryId)?.label ?? parsed.commentaryId,
      };
    case "commentary-section": {
      const work = session.deps.store.getCommentary(parsed.commentaryId);
      const section = session.deps.store.findSection(parsed.commentaryId, parsed.ref);
      return {
        id: commentarySectionId(parsed.version, parsed.ref, parsed.commentaryId),
        label: commentaryLabel(section, work?.label ?? parsed.commentaryId),
      };
    }
  }
}

function versionFor(session: ViewSession, parsed: ParsedNode): string {
  switch (parsed.kind) {
    case "testament":
    case "book":
    case "chapter":
      return parsed.version;
    case "verse":
      return parsed.ref.version || activeVersion(session);
    case "option":
    case "copy-status":
    case "verse-version-list":
    case "verse-version-pick":
    case "commentary-list":
    case "commentary-work":
    case "commentary-section":
      return parsed.version;
    default:
      return activeVersion(session);
  }
}

function locationFor(session: ViewSession, parsed: ParsedNode, version: string): AppLocation | null {
  const appId = session.deps.appId;
  switch (parsed.kind) {
    case "testament":
    case "versions-heading":
    case "version-pick":
      return { appId, path: `/${version}` };
    case "bookmarks":
    case "bookmarks-empty":
      return { appId, path: "/bookmarks" };
    case "search":
    case "search-input":
    case "search-working":
    case "search-empty":
      return { appId, path: "/search" };
    case "signin":
      return null;
    case "book":
      return { appId, path: `/${parsed.version}/${bookPathSegment(parsed.bookId)}` };
    case "chapter":
      return {
        appId,
        path: `/${parsed.version}/${bookPathSegment(parsed.bookId)}/${parsed.chapter}`,
      };
    case "verse": {
      const ref = displayedVerse(session.deps.store, version, parsed.ref);
      return verseLocation(appId, ref.version, ref);
    }
    case "option":
    case "verse-version-list":
    case "verse-version-pick":
    case "commentary-list":
    case "commentary-work":
    case "commentary-section":
      return verseLocation(appId, parsed.version, parsed.ref);
    case "copy-status":
    case "bookmark-status":
      return null;
  }
}

function emptyBibleView(session: ViewSession): RefreshResult {
  const id = emptyId();
  return {
    navigationMap: buildMap(rootBackToHome(id, session.deps.rootAppId)),
    warm: [{ id, label: "Bible data is not available." }],
    node: { id, label: "Bible data is not available." },
    location: { appId: session.deps.appId, path: "/" },
  };
}
