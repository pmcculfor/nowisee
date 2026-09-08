import type { VerseSequence } from "./catalog.ts";
import type { BibleRef, CanonRef } from "./types.ts";

export function testamentId(versionId: number, testament: string): string {
  return `bible:t:${versionId}:${testament}`;
}

export function bookmarksId(): string {
  return "bible:bookmarks";
}

export function bookmarksEmptyId(): string {
  return "bible:bookmarks:empty";
}

export function searchId(): string {
  return "bible:search";
}

export function searchInputId(): string {
  return "bible:search:input";
}

export function searchWorkingId(): string {
  return "bible:search:working";
}

export function searchEmptyId(queryId: number): string {
  return `bible:q:${queryId}:empty`;
}

export function searchLimitedId(queryId: number): string {
  return `bible:q:${queryId}:limited`;
}

export function versionsHeadingId(): string {
  return "bible:versions";
}

export function versionPickId(versionId: number): string {
  return `bible:ver:${versionId}`;
}

export function signInId(): string {
  return "bible:signin";
}

export function bookId(versionId: number, bookId: number): string {
  return `bible:b:${versionId}:${bookId}`;
}

export function chapterId(versionId: number, bookId: number, chapter: number): string {
  return `bible:c:${versionId}:${bookId}:${chapter}`;
}

export function verseNodeId(seq: VerseSequence, ref: CanonRef): string {
  switch (seq.type) {
    case "chapter":
      return `bible:v:${seq.versionId}:${ref.bookId}:${ref.chapter}:${ref.verse}`;
    case "context":
      return `bible:vx:${seq.versionId}:${ref.bookId}:${ref.chapter}:${ref.verse}`;
    case "bookmarks":
      return `bible:bm:${ref.bookId}:${ref.chapter}:${ref.verse}`;
    case "search":
      return `bible:q:${seq.queryId}:${ref.bookId}:${ref.chapter}:${ref.verse}`;
  }
}

export function optionId(
  versionId: number,
  ref: CanonRef,
  option: "copy" | "bookmark" | "versions" | "commentary",
): string {
  return `bible:o:${versionId}:${ref.bookId}:${ref.chapter}:${ref.verse}:${option}`;
}

export function verseVersionPickId(versionId: number, ref: CanonRef, targetVersionId: number): string {
  return `bible:vp:${versionId}:${ref.bookId}:${ref.chapter}:${ref.verse}:${targetVersionId}`;
}

export function commentaryListId(versionId: number, ref: CanonRef): string {
  return `bible:cl:${versionId}:${ref.bookId}:${ref.chapter}:${ref.verse}`;
}

export function commentaryWorkId(versionId: number, ref: CanonRef, commentaryId: number): string {
  return `bible:cw:${versionId}:${ref.bookId}:${ref.chapter}:${ref.verse}:${commentaryId}`;
}

export function commentaryChunkId(
  versionId: number,
  ref: CanonRef,
  commentaryId: number,
  index: number,
): string {
  return `bible:cs:${versionId}:${ref.bookId}:${ref.chapter}:${ref.verse}:${commentaryId}:${index}`;
}

export type ParsedNode =
  | { kind: "testament"; version: number; testament: string }
  | { kind: "bookmarks" }
  | { kind: "bookmarks-empty" }
  | { kind: "search" }
  | { kind: "search-input" }
  | { kind: "search-working" }
  | { kind: "search-empty"; queryId: number }
  | { kind: "search-limited"; queryId: number }
  | { kind: "versions-heading" }
  | { kind: "version-pick"; versionId: number }
  | { kind: "signin" }
  | { kind: "book"; version: number; bookId: number }
  | { kind: "chapter"; version: number; bookId: number; chapter: number }
  | { kind: "verse"; seq: VerseSequence; ref: BibleRef }
  | { kind: "option"; version: number; ref: CanonRef; option: "copy" | "bookmark" | "versions" | "commentary" }
  | { kind: "verse-version-pick"; version: number; ref: CanonRef; targetVersionId: number }
  | { kind: "commentary-list"; version: number; ref: CanonRef }
  | { kind: "commentary-work"; version: number; ref: CanonRef; commentaryId: number }
  | { kind: "commentary-chunk"; version: number; ref: CanonRef; commentaryId: number; index: number };

const REF = "(\\d+):(\\d+):(\\d+):(\\d+)";
const CANON = "(\\d+):(\\d+):(\\d+)";

