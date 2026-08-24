/**
 * Idempotent catalog + corpus import. Node-only (fs). Tests pass a tiny seed
 * and never load the full files under raw/.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANON_BOOKS,
  COMMENTARY_RECORDS,
  VERSION_RECORDS,
  canonBookBySort,
  getCanonBook,
  resolveBookToken,
  verseOrd,
  type CommentaryRecord,
  type VersionRecord,
} from "./catalog.ts";
import { tokenize } from "./search.ts";
import type { BibleSeed, BibleSeedSection, BibleSeedVerse } from "./types.ts";
import type { Db } from "../../../server/sqlite.ts";

const DEFAULT_RAW_DIR = join(dirname(fileURLToPath(import.meta.url)), "data", "raw");

export type EnsureCatalogOptions = {
  readonly seed?: BibleSeed;
  readonly rawDir?: string;
};

export type ParsedVplVerse = {
  readonly bookId: string;
  readonly chapter: number;
  readonly verse: number;
  readonly text: string;
};

export function ensureCatalog(db: Db, options: EnsureCatalogOptions = {}): void {
  upsertDescriptors(db);
  if (options.seed) {
    seedFixture(db, options.seed);
    return;
  }
  importRaw(db, options.rawDir ?? DEFAULT_RAW_DIR);
}

function upsertDescriptors(db: Db): void {
  const insertCanon = db.prepare(
    "INSERT INTO canon_books (id, label, testament, sort_order, aliases) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET label = excluded.label, testament = excluded.testament, sort_order = excluded.sort_order, aliases = excluded.aliases",
  );
  const insertVersion = db.prepare(
    "INSERT INTO versions (id, label, sort_order, license) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET label = excluded.label, sort_order = excluded.sort_order, license = excluded.license",
  );
  const insertCommentary = db.prepare(
    "INSERT INTO commentaries (id, label, sort_order) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET label = excluded.label, sort_order = excluded.sort_order",
  );

  db.transaction(() => {
    for (const book of CANON_BOOKS) {
      insertCanon.run(
        book.id,
        book.label,
        book.testament,
        book.sort,
        JSON.stringify(book.aliases),
      );
    }
    for (const version of VERSION_RECORDS) {
      insertVersion.run(version.id, version.label, version.sortOrder, version.license);
    }
    for (const commentary of COMMENTARY_RECORDS) {
      insertCommentary.run(commentary.id, commentary.label, commentary.sortOrder);
    }
  });
}

function seedFixture(db: Db, seed: BibleSeed): void {
  if (db.get<{ n: number }>("SELECT COUNT(*) AS n FROM verses")?.n) {
    return;
  }
  db.transaction(() => {
    insertVerses(db, seed.verses);
    for (const section of seed.sections ?? []) {
      insertSeedSection(db, section);
    }
  });
}

function importRaw(db: Db, rawDir: string): void {
  const biblesDir = join(rawDir, "bibles");
  const commentariesDir = join(rawDir, "commentaries");
  for (const version of VERSION_RECORDS) {
    if (hasVerses(db, version.id)) {
      continue;
    }
    const path = join(biblesDir, version.vplPath);
    if (!existsSync(path)) {
      continue;
    }
    const verses = parseVpl(readFileSync(path, "utf8"));
    db.transaction(() => insertVerses(db, verses.map(toSeedVerse(version))));
  }
  for (const commentary of COMMENTARY_RECORDS) {
    if (hasSections(db, commentary.id)) {
      continue;
    }
    const source = join(commentariesDir, commentary.sourcePath);
    if (!existsSync(source)) {
      continue;
    }
    db.transaction(() => importCommentary(db, commentary, source));
  }
}

function toSeedVerse(version: VersionRecord) {
  return (row: ParsedVplVerse): BibleSeedVerse => ({
    versionId: version.id,
    bookId: row.bookId,
    chapter: row.chapter,
    verse: row.verse,
    text: row.text,
  });
}

export function parseVpl(text: string): ParsedVplVerse[] {
  const verses: ParsedVplVerse[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) {
      continue;
    }
    const match = /^(\S+)\s+(\d+):(\d+)\s+(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const book = resolveBookToken(match[1]!);
    if (!book) {
      continue;
    }
    verses.push({
      bookId: book.id,
      chapter: Number(match[2]),
      verse: Number(match[3]),
      text: stripSuppliedWordBrackets(match[4]!),
    });
  }
  return verses;
}

/** Keep supplied words; drop only the brackets around them. */
export function stripSuppliedWordBrackets(text: string): string {
  return text.replace(/\[([^\]]*)\]/g, "$1");
}

