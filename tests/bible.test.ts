import { afterEach, describe, expect, it, vi } from "vitest";
import { type BibleApp } from "../src/apps/bible/index.ts";
import {
  createSqliteBibleStore,
  openBibleDatabase,
  startBibleApp,
} from "../src/apps/bible/store.ts";
import { ensureCatalog, parseHelloAoChapter, parseTsk, parseVpl, stripSuppliedWordBrackets } from "../src/apps/bible/import.ts";
import {
  bookId,
  bookmarkStatusId,
  bookmarksEmptyId,
  bookmarksId,
  chapterId,
  commentarySectionId,
  commentaryWorkId,
  copyStatusId,
  optionId,
  searchId,
  searchInputId,
  searchWorkingId,
  signInId,
  testamentId,
  verseNodeId,
  verseVersionPickId,
  versionPickId,
  versionsHeadingId,
} from "../src/apps/bible/ids.ts";
import type { BibleRef, CanonRef } from "../src/apps/bible/types.ts";
import type { AppServerContext, RefreshResult } from "../src/core/types.ts";
import { fixtureBible } from "./helpers/kjvFixture.ts";

const VERSION = "kjv";

function ref(bookId: string, chapter: number, verse: number, version = VERSION): BibleRef {
  return { version, bookId, chapter, verse };
}

function canon(bookId: string, chapter: number, verse: number): CanonRef {
  return { bookId, chapter, verse };
}

function signedOut(): AppServerContext {
  return { userId: null, sessionId: "session-1", accountAppId: "account" };
}

function signedIn(userId = "user-1"): AppServerContext {
  return { userId, sessionId: "session-1", accountAppId: "account" };
}

let app: BibleApp | undefined;

function bible() {
  app?.close();
  app = startBibleApp({ rootAppId: "home", dbPath: ":memory:", seed: fixtureBible });
  return app;
}

afterEach(() => {
  app?.close();
  app = undefined;
});

async function refresh(
  instance: BibleApp,
  stack: Parameters<BibleApp["refresh"]>[0],
  extras: Parameters<BibleApp["refresh"]>[1] = {},
  ctx: AppServerContext = signedOut(),
): Promise<RefreshResult> {
  return instance.refresh(stack, extras, ctx);
}

