import { tskBookByAbbrev } from "./catalog.ts";

export type TskCitationRange = {
  readonly bookId: string;
  readonly startChapter: number;
  readonly startVerse: number;
  readonly endChapter: number;
  readonly endVerse: number;
};

/**
 * Expand a TSK `reference_list` into inclusive canon ranges.
 * Unknown abbreviations and malformed tokens are skipped.
 */
export function parseTskCitationRanges(refs: string): TskCitationRange[] {
  const out: TskCitationRange[] = [];
  for (const token of refs.split(";")) {
    const trimmed = token.trim();
    if (!trimmed) {
      continue;
    }
    const match = /^([a-z0-9]+)\s+(\d+)[:,](.+)$/i.exec(trimmed);
    if (!match) {
      continue;
    }
    const book = tskBookByAbbrev(match[1]!);
    const chapter = Number(match[2]);
    if (!book || !Number.isInteger(chapter) || chapter < 1) {
      continue;
    }
    for (const part of match[3]!.split(",")) {
      const range = parseVersePart(book.id, chapter, part.trim());
      if (range) {
        out.push(range);
      }
    }
  }
  return out;
}

function parseVersePart(bookId: string, chapter: number, part: string): TskCitationRange | null {
  if (!part) {
    return null;
  }
  const span = /^(\d+)-(\d+):(\d+)$/.exec(part);
  if (span) {
    const startVerse = Number(span[1]);
    const endChapter = Number(span[2]);
    const endVerse = Number(span[3]);
    if (!positive(startVerse) || !positive(endChapter) || !positive(endVerse)) {
      return null;
    }
    return { bookId, startChapter: chapter, startVerse, endChapter, endVerse };
  }
  const verses = /^(\d+)-(\d+)$/.exec(part);
  if (verses) {
    const startVerse = Number(verses[1]);
    const endVerse = Number(verses[2]);
    if (!positive(startVerse) || !positive(endVerse) || startVerse > endVerse) {
      return null;
    }
    return { bookId, startChapter: chapter, startVerse, endChapter: chapter, endVerse };
  }
  const one = /^(\d+)$/.exec(part);
  if (!one) {
    return null;
  }
  const verse = Number(one[1]);
  if (!positive(verse)) {
    return null;
  }
  return { bookId, startChapter: chapter, startVerse: verse, endChapter: chapter, endVerse: verse };
}

function positive(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}
