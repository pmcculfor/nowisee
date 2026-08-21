import {
  buildMap,
  edgeAction,
  edgeNode,
  edgePop,
  rootBackToHome,
  siblingListEdges,
  type MapFragment,
} from "../../app-kit/index.ts";
import type {
  AppLocation,
  NodePayload,
  RefreshResult,
} from "../../core/types.ts";
import {
  bookPathSegment,
  booksForTestament,
  chapterLabel,
  decodeBookSegment,
  findBook,
  formatRef,
  testamentLabel,
  verseLabel,
  verseText,
} from "./canon.ts";
import {
  bookId,
  chapterId,
  commentaryId,
  copyStatusId,
  optionId,
  parseNodeId,
  testamentId,
  verseId,
  type ParsedNode,
} from "./ids.ts";
import type { BibleRef, KjvBook, KjvData, TestamentId } from "./types.ts";

const TESTAMENTS: TestamentId[] = ["OT", "NT"];

export type BibleViewDeps = {
  readonly data: KjvData;
  readonly rootAppId: string;
};

export function parseBiblePath(data: KjvData, path: string): string {
  if (path === "/" || path === "/kjv") {
    return testamentId("OT");
  }

  const parts = path.replace(/^\/+/, "").split("/").filter(Boolean);
  // Expect kjv / Book / chapter / verse
  if (parts[0]?.toLowerCase() !== "kjv") {
    return testamentId("OT");
  }
  if (parts.length === 1) {
    return testamentId("OT");
  }

  const bookName = decodeBookSegment(parts[1]!);
  if (bookName === null) {
    return testamentId("OT");
  }
  const book = findBook(data, bookName);
  if (!book) {
    return testamentId("OT");
  }
  if (parts.length === 2) {
    return bookId(book.name);
  }

  const chapter = Number(parts[2]);
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > book.chapters.length) {
    return bookId(book.name);
  }
  if (parts.length === 3) {
    return chapterId(book.name, chapter);
  }

  const verse = Number(parts[3]);
  const verseCount = book.chapters[chapter - 1]?.length ?? 0;
  if (!Number.isInteger(verse) || verse < 1 || verse > verseCount) {
    return chapterId(book.name, chapter);
  }
  return verseId({ book: book.name, chapter, verse });
}

export function buildBibleView(deps: BibleViewDeps, tipId: string): RefreshResult {
  const parsed = parseNodeId(tipId);
  if (!parsed) {
    return buildBibleView(deps, testamentId("OT"));
  }

  if (parsed.kind === "copy-status") {
    return buildIdleCopyStatus(deps, parsed.ref);
  }

  const payloads = new Map<string, NodePayload>();
  const fragments: MapFragment[] = [];

  addNode(payloads, tipPayload(deps, parsed));

  switch (parsed.kind) {
    case "testament":
      addTestamentLevel(deps, payloads, fragments, parsed.testament);
      break;
    case "book":
      addBookLevel(deps, payloads, fragments, parsed.book);
      break;
    case "chapter":
      addChapterLevel(deps, payloads, fragments, parsed.book, parsed.chapter);
      break;
    case "verse":
      addVerseLevel(deps, payloads, fragments, parsed.ref);
      break;
    case "option":
      addOptionLevel(deps, payloads, fragments, parsed.ref);
      break;
    case "commentary":
      addCommentaryLevel(deps, payloads, fragments, parsed.ref);
      break;
  }

  const tip = payloads.get(tipId) ?? tipPayload(deps, { kind: "testament", testament: "OT" });
  return {
    navigationMap: buildMap(...fragments),
    warm: [...payloads.values()],
    node: tip,
    location: locationFor(parsed),
  };
}

function locationFor(parsed: ParsedNode): AppLocation | null {
  switch (parsed.kind) {
    case "testament":
      return { appId: "bible", path: "/kjv" };
    case "book":
      return { appId: "bible", path: `/kjv/${bookPathSegment(parsed.book)}` };
    case "chapter":
      return {
        appId: "bible",
        path: `/kjv/${bookPathSegment(parsed.book)}/${parsed.chapter}`,
      };
    case "verse":
      return {
        appId: "bible",
        path: `/kjv/${bookPathSegment(parsed.ref.book)}/${parsed.ref.chapter}/${parsed.ref.verse}`,
      };
    case "option":
    case "commentary":
      return {
        appId: "bible",
        path: `/kjv/${bookPathSegment(parsed.ref.book)}/${parsed.ref.chapter}/${parsed.ref.verse}`,
      };
    case "copy-status":
      return null;
  }
}

