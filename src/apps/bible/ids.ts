import type { BibleRef, TestamentId, VerseOption } from "./types.ts";

export function testamentId(version: string, testament: TestamentId): string {
  return `bible:t:${version}:${testament}`;
}

export function bookmarksId(): string {
  return "bible:bookmarks";
}

export function searchId(): string {
  return "bible:search";
}

export function bookmarksStubId(): string {
  return "bible:stub:bookmarks";
}

export function searchStubId(): string {
  return "bible:stub:search";
}

export function bookId(version: string, book: string): string {
  return `bible:b:${version}:${book}`;
}

export function chapterId(version: string, book: string, chapter: number): string {
  return `bible:c:${version}:${book}:${chapter}`;
}

export function verseId(ref: BibleRef): string {
  return `bible:v:${ref.version}:${ref.book}:${ref.chapter}:${ref.verse}`;
}

export function optionId(ref: BibleRef, option: VerseOption): string {
  return `bible:o:${ref.version}:${ref.book}:${ref.chapter}:${ref.verse}:${option}`;
}

export function copyStatusId(ref: BibleRef): string {
  return `bible:s:${ref.version}:${ref.book}:${ref.chapter}:${ref.verse}:copy`;
}

export function commentaryId(ref: BibleRef): string {
  return `bible:n:${ref.version}:${ref.book}:${ref.chapter}:${ref.verse}:commentary`;
}

export function bookmarkStubId(ref: BibleRef): string {
  return `bible:n:${ref.version}:${ref.book}:${ref.chapter}:${ref.verse}:bookmark`;
}

export type ParsedNode =
  | { kind: "testament"; version: string; testament: TestamentId }
  | { kind: "bookmarks" }
  | { kind: "search" }
  | { kind: "bookmarks-stub" }
  | { kind: "search-stub" }
  | { kind: "book"; version: string; book: string }
  | { kind: "chapter"; version: string; book: string; chapter: number }
  | { kind: "verse"; ref: BibleRef }
  | { kind: "option"; ref: BibleRef; option: VerseOption }
  | { kind: "copy-status"; ref: BibleRef }
  | { kind: "commentary"; ref: BibleRef }
  | { kind: "bookmark"; ref: BibleRef };

const VERSION_BOOK = "([^:]+):(.+)";
const REF = "([^:]+):(.+):(\\d+):(\\d+)";

export function parseNodeId(id: string): ParsedNode | null {
  if (id === bookmarksId()) {
    return { kind: "bookmarks" };
  }
  if (id === searchId()) {
    return { kind: "search" };
  }
  if (id === bookmarksStubId()) {
    return { kind: "bookmarks-stub" };
  }
  if (id === searchStubId()) {
    return { kind: "search-stub" };
  }

  const t = /^bible:t:([^:]+):(OT|NT)$/.exec(id);
  if (t) {
    return { kind: "testament", version: t[1]!, testament: t[2] as TestamentId };
  }
  const b = new RegExp(`^bible:b:${VERSION_BOOK}$`).exec(id);
  if (b) {
    return { kind: "book", version: b[1]!, book: b[2]! };
  }
  const c = new RegExp(`^bible:c:${VERSION_BOOK}:(\\d+)$`).exec(id);
  if (c) {
    return { kind: "chapter", version: c[1]!, book: c[2]!, chapter: Number(c[3]) };
  }
  const v = new RegExp(`^bible:v:${REF}$`).exec(id);
  if (v) {
    return { kind: "verse", ref: refFrom(v) };
  }
  const o = new RegExp(`^bible:o:${REF}:(copy|bookmark|commentary)$`).exec(id);
  if (o) {
    return {
      kind: "option",
      ref: refFrom(o),
      option: o[5] as VerseOption,
    };
  }
  const s = new RegExp(`^bible:s:${REF}:copy$`).exec(id);
  if (s) {
    return { kind: "copy-status", ref: refFrom(s) };
  }
  const n = new RegExp(`^bible:n:${REF}:(commentary|bookmark)$`).exec(id);
  if (n) {
    const ref = refFrom(n);
    return n[5] === "bookmark" ? { kind: "bookmark", ref } : { kind: "commentary", ref };
  }
  return null;
}

function refFrom(match: RegExpExecArray): BibleRef {
  return {
    version: match[1]!,
    book: match[2]!,
    chapter: Number(match[3]),
    verse: Number(match[4]),
  };
}
