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
  chapterLabel,
  decodeBookSegment,
  formatRef,
  testamentLabel,
  verseLabel,
} from "./canon.ts";
import {
  bookId,
  bookmarkStubId,
  bookmarksId,
  bookmarksStubId,
  chapterId,
  commentaryId,
  copyStatusId,
  optionId,
  parseNodeId,
  searchId,
  searchStubId,
  testamentId,
  verseId,
  type ParsedNode,
} from "./ids.ts";
import type { BibleStore } from "./types.ts";
import type { BibleRef, VerseOption } from "./types.ts";

const VERSE_OPTIONS: readonly VerseOption[] = ["copy", "bookmark", "commentary"];

const OPTION_LABEL: Record<VerseOption, string> = {
  copy: "Copy",
  bookmark: "Bookmark",
  commentary: "Commentary",
};

export type BibleViewDeps = {
  readonly store: BibleStore;
  readonly rootAppId: string;
};

export function parseBiblePath(store: BibleStore, path: string): string {
  const parts = path.replace(/^\/+/, "").split("/").filter(Boolean);
  if (parts[0] === "bookmarks") {
    return bookmarksId();
  }
  if (parts[0] === "search") {
    return searchId();
  }

  const defaultVersion = store.defaultVersionId();
  if (parts.length === 0) {
    return firstTestamentTip(store, defaultVersion);
  }

  const versionPart = parts[0]!;
  const version = store.getVersion(versionPart)?.id ?? defaultVersion;
  if (!version || !store.getVersion(versionPart)) {
    return firstTestamentTip(store, version);
  }

  if (parts.length === 1) {
    return firstTestamentTip(store, version);
  }

  const bookName = decodeBookSegment(parts[1]!);
  if (bookName === null) {
    return firstTestamentTip(store, version);
  }
  const book = store.getBook(version, bookName);
  if (!book) {
    return firstTestamentTip(store, version);
  }
  if (parts.length === 2) {
    return bookId(version, book.name);
  }

  const chapter = Number(parts[2]);
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > book.chapterCount) {
    return bookId(version, book.name);
  }
  if (parts.length === 3) {
    return chapterId(version, book.name, chapter);
  }

  const verse = Number(parts[3]);
  const verseCount = store.verseCount(version, book.name, chapter);
  if (!Number.isInteger(verse) || verse < 1 || verse > verseCount) {
    return chapterId(version, book.name, chapter);
  }
  return verseId({ version, book: book.name, chapter, verse });
}

function firstTestamentTip(store: BibleStore, version: string | null): string {
  if (!version) {
    return emptyId();
  }
  const testaments = store.listTestaments(version);
  const first = testaments[0];
  if (!first) {
    return emptyId();
  }
  return testamentId(version, first);
}

function emptyId(): string {
  return "bible:empty";
}

export function buildBibleView(deps: BibleViewDeps, tipId: string): RefreshResult {
  if (tipId === emptyId()) {
    return emptyBibleView(deps);
  }

  const parsed = parseNodeId(tipId);
  if (!parsed) {
    return buildBibleView(deps, firstTestamentTip(deps.store, deps.store.defaultVersionId()));
  }

  if (parsed.kind === "copy-status") {
    return buildIdleCopyStatus(deps, parsed.ref);
  }

  const payloads = new Map<string, NodePayload>();
  const fragments: MapFragment[] = [];

  addNode(payloads, tipPayload(deps, parsed));

  switch (parsed.kind) {
    case "testament":
    case "bookmarks":
    case "search":
      addRootLevel(deps, payloads, fragments, parsed);
      break;
    case "bookmarks-stub":
      addSimpleStub(payloads, fragments, bookmarksStubId(), bookmarksId());
      break;
    case "search-stub":
      addSimpleStub(payloads, fragments, searchStubId(), searchId());
      break;
    case "book":
      addBookLevel(deps, payloads, fragments, parsed.version, parsed.book);
      break;
    case "chapter":
      addChapterLevel(deps, payloads, fragments, parsed.version, parsed.book, parsed.chapter);
      break;
    case "verse":
      addVerseLevel(deps, payloads, fragments, parsed.ref);
      break;
    case "option":
      addOptionLevel(deps, payloads, fragments, parsed.ref);
      break;
    case "commentary":
      addVerseStubLevel(deps, payloads, fragments, parsed.ref, "commentary");
      break;
    case "bookmark":
      addVerseStubLevel(deps, payloads, fragments, parsed.ref, "bookmark");
      break;
  }

  const tip = payloads.get(tipId) ?? tipPayload(deps, parsed);
  return {
    navigationMap: buildMap(...fragments),
    warm: [...payloads.values()],
    node: tip,
    location: locationFor(parsed),
  };
}

