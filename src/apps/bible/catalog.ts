/**
 * Bible catalogs: works, root headings, verse options, search policy.
 * Graph builders interpret these records; they do not name individual works.
 */

export type CanonBook = {
  readonly id: string;
  readonly label: string;
  readonly testament: string;
  readonly sort: number;
  readonly aliases: readonly string[];
};

export type VersionLicense = "public-domain" | "licensed";

export type VersionRecord = {
  readonly id: string;
  readonly label: string;
  readonly sortOrder: number;
  readonly license: VersionLicense;
  /** Path under raw/bibles/ to the VPL verse file. */
  readonly vplPath: string;
};

export type CommentaryFormat = "helloao-chapter-json" | "tsk-xref-table";

export type CommentaryRecord = {
  readonly id: string;
  readonly label: string;
  readonly sortOrder: number;
  readonly format: CommentaryFormat;
  /** Path under raw/commentaries/. */
  readonly sourcePath: string;
};

export type RootItem =
  | { readonly type: "testament"; readonly testament: string }
  | { readonly type: "bookmarks" }
  | { readonly type: "search" }
  | { readonly type: "versions" };

export type VerseOption =
  | { readonly type: "copy" }
  | { readonly type: "bookmark" }
  | { readonly type: "versions" }
  | { readonly type: "commentary" };

export type SearchPolicy = {
  readonly maxHits: number;
};

export type VerseSequence =
  | { readonly type: "chapter"; readonly versionId: string; readonly bookId: string; readonly chapter: number }
  | { readonly type: "bookmarks" }
  | { readonly type: "search"; readonly queryId: string };

export const SEARCH_POLICY: SearchPolicy = { maxHits: 50 };

export const TESTAMENT_LABELS: Readonly<Record<string, string>> = {
  OT: "Old Testament",
  NT: "New Testament",
};

export const ROOT_ITEMS: readonly RootItem[] = [
  { type: "testament", testament: "OT" },
  { type: "testament", testament: "NT" },
  { type: "bookmarks" },
  { type: "search" },
  { type: "versions" },
];

export const VERSE_OPTIONS: readonly VerseOption[] = [
  { type: "copy" },
  { type: "bookmark" },
  { type: "versions" },
  { type: "commentary" },
];

export const VERSION_RECORDS: readonly VersionRecord[] = [
  {
    id: "kjv",
    label: "King James Version",
    sortOrder: 0,
    license: "public-domain",
    vplPath: "kjv_vpl/eng-kjv2006_vpl.txt",
  },
  {
    id: "asv",
    label: "American Standard Version",
    sortOrder: 1,
    license: "public-domain",
    vplPath: "asv_vpl/eng-asv_vpl.txt",
  },
  {
    id: "bbe",
    label: "Bible in Basic English",
    sortOrder: 2,
    license: "public-domain",
    vplPath: "bbe_vpl/engBBE_vpl.txt",
  },
  {
    id: "ylt",
    label: "Young's Literal Translation",
    sortOrder: 3,
    license: "public-domain",
    vplPath: "ylt_vpl/engylt_vpl.txt",
  },
];

export const COMMENTARY_RECORDS: readonly CommentaryRecord[] = [
  {
    id: "tsk",
    label: "Treasury of Scripture Knowledge",
    sortOrder: 0,
    format: "tsk-xref-table",
    sourcePath: "tsk/tskxref.txt",
  },
  {
    id: "henry",
    label: "Matthew Henry",
    sortOrder: 1,
    format: "helloao-chapter-json",
    sourcePath: "matthew-henry",
  },
  {
    id: "jfb",
    label: "Jamieson, Fausset and Brown",
    sortOrder: 2,
    format: "helloao-chapter-json",
    sourcePath: "jamieson-fausset-brown",
  },
];

