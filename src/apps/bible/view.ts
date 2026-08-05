import {
  buildMap,
  edgeAction,
  edgeNode,
  edgePop,
  rootBackToHome,
  siblingListEdges,
  type MapEntry,
  type MapFragment,
} from "../../app-kit/index.ts";
import type {
  AppLocation,
  NavigationMap,
  NodePayload,
  RefreshExtras,
  RefreshResult,
} from "../../core/types.ts";
import {
  bookPathSegment,
  booksForTestament,
  decodeBookSegment,
  findBook,
  formatRef,
  testamentLabel,
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
  const normalized = path === "" ? "/" : path;
  if (normalized === "/" || normalized === "/kjv") {
    return testamentId("OT");
  }

  const parts = normalized.replace(/^\/+/, "").split("/").filter(Boolean);
  // Expect kjv / Book / chapter / verse
  if (parts[0]?.toLowerCase() !== "kjv") {
    return testamentId("OT");
  }
  if (parts.length === 1) {
    return testamentId("OT");
  }

  const bookName = decodeBookSegment(parts[1]!);
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

export function buildBibleView(
  deps: BibleViewDeps,
  tipId: string,
  _extras: RefreshExtras = {},
): RefreshResult {
  const parsed = parseNodeId(tipId);
  if (!parsed) {
    return buildBibleView(deps, testamentId("OT"), _extras);
  }

  if (parsed.kind === "copy-status") {
    return buildIdleCopyStatus(deps, parsed.ref);
  }

  const payloads = new Map<string, NodePayload>();
  const fragments: Array<MapEntry | MapFragment> = [];

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
      addOptionLevel(deps, payloads, fragments, parsed.ref, parsed.option);
      break;
    case "commentary":
      addCommentaryLevel(deps, payloads, fragments, parsed.ref);
      break;
  }

  const tip = payloads.get(tipId) ?? tipPayload(deps, { kind: "testament", testament: "OT" });
  return {
    navigationMap: buildMap(...fragments) as NavigationMap,
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
        label: `${parsed.book} ${parsed.chapter}`,
      };
    case "verse": {
      const text = verseText(deps.data, parsed.ref) ?? "";
      return {
        id: verseId(parsed.ref),
        label: `${formatRef(parsed.ref)}. ${text}`,
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
  fragments: Array<MapEntry | MapFragment>,
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
        from: testamentId(t),
        intent: "enter",
        edge: edgeNode(bookId(first.name), "push"),
      });
    }
    fragments.push(rootBackToHome(testamentId(t), deps.rootAppId));
  }
  // Warm first few books of current testament
  for (const book of booksForTestament(deps.data, current).slice(0, 8)) {
    addNode(payloads, { id: bookId(book.name), label: book.name });
  }
  void current;
}

function addBookLevel(
  deps: BibleViewDeps,
  payloads: Map<string, NodePayload>,
  fragments: Array<MapEntry | MapFragment>,
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
    from: bookId(book.name),
    intent: "enter",
    edge: edgeNode(chapterId(book.name, 1), "push"),
  });
  fragments.push({
    from: bookId(book.name),
    intent: "back",
    edge: edgePop(),
  });
  // Warm chapter labels
  for (let ch = 1; ch <= Math.min(book.chapters.length, 12); ch++) {
    addNode(payloads, {
      id: chapterId(book.name, ch),
      label: `${book.name} ${ch}`,
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
  fragments: Array<MapEntry | MapFragment>,
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
    addNode(payloads, { id, label: `${book.name} ${ch}` });
  }
  fragments.push(siblingListEdges(ids, { wrap: false }));
  fragments.push({
    from: chapterId(book.name, chapter),
    intent: "enter",
    edge: edgeNode(verseId({ book: book.name, chapter, verse: 1 }), "push"),
  });
  fragments.push({
    from: chapterId(book.name, chapter),
    intent: "back",
    edge: edgePop(),
  });
  warmVerses(deps, payloads, book, chapter, 8);
  addNode(payloads, { id: bookId(book.name), label: book.name });
}

function addVerseLevel(
  deps: BibleViewDeps,
  payloads: Map<string, NodePayload>,
  fragments: Array<MapEntry | MapFragment>,
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
      label: `${formatRef(r)}. ${verses[v - 1]!}`,
    });
  }
  fragments.push(siblingListEdges(ids, { wrap: false }));
  const tip = verseId(ref);
  fragments.push({
    from: tip,
    intent: "enter",
    edge: edgeNode(optionId(ref, "copy"), "push"),
  });
  fragments.push({
    from: tip,
    intent: "back",
    edge: edgePop(),
  });
  addOptionPayloads(payloads, ref);
  addNode(payloads, {
    id: chapterId(book.name, ref.chapter),
    label: `${book.name} ${ref.chapter}`,
  });
}