function emptyBibleView(deps: BibleViewDeps): RefreshResult {
  const id = emptyId();
  return {
    navigationMap: buildMap(rootBackToHome(id, deps.rootAppId)),
    warm: [{ id, label: "Bible data is not available." }],
    node: { id, label: "Bible data is not available." },
    location: { appId: "bible", path: "/" },
  };
}

function locationFor(parsed: ParsedNode): AppLocation | null {
  switch (parsed.kind) {
    case "testament":
      return { appId: "bible", path: `/${parsed.version}` };
    case "bookmarks":
    case "bookmarks-stub":
      return { appId: "bible", path: "/bookmarks" };
    case "search":
    case "search-stub":
      return { appId: "bible", path: "/search" };
    case "book":
      return {
        appId: "bible",
        path: `/${parsed.version}/${bookPathSegment(parsed.book)}`,
      };
    case "chapter":
      return {
        appId: "bible",
        path: `/${parsed.version}/${bookPathSegment(parsed.book)}/${parsed.chapter}`,
      };
    case "verse":
    case "option":
    case "commentary":
    case "bookmark":
      return {
        appId: "bible",
        path: `/${parsed.ref.version}/${bookPathSegment(parsed.ref.book)}/${parsed.ref.chapter}/${parsed.ref.verse}`,
      };
    case "copy-status":
      return null;
  }
}

function tipPayload(deps: BibleViewDeps, parsed: ParsedNode): NodePayload {
  switch (parsed.kind) {
    case "testament":
      return {
        id: testamentId(parsed.version, parsed.testament),
        label: testamentLabel(parsed.testament),
      };
    case "bookmarks":
      return { id: bookmarksId(), label: "Bookmarks" };
    case "search":
      return { id: searchId(), label: "Search" };
    case "bookmarks-stub":
      return { id: bookmarksStubId(), label: "Bookmarks are not available yet." };
    case "search-stub":
      return { id: searchStubId(), label: "Search is not available yet." };
    case "book":
      return { id: bookId(parsed.version, parsed.book), label: parsed.book };
    case "chapter":
      return {
        id: chapterId(parsed.version, parsed.book, parsed.chapter),
        label: chapterLabel(parsed.chapter),
      };
    case "verse": {
      const verse = deps.store.getVerse(parsed.ref);
      return {
        id: verseId(parsed.ref),
        label: verseLabel(parsed.ref.verse, verse?.text ?? ""),
      };
    }
    case "option":
      return {
        id: optionId(parsed.ref, parsed.option),
        label: OPTION_LABEL[parsed.option],
      };
    case "copy-status":
      return { id: copyStatusId(parsed.ref), label: "Copying…" };
    case "commentary":
      return {
        id: commentaryId(parsed.ref),
        label: `Commentary for ${formatRef(parsed.ref)} is not available yet.`,
      };
    case "bookmark":
      return {
        id: bookmarkStubId(parsed.ref),
        label: "Bookmark is not available yet.",
      };
  }
}

function addNode(payloads: Map<string, NodePayload>, node: NodePayload): void {
  payloads.set(node.id, node);
}

function rootHeadingIds(store: BibleStore, version: string): string[] {
  const testaments = store.listTestaments(version);
  return [...testaments.map((t) => testamentId(version, t)), bookmarksId(), searchId()];
}

