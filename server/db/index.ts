/**
 * Host identity database. Apps do not use this file — they open their own
 * SQLite via `openSqlite` in server/sqlite.ts.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openSqlite, type Db, type RunResult, type SqlValue } from "../sqlite.ts";

export type { Db, RunResult, SqlValue };

const HOST_MIGRATIONS = {
  dir: join(dirname(fileURLToPath(import.meta.url)), "migrations"),
  files: ["001_identity.sql"] as const,
};

export type OpenDatabaseOptions = {
  readonly path: string;
  /** Skip host identity migrations (tests that apply their own schema). */
  readonly migrate?: boolean;
};

export function openDatabase(options: OpenDatabaseOptions): Db {
  if (options.migrate === false) {
    return openSqlite({ path: options.path });
  }
  return openSqlite({
    path: options.path,
    migrations: HOST_MIGRATIONS,
  });
}
