import type {
  AppLocation,
  AppServerContext,
  NodePayload,
  RefreshExtras,
  RefreshResult,
} from "../../../core/types.ts";
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

export function activeVersion(session: ViewSession, pathSlug?: string | null): BibleVersion | null {
  const store = session.deps.store;
  if (pathSlug) {
    const fromPath = store.getVersionBySlug(pathSlug);
    if (fromPath) {
      return fromPath;
    }
  }
  if (session.userId) {
    const pref = store.getActiveVersionId(session.userId);
    if (pref !== null) {
      const fromPref = store.getVersion(pref);
      if (fromPref) {
        return fromPref;
      }
    }
  }
  const defaultId = store.defaultVersionId();
  return defaultId === null ? null : (store.getVersion(defaultId) ?? null);
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

export function verseLocation(appId: string, slug: string, bookLabelText: string, ref: CanonRef): AppLocation {
  return {
    appId,
    path: `/${slug}/${bookPathSegment(bookLabelText)}/${ref.chapter}/${ref.verse}`,
  };
}

export function listedVersions(session: ViewSession) {
  return session.deps.store.listVersions(session.userId);
}

export function listedCommentaries(session: ViewSession) {
  return session.deps.store.listCommentaries(session.userId);
}

export function touchVersionRecency(session: ViewSession, versionId: number): void {
  if (!session.userId) {
    return;
  }
  session.deps.store.touchVersionRecency(session.userId, versionId);
}

export function touchCommentaryRecency(session: ViewSession, commentaryId: number): void {
  if (!session.userId) {
    return;
  }
  session.deps.store.touchCommentaryRecency(session.userId, commentaryId);
}

export function slotVerseId(store: BibleStore, ref: CanonRef): number | null {
  return store.getVerseSlot(ref.bookId, ref.chapter, ref.verse)?.id ?? null;
}
