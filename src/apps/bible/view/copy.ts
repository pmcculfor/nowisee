import { formatRef } from "../canon.ts";
import type { CanonRef } from "../types.ts";
import { activeVersion, bookLabel, slotVerseId, type ViewSession } from "./helpers.ts";

export type ActionContribution = {
  readonly statusLabel?: string;
  readonly clipboardText?: string;
};

export function resolveCopy(session: ViewSession, ref: CanonRef): ActionContribution {
  const version = activeVersion(session);
  const verseId = slotVerseId(session.deps.store, ref);
  const text =
    verseId === null || !version ? null : session.deps.store.getVerseText(version.id, verseId);
  const line =
    text !== null && version
      ? `${formatRef(bookLabel(session.deps.store, ref.bookId), ref)}. ${text} (${version.abbreviation})`
      : null;
  if (!line) {
    return { statusLabel: "Copy failed: verse not found." };
  }
  return { statusLabel: "Copied", clipboardText: line };
}
