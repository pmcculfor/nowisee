import type { AppLocation, AppServerContext, NodePayload, RefreshExtras } from "../../../core/types.ts";
import { getCanonBook, type RecencyWorkKind } from "../catalog.ts";
import { bookPathSegment } from "../canon.ts";
import type { BibleRef, BibleStore, CanonRef, RecencyOwner } from "../types.ts";

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

export function activeVersion(session: ViewSession, pathVersion?: string | null): string {
  const store = session.deps.store;
  if (pathVersion && store.getVersion(pathVersion)) {
    return pathVersion;
  }
  if (session.userId) {
    const pref = store.getActiveVersionId(session.userId);
    if (pref && store.getVersion(pref)) {
      return pref;
    }
  }
  return store.defaultVersionId();
}

export function addNode(payloads: Map<string, NodePayload>, node: NodePayload): void {
  payloads.set(node.id, node);
}

export function bookLabel(store: BibleStore, version: string, bookId: string): string {
  return store.getBook(version, bookId)?.name ?? getCanonBook(bookId)?.label ?? bookId;
}

export function verseLocation(appId: string, version: string, ref: CanonRef): AppLocation {
  return {
    appId,
    path: `/${version}/${bookPathSegment(ref.bookId)}/${ref.chapter}/${ref.verse}`,
  };
}

export function clampVerse(
  store: BibleStore,
  version: string,
  bookId: string,
  chapter: number,
  verse: number,
): BibleRef | null {
  const book = store.getBook(version, bookId);
  if (!book) {
    return null;
  }
  const last = store.lastVerse(version, bookId, chapter);
  if (last < 1) {
    return null;
  }
  const clamped = Math.min(Math.max(verse, 1), last);
  return { version, bookId, chapter, verse: clamped };
}

export function displayedVerse(store: BibleStore, version: string, ref: CanonRef): BibleRef {
  return (
    clampVerse(store, version, ref.bookId, ref.chapter, ref.verse) ?? {
      version,
      bookId: ref.bookId,
      chapter: ref.chapter,
      verse: ref.verse,
    }
  );
}

export function recencyOwner(session: ViewSession): RecencyOwner | null {
  if (session.userId) {
    return { kind: "user", id: session.userId };
  }
  if (session.sessionId) {
    return { kind: "session", id: session.sessionId };
  }
  return null;
}

export function listedVersions(session: ViewSession) {
  return session.deps.store.listVersions(recencyOwner(session));
}

export function listedCommentaries(session: ViewSession) {
  return session.deps.store.listCommentaries(recencyOwner(session));
}

export function touchRecency(session: ViewSession, workKind: RecencyWorkKind, workId: string): void {
  const owner = recencyOwner(session);
  if (!owner) {
    return;
  }
  session.deps.store.touchRecency(owner, workKind, workId);
}