function insertVerses(db: Db, verses: readonly BibleSeedVerse[]): void {
  const ensureBook = db.prepare("INSERT OR IGNORE INTO books (version_id, book_id, name) VALUES (?, ?, ?)");
  const insertVerse = db.prepare(
    "INSERT OR IGNORE INTO verses (version_id, book_id, chapter, verse, verse_ord, text) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertWord = db.prepare(
    "INSERT OR IGNORE INTO verse_words (version_id, word, book_id, chapter, verse, verse_ord) VALUES (?, ?, ?, ?, ?, ?)",
  );

  for (const row of verses) {
    const canon = getCanonBook(row.bookId);
    if (!canon) {
      continue;
    }
    ensureBook.run(row.versionId, row.bookId, canon.label);
    const ord = verseOrd(canon.sort, row.chapter, row.verse);
    insertVerse.run(row.versionId, row.bookId, row.chapter, row.verse, ord, row.text);
    for (const word of tokenize(row.text)) {
      insertWord.run(row.versionId, word, row.bookId, row.chapter, row.verse, ord);
    }
  }
}

function insertSeedSection(db: Db, section: BibleSeedSection): void {
  const canon = getCanonBook(section.bookId);
  if (!canon) {
    return;
  }
  const start = verseOrd(canon.sort, section.startChapter, section.startVerse);
  const end = verseOrd(canon.sort, section.endChapter, section.endVerse);
  insertSection(db, {
    commentaryId: section.commentaryId,
    bookId: section.bookId,
    chapter: section.startChapter,
    start,
    end,
    body: section.body,
    xrefs: section.xrefs ?? [],
  });
}

function importCommentary(db: Db, record: CommentaryRecord, source: string): void {
  if (record.format === "helloao-chapter-json") {
    importHelloAo(db, record.id, source);
    return;
  }
  if (record.format === "tsk-xref-table") {
    importTsk(db, record.id, readFileSync(source, "utf8"));
  }
}

type HelloAoEntry = {
  readonly number: number;
  readonly text: string;
};

export function parseHelloAoChapter(json: unknown): { chapter: number; entries: HelloAoEntry[] } | null {
  if (!json || typeof json !== "object") {
    return null;
  }
  const root = json as { chapter?: { number?: unknown; content?: unknown } };
  const chapterNum = Number(root.chapter?.number);
  if (!Number.isInteger(chapterNum) || chapterNum < 1) {
    return null;
  }
  const content = root.chapter?.content;
  if (!Array.isArray(content)) {
    return { chapter: chapterNum, entries: [] };
  }
  const entries: HelloAoEntry[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as { type?: unknown; number?: unknown; content?: unknown };
    const number = Number(row.number);
    if (!Number.isInteger(number) || number < 1) {
      continue;
    }
    const text = flattenText(row.content).trim();
    if (!text) {
      continue;
    }
    entries.push({ number, text });
  }
  entries.sort((a, b) => a.number - b.number);
  return { chapter: chapterNum, entries };
}

function importHelloAo(db: Db, commentaryId: string, dir: string): void {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (!name.isDirectory()) {
      continue;
    }
    const book = resolveBookToken(name.name);
    if (!book) {
      continue;
    }
    const bookDir = join(dir, name.name);
    for (const file of readdirSync(bookDir)) {
      if (!file.endsWith(".json")) {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(join(bookDir, file), "utf8"));
      } catch {
        continue;
      }
      const chapter = parseHelloAoChapter(parsed);
      if (!chapter || chapter.entries.length === 0) {
        continue;
      }
      const lastVerse = chapterLastVerse(db, book.id, chapter.chapter);
      for (let i = 0; i < chapter.entries.length; i++) {
        const entry = chapter.entries[i]!;
        const next = chapter.entries[i + 1];
        const endVerse = next ? next.number - 1 : lastVerse;
        const end = Math.max(entry.number, endVerse);
        insertSection(db, {
          commentaryId,
          bookId: book.id,
          chapter: chapter.chapter,
          start: verseOrd(book.sort, chapter.chapter, entry.number),
          end: verseOrd(book.sort, chapter.chapter, end),
          body: entry.text,
          xrefs: [],
        });
      }
    }
  }
}