describe("Bible app", () => {
  it("open / lands on Old Testament with home back", async () => {
    const result = await bible().open("/", {}, signedOut());
    expect(result.node.id).toBe(testamentId(VERSION, "OT"));
    expect(result.node.label).toBe("Old Testament");
    expect(result.navigationMap[testamentId(VERSION, "OT")]?.back).toEqual({
      kind: "app",
      to: { appId: "home", path: "/app/bible" },
    });
    expect(result.location).toEqual({ appId: "bible", path: "/kjv" });
  });

  it("root list is Old Testament, New Testament, Bookmarks, Search, Version", async () => {
    const result = await bible().open("/", {}, signedOut());
    const ot = testamentId(VERSION, "OT");
    const nt = testamentId(VERSION, "NT");
    expect(result.navigationMap[ot]?.next).toEqual({
      kind: "node",
      toNodeId: nt,
      stackBehavior: "replace",
    });
    expect(result.navigationMap[nt]?.next).toEqual({
      kind: "node",
      toNodeId: bookmarksId(),
      stackBehavior: "replace",
    });
    expect(result.navigationMap[bookmarksId()]?.next).toEqual({
      kind: "node",
      toNodeId: searchId(),
      stackBehavior: "replace",
    });
    expect(result.navigationMap[searchId()]?.next).toEqual({
      kind: "node",
      toNodeId: versionsHeadingId(),
      stackBehavior: "replace",
    });
    expect(result.navigationMap[versionsHeadingId()]?.next).toEqual({
      kind: "node",
      toNodeId: ot,
      stackBehavior: "replace",
    });
  });

  it("root Version action opens OT of that version", async () => {
    const instance = bible();
    const opened = await instance.open("/", {}, signedOut());
    const asvPick = versionPickId("asv");
    expect(opened.navigationMap[versionsHeadingId()]?.enter).toEqual({
      kind: "node",
      toNodeId: versionPickId("kjv"),
      stackBehavior: "push",
    });
    const list = await refresh(instance, [{ nodeId: asvPick, label: "American Standard Version", location: null }]);
    expect(list.navigationMap[asvPick]?.enter).toEqual({
      kind: "app",
      to: { appId: "bible", path: "/asv" },
      action: true,
    });
    const ot = await instance.open("/asv", { action: true }, signedIn());
    expect(ot.node.id).toBe(testamentId("asv", "OT"));
    expect(ot.location).toEqual({ appId: "bible", path: "/asv" });
    const remembered = await instance.open("/", {}, signedIn());
    expect(remembered.location).toEqual({ appId: "bible", path: "/asv" });
  });

  it("verse-context version switch clamps a missing verse", async () => {
    const instance = bible();
    const from = ref("MAT", 5, 8);
    const pick = verseVersionPickId(VERSION, from, "asv");
    const result = await refresh(instance, [{ nodeId: pick, label: "American Standard Version", location: null }]);
    expect(result.navigationMap[pick]?.enter).toEqual({
      kind: "app",
      to: { appId: "bible", path: "/asv/Matthew/5/7" },
      action: true,
    });
    const landed = await instance.open("/asv/Matthew/5/8", { action: true }, signedOut());
    expect(landed.node.id).toBe(
      verseNodeId({ type: "chapter", versionId: "asv", bookId: "MAT", chapter: 5 }, canon("MAT", 5, 7)),
    );
    expect(landed.node.label).toContain("merciful");
  });

  it("signed-out Bookmarks enter is a sign-in node", async () => {
    const instance = bible();
    const heading = await instance.open("/bookmarks", {}, signedOut());
    expect(heading.navigationMap[bookmarksId()]?.enter).toEqual({
      kind: "node",
      toNodeId: signInId(),
      stackBehavior: "push",
    });
    const signIn = await refresh(instance, [{ nodeId: signInId(), label: "Sign in to bookmark.", location: null }]);
    expect(signIn.node.label).toBe("Sign in to bookmark.");
    expect(signIn.navigationMap[signInId()]?.enter).toEqual({
      kind: "app",
      to: { appId: "account", path: "/" },
    });
  });

  it("signed-in bookmark toggle and list", async () => {
    const instance = bible();
    const ctx = signedIn();
    const verseRef = canon("MAT", 5, 3);
    const option = optionId(VERSION, verseRef, "bookmark");
    const status = bookmarkStatusId(verseRef);
    const menu = await refresh(
      instance,
      [{ nodeId: option, label: "Bookmark", location: null }],
      {},
      ctx,
    );
    expect(menu.node.label).toBe("Bookmark");
    expect(menu.navigationMap[option]?.enter).toMatchObject({ action: true });

    const added = await refresh(
      instance,
      [{ nodeId: status, label: "Saving…", location: null }],
      { action: true },
      ctx,
    );
    expect(added.node.label).toBe("Bookmarked");

    const list = await instance.open("/bookmarks", {}, ctx);
    expect(list.navigationMap[bookmarksId()]?.enter?.kind).toBe("node");
    const first = await refresh(
      instance,
      [
        { nodeId: bookmarksId(), label: "Bookmarks", location: null },
        {
          nodeId: verseNodeId({ type: "bookmarks" }, verseRef),
          label: "Matthew 5:3. Blessed are the poor in spirit: for theirs is the kingdom of heaven.",
          location: null,
        },
      ],
      {},
      ctx,
    );
    expect(first.node.label).toBe(
      "Matthew 5:3. Blessed are the poor in spirit: for theirs is the kingdom of heaven.",
    );
    expect(first.navigationMap[first.node.id]?.next).toBeUndefined();

    const removed = await refresh(instance, [{ nodeId: status, label: "Bookmarked", location: null }], { action: true }, ctx);
    expect(removed.node.label).toBe("Bookmark removed");
    const empty = await refresh(
      instance,
      [{ nodeId: bookmarksEmptyId(), label: "No bookmarks yet.", location: null }],
      {},
      ctx,
    );
    expect(empty.node.label).toBe("No bookmarks yet.");
  });

  it("search AND, empty, and cap", async () => {
    const instance = bible();
    const ctx = signedOut();
    const heading = await instance.open("/search", {}, ctx);
    expect(heading.navigationMap[searchId()]?.enter).toEqual({
      kind: "node",
      toNodeId: searchInputId(),
      stackBehavior: "push",
    });
    const input = await refresh(instance, [{ nodeId: searchInputId(), label: "", location: null }], {}, ctx);
    expect(input.node.kind).toBe("input");
    expect(input.navigationMap[searchInputId()]?.enter).toMatchObject({
      action: true,
      passInputText: true,
    });

    const hits = await refresh(
      instance,
      [{ nodeId: searchWorkingId(), label: "Searching…", location: null }],
      { action: true, inputText: "poor spirit" },
      ctx,
    );
    expect(hits.node.label).toBe(
      "Matthew 5:3. Blessed are the poor in spirit: for theirs is the kingdom of heaven.",
    );

    const none = await refresh(
      instance,
      [{ nodeId: searchWorkingId(), label: "Searching…", location: null }],
      { action: true, inputText: "xyzabc" },
      ctx,
    );
    expect(none.node.label).toBe("No verses matched.");

    const blank = await refresh(
      instance,
      [{ nodeId: searchWorkingId(), label: "Searching…", location: null }],
      { action: true, inputText: "" },
      ctx,
    );
    expect(blank.node.label).toBe("Enter a search.");
  });

  it("commentary range is shared by verses 1 through 8", async () => {
    const instance = bible();
    const first = await refresh(instance, [
      { nodeId: commentarySectionId(VERSION, canon("MAT", 5, 1), "henry"), label: "x", location: null },
    ]);
    const last = await refresh(instance, [
      { nodeId: commentarySectionId(VERSION, canon("MAT", 5, 8), "henry"), label: "x", location: null },
    ]);
    expect(first.node.label).toBe("Henry on the Beatitudes, covering verses 1 through 8.");
    expect(last.node.label).toBe(first.node.label);
    const work = await refresh(instance, [
      { nodeId: commentaryWorkId(VERSION, canon("MAT", 5, 3), "henry"), label: "Matthew Henry", location: null },
    ]);
    expect(work.node.label).toBe("Matthew Henry");
    expect(work.navigationMap[work.node.id]?.enter?.kind).toBe("node");
  });

  it("open deep verse path resolves tip and location", async () => {
    const result = await bible().open("/kjv/Matthew/5/3", {}, signedOut());
    expect(result.node.id).toBe(
      verseNodeId({ type: "chapter", versionId: VERSION, bookId: "MAT", chapter: 5 }, canon("MAT", 5, 3)),
    );
    expect(result.node.label).toBe(
      "3. Blessed are the poor in spirit: for theirs is the kingdom of heaven.",
    );
    expect(result.location).toEqual({
      appId: "bible",
      path: "/kjv/Matthew/5/3",
    });
  });

  it("books and chapters wrap at list ends", async () => {
    const instance = bible();
    const first = chapterId(VERSION, "MAT", 1);
    const last = chapterId(VERSION, "MAT", 5);
    const chList = await refresh(instance, [
      { nodeId: bookId(VERSION, "MAT"), label: "Matthew", location: null },
      { nodeId: first, label: "1 (chapter)", location: null },
    ]);
    expect(chList.node.label).toBe("1 (chapter)");
    expect(chList.navigationMap[first]?.prev).toEqual({
      kind: "node",
      toNodeId: last,
      stackBehavior: "replace",
    });
    expect(chList.navigationMap[last]?.next).toEqual({
      kind: "node",
      toNodeId: first,
      stackBehavior: "replace",
    });

    const books = await instance.open("/kjv/Matthew", {}, signedOut());
    expect(books.navigationMap[bookId(VERSION, "MAT")]?.next).toBeUndefined();
    expect(books.navigationMap[bookId(VERSION, "MAT")]?.enter).toEqual({
      kind: "node",
      toNodeId: first,
      stackBehavior: "push",
    });
  });

  it("verses wrap within the chapter; last verse next does not leave the chapter", async () => {
    const instance = bible();
    const genesis = await instance.open("/kjv/Genesis/1/3", {}, signedOut());
    const first = verseNodeId(
      { type: "chapter", versionId: VERSION, bookId: "GEN", chapter: 1 },
      canon("GEN", 1, 1),
    );
    const last = verseNodeId(
      { type: "chapter", versionId: VERSION, bookId: "GEN", chapter: 1 },
      canon("GEN", 1, 3),
    );
    expect(genesis.navigationMap[last]?.next).toEqual({
      kind: "node",
      toNodeId: first,
      stackBehavior: "replace",
    });
    expect(genesis.navigationMap[first]?.prev).toEqual({
      kind: "node",
      toNodeId: last,
      stackBehavior: "replace",
    });

    const matthew4 = await instance.open("/kjv/Matthew/4/1", {}, signedOut());
    const lastOf4 = verseNodeId(
      { type: "chapter", versionId: VERSION, bookId: "MAT", chapter: 4 },
      canon("MAT", 4, 1),
    );
    const firstOf5 = verseNodeId(
      { type: "chapter", versionId: VERSION, bookId: "MAT", chapter: 5 },
      canon("MAT", 5, 1),
    );
    expect(matthew4.navigationMap[lastOf4]?.next).toBeUndefined();
    expect(matthew4.navigationMap[lastOf4]?.next?.toNodeId).not.toBe(firstOf5);
  });

  it("verse enter pushes Copy; option next has no action flag", async () => {
    const instance = bible();
    const verseRef = ref("GEN", 1, 1);
    const verse = await instance.open("/kjv/Genesis/1/1", {}, signedOut());
    expect(verse.navigationMap[verse.node.id]?.enter).toEqual({
      kind: "node",
      toNodeId: optionId(VERSION, verseRef, "copy"),
      stackBehavior: "push",
    });

    const copyId = optionId(VERSION, verseRef, "copy");
    const result = await refresh(instance, [{ nodeId: copyId, label: "Copy", location: null }]);
    expect(result.navigationMap[copyId]?.enter).toMatchObject({
      action: true,
    });
    expect(result.navigationMap[copyId]?.next).toEqual({
      kind: "node",
      toNodeId: optionId(VERSION, verseRef, "bookmark"),
      stackBehavior: "replace",
    });
    expect(result.navigationMap[copyId]?.next).not.toHaveProperty("action");
  });

  it("Copy action returns clipboardText with version, book, and chapter", async () => {
    const instance = bible();
    const verseRef = ref("GEN", 1, 1);
    const statusId = copyStatusId(VERSION, verseRef);
    const copyId = optionId(VERSION, verseRef, "copy");

    const verse = await instance.open("/kjv/Genesis/1/1", {}, signedOut());
    expect(verse.node.label).toBe(
      "1. In the beginning God created the heaven and the earth.",
    );

    await refresh(instance, [{ nodeId: copyId, label: "Copy", location: null }]);

    const copied = await refresh(
      instance,
      [
        { nodeId: copyId, label: "Copy", location: null },
        { nodeId: statusId, label: "Copying…", location: null },
      ],
      { action: true },
    );
    expect(copied.node.label).toBe("Copied");
    expect(copied.location).toBeNull();
    expect(copied.clipboardText).toBe(
      "King James Version. Genesis 1:1. In the beginning God created the heaven and the earth.",
    );

    const idle = await refresh(instance, [{ nodeId: statusId, label: "Copied", location: null }]);
    expect(idle.clipboardText).toBeUndefined();
  });

  it("Copy without a verse line does not ask the client to copy", async () => {
    const result = await refresh(
      bible(),
      [{ nodeId: copyStatusId(VERSION, canon("ZZZ", 1, 1)), label: "Copying…", location: null }],
      { action: true },
    );
    expect(result.node.label).toContain("verse not found");
    expect(result.clipboardText).toBeUndefined();
  });

  it("RefreshResult survives structuredClone for open", async () => {
    const result = await bible().open("/kjv/Genesis/1/1", {}, signedOut());
    expect(structuredClone(result)).toEqual(result);
  });

  it("unknown path falls back to Old Testament", async () => {
    const result = await bible().open("/kjv/NotABook/99/1", {}, signedOut());
    expect(result.node.id).toBe(testamentId(VERSION, "OT"));
  });

  it("malformed percent-encoding in a book name uses the same fallback", async () => {
    const result = await bible().open("/kjv/%E0%A4%A/1/1", {}, signedOut());
    expect(result.node.id).toBe(testamentId(VERSION, "OT"));
  });
});

