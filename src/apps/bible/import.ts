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
  catalogCommentaryId,
  catalogVersionId,
  getCanonBook,
  resolveBookToken,
  type CommentaryRecord,
  type VersionRecord,
} from "./catalog.ts";
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
  const insertBook = db.prepare(
    "INSERT INTO book (id, label, testament, sort_order) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET label = excluded.label, testament = excluded.testament, sort_order = excluded.sort_order",
  );
  const insertVersion = db.prepare(
    "INSERT INTO version (id, slug, label, sort_order, license) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET slug = excluded.slug, label = excluded.label, sort_order = excluded.sort_order, license = excluded.license",
  );
  const insertCommentary = db.prepare(
    "INSERT INTO commentary (id, label, sort_order) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET label = excluded.label, sort_order = excluded.sort_order",
  );

  db.transaction(() => {
    for (const book of CANON_BOOKS) {
      insertBook.run(book.sort, book.label, book.testament, book.sort);
    }
    for (const version of VERSION_RECORDS) {
      insertVersion.run(
        catalogVersionId(version),
        version.id,
        version.label,
        version.sortOrder,
        version.license,
      );
    }
    for (const commentary of COMMENTARY_RECORDS) {
      insertCommentary.run(catalogCommentaryId(commentary), commentary.label, commentary.sortOrder);
    }
  });
}

