import { chapterSeq, contextSeq, xrefSeq, type VerseOptionType, type VerseSequence } from "./catalog.ts";
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
    case "xref":
      return `bible:xr:${seq.phraseId}:${ref.bookId}:${ref.chapter}:${ref.verse}`;
  }
}

export function optionId(
  ref: CanonRef,
  option: VerseOptionType,
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

export function xrefEmptyId(ref: CanonRef): string {
  return `bible:xe:${ref.bookId}:${ref.chapter}:${ref.verse}`;
}

export function xrefWorkId(ref: CanonRef, workId: number): string {
  return `bible:xw:${ref.bookId}:${ref.chapter}:${ref.verse}:${workId}`;
}

export function xrefPhraseId(ref: CanonRef, workId: number, phraseId: number): string {
  return `bible:xp:${ref.bookId}:${ref.chapter}:${ref.verse}:${workId}:${phraseId}`;
}

export function dictionaryEmptyId(ref: CanonRef): string {
  return `bible:de:${ref.bookId}:${ref.chapter}:${ref.verse}`;
}

export function dictionaryWorkId(ref: CanonRef, workId: number): string {
  return `bible:dw:${ref.bookId}:${ref.chapter}:${ref.verse}:${workId}`;
}

export function dictionaryWordId(ref: CanonRef, workId: number, position: number): string {
  return `bible:dt:${ref.bookId}:${ref.chapter}:${ref.verse}:${workId}:${position}`;
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
      option: VerseOptionType;
    }
  | { kind: "verse-version-pick"; seq: VerseSequence; ref: CanonRef; targetVersionId: number }
  | { kind: "commentary-list"; ref: CanonRef }
  | { kind: "commentary-work"; ref: CanonRef; commentaryId: number }
  | { kind: "commentary-chunk"; ref: CanonRef; commentaryId: number; index: number }
  | { kind: "xref-empty"; ref: CanonRef }
  | { kind: "xref-work"; ref: CanonRef; workId: number }
  | { kind: "xref-phrase"; ref: CanonRef; workId: number; phraseId: number }
  | { kind: "dictionary-empty"; ref: CanonRef }
  | { kind: "dictionary-work"; ref: CanonRef; workId: number }
  | { kind: "dictionary-word"; ref: CanonRef; workId: number; position: number };

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

  const xr = /^bible:xr:(\d+):(\d+):(\d+):(\d+)$/.exec(id);
  if (xr) {
    return {
      kind: "verse",
      seq: xrefSeq(Number(xr[1])),
      ref: canonRef(xr[2]!, xr[3]!, xr[4]!),
    };
  }

  const o = new RegExp(
    `^bible:o:${SEQ}:${CANON}:(copy|bookmark|versions|commentary|cross-references|dictionaries)$`,
  ).exec(id);
  if (o) {
    const ref = canonRef(o[2]!, o[3]!, o[4]!);
    return {
      kind: "option",
      seq: seqFromPrefix(o[1]!, ref),
      ref,
      option: o[5] as VerseOptionType,
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

  const xe = new RegExp(`^bible:xe:${CANON}$`).exec(id);
  if (xe) {
    return { kind: "xref-empty", ref: canonRef(xe[1]!, xe[2]!, xe[3]!) };
  }

  const xw = new RegExp(`^bible:xw:${CANON}:(\\d+)$`).exec(id);
  if (xw) {
    return {
      kind: "xref-work",
      ref: canonRef(xw[1]!, xw[2]!, xw[3]!),
      workId: Number(xw[4]),
    };
  }

  const xp = new RegExp(`^bible:xp:${CANON}:(\\d+):(\\d+)$`).exec(id);
  if (xp) {
    return {
      kind: "xref-phrase",
      ref: canonRef(xp[1]!, xp[2]!, xp[3]!),
      workId: Number(xp[4]),
      phraseId: Number(xp[5]),
    };
  }

  const de = new RegExp(`^bible:de:${CANON}$`).exec(id);
  if (de) {
    return { kind: "dictionary-empty", ref: canonRef(de[1]!, de[2]!, de[3]!) };
  }

  const dw = new RegExp(`^bible:dw:${CANON}:(\\d+)$`).exec(id);
  if (dw) {
    return {
      kind: "dictionary-work",
      ref: canonRef(dw[1]!, dw[2]!, dw[3]!),
      workId: Number(dw[4]),
    };
  }

  const dt = new RegExp(`^bible:dt:${CANON}:(\\d+):(\\d+)$`).exec(id);
  if (dt) {
    return {
      kind: "dictionary-word",
      ref: canonRef(dt[1]!, dt[2]!, dt[3]!),
      workId: Number(dt[4]),
      position: Number(dt[5]),
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
