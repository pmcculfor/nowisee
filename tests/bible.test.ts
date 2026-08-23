import { afterEach, describe, expect, it, vi } from "vitest";
import { type BibleApp } from "../src/apps/bible/index.ts";
import {
  createSqliteBibleStore,
  openBibleDatabase,
  seedBibleStore,
  startBibleApp,
} from "../src/apps/bible/store.ts";
import {
  bookId,
  bookmarkStubId,
  bookmarksId,
  bookmarksStubId,
  chapterId,
  optionId,
  searchId,
  searchStubId,
  testamentId,
  verseId,
} from "../src/apps/bible/ids.ts";
import type { BibleRef } from "../src/apps/bible/types.ts";
import type { RefreshResult } from "../src/core/types.ts";
import { fixtureKjv } from "./helpers/kjvFixture.ts";

const VERSION = "kjv";

function ref(book: string, chapter: number, verse: number): BibleRef {
  return { version: VERSION, book, chapter, verse };
}

let app: BibleApp | undefined;

function bible() {
  app?.close();
  app = startBibleApp({ rootAppId: "home", dbPath: ":memory:", seed: fixtureKjv });
  return app;
}

afterEach(() => {
  app?.close();
  app = undefined;
});

async function refresh(
  instance: BibleApp,
  ...args: Parameters<BibleApp["refresh"]>
): Promise<RefreshResult> {
  return instance.refresh(...args);
}

