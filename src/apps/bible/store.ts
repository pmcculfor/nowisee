import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openSqlite, type Db } from "../../../server/sqlite.ts";
import { tokenize } from "./search.ts";
import { createBibleApp, type BibleApp } from "./index.ts";
import { ensureCatalog, type EnsureCatalogOptions } from "./import.ts";
import { MEMORY_SEED } from "./memorySeed.ts";
import type {
  BibleBook,
  BibleChapter,
  BibleSeed,
  BibleStore,
  BibleVersion,
  BookmarkRecord,
  CommentarySection,
  CommentaryWork,
  SearchHit,
  VerseReading,
} from "./types.ts";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "db", "migrations");

const VERSION_COLUMNS = "id, slug, label, license";
const BOOK_COLUMNS = "id, label, testament, sort_order AS sort";
const HIT_COLUMNS = `v.id AS verseId, b.id AS bookId, c.number AS chapter, v.number AS verse`;

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
      const row = db.get<{ id: number }>(
        "SELECT id FROM version ORDER BY sort_order ASC, id ASC LIMIT 1",
      );
      return row?.id ?? null;
    },
    getVersion(id) {
      return db.get<BibleVersion>(
        `SELECT ${VERSION_COLUMNS} FROM version WHERE id = ?`,
        id,
      );
    },
    getVersionBySlug(slug) {
      return db.get<BibleVersion>(
        `SELECT ${VERSION_COLUMNS} FROM version WHERE slug = ?`,
        slug,
      );
    },
    listVersions(userId) {
      if (!userId) {
        return db.all<BibleVersion>(
          `SELECT ${VERSION_COLUMNS} FROM version ORDER BY sort_order ASC, id ASC`,
        );
      }
      return db.all<BibleVersion>(
        `SELECT v.id, v.slug, v.label, v.license
         FROM version v
         LEFT JOIN version_recency r ON r.user_id = ? AND r.version_id = v.id
         ORDER BY r.used_at DESC, v.sort_order ASC, v.id ASC`,
        userId,
      );
    },
    getActiveVersionId(userId) {
      const row = db.get<{ active_version_id: number }>(
        "SELECT active_version_id FROM reader_pref WHERE user_id = ?",
        userId,
      );
      return row?.active_version_id ?? null;
    },
    setActiveVersionId(userId, versionId) {
      db.run(
        "INSERT INTO reader_pref (user_id, active_version_id) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET active_version_id = excluded.active_version_id",
        userId,
        versionId,
      );
    },
    touchVersionRecency(userId, versionId) {
      db.run(
        `INSERT INTO version_recency (user_id, version_id, used_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id, version_id)
         DO UPDATE SET used_at = excluded.used_at`,
        userId,
        versionId,
        Date.now(),
      );
    },
    touchCommentaryRecency(userId, commentaryId) {
      db.run(
        `INSERT INTO commentary_recency (user_id, commentary_id, used_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id, commentary_id)
         DO UPDATE SET used_at = excluded.used_at`,
        userId,
        commentaryId,
        Date.now(),
      );
    },
    listBooks(testament) {
      return db.all<BibleBook>(
        `SELECT ${BOOK_COLUMNS} FROM book WHERE testament = ? ORDER BY sort_order ASC`,
        testament,
      );
    },
    getBook(id) {
      return db.get<BibleBook>(`SELECT ${BOOK_COLUMNS} FROM book WHERE id = ?`, id);
    },
    getBookBySort(sort) {
      return db.get<BibleBook>(`SELECT ${BOOK_COLUMNS} FROM book WHERE sort_order = ?`, sort);
    },
    getChapter(bookId, number) {
      return db.get<BibleChapter>(
        "SELECT id, book_id AS bookId, number FROM chapter WHERE book_id = ? AND number = ?",
        bookId,
        number,
      );
    },
    listChapters(bookId) {
      return db.all<BibleChapter>(
        "SELECT id, book_id AS bookId, number FROM chapter WHERE book_id = ? ORDER BY number ASC",
        bookId,
      );
    },
    getVerseSlot(bookId, chapter, verse) {
      return db.get(
        `SELECT v.id, v.chapter_id AS chapterId, v.number
         FROM verse v
         JOIN chapter c ON c.id = v.chapter_id
         WHERE c.book_id = ? AND c.number = ? AND v.number = ?`,
        bookId,
        chapter,
        verse,
      );
    },
    getVerseText(versionId, verseId) {
      const row = db.get<{ text: string }>(
        "SELECT text FROM verse_text WHERE version_id = ? AND verse_id = ?",
        versionId,
        verseId,
      );
      return row?.text ?? null;
    },
    listVerseReadings(versionId, chapterId) {
      return db.all<VerseReading>(
        `SELECT v.id AS verseId, c.book_id AS bookId, c.number AS chapter, v.number AS verse, t.text
         FROM verse v
         JOIN chapter c ON c.id = v.chapter_id
         LEFT JOIN verse_text t ON t.verse_id = v.id AND t.version_id = ?
         WHERE v.chapter_id = ?
         ORDER BY v.number ASC`,
        versionId,
        chapterId,
      );
    },
    isBookmarked(userId, verseId) {
      return Boolean(
        db.get("SELECT 1 FROM bookmark WHERE user_id = ? AND verse_id = ?", userId, verseId),
      );
    },
    listBookmarks(userId) {
      return db.all<BookmarkRecord>(
        `SELECT bm.verse_id AS verseId, b.id AS bookId, c.number AS chapter, v.number AS verse, bm.created_at AS createdAt
         FROM bookmark bm
         JOIN verse v ON v.id = bm.verse_id
         JOIN chapter c ON c.id = v.chapter_id
         JOIN book b ON b.id = c.book_id
         WHERE bm.user_id = ?
         ORDER BY bm.created_at ASC, b.sort_order ASC, c.number ASC, v.number ASC`,
        userId,
      );
    },
    toggleBookmark(userId, verseId) {
      const existing = db.get(
        "SELECT 1 FROM bookmark WHERE user_id = ? AND verse_id = ?",
        userId,
        verseId,
      );
      if (existing) {
        db.run("DELETE FROM bookmark WHERE user_id = ? AND verse_id = ?", userId, verseId);
        return "removed";
      }
      db.run(
        "INSERT INTO bookmark (user_id, verse_id, created_at) VALUES (?, ?, ?)",
        userId,
        verseId,
        Date.now(),
      );
      return "added";
    },
    listCommentaries(userId) {
      if (!userId) {
        return db.all<CommentaryWork>(
          "SELECT id, label, sort_order AS sortOrder FROM commentary ORDER BY sort_order ASC, id ASC",
        );
      }
      return db.all<CommentaryWork>(
        `SELECT c.id, c.label, c.sort_order AS sortOrder
         FROM commentary c
         LEFT JOIN commentary_recency r ON r.user_id = ? AND r.commentary_id = c.id
         ORDER BY r.used_at DESC, c.sort_order ASC, c.id ASC`,
        userId,
      );
    },
    getCommentary(id) {
      return db.get<CommentaryWork>(
        "SELECT id, label, sort_order AS sortOrder FROM commentary WHERE id = ?",
        id,
      );
    },
    findSection(commentaryId, verseId) {
      const row = db.get<{
        id: number;
        commentary_id: number;
        body: string;
      }>(
        `SELECT s.id, s.commentary_id, s.body
         FROM commentary_section s
         JOIN commentary_section_verse csv ON csv.section_id = s.id
         WHERE s.commentary_id = ? AND csv.verse_id = ?
         ORDER BY (
           SELECT COUNT(*) FROM commentary_section_verse c2 WHERE c2.section_id = s.id
         ) ASC, s.id ASC
         LIMIT 1`,
        commentaryId,
        verseId,
      );
      if (!row) {
        return undefined;
      }
      const xrefs = db.all<{ refs: string }>(
        "SELECT refs FROM commentary_xref WHERE section_id = ? ORDER BY sort_order ASC",
        row.id,
      );
      return {
        id: row.id,
        commentaryId: row.commentary_id,
        body: row.body,
        xrefs: xrefs.map((x) => x.refs),
      } satisfies CommentarySection;
    },
    createSearchQuery(sessionId, query, hits) {
      return db.transaction(() => {
        const result = db.run(
          "INSERT INTO search_query (session_id, query, created_at) VALUES (?, ?, ?)",
          sessionId,
          query,
          Date.now(),
        );
        const id = Number(result.lastInsertRowid);
        const insertHit = db.prepare(
          "INSERT INTO search_hit (query_id, position, verse_id) VALUES (?, ?, ?)",
        );
        for (let i = 0; i < hits.length; i++) {
          insertHit.run(id, i, hits[i]!.verseId);
        }
        return id;
      });
    },
    getSearchQuery(queryId, sessionId) {
      const row = db.get<{ query: string }>(
        "SELECT query FROM search_query WHERE id = ? AND session_id = ?",
        queryId,
        sessionId,
      );
      return row?.query ?? null;
    },
    listSearchHits(queryId, sessionId) {
      return db.all<SearchHit>(
        `SELECT ${HIT_COLUMNS}
         FROM search_hit h
         JOIN search_query q ON q.id = h.query_id
         JOIN verse v ON v.id = h.verse_id
         JOIN chapter c ON c.id = v.chapter_id
         JOIN book b ON b.id = c.book_id
         WHERE h.query_id = ? AND q.session_id = ?
         ORDER BY h.position ASC`,
        queryId,
        sessionId,
      );
    },
    listSearchHitReadings(queryId, sessionId, versionId) {
      return db.all<VerseReading>(
        `SELECT ${HIT_COLUMNS}, t.text
         FROM search_hit h
         JOIN search_query q ON q.id = h.query_id
         JOIN verse v ON v.id = h.verse_id
         JOIN chapter c ON c.id = v.chapter_id
         JOIN book b ON b.id = c.book_id
         LEFT JOIN verse_text t ON t.verse_id = v.id AND t.version_id = ?
         WHERE h.query_id = ? AND q.session_id = ?
         ORDER BY h.position ASC`,
        versionId,
        queryId,
        sessionId,
      );
    },
    searchVerses(versionId, tokens, cap) {
      const unique = tokenize(tokens.join(" "));
      if (unique.length === 0 || cap <= 0) {
        return [];
      }
      const lowered = "LOWER(t.text)";
      const clauses = unique.map(() => wholeWordSql(lowered)).join(" AND ");
      const params: Array<string | number> = [versionId];
      for (const token of unique) {
        params.push(...wholeWordParams(token));
      }
      params.push(cap);
      return db.all<SearchHit>(
        `SELECT ${HIT_COLUMNS}
         FROM verse_text t
         JOIN verse v ON v.id = t.verse_id
         JOIN chapter c ON c.id = v.chapter_id
         JOIN book b ON b.id = c.book_id
         WHERE t.version_id = ? AND ${clauses}
         ORDER BY b.sort_order ASC, c.number ASC, v.number ASC
         LIMIT ?`,
        ...params,
      );
    },
    close() {
      db.close();
    },
  };
}

function wholeWordSql(column: string): string {
  return `(${column} = ? OR ${column} GLOB ? OR ${column} GLOB ? OR ${column} GLOB ?)`;
}

function wholeWordParams(token: string): readonly [string, string, string, string] {
  return [token, `${token}[^a-z]*`, `*[^a-z]${token}`, `*[^a-z]${token}[^a-z]*`];
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
