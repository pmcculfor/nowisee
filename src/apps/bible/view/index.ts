import { buildMap, edgePop, rootBackToHome, type MapFragment } from "../../../app-kit/index.ts";
import type {
  AppServerContext,
  NodePayload,
  RefreshExtras,
  RefreshResult,
} from "../../../core/types.ts";
import {
  parseNodeId,
  searchEmptyId,
  verseNodeId,
} from "../ids.ts";
import type { CanonRef } from "../types.ts";
import { resolveCopy } from "./copy.ts";
import {
  activeVersion,
  addNode,
  slotVerseId,
  touchCommentaryRecency,
  touchVersionRecency,
  viewSession,
  withTipLabel,
  type BibleViewDeps,
  type ViewSession,
} from "./helpers.ts";
import { KIND } from "./kinds.ts";
import { emptyId, parseBiblePath } from "./path.ts";
import { emptySearchLabel, searchHits } from "./search.ts";
import { signInResult } from "./signin.ts";

export type { BibleViewDeps };

export function openBibleView(
  deps: BibleViewDeps,
  path: string,
  extras: RefreshExtras = {},
  ctx?: AppServerContext,
): RefreshResult {
  const session = viewSession(deps, extras, ctx);
  if (extras.action) {
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
  const slug = path.replace(/^\/+/, "").split("/").filter(Boolean)[0];
  if (!slug) {
    return;
  }
  const version = session.deps.store.getVersionBySlug(slug);
  if (!version) {
    return;
  }
  if (session.userId) {
    session.deps.store.setActiveVersionId(session.userId, version.id);
  }
  touchVersionRecency(session, version.id);
}

function applyAction(session: ViewSession, tipId: string): RefreshResult | null {
  const parsed = parseNodeId(tipId);
  if (!parsed) {
    return null;
  }
  if (parsed.kind === "option" && parsed.option === "copy") {
    return resolveCopy(session, parsed.version, parsed.ref, buildBibleView(session, tipId));
  }
  if (parsed.kind === "option" && parsed.option === "bookmark") {
    return applyBookmarkToggle(session, parsed.ref, tipId);
  }
  if (parsed.kind === "search-working") {
    return applySearch(session);
  }
  if (parsed.kind === "commentary-chunk") {
    touchCommentaryRecency(session, parsed.commentaryId);
    return null;
  }
  return null;
}

function applyBookmarkToggle(session: ViewSession, ref: CanonRef, tipId: string): RefreshResult {
  if (!session.userId) {
    return signInResult(session, { appId: session.deps.appId, path: "/bookmarks" });
  }
  const verseId = slotVerseId(session.deps.store, ref);
  if (verseId === null) {
    return withTipLabel(buildBibleView(session, tipId), "Bookmark failed: verse not found.");
  }
  session.deps.store.toggleBookmark(session.userId, verseId);
  return buildBibleView(session, tipId);
}

function applySearch(session: ViewSession): RefreshResult {
  const query = session.extras.inputText ?? "";
  const version = activeVersion(session);
  if (!version) {
    return emptyBibleView(session);
  }
  if (!session.sessionId) {
    const id = searchEmptyId(0);
    const label = emptySearchLabel(query);
    return {
      navigationMap: { [id]: { back: edgePop() } },
      warm: [{ id, label }],
      node: { id, label },
      location: { appId: session.deps.appId, path: "/search" },
    };
  }
  const hits = searchHits(session, version.id, query);
  const queryId = session.deps.store.createSearchQuery(session.sessionId, query, hits);
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
  const first = hits[0]!;
  return buildBibleView(
    session,
    verseNodeId({ type: "search", queryId }, first),
  );
}

export function buildBibleView(session: ViewSession, tipId: string): RefreshResult {
  if (tipId === emptyId()) {
    return emptyBibleView(session);
  }

  const parsed = parseNodeId(tipId);
  if (!parsed) {
    return buildBibleView(session, parseBiblePath(session, "/"));
  }

  const row = KIND[parsed.kind];
  const version = row.version(session, parsed);
  if (!version) {
    return emptyBibleView(session);
  }
  if (row.directView) {
    return row.directView(session, parsed, version);
  }

  const payloads = new Map<string, NodePayload>();
  const fragments: MapFragment[] = [];
  row.addLevel?.(session, payloads, fragments, parsed, version);
  const tip = payloads.get(tipId) ?? row.payload(session, parsed, version);
  addNode(payloads, tip);
  return {
    navigationMap: buildMap(...fragments),
    warm: [...payloads.values()],
    node: tip,
    location: row.location(session, parsed, version),
  };
}

function emptyBibleView(session: ViewSession): RefreshResult {
  const id = emptyId();
  return {
    navigationMap: buildMap(rootBackToHome(id, session.deps.rootAppId, session.deps.appId)),
    warm: [{ id, label: "Bible data is not available." }],
    node: { id, label: "Bible data is not available." },
    location: { appId: session.deps.appId, path: "/" },
  };
}
