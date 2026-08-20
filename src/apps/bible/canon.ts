import type { BibleRef, KjvBook, KjvData, TestamentId } from "./types.ts";

export function testamentLabel(id: TestamentId): string {
  return id === "OT" ? "Old Testament" : "New Testament";
}

export function booksForTestament(data: KjvData, testament: TestamentId): KjvBook[] {
  return data.books.filter((b) => b.testament === testament);
}

export function findBook(data: KjvData, name: string): KjvBook | undefined {
  const needle = name.toLowerCase();
  return data.books.find(
    (b) => b.name.toLowerCase() === needle || b.abbrev.toLowerCase() === needle,
  );
}

export function verseText(data: KjvData, ref: BibleRef): string | undefined {
  const book = findBook(data, ref.book);
  const chapter = book?.chapters[ref.chapter - 1];
  return chapter?.[ref.verse - 1];
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

/** Encode path segment safely (spaces → kept as-is in path; we use encodeURIComponent). */
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
