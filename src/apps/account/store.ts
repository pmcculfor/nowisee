import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openSqlite, type Db } from "../../../server/sqlite.ts";
import { createAccountApp, type AccountApp } from "./index.ts";
import type { AccountFlowStore } from "./types.ts";

export type { AccountFlowStore };

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "db", "migrations");

export const DEFAULT_ACCOUNT_DB_PATH = "data/apps/account.db";

export function createAccountFlowStore(db: Db): AccountFlowStore {
  return {
    getEmail(sessionId) {
      const row = db.get<{ email: string | null }>(
        "SELECT email FROM account_flow WHERE session_id = ?",
        sessionId,
      );
      return row?.email ?? null;
    },
    setEmail(sessionId, email) {
      db.run(
        `INSERT INTO account_flow (session_id, email, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (session_id) DO UPDATE SET email = excluded.email, updated_at = excluded.updated_at`,
        sessionId,
        email,
        Date.now(),
      );
    },
    clear(sessionId) {
      db.run("DELETE FROM account_flow WHERE session_id = ?", sessionId);
    },
  };
}

export function openAccountDatabase(path: string = DEFAULT_ACCOUNT_DB_PATH): Db {
  return openSqlite({
    path,
    migrations: { dir: MIGRATIONS_DIR, files: ["001_flow.sql"] },
  });
}

export type StartAccountAppOptions = {
  readonly rootAppId: string;
  readonly dbPath?: string;
};

/** Opens Account's own SQLite file and returns the AppModule. Used by the host. */
export function startAccountApp(options: StartAccountAppOptions): AccountApp {
  const db = openAccountDatabase(options.dbPath ?? DEFAULT_ACCOUNT_DB_PATH);
  return createAccountApp({
    rootAppId: options.rootAppId,
    flow: createAccountFlowStore(db),
    close: () => db.close(),
  });
}