describe("Bible store", () => {
  it("keys verses by version so translations share canon book ids", () => {
    const db = openBibleDatabase(":memory:");
    ensureCatalog(db, { seed: fixtureBible });
    const store = createSqliteBibleStore(db);
    expect(store.listVersions().map((v) => v.id)).toEqual(["kjv", "asv", "bbe", "ylt"]);
    const kjv = store.getVerse({ version: "kjv", bookId: "GEN", chapter: 1, verse: 1 });
    const asv = store.getVerse({ version: "asv", bookId: "GEN", chapter: 1, verse: 1 });
    expect(kjv?.text).toContain("heaven and the earth");
    expect(asv?.text).toContain("heavens and the earth");
    const hits = store.searchVerses("kjv", ["blessed"], 1);
    expect(hits).toHaveLength(1);
    store.close();
  });
});

describe("Bible packaging", () => {
  it("does not touch navigator.clipboard", async () => {
    const clipboardGetter = vi.fn(() => ({
      writeText: async () => undefined,
    }));
    vi.stubGlobal("navigator", {
      ...globalThis.navigator,
      get clipboard() {
        return clipboardGetter();
      },
    });

    await refresh(
      bible(),
      [{ nodeId: copyStatusId(VERSION, canon("GEN", 1, 1)), label: "Copying…", location: null }],
      { action: true },
    );
    expect(clipboardGetter).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("Bible importers", () => {
  it("keeps KJV supplied words and strips only the brackets", () => {
    expect(stripSuppliedWordBrackets("darkness [was] upon")).toBe("darkness was upon");
    expect(stripSuppliedWordBrackets("that [it was] good")).toBe("that it was good");
  });

  it("parses VPL through CanonBook aliases, not filename guesses", () => {
    const verses = parseVpl("SOL 1:1 The song of songs, which is Solomon's.\nMAR 1:1 The beginning of the gospel of Jesus Christ.\n");
    expect(verses).toEqual([
      { bookId: "SNG", chapter: 1, verse: 1, text: "The song of songs, which is Solomon's." },
      { bookId: "MRK", chapter: 1, verse: 1, text: "The beginning of the gospel of Jesus Christ." },
    ]);
  });

  it("treats HelloAO content entries as ranges until the next starting verse", () => {
    const parsed = parseHelloAoChapter({
      chapter: {
        number: 5,
        content: [
          { type: "verse", number: 1, content: ["Cover 1-8"] },
          { type: "verse", number: 9, content: ["Cover 9"] },
        ],
      },
    });
    expect(parsed?.entries.map((e) => e.number)).toEqual([1, 9]);
  });

  it("maps TSK numeric book_key through canon sort", () => {
    const rows = parseTsk("40\t5\t3\t1\tpoor\tisa 66:2; mt 11:5\n");
    expect(rows[0]).toMatchObject({ bookId: "MAT", chapter: 5, verse: 3, phrase: "poor" });
  });
});
