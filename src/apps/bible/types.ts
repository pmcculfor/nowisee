import type { CommentaryRecord, VersionLicense, VersionRecord } from "./catalog.ts";

export type BibleVersion = {
  readonly id: string;
  readonly label: string;
  readonly license: VersionLicense;
};

export type BibleBook = {
  readonly versionId: string;
  readonly bookId: string;
  readonly name: string;
  readonly testament: string;
  readonly sort: number;
  readonly chapterCount: number;
};

export type BibleRef = {
  readonly version: string;
  readonly bookId: string;
  readonly chapter: number;
  readonly verse: number;
};

export type BibleVerse = BibleRef & {
  readonly text: string;
};

export type CanonRef = {
  readonly bookId: string;
  readonly chapter: number;
  readonly verse: number;
};

export type BookmarkRecord = CanonRef & {
  readonly createdAt: number;
};

export type CommentarySection = {
  readonly id: number;
  readonly commentaryId: string;
  readonly startOrd: number;
  readonly endOrd: number;
  readonly body: string;
  readonly xrefs: readonly string[];
};

export type SearchHit = CanonRef;

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
  readonly xrefs?: readonly string[];
};

/** Tiny in-test corpus. Never a full translation. */
export type BibleSeed = {
  readonly verses: readonly BibleSeedVerse[];
  readonly sections?: readonly BibleSeedSection[];
};

export interface BibleStore {
  defaultVersionId(): string;
  getVersion(id: string): BibleVersion | undefined;
  listVersions(): readonly BibleVersion[];
  getActiveVersionId(userId: string): string | null;
  setActiveVersionId(userId: string, versionId: string): void;
  listTestaments(versionId: string): readonly string[];
  listBooks(versionId: string, testament: string): readonly BibleBook[];
  getBook(versionId: string, bookIdOrAlias: string): BibleBook | undefined;
  verseCount(versionId: string, bookId: string, chapter: number): number;
  lastVerse(versionId: string, bookId: string, chapter: number): number;
  getVerse(ref: BibleRef): BibleVerse | undefined;
  listVerses(versionId: string, bookId: string, chapter: number): readonly BibleVerse[];
  chapterVerseMax(bookId: string, chapter: number): number;
  isBookmarked(userId: string, ref: CanonRef): boolean;
  listBookmarks(userId: string): readonly BookmarkRecord[];
  toggleBookmark(userId: string, ref: CanonRef): "added" | "removed";
  listCommentaries(): readonly CommentaryRecord[];
  getCommentary(id: string): CommentaryRecord | undefined;
  findSection(commentaryId: string, ref: CanonRef): CommentarySection | undefined;
  createSearchQuery(sessionId: string, query: string): string;
  getSearchQuery(queryId: string, sessionId: string): string | null;
  searchVerses(versionId: string, tokens: readonly string[], cap: number): readonly SearchHit[];
  close(): void;
}

export type { VersionRecord };
