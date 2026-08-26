import type { VerseSequence } from "./catalog.ts";
import type { BibleRef, CanonRef } from "./types.ts";

export function testamentId(version: string, testament: string): string {
  return `bible:t:${version}:${testament}`;
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

export function searchEmptyId(queryId: string): string {
  return `bible:q:${queryId}:empty`;
}

export function versionsHeadingId(): string {
  return "bible:versions";
}

export function versionPickId(versionId: string): string {
  return `bible:ver:${versionId}`;
}

export function signInId(): string {
  return "bible:signin";
}

export function bookId(version: string, bookId: string): string {
  return `bible:b:${version}:${bookId}`;
}

export function chapterId(version: string, bookId: string, chapter: number): string {
  return `bible:c:${version}:${bookId}:${chapter}`;
}

export function verseNodeId(seq: VerseSequence, ref: CanonRef): string {
  switch (seq.type) {
    case "chapter":
      return `bible:v:${seq.versionId}:${ref.bookId}:${ref.chapter}:${ref.verse}`;
    case "bookmarks":
      return `bible:bm:${ref.bookId}:${ref.chapter}:${ref.verse}`;
    case "search":
      return `bible:q:${seq.queryId}:${ref.bookId}:${ref.chapter}:${ref.verse}`;
  }
}

export function optionId(
  version: string,
  ref: CanonRef,
  option: "copy" | "bookmark" | "versions" | "commentary",
): string {
  return `bible:o:${version}:${ref.bookId}:${ref.chapter}:${ref.verse}:${option}`;
}

export function copyStatusId(version: string, ref: CanonRef): string {
  return `bible:s:${version}:${ref.bookId}:${ref.chapter}:${ref.verse}:copy`;
}

export function bookmarkStatusId(ref: CanonRef): string {
  return `bible:s:${ref.bookId}:${ref.chapter}:${ref.verse}:bookmark`;
}

export function verseVersionPickId(version: string, ref: CanonRef, targetVersionId: string): string {
  return `bible:vp:${version}:${ref.bookId}:${ref.chapter}:${ref.verse}:${targetVersionId}`;
}

export function commentaryListId(version: string, ref: CanonRef): string {
  return `bible:cl:${version}:${ref.bookId}:${ref.chapter}:${ref.verse}`;
}

export function commentaryWorkId(version: string, ref: CanonRef, commentaryId: string): string {
  return `bible:cw:${version}:${ref.bookId}:${ref.chapter}:${ref.verse}:${commentaryId}`;
}

export function commentaryChunkId(
  version: string,
  ref: CanonRef,
  commentaryId: string,
  index: number,
): string {
  return `bible:cs:${version}:${ref.bookId}:${ref.chapter}:${ref.verse}:${commentaryId}:${index}`;
}

export type ParsedNode =
  | { kind: "testament"; version: string; testament: string }
  | { kind: "bookmarks" }
  | { kind: "bookmarks-empty" }
  | { kind: "search" }
  | { kind: "search-input" }
  | { kind: "search-working" }
  | { kind: "search-empty"; queryId: string }
  | { kind: "versions-heading" }
  | { kind: "version-pick"; versionId: string }
  | { kind: "signin" }
  | { kind: "book"; version: string; bookId: string }
  | { kind: "chapter"; version: string; bookId: string; chapter: number }
  | { kind: "verse"; seq: VerseSequence; ref: BibleRef }
  | { kind: "option"; version: string; ref: CanonRef; option: "copy" | "bookmark" | "versions" | "commentary" }
  | { kind: "copy-status"; version: string; ref: CanonRef }
  | { kind: "bookmark-status"; ref: CanonRef }
  | { kind: "verse-version-pick"; version: string; ref: CanonRef; targetVersionId: string }
  | { kind: "commentary-list"; version: string; ref: CanonRef }
  | { kind: "commentary-work"; version: string; ref: CanonRef; commentaryId: string }
  | { kind: "commentary-chunk"; version: string; ref: CanonRef; commentaryId: string; index: number };

const REF = "([^:]+):([^:]+):(\\d+):(\\d+)";
const CANON = "([^:]+):(\\d+):(\\d+)";

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

  const emptyQ = /^bible:q:([^:]+):empty$/.exec(id);
  if (emptyQ) {
    return { kind: "search-empty", queryId: emptyQ[1]! };
  }

  const ver = /^bible:ver:([^:]+)$/.exec(id);
  if (ver) {
    return { kind: "version-pick", versionId: ver[1]! };
  }

  const t = /^bible:t:([^:]+):(.+)$/.exec(id);
  if (t) {
    return { kind: "testament", version: t[1]!, testament: t[2]! };
  }

  const b = /^bible:b:([^:]+):([^:]+)$/.exec(id);
  if (b) {
    return { kind: "book", version: b[1]!, bookId: b[2]! };
  }

  const c = /^bible:c:([^:]+):([^:]+):(\d+)$/.exec(id);
  if (c) {
    return { kind: "chapter", version: c[1]!, bookId: c[2]!, chapter: Number(c[3]) };
  }

  const v = new RegExp(`^bible:v:${REF}$`).exec(id);
  if (v) {
    const ref = bibleRef(v[1]!, v[2]!, v[3]!, v[4]!);
    return {
      kind: "verse",
      seq: { type: "chapter", versionId: ref.version, bookId: ref.bookId, chapter: ref.chapter },
      ref,
    };
  }

  const bm = new RegExp(`^bible:bm:${CANON}$`).exec(id);
  if (bm) {
    return {
      kind: "verse",
      seq: { type: "bookmarks" },
      ref: { version: "", bookId: bm[1]!, chapter: Number(bm[2]), verse: Number(bm[3]) },
    };
  }

  const q = /^bible:q:([^:]+):([^:]+):(\d+):(\d+)$/.exec(id);
  if (q) {
    return {
      kind: "verse",
      seq: { type: "search", queryId: q[1]! },
      ref: { version: "", bookId: q[2]!, chapter: Number(q[3]), verse: Number(q[4]) },
    };
  }

  const o = new RegExp(`^bible:o:${REF}:(copy|bookmark|versions|commentary)$`).exec(id);
  if (o) {
    return {
      kind: "option",
      version: o[1]!,
      ref: canonRef(o[2]!, o[3]!, o[4]!),
      option: o[5] as "copy" | "bookmark" | "versions" | "commentary",
    };
  }

  const s = new RegExp(`^bible:s:${REF}:copy$`).exec(id);
  if (s) {
    return { kind: "copy-status", version: s[1]!, ref: canonRef(s[2]!, s[3]!, s[4]!) };
  }

  const bs = new RegExp(`^bible:s:${CANON}:bookmark$`).exec(id);
  if (bs) {
    return { kind: "bookmark-status", ref: canonRef(bs[1]!, bs[2]!, bs[3]!) };
  }

  const vp = new RegExp(`^bible:vp:${REF}:([^:]+)$`).exec(id);
  if (vp) {
    return {
      kind: "verse-version-pick",
      version: vp[1]!,
      ref: canonRef(vp[2]!, vp[3]!, vp[4]!),
      targetVersionId: vp[5]!,
    };
  }

  const cl = new RegExp(`^bible:cl:${REF}$`).exec(id);
  if (cl) {
    return { kind: "commentary-list", version: cl[1]!, ref: canonRef(cl[2]!, cl[3]!, cl[4]!) };
  }

  const cw = new RegExp(`^bible:cw:${REF}:([^:]+)$`).exec(id);
  if (cw) {
    return {
      kind: "commentary-work",
      version: cw[1]!,
      ref: canonRef(cw[2]!, cw[3]!, cw[4]!),
      commentaryId: cw[5]!,
    };
  }

  const cs = new RegExp(`^bible:cs:${REF}:([^:]+):(\\d+)$`).exec(id);
  if (cs) {
    return {
      kind: "commentary-chunk",
      version: cs[1]!,
      ref: canonRef(cs[2]!, cs[3]!, cs[4]!),
      commentaryId: cs[5]!,
      index: Number(cs[6]),
    };
  }

  return null;
}

function bibleRef(version: string, bookId: string, chapter: string, verse: string): BibleRef {
  return { version, bookId, chapter: Number(chapter), verse: Number(verse) };
}

function canonRef(bookId: string, chapter: string, verse: string): CanonRef {
  return { bookId, chapter: Number(chapter), verse: Number(verse) };
}