function tipPayload(deps: BibleViewDeps, parsed: ParsedNode): NodePayload {
  switch (parsed.kind) {
    case "testament":
      return { id: testamentId(parsed.testament), label: testamentLabel(parsed.testament) };
    case "book":
      return { id: bookId(parsed.book), label: parsed.book };
    case "chapter":
      return {
        id: chapterId(parsed.book, parsed.chapter),
        label: chapterLabel(parsed.chapter),
      };
    case "verse": {
      const text = verseText(deps.data, parsed.ref) ?? "";
      return {
        id: verseId(parsed.ref),
        label: verseLabel(parsed.ref.verse, text),
      };
    }
    case "option":
      return {
        id: optionId(parsed.ref, parsed.option),
        label: parsed.option === "copy" ? "Copy" : "Commentary",
      };
    case "copy-status":
      return { id: copyStatusId(parsed.ref), label: "Copying…" };
    case "commentary":
      return {
        id: commentaryId(parsed.ref),
        label: `Commentary for ${formatRef(parsed.ref)} is not available yet.`,
      };
  }
}

function addNode(payloads: Map<string, NodePayload>, node: NodePayload): void {
  payloads.set(node.id, node);
}

function addTestamentLevel(
  deps: BibleViewDeps,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  current: TestamentId,
): void {
  const ids = TESTAMENTS.map(testamentId);
  for (const t of TESTAMENTS) {
    addNode(payloads, {
      id: testamentId(t),
      label: testamentLabel(t),
    });
  }
  fragments.push(siblingListEdges(ids, { wrap: true }));
  for (const t of TESTAMENTS) {
    const books = booksForTestament(deps.data, t);
    const first = books[0];
    if (first) {
      fragments.push({
        [testamentId(t)]: { enter: edgeNode(bookId(first.name), "push") },
      });
    }
    fragments.push(rootBackToHome(testamentId(t), deps.rootAppId));
  }
  // Warm first few books of current testament
  for (const book of booksForTestament(deps.data, current).slice(0, 8)) {
    addNode(payloads, { id: bookId(book.name), label: book.name });
  }
}

function addBookLevel(
  deps: BibleViewDeps,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  bookName: string,
): void {
  const book = findBook(deps.data, bookName);
  if (!book) {
    addTestamentLevel(deps, payloads, fragments, "OT");
    return;
  }
  const siblings = booksForTestament(deps.data, book.testament);
  const ids = siblings.map((b) => bookId(b.name));
  for (const b of siblings) {
    addNode(payloads, { id: bookId(b.name), label: b.name });
  }
  fragments.push(siblingListEdges(ids, { wrap: true }));
  fragments.push({
    [bookId(book.name)]: {
      enter: edgeNode(chapterId(book.name, 1), "push"),
      back: edgePop(),
    },
  });
  // Warm chapter labels
  for (let ch = 1; ch <= Math.min(book.chapters.length, 12); ch++) {
    addNode(payloads, {
      id: chapterId(book.name, ch),
      label: chapterLabel(ch),
    });
  }
  // Ensure testament parent warm
  addNode(payloads, {
    id: testamentId(book.testament),
    label: testamentLabel(book.testament),
  });
}

function addChapterLevel(
  deps: BibleViewDeps,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  bookName: string,
  chapter: number,
): void {
  const book = findBook(deps.data, bookName);
  if (!book) {
    addTestamentLevel(deps, payloads, fragments, "OT");
    return;
  }
  const chapterCount = book.chapters.length;
  const ids: string[] = [];
  for (let ch = 1; ch <= chapterCount; ch++) {
    const id = chapterId(book.name, ch);
    ids.push(id);
    addNode(payloads, { id, label: chapterLabel(ch) });
  }
  fragments.push(siblingListEdges(ids, { wrap: true }));
  fragments.push({
    [chapterId(book.name, chapter)]: {
      // Replace so verse↔verse chapter joins keep a clean [book, verse] stack.
      enter: edgeNode(verseId({ book: book.name, chapter, verse: 1 }), "replace"),
      back: edgePop(),
    },
  });
  warmVerses(payloads, book, chapter, 8);
  addNode(payloads, { id: bookId(book.name), label: book.name });
}

