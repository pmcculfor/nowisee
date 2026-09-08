import { resolveBookToken } from "./catalog.ts";
import type { CanonRef } from "./types.ts";

export function formatRef(bookLabel: string, ref: CanonRef): string {
  return `${bookLabel} ${ref.chapter}:${ref.verse}`;
}

/** Number first so VoiceOver announces it before the role word. */
export function chapterLabel(chapter: number): string {
  return `${chapter} (chapter)`;
}

/** Chapter-sequence verse: number + text only. */
export function verseNumberLabel(verse: number, text: string): string {
  return `${verse}. ${text}`;
}

/** Search-enter landing: chapter-sequence verse with the role after the number. */
export function verseContextLabel(verse: number, text: string): string {
  return `${verse} (context). ${text}`;
}

export function verseRefLabel(bookLabel: string, ref: CanonRef, text: string): string {
  return `${formatRef(bookLabel, ref)}. ${text}`;
}

export function missingVerseLabel(bookLabel: string, ref: CanonRef, versionLabel: string): string {
  return `${formatRef(bookLabel, ref)} is not in ${versionLabel}.`;
}

export function bookPathSegment(label: string): string {
  return encodeURIComponent(label);
}

export function decodeBookSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export function bookSortFromPathSegment(segment: string): number | null {
  const decoded = decodeBookSegment(segment);
  if (decoded === null) {
    return null;
  }
  return resolveBookToken(decoded)?.sort ?? null;
}
