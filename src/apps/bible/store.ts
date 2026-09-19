import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openSqlite, type Db } from "../../../server/sqlite.ts";
import { tokenize } from "./search.ts";
import type {
  BibleBook,
  BibleChapter,
  BibleStore,
  BibleVersion,
  BookmarkRecord,
  CanonRef,
  CatalogWork,
  CommentarySection,
  CommentaryWork,
  DictionaryWord,
  SearchHit,
  SearchQueryRecord,
  VerseReading,
  XrefPhrase,
} from "./types.ts";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "db", "migrations");

const VERSION_COLUMNS = "id, label, abbreviation, license";
const BOOK_COLUMNS = "id, label, testament, sort_order AS sort";
const HIT_COLUMNS = `v.id AS verseId, b.id AS bookId, c.number AS chapter, v.number AS verse`;

export const DEFAULT_BIBLE_DB_PATH = "data/apps/bible.db";

/** Search result sets are session scratch. One live query per session; drop rows older than this on write. */
export const SEARCH_QUERY_TTL_MS = 24 * 60 * 60 * 1000;

/** Session-owned recency. User rows are not expired. */
export const RECENCY_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function openBibleDatabase(path: string = DEFAULT_BIBLE_DB_PATH): Db {
  return openSqlite({
    path,
    migrations: { dir: MIGRATIONS_DIR, files: ["001_reader.sql"] },
  });
}

