import { getCanonBook, resolveBookToken } from "./catalog.ts";
import type { BibleRef, CanonRef } from "./types.ts";

export function formatRef(bookLabel: string, ref: CanonRef | BibleRef): string {
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

export function verseRefLabel(bookLabel: string, ref: CanonRef, text: string): string {
  return `${formatRef(bookLabel, ref)}. ${text}`;
}

export function bookPathSegment(bookId: string): string {
  const book = getCanonBook(bookId);
  return encodeURIComponent(book?.label ?? bookId);
}

export function decodeBookSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export function bookIdFromPathSegment(segment: string): string | null {
  const decoded = decodeBookSegment(segment);
  if (decoded === null) {
    return null;
  }
  return resolveBookToken(decoded)?.id ?? null;
}
