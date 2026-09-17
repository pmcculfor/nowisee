/**
 * Rebuild raw/alignments/kjv_strongs.tsv from eBible KJV USFM (gitignored zip/dir).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatStrongsTsv, parseUsfmBook } from "../src/apps/bible/usfmTokens.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const USFM_DIR = join(ROOT, "src/apps/bible/data/raw/bibles/kjv_usfm");
const OUT = join(ROOT, "src/apps/bible/data/raw/alignments/kjv_strongs.tsv");

if (!existsSync(USFM_DIR)) {
  throw new Error(`kjv_strongs.tsv: missing USFM directory ${USFM_DIR}`);
}

const files = readdirSync(USFM_DIR)
  .filter((name) => name.toLowerCase().endsWith(".usfm"))
  .sort();
if (files.length === 0) {
  throw new Error(`kjv_strongs.tsv: no .usfm files in ${USFM_DIR}`);
}
const tokens = files.flatMap((name) => parseUsfmBook(readFileSync(join(USFM_DIR, name), "utf8")));
if (tokens.length === 0) {
  throw new Error(`kjv_strongs.tsv: parsed no tokens from ${USFM_DIR}`);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, formatStrongsTsv(tokens));
console.log("wrote", OUT, "rows", tokens.length);
