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
  DICTIONARY_RECORDS,
  VERSION_RECORDS,
  XREF_RECORDS,
  canonBookBySort,
  catalogCommentaryId,
  catalogDictionaryWorkId,
  catalogVersionId,
  catalogXrefWorkId,
  getCanonBook,
  resolveBookToken,
  type CommentaryRecord,
  type VersionRecord,
} from "./catalog.ts";
import { expandTskHeadings, parseTskCitationRanges } from "./tskCitations.ts";
import { parseHebrewStrongXml, parseStrongsGreekXml } from "./strongsXml.ts";
import { parseStrongsTsv, type UsfmToken } from "./usfmTokens.ts";
import type {
  BibleSeed,
  BibleSeedDictionaryEntry,
  BibleSeedSection,
  BibleSeedToken,
  BibleSeedVerse,
  BibleSeedXrefPhrase,
} from "./types.ts";
import type { Db } from "../../node-kit/sqlite.ts";

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
    "INSERT INTO version (id, label, abbreviation, sort_order, license) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET label = excluded.label, abbreviation = excluded.abbreviation, sort_order = excluded.sort_order, license = excluded.license",
  );
  const insertCommentary = db.prepare(
    "INSERT INTO commentary (id, label, sort_order) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET label = excluded.label, sort_order = excluded.sort_order",
  );

  const insertXrefWork = db.prepare(
    "INSERT INTO xref_work (id, label, sort_order) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET label = excluded.label, sort_order = excluded.sort_order",
  );
  const insertDictionaryWork = db.prepare(
    "INSERT INTO dictionary_work (id, label, sort_order) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET label = excluded.label, sort_order = excluded.sort_order",
  );

  db.transaction(() => {
    for (const book of CANON_BOOKS) {
      insertBook.run(book.sort, book.label, book.testament, book.sort);
    }
    for (const version of VERSION_RECORDS) {
      insertVersion.run(
        catalogVersionId(version),
        version.label,
        version.abbreviation,
        version.sortOrder,
        version.license,
      );
    }
    for (const commentary of COMMENTARY_RECORDS) {
      insertCommentary.run(catalogCommentaryId(commentary), commentary.label, commentary.sortOrder);
    }
    for (const work of XREF_RECORDS) {
      insertXrefWork.run(catalogXrefWorkId(work), work.label, work.sortOrder);
    }
    for (const work of DICTIONARY_RECORDS) {
      insertDictionaryWork.run(catalogDictionaryWorkId(work), work.label, work.sortOrder);
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
    for (const entry of seed.dictionaryEntries ?? []) {
      insertSeedDictionaryEntry(db, entry);
    }
    for (const phrase of seed.xrefPhrases ?? []) {
      insertSeedXrefPhrase(db, phrase);
    }
    for (const token of seed.tokens ?? []) {
      insertSeedToken(db, token);
    }
    expandXrefHeadings(db);
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
    const verses = parseVpl(requireUtf8(path, `version ${version.id}`));
    if (verses.length === 0) {
      throw new Error(`Bible import: empty version ${version.id} (${path})`);
    }
    db.transaction(() => insertVerses(db, verses.map(toSeedVerse(version))));
  }
  for (const commentary of COMMENTARY_RECORDS) {
    const commentaryId = catalogCommentaryId(commentary);
    if (hasSections(db, commentaryId)) {
      continue;
    }
    const source = join(commentariesDir, commentary.sourcePath);
    if (!existsSync(source)) {
      throw new Error(`Bible import: missing commentary ${commentary.id} (${source})`);
    }
    db.transaction(() => importCommentary(db, commentary, source));
    if (!hasSections(db, commentaryId)) {
      throw new Error(`Bible import: empty commentary ${commentary.id} (${source})`);
    }
  }
  importXrefWorks(db, commentariesDir);
  importDictionaryWorks(db, rawDir);
  importVerseTokens(db, rawDir);
}

function requireUtf8(path: string, what: string): string {
  if (!existsSync(path)) {
    throw new Error(`Bible import: missing ${what} (${path})`);
  }
  return readFileSync(path, "utf8");
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
  const versionByCatalogId = new Map(
    VERSION_RECORDS.map((record) => [record.id, catalogVersionId(record)]),
  );

  for (const row of verses) {
    const canon = getCanonBook(row.bookId);
    const versionId = versionByCatalogId.get(row.versionId);
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
  });
}

