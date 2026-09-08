import type { RefreshResult } from "../../../core/types.ts";
import { formatRef } from "../canon.ts";
import type { CanonRef } from "../types.ts";
import { bookLabel, slotVerseId, withTipLabel, type ViewSession } from "./helpers.ts";

export function resolveCopy(
  session: ViewSession,
  versionId: number,
  ref: CanonRef,
  view: RefreshResult,
): RefreshResult {
  const verseId = slotVerseId(session.deps.store, ref);
  const text = verseId === null ? null : session.deps.store.getVerseText(versionId, verseId);
  const versionLabel = session.deps.store.getVersion(versionId)?.label ?? String(versionId);
  const line =
    text !== null
      ? `${versionLabel}. ${formatRef(bookLabel(session.deps.store, ref.bookId), ref)}. ${text}`
      : null;
  const labeled = withTipLabel(view, line ? "Copied" : "Copy failed: verse not found.");
  return line ? { ...labeled, clipboardText: line } : labeled;
}
