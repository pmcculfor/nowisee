import type { BibleRef, TestamentId } from "./types.ts";

export function testamentId(testament: TestamentId): string {
  return `bible:t:${testament}`;
}

export function bookId(book: string): string {
  return `bible:b:${book}`;
}

export function chapterId(book: string, chapter: number): string {
  return `bible:c:${book}:${chapter}`;
}

export function verseId(ref: BibleRef): string {
  return `bible:v:${ref.book}:${ref.chapter}:${ref.verse}`;
}

export function optionId(ref: BibleRef, option: "copy" | "commentary"): string {
  return `bible:o:${ref.book}:${ref.chapter}:${ref.verse}:${option}`;
}

export function copyStatusId(ref: BibleRef): string {
  return `bible:s:${ref.book}:${ref.chapter}:${ref.verse}:copy`;
}

export function commentaryId(ref: BibleRef): string {
  return `bible:n:${ref.book}:${ref.chapter}:${ref.verse}:commentary`;
}

export type ParsedNode =
  | { kind: "testament"; testament: TestamentId }
  | { kind: "book"; book: string }
  | { kind: "chapter"; book: string; chapter: number }
  | { kind: "verse"; ref: BibleRef }
  | { kind: "option"; ref: BibleRef; option: "copy" | "commentary" }
  | { kind: "copy-status"; ref: BibleRef }
  | { kind: "commentary"; ref: BibleRef };

export function parseNodeId(id: string): ParsedNode | null {
  const t = /^bible:t:(OT|NT)$/.exec(id);
  if (t) {
    return { kind: "testament", testament: t[1] as TestamentId };
  }
  const b = /^bible:b:(.+)$/.exec(id);
  if (b) {
    return { kind: "book", book: b[1]! };
  }
  const c = /^bible:c:(.+):(\d+)$/.exec(id);
  if (c) {
    return { kind: "chapter", book: c[1]!, chapter: Number(c[2]) };
  }
  const v = /^bible:v:(.+):(\d+):(\d+)$/.exec(id);
  if (v) {
    return {
      kind: "verse",
      ref: { book: v[1]!, chapter: Number(v[2]), verse: Number(v[3]) },
    };
  }
  const o = /^bible:o:(.+):(\d+):(\d+):(copy|commentary)$/.exec(id);
  if (o) {
    return {
      kind: "option",
      ref: { book: o[1]!, chapter: Number(o[2]), verse: Number(o[3]) },
      option: o[4] as "copy" | "commentary",
    };
  }
  const s = /^bible:s:(.+):(\d+):(\d+):copy$/.exec(id);
  if (s) {
    return {
      kind: "copy-status",
      ref: { book: s[1]!, chapter: Number(s[2]), verse: Number(s[3]) },
    };
  }
  const n = /^bible:n:(.+):(\d+):(\d+):commentary$/.exec(id);
  if (n) {
    return {
      kind: "commentary",
      ref: { book: n[1]!, chapter: Number(n[2]), verse: Number(n[3]) },
    };
  }
  return null;
}
