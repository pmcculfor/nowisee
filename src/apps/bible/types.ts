export type TestamentId = "OT" | "NT";

export type KjvBook = {
  readonly name: string;
  readonly abbrev: string;
  readonly testament: TestamentId;
  /** chapters[chapterIndex][verseIndex] — 0-based; user-facing numbers are +1 */
  readonly chapters: readonly (readonly string[])[];
};

export type KjvData = {
  readonly translation: string;
  readonly books: readonly KjvBook[];
};

export type BibleRef = {
  readonly book: string;
  readonly chapter: number; // 1-based
  readonly verse: number; // 1-based
};