export function createSqliteBibleStore(db: Db): BibleStore {
  return {
    getVersion(id) {
      return db.get<BibleVersion>(
        `SELECT ${VERSION_COLUMNS} FROM version WHERE id = ?`,
        id,
      );
    },
    listVersions(userId, sessionId) {
      if (userId) {
        return db.all<BibleVersion>(
          `SELECT v.id, v.label, v.abbreviation, v.license
           FROM version v
           LEFT JOIN version_recency r ON r.user_id = ? AND r.version_id = v.id
           ORDER BY r.used_at DESC, v.sort_order ASC, v.id ASC`,
          userId,
        );
      }
      if (sessionId) {
        return db.all<BibleVersion>(
          `SELECT v.id, v.label, v.abbreviation, v.license
           FROM version v
           LEFT JOIN version_recency r ON r.session_id = ? AND r.version_id = v.id
           ORDER BY r.used_at DESC, v.sort_order ASC, v.id ASC`,
          sessionId,
        );
      }
      return db.all<BibleVersion>(
        `SELECT ${VERSION_COLUMNS} FROM version ORDER BY sort_order ASC, id ASC`,
      );
    },
    touchVersionRecency(userId, sessionId, versionId) {
      touchRecency(db, "version_recency", "version_id", userId, sessionId, versionId);
    },
    touchCommentaryRecency(userId, sessionId, commentaryId) {
      touchRecency(db, "commentary_recency", "commentary_id", userId, sessionId, commentaryId);
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
    getCanonRef(verseId) {
      return db.get<CanonRef>(
        `SELECT b.id AS bookId, c.number AS chapter, v.number AS verse
         FROM verse v
         JOIN chapter c ON c.id = v.chapter_id
         JOIN book b ON b.id = c.book_id
         WHERE v.id = ?`,
        verseId,
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
    listCommentaries(userId, sessionId) {
      if (userId) {
        return db.all<CommentaryWork>(
          `SELECT c.id, c.label, c.sort_order AS sortOrder
           FROM commentary c
           LEFT JOIN commentary_recency r ON r.user_id = ? AND r.commentary_id = c.id
           ORDER BY r.used_at DESC, c.sort_order ASC, c.id ASC`,
          userId,
        );
      }
      if (sessionId) {
        return db.all<CommentaryWork>(
          `SELECT c.id, c.label, c.sort_order AS sortOrder
           FROM commentary c
           LEFT JOIN commentary_recency r ON r.session_id = ? AND r.commentary_id = c.id
           ORDER BY r.used_at DESC, c.sort_order ASC, c.id ASC`,
          sessionId,
        );
      }
      return db.all<CommentaryWork>(
        "SELECT id, label, sort_order AS sortOrder FROM commentary ORDER BY sort_order ASC, id ASC",
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
      return {
        id: row.id,
        commentaryId: row.commentary_id,
        body: row.body,
      } satisfies CommentarySection;
    },
    touchXrefRecency(userId, sessionId, xrefWorkId) {
      touchRecency(db, "xref_recency", "xref_work_id", userId, sessionId, xrefWorkId);
    },
    listXrefWorks(userId, sessionId) {
      return listCatalogWorks(db, "xref_work", "xref_recency", "xref_work_id", userId, sessionId);
    },
    getXrefWork(id) {
      return db.get<CatalogWork>(
        "SELECT id, label, sort_order AS sortOrder FROM xref_work WHERE id = ?",
        id,
      );
    },
    listXrefPhrases(workId, verseId) {
      return db.all<XrefPhrase>(
        `SELECT id, xref_work_id AS xrefWorkId, verse_id AS verseId, sort_order AS sortOrder, phrase
         FROM xref_phrase
         WHERE xref_work_id = ? AND verse_id = ?
         ORDER BY sort_order ASC, id ASC`,
        workId,
        verseId,
      );
    },
    getXrefPhrase(id) {
      return db.get<XrefPhrase>(
        `SELECT id, xref_work_id AS xrefWorkId, verse_id AS verseId, sort_order AS sortOrder, phrase
         FROM xref_phrase WHERE id = ?`,
        id,
      );
    },
    listXrefRefReadings(phraseId, versionId) {
      return db.all<VerseReading>(
        `SELECT ${HIT_COLUMNS}, t.text
         FROM xref_ref r
         JOIN verse v ON v.id = r.verse_id
         JOIN chapter c ON c.id = v.chapter_id
         JOIN book b ON b.id = c.book_id
         LEFT JOIN verse_text t ON t.verse_id = v.id AND t.version_id = ?
         WHERE r.phrase_id = ?
         ORDER BY r.sort_order ASC`,
        versionId,
        phraseId,
      );
    },
    touchDictionaryRecency(userId, sessionId, dictionaryWorkId) {
      touchRecency(
        db,
        "dictionary_recency",
        "dictionary_work_id",
        userId,
        sessionId,
        dictionaryWorkId,
      );
    },
    listDictionaryWorks(userId, sessionId) {
      return listCatalogWorks(
        db,
        "dictionary_work",
        "dictionary_recency",
        "dictionary_work_id",
        userId,
        sessionId,
      );
    },
    getDictionaryWork(id) {
      return db.get<CatalogWork>(
        "SELECT id, label, sort_order AS sortOrder FROM dictionary_work WHERE id = ?",
        id,
      );
    },
    listDictionaryWords(workId, verseId) {
      return db.all<DictionaryWord>(
        `SELECT t.position, t.strongs, t.english, e.lemma, e.translit, e.body
         FROM verse_token t
         JOIN dictionary_entry e
           ON e.strongs = t.strongs AND e.dictionary_work_id = ?
         WHERE t.verse_id = ?
         ORDER BY t.position ASC`,
        workId,
        verseId,
      );
    },
    createSearchQuery(sessionId, query, versionId, hits) {
      return db.transaction(() => {
        const at = Date.now();
        db.run(
          "DELETE FROM search_query WHERE session_id = ? OR created_at < ?",
          sessionId,
          at - SEARCH_QUERY_TTL_MS,
        );
        const result = db.run(
          "INSERT INTO search_query (session_id, query, version_id, created_at) VALUES (?, ?, ?, ?)",
          sessionId,
          query,
          versionId,
          at,
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
      return (
        db.get<SearchQueryRecord>(
          "SELECT query, version_id AS versionId FROM search_query WHERE id = ? AND session_id = ?",
          queryId,
          sessionId,
        ) ?? null
      );
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
    listSearchHitReadings(queryId, sessionId) {
      return db.all<VerseReading>(
        `SELECT ${HIT_COLUMNS}, t.text
         FROM search_hit h
         JOIN search_query q ON q.id = h.query_id
         JOIN verse v ON v.id = h.verse_id
         JOIN chapter c ON c.id = v.chapter_id
         JOIN book b ON b.id = c.book_id
         LEFT JOIN verse_text t ON t.verse_id = v.id AND t.version_id = q.version_id
         WHERE h.query_id = ? AND q.session_id = ?
         ORDER BY h.position ASC`,
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

function listCatalogWorks(
  db: Db,
  table: "xref_work" | "dictionary_work",
  recency: "xref_recency" | "dictionary_recency",
  idColumn: "xref_work_id" | "dictionary_work_id",
  userId?: string | null,
  sessionId?: string | null,
): readonly CatalogWork[] {
  if (userId) {
    return db.all<CatalogWork>(
      `SELECT w.id, w.label, w.sort_order AS sortOrder
       FROM ${table} w
       LEFT JOIN ${recency} r ON r.user_id = ? AND r.${idColumn} = w.id
       ORDER BY r.used_at DESC, w.sort_order ASC, w.id ASC`,
      userId,
    );
  }
  if (sessionId) {
    return db.all<CatalogWork>(
      `SELECT w.id, w.label, w.sort_order AS sortOrder
       FROM ${table} w
       LEFT JOIN ${recency} r ON r.session_id = ? AND r.${idColumn} = w.id
       ORDER BY r.used_at DESC, w.sort_order ASC, w.id ASC`,
      sessionId,
    );
  }
  return db.all<CatalogWork>(
    `SELECT id, label, sort_order AS sortOrder FROM ${table} ORDER BY sort_order ASC, id ASC`,
  );
}

function purgeExpiredSessionRecency(db: Db): void {
  const cutoff = Date.now() - RECENCY_TTL_MS;
  db.run("DELETE FROM version_recency WHERE session_id IS NOT NULL AND used_at < ?", cutoff);
  db.run("DELETE FROM commentary_recency WHERE session_id IS NOT NULL AND used_at < ?", cutoff);
  db.run("DELETE FROM xref_recency WHERE session_id IS NOT NULL AND used_at < ?", cutoff);
  db.run("DELETE FROM dictionary_recency WHERE session_id IS NOT NULL AND used_at < ?", cutoff);
}

function touchRecency(
  db: Db,
  table: "version_recency" | "commentary_recency" | "xref_recency" | "dictionary_recency",
  idColumn: "version_id" | "commentary_id" | "xref_work_id" | "dictionary_work_id",
  userId: string | null,
  sessionId: string | null,
  id: number,
): void {
  purgeExpiredSessionRecency(db);
  const at = Date.now();
  if (userId) {
    db.run(
      `INSERT INTO ${table} (user_id, session_id, ${idColumn}, used_at)
       VALUES (?, NULL, ?, ?)
       ON CONFLICT(user_id, ${idColumn}) WHERE user_id IS NOT NULL
       DO UPDATE SET used_at = excluded.used_at`,
      userId,
      id,
      at,
    );
    return;
  }
  if (!sessionId) {
    return;
  }
  db.run(
    `INSERT INTO ${table} (user_id, session_id, ${idColumn}, used_at)
     VALUES (NULL, ?, ?, ?)
     ON CONFLICT(session_id, ${idColumn}) WHERE session_id IS NOT NULL
     DO UPDATE SET used_at = excluded.used_at`,
    sessionId,
    id,
    at,
  );
}

function wholeWordSql(column: string): string {
  return `(${column} = ? OR ${column} GLOB ? OR ${column} GLOB ? OR ${column} GLOB ?)`;
}

function wholeWordParams(token: string): readonly [string, string, string, string] {
  return [token, `${token}[^a-z]*`, `*[^a-z]${token}`, `*[^a-z]${token}[^a-z]*`];
}
