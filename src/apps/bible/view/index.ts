import { buildMap, rootBackToHome, type MapFragment } from "../../../app-kit/index.ts";
import type {
  AppServerContext,
  NodePayload,
  OpenResult,
  RefreshExtras,
  RefreshResult,
  StackEntry,
} from "../../../core/types.ts";
import { isActionExtras } from "../../../core/types.ts";
import { parseNodeId } from "../ids.ts";
import {
  addNode,
  viewSession,
  withTipLabel,
  type ActionContribution,
  type BibleViewDeps,
  type ViewSession,
} from "./helpers.ts";
import { KIND } from "./kinds.ts";
import { emptyId, parseBiblePath } from "./path.ts";
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
  if (!isActionExtras(extras)) {
    return buildBibleView(session, tipId);
  }
  const contribution = applyAction(session, extras.action.triggerId);
  const view = buildBibleView(session, contribution?.tipId ?? tipId);
  return applyContribution(view, contribution);
}

/** The trigger node's own kind decides what a deliberate traversal writes. */
function applyAction(session: ViewSession, triggerId: string): ActionContribution | null {
  const parsed = parseNodeId(triggerId);
  if (!parsed) {
    return null;
  }
  return KIND[parsed.kind].action?.(session, parsed) ?? null;
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
