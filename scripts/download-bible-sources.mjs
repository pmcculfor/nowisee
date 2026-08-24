/**
 * Download public-domain verse-aligned Bibles (eBible USFM + VPL) and
 * commentaries (HelloAO JSON + TSK plaintext xref + CrossWire SWORD zips).
 * Matthew Henry Song of Solomon is filled from LyteWord markdown (HelloAO omits it).
 * Raw files go in src/apps/bible/data/raw/ (gitignored).
 */
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = join(ROOT, "src/apps/bible/data/raw");

const BIBLES = [
  { id: "kjv", label: "King James Version (1769, 66 books)", url: "https://ebible.org/Scriptures/eng-kjv2006_usfm.zip", extra: "https://ebible.org/Scriptures/eng-kjv2006_vpl.zip" },
  { id: "asv", label: "American Standard Version (1901)", url: "https://ebible.org/Scriptures/eng-asv_usfm.zip", extra: "https://ebible.org/Scriptures/eng-asv_vpl.zip" },
  { id: "bbe", label: "Bible in Basic English", url: "https://ebible.org/Scriptures/engBBE_usfm.zip", extra: "https://ebible.org/Scriptures/engBBE_vpl.zip" },
  { id: "ylt", label: "Young's Literal Translation (1898)", url: "https://ebible.org/Scriptures/engylt_usfm.zip", extra: "https://ebible.org/Scriptures/engylt_vpl.zip" },
];

const HELLOAO = "https://bible.helloao.org";
const COMMENTARIES = ["matthew-henry", "jamieson-fausset-brown"];

const SWORD = [
  { id: "tsk", url: "https://www.crosswire.org/ftpmirror/pub/sword/packages/rawzip/TSK.zip" },
  { id: "mhc", url: "https://www.crosswire.org/ftpmirror/pub/sword/packages/rawzip/MHC.zip" },
  { id: "jfb", url: "https://www.crosswire.org/ftpmirror/pub/sword/packages/rawzip/JFB.zip" },
];

const TSK_XREF = "https://raw.githubusercontent.com/ariseshinestudio/TSK/main/tskxref.txt";
const TSK_README = "https://raw.githubusercontent.com/ariseshinestudio/TSK/main/readme.txt";
const HENRY_SNG_BASE =
  "https://raw.githubusercontent.com/lyteword/mhenry-complete/main/volume-3/song-of-solomon";
const SUPER = Object.fromEntries([..."⁰¹²³⁴⁵⁶⁷⁸⁹"].map((ch, i) => [ch, String(i)]));

