/**
 * Full-corpus skip-rate check. Not part of the default unit suite.
 * Run: NOWISEE_BIBLE_AUDIT=1 npx vitest run tests/bible-import-audit.test.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseTsk } from "../src/apps/bible/import.ts";
import { parseTskCitationRanges } from "../src/apps/bible/tskCitations.ts";
import { parseHebrewStrongXml, parseStrongsGreekXml } from "../src/apps/bible/strongsXml.ts";
import { parseStrongsTsv } from "../src/apps/bible/usfmTokens.ts";

const RAW = join(dirname(fileURLToPath(import.meta.url)), "../src/apps/bible/data/raw");
const run = process.env.NOWISEE_BIBLE_AUDIT === "1";

describe.skipIf(!run)("Bible corpus import accounting", () => {
  it("keeps TSK, Strong's, and token skip rates inside tight bounds", () => {
    const tskPath = join(RAW, "commentaries/tsk/tskxref.txt");
    const greekPath = join(RAW, "dictionaries/strongs-greek.xml");
    const hebrewPath = join(RAW, "dictionaries/hebrewstrong.xml");
    const tokenPath = join(RAW, "alignments/kjv_strongs.tsv");
    expect(existsSync(tskPath)).toBe(true);
    expect(existsSync(greekPath)).toBe(true);
    expect(existsSync(hebrewPath)).toBe(true);

    const tskRows = parseTsk(readFileSync(tskPath, "utf8"));
    let citationTokens = 0;
    let citationSkipped = 0;
    let refRanges = 0;
    for (const row of tskRows) {
      const pieces = row.refs.split(";").map((part) => part.trim()).filter(Boolean);
      citationTokens += pieces.length;
      const ranges = parseTskCitationRanges(row.refs);
      refRanges += ranges.length;
      citationSkipped += Math.max(0, pieces.length - ranges.length);
    }
    const skipRate = citationTokens === 0 ? 1 : citationSkipped / citationTokens;
    expect(tskRows.length).toBeGreaterThan(50_000);
    expect(skipRate).toBeLessThan(0.05);

    const greek = parseStrongsGreekXml(readFileSync(greekPath, "utf8"));
    const hebrew = parseHebrewStrongXml(readFileSync(hebrewPath, "utf8"));
    expect(greek.length).toBeGreaterThan(5000);
    expect(hebrew.length).toBeGreaterThan(8000);

    expect(existsSync(tokenPath)).toBe(true);

    const tokens = parseStrongsTsv(readFileSync(tokenPath, "utf8"));
    const known = new Set([...greek, ...hebrew].map((entry) => entry.strongs));
    const missing = tokens.filter((token) => !known.has(token.strongs)).length;
    const missingRate = tokens.length === 0 ? 1 : missing / tokens.length;
    expect(tokens.length).toBeGreaterThan(300_000);
    expect(missingRate).toBeLessThan(0.01);
    expect(refRanges).toBeGreaterThan(tskRows.length);
  });
});
