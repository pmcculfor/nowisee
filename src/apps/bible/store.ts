import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openSqlite, type Db } from "../../../server/sqlite.ts";
import { createBibleApp, type BibleApp } from "./index.ts";
import {
  TESTAMENT_ORDER,
  type BibleBook,
  type BibleStore,
  type BibleVersion,
  type KjvData,
  type TestamentId,
} from "./types.ts";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "db", "migrations");

export const DEFAULT_BIBLE_DB_PATH = "data/apps/bible.db";

export function openBibleDatabase(path: string = DEFAULT_BIBLE_DB_PATH): Db {
  return openSqlite({
    path,
    migrations: { dir: MIGRATIONS_DIR, files: ["001_corpus.sql"] },
  });
}

export function createSqliteBibleStore(db: Db): BibleStore {
  return {
    defaultVersionId() {
      const row = db.get<{ id: string }>(
        "SELECT id FROM versions ORDER BY sort_order ASC, id ASC LIMIT 1",
      );
      return row?.id ?? null;
    },
    getVersion(id) {
      return db.get<BibleVersion>("SELECT id, label FROM versions WHERE id = ?", id);
    },
    listVersions() {
      return db.all<BibleVersion>("SELECT id, label FROM versions ORDER BY sort_order ASC, id ASC");
    },
    listTestaments(versionId) {
      const rows = db.all<{ testament: TestamentId }>(
        "SELECT DISTINCT testament FROM books WHERE version_id = ?",
        versionId,
      );
      const present = new Set(rows.map((r) => r.testament));
      return TESTAMENT_ORDER.filter((t) => present.has(t));
    },
    listBooks(versionId, testament) {
      const rows = db.all<{
        version_id: string;
        name: string;
        abbrev: string;
        testament: TestamentId;
        chapter_count: number;
      }>(
        `SELECT b.version_id, b.name, b.abbrev, b.testament,
                COALESCE(MAX(v.chapter), 0) AS chapter_count
         FROM books b
         LEFT JOIN verses v ON v.version_id = b.version_id AND v.book = b.name
         WHERE b.version_id = ? AND b.testament = ?
         GROUP BY b.version_id, b.name, b.abbrev, b.testament, b.sort_order
         ORDER BY b.sort_order ASC`,
        versionId,
        testament,
      );
      return rows.map(toBook);
    },
    getBook(versionId, nameOrAbbrev) {
      const needle = nameOrAbbrev.toLowerCase();
      const row = db.get<{
        version_id: string;
        name: string;
        abbrev: string;
        testament: TestamentId;
        chapter_count: number;
      }>(
        `SELECT b.version_id, b.name, b.abbrev, b.testament,
                COALESCE(MAX(v.chapter), 0) AS chapter_count
         FROM books b
         LEFT JOIN verses v ON v.version_id = b.version_id AND v.book = b.name
         WHERE b.version_id = ? AND (LOWER(b.name) = ? OR LOWER(b.abbrev) = ?)
         GROUP BY b.version_id, b.name, b.abbrev, b.testament, b.sort_order`,
        versionId,
        needle,
        needle,
      );
      return row ? toBook(row) : undefined;
    },
    verseCount(versionId, book, chapter) {
      const row = db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM verses WHERE version_id = ? AND book = ? AND chapter = ?",
        versionId,
        book,
        chapter,
      );
      return row?.n ?? 0;
    },
    getVerse(ref) {
      const row = db.get<{ text: string }>(
        "SELECT text FROM verses WHERE version_id = ? AND book = ? AND chapter = ? AND verse = ?",
        ref.version,
        ref.book,
        ref.chapter,
        ref.verse,
      );
      if (!row) {
        return undefined;
      }
      return { ...ref, text: row.text };
    },
    listVerses(versionId, book, chapter) {
      const rows = db.all<{ verse: number; text: string }>(
        `SELECT verse, text FROM verses
         WHERE version_id = ? AND book = ? AND chapter = ?
         ORDER BY verse ASC`,
        versionId,
        book,
        chapter,
      );
      return rows.map((r) => ({
        version: versionId,
        book,
        chapter,
        verse: r.verse,
        text: r.text,
      }));
    },
    close() {
      db.close();
    },
  };
}

export function seedBibleStore(db: Db, data: KjvData): void {
  const versionId = versionIdFromLabel(data.translation);
  const existing = db.get<{ id: string }>("SELECT id FROM versions WHERE id = ?", versionId);
  if (existing) {
    return;
  }

  const insertBook = db.prepare(
    "INSERT INTO books (version_id, name, abbrev, testament, sort_order) VALUES (?, ?, ?, ?, ?)",
  );
  const insertVerse = db.prepare(
    "INSERT INTO verses (version_id, book, chapter, verse, text) VALUES (?, ?, ?, ?, ?)",
  );

  db.transaction(() => {
    db.run(
      "INSERT INTO versions (id, label, sort_order) VALUES (?, ?, ?)",
      versionId,
      versionLabel(data.translation),
      nextVersionSort(db),
    );
    for (const [bookIndex, book] of data.books.entries()) {
      insertBook.run(versionId, book.name, book.abbrev, book.testament, bookIndex);
      for (let chapterIndex = 0; chapterIndex < book.chapters.length; chapterIndex++) {
        const verses = book.chapters[chapterIndex] ?? [];
        for (let verseIndex = 0; verseIndex < verses.length; verseIndex++) {
          insertVerse.run(
            versionId,
            book.name,
            chapterIndex + 1,
            verseIndex + 1,
            verses[verseIndex]!,
          );
        }
      }
    }
  });
}

export function versionIdFromLabel(translation: string): string {
  return translation.trim().toLowerCase();
}

function versionLabel(translation: string): string {
  if (translation.toUpperCase() === "KJV") {
    return "King James Version";
  }
  return translation;
}

function nextVersionSort(db: Db): number {
  const row = db.get<{ n: number }>("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM versions");
  return row?.n ?? 0;
}

function toBook(row: {
  version_id: string;
  name: string;
  abbrev: string;
  testament: TestamentId;
  chapter_count: number;
}): BibleBook {
  return {
    versionId: row.version_id,
    name: row.name,
    abbrev: row.abbrev,
    testament: row.testament,
    chapterCount: row.chapter_count,
  };
}

export function loadBundledKjv(): KjvData {
  const path = join(dirname(fileURLToPath(import.meta.url)), "data", "kjv.json");
  return JSON.parse(readFileSync(path, "utf8")) as KjvData;
}

export type StartBibleAppOptions = {
  readonly rootAppId: string;
  readonly dbPath?: string;
  readonly seed?: KjvData;
};

/** Opens Bible's own SQLite file and returns the AppModule. Used by the host. */
export function startBibleApp(options: StartBibleAppOptions): BibleApp {
  const db = openBibleDatabase(options.dbPath ?? DEFAULT_BIBLE_DB_PATH);
  if (options.seed) {
    seedBibleStore(db, options.seed);
  } else {
    const path = options.dbPath ?? DEFAULT_BIBLE_DB_PATH;
    const already = db.get<{ id: string }>("SELECT id FROM versions LIMIT 1");
    if (!already && path !== ":memory:") {
      seedBibleStore(db, loadBundledKjv());
    }
  }
  const store = createSqliteBibleStore(db);
  return createBibleApp({ rootAppId: options.rootAppId, store });
}
