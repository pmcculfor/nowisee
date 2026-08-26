import { buildMap, edgePop, rootBackToHome, type MapFragment } from "../../../app-kit/index.ts";
import type {
  AppServerContext,
  NodePayload,
  RefreshExtras,
  RefreshResult,
} from "../../../core/types.ts";
import {
  bookmarkStatusId,
  parseNodeId,
  searchEmptyId,
  verseNodeId,
} from "../ids.ts";
import type { CanonRef } from "../types.ts";
import { resolveCopyStatus } from "./copy.ts";
import {
  activeVersion,
  addNode,
  touchRecency,
  viewSession,
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
  const versionId = path.replace(/^\/+/, "").split("/").filter(Boolean)[0];
  if (!versionId || !session.deps.store.getVersion(versionId)) {
    return;
  }
  if (session.userId) {
    session.deps.store.setActiveVersionId(session.userId, versionId);
  }
  touchRecency(session, "version", versionId);
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
  if (parsed.kind === "commentary-chunk") {
    touchRecency(session, "commentary", parsed.commentaryId);
    return null;
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
  if (!version) {
    return emptyBibleView(session);
  }
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
