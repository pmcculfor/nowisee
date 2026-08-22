import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openSqlite, type Db } from "../../../server/sqlite.ts";
import { createNotesApp, type NotesApp } from "./index.ts";
import type { NoteRecord, NotesStore } from "./types.ts";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "db", "migrations");

export const DEFAULT_NOTES_DB_PATH = "data/apps/notes.db";

type StoredNote = NoteRecord & { readonly ownerId: string };

export type MemoryNotesStoreOptions = {
  readonly initial?: readonly StoredNote[];
  /** Injected for tests; defaults to `randomUUID`. */
  readonly idFactory?: () => string;
  /** Injected for tests; defaults to `() => new Date().toISOString()`. */
  readonly now?: () => string;
};

/**
 * In-memory store for graph tests. Same owner-in-the-query rules as SQLite.
 */
export function createMemoryNotesStore(
  options: MemoryNotesStoreOptions = {},
): NotesStore {
  const idFactory = options.idFactory ?? defaultIdFactory;
  const now = options.now ?? (() => new Date().toISOString());
  const notes = new Map<string, StoredNote>();
  for (const n of options.initial ?? []) {
    notes.set(n.id, n);
  }

  return {
    async list(ownerId) {
      return sortByUpdatedDesc(
        [...notes.values()].filter((n) => n.ownerId === ownerId).map(toRecord),
      );
    },
    async get(ownerId, id) {
      const existing = notes.get(id);
      if (!existing || existing.ownerId !== ownerId) {
        return null;
      }
      return toRecord(existing);
    },
    async create(ownerId, body) {
      const ts = now();
      const record: StoredNote = {
        id: idFactory(),
        ownerId,
        body,
        createdAt: ts,
        updatedAt: ts,
      };
      notes.set(record.id, record);
      return toRecord(record);
    },
    async update(ownerId, id, body) {
      const existing = notes.get(id);
      if (!existing || existing.ownerId !== ownerId) {
        return null;
      }
      const record: StoredNote = {
        ...existing,
        body,
        updatedAt: now(),
      };
      notes.set(id, record);
      return toRecord(record);
    },
  };
}

export function createSqliteNotesStore(db: Db): NotesStore {
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
    async create(ownerId, body) {
      const ts = new Date().toISOString();
      const id = defaultIdFactory();
      db.run(
        "INSERT INTO notes (id, owner_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        id,
        ownerId,
        body,
        ts,
        ts,
      );
      return { id, body, createdAt: ts, updatedAt: ts };
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
      const ts = new Date().toISOString();
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

export type StartNotesAppOptions = {
  readonly rootAppId: string;
  readonly dbPath?: string;
};

/** Opens Notes' own SQLite file and returns the AppModule. Used by the host. */
export function startNotesApp(options: StartNotesAppOptions): NotesApp {
  const db = openNotesDatabase(options.dbPath ?? DEFAULT_NOTES_DB_PATH);
  return createNotesApp({
    rootAppId: options.rootAppId,
    store: createSqliteNotesStore(db),
    close: () => db.close(),
  });
}

export function sortByUpdatedDesc(notes: readonly NoteRecord[]): NoteRecord[] {
  return [...notes].sort((a, b) => {
    if (a.updatedAt === b.updatedAt) {
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    }
    return a.updatedAt < b.updatedAt ? 1 : -1;
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

function toRecord(note: StoredNote): NoteRecord {
  return {
    id: note.id,
    body: note.body,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

function defaultIdFactory(): string {
  return randomUUID();
}