/** Protestant 66. `sort` matches TSK `book_key` (1-based). */
export const CANON_BOOKS: readonly CanonBook[] = [
  book("GEN", "Genesis", "OT", 1, ["Gen"]),
  book("EXO", "Exodus", "OT", 2, ["Exod", "Ex"]),
  book("LEV", "Leviticus", "OT", 3, ["Lev"]),
  book("NUM", "Numbers", "OT", 4, ["Num"]),
  book("DEU", "Deuteronomy", "OT", 5, ["Deut", "Deu"]),
  book("JOS", "Joshua", "OT", 6, ["Josh"]),
  book("JDG", "Judges", "OT", 7, ["Judg"]),
  book("RUT", "Ruth", "OT", 8, ["Ru"]),
  book("1SA", "1 Samuel", "OT", 9, ["1Sam", "1 Sam", "I Samuel"]),
  book("2SA", "2 Samuel", "OT", 10, ["2Sam", "2 Sam", "II Samuel"]),
  book("1KI", "1 Kings", "OT", 11, ["1Kgs", "1 Kings", "I Kings"]),
  book("2KI", "2 Kings", "OT", 12, ["2Kgs", "2 Kings", "II Kings"]),
  book("1CH", "1 Chronicles", "OT", 13, ["1Chr", "1 Chron", "I Chronicles"]),
  book("2CH", "2 Chronicles", "OT", 14, ["2Chr", "2 Chron", "II Chronicles"]),
  book("EZR", "Ezra", "OT", 15, []),
  book("NEH", "Nehemiah", "OT", 16, []),
  book("EST", "Esther", "OT", 17, []),
  book("JOB", "Job", "OT", 18, []),
  book("PSA", "Psalms", "OT", 19, ["Psalm", "Ps"]),
  book("PRO", "Proverbs", "OT", 20, ["Prov", "Pr"]),
  book("ECC", "Ecclesiastes", "OT", 21, ["Eccl", "Ecc"]),
  book("SNG", "Song of Solomon", "OT", 22, ["SOL", "Song of Songs", "Canticles", "Song"]),
  book("ISA", "Isaiah", "OT", 23, []),
  book("JER", "Jeremiah", "OT", 24, []),
  book("LAM", "Lamentations", "OT", 25, []),
  book("EZK", "Ezekiel", "OT", 26, ["EZE"]),
  book("DAN", "Daniel", "OT", 27, []),
  book("HOS", "Hosea", "OT", 28, []),
  book("JOL", "Joel", "OT", 29, ["JOE"]),
  book("AMO", "Amos", "OT", 30, []),
  book("OBA", "Obadiah", "OT", 31, []),
  book("JON", "Jonah", "OT", 32, []),
  book("MIC", "Micah", "OT", 33, []),
  book("NAM", "Nahum", "OT", 34, ["NAH"]),
  book("HAB", "Habakkuk", "OT", 35, []),
  book("ZEP", "Zephaniah", "OT", 36, []),
  book("HAG", "Haggai", "OT", 37, []),
  book("ZEC", "Zechariah", "OT", 38, []),
  book("MAL", "Malachi", "OT", 39, []),
  book("MAT", "Matthew", "NT", 40, ["Matt"]),
  book("MRK", "Mark", "NT", 41, ["MAR", "Mk"]),
  book("LUK", "Luke", "NT", 42, []),
  book("JHN", "John", "NT", 43, ["JOH", "Jn"]),
  book("ACT", "Acts", "NT", 44, []),
  book("ROM", "Romans", "NT", 45, []),
  book("1CO", "1 Corinthians", "NT", 46, ["1Cor", "1 Cor", "I Corinthians"]),
  book("2CO", "2 Corinthians", "NT", 47, ["2Cor", "2 Cor", "II Corinthians"]),
  book("GAL", "Galatians", "NT", 48, []),
  book("EPH", "Ephesians", "NT", 49, []),
  book("PHP", "Philippians", "NT", 50, ["PHI", "Phil"]),
  book("COL", "Colossians", "NT", 51, []),
  book("1TH", "1 Thessalonians", "NT", 52, ["1Thess", "1 Thess", "I Thessalonians"]),
  book("2TH", "2 Thessalonians", "NT", 53, ["2Thess", "2 Thess", "II Thessalonians"]),
  book("1TI", "1 Timothy", "NT", 54, ["1Tim", "1 Tim", "I Timothy"]),
  book("2TI", "2 Timothy", "NT", 55, ["2Tim", "2 Tim", "II Timothy"]),
  book("TIT", "Titus", "NT", 56, []),
  book("PHM", "Philemon", "NT", 57, ["Phlm"]),
  book("HEB", "Hebrews", "NT", 58, []),
  book("JAS", "James", "NT", 59, ["JAM", "Jas"]),
  book("1PE", "1 Peter", "NT", 60, ["1Pet", "1 Pet", "I Peter"]),
  book("2PE", "2 Peter", "NT", 61, ["2Pet", "2 Pet", "II Peter"]),
  book("1JN", "1 John", "NT", 62, ["1JO", "1Jn", "1 Jn", "I John"]),
  book("2JN", "2 John", "NT", 63, ["2JO", "2Jn", "2 Jn", "II John"]),
  book("3JN", "3 John", "NT", 64, ["3JO", "3Jn", "3 Jn", "III John"]),
  book("JUD", "Jude", "NT", 65, []),
  book("REV", "Revelation", "NT", 66, ["Rev"]),
];

const BOOKS_BY_ID = new Map(CANON_BOOKS.map((b) => [b.id, b]));
const BOOKS_BY_ALIAS = buildAliasMap();
const BOOKS_BY_SORT = new Map(CANON_BOOKS.map((b) => [b.sort, b]));

function book(
  id: string,
  label: string,
  testament: string,
  sort: number,
  extraAliases: readonly string[],
): CanonBook {
  return { id, label, testament, sort, aliases: extraAliases };
}

function buildAliasMap(): Map<string, CanonBook> {
  const map = new Map<string, CanonBook>();
  for (const b of CANON_BOOKS) {
    addAlias(map, b.id, b);
    addAlias(map, b.label, b);
    addAlias(map, b.label.replace(/\s+/g, ""), b);
    for (const alias of b.aliases) {
      addAlias(map, alias, b);
    }
  }
  return map;
}

function addAlias(map: Map<string, CanonBook>, raw: string, book: CanonBook): void {
  const key = normalizeBookToken(raw);
  const existing = map.get(key);
  if (existing && existing.id !== book.id) {
    throw new Error(`Canon alias collision: ${raw} (${existing.id} vs ${book.id})`);
  }
  map.set(key, book);
}

export function normalizeBookToken(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s._-]+/g, "");
}

export function getCanonBook(id: string): CanonBook | undefined {
  return BOOKS_BY_ID.get(id);
}

export function resolveBookToken(token: string): CanonBook | undefined {
  return BOOKS_BY_ALIAS.get(normalizeBookToken(token));
}

export function canonBookBySort(sort: number): CanonBook | undefined {
  return BOOKS_BY_SORT.get(sort);
}

export function verseOrd(bookSort: number, chapter: number, verse: number): number {
  return bookSort * 1_000_000 + chapter * 1_000 + verse;
}

export function testamentLabel(id: string): string {
  return TESTAMENT_LABELS[id] ?? id;
}

export function optionLabel(option: VerseOption["type"]): string {
  switch (option) {
    case "copy":
      return "Copy";
    case "bookmark":
      return "Bookmark";
    case "versions":
      return "Versions";
    case "commentary":
      return "Commentary";
  }
}