function addRootLevel(
  deps: BibleViewDeps,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  current: Extract<ParsedNode, { kind: "testament" | "bookmarks" | "search" }>,
): void {
  const version =
    current.kind === "testament" ? current.version : deps.store.defaultVersionId();
  if (!version) {
    return;
  }

  const ids = rootHeadingIds(deps.store, version);
  addNode(payloads, { id: bookmarksId(), label: "Bookmarks" });
  addNode(payloads, { id: searchId(), label: "Search" });
  addNode(payloads, { id: bookmarksStubId(), label: "Bookmarks are not available yet." });
  addNode(payloads, { id: searchStubId(), label: "Search is not available yet." });

  for (const t of deps.store.listTestaments(version)) {
    addNode(payloads, {
      id: testamentId(version, t),
      label: testamentLabel(t),
    });
  }

  fragments.push(siblingListEdges(ids, { wrap: true }));
  fragments.push({
    [bookmarksId()]: { enter: edgeNode(bookmarksStubId(), "push") },
    [searchId()]: { enter: edgeNode(searchStubId(), "push") },
  });

  for (const t of deps.store.listTestaments(version)) {
    const books = deps.store.listBooks(version, t);
    const first = books[0];
    if (first) {
      fragments.push({
        [testamentId(version, t)]: { enter: edgeNode(bookId(version, first.name), "push") },
      });
    }
    fragments.push(rootBackToHome(testamentId(version, t), deps.rootAppId));
  }
  fragments.push(rootBackToHome(bookmarksId(), deps.rootAppId));
  fragments.push(rootBackToHome(searchId(), deps.rootAppId));

  if (current.kind === "testament") {
    for (const book of deps.store.listBooks(version, current.testament).slice(0, 8)) {
      addNode(payloads, { id: bookId(version, book.name), label: book.name });
    }
  }
}

function addSimpleStub(
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  stubId: string,
  backId: string,
): void {
  addNode(payloads, tipPayloadFromStub(stubId));
  addNode(payloads, {
    id: backId,
    label: backId === bookmarksId() ? "Bookmarks" : "Search",
  });
  fragments.push({
    [stubId]: { back: edgePop() },
  });
}

function tipPayloadFromStub(stubId: string): NodePayload {
  if (stubId === bookmarksStubId()) {
    return { id: stubId, label: "Bookmarks are not available yet." };
  }
  return { id: stubId, label: "Search is not available yet." };
}

function addBookLevel(
  deps: BibleViewDeps,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  version: string,
  bookName: string,
): void {
  const book = deps.store.getBook(version, bookName);
  if (!book) {
    addRootLevel(deps, payloads, fragments, {
      kind: "testament",
      version,
      testament: "OT",
    });
    return;
  }
  const siblings = deps.store.listBooks(version, book.testament);
  const ids = siblings.map((b) => bookId(version, b.name));
  for (const b of siblings) {
    addNode(payloads, { id: bookId(version, b.name), label: b.name });
  }
  fragments.push(siblingListEdges(ids, { wrap: true }));
  fragments.push({
    [bookId(version, book.name)]: {
      enter: edgeNode(chapterId(version, book.name, 1), "push"),
      back: edgePop(),
    },
  });
  for (let ch = 1; ch <= Math.min(book.chapterCount, 12); ch++) {
    addNode(payloads, {
      id: chapterId(version, book.name, ch),
      label: chapterLabel(ch),
    });
  }
  addNode(payloads, {
    id: testamentId(version, book.testament),
    label: testamentLabel(book.testament),
  });
}

function addChapterLevel(
  deps: BibleViewDeps,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  version: string,
  bookName: string,
  chapter: number,
): void {
  const book = deps.store.getBook(version, bookName);
  if (!book) {
    addRootLevel(deps, payloads, fragments, {
      kind: "testament",
      version,
      testament: "OT",
    });
    return;
  }
  const ids: string[] = [];
  for (let ch = 1; ch <= book.chapterCount; ch++) {
    const id = chapterId(version, book.name, ch);
    ids.push(id);
    addNode(payloads, { id, label: chapterLabel(ch) });
  }
  fragments.push(siblingListEdges(ids, { wrap: true }));
  fragments.push({
    [chapterId(version, book.name, chapter)]: {
      enter: edgeNode(verseId({ version, book: book.name, chapter, verse: 1 }), "replace"),
      back: edgePop(),
    },
  });
  warmVerses(deps, payloads, version, book.name, chapter, 8);
  addNode(payloads, { id: bookId(version, book.name), label: book.name });
}