function addOptionLevel(
  deps: BibleViewDeps,
  payloads: Map<string, NodePayload>,
  fragments: Array<MapEntry | MapFragment>,
  ref: BibleRef,
  option: "copy" | "commentary",
): void {
  void option;
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
    from: copy,
    intent: "enter",
    edge: edgeAction(copyStatusId(ref)),
  });
  fragments.push({
    from: commentary,
    intent: "enter",
    edge: edgeNode(commentaryId(ref), "push"),
  });
  fragments.push({
    from: copy,
    intent: "back",
    edge: edgePop(),
  });
  fragments.push({
    from: commentary,
    intent: "back",
    edge: edgePop(),
  });
}

function addCommentaryLevel(
  deps: BibleViewDeps,
  payloads: Map<string, NodePayload>,
  fragments: Array<MapEntry | MapFragment>,
  ref: BibleRef,
): void {
  addNode(payloads, tipPayload(deps, { kind: "commentary", ref }));
  addOptionPayloads(payloads, ref);
  fragments.push({
    from: commentaryId(ref),
    intent: "back",
    edge: edgePop(),
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
  deps: BibleViewDeps,
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
      label: `${formatRef(ref)}. ${verses[v - 1]!}`,
    });
  }
  void deps;
}

function buildIdleCopyStatus(deps: BibleViewDeps, ref: BibleRef): RefreshResult {
  const statusNodeId = copyStatusId(ref);
  const payloads = new Map<string, NodePayload>();
  addNode(payloads, { id: statusNodeId, label: "Copied" });
  addOptionPayloads(payloads, ref);
  addNode(payloads, tipPayload(deps, { kind: "verse", ref }));

  return {
    navigationMap: buildMap({
      from: statusNodeId,
      intent: "back",
      edge: edgePop(),
    }),
    warm: [...payloads.values()],
    node: { id: statusNodeId, label: "Copied" },
    location: null,
  };
}

/** Perform copy side effect and return status result. Only when extras.action. */
export async function resolveCopyStatus(
  deps: BibleViewDeps,
  ref: BibleRef,
  extras: RefreshExtras,
): Promise<RefreshResult> {
  const statusNodeId = copyStatusId(ref);
  let label = "Copied";
  const text = verseText(deps.data, ref);
  const line = text ? `${formatRef(ref)}. ${text}` : null;

  if (!line) {
    label = "Copy failed: verse not found.";
  } else if (!extras.platform?.clipboard) {
    label = "Copy failed: clipboard unavailable.";
  } else {
    try {
      await extras.platform.clipboard.writeText(line);
      label = "Copied";
    } catch {
      label = "Copy failed.";
    }
  }

  const payloads = new Map<string, NodePayload>();
  addNode(payloads, { id: statusNodeId, label });
  addOptionPayloads(payloads, ref);
  addNode(payloads, tipPayload(deps, { kind: "verse", ref }));

  return {
    navigationMap: buildMap({
      from: statusNodeId,
      intent: "back",
      edge: edgePop(),
    }),
    warm: [...payloads.values()],
    node: { id: statusNodeId, label },
    location: null,
  };
}
