import { afterEach, describe, expect, it, vi } from "vitest";
import { type BibleApp, createBibleApp } from "../src/apps/bible/index.ts";
import {
  createSqliteBibleStore,
  openBibleDatabase,
  startBibleApp,
} from "../src/apps/bible/store.ts";
import { ensureCatalog, parseHelloAoChapter, parseTsk, parseVpl, stripSuppliedWordBrackets } from "../src/apps/bible/import.ts";
import {
  COMMENTARY_RECORDS,
  SEARCH_POLICY,
  VERSION_RECORDS,
  catalogCommentaryId,
  catalogVersionId,
  getCanonBook,
} from "../src/apps/bible/catalog.ts";
import {
  bookId,
  bookmarkStatusId,
  bookmarksEmptyId,
  bookmarksId,
  chapterId,
  commentaryChunkId,
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
import type { BibleRef, BibleSeed, CanonRef } from "../src/apps/bible/types.ts";
import type { AppServerContext, RefreshResult } from "../src/core/types.ts";
import { fixtureBible } from "./helpers/kjvFixture.ts";

const KJV = catalogVersionId(VERSION_RECORDS[0]!);
const ASV = catalogVersionId(VERSION_RECORDS[1]!);
const YLT = catalogVersionId(VERSION_RECORDS[3]!);
const GEN = getCanonBook("GEN")!.sort;
const MAT = getCanonBook("MAT")!.sort;
const MRK = getCanonBook("MRK")!.sort;
const PSA = getCanonBook("PSA")!.sort;
const HENRY = catalogCommentaryId(COMMENTARY_RECORDS.find((row) => row.id === "henry")!);
const JFB = catalogCommentaryId(COMMENTARY_RECORDS.find((row) => row.id === "jfb")!);

function ref(bookId: number, chapter: number, verse: number, versionId = KJV): BibleRef {
  return { versionId, bookId, chapter, verse };
}

function canon(bookId: number, chapter: number, verse: number): CanonRef {
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

function bibleWithSeed(seed: BibleSeed) {
  app?.close();
  app = startBibleApp({ rootAppId: "home", dbPath: ":memory:", seed });
  return app;
}

function searchQueryId(nodeId: string): number {
  const match = /^bible:q:(\d+):/.exec(nodeId);
  if (!match) {
    throw new Error(`expected a search verse id, got ${nodeId}`);
  }
  return Number(match[1]);
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
    expect(result.node.id).toBe(testamentId(KJV, "OT"));
    expect(result.node.label).toBe("Old Testament");
    expect(result.navigationMap[testamentId(KJV, "OT")]?.back).toEqual({
      kind: "app",
      to: { appId: "home", path: "/app/bible" },
    });
    expect(result.location).toEqual({ appId: "bible", path: "/kjv" });
  });

  it("root list is Old Testament, New Testament, Bookmarks, Search, Version", async () => {
    const result = await bible().open("/", {}, signedOut());
    const ot = testamentId(KJV, "OT");
    const nt = testamentId(KJV, "NT");
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
    const asvPick = versionPickId(ASV);
    expect(opened.navigationMap[versionsHeadingId()]?.enter).toEqual({
      kind: "node",
      toNodeId: versionPickId(KJV),
      stackBehavior: "push",
    });
    const list = await refresh(instance, [{ nodeId: asvPick, label: "American Standard Version", location: null }]);
    expect(list.navigationMap[asvPick]?.enter).toEqual({
      kind: "app",
      to: { appId: "bible", path: "/asv" },
      action: true,
    });
    const ot = await instance.open("/asv", { action: true }, signedIn());
    expect(ot.node.id).toBe(testamentId(ASV, "OT"));
    expect(ot.location).toEqual({ appId: "bible", path: "/asv" });
    const remembered = await instance.open("/", {}, signedIn());
    expect(remembered.location).toEqual({ appId: "bible", path: "/asv" });
  });

  it("verse-context version switch keeps a missing verse and uses the standard menu", async () => {
    const instance = bible();
    const from = ref(MAT, 5, 8);
    const pick = verseVersionPickId(KJV, from, ASV);
    const result = await refresh(instance, [{ nodeId: pick, label: "American Standard Version", location: null }]);
    expect(result.navigationMap[pick]?.enter).toEqual({
      kind: "app",
      to: { appId: "bible", path: "/asv/Matthew/5/8" },
      action: true,
    });
    const landed = await instance.open("/asv/Matthew/5/8", { action: true }, signedOut());
    expect(landed.node.id).toBe(
      verseNodeId({ type: "chapter", versionId: ASV, bookId: MAT, chapter: 5 }, canon(MAT, 5, 8)),
    );
    expect(landed.node.label).toContain("not in American Standard Version");
    expect(landed.navigationMap[landed.node.id]?.enter).toEqual({
      kind: "node",
      toNodeId: optionId(ASV, canon(MAT, 5, 8), "versions"),
      stackBehavior: "push",
    });
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
    const verseRef = canon(MAT, 5, 3);
    const option = optionId(KJV, verseRef, "bookmark");
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
    expect(SEARCH_POLICY.maxHits).toBe(1000);
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
    const contextId = verseNodeId(
      { type: "context", versionId: KJV, bookId: MAT, chapter: 5 },
      canon(MAT, 5, 3),
    );
    expect(hits.navigationMap[hits.node.id]?.enter).toEqual({
      kind: "node",
      toNodeId: contextId,
      stackBehavior: "push",
    });

    const context = await refresh(instance, [
      { nodeId: hits.node.id, label: hits.node.label, location: null },
      { nodeId: contextId, label: "x", location: null },
    ]);
    expect(context.node.label).toBe(
      "(Context) 3. Blessed are the poor in spirit: for theirs is the kingdom of heaven.",
    );
    expect(context.navigationMap[contextId]?.back).toEqual({ kind: "node", stackBehavior: "pop" });
    expect(context.navigationMap[contextId]?.enter).toEqual({
      kind: "node",
      toNodeId: optionId(KJV, canon(MAT, 5, 3), "versions"),
      stackBehavior: "push",
    });
    expect(context.navigationMap[contextId]?.prev).toEqual({
      kind: "node",
      toNodeId: verseNodeId(
        { type: "context", versionId: KJV, bookId: MAT, chapter: 5 },
        canon(MAT, 5, 2),
      ),
      stackBehavior: "replace",
    });
    expect(context.navigationMap[contextId]?.next).toEqual({
      kind: "node",
      toNodeId: verseNodeId(
        { type: "context", versionId: KJV, bookId: MAT, chapter: 5 },
        canon(MAT, 5, 4),
      ),
      stackBehavior: "replace",
    });

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

  it("search warms a sibling window, not every hit", async () => {
    const verses = Array.from({ length: 50 }, (_, i) => ({
      versionId: "kjv",
      bookId: "PSA",
      chapter: 1,
      verse: i + 1,
      text: `Needleword verse ${i + 1}.`,
    }));
    const instance = bibleWithSeed({ verses });
    const ctx = signedOut();
    const hits = await refresh(
      instance,
      [{ nodeId: searchWorkingId(), label: "Searching…", location: null }],
      { action: true, inputText: "needleword" },
      ctx,
    );
    const queryId = searchQueryId(hits.node.id);
    const searchVerseIds = hits.warm.filter((n) => n.id.startsWith(`bible:q:${queryId}:${PSA}:`));
    expect(searchVerseIds).toHaveLength(SEARCH_POLICY.siblingRadius + 1);
    expect(searchVerseIds.some((n) => n.id.endsWith(`:${PSA}:1:50`))).toBe(false);

    const v25 = verseNodeId({ type: "search", queryId }, canon(PSA, 1, 25));
    const v26 = verseNodeId({ type: "search", queryId }, canon(PSA, 1, 26));
    expect(hits.navigationMap[v25]?.next).toEqual({
      kind: "node",
      toNodeId: v26,
      stackBehavior: "replace",
    });
    expect(hits.navigationMap[v26]).toBeUndefined();
  });

  it("commentary range is shared and split into chunks", async () => {
    const instance = bible();
    const chunk0 = commentaryChunkId(KJV, canon(MAT, 5, 1), HENRY, 0);
    const chunk1 = commentaryChunkId(KJV, canon(MAT, 5, 1), HENRY, 1);
    const first = await refresh(instance, [{ nodeId: chunk0, label: "x", location: null }]);
    const last = await refresh(instance, [
      { nodeId: commentaryChunkId(KJV, canon(MAT, 5, 8), HENRY, 0), label: "x", location: null },
    ]);
    expect(first.node.label).toBe("Henry on the Beatitudes, covering verses 1 through 8.");
    expect(last.node.label).toBe(first.node.label);
    expect(first.navigationMap[chunk0]?.next).toEqual({
      kind: "node",
      toNodeId: chunk1,
      stackBehavior: "replace",
    });
    expect(first.navigationMap[chunk1]?.next).toBeUndefined();
    const work = await refresh(instance, [
      { nodeId: commentaryWorkId(KJV, canon(MAT, 5, 3), HENRY), label: "Matthew Henry", location: null },
    ]);
    expect(work.node.label).toBe("Matthew Henry");
    expect(work.navigationMap[work.node.id]?.enter).toEqual({
      kind: "node",
      toNodeId: commentaryChunkId(KJV, canon(MAT, 5, 3), HENRY, 0),
      stackBehavior: "push",
      action: true,
    });
  });

  it("open deep verse path resolves tip and location", async () => {
    const result = await bible().open("/kjv/Matthew/5/3", {}, signedOut());
    expect(result.node.id).toBe(
      verseNodeId({ type: "chapter", versionId: KJV, bookId: MAT, chapter: 5 }, canon(MAT, 5, 3)),
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
    const first = chapterId(KJV, MAT, 1);
    const last = chapterId(KJV, MAT, 5);
    const chList = await refresh(instance, [
      { nodeId: bookId(KJV, MAT), label: "Matthew", location: null },
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
    expect(books.navigationMap[bookId(KJV, MAT)]?.next).toEqual({
      kind: "node",
      toNodeId: bookId(KJV, MRK),
      stackBehavior: "replace",
    });
    expect(books.navigationMap[bookId(KJV, MAT)]?.enter).toEqual({
      kind: "node",
      toNodeId: first,
      stackBehavior: "replace",
    });
  });

  it("verses wrap within the chapter; last verse next does not leave the chapter", async () => {
    const instance = bible();
    const genesis = await instance.open("/kjv/Genesis/1/3", {}, signedOut());
    const first = verseNodeId(
      { type: "chapter", versionId: KJV, bookId: GEN, chapter: 1 },
      canon(GEN, 1, 1),
    );
    const last = verseNodeId(
      { type: "chapter", versionId: KJV, bookId: GEN, chapter: 1 },
      canon(GEN, 1, 3),
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
      { type: "chapter", versionId: KJV, bookId: MAT, chapter: 4 },
      canon(MAT, 4, 1),
    );
    const firstOf5 = verseNodeId(
      { type: "chapter", versionId: KJV, bookId: MAT, chapter: 5 },
      canon(MAT, 5, 1),
    );
    expect(matthew4.navigationMap[lastOf4]?.next).toBeUndefined();
    expect(matthew4.navigationMap[lastOf4]?.next?.toNodeId).not.toBe(firstOf5);
  });

  it("verse enter pushes Versions; option next has no action flag", async () => {
    const instance = bible();
    const verseRef = ref(GEN, 1, 1);
    const verse = await instance.open("/kjv/Genesis/1/1", {}, signedOut());
    expect(verse.navigationMap[verse.node.id]?.enter).toEqual({
      kind: "node",
      toNodeId: optionId(KJV, verseRef, "versions"),
      stackBehavior: "push",
    });

    const versionsId = optionId(KJV, verseRef, "versions");
    const result = await refresh(instance, [{ nodeId: versionsId, label: "Versions", location: null }]);
    expect(result.navigationMap[versionsId]?.enter).toEqual({
      kind: "node",
      toNodeId: verseVersionPickId(KJV, verseRef, KJV),
      stackBehavior: "push",
    });
    expect(result.navigationMap[versionsId]?.next).toEqual({
      kind: "node",
      toNodeId: optionId(KJV, verseRef, "commentary"),
      stackBehavior: "replace",
    });
    expect(result.navigationMap[versionsId]?.next).not.toHaveProperty("action");
  });

  it("Copy action returns clipboardText with version, book, and chapter", async () => {
    const instance = bible();
    const verseRef = ref(GEN, 1, 1);
    const statusId = copyStatusId(KJV, verseRef);
    const copyId = optionId(KJV, verseRef, "copy");

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
      [{ nodeId: copyStatusId(KJV, canon(999, 1, 1)), label: "Copying…", location: null }],
      { action: true },
    );
    expect(result.node.label).toContain("verse not found");
    expect(result.clipboardText).toBeUndefined();
  });

  it("RefreshResult survives structuredClone for open", async () => {
    const result = await bible().open("/kjv/Genesis/1/1", {}, signedOut());
    expect(structuredClone(result)).toEqual(result);
  });

  it("empty versions table is the empty-data node, not a kjv fallback", async () => {
    const store = createSqliteBibleStore(openBibleDatabase(":memory:"));
    expect(store.defaultVersionId()).toBeNull();
    const empty = createBibleApp({ rootAppId: "home", store });
    try {
      const result = await empty.open("/", {}, signedOut());
      expect(result.node.id).toBe("bible:empty");
      expect(result.node.label).toBe("Bible data is not available.");
    } finally {
      empty.close();
    }
  });

  it("URL-opened verse back walks chapter, book, then testament", async () => {
    const instance = bible();
    const verse = await instance.open("/kjv/Matthew/5/3", {}, signedOut());
    expect(verse.navigationMap[verse.node.id]?.back).toEqual({
      kind: "node",
      toNodeId: chapterId(KJV, MAT, 5),
      stackBehavior: "replace",
    });
    const chapter = await refresh(instance, [
      { nodeId: chapterId(KJV, MAT, 5), label: "5 (chapter)", location: null },
    ]);
    expect(chapter.navigationMap[chapterId(KJV, MAT, 5)]?.back).toEqual({
      kind: "node",
      toNodeId: bookId(KJV, MAT),
      stackBehavior: "replace",
    });
    const book = await refresh(instance, [{ nodeId: bookId(KJV, MAT), label: "Matthew", location: null }]);
    expect(book.navigationMap[bookId(KJV, MAT)]?.back).toEqual({
      kind: "node",
      toNodeId: testamentId(KJV, "NT"),
      stackBehavior: "replace",
    });
  });

  it("verse Versions enter lands on the first pick, not a list heading", async () => {
    const instance = bible();
    const verseRef = canon(MAT, 5, 3);
    const option = optionId(KJV, verseRef, "versions");
    const firstPick = verseVersionPickId(KJV, verseRef, KJV);
    const menu = await refresh(instance, [{ nodeId: option, label: "Versions", location: null }]);
    expect(menu.navigationMap[option]?.enter).toEqual({
      kind: "node",
      toNodeId: firstPick,
      stackBehavior: "push",
    });
    const list = await refresh(instance, [
      { nodeId: option, label: "Versions", location: null },
      { nodeId: firstPick, label: "King James Version", location: null },
    ]);
    expect(list.node.id).toBe(firstPick);
    expect(list.navigationMap[firstPick]?.enter).toMatchObject({ kind: "app", action: true });
    expect(list.navigationMap[firstPick]?.next).toEqual({
      kind: "node",
      toNodeId: verseVersionPickId(KJV, verseRef, ASV),
      stackBehavior: "replace",
    });
  });

  it("version and commentary lists put the most recently used work first", async () => {
    const instance = bible();
    const ctx = signedIn();
    await instance.open("/asv", { action: true }, ctx);
    const root = await instance.open("/", {}, ctx);
    expect(root.navigationMap[versionsHeadingId()]?.enter).toEqual({
      kind: "node",
      toNodeId: versionPickId(ASV),
      stackBehavior: "push",
    });

    const verseRef = canon(MAT, 5, 3);
    await refresh(
      instance,
      [{ nodeId: commentaryChunkId(KJV, verseRef, JFB, 0), label: "x", location: null }],
      { action: true },
      ctx,
    );
    const option = optionId(KJV, verseRef, "commentary");
    const menu = await refresh(instance, [{ nodeId: option, label: "Commentary", location: null }], {}, ctx);
    expect(menu.navigationMap[option]?.enter).toEqual({
      kind: "node",
      toNodeId: commentaryWorkId(KJV, verseRef, JFB),
      stackBehavior: "push",
    });
  });

  it("unknown path falls back to Old Testament", async () => {
    const result = await bible().open("/kjv/NotABook/99/1", {}, signedOut());
    expect(result.node.id).toBe(testamentId(KJV, "OT"));
  });

  it("malformed percent-encoding in a book name uses the same fallback", async () => {
    const result = await bible().open("/kjv/%E0%A4%A/1/1", {}, signedOut());
    expect(result.node.id).toBe(testamentId(KJV, "OT"));
  });
});

describe("Bible store", () => {
  it("keys verse text by version so translations share canon verse ids", () => {
    const db = openBibleDatabase(":memory:");
    ensureCatalog(db, { seed: fixtureBible });
    const store = createSqliteBibleStore(db);
    expect(store.listVersions().map((v) => v.slug)).toEqual(["kjv", "asv", "bbe", "ylt"]);
    const slot = store.getVerseSlot(GEN, 1, 1);
    expect(slot).toBeDefined();
    expect(store.getVerseText(KJV, slot!.id)).toContain("heaven and the earth");
    expect(store.getVerseText(ASV, slot!.id)).toContain("heavens and the earth");
    const hits = store.searchVerses(KJV, ["blessed"], 1);
    expect(hits).toHaveLength(1);
    const queryId = store.createSearchQuery("s1", "blessed", hits);
    expect(store.listSearchHits(queryId, "s1")).toEqual(hits);
    expect(store.listSearchHits(queryId, "other")).toEqual([]);
    store.touchVersionRecency("user-1", YLT);
    expect(store.listVersions("user-1").map((v) => v.slug)[0]).toBe("ylt");
    expect(store.listVersions().map((v) => v.slug)[0]).toBe("kjv");
    store.close();
  });

  it("search matches whole words, not substrings", () => {
    const db = openBibleDatabase(":memory:");
    ensureCatalog(db, {
      seed: {
        verses: [
          { versionId: "kjv", bookId: "GEN", chapter: 1, verse: 1, text: "He drew a sword." },
          { versionId: "kjv", bookId: "GEN", chapter: 1, verse: 2, text: "This is the word." },
        ],
      },
    });
    const store = createSqliteBibleStore(db);
    const hits = store.searchVerses(KJV, ["word"], 10);
    expect(hits.map((h) => h.verse)).toEqual([2]);
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
      [{ nodeId: copyStatusId(KJV, canon(GEN, 1, 1)), label: "Copying…", location: null }],
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
