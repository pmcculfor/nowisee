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

/**
 * TSK dumps store a short keyword. Print TSK's heading is the KJV clause
 * from that keyword through the next TSK keyword. No PD dump has those
 * clauses as a column; recover them from verse text.
 */
export function expandTskHeadings(verseText: string, headings: readonly string[]): string[] {
  const lower = verseText.toLowerCase();
  const starts: number[] = [];
  let cursor = 0;
  for (const heading of headings) {
    const needle = heading.trim().toLowerCase();
    if (!needle) {
      starts.push(-1);
      continue;
    }
    const at = lower.indexOf(needle, cursor);
    if (at < 0) {
      starts.push(-1);
      continue;
    }
    starts.push(at);
    cursor = at + needle.length;
  }
  return headings.map((heading, index) => {
    const start = starts[index]!;
    if (start < 0) {
      return heading;
    }
    const from = index === 0 ? 0 : start;
    let end = verseText.length;
    for (let next = index + 1; next < starts.length; next++) {
      if (starts[next]! >= 0) {
        end = starts[next]!;
        break;
      }
    }
    const expanded = verseText.slice(from, end).replace(/\s+/g, " ").trim();
    return expanded || heading;
  });
}
