import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./index.ts";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

/** Ordered. Add a new file and a new entry — never edit an applied file. */
const MIGRATIONS: readonly string[] = ["001_identity.sql", "002_account_flow.sql"];

export function applyMigrations(db: Db): void {
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

  for (const [index, name] of MIGRATIONS.entries()) {
    if (applied.has(name)) {
      continue;
    }
    const sql = readFileSync(join(MIGRATIONS_DIR, name), "utf8");
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
