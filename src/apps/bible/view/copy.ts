import { edgePop } from "../../../app-kit/index.ts";
import type { NodePayload, RefreshResult } from "../../../core/types.ts";
import { formatRef } from "../canon.ts";
import { copyStatusId } from "../ids.ts";
import type { CanonRef } from "../types.ts";
import { addNode, bookLabel, type ViewSession } from "./helpers.ts";
import { addOptionPayloads } from "./verse.ts";
export function resolveCopyStatus(
  session: ViewSession,
  version: string,
  ref: CanonRef,
): RefreshResult {
  const statusNodeId = copyStatusId(version, ref);
  const verse = session.deps.store.getVerse({ ...ref, version });
  const versionLabel = session.deps.store.getVersion(version)?.label ?? version;
  const line = verse
    ? `${versionLabel}. ${formatRef(bookLabel(session.deps.store, version, ref.bookId), ref)}. ${verse.text}`
    : null;
  const label = line ? "Copied" : "Copy failed: verse not found.";

  const payloads = new Map<string, NodePayload>();
  addNode(payloads, { id: statusNodeId, label });
  addOptionPayloads(session, payloads, version, ref);

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

export function idleCopyStatus(version: string, ref: CanonRef): RefreshResult {
  const statusNodeId = copyStatusId(version, ref);
  return {
    navigationMap: {
      [statusNodeId]: { back: edgePop() },
    },
    warm: [{ id: statusNodeId, label: "Copied" }],
    node: { id: statusNodeId, label: "Copied" },
    location: null,
  };
}
