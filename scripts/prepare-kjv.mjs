import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const NAMES = [
  "Genesis",
  "Exodus",
  "Leviticus",
  "Numbers",
  "Deuteronomy",
  "Joshua",
  "Judges",
  "Ruth",
  "1 Samuel",
  "2 Samuel",
  "1 Kings",
  "2 Kings",
  "1 Chronicles",
  "2 Chronicles",
  "Ezra",
  "Nehemiah",
  "Esther",
  "Job",
  "Psalms",
  "Proverbs",
  "Ecclesiastes",
  "Song of Solomon",
  "Isaiah",
  "Jeremiah",
  "Lamentations",
  "Ezekiel",
  "Daniel",
  "Hosea",
  "Joel",
  "Amos",
  "Obadiah",
  "Jonah",
  "Micah",
  "Nahum",
  "Habakkuk",
  "Zephaniah",
  "Haggai",
  "Zechariah",
  "Malachi",
  "Matthew",
  "Mark",
  "Luke",
  "John",
  "Acts",
  "Romans",
  "1 Corinthians",
  "2 Corinthians",
  "Galatians",
  "Ephesians",
  "Philippians",
  "Colossians",
  "1 Thessalonians",
  "2 Thessalonians",
  "1 Timothy",
  "2 Timothy",
  "Titus",
  "Philemon",
  "Hebrews",
  "James",
  "1 Peter",
  "2 Peter",
  "1 John",
  "2 John",
  "3 John",
  "Jude",
  "Revelation",
];

function clean(text) {
  return text
    .replace(/\{[^}]*\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const rawText = readFileSync("public/data/kjv.raw.json", "utf8").replace(/^\uFEFF/, "");
const raw = JSON.parse(rawText);

if (raw.length !== 66) {
  throw new Error(`expected 66 books, got ${raw.length}`);
}

const books = raw.map((book, i) => ({
  name: NAMES[i],
  abbrev: book.abbrev,
  testament: i < 39 ? "OT" : "NT",
  chapters: book.chapters.map((ch) => ch.map(clean)),
}));

const out = { translation: "KJV", books };
mkdirSync("src/apps/bible/data", { recursive: true });
mkdirSync("public/data", { recursive: true });
const json = JSON.stringify(out);
writeFileSync("src/apps/bible/data/kjv.json", json);
writeFileSync("public/data/kjv.json", json);
console.log("books", books.length, "gen1v1", books[0].chapters[0][0]);
console.log("bytes", Buffer.byteLength(json));