function insertSeedXrefPhrase(db: Db, row: BibleSeedXrefPhrase): void {
  const record = XREF_RECORDS.find((item) => item.id === row.workId);
  const canon = getCanonBook(row.bookId);
  if (!record || !canon) {
    return;
  }
  const slots = new SlotWriter(db);
  const verseId = slots.ensure(canon.sort, row.chapter, row.verse);
  insertXrefPhrase(db, catalogXrefWorkId(record), verseId, row.sort, row.phrase, row.refs);
}

function insertSeedDictionaryEntry(db: Db, row: BibleSeedDictionaryEntry): void {
  const record = DICTIONARY_RECORDS.find((item) => item.id === row.workId);
  if (!record) {
    return;
  }
  db.run(
    "INSERT OR IGNORE INTO dictionary_entry (dictionary_work_id, strongs, lemma, translit, body) VALUES (?, ?, ?, ?, ?)",
    catalogDictionaryWorkId(record),
    row.strongs,
    row.lemma,
    row.translit,
    row.body,
  );
}

function insertSeedToken(db: Db, row: BibleSeedToken): void {
  const canon = getCanonBook(row.bookId);
  if (!canon) {
    return;
  }
  const slots = new SlotWriter(db);
  const verseId = slots.ensure(canon.sort, row.chapter, row.verse);
  db.run(
    "INSERT OR IGNORE INTO verse_token (verse_id, position, strongs, english) VALUES (?, ?, ?, ?)",
    verseId,
    row.position,
    row.strongs,
    row.english,
  );
}

