import type { BibleRef, TestamentId } from "./types.ts";

export function testamentLabel(id: TestamentId): string {
  return id === "OT" ? "Old Testament" : "New Testament";
}

export function formatRef(ref: BibleRef): string {
  return `${ref.book} ${ref.chapter}:${ref.verse}`;
}

/** Number first so VoiceOver announces it before the role word. */
export function chapterLabel(chapter: number): string {
  return `${chapter} (chapter)`;
}

/** Verse number + text only; copy still uses formatRef for book/chapter. */
export function verseLabel(verse: number, text: string): string {
  return `${verse}. ${text}`;
}

export function bookPathSegment(name: string): string {
  return encodeURIComponent(name);
}

export function decodeBookSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}
