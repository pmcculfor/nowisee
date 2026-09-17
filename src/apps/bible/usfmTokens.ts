export type UsfmToken = {
  readonly bookId: string;
  readonly chapter: number;
  readonly verse: number;
  readonly position: number;
  readonly strongs: string;
  readonly english: string;
};

export type UsfmSpan = {
  readonly english: string;
  readonly strongs: readonly string[];
};

/** Normalize a Strong's id to `H123` / `G25`. Drops `:a` morphology suffixes. */
export function normalizeStrongsId(raw: string): string | null {
  const match = /^([HG])0*(\d+)/i.exec(raw.trim());
  if (!match) {
    return null;
  }
  return `${match[1]!.toUpperCase()}${Number(match[2])}`;
}

export function parseStrongsAttr(value: string): string[] {
  const ids: string[] = [];
  for (const part of value.split(",")) {
    const id = normalizeStrongsId(part);
    if (id) {
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Walk `\w ...\w*` spans in a verse body. Supplied `\add` and notes are dropped
 * first so they never become tokens.
 */
export function parseUsfmVerseSpans(body: string): UsfmSpan[] {
  const cleaned = body
    .replace(/\\add\s[\s\S]*?\\add\*/g, " ")
    .replace(/\\[fx]\s[\s\S]*?\\[fx]\*/g, " ");
  const spans: UsfmSpan[] = [];
  const word = /\\w\s*([^\\|]*?)(?:\|([^\\]*))?\\w\*/g;
  let match: RegExpExecArray | null;
  while ((match = word.exec(cleaned))) {
    const english = (match[1] ?? "").replace(/\s+/g, " ").trim();
    const attrs = match[2] ?? "";
    const strongMatch = /strong="([^"]*)"/i.exec(attrs);
    const strongs = strongMatch ? parseStrongsAttr(strongMatch[1]!) : parseStrongsAttr(attrs);
    if (strongs.length === 0) {
      continue;
    }
    spans.push({ english, strongs });
  }
  return spans;
}

export function collapseSpans(spans: readonly UsfmSpan[]): Array<{ strongs: string; english: string }> {
  const tokens: Array<{ strongs: string; english: string }> = [];
  for (const span of spans) {
    if (span.strongs.length === 1) {
      const strongs = span.strongs[0]!;
      const last = tokens[tokens.length - 1];
      if (last && last.strongs === strongs) {
        last.english = [last.english, span.english].filter(Boolean).join(" ");
        continue;
      }
      tokens.push({ strongs, english: span.english });
      continue;
    }
    span.strongs.forEach((strongs, index) => {
      tokens.push({ strongs, english: index === 0 ? span.english : "" });
    });
  }
  return tokens;
}

export function parseUsfmBook(text: string, fallbackBookId?: string): UsfmToken[] {
  const idMatch = /\\id\s+(\S+)/.exec(text);
  const bookId = (idMatch?.[1] ?? fallbackBookId ?? "").toUpperCase();
  if (!bookId) {
    return [];
  }
  const tokens: UsfmToken[] = [];
  let chapter = 0;
  const lines = text.split(/\r?\n/);
  let verse = 0;
  let body = "";

  const flush = () => {
    if (chapter < 1 || verse < 1) {
      return;
    }
    collapseSpans(parseUsfmVerseSpans(body)).forEach((token, position) => {
      tokens.push({ bookId, chapter, verse, position, strongs: token.strongs, english: token.english });
    });
  };

  for (const line of lines) {
    const chapterMatch = /^\\c\s+(\d+)/.exec(line);
    if (chapterMatch) {
      flush();
      chapter = Number(chapterMatch[1]);
      verse = 0;
      body = "";
      continue;
    }
    const verseMatch = /^\\v\s+(\d+)\s*(.*)$/.exec(line);
    if (verseMatch) {
      flush();
      verse = Number(verseMatch[1]);
      body = verseMatch[2] ?? "";
      continue;
    }
    if (verse >= 1) {
      body += ` ${line}`;
    }
  }
  flush();
  return tokens;
}

export function parseStrongsTsv(text: string): UsfmToken[] {
  const tokens: UsfmToken[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) {
      continue;
    }
    const parts = line.split("\t");
    if (parts.length < 6) {
      continue;
    }
    const bookId = parts[0]!.toUpperCase();
    const chapter = Number(parts[1]);
    const verse = Number(parts[2]);
    const position = Number(parts[3]);
    const strongs = normalizeStrongsId(parts[4] ?? "");
    if (!strongs || !Number.isInteger(chapter) || !Number.isInteger(verse) || !Number.isInteger(position)) {
      continue;
    }
    tokens.push({
      bookId,
      chapter,
      verse,
      position,
      strongs,
      english: parts.slice(5).join("\t"),
    });
  }
  return tokens;
}

export function formatStrongsTsv(tokens: readonly UsfmToken[]): string {
  return tokens
    .map((row) => `${row.bookId}\t${row.chapter}\t${row.verse}\t${row.position}\t${row.strongs}\t${row.english}`)
    .join("\n");
}
