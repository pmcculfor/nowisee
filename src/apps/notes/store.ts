import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openSqlite, type Db } from "../../node-kit/sqlite.ts";
import type { NoteRecord, NotesStore } from "./types.ts";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "db", "migrations");

export const DEFAULT_NOTES_DB_PATH = "data/apps/notes.db";

export type SqliteNotesStoreOptions = {
  /** Injected for tests; defaults to `randomUUID`. */
  readonly idFactory?: () => string;
  /** Injected for tests; defaults to `() => new Date().toISOString()`. */
  readonly now?: () => string;
};

export function createSqliteNotesStore(db: Db, options: SqliteNotesStoreOptions = {}): NotesStore {
  const idFactory = options.idFactory ?? defaultIdFactory;
  const now = options.now ?? (() => new Date().toISOString());

  return {
    async list(ownerId) {
      const rows = db.all<{
        id: string;
        body: string;
        created_at: string;
        updated_at: string;
      }>(
        `SELECT id, body, created_at, updated_at FROM notes
         WHERE owner_id = ?
         ORDER BY updated_at DESC, id ASC`,
        ownerId,
      );
      return rows.map(fromRow);
    },
    async get(ownerId, id) {
      const row = db.get<{
        id: string;
        body: string;
        created_at: string;
        updated_at: string;
      }>(
        "SELECT id, body, created_at, updated_at FROM notes WHERE id = ? AND owner_id = ?",
        id,
        ownerId,
      );
      return row ? fromRow(row) : null;
    },
    async create(ownerId, body, id) {
      const ts = now();
      const noteId = id ?? idFactory();
      const clash = db.get<{ owner_id: string }>(
        "SELECT owner_id FROM notes WHERE id = ?",
        noteId,
      );
      if (clash) {
        if (clash.owner_id !== ownerId) {
          return { id: noteId, body, createdAt: ts, updatedAt: ts };
        }
        const existing = db.get<{
          id: string;
          body: string;
          created_at: string;
          updated_at: string;
        }>(
          "SELECT id, body, created_at, updated_at FROM notes WHERE id = ? AND owner_id = ?",
          noteId,
          ownerId,
        );
        return existing ? fromRow(existing) : { id: noteId, body, createdAt: ts, updatedAt: ts };
      }
      db.run(
        "INSERT INTO notes (id, owner_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        noteId,
        ownerId,
        body,
        ts,
        ts,
      );
      return { id: noteId, body, createdAt: ts, updatedAt: ts };
    },
    async update(ownerId, id, body) {
      const existing = db.get<{ created_at: string }>(
        "SELECT created_at FROM notes WHERE id = ? AND owner_id = ?",
        id,
        ownerId,
      );
      if (!existing) {
        return null;
      }
      const ts = now();
      db.run(
        "UPDATE notes SET body = ?, updated_at = ? WHERE id = ? AND owner_id = ?",
        body,
        ts,
        id,
        ownerId,
      );
      return { id, body, createdAt: existing.created_at, updatedAt: ts };
    },
  };
}

export function openNotesDatabase(path: string = DEFAULT_NOTES_DB_PATH): Db {
  return openSqlite({
    path,
    migrations: { dir: MIGRATIONS_DIR, files: ["001_notes.sql"] },
  });
}

function fromRow(row: {
  id: string;
  body: string;
  created_at: string;
  updated_at: string;
}): NoteRecord {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function defaultIdFactory(): string {
  return randomUUID();
}
