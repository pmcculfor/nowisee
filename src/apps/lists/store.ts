import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openSqlite, type Db } from "../../../server/sqlite.ts";
import { createListsApp, type ListsApp } from "./index.ts";
import type { FirstActiveItem, ListItemRecord, ListRecord, ListsStore } from "./types.ts";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "db", "migrations");

export const DEFAULT_LISTS_DB_PATH = "data/apps/lists.db";

export type SqliteListsStoreOptions = {
  /** Injected for tests; defaults to `randomUUID`. */
  readonly idFactory?: () => string;
  /** Injected for tests; defaults to `() => new Date().toISOString()`. */
  readonly now?: () => string;
};

type ListRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type ItemRow = {
  id: string;
  list_id: string;
  body: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export function createSqliteListsStore(db: Db, options: SqliteListsStoreOptions = {}): ListsStore {
  const idFactory = options.idFactory ?? defaultIdFactory;
  const now = options.now ?? (() => new Date().toISOString());

  return {
    async listLists(ownerId) {
      const rows = db.all<ListRow>(
        `SELECT id, title, created_at, updated_at FROM list
         WHERE owner_id = ?
         ORDER BY updated_at DESC, id ASC`,
        ownerId,
      );
      return rows.map(fromListRow);
    },
    async getList(ownerId, id) {
      const row = db.get<ListRow>(
        "SELECT id, title, created_at, updated_at FROM list WHERE id = ? AND owner_id = ?",
        id,
        ownerId,
      );
      return row ? fromListRow(row) : null;
    },
    async createList(ownerId, title) {
      const ts = now();
      const id = idFactory();
      db.run(
        "INSERT INTO list (id, owner_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        id,
        ownerId,
        title,
        ts,
        ts,
      );
      return { id, title, createdAt: ts, updatedAt: ts };
    },
    async deleteList(ownerId, id) {
      return db.transaction(() => {
        const existing = db.get<{ id: string }>(
          "SELECT id FROM list WHERE id = ? AND owner_id = ?",
          id,
          ownerId,
        );
        if (!existing) {
          return false;
        }
        db.run("DELETE FROM list WHERE id = ? AND owner_id = ?", id, ownerId);
        return true;
      });
    },
    async firstActiveItems(ownerId) {
      const rows = db.all<{ list_id: string; id: string; body: string }>(
        `SELECT i.list_id, i.id, i.body
         FROM list_item i
         INNER JOIN list l ON l.id = i.list_id
         WHERE l.owner_id = ? AND i.completed_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM list_item j
             WHERE j.list_id = i.list_id AND j.completed_at IS NULL
               AND (j.updated_at < i.updated_at
                 OR (j.updated_at = i.updated_at AND j.id < i.id))
           )`,
        ownerId,
      );
      return rows.map(
        (row): FirstActiveItem => ({
          listId: row.list_id,
          itemId: row.id,
          body: row.body,
        }),
      );
    },
    async listItems(ownerId, listId, filter) {
      const completedClause =
        filter === "completed" ? "i.completed_at IS NOT NULL" : "i.completed_at IS NULL";
      const order =
        filter === "completed"
          ? "i.completed_at DESC, i.id ASC"
          : "i.updated_at ASC, i.id ASC";
      const rows = db.all<ItemRow>(
        `SELECT i.id, i.list_id, i.body, i.completed_at, i.created_at, i.updated_at
         FROM list_item i
         INNER JOIN list l ON l.id = i.list_id
         WHERE l.owner_id = ? AND i.list_id = ? AND ${completedClause}
         ORDER BY ${order}`,
        ownerId,
        listId,
      );
      return rows.map(fromItemRow);
    },
    async getItem(ownerId, id) {
      const row = db.get<ItemRow>(
        `SELECT i.id, i.list_id, i.body, i.completed_at, i.created_at, i.updated_at
         FROM list_item i
         INNER JOIN list l ON l.id = i.list_id
         WHERE i.id = ? AND l.owner_id = ?`,
        id,
        ownerId,
      );
      return row ? fromItemRow(row) : null;
    },
    async createItem(ownerId, listId, body) {
      return db.transaction(() => {
        const list = db.get<{ id: string }>(
          "SELECT id FROM list WHERE id = ? AND owner_id = ?",
          listId,
          ownerId,
        );
        if (!list) {
          return null;
        }
        const ts = now();
        const id = idFactory();
        db.run(
          `INSERT INTO list_item (id, list_id, body, completed_at, created_at, updated_at)
           VALUES (?, ?, ?, NULL, ?, ?)`,
          id,
          listId,
          body,
          ts,
          ts,
        );
        bumpList(db, ownerId, listId, ts);
        return {
          id,
          listId,
          body,
          completedAt: null,
          createdAt: ts,
          updatedAt: ts,
        };
      });
    },
    async completeItem(ownerId, id) {
      return mutateItem(db, ownerId, id, now, { complete: true });
    },
    async restoreItem(ownerId, id) {
      return mutateItem(db, ownerId, id, now, { complete: false });
    },
  };
}

function mutateItem(
  db: Db,
  ownerId: string,
  id: string,
  now: () => string,
  opts: { readonly complete: boolean },
): ListItemRecord | null {
  return db.transaction(() => {
    const row = db.get<ItemRow>(
      `SELECT i.id, i.list_id, i.body, i.completed_at, i.created_at, i.updated_at
       FROM list_item i
       INNER JOIN list l ON l.id = i.list_id
       WHERE i.id = ? AND l.owner_id = ?`,
      id,
      ownerId,
    );
    if (!row) {
      return null;
    }
    const isCompleted = row.completed_at != null;
    if (opts.complete === isCompleted) {
      return fromItemRow(row);
    }
    const ts = now();
    const completedAt = opts.complete ? ts : null;
    db.run(
      `UPDATE list_item SET completed_at = ?, updated_at = ?
       WHERE id = ? AND EXISTS (
         SELECT 1 FROM list WHERE list.id = list_item.list_id AND list.owner_id = ?
       )`,
      completedAt,
      ts,
      id,
      ownerId,
    );
    bumpList(db, ownerId, row.list_id, ts);
    return {
      id: row.id,
      listId: row.list_id,
      body: row.body,
      completedAt,
      createdAt: row.created_at,
      updatedAt: ts,
    };
  });
}

function bumpList(db: Db, ownerId: string, listId: string, ts: string): void {
  db.run(
    "UPDATE list SET updated_at = ? WHERE id = ? AND owner_id = ?",
    ts,
    listId,
    ownerId,
  );
}

export function openListsDatabase(path: string = DEFAULT_LISTS_DB_PATH): Db {
  return openSqlite({
    path,
    migrations: { dir: MIGRATIONS_DIR, files: ["001_lists.sql"] },
  });
}

export type StartListsAppOptions = {
  readonly rootAppId: string;
  readonly dbPath?: string;
};

/** Opens Lists' own SQLite file and returns the AppModule. Used by the host. */
export function startListsApp(options: StartListsAppOptions): ListsApp {
  const db = openListsDatabase(options.dbPath ?? DEFAULT_LISTS_DB_PATH);
  return createListsApp({
    rootAppId: options.rootAppId,
    store: createSqliteListsStore(db),
    close: () => db.close(),
  });
}

function fromListRow(row: ListRow): ListRecord {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fromItemRow(row: ItemRow): ListItemRecord {
  return {
    id: row.id,
    listId: row.list_id,
    body: row.body,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function defaultIdFactory(): string {
  return randomUUID();
}
