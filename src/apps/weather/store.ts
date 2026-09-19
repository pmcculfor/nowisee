import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openSqlite, type Db } from "../../node-kit/sqlite.ts";
import type { WeatherStore } from "./types.ts";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "db", "migrations");

export const DEFAULT_WEATHER_DB_PATH = "data/apps/weather.db";

export type SqliteWeatherStoreOptions = {
  /** Injected for tests; defaults to `() => new Date().toISOString()`. */
  readonly now?: () => string;
};

export function createSqliteWeatherStore(
  db: Db,
  options: SqliteWeatherStoreOptions = {},
): WeatherStore {
  const now = options.now ?? (() => new Date().toISOString());

  return {
    async getZip(userId) {
      const row = db.get<{ zip: string }>("SELECT zip FROM settings WHERE user_id = ?", userId);
      return row?.zip ?? null;
    },
    async setZip(userId, zip) {
      const ts = now();
      db.run(
        `INSERT INTO settings (user_id, zip, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET zip = excluded.zip, updated_at = excluded.updated_at`,
        userId,
        zip,
        ts,
      );
    },
  };
}

export function openWeatherDatabase(path: string = DEFAULT_WEATHER_DB_PATH): Db {
  return openSqlite({
    path,
    migrations: { dir: MIGRATIONS_DIR, files: ["001_weather.sql"] },
  });
}
