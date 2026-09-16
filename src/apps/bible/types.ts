import type { RecencyWorkKind, VersionLicense, VersionRecord } from "./catalog.ts";

export type BibleVersion = {
  readonly id: number;
  readonly abbreviation: string;
  readonly label: string;
  readonly license: VersionLicense;
};

export type BibleBook = {
  readonly id: number;
  readonly label: string;
  readonly testament: string;
  readonly sort: number;
};

export type BibleChapter = {
  readonly id: number;
  readonly bookId: number;
  readonly number: number;
};

export type BibleVerseSlot = {
  readonly id: number;
  readonly chapterId: number;
  readonly number: number;
};

export type VerseReading = {
  readonly verseId: number;
  readonly bookId: number;
  readonly chapter: number;
  readonly verse: number;
  readonly text: string | null;
};

export type BibleRef = {
  readonly versionId: number;
  readonly bookId: number;
  readonly chapter: number;
  readonly verse: number;
};

export type CanonRef = {
  readonly bookId: number;
  readonly chapter: number;
  readonly verse: number;
};

export type BookmarkRecord = {
  readonly verseId: number;
  readonly bookId: number;
  readonly chapter: number;
  readonly verse: number;
  readonly createdAt: number;
};

export type CommentarySection = {
  readonly id: number;
  readonly commentaryId: number;
  readonly body: string;
};

export type CommentaryWork = {
  readonly id: number;
  readonly label: string;
  readonly sortOrder: number;
};

export type CatalogWork = {
  readonly id: number;
  readonly label: string;
  readonly sortOrder: number;
};

export type XrefPhrase = {
  readonly id: number;
  readonly xrefWorkId: number;
  readonly verseId: number;
  readonly sortOrder: number;
  readonly phrase: string;
};

export type DictionaryWord = {
  readonly position: number;
  readonly strongs: string;
  readonly english: string;
  readonly lemma: string;
  readonly translit: string;
  readonly body: string;
};

export type XrefTarget = VerseReading & {
  readonly sortOrder: number;
};

export type SearchHit = {
  readonly verseId: number;
  readonly bookId: number;
  readonly chapter: number;
  readonly verse: number;
};

export type BibleSeedVerse = {
  readonly versionId: string;
  readonly bookId: string;
  readonly chapter: number;
  readonly verse: number;
  readonly text: string;
};

export type BibleSeedSection = {
  readonly commentaryId: string;
  readonly bookId: string;
  readonly startChapter: number;
  readonly startVerse: number;
  readonly endChapter: number;
  readonly endVerse: number;
  readonly body: string;
};

export type BibleSeedXrefPhrase = {
  readonly workId: string;
  readonly bookId: string;
  readonly chapter: number;
  readonly verse: number;
  readonly sort: number;
  readonly phrase: string;
  readonly refs: string;
};

export type BibleSeedToken = {
  readonly bookId: string;
  readonly chapter: number;
  readonly verse: number;
  readonly position: number;
  readonly strongs: string;
  readonly english: string;
};

export type BibleSeedDictionaryEntry = {
  readonly workId: string;
  readonly strongs: string;
  readonly lemma: string;
  readonly translit: string;
  readonly body: string;
};

/** Tiny in-test corpus. Never a full translation. */
export type BibleSeed = {
  readonly verses: readonly BibleSeedVerse[];
  readonly sections?: readonly BibleSeedSection[];
  readonly xrefPhrases?: readonly BibleSeedXrefPhrase[];
  readonly tokens?: readonly BibleSeedToken[];
  readonly dictionaryEntries?: readonly BibleSeedDictionaryEntry[];
};

export type SearchQueryRecord = {
  readonly query: string;
  readonly versionId: number;
};

export interface BibleStore {
  getVersion(id: number): BibleVersion | undefined;
  listVersions(userId?: string | null, sessionId?: string | null): readonly BibleVersion[];
  touchVersionRecency(userId: string | null, sessionId: string | null, versionId: number): void;
  touchCommentaryRecency(userId: string | null, sessionId: string | null, commentaryId: number): void;
  listBooks(testament: string): readonly BibleBook[];
  getBook(id: number): BibleBook | undefined;
  getBookBySort(sort: number): BibleBook | undefined;
  getChapter(bookId: number, number: number): BibleChapter | undefined;
  listChapters(bookId: number): readonly BibleChapter[];
  getVerseSlot(bookId: number, chapter: number, verse: number): BibleVerseSlot | undefined;
  getVerseText(versionId: number, verseId: number): string | null;
  listVerseReadings(versionId: number, chapterId: number): readonly VerseReading[];
  isBookmarked(userId: string, verseId: number): boolean;
  listBookmarks(userId: string): readonly BookmarkRecord[];
  toggleBookmark(userId: string, verseId: number): "added" | "removed";
  listCommentaries(userId?: string | null, sessionId?: string | null): readonly CommentaryWork[];
  getCommentary(id: number): CommentaryWork | undefined;
  findSection(commentaryId: number, verseId: number): CommentarySection | undefined;
  touchXrefRecency(userId: string | null, sessionId: string | null, xrefWorkId: number): void;
  listXrefWorks(userId?: string | null, sessionId?: string | null): readonly CatalogWork[];
  getXrefWork(id: number): CatalogWork | undefined;
  listXrefPhrases(workId: number, verseId: number): readonly XrefPhrase[];
  getXrefPhrase(id: number): XrefPhrase | undefined;
  listXrefRefReadings(phraseId: number, versionId: number): readonly XrefTarget[];
  touchDictionaryRecency(userId: string | null, sessionId: string | null, dictionaryWorkId: number): void;
  listDictionaryWorks(userId?: string | null, sessionId?: string | null): readonly CatalogWork[];
  getDictionaryWork(id: number): CatalogWork | undefined;
  listDictionaryWords(workId: number, verseId: number): readonly DictionaryWord[];
  createSearchQuery(
    sessionId: string,
    query: string,
    versionId: number,
    hits: readonly SearchHit[],
  ): number;
  getSearchQuery(queryId: number, sessionId: string): SearchQueryRecord | null;
  listSearchHits(queryId: number, sessionId: string): readonly SearchHit[];
  listSearchHitReadings(queryId: number, sessionId: string): readonly VerseReading[];
  searchVerses(versionId: number, tokens: readonly string[], cap: number): readonly SearchHit[];
  close(): void;
}

export type { RecencyWorkKind, VersionRecord };
