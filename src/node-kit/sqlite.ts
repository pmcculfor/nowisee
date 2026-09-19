/**
 * Library for opening a SQLite file. Apps and the host each pass *their*
 * path and *their* migrations. This is not a host privilege and not ctx.db.
 */

import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type SqlValue = null | number | string | Uint8Array | bigint;

export type RunResult = {
  readonly changes: number | bigint;
  readonly lastInsertRowid: number | bigint;
};

export type PreparedStatement = {
  run(...params: SqlValue[]): RunResult;
  get<T>(...params: SqlValue[]): T | undefined;
  all<T>(...params: SqlValue[]): T[];
};

export interface Db {
  exec(sql: string): void;
  run(sql: string, ...params: SqlValue[]): RunResult;
  get<T>(sql: string, ...params: SqlValue[]): T | undefined;
  all<T>(sql: string, ...params: SqlValue[]): T[];
  prepare(sql: string): PreparedStatement;
  transaction<T>(fn: () => T): T;
  close(): void;
}

export type MigrationList = {
  readonly dir: string;
  readonly files: readonly string[];
};

export type OpenSqliteOptions = {
  /** File path, or ":memory:". */
  readonly path: string;
  /** Numbered migration files for this database only. Omit to skip. */
  readonly migrations?: MigrationList;
};

const BUSY_TIMEOUT_MS = 5000;

export function openSqlite(options: OpenSqliteOptions): Db {
  if (options.path !== ":memory:") {
    mkdirSync(dirname(options.path), { recursive: true });
  }
  const raw = new DatabaseSync(options.path);
  raw.exec("PRAGMA journal_mode = WAL");
  raw.exec("PRAGMA foreign_keys = ON");
  raw.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);

  const db: Db = {
    exec(sql) {
      raw.exec(sql);
    },
    run(sql, ...params) {
      const result = raw.prepare(sql).run(...params);
      return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
    },
    get<T>(sql: string, ...params: SqlValue[]) {
      return raw.prepare(sql).get(...params) as T | undefined;
    },
    all<T>(sql: string, ...params: SqlValue[]) {
      return raw.prepare(sql).all(...params) as T[];
    },
    prepare(sql: string) {
      const stmt = raw.prepare(sql);
      return {
        run(...params: SqlValue[]) {
          const result = stmt.run(...params);
          return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
        },
        get<T>(...params: SqlValue[]) {
          return stmt.get(...params) as T | undefined;
        },
        all<T>(...params: SqlValue[]) {
          return stmt.all(...params) as T[];
        },
      };
    },
    transaction<T>(fn: () => T): T {
      raw.exec("BEGIN");
      try {
        const value = fn();
        raw.exec("COMMIT");
        return value;
      } catch (err) {
        try {
          raw.exec("ROLLBACK");
        } catch {
          // Connection may already be aborted.
        }
        throw err;
      }
    },
    close() {
      try {
        raw.close();
      } catch {
        // already closed
      }
    },
  };

  if (options.migrations) {
    applyMigrations(db, options.migrations);
  }
  return db;
}

export function applyMigrations(db: Db, list: MigrationList): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL
    )
  `);

  const applied = new Set(
    db.all<{ name: string }>("SELECT name FROM migrations").map((row) => row.name),
  );

  for (const [index, name] of list.files.entries()) {
    if (applied.has(name)) {
      continue;
    }
    const sql = readFileSync(join(list.dir, name), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.run(
        "INSERT INTO migrations (id, name, applied_at) VALUES (?, ?, ?)",
        index + 1,
        name,
        Date.now(),
      );
    });
  }
}
