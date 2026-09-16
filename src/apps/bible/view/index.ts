import { buildMap, edgePop, rootBackToHome, type MapFragment } from "../../../app-kit/index.ts";
import type {
  AppServerContext,
  NodePayload,
  OpenResult,
  RefreshExtras,
  RefreshResult,
  StackEntry,
} from "../../../core/types.ts";
import { isActionExtras } from "../../../core/types.ts";
import { parseNodeId, searchEmptyId, verseNodeId } from "../ids.ts";
import type { CanonRef } from "../types.ts";
import { resolveCopy, type ActionContribution } from "./copy.ts";
import {
  addNode,
  slotVerseId,
  touchCommentaryRecency,
  touchDictionaryRecency,
  touchVersionRecency,
  touchXrefRecency,
  viewSession,
  withTipLabel,
  activeVersion,
  listedDictionaryWorks,
  listedXrefWorks,
  type BibleViewDeps,
  type ViewSession,
} from "./helpers.ts";
import { KIND } from "./kinds.ts";
import { emptyId, parseBiblePath } from "./path.ts";
import { emptySearchLabel, searchHits } from "./search.ts";
import { committedAncestry } from "./ancestry.ts";

export type { BibleViewDeps };

export function openBibleView(
  deps: BibleViewDeps,
  path: string,
  extras: RefreshExtras = {},
  ctx?: AppServerContext,
): OpenResult {
  const session = viewSession(deps, extras, ctx);
  const view = buildBibleView(session, parseBiblePath(session, path));
  const stack = committedAncestry(session, view.node);
  return stack ? { ...view, stack } : view;
}

export function refreshBibleView(
  deps: BibleViewDeps,
  tipId: string,
  extras: RefreshExtras = {},
  ctx?: AppServerContext,
): RefreshResult {
  const session = viewSession(deps, extras, ctx);
  if (isActionExtras(extras)) {
    const search = applySearchAction(session, extras.action.triggerId);
    if (search) {
      return search;
    }
    const contribution = applyAction(session, extras.action.triggerId);
    const view = buildBibleView(session, tipId);
    return applyContribution(view, contribution);
  }
  return buildBibleView(session, tipId);
}

function applySearchAction(session: ViewSession, triggerId: string): RefreshResult | null {
  const parsed = parseNodeId(triggerId);
  if (parsed?.kind === "search-working" || parsed?.kind === "search-input") {
    return applySearch(session);
  }
  return null;
}

function applyAction(session: ViewSession, triggerId: string): ActionContribution | null {
  const parsed = parseNodeId(triggerId);
  if (!parsed) {
    return null;
  }
  if (parsed.kind === "option" && parsed.option === "copy") {
    return resolveCopy(session, parsed.ref);
  }
  if (parsed.kind === "option" && parsed.option === "bookmark") {
    return applyBookmarkToggle(session, parsed.ref);
  }
  if (parsed.kind === "commentary-chunk") {
    touchCommentaryRecency(session, parsed.commentaryId);
    return null;
  }
  if (parsed.kind === "version-pick") {
    touchVersionRecency(session, parsed.versionId);
    return null;
  }
  if (parsed.kind === "verse-version-pick") {
    touchVersionRecency(session, parsed.targetVersionId);
    return null;
  }
  if (parsed.kind === "option" && parsed.option === "cross-references") {
    const first = listedXrefWorks(session)[0];
    if (first) {
      touchXrefRecency(session, first.id);
    }
    return null;
  }
  if (parsed.kind === "option" && parsed.option === "dictionaries") {
    const first = listedDictionaryWorks(session)[0];
    if (first) {
      touchDictionaryRecency(session, first.id);
    }
    return null;
  }
  if (parsed.kind === "xref-work") {
    touchXrefRecency(session, parsed.workId);
    return null;
  }
  if (parsed.kind === "dictionary-work") {
    touchDictionaryRecency(session, parsed.workId);
    return null;
  }
  return null;
}

function applyBookmarkToggle(session: ViewSession, ref: CanonRef): ActionContribution | null {
  if (!session.userId) {
    return null;
  }
  const verseId = slotVerseId(session.deps.store, ref);
  if (verseId === null) {
    return { statusLabel: "Bookmark failed: verse not found." };
  }
  session.deps.store.toggleBookmark(session.userId, verseId);
  return null;
}

function applyContribution(view: RefreshResult, contribution: ActionContribution | null): RefreshResult {
  if (!contribution) {
    return view;
  }
  let next = view;
  if (contribution.statusLabel) {
    next = withTipLabel(next, contribution.statusLabel);
  }
  if (contribution.clipboardText) {
    next = { ...next, clipboardText: contribution.clipboardText };
  }
  return next;
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
  const queryId = session.deps.store.createSearchQuery(session.sessionId, query, version.id, hits);
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
  return buildBibleView(session, verseNodeId({ type: "search", queryId }, first));
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

export type { StackEntry };