function addVerseLevel(
  deps: BibleViewDeps,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  ref: BibleRef,
): void {
  const book = findBook(deps.data, ref.book);
  if (!book) {
    addTestamentLevel(deps, payloads, fragments, "OT");
    return;
  }
  const verses = book.chapters[ref.chapter - 1] ?? [];
  const ids: string[] = [];
  for (let v = 1; v <= verses.length; v++) {
    const r = { book: book.name, chapter: ref.chapter, verse: v };
    const id = verseId(r);
    ids.push(id);
    addNode(payloads, {
      id,
      label: verseLabel(v, verses[v - 1]!),
    });
  }
  fragments.push(siblingListEdges(ids, { wrap: false }));

  // Last verse → first of next chapter; first verse ← last of previous chapter.
  const tip = verseId(ref);
  const lastVerse = verses.length;
  if (lastVerse > 0 && ref.chapter < book.chapters.length) {
    const nextRef = { book: book.name, chapter: ref.chapter + 1, verse: 1 };
    const nextText = book.chapters[ref.chapter]?.[0];
    fragments.push({
      [verseId({ book: book.name, chapter: ref.chapter, verse: lastVerse })]: {
        next: edgeNode(verseId(nextRef), "replace"),
      },
    });
    if (nextText !== undefined) {
      addNode(payloads, {
        id: verseId(nextRef),
        label: verseLabel(1, nextText),
      });
    }
  }
  if (ref.chapter > 1) {
    const prevChapterVerses = book.chapters[ref.chapter - 2] ?? [];
    const prevLast = prevChapterVerses.length;
    if (prevLast > 0) {
      const prevRef = {
        book: book.name,
        chapter: ref.chapter - 1,
        verse: prevLast,
      };
      fragments.push({
        [verseId({ book: book.name, chapter: ref.chapter, verse: 1 })]: {
          prev: edgeNode(verseId(prevRef), "replace"),
        },
      });
      addNode(payloads, {
        id: verseId(prevRef),
        label: verseLabel(prevLast, prevChapterVerses[prevLast - 1]!),
      });
    }
  }

  fragments.push({
    [tip]: {
      enter: edgeNode(optionId(ref, "copy"), "push"),
      // Replace to this verse's chapter (works after cross-chapter joins).
      back: edgeNode(chapterId(book.name, ref.chapter), "replace"),
    },
  });
  addOptionPayloads(payloads, ref);
  addNode(payloads, {
    id: chapterId(book.name, ref.chapter),
    label: chapterLabel(ref.chapter),
  });
}

function addOptionLevel(
  deps: BibleViewDeps,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  ref: BibleRef,
): void {
  const copy = optionId(ref, "copy");
  const commentary = optionId(ref, "commentary");
  addOptionPayloads(payloads, ref);
  addNode(payloads, tipPayload(deps, { kind: "verse", ref }));
  addNode(payloads, {
    id: copyStatusId(ref),
    label: "Copying…",
  });
  addNode(payloads, tipPayload(deps, { kind: "commentary", ref }));

  fragments.push(siblingListEdges([copy, commentary], { wrap: true }));
  fragments.push({
    [copy]: {
      enter: edgeAction(copyStatusId(ref)),
      back: edgePop(),
    },
    [commentary]: {
      enter: edgeNode(commentaryId(ref), "push"),
      back: edgePop(),
    },
  });
}

function addCommentaryLevel(
  deps: BibleViewDeps,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  ref: BibleRef,
): void {
  addNode(payloads, tipPayload(deps, { kind: "commentary", ref }));
  addOptionPayloads(payloads, ref);
  fragments.push({
    [commentaryId(ref)]: { back: edgePop() },
  });
}

function addOptionPayloads(payloads: Map<string, NodePayload>, ref: BibleRef): void {
  addNode(payloads, {
    id: optionId(ref, "copy"),
    label: "Copy",
  });
  addNode(payloads, {
    id: optionId(ref, "commentary"),
    label: "Commentary",
  });
}

function warmVerses(
  payloads: Map<string, NodePayload>,
  book: KjvBook,
  chapter: number,
  max: number,
): void {
  const verses = book.chapters[chapter - 1] ?? [];
  for (let v = 1; v <= Math.min(verses.length, max); v++) {
    const ref = { book: book.name, chapter, verse: v };
    addNode(payloads, {
      id: verseId(ref),
      label: verseLabel(v, verses[v - 1]!),
    });
  }
}

function buildIdleCopyStatus(deps: BibleViewDeps, ref: BibleRef): RefreshResult {
  const statusNodeId = copyStatusId(ref);
  const payloads = new Map<string, NodePayload>();
  addNode(payloads, { id: statusNodeId, label: "Copied" });
  addOptionPayloads(payloads, ref);
  addNode(payloads, tipPayload(deps, { kind: "verse", ref }));

  return {
    navigationMap: buildMap({
      [statusNodeId]: { back: edgePop() },
    }),
    warm: [...payloads.values()],
    node: { id: statusNodeId, label: "Copied" },
    location: null,
  };
}

/**
 * Copy action: return the verse line for the client to copy.
 * The app never writes the clipboard.
 */
export function resolveCopyStatus(deps: BibleViewDeps, ref: BibleRef): RefreshResult {
  const statusNodeId = copyStatusId(ref);
  const text = verseText(deps.data, ref);
  const line = text ? `${formatRef(ref)}. ${text}` : null;
  const label = line ? "Copied" : "Copy failed: verse not found.";

  const payloads = new Map<string, NodePayload>();
  addNode(payloads, { id: statusNodeId, label });
  addOptionPayloads(payloads, ref);
  addNode(payloads, tipPayload(deps, { kind: "verse", ref }));

  return {
    navigationMap: buildMap({
      [statusNodeId]: { back: edgePop() },
    }),
    warm: [...payloads.values()],
    node: { id: statusNodeId, label },
    location: null,
    ...(line ? { clipboardText: line } : {}),
  };
}
