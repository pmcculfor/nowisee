import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openSqlite, type Db } from "../../../server/sqlite.ts";
import {
  getCanonBook,
  resolveBookToken,
  verseOrd,
} from "./catalog.ts";
import { createBibleApp, type BibleApp } from "./index.ts";
import { ensureCatalog, type EnsureCatalogOptions } from "./import.ts";
import { MEMORY_SEED } from "./memorySeed.ts";
import { tokenize } from "./search.ts";
import type {
  BibleBook,
  BibleSeed,
  BibleStore,
  BibleVersion,
  BookmarkRecord,
  CommentarySection,
  CommentaryWork,
  RecencyOwner,
  SearchHit,
} from "./types.ts";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "db", "migrations");

export const DEFAULT_BIBLE_DB_PATH = "data/apps/bible.db";

export function openBibleDatabase(path: string = DEFAULT_BIBLE_DB_PATH): Db {
  return openSqlite({
    path,
    migrations: { dir: MIGRATIONS_DIR, files: ["001_reader.sql"] },
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
      return db.get<BibleVersion>("SELECT id, label, license FROM versions WHERE id = ?", id);
    },
    listVersions(owner) {
      if (!owner) {
        return db.all<BibleVersion>(
          "SELECT id, label, license FROM versions ORDER BY sort_order ASC, id ASC",
        );
      }
      return db.all<BibleVersion>(
        `SELECT v.id, v.label, v.license
         FROM versions v
         LEFT JOIN reader_recency r
           ON r.owner_kind = ? AND r.owner_id = ? AND r.work_kind = 'version' AND r.work_id = v.id
         ORDER BY r.used_at DESC, v.sort_order ASC, v.id ASC`,
        owner.kind,
        owner.id,
      );
    },
    touchRecency(owner, workKind, workId) {
      db.run(
        `INSERT INTO reader_recency (owner_kind, owner_id, work_kind, work_id, used_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(owner_kind, owner_id, work_kind, work_id)
         DO UPDATE SET used_at = excluded.used_at`,
        owner.kind,
        owner.id,
        workKind,
        workId,
        Date.now(),
      );
    },
    getActiveVersionId(userId) {
      const row = db.get<{ active_version_id: string }>(
        "SELECT active_version_id FROM reader_prefs WHERE user_id = ?",
        userId,
      );
      return row?.active_version_id ?? null;
    },
    setActiveVersionId(userId, versionId) {
      db.run(
        "INSERT INTO reader_prefs (user_id, active_version_id) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET active_version_id = excluded.active_version_id",
        userId,
        versionId,
      );
    },
    listBooks(versionId, testament) {
      const rows = db.all<{
        version_id: string;
        book_id: string;
        name: string;
        testament: string;
        sort_order: number;
        chapter_count: number;
      }>(
        `SELECT b.version_id, b.book_id, b.name, c.testament, c.sort_order,
                COALESCE(MAX(v.chapter), 0) AS chapter_count
         FROM books b
         JOIN canon_books c ON c.id = b.book_id
         LEFT JOIN verses v ON v.version_id = b.version_id AND v.book_id = b.book_id
         WHERE b.version_id = ? AND c.testament = ?
         GROUP BY b.version_id, b.book_id, b.name, c.testament, c.sort_order
         ORDER BY c.sort_order ASC`,
        versionId,
        testament,
      );
      return rows.map(toBook);
    },
    getBook(versionId, bookIdOrAlias) {
      const bookId = resolveBookToken(bookIdOrAlias)?.id ?? bookIdOrAlias;
      const row = db.get<{
        version_id: string;
        book_id: string;
        name: string;
        testament: string;
        sort_order: number;
        chapter_count: number;
      }>(
        `SELECT b.version_id, b.book_id, b.name, c.testament, c.sort_order,
                COALESCE(MAX(v.chapter), 0) AS chapter_count
         FROM books b
         JOIN canon_books c ON c.id = b.book_id
         LEFT JOIN verses v ON v.version_id = b.version_id AND v.book_id = b.book_id
         WHERE b.version_id = ? AND b.book_id = ?
         GROUP BY b.version_id, b.book_id, b.name, c.testament, c.sort_order`,
        versionId,
        bookId,
      );
      return row ? toBook(row) : undefined;
    },
    lastVerse(versionId, bookId, chapter) {
      const row = db.get<{ n: number }>(
        "SELECT COALESCE(MAX(verse), 0) AS n FROM verses WHERE version_id = ? AND book_id = ? AND chapter = ?",
        versionId,
        bookId,
        chapter,
      );
      return row?.n ?? 0;
    },
    getVerse(ref) {
      const row = db.get<{ text: string }>(
        "SELECT text FROM verses WHERE version_id = ? AND book_id = ? AND chapter = ? AND verse = ?",
        ref.version,
        ref.bookId,
        ref.chapter,
        ref.verse,
      );
      if (!row) {
        return undefined;
      }
      return { ...ref, text: row.text };
    },
    listVerses(versionId, bookId, chapter) {
      const rows = db.all<{ verse: number; text: string }>(
        `SELECT verse, text FROM verses
         WHERE version_id = ? AND book_id = ? AND chapter = ?
         ORDER BY verse ASC`,
        versionId,
        bookId,
        chapter,
      );
      return rows.map((r) => ({
        version: versionId,
        bookId,
        chapter,
        verse: r.verse,
        text: r.text,
      }));
    },
    isBookmarked(userId, ref) {
      return Boolean(
        db.get(
          "SELECT 1 FROM bookmarks WHERE user_id = ? AND book_id = ? AND chapter = ? AND verse = ?",
          userId,
          ref.bookId,
          ref.chapter,
          ref.verse,
        ),
      );
    },
    listBookmarks(userId) {
      return db.all<BookmarkRecord>(
        `SELECT book_id AS bookId, chapter, verse, created_at AS createdAt
         FROM bookmarks WHERE user_id = ?
         ORDER BY created_at ASC, book_id ASC, chapter ASC, verse ASC`,
        userId,
      );
    },
    toggleBookmark(userId, ref) {
      const existing = db.get(
        "SELECT 1 FROM bookmarks WHERE user_id = ? AND book_id = ? AND chapter = ? AND verse = ?",
        userId,
        ref.bookId,
        ref.chapter,
        ref.verse,
      );
      if (existing) {
        db.run(
          "DELETE FROM bookmarks WHERE user_id = ? AND book_id = ? AND chapter = ? AND verse = ?",
          userId,
          ref.bookId,
          ref.chapter,
          ref.verse,
        );
        return "removed";
      }
      db.run(
        "INSERT INTO bookmarks (user_id, book_id, chapter, verse, created_at) VALUES (?, ?, ?, ?, ?)",
        userId,
        ref.bookId,
        ref.chapter,
        ref.verse,
        Date.now(),
      );
      return "added";
    },
    listCommentaries(owner) {
      if (!owner) {
        return db.all<CommentaryWork>(
          "SELECT id, label, sort_order AS sortOrder FROM commentaries ORDER BY sort_order ASC, id ASC",
        );
      }
      return db.all<CommentaryWork>(
        `SELECT c.id, c.label, c.sort_order AS sortOrder
         FROM commentaries c
         LEFT JOIN reader_recency r
           ON r.owner_kind = ? AND r.owner_id = ? AND r.work_kind = 'commentary' AND r.work_id = c.id
         ORDER BY r.used_at DESC, c.sort_order ASC, c.id ASC`,
        owner.kind,
        owner.id,
      );
    },
    getCommentary(id) {
      return db.get<CommentaryWork>(
        "SELECT id, label, sort_order AS sortOrder FROM commentaries WHERE id = ?",
        id,
      );
    },
    findSection(commentaryId, ref) {
      const canon = getCanonBook(ref.bookId);
      if (!canon) {
        return undefined;
      }
      const ord = verseOrd(canon.sort, ref.chapter, ref.verse);
      const row = db.get<{
        id: number;
        commentary_id: string;
        start_ord: number;
        end_ord: number;
        body: string;
      }>(
        `SELECT id, commentary_id, start_ord, end_ord, body
         FROM commentary_sections
         WHERE commentary_id = ? AND start_ord <= ? AND end_ord >= ?
         ORDER BY (end_ord - start_ord) ASC, start_ord DESC, id ASC
         LIMIT 1`,
        commentaryId,
        ord,
        ord,
      );
      if (!row) {
        return undefined;
      }
      const xrefs = db.all<{ refs: string }>(
        "SELECT refs FROM commentary_xrefs WHERE section_id = ? ORDER BY sort_order ASC",
        row.id,
      );
      return {
        id: row.id,
        commentaryId: row.commentary_id,
        startOrd: row.start_ord,
        endOrd: row.end_ord,
        body: row.body,
        xrefs: xrefs.map((x) => x.refs),
      } satisfies CommentarySection;
    },
    createSearchQuery(sessionId, query) {
      const id = crypto.randomUUID();
      db.run(
        "INSERT INTO search_queries (id, session_id, query, created_at) VALUES (?, ?, ?, ?)",
        id,
        sessionId,
        query,
        Date.now(),
      );
      return id;
    },
    getSearchQuery(queryId, sessionId) {
      const row = db.get<{ query: string }>(
        "SELECT query FROM search_queries WHERE id = ? AND session_id = ?",
        queryId,
        sessionId,
      );
      return row?.query ?? null;
    },
    searchVerses(versionId, tokens, cap) {
      const unique = tokenize(tokens.join(" "));
      if (unique.length === 0 || cap <= 0) {
        return [];
      }
      const placeholders = unique.map(() => "?").join(", ");
      const rows = db.all<{ book_id: string; chapter: number; verse: number }>(
        `SELECT book_id, chapter, verse
         FROM verse_words
         WHERE version_id = ? AND word IN (${placeholders})
         GROUP BY book_id, chapter, verse
         HAVING COUNT(DISTINCT word) = ?
         ORDER BY MIN(verse_ord) ASC
         LIMIT ?`,
        versionId,
        ...unique,
        unique.length,
        cap,
      );
      return rows.map(
        (r) =>
          ({
            bookId: r.book_id,
            chapter: r.chapter,
            verse: r.verse,
          }) satisfies SearchHit,
      );
    },
    close() {
      db.close();
    },
  };
}

function toBook(row: {
  version_id: string;
  book_id: string;
  name: string;
  testament: string;
  sort_order: number;
  chapter_count: number;
}): BibleBook {
  return {
    versionId: row.version_id,
    bookId: row.book_id,
    name: row.name,
    testament: row.testament,
    sort: row.sort_order,
    chapterCount: row.chapter_count,
  };
}

export type StartBibleAppOptions = {
  readonly rootAppId: string;
  readonly dbPath?: string;
  readonly seed?: BibleSeed;
  readonly rawDir?: string;
};

/** Opens Bible's own SQLite file and returns the AppModule. Used by the host. */
export function startBibleApp(options: StartBibleAppOptions): BibleApp {
  const dbPath = options.dbPath ?? DEFAULT_BIBLE_DB_PATH;
  const db = openBibleDatabase(dbPath);
  const catalog: EnsureCatalogOptions = {
    seed: options.seed ?? (dbPath === ":memory:" ? MEMORY_SEED : undefined),
    rawDir: options.rawDir,
  };
  ensureCatalog(db, catalog);
  const store = createSqliteBibleStore(db);
  return createBibleApp({ rootAppId: options.rootAppId, store });
}