export function parseNodeId(id: string): ParsedNode | null {
  if (id === bookmarksId()) {
    return { kind: "bookmarks" };
  }
  if (id === bookmarksEmptyId()) {
    return { kind: "bookmarks-empty" };
  }
  if (id === searchId()) {
    return { kind: "search" };
  }
  if (id === searchInputId()) {
    return { kind: "search-input" };
  }
  if (id === searchWorkingId()) {
    return { kind: "search-working" };
  }
  if (id === versionsHeadingId()) {
    return { kind: "versions-heading" };
  }
  if (id === signInId()) {
    return { kind: "signin" };
  }

  const emptyQ = /^bible:q:(\d+):empty$/.exec(id);
  if (emptyQ) {
    return { kind: "search-empty", queryId: Number(emptyQ[1]) };
  }

  const limitedQ = /^bible:q:(\d+):limited$/.exec(id);
  if (limitedQ) {
    return { kind: "search-limited", queryId: Number(limitedQ[1]) };
  }

  const ver = /^bible:ver:(\d+)$/.exec(id);
  if (ver) {
    return { kind: "version-pick", versionId: Number(ver[1]) };
  }

  const t = /^bible:t:(\d+):(.+)$/.exec(id);
  if (t) {
    return { kind: "testament", version: Number(t[1]), testament: t[2]! };
  }

  const b = /^bible:b:(\d+):(\d+)$/.exec(id);
  if (b) {
    return { kind: "book", version: Number(b[1]), bookId: Number(b[2]) };
  }

  const c = /^bible:c:(\d+):(\d+):(\d+)$/.exec(id);
  if (c) {
    return { kind: "chapter", version: Number(c[1]), bookId: Number(c[2]), chapter: Number(c[3]) };
  }

  const v = new RegExp(`^bible:v:${REF}$`).exec(id);
  if (v) {
    const ref = bibleRef(v[1]!, v[2]!, v[3]!, v[4]!);
    return {
      kind: "verse",
      seq: { type: "chapter", versionId: ref.versionId, bookId: ref.bookId, chapter: ref.chapter },
      ref,
    };
  }

  const vx = new RegExp(`^bible:vx:${REF}$`).exec(id);
  if (vx) {
    const ref = bibleRef(vx[1]!, vx[2]!, vx[3]!, vx[4]!);
    return {
      kind: "verse",
      seq: { type: "context", versionId: ref.versionId, bookId: ref.bookId, chapter: ref.chapter },
      ref,
    };
  }

  const bm = new RegExp(`^bible:bm:${CANON}$`).exec(id);
  if (bm) {
    return {
      kind: "verse",
      seq: { type: "bookmarks" },
      ref: { versionId: 0, bookId: Number(bm[1]), chapter: Number(bm[2]), verse: Number(bm[3]) },
    };
  }

  const q = /^bible:q:(\d+):(\d+):(\d+):(\d+)$/.exec(id);
  if (q) {
    return {
      kind: "verse",
      seq: { type: "search", queryId: Number(q[1]) },
      ref: { versionId: 0, bookId: Number(q[2]), chapter: Number(q[3]), verse: Number(q[4]) },
    };
  }

  const o = new RegExp(`^bible:o:${REF}:(copy|bookmark|versions|commentary)$`).exec(id);
  if (o) {
    return {
      kind: "option",
      version: Number(o[1]),
      ref: canonRef(o[2]!, o[3]!, o[4]!),
      option: o[5] as "copy" | "bookmark" | "versions" | "commentary",
    };
  }

  const vp = new RegExp(`^bible:vp:${REF}:(\\d+)$`).exec(id);
  if (vp) {
    return {
      kind: "verse-version-pick",
      version: Number(vp[1]),
      ref: canonRef(vp[2]!, vp[3]!, vp[4]!),
      targetVersionId: Number(vp[5]),
    };
  }

  const cl = new RegExp(`^bible:cl:${REF}$`).exec(id);
  if (cl) {
    return { kind: "commentary-list", version: Number(cl[1]), ref: canonRef(cl[2]!, cl[3]!, cl[4]!) };
  }

  const cw = new RegExp(`^bible:cw:${REF}:(\\d+)$`).exec(id);
  if (cw) {
    return {
      kind: "commentary-work",
      version: Number(cw[1]),
      ref: canonRef(cw[2]!, cw[3]!, cw[4]!),
      commentaryId: Number(cw[5]),
    };
  }

  const cs = new RegExp(`^bible:cs:${REF}:(\\d+):(\\d+)$`).exec(id);
  if (cs) {
    return {
      kind: "commentary-chunk",
      version: Number(cs[1]),
      ref: canonRef(cs[2]!, cs[3]!, cs[4]!),
      commentaryId: Number(cs[5]),
      index: Number(cs[6]),
    };
  }

  return null;
}

function bibleRef(version: string, bookId: string, chapter: string, verse: string): BibleRef {
  return {
    versionId: Number(version),
    bookId: Number(bookId),
    chapter: Number(chapter),
    verse: Number(verse),
  };
}

function canonRef(bookId: string, chapter: string, verse: string): CanonRef {
  return { bookId: Number(bookId), chapter: Number(chapter), verse: Number(verse) };
}
