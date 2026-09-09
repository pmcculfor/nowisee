import type { RefreshResult } from "../../../core/types.ts";
import { formatRef } from "../canon.ts";
import type { CanonRef } from "../types.ts";
import { activeVersion, bookLabel, slotVerseId, withTipLabel, type ViewSession } from "./helpers.ts";

export function resolveCopy(
  session: ViewSession,
  ref: CanonRef,
  view: RefreshResult,
): RefreshResult {
  const version = activeVersion(session);
  const verseId = slotVerseId(session.deps.store, ref);
  const text =
    verseId === null || !version ? null : session.deps.store.getVerseText(version.id, verseId);
  const versionLabel = version?.label ?? "";
  const line =
    text !== null
      ? `${versionLabel}. ${formatRef(bookLabel(session.deps.store, ref.bookId), ref)}. ${text}`
      : null;
  const labeled = withTipLabel(view, line ? "Copied" : "Copy failed: verse not found.");
  return line ? { ...labeled, clipboardText: line } : labeled;
}
