/**
 * The only module that talks to SQLite.
 * Identity, Account flow, and later app tables all go through here so a
 * driver swap (better-sqlite3, D1, …) is one file.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations } from "./migrate.ts";

export type SqlValue = null | number | string | Uint8Array | bigint;

export type RunResult = {
  readonly changes: number | bigint;
  readonly lastInsertRowid: number | bigint;
};

export interface Db {
  exec(sql: string): void;
  run(sql: string, ...params: SqlValue[]): RunResult;
  get<T>(sql: string, ...params: SqlValue[]): T | undefined;
  all<T>(sql: string, ...params: SqlValue[]): T[];
  transaction<T>(fn: () => T): T;
  close(): void;
}

export type OpenDatabaseOptions = {
  /** File path, or ":memory:". */
  readonly path: string;
  /** Skip numbered migrations (tests that apply their own schema). */
  readonly migrate?: boolean;
};

const BUSY_TIMEOUT_MS = 5000;

export function openDatabase(options: OpenDatabaseOptions): Db {
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

  if (options.migrate !== false) {
    applyMigrations(db);
  }
  return db;
}
