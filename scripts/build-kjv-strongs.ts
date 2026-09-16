/**
 * Rebuild raw/alignments/kjv_strongs.tsv from eBible KJV USFM (gitignored zip/dir).
 * No-op when the USFM directory is missing.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatStrongsTsv, parseUsfmBook } from "../src/apps/bible/usfmTokens.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const USFM_DIR = join(ROOT, "src/apps/bible/data/raw/bibles/kjv_usfm");
const OUT = join(ROOT, "src/apps/bible/data/raw/alignments/kjv_strongs.tsv");

if (!existsSync(USFM_DIR)) {
  console.warn("skip kjv_strongs.tsv: missing", USFM_DIR);
  process.exit(0);
}

const files = readdirSync(USFM_DIR)
  .filter((name) => name.toLowerCase().endsWith(".usfm"))
  .sort();
const tokens = files.flatMap((name) => parseUsfmBook(readFileSync(join(USFM_DIR, name), "utf8")));
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, formatStrongsTsv(tokens));
console.log("wrote", OUT, "rows", tokens.length);
