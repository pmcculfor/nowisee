import type {
  AppLocation,
  AppServerContext,
  NodePayload,
  RefreshExtras,
  RefreshResult,
} from "../../../core/types.ts";
import type { VerseSequence } from "../catalog.ts";
import { bookPathSegment } from "../canon.ts";
import type { BibleStore, BibleVersion, CanonRef } from "../types.ts";

export type BibleViewDeps = {
  readonly store: BibleStore;
  readonly rootAppId: string;
  readonly appId: string;
};

export type ViewSession = {
  readonly deps: BibleViewDeps;
  readonly extras: RefreshExtras;
  readonly userId: string | null;
  readonly sessionId: string | null;
  readonly accountAppId: string;
};

export function viewSession(
  deps: BibleViewDeps,
  extras: RefreshExtras = {},
  ctx?: AppServerContext,
): ViewSession {
  return {
    deps,
    extras,
    userId: ctx?.userId ?? null,
    sessionId: ctx?.sessionId ?? null,
    accountAppId: ctx?.accountAppId ?? deps.rootAppId,
  };
}

export function activeVersion(session: ViewSession): BibleVersion | null {
  return listedVersions(session)[0] ?? null;
}

export function searchQueryVersion(session: ViewSession, queryId: number): number | null {
  if (!session.sessionId) {
    return null;
  }
  return session.deps.store.getSearchQuery(queryId, session.sessionId)?.versionId ?? null;
}

export function addNode(payloads: Map<string, NodePayload>, node: NodePayload): void {
  payloads.set(node.id, node);
}

export function withTipLabel(result: RefreshResult, label: string): RefreshResult {
  return {
    ...result,
    node: { ...result.node, label },
    warm: result.warm.map((n) => (n.id === result.node.id ? { ...n, label } : n)),
  };
}

export function bookLabel(store: BibleStore, bookId: number): string {
  return store.getBook(bookId)?.label ?? String(bookId);
}

export function canonPath(store: BibleStore, ref: CanonRef): string {
  return `/${bookPathSegment(bookLabel(store, ref.bookId))}/${ref.chapter}/${ref.verse}`;
}

export function verseLocation(appId: string, store: BibleStore, seq: VerseSequence, ref: CanonRef): AppLocation {
  if (seq.type === "bookmarks") {
    return { appId, path: `/bookmarks${canonPath(store, ref)}` };
  }
  if (seq.type === "search") {
    return { appId, path: "/search" };
  }
  return { appId, path: canonPath(store, ref) };
}

export function listedVersions(session: ViewSession) {
  return session.deps.store.listVersions(session.userId, session.sessionId);
}

export function listedCommentaries(session: ViewSession) {
  return session.deps.store.listCommentaries(session.userId, session.sessionId);
}

export function touchVersionRecency(session: ViewSession, versionId: number): void {
  session.deps.store.touchVersionRecency(session.userId, session.sessionId, versionId);
}

export function touchCommentaryRecency(session: ViewSession, commentaryId: number): void {
  session.deps.store.touchCommentaryRecency(session.userId, session.sessionId, commentaryId);
}

export function slotVerseId(store: BibleStore, ref: CanonRef): number | null {
  return store.getVerseSlot(ref.bookId, ref.chapter, ref.verse)?.id ?? null;
}

export function withDisplayVersion(ref: CanonRef, versionId: number) {
  return { ...ref, versionId };
}