export type ParsedTskRow = {
  readonly bookId: string;
  readonly chapter: number;
  readonly verse: number;
  readonly sort: number;
  readonly phrase: string;
  readonly refs: string;
};

export function parseTsk(text: string): ParsedTskRow[] {
  const rows: ParsedTskRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) {
      continue;
    }
    const parts = line.split("\t");
    if (parts.length < 6) {
      continue;
    }
    const book = canonBookBySort(Number(parts[0]));
    const chapter = Number(parts[1]);
    const verse = Number(parts[2]);
    const sort = Number(parts[3]);
    if (!book || !Number.isInteger(chapter) || !Number.isInteger(verse)) {
      continue;
    }
    rows.push({
      bookId: book.id,
      chapter,
      verse,
      sort: Number.isInteger(sort) ? sort : 0,
      phrase: parts[4] ?? "",
      refs: parts.slice(5).join("\t"),
    });
  }
  return rows;
}

function importTsk(db: Db, commentaryId: string, text: string): void {
  const grouped = new Map<string, ParsedTskRow[]>();
  for (const row of parseTsk(text)) {
    const key = `${row.bookId}:${row.chapter}:${row.verse}`;
    const list = grouped.get(key);
    if (list) {
      list.push(row);
    } else {
      grouped.set(key, [row]);
    }
  }
  for (const group of grouped.values()) {
    group.sort((a, b) => a.sort - b.sort);
    const first = group[0]!;
    const canon = getCanonBook(first.bookId);
    if (!canon) {
      continue;
    }
    const body = group
      .map((row) => (row.refs ? `${row.phrase}: ${row.refs}` : row.phrase))
      .filter(Boolean)
      .join("\n");
    const ord = verseOrd(canon.sort, first.chapter, first.verse);
    insertSection(db, {
      commentaryId,
      bookId: first.bookId,
      chapter: first.chapter,
      start: ord,
      end: ord,
      body,
      xrefs: group.map((row) => row.refs).filter(Boolean),
    });
  }
}

function insertSection(
  db: Db,
  section: {
    commentaryId: string;
    bookId: string;
    chapter: number;
    start: number;
    end: number;
    body: string;
    xrefs: readonly string[];
  },
): void {
  const result = db.run(
    "INSERT INTO commentary_sections (commentary_id, start_ord, end_ord, body) VALUES (?, ?, ?, ?)",
    section.commentaryId,
    section.start,
    section.end,
    section.body,
  );
  const sectionId = Number(result.lastInsertRowid);
  db.run(
    "INSERT OR IGNORE INTO commentary_coverage (commentary_id, book_id, chapter) VALUES (?, ?, ?)",
    section.commentaryId,
    section.bookId,
    section.chapter,
  );
  const insertXref = db.prepare(
    "INSERT INTO commentary_xrefs (section_id, sort_order, refs) VALUES (?, ?, ?)",
  );
  for (const [index, refs] of section.xrefs.entries()) {
    insertXref.run(sectionId, index, refs);
  }
}

function flattenText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(flattenText).filter(Boolean).join("\n\n");
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") {
      return record.text;
    }
    if ("content" in record) {
      return flattenText(record.content);
    }
  }
  return "";
}

function chapterLastVerse(db: Db, bookId: string, chapter: number): number {
  const row = db.get<{ n: number }>(
    "SELECT COALESCE(MAX(verse), 0) AS n FROM verses WHERE book_id = ? AND chapter = ?",
    bookId,
    chapter,
  );
  return row?.n && row.n > 0 ? row.n : 1;
}

function hasVerses(db: Db, versionId: string): boolean {
  return Boolean(db.get("SELECT 1 FROM verses WHERE version_id = ? LIMIT 1", versionId));
}

function hasSections(db: Db, commentaryId: string): boolean {
  return Boolean(
    db.get("SELECT 1 FROM commentary_sections WHERE commentary_id = ? LIMIT 1", commentaryId),
  );
}