async function download(url, dest) {
  console.log("GET", url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await mkdir(dirname(dest), { recursive: true });
  if (!res.body) throw new Error(`no body ${url}`);
  await pipeline(res.body, createWriteStream(dest));
  console.log(" wrote", dest);
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function mapPool(items, limit, fn) {
  const q = [...items];
  const workers = Array.from({ length: Math.min(limit, q.length) }, async () => {
    while (q.length) {
      const item = q.shift();
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function downloadBibles() {
  const dir = join(RAW, "bibles");
  await mkdir(dir, { recursive: true });
  for (const b of BIBLES) {
    await download(b.url, join(dir, `${b.id}_usfm.zip`));
    await download(b.extra, join(dir, `${b.id}_vpl.zip`));
  }
}

async function downloadSword() {
  const dir = join(RAW, "sword");
  await mkdir(dir, { recursive: true });
  for (const s of SWORD) {
    await download(s.url, join(dir, `${s.id}.zip`));
  }
}

async function downloadHelloAoCommentary(id) {
  const dir = join(RAW, "commentaries", id);
  await mkdir(dir, { recursive: true });
  const books = await getJson(`${HELLOAO}/api/c/${id}/books.json`);
  await writeFile(join(dir, "books.json"), JSON.stringify(books));
  const bookList = books.books ?? books;
  const jobs = [];
  for (const book of bookList) {
    const bookId = book.id ?? book.book;
    const chapters = book.numberOfChapters ?? book.chapterCount ?? 0;
    const first = book.firstChapterNumber ?? 1;
    for (let ch = first; ch < first + chapters; ch++) {
      jobs.push({ bookId, ch });
    }
  }
  console.log(id, "chapters", jobs.length);
  await mapPool(jobs, 8, async ({ bookId, ch }) => {
    const url = `${HELLOAO}/api/c/${id}/${bookId}/${ch}.json`;
    const dest = join(dir, bookId, `${ch}.json`);
    try {
      await download(url, dest);
    } catch (err) {
      console.warn("skip", url, err.message);
    }
  });
}

async function getText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function superToInt(raw) {
  const digits = [...raw].map((ch) => SUPER[ch] ?? ch).join("");
  return Number.parseInt(digits, 10);
}

function stripMd(text) {
  return text
    .replace(/\\\./g, ".")
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_(?!\s)([^_]+)_(?!\w)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function parseHenryChapterMd(md) {
  let body = md.replace(/^---[\s\S]*?---\s*/, "");
  body = body.replace(/^# .+\n+/, "");
  const introEnd = body.search(/\n## /);
  const introduction = stripMd(introEnd === -1 ? body : body.slice(0, introEnd));
  const rest = introEnd === -1 ? "" : body.slice(introEnd + 1);
  const sections = rest.split(/\n(?=## )/);
  const content = [];
  for (const section of sections) {
    const verseMarks = [...section.matchAll(/> \*\*([0-9⁰¹²³⁴⁵⁶⁷⁸⁹]+)\*\*/g)];
    if (verseMarks.length === 0) continue;
    const number = superToInt(verseMarks[0][1]);
    if (!Number.isFinite(number)) continue;
    const commentary = section
      .replace(/^## .+\n/, "")
      .replace(/^> .*(?:\n|$)/gm, "")
      .trim();
    const text = stripMd(commentary);
    if (!text) continue;
    content.push({ type: "verse", number, content: [text] });
  }
  return { introduction, content };
}

function henryBookStub(introduction, sectionCount) {
  return {
    id: "SNG",
    commentaryId: "matthew-henry",
    name: "Song of Songs",
    commonName: "Song of Songs",
    introduction,
    order: 22,
    numberOfChapters: 8,
    sha256: "",
    firstChapterNumber: 1,
    firstChapterApiLink: "/api/c/matthew-henry/SNG/1.json",
    firstChapterReference: { commentaryId: "matthew-henry", book: "SNG", chapter: 1 },
    lastChapterNumber: 8,
    lastChapterApiLink: "/api/c/matthew-henry/SNG/8.json",
    lastChapterReference: { commentaryId: "matthew-henry", book: "SNG", chapter: 8 },
    totalNumberOfVerses: sectionCount,
  };
}

async function patchJson(path, fn) {
  const data = JSON.parse(await readFile(path, "utf8"));
  fn(data);
  await writeFile(path, JSON.stringify(data));
}

async function fillHenrySongOfSolomon() {
  const henryDir = join(RAW, "commentaries", "matthew-henry");
  const sngDir = join(henryDir, "SNG");
  await mkdir(sngDir, { recursive: true });
  const indexMd = await getText(`${HENRY_SNG_BASE}/_index.md`);
  let introSrc = indexMd.replace(/^---[\s\S]*?---\s*/, "");
  const introAt = introSrc.search(/^## Introduction\s*$/m);
  if (introAt >= 0) introSrc = introSrc.slice(introAt).replace(/^## Introduction\s*/, "");
  const bookIntro = stripMd(introSrc);
  const chapters = [];
  for (let ch = 1; ch <= 8; ch++) {
    const md = await getText(`${HENRY_SNG_BASE}/chapter-${ch}.md`);
    chapters.push({ ch, ...parseHenryChapterMd(md) });
  }
  const template = JSON.parse(await readFile(join(henryDir, "ECC", "1.json"), "utf8"));
  const commentary = {
    ...template.commentary,
    numberOfBooks: 66,
    totalNumberOfChapters: (template.commentary.totalNumberOfChapters ?? 1167) + 8,
  };
  const book = henryBookStub(
    bookIntro,
    chapters.reduce((n, c) => n + c.content.length, 0),
  );

  for (const { ch, introduction, content } of chapters) {
    const prev =
      ch === 1
        ? { book: "ECC", chapter: 12 }
        : { book: "SNG", chapter: ch - 1 };
    const next =
      ch === 8
        ? { book: "ISA", chapter: 1 }
        : { book: "SNG", chapter: ch + 1 };
    const json = {
      commentary,
      book,
      chapter: { number: ch, content, introduction },
      thisChapterLink: `/api/c/matthew-henry/SNG/${ch}.json`,
      thisChapterReference: { commentaryId: "matthew-henry", book: "SNG", chapter: ch },
      nextChapterApiLink: `/api/c/matthew-henry/${next.book}/${next.chapter}.json`,
      nextChapterReference: { commentaryId: "matthew-henry", book: next.book, chapter: next.chapter },
      previousChapterApiLink: `/api/c/matthew-henry/${prev.book}/${prev.chapter}.json`,
      previousChapterReference: { commentaryId: "matthew-henry", book: prev.book, chapter: prev.chapter },
      numberOfVerses: content.length,
      simpleChapterApiLink: `/api/c/matthew-henry/SNG/${ch}.simple.json`,
    };
    await writeFile(join(sngDir, `${ch}.json`), JSON.stringify(json));
  }

  await patchJson(join(henryDir, "books.json"), (data) => {
    const list = data.books ?? data;
    if (list.some((b) => (b.id ?? b.book) === "SNG")) return;
    const eccIdx = list.findIndex((b) => (b.id ?? b.book) === "ECC");
    const insertAt = eccIdx === -1 ? list.length : eccIdx + 1;
    const entry = henryBookStub(bookIntro, book.totalNumberOfVerses);
    list.splice(insertAt, 0, entry);
    if (data.commentary) {
      data.commentary.numberOfBooks = (data.commentary.numberOfBooks ?? 65) + 1;
      data.commentary.totalNumberOfChapters = (data.commentary.totalNumberOfChapters ?? 1167) + 8;
    }
  });

  await patchJson(join(henryDir, "ECC", "12.json"), (data) => {
    data.nextChapterApiLink = "/api/c/matthew-henry/SNG/1.json";
    data.nextChapterReference = { commentaryId: "matthew-henry", book: "SNG", chapter: 1 };
  });
  await patchJson(join(henryDir, "ISA", "1.json"), (data) => {
    data.previousChapterApiLink = "/api/c/matthew-henry/SNG/8.json";
    data.previousChapterReference = { commentaryId: "matthew-henry", book: "SNG", chapter: 8 };
  });
  console.log("matthew-henry SNG filled", book.totalNumberOfVerses, "sections");
}

const what = process.argv[2] ?? "all";
await mkdir(RAW, { recursive: true });
if (what === "all" || what === "bibles") await downloadBibles();
if (what === "all" || what === "sword") await downloadSword();
if (what === "all" || what === "commentaries") {
  for (const id of COMMENTARIES) await downloadHelloAoCommentary(id);
  const tskDir = join(RAW, "commentaries", "tsk");
  await mkdir(tskDir, { recursive: true });
  await download(TSK_XREF, join(tskDir, "tskxref.txt"));
  await download(TSK_README, join(tskDir, "readme.txt"));
  await fillHenrySongOfSolomon();
}
if (what === "sng") await fillHenrySongOfSolomon();
console.log("done");
