import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openSqlite, type Db } from "../../node-kit/sqlite.ts";
import type { HomeStore } from "./types.ts";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "db", "migrations");

export const DEFAULT_HOME_DB_PATH = "data/apps/home.db";

export function createSqliteHomeStore(db: Db): HomeStore {
  return {
    async list(ownerId) {
      const rows = db.all<{ app_id: string }>(
        `SELECT app_id FROM home_list
         WHERE owner_id = ?
         ORDER BY position ASC, app_id ASC`,
        ownerId,
      );
      return rows.map((row) => row.app_id);
    },
    async save(ownerId, appIds) {
      db.transaction(() => {
        db.run("DELETE FROM home_list WHERE owner_id = ?", ownerId);
        for (let i = 0; i < appIds.length; i++) {
          db.run(
            "INSERT INTO home_list (owner_id, app_id, position) VALUES (?, ?, ?)",
            ownerId,
            appIds[i]!,
            i,
          );
        }
      });
    },
  };
}

export function openHomeDatabase(path: string = DEFAULT_HOME_DB_PATH): Db {
  return openSqlite({
    path,
    migrations: { dir: MIGRATIONS_DIR, files: ["001_home.sql"] },
  });
}