describe("Bible app", () => {
  it("open / lands on Old Testament with home back", async () => {
    const result = await bible().open("/");
    expect(result.node.id).toBe(testamentId(VERSION, "OT"));
    expect(result.node.label).toBe("Old Testament");
    expect(result.navigationMap[testamentId(VERSION, "OT")]?.back).toEqual({
      kind: "app",
      to: { appId: "home", path: "/" },
    });
    expect(result.location).toEqual({ appId: "bible", path: "/kjv" });
  });

  it("root list is Old Testament, New Testament, Bookmarks, Search", async () => {
    const result = await bible().open("/");
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
      toNodeId: ot,
      stackBehavior: "replace",
    });
    expect(result.navigationMap[bookmarksId()]?.enter).toEqual({
      kind: "node",
      toNodeId: bookmarksStubId(),
      stackBehavior: "push",
    });
    expect(result.navigationMap[searchId()]?.enter).toEqual({
      kind: "node",
      toNodeId: searchStubId(),
      stackBehavior: "push",
    });
  });

  it("Bookmarks and Search stubs are not implemented", async () => {
    const instance = bible();
    const bookmarks = await instance.open("/bookmarks");
    expect(bookmarks.node.label).toBe("Bookmarks");
    const bookmarkStub = await refresh(instance, [
      { nodeId: bookmarksStubId(), label: "Bookmarks are not available yet.", location: null },
    ]);
    expect(bookmarkStub.node.label).toBe("Bookmarks are not available yet.");

    const search = await instance.open("/search");
    expect(search.node.label).toBe("Search");
    const searchStub = await refresh(instance, [
      { nodeId: searchStubId(), label: "Search is not available yet.", location: null },
    ]);
    expect(searchStub.node.label).toBe("Search is not available yet.");
  });

  it("open deep verse path resolves tip and location", async () => {
    const result = await bible().open("/kjv/Matthew/5/3");
    expect(result.node.id).toBe(verseId(ref("Matthew", 5, 3)));
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
    const first = chapterId(VERSION, "Matthew", 1);
    const last = chapterId(VERSION, "Matthew", 5);
    const chList = await refresh(instance, [
      { nodeId: bookId(VERSION, "Matthew"), label: "Matthew", location: null },
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

    const books = await instance.open("/kjv/Matthew");
    expect(books.navigationMap[bookId(VERSION, "Matthew")]?.next).toBeUndefined();
    expect(books.navigationMap[bookId(VERSION, "Matthew")]?.enter).toEqual({
      kind: "node",
      toNodeId: first,
      stackBehavior: "push",
    });
  });

  it("verses wrap within the chapter; last verse next does not leave the chapter", async () => {
    const instance = bible();
    const genesis = await instance.open("/kjv/Genesis/1/3");
    const first = verseId(ref("Genesis", 1, 1));
    const last = verseId(ref("Genesis", 1, 3));
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

    const matthew4 = await instance.open("/kjv/Matthew/4/1");
    const lastOf4 = verseId(ref("Matthew", 4, 1));
    const firstOf5 = verseId(ref("Matthew", 5, 1));
    expect(matthew4.navigationMap[lastOf4]?.next).toBeUndefined();
    expect(matthew4.navigationMap[lastOf4]?.next?.toNodeId).not.toBe(firstOf5);
  });

  it("verse enter pushes Copy; option next has no action flag", async () => {
    const instance = bible();
    const verseRef = ref("Genesis", 1, 1);
    const verse = await instance.open("/kjv/Genesis/1/1");
    expect(verse.navigationMap[verse.node.id]?.enter).toEqual({
      kind: "node",
      toNodeId: optionId(verseRef, "copy"),
      stackBehavior: "push",
    });

    const copyId = optionId(verseRef, "copy");
    const result = await refresh(instance, [{ nodeId: copyId, label: "Copy", location: null }]);
    expect(result.navigationMap[copyId]?.enter).toMatchObject({
      action: true,
    });
    expect(result.navigationMap[copyId]?.next).toEqual({
      kind: "node",
      toNodeId: optionId(verseRef, "bookmark"),
      stackBehavior: "replace",
    });
    expect(result.navigationMap[copyId]?.next).not.toHaveProperty("action");
  });

  it("verse menu stubs Bookmark before Commentary", async () => {
    const instance = bible();
    const verseRef = ref("Genesis", 1, 1);
    const copyId = optionId(verseRef, "copy");
    const bookmarkId = optionId(verseRef, "bookmark");
    const commentaryId = optionId(verseRef, "commentary");
    const result = await refresh(instance, [{ nodeId: copyId, label: "Copy", location: null }]);
    expect(result.navigationMap[bookmarkId]?.next).toEqual({
      kind: "node",
      toNodeId: commentaryId,
      stackBehavior: "replace",
    });
    expect(result.navigationMap[bookmarkId]?.enter).toEqual({
      kind: "node",
      toNodeId: bookmarkStubId(verseRef),
      stackBehavior: "push",
    });
    const stub = await refresh(instance, [
      { nodeId: bookmarkStubId(verseRef), label: "Bookmark is not available yet.", location: null },
    ]);
    expect(stub.node.label).toBe("Bookmark is not available yet.");
  });

  it("Copy action returns clipboardText with book and chapter; display is verse number only", async () => {
    const instance = bible();
    const verseRef = ref("Genesis", 1, 1);
    const statusId = `bible:s:${VERSION}:${verseRef.book}:${verseRef.chapter}:${verseRef.verse}:copy`;
    const copyId = optionId(verseRef, "copy");

    const verse = await instance.open("/kjv/Genesis/1/1");
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
      "Genesis 1:1. In the beginning God created the heaven and the earth.",
    );

    const idle = await refresh(instance, [{ nodeId: statusId, label: "Copied", location: null }]);
    expect(idle.clipboardText).toBeUndefined();
  });

  it("Copy without a verse line does not ask the client to copy", async () => {
    const result = await refresh(
      bible(),
      [{ nodeId: "bible:s:kjv:NotABook:1:1:copy", label: "Copying…", location: null }],
      { action: true },
    );
    expect(result.node.label).toContain("verse not found");
    expect(result.clipboardText).toBeUndefined();
  });

  it("RefreshResult survives structuredClone for open", async () => {
    const result = await bible().open("/kjv/Genesis/1/1");
    expect(structuredClone(result)).toEqual(result);
  });

  it("unknown path falls back to Old Testament", async () => {
    const result = await bible().open("/kjv/NotABook/99/1");
    expect(result.node.id).toBe(testamentId(VERSION, "OT"));
  });

  it("malformed percent-encoding in a book name uses the same fallback", async () => {
    const result = await bible().open("/kjv/%E0%A4%A/1/1");
    expect(result.node.id).toBe(testamentId(VERSION, "OT"));
  });
});

describe("Bible store", () => {
  it("keys verses by version so a later translation can share book names", () => {
    const db = openBibleDatabase(":memory:");
    seedBibleStore(db, fixtureKjv);
    seedBibleStore(db, { ...fixtureKjv, translation: "WEB" });
    const store = createSqliteBibleStore(db);
    expect(store.listVersions().map((v) => v.id)).toEqual(["kjv", "web"]);
    const kjv = store.getVerse({ version: "kjv", book: "Genesis", chapter: 1, verse: 1 });
    const web = store.getVerse({ version: "web", book: "Genesis", chapter: 1, verse: 1 });
    expect(kjv?.text).toBeTruthy();
    expect(web?.text).toBe(kjv?.text);
    expect(kjv?.version).toBe("kjv");
    expect(web?.version).toBe("web");
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
      [{ nodeId: "bible:s:kjv:Genesis:1:1:copy", label: "Copying…", location: null }],
      { action: true },
    );
    expect(clipboardGetter).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
