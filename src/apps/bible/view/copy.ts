import { edgePop } from "../../../app-kit/index.ts";
import type { NodePayload, RefreshResult } from "../../../core/types.ts";
import { formatRef } from "../canon.ts";
import { copyStatusId } from "../ids.ts";
import type { CanonRef } from "../types.ts";
import { addNode, bookLabel, slotVerseId, type ViewSession } from "./helpers.ts";
import { addOptionPayloads } from "./verse.ts";

export function resolveCopyStatus(
  session: ViewSession,
  versionId: number,
  ref: CanonRef,
): RefreshResult {
  const statusNodeId = copyStatusId(versionId, ref);
  const verseId = slotVerseId(session.deps.store, ref);
  const text = verseId === null ? null : session.deps.store.getVerseText(versionId, verseId);
  const versionLabel = session.deps.store.getVersion(versionId)?.label ?? String(versionId);
  const line =
    text !== null
      ? `${versionLabel}. ${formatRef(bookLabel(session.deps.store, ref.bookId), ref)}. ${text}`
      : null;
  const label = line ? "Copied" : "Copy failed: verse not found.";

  const payloads = new Map<string, NodePayload>();
  addNode(payloads, { id: statusNodeId, label });
  addOptionPayloads(session, payloads, versionId, ref);

  return {
    navigationMap: {
      [statusNodeId]: { back: edgePop() },
    },
    warm: [...payloads.values()],
    node: { id: statusNodeId, label },
    location: null,
    ...(line ? { clipboardText: line } : {}),
  };
}

export function idleCopyStatus(versionId: number, ref: CanonRef): RefreshResult {
  const statusNodeId = copyStatusId(versionId, ref);
  return {
    navigationMap: {
      [statusNodeId]: { back: edgePop() },
    },
    warm: [{ id: statusNodeId, label: "Copied" }],
    node: { id: statusNodeId, label: "Copied" },
    location: null,
  };
}