function importCommentary(db: Db, record: CommentaryRecord, source: string): void {
  if (record.format === "helloao-chapter-json") {
    importHelloAo(db, catalogCommentaryId(record), source);
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

function importXrefWorks(db: Db, commentariesDir: string): void {
  for (const record of XREF_RECORDS) {
    const workId = catalogXrefWorkId(record);
    if (hasXrefPhrases(db, workId)) {
      continue;
    }
    const source = join(commentariesDir, record.sourcePath);
    const text = requireUtf8(source, `xref ${record.id}`);
    db.transaction(() => importTskXref(db, workId, text));
    if (!hasXrefPhrases(db, workId)) {
      throw new Error(`Bible import: empty xref ${record.id} (${source})`);
    }
  }
  db.transaction(() => expandXrefHeadings(db));
}

function importTskXref(db: Db, workId: number, text: string): void {
  const slots = new SlotWriter(db);
  for (const row of parseTsk(text)) {
    const canon = getCanonBook(row.bookId);
    if (!canon) {
      continue;
    }
    const verseId = slots.ensure(canon.sort, row.chapter, row.verse);
    insertXrefPhrase(db, workId, verseId, row.sort, row.phrase, row.refs);
  }
}

function insertXrefPhrase(
  db: Db,
  workId: number,
  verseId: number,
  sort: number,
  phrase: string,
  refs: string,
): void {
  const result = db.run(
    "INSERT INTO xref_phrase (xref_work_id, verse_id, sort_order, phrase) VALUES (?, ?, ?, ?)",
    workId,
    verseId,
    sort,
    phrase,
  );
  const phraseId = Number(result.lastInsertRowid);
  const insertRef = db.prepare(
    "INSERT OR IGNORE INTO xref_ref (phrase_id, sort_order, verse_id) VALUES (?, ?, ?)",
  );
  let order = 0;
  for (const range of parseTskCitationRanges(refs)) {
    const canon = getCanonBook(range.bookId);
    if (!canon) {
      continue;
    }
    const targets = db.all<{ id: number }>(
      `SELECT v.id
       FROM verse v
       JOIN chapter c ON c.id = v.chapter_id
       JOIN book b ON b.id = c.book_id
       WHERE b.sort_order = ?
         AND (c.number, v.number) >= (?, ?)
         AND (c.number, v.number) <= (?, ?)
       ORDER BY c.number ASC, v.number ASC`,
      canon.sort,
      range.startChapter,
      range.startVerse,
      range.endChapter,
      range.endVerse,
    );
    for (const target of targets) {
      insertRef.run(phraseId, order, target.id);
      order += 1;
    }
  }
}

function importDictionaryWorks(db: Db, rawDir: string): void {
  for (const record of DICTIONARY_RECORDS) {
    const workId = catalogDictionaryWorkId(record);
    if (hasDictionaryEntries(db, workId)) {
      continue;
    }
    const greekPath = join(rawDir, record.greekPath);
    const hebrewPath = join(rawDir, record.hebrewPath);
    const greek = parseStrongsGreekXml(requireUtf8(greekPath, `dictionary ${record.id} Greek`));
    const hebrew = parseHebrewStrongXml(requireUtf8(hebrewPath, `dictionary ${record.id} Hebrew`));
    if (greek.length === 0) {
      throw new Error(`Bible import: empty dictionary ${record.id} Greek (${greekPath})`);
    }
    if (hebrew.length === 0) {
      throw new Error(`Bible import: empty dictionary ${record.id} Hebrew (${hebrewPath})`);
    }
    const entries = [...greek, ...hebrew];
    const insert = db.prepare(
      "INSERT OR IGNORE INTO dictionary_entry (dictionary_work_id, strongs, lemma, translit, body) VALUES (?, ?, ?, ?, ?)",
    );
    db.transaction(() => {
      for (const entry of entries) {
        insert.run(workId, entry.strongs, entry.lemma, entry.translit, entry.body);
      }
    });
  }
}

function expandXrefHeadings(db: Db): void {
  const kjv = VERSION_RECORDS.find((row) => row.id === "kjv");
  if (!kjv) {
    return;
  }
  const kjvId = catalogVersionId(kjv);
  const groups = db.all<{ workId: number; verseId: number }>(
    "SELECT DISTINCT xref_work_id AS workId, verse_id AS verseId FROM xref_phrase",
  );
  if (groups.length === 0) {
    return;
  }
  const update = db.prepare("UPDATE xref_phrase SET phrase = ? WHERE id = ?");
  for (const group of groups) {
    const text = db.get<{ text: string }>(
      "SELECT text FROM verse_text WHERE version_id = ? AND verse_id = ?",
      kjvId,
      group.verseId,
    )?.text;
    if (!text) {
      continue;
    }
    const rows = db.all<{ id: number; phrase: string }>(
      `SELECT id, phrase FROM xref_phrase
       WHERE xref_work_id = ? AND verse_id = ?
       ORDER BY sort_order ASC, id ASC`,
      group.workId,
      group.verseId,
    );
    const expanded = expandTskHeadings(
      text,
      rows.map((row) => row.phrase),
    );
    for (const [index, row] of rows.entries()) {
      const next = expanded[index];
      if (next && next !== row.phrase) {
        update.run(next, row.id);
      }
    }
  }
}

function importVerseTokens(db: Db, rawDir: string): void {
  if (hasTokens(db)) {
    return;
  }
  const tokenPath = join(rawDir, "alignments", "kjv_strongs.tsv");
  const tokens = parseStrongsTsv(requireUtf8(tokenPath, "KJV Strong's tokens"));
  if (tokens.length === 0) {
    throw new Error(`Bible import: empty KJV Strong's tokens (${tokenPath})`);
  }
  db.transaction(() => importTokens(db, tokens));
  if (!hasTokens(db)) {
    throw new Error(`Bible import: no verse tokens loaded from ${tokenPath}`);
  }
}

function importTokens(db: Db, tokens: readonly UsfmToken[]): void {
  const slots = new SlotWriter(db);
  const known = new Set(
    db.all<{ strongs: string }>("SELECT strongs FROM dictionary_entry").map((row) => row.strongs),
  );
  const insert = db.prepare(
    "INSERT OR IGNORE INTO verse_token (verse_id, position, strongs, english) VALUES (?, ?, ?, ?)",
  );
  for (const token of tokens) {
    if (known.size > 0 && !known.has(token.strongs)) {
      continue;
    }
    const canon = getCanonBook(token.bookId);
    if (!canon) {
      continue;
    }
    const verseId = slots.ensure(canon.sort, token.chapter, token.verse);
    insert.run(verseId, token.position, token.strongs, token.english);
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

function hasXrefPhrases(db: Db, workId: number): boolean {
  return Boolean(db.get("SELECT 1 FROM xref_phrase WHERE xref_work_id = ? LIMIT 1", workId));
}

function hasDictionaryEntries(db: Db, workId: number): boolean {
  return Boolean(
    db.get("SELECT 1 FROM dictionary_entry WHERE dictionary_work_id = ? LIMIT 1", workId),
  );
}

function hasTokens(db: Db): boolean {
  return Boolean(db.get("SELECT 1 FROM verse_token LIMIT 1"));
}