function addVerseLevel(
  deps: BibleViewDeps,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  ref: BibleRef,
): void {
  const book = deps.store.getBook(ref.version, ref.book);
  if (!book) {
    addRootLevel(deps, payloads, fragments, {
      kind: "testament",
      version: ref.version,
      testament: "OT",
    });
    return;
  }
  const verses = deps.store.listVerses(ref.version, book.name, ref.chapter);
  const ids: string[] = [];
  for (const verse of verses) {
    const r: BibleRef = {
      version: ref.version,
      book: book.name,
      chapter: ref.chapter,
      verse: verse.verse,
    };
    const id = verseId(r);
    ids.push(id);
    addNode(payloads, {
      id,
      label: verseLabel(verse.verse, verse.text),
    });
  }
  fragments.push(siblingListEdges(ids, { wrap: true }));

  const tip = verseId(ref);
  fragments.push({
    [tip]: {
      enter: edgeNode(optionId(ref, "copy"), "push"),
      back: edgeNode(chapterId(book.versionId, book.name, ref.chapter), "replace"),
    },
  });
  addOptionPayloads(payloads, ref);
  addNode(payloads, {
    id: chapterId(book.versionId, book.name, ref.chapter),
    label: chapterLabel(ref.chapter),
  });
}

function addOptionLevel(
  deps: BibleViewDeps,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  ref: BibleRef,
): void {
  const optionIds = VERSE_OPTIONS.map((option) => optionId(ref, option));
  addOptionPayloads(payloads, ref);
  addNode(payloads, tipPayload(deps, { kind: "verse", ref }));
  addNode(payloads, { id: copyStatusId(ref), label: "Copying…" });
  addNode(payloads, tipPayload(deps, { kind: "commentary", ref }));
  addNode(payloads, tipPayload(deps, { kind: "bookmark", ref }));

  fragments.push(siblingListEdges(optionIds, { wrap: true }));
  fragments.push({
    [optionId(ref, "copy")]: {
      enter: edgeAction(copyStatusId(ref)),
      back: edgePop(),
    },
    [optionId(ref, "bookmark")]: {
      enter: edgeNode(bookmarkStubId(ref), "push"),
      back: edgePop(),
    },
    [optionId(ref, "commentary")]: {
      enter: edgeNode(commentaryId(ref), "push"),
      back: edgePop(),
    },
  });
}

function addVerseStubLevel(
  deps: BibleViewDeps,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  ref: BibleRef,
  which: "commentary" | "bookmark",
): void {
  const stubId = which === "commentary" ? commentaryId(ref) : bookmarkStubId(ref);
  addNode(payloads, tipPayload(deps, { kind: which, ref }));
  addOptionPayloads(payloads, ref);
  fragments.push({
    [stubId]: { back: edgePop() },
  });
}

function addOptionPayloads(payloads: Map<string, NodePayload>, ref: BibleRef): void {
  for (const option of VERSE_OPTIONS) {
    addNode(payloads, {
      id: optionId(ref, option),
      label: OPTION_LABEL[option],
    });
  }
}

function warmVerses(
  deps: BibleViewDeps,
  payloads: Map<string, NodePayload>,
  version: string,
  book: string,
  chapter: number,
  max: number,
): void {
  const verses = deps.store.listVerses(version, book, chapter).slice(0, max);
  for (const verse of verses) {
    const ref: BibleRef = { version, book, chapter, verse: verse.verse };
    addNode(payloads, {
      id: verseId(ref),
      label: verseLabel(verse.verse, verse.text),
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
  const verse = deps.store.getVerse(ref);
  const line = verse ? `${formatRef(ref)}. ${verse.text}` : null;
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
