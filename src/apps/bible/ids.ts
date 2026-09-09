import { chapterSeq, contextSeq, type VerseSequence } from "./catalog.ts";
import type { CanonRef } from "./types.ts";

export function testamentId(testament: string): string {
  return `bible:t:${testament}`;
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

export function bookId(bookId: number): string {
  return `bible:b:${bookId}`;
}

export function chapterId(bookId: number, chapter: number): string {
  return `bible:c:${bookId}:${chapter}`;
}

export function verseNodeId(seq: VerseSequence, ref: CanonRef): string {
  switch (seq.type) {
    case "chapter":
      return `bible:v:${ref.bookId}:${ref.chapter}:${ref.verse}`;
    case "context":
      return `bible:vx:${ref.bookId}:${ref.chapter}:${ref.verse}`;
    case "bookmarks":
      return `bible:bm:${ref.bookId}:${ref.chapter}:${ref.verse}`;
    case "search":
      return `bible:q:${seq.queryId}:${ref.bookId}:${ref.chapter}:${ref.verse}`;
  }
}

export function optionId(
  ref: CanonRef,
  option: "copy" | "bookmark" | "versions" | "commentary",
  seq: VerseSequence = chapterSeq(ref.bookId, ref.chapter),
): string {
  return `bible:o:${seqPrefix(seq)}:${ref.bookId}:${ref.chapter}:${ref.verse}:${option}`;
}

export function verseVersionPickId(
  ref: CanonRef,
  targetVersionId: number,
  seq: VerseSequence = chapterSeq(ref.bookId, ref.chapter),
): string {
  return `bible:vp:${seqPrefix(seq)}:${ref.bookId}:${ref.chapter}:${ref.verse}:${targetVersionId}`;
}

export function commentaryListId(ref: CanonRef): string {
  return `bible:cl:${ref.bookId}:${ref.chapter}:${ref.verse}`;
}

export function commentaryWorkId(ref: CanonRef, commentaryId: number): string {
  return `bible:cw:${ref.bookId}:${ref.chapter}:${ref.verse}:${commentaryId}`;
}

export function commentaryChunkId(ref: CanonRef, commentaryId: number, index: number): string {
  return `bible:cs:${ref.bookId}:${ref.chapter}:${ref.verse}:${commentaryId}:${index}`;
}

export type ParsedNode =
  | { kind: "testament"; testament: string }
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
  | { kind: "book"; bookId: number }
  | { kind: "chapter"; bookId: number; chapter: number }
  | { kind: "verse"; seq: VerseSequence; ref: CanonRef }
  | {
      kind: "option";
      seq: VerseSequence;
      ref: CanonRef;
      option: "copy" | "bookmark" | "versions" | "commentary";
    }
  | { kind: "verse-version-pick"; seq: VerseSequence; ref: CanonRef; targetVersionId: number }
  | { kind: "commentary-list"; ref: CanonRef }
  | { kind: "commentary-work"; ref: CanonRef; commentaryId: number }
  | { kind: "commentary-chunk"; ref: CanonRef; commentaryId: number; index: number };

const CANON = "(\\d+):(\\d+):(\\d+)";
const SEQ = "(v|vx|bm)";

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

  const t = /^bible:t:(.+)$/.exec(id);
  if (t) {
    return { kind: "testament", testament: t[1]! };
  }

  const b = /^bible:b:(\d+)$/.exec(id);
  if (b) {
    return { kind: "book", bookId: Number(b[1]) };
  }

  const c = /^bible:c:(\d+):(\d+)$/.exec(id);
  if (c) {
    return { kind: "chapter", bookId: Number(c[1]), chapter: Number(c[2]) };
  }

  const v = new RegExp(`^bible:v:${CANON}$`).exec(id);
  if (v) {
    const ref = canonRef(v[1]!, v[2]!, v[3]!);
    return { kind: "verse", seq: chapterSeq(ref.bookId, ref.chapter), ref };
  }

  const vx = new RegExp(`^bible:vx:${CANON}$`).exec(id);
  if (vx) {
    const ref = canonRef(vx[1]!, vx[2]!, vx[3]!);
    return { kind: "verse", seq: contextSeq(ref.bookId, ref.chapter), ref };
  }

  const bm = new RegExp(`^bible:bm:${CANON}$`).exec(id);
  if (bm) {
    return {
      kind: "verse",
      seq: { type: "bookmarks" },
      ref: canonRef(bm[1]!, bm[2]!, bm[3]!),
    };
  }

  const q = /^bible:q:(\d+):(\d+):(\d+):(\d+)$/.exec(id);
  if (q) {
    return {
      kind: "verse",
      seq: { type: "search", queryId: Number(q[1]) },
      ref: canonRef(q[2]!, q[3]!, q[4]!),
    };
  }

  const o = new RegExp(`^bible:o:${SEQ}:${CANON}:(copy|bookmark|versions|commentary)$`).exec(id);
  if (o) {
    const ref = canonRef(o[2]!, o[3]!, o[4]!);
    return {
      kind: "option",
      seq: seqFromPrefix(o[1]!, ref),
      ref,
      option: o[5] as "copy" | "bookmark" | "versions" | "commentary",
    };
  }

  const vp = new RegExp(`^bible:vp:${SEQ}:${CANON}:(\\d+)$`).exec(id);
  if (vp) {
    const ref = canonRef(vp[2]!, vp[3]!, vp[4]!);
    return {
      kind: "verse-version-pick",
      seq: seqFromPrefix(vp[1]!, ref),
      ref,
      targetVersionId: Number(vp[5]),
    };
  }

  const cl = new RegExp(`^bible:cl:${CANON}$`).exec(id);
  if (cl) {
    return { kind: "commentary-list", ref: canonRef(cl[1]!, cl[2]!, cl[3]!) };
  }

  const cw = new RegExp(`^bible:cw:${CANON}:(\\d+)$`).exec(id);
  if (cw) {
    return {
      kind: "commentary-work",
      ref: canonRef(cw[1]!, cw[2]!, cw[3]!),
      commentaryId: Number(cw[4]),
    };
  }

  const cs = new RegExp(`^bible:cs:${CANON}:(\\d+):(\\d+)$`).exec(id);
  if (cs) {
    return {
      kind: "commentary-chunk",
      ref: canonRef(cs[1]!, cs[2]!, cs[3]!),
      commentaryId: Number(cs[4]),
      index: Number(cs[5]),
    };
  }

  return null;
}

function seqPrefix(seq: VerseSequence): "v" | "vx" | "bm" {
  switch (seq.type) {
    case "context":
      return "vx";
    case "bookmarks":
      return "bm";
    default:
      return "v";
  }
}

function seqFromPrefix(prefix: string, ref: CanonRef): VerseSequence {
  if (prefix === "vx") {
    return contextSeq(ref.bookId, ref.chapter);
  }
  if (prefix === "bm") {
    return { type: "bookmarks" };
  }
  return chapterSeq(ref.bookId, ref.chapter);
}

function canonRef(bookId: string, chapter: string, verse: string): CanonRef {
  return { bookId: Number(bookId), chapter: Number(chapter), verse: Number(verse) };
}
