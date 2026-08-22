export type TestamentId = "OT" | "NT";

export type BibleVersion = {
  readonly id: string;
  readonly label: string;
};

export type BibleBook = {
  readonly versionId: string;
  readonly name: string;
  readonly abbrev: string;
  readonly testament: TestamentId;
  readonly chapterCount: number;
};

export type BibleRef = {
  readonly version: string;
  readonly book: string;
  readonly chapter: number; // 1-based
  readonly verse: number; // 1-based
};

export type BibleVerse = BibleRef & {
  readonly text: string;
};

/** Seed / import shape (bundled KJV JSON). */
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

export type VerseOption = "copy" | "bookmark" | "commentary";

export const TESTAMENT_ORDER: readonly TestamentId[] = ["OT", "NT"];

export interface BibleStore {
  defaultVersionId(): string | null;
  getVersion(id: string): BibleVersion | undefined;
  listVersions(): readonly BibleVersion[];
  listTestaments(versionId: string): readonly TestamentId[];
  listBooks(versionId: string, testament: TestamentId): readonly BibleBook[];
  getBook(versionId: string, nameOrAbbrev: string): BibleBook | undefined;
  verseCount(versionId: string, book: string, chapter: number): number;
  getVerse(ref: BibleRef): BibleVerse | undefined;
  listVerses(versionId: string, book: string, chapter: number): readonly BibleVerse[];
  close(): void;
}