function seedFixture(db: Db, seed: BibleSeed): void {
  if (db.get<{ n: number }>("SELECT COUNT(*) AS n FROM verse_text")?.n) {
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
    const versionId = catalogVersionId(version);
    if (hasVerseText(db, versionId)) {
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
    const commentaryId = catalogCommentaryId(commentary);
    if (hasSections(db, commentaryId)) {
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
  const slots = new SlotWriter(db);
  const insertText = db.prepare(
    "INSERT OR IGNORE INTO verse_text (version_id, verse_id, text) VALUES (?, ?, ?)",
  );
  const versionBySlug = new Map(
    db.all<{ id: number; slug: string }>("SELECT id, slug FROM version").map((row) => [row.slug, row.id]),
  );

  for (const row of verses) {
    const canon = getCanonBook(row.bookId);
    const versionId = versionBySlug.get(row.versionId);
    if (!canon || versionId === undefined) {
      continue;
    }
    const verseId = slots.ensure(canon.sort, row.chapter, row.verse);
    insertText.run(versionId, verseId, row.text);
  }
}

class SlotWriter {
  private readonly insertChapter: ReturnType<Db["prepare"]>;
  private readonly selectChapter: ReturnType<Db["prepare"]>;
  private readonly insertVerse: ReturnType<Db["prepare"]>;
  private readonly selectVerse: ReturnType<Db["prepare"]>;
  private readonly chapters = new Map<string, number>();
  private readonly verses = new Map<string, number>();

  constructor(db: Db) {
    this.insertChapter = db.prepare("INSERT OR IGNORE INTO chapter (book_id, number) VALUES (?, ?)");
    this.selectChapter = db.prepare("SELECT id FROM chapter WHERE book_id = ? AND number = ?");
    this.insertVerse = db.prepare("INSERT OR IGNORE INTO verse (chapter_id, number) VALUES (?, ?)");
    this.selectVerse = db.prepare("SELECT id FROM verse WHERE chapter_id = ? AND number = ?");
  }

  ensure(bookId: number, chapter: number, verse: number): number {
    const chapterId = this.chapterId(bookId, chapter);
    const key = `${chapterId}:${verse}`;
    const cached = this.verses.get(key);
    if (cached !== undefined) {
      return cached;
    }
    this.insertVerse.run(chapterId, verse);
    const row = this.selectVerse.get<{ id: number }>(chapterId, verse);
    if (!row) {
      throw new Error(`Bible import: missing verse slot ${bookId} ${chapter}:${verse}`);
    }
    this.verses.set(key, row.id);
    return row.id;
  }

  private chapterId(bookId: number, chapter: number): number {
    const key = `${bookId}:${chapter}`;
    const cached = this.chapters.get(key);
    if (cached !== undefined) {
      return cached;
    }
    this.insertChapter.run(bookId, chapter);
    const row = this.selectChapter.get<{ id: number }>(bookId, chapter);
    if (!row) {
      throw new Error(`Bible import: missing chapter ${bookId}:${chapter}`);
    }
    this.chapters.set(key, row.id);
    return row.id;
  }
}

function insertSeedSection(db: Db, section: BibleSeedSection): void {
  const canon = getCanonBook(section.bookId);
  const commentary = COMMENTARY_RECORDS.find((row) => row.id === section.commentaryId);
  if (!canon || !commentary) {
    return;
  }
  const slots = new SlotWriter(db);
  if (section.startChapter === section.endChapter) {
    for (let verse = section.startVerse; verse <= section.endVerse; verse++) {
      slots.ensure(canon.sort, section.startChapter, verse);
    }
  } else {
    slots.ensure(canon.sort, section.startChapter, section.startVerse);
    slots.ensure(canon.sort, section.endChapter, section.endVerse);
  }
  insertSection(db, {
    commentaryId: catalogCommentaryId(commentary),
    start: { sort: canon.sort, chapter: section.startChapter, verse: section.startVerse },
    end: { sort: canon.sort, chapter: section.endChapter, verse: section.endVerse },
    body: section.body,
    xrefs: section.xrefs ?? [],
  });
}

function importCommentary(db: Db, record: CommentaryRecord, source: string): void {
  if (record.format === "helloao-chapter-json") {
    importHelloAo(db, catalogCommentaryId(record), source);
    return;
  }
  if (record.format === "tsk-xref-table") {
    importTsk(db, catalogCommentaryId(record), readFileSync(source, "utf8"));
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

function importHelloAo(db: Db, commentaryId: number, dir: string): void {
  const slots = new SlotWriter(db);
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
      const lastVerse = chapterLastVerse(db, book.sort, chapter.chapter) || 1;
      for (let i = 0; i < chapter.entries.length; i++) {
        const entry = chapter.entries[i]!;
        const next = chapter.entries[i + 1];
        const endVerse = next ? next.number - 1 : lastVerse;
        const end = Math.max(entry.number, endVerse);
        for (let verse = entry.number; verse <= end; verse++) {
          slots.ensure(book.sort, chapter.chapter, verse);
        }
        insertSection(db, {
          commentaryId,
          start: { sort: book.sort, chapter: chapter.chapter, verse: entry.number },
          end: { sort: book.sort, chapter: chapter.chapter, verse: end },
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

function importTsk(db: Db, commentaryId: number, text: string): void {
  const slots = new SlotWriter(db);
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
    slots.ensure(canon.sort, first.chapter, first.verse);
    insertSection(db, {
      commentaryId,
      start: { sort: canon.sort, chapter: first.chapter, verse: first.verse },
      end: { sort: canon.sort, chapter: first.chapter, verse: first.verse },
      body,
      xrefs: group.map((row) => row.refs).filter(Boolean),
    });
  }
}

type CanonPoint = {
  readonly sort: number;
  readonly chapter: number;
  readonly verse: number;
};

function insertSection(
  db: Db,
  section: {
    commentaryId: number;
    start: CanonPoint;
    end: CanonPoint;
    body: string;
    xrefs: readonly string[];
  },
): void {
  const result = db.run(
    "INSERT INTO commentary_section (commentary_id, body) VALUES (?, ?)",
    section.commentaryId,
    section.body,
  );
  const sectionId = Number(result.lastInsertRowid);
  const covered = db.all<{ id: number }>(
    `SELECT v.id
     FROM verse v
     JOIN chapter c ON c.id = v.chapter_id
     JOIN book b ON b.id = c.book_id
     WHERE (b.sort_order, c.number, v.number) >= (?, ?, ?)
       AND (b.sort_order, c.number, v.number) <= (?, ?, ?)`,
    section.start.sort,
    section.start.chapter,
    section.start.verse,
    section.end.sort,
    section.end.chapter,
    section.end.verse,
  );
  const insertCover = db.prepare(
    "INSERT OR IGNORE INTO commentary_section_verse (section_id, verse_id) VALUES (?, ?)",
  );
  for (const row of covered) {
    insertCover.run(sectionId, row.id);
  }
  const insertXref = db.prepare(
    "INSERT INTO commentary_xref (section_id, sort_order, refs) VALUES (?, ?, ?)",
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

function chapterLastVerse(db: Db, bookId: number, chapter: number): number {
  const row = db.get<{ n: number }>(
    `SELECT v.number AS n
     FROM verse v
     JOIN chapter c ON c.id = v.chapter_id
     WHERE c.book_id = ? AND c.number = ?
     ORDER BY v.number DESC
     LIMIT 1`,
    bookId,
    chapter,
  );
  return row?.n ?? 0;
}

function hasVerseText(db: Db, versionId: number): boolean {
  return Boolean(db.get("SELECT 1 FROM verse_text WHERE version_id = ? LIMIT 1", versionId));
}

function hasSections(db: Db, commentaryId: number): boolean {
  return Boolean(
    db.get("SELECT 1 FROM commentary_section WHERE commentary_id = ? LIMIT 1", commentaryId),
  );
}
