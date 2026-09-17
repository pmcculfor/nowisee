import { afterEach, describe, expect, it, vi } from "vitest";
import { type BibleApp, createBibleApp } from "../src/apps/bible/index.ts";
import {
  createSqliteBibleStore,
  openBibleDatabase,
  SEARCH_QUERY_TTL_MS,
  RECENCY_TTL_MS,
  startBibleApp,
} from "../src/apps/bible/store.ts";
import { ensureCatalog, parseHelloAoChapter, parseTsk, parseVpl, stripSuppliedWordBrackets } from "../src/apps/bible/import.ts";
import {
  COMMENTARY_RECORDS,
  DICTIONARY_RECORDS,
  SEARCH_POLICY,
  TSK_ABBREVS,
  VERSION_RECORDS,
  XREF_RECORDS,
  catalogCommentaryId,
  catalogDictionaryWorkId,
  catalogVersionId,
  catalogXrefWorkId,
  contextSeq,
  xrefSeq,
  getCanonBook,
} from "../src/apps/bible/catalog.ts";
import {
  bookId,
  bookmarksEmptyId,
  bookmarksId,
  chapterId,
  commentaryChunkId,
  commentaryWorkId,
  dictionaryWordId,
  dictionaryWorkId,
  optionId,
  searchId,
  searchInputId,
  searchLimitedId,
  searchWorkingId,
  signInId,
  testamentId,
  verseNodeId,
  verseVersionPickId,
  versionPickId,
  versionsHeadingId,
  xrefPhraseId,
  xrefWorkId,
} from "../src/apps/bible/ids.ts";
import { expandTskHeadings, parseTskCitationRanges } from "../src/apps/bible/tskCitations.ts";
import { parseHebrewStrongXml, parseStrongsGreekXml } from "../src/apps/bible/strongsXml.ts";
import {
  collapseSpans,
  parseUsfmBook,
  parseUsfmVerseSpans,
} from "../src/apps/bible/usfmTokens.ts";
import type { BibleRef, BibleSeed, CanonRef } from "../src/apps/bible/types.ts";
import type { AppServerContext, RefreshResult } from "../src/core/types.ts";
import { nodeIdOf, wireAction } from "./helpers/refreshCall.ts";
import { fixtureBible, henryRangeParagraphs } from "./helpers/kjvFixture.ts";

const KJV = catalogVersionId(VERSION_RECORDS[0]!);
const ASV = catalogVersionId(VERSION_RECORDS[1]!);
const YLT = catalogVersionId(VERSION_RECORDS[3]!);
const GEN = getCanonBook("GEN")!.sort;
const MAT = getCanonBook("MAT")!.sort;
const MRK = getCanonBook("MRK")!.sort;
const PSA = getCanonBook("PSA")!.sort;
const HENRY = catalogCommentaryId(COMMENTARY_RECORDS.find((row) => row.id === "henry")!);
const JFB = catalogCommentaryId(COMMENTARY_RECORDS.find((row) => row.id === "jfb")!);
const TSK = catalogXrefWorkId(XREF_RECORDS[0]!);
const STRONGS = catalogDictionaryWorkId(DICTIONARY_RECORDS[0]!);

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
  stack: string | readonly { readonly nodeId: string }[],
  extras: Parameters<BibleApp["refresh"]>[1] & { action?: unknown } = {},
  ctx: AppServerContext = signedOut(),
): Promise<RefreshResult> {
  const nodeId = nodeIdOf(stack);
  return instance.refresh(nodeId, wireAction(extras, nodeId), ctx);
}

describe("Bible app", () => {
  it("open / lands on Old Testament with home back", async () => {
    const result = await bible().open("/", {}, signedOut());
    expect(result.node.id).toBe(testamentId("OT"));
    expect(result.node.label).toBe("Old Testament");
    expect(result.navigationMap[testamentId("OT")]?.back).toEqual({
      kind: "app",
      to: { appId: "home", path: "/app/bible" },
    });
    expect(result.location).toEqual({ appId: "bible", path: "/" });
  });

  it("root list is Old Testament, New Testament, Bookmarks, Search, Version", async () => {
    const result = await bible().open("/", {}, signedOut());
    const ot = testamentId("OT");
    const nt = testamentId("NT");
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

  it("root Version action lands on OT and remembers recency", async () => {
    const instance = bible();
    const opened = await instance.open("/", {}, signedOut());
    const asvPick = versionPickId(ASV);
    expect(opened.navigationMap[versionsHeadingId()]?.enter).toEqual({
      kind: "node",
      toNodeId: versionPickId(KJV),
      stackBehavior: "pushTransient",
      frame: "root-versions",
    });
    const list = await refresh(instance, [{ nodeId: asvPick, label: "American Standard Version", location: null }]);
    expect(list.navigationMap[asvPick]?.enter).toEqual({
      kind: "node",
      stackBehavior: "popTransient",
      action: true,
    });
    const heading = await refresh(
      instance,
      versionsHeadingId(),
      { action: { triggerId: asvPick } },
      signedIn(),
    );
    expect(heading.node.id).toBe(versionsHeadingId());
    expect(heading.location).toEqual({ appId: "bible", path: "/" });
    const remembered = await instance.open("/", {}, signedIn());
    expect(remembered.location).toEqual({ appId: "bible", path: "/" });
    expect(remembered.navigationMap[versionsHeadingId()]?.enter).toEqual({
      kind: "node",
      toNodeId: versionPickId(ASV),
      stackBehavior: "pushTransient",
      frame: "root-versions",
    });
  });

  it("verse-context version switch keeps a missing verse and uses the standard menu", async () => {
    const instance = bible();
    const from = canon(MAT, 5, 8);
    const pick = verseVersionPickId(from, ASV);
    const result = await refresh(instance, [{ nodeId: pick, label: "American Standard Version", location: null }]);
    expect(result.navigationMap[pick]?.enter).toEqual({
      kind: "node",
      stackBehavior: "popTransient",
      action: true,
    });
    const verseId = verseNodeId({ type: "chapter", bookId: MAT, chapter: 5 }, canon(MAT, 5, 8));
    const landed = await refresh(
      instance,
      verseId,
      { action: { triggerId: pick } },
      signedOut(),
    );
    expect(landed.node.id).toBe(verseId);
    expect(landed.node.label).toContain("not in American Standard Version");
    expect(landed.navigationMap[landed.node.id]?.enter).toEqual({
      kind: "node",
      toNodeId: optionId(canon(MAT, 5, 8), "versions"),
      stackBehavior: "pushTransient",
      frame: "verse-menu",
    });
    expect(landed.location).toEqual({ appId: "bible", path: "/Matthew/5/8" });
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
    const option = optionId(verseRef, "bookmark");
    const menu = await refresh(
      instance,
      [{ nodeId: option, label: "Bookmark", location: null }],
      {},
      ctx,
    );
    expect(menu.node.label).toBe("Bookmark");
    expect(menu.navigationMap[option]?.enter).toMatchObject({
      kind: "node",
      stackBehavior: "stay",
      action: true,
    });
    expect(menu.navigationMap[option]?.back).toEqual({
      kind: "node",
      stackBehavior: "pop",
    });

    const added = await refresh(
      instance,
      [{ nodeId: option, label: "Bookmark", location: null }],
      { action: true },
      ctx,
    );
    expect(added.node.id).toBe(option);
    expect(added.node.label).toBe("Remove bookmark");
    expect(added.navigationMap[option]?.next).toEqual({
      kind: "node",
      toNodeId: optionId(verseRef, "copy"),
      stackBehavior: "replace",
    });

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
    const contextId = verseNodeId(contextSeq(MAT, 5), verseRef);
    expect(first.navigationMap[first.node.id]?.enter).toEqual({
      kind: "node",
      toNodeId: contextId,
      stackBehavior: "push",
    });
    const context = await refresh(
      instance,
      [
        { nodeId: first.node.id, label: first.node.label, location: null },
        { nodeId: contextId, label: "x", location: null },
      ],
      {},
      ctx,
    );
    expect(context.node.label).toBe(
      "3 (context). Blessed are the poor in spirit: for theirs is the kingdom of heaven.",
    );
    expect(context.navigationMap[contextId]?.back).toEqual({ kind: "node", stackBehavior: "pop" });
    expect(context.navigationMap[contextId]?.enter).toEqual({
      kind: "node",
      toNodeId: optionId(verseRef, "versions", contextSeq(MAT, 5)),
      stackBehavior: "pushTransient",
      frame: "verse-menu",
    });

    const removed = await refresh(
      instance,
      [{ nodeId: option, label: "Remove bookmark", location: null }],
      { action: true },
      ctx,
    );
    expect(removed.node.id).toBe(option);
    expect(removed.node.label).toBe("Bookmark");
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
      { action: { triggerId: searchInputId() }, inputText: "poor spirit" },
      ctx,
    );
    expect(hits.node.label).toBe(
      "Matthew 5:3. Blessed are the poor in spirit: for theirs is the kingdom of heaven.",
    );
    const contextId = verseNodeId(
      { type: "context", bookId: MAT, chapter: 5 },
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
      "3 (context). Blessed are the poor in spirit: for theirs is the kingdom of heaven.",
    );
    expect(context.navigationMap[contextId]?.back).toEqual({ kind: "node", stackBehavior: "pop" });
    expect(context.navigationMap[contextId]?.enter).toEqual({
      kind: "node",
      toNodeId: optionId(canon(MAT, 5, 3), "versions", { type: "context", bookId: MAT, chapter: 5 }),
      stackBehavior: "pushTransient",
      frame: "verse-menu",
    });
    expect(context.navigationMap[contextId]?.prev).toEqual({
      kind: "node",
      toNodeId: verseNodeId(
        { type: "context", bookId: MAT, chapter: 5 },
        canon(MAT, 5, 2),
      ),
      stackBehavior: "replace",
    });
    expect(context.navigationMap[contextId]?.next).toEqual({
      kind: "node",
      toNodeId: verseNodeId(
        { type: "context", bookId: MAT, chapter: 5 },
        canon(MAT, 5, 4),
      ),
      stackBehavior: "replace",
    });

    const none = await refresh(
      instance,
      [{ nodeId: searchWorkingId(), label: "Searching…", location: null }],
      { action: { triggerId: searchInputId() }, inputText: "xyzabc" },
      ctx,
    );
    expect(none.node.label).toBe("No verses matched.");

    const blank = await refresh(
      instance,
      [{ nodeId: searchWorkingId(), label: "Searching…", location: null }],
      { action: { triggerId: searchInputId() }, inputText: "" },
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
      { action: { triggerId: searchInputId() }, inputText: "needleword" },
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
    expect(hits.warm.some((n) => n.id === searchLimitedId(queryId))).toBe(false);
  });

  it("search at the hit cap ends with a limit node", async () => {
    const cap = SEARCH_POLICY.maxHits;
    const verses = Array.from({ length: cap + 1 }, (_, i) => ({
      versionId: "kjv",
      bookId: "PSA",
      chapter: 1,
      verse: i + 1,
      text: `Needleword verse ${i + 1}.`,
    }));
    const instance = bibleWithSeed({ verses });
    const ctx = signedOut();
    const first = await refresh(
      instance,
      [{ nodeId: searchWorkingId(), label: "Searching…", location: null }],
      { action: { triggerId: searchInputId() }, inputText: "needleword" },
      ctx,
    );
    const queryId = searchQueryId(first.node.id);
    const lastHit = verseNodeId({ type: "search", queryId }, canon(PSA, 1, cap));
    const limitedId = searchLimitedId(queryId);
    expect(first.warm.some((n) => n.id === limitedId)).toBe(false);

    const last = await refresh(instance, [{ nodeId: lastHit, label: "x", location: null }], {}, ctx);
    expect(last.navigationMap[lastHit]?.next).toEqual({
      kind: "node",
      toNodeId: limitedId,
      stackBehavior: "replace",
    });
    expect(last.warm.find((n) => n.id === limitedId)?.label).toBe(
      `search limited to ${cap} results.`,
    );

    const limited = await refresh(instance, [{ nodeId: limitedId, label: "x", location: null }], {}, ctx);
    expect(limited.node.id).toBe(limitedId);
    expect(limited.node.label).toBe(`search limited to ${cap} results.`);
    expect(limited.navigationMap[limitedId]?.prev).toEqual({
      kind: "node",
      toNodeId: lastHit,
      stackBehavior: "replace",
    });
    expect(limited.navigationMap[limitedId]?.next).toBeUndefined();
    expect(limited.navigationMap[limitedId]?.enter).toBeUndefined();
    expect(limited.navigationMap[limitedId]?.back).toEqual({ kind: "node", stackBehavior: "pop" });
  });

  it("commentary range is shared and split into chunks", async () => {
    const instance = bible();
    const chunk0 = commentaryChunkId(canon(MAT, 5, 1), HENRY, 0);
    const chunk1 = commentaryChunkId(canon(MAT, 5, 1), HENRY, 1);
    const first = await refresh(instance, [{ nodeId: chunk0, label: "x", location: null }]);
    const last = await refresh(instance, [
      { nodeId: commentaryChunkId(canon(MAT, 5, 8), HENRY, 0), label: "x", location: null },
    ]);
    expect(first.node.label).toBe(henryRangeParagraphs[0]);
    expect(last.node.label).toBe(first.node.label);
    expect(first.navigationMap[chunk0]?.next).toEqual({
      kind: "node",
      toNodeId: chunk1,
      stackBehavior: "replace",
    });
    expect(first.navigationMap[chunk1]?.next).toBeUndefined();
    const work = await refresh(instance, [
      { nodeId: commentaryWorkId(canon(MAT, 5, 3), HENRY), label: "Matthew Henry", location: null },
    ]);
    expect(work.node.label).toBe("Matthew Henry");
    expect(work.navigationMap[work.node.id]?.enter).toEqual({
      kind: "node",
      toNodeId: commentaryChunkId(canon(MAT, 5, 3), HENRY, 0),
      stackBehavior: "push",
      action: true,
    });
  });

  it("open deep verse path resolves tip and location", async () => {
    const result = await bible().open("/Matthew/5/3", {}, signedOut());
    expect(result.node.id).toBe(
      verseNodeId({ type: "chapter", bookId: MAT, chapter: 5 }, canon(MAT, 5, 3)),
    );
    expect(result.node.label).toBe(
      "3. Blessed are the poor in spirit: for theirs is the kingdom of heaven.",
    );
    expect(result.location).toEqual({
      appId: "bible",
      path: "/Matthew/5/3",
    });
  });

  it("books and chapters wrap at list ends", async () => {
    const instance = bible();
    const first = chapterId(MAT, 1);
    const last = chapterId(MAT, 5);
    const chList = await refresh(instance, [
      { nodeId: bookId(MAT), label: "Matthew", location: null },
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

    const books = await instance.open("/Matthew", {}, signedOut());
    expect(books.navigationMap[bookId(MAT)]?.next).toEqual({
      kind: "node",
      toNodeId: bookId(MRK),
      stackBehavior: "replace",
    });
    expect(books.navigationMap[bookId(MAT)]?.enter).toEqual({
      kind: "node",
      toNodeId: first,
      stackBehavior: "push",
    });
  });

  it("verses wrap within the chapter; last verse next does not leave the chapter", async () => {
    const instance = bible();
    const genesis = await instance.open("/Genesis/1/3", {}, signedOut());
    const first = verseNodeId(
      { type: "chapter", bookId: GEN, chapter: 1 },
      canon(GEN, 1, 1),
    );
    const last = verseNodeId(
      { type: "chapter", bookId: GEN, chapter: 1 },
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

    const matthew4 = await instance.open("/Matthew/4/1", {}, signedOut());
    const lastOf4 = verseNodeId(
      { type: "chapter", bookId: MAT, chapter: 4 },
      canon(MAT, 4, 1),
    );
    const firstOf5 = verseNodeId(
      { type: "chapter", bookId: MAT, chapter: 5 },
      canon(MAT, 5, 1),
    );
    expect(matthew4.navigationMap[lastOf4]?.next).toBeUndefined();
    expect(matthew4.navigationMap[lastOf4]?.next?.toNodeId).not.toBe(firstOf5);
  });

  it("verse enter opens the Versions overlay; option next has no action flag", async () => {
    const instance = bible();
    const verseRef = ref(GEN, 1, 1);
    const verseId = verseNodeId({ type: "chapter", bookId: GEN, chapter: 1 }, verseRef);
    const verse = await instance.open("/Genesis/1/1", {}, signedOut());
    expect(verse.navigationMap[verse.node.id]?.enter).toEqual({
      kind: "node",
      toNodeId: optionId(verseRef, "versions"),
      stackBehavior: "pushTransient",
      frame: "verse-menu",
    });

    const versionsId = optionId(verseRef, "versions");
    const result = await refresh(instance, [{ nodeId: versionsId, label: "Versions", location: null }]);
    expect(result.navigationMap[versionsId]?.enter).toEqual({
      kind: "node",
      toNodeId: verseVersionPickId(verseRef, KJV),
      stackBehavior: "pushTransient",
      frame: "verse-menu",
    });
    expect(result.navigationMap[versionsId]?.back).toEqual({
      kind: "node",
      stackBehavior: "pop",
    });
    expect(result.warm.some((node) => node.id === verseId)).toBe(true);
    expect(result.navigationMap[versionsId]?.next).toEqual({
      kind: "node",
      toNodeId: optionId(verseRef, "commentary"),
      stackBehavior: "replace",
    });
    expect(result.navigationMap[versionsId]?.next).not.toHaveProperty("action");
  });

  it("Copy action returns clipboardText with version, book, and chapter", async () => {
    const instance = bible();
    const verseRef = ref(GEN, 1, 1);
    const copyId = optionId(verseRef, "copy");

    const verse = await instance.open("/Genesis/1/1", {}, signedOut());
    expect(verse.node.label).toBe(
      "1. In the beginning God created the heaven and the earth.",
    );

    const menu = await refresh(instance, [{ nodeId: copyId, label: "Copy", location: null }]);
    expect(menu.navigationMap[copyId]?.enter).toMatchObject({
      kind: "node",
      stackBehavior: "stay",
      action: true,
    });

    const copied = await refresh(
      instance,
      [{ nodeId: copyId, label: "Copy", location: null }],
      { action: true },
    );
    expect(copied.node.id).toBe(copyId);
    expect(copied.node.label).toBe("Copied");
    expect(copied.location).toEqual({ appId: "bible", path: "/Genesis/1/1" });
    expect(copied.clipboardText).toBe(
      "Genesis 1:1. In the beginning God created the heaven and the earth. (KJV)",
    );
    expect(copied.navigationMap[copyId]?.next).toEqual({
      kind: "node",
      toNodeId: optionId(verseRef, "versions"),
      stackBehavior: "replace",
    });

    const idle = await refresh(instance, [{ nodeId: copyId, label: "Copied", location: null }]);
    expect(idle.node.label).toBe("Copy");
    expect(idle.clipboardText).toBeUndefined();
  });

  it("Copy without a verse line does not ask the client to copy", async () => {
    const copyId = optionId(canon(999, 1, 1), "copy");
    const result = await refresh(
      bible(),
      [{ nodeId: copyId, label: "Copy", location: null }],
      { action: true },
    );
    expect(result.node.id).toBe(copyId);
    expect(result.node.label).toContain("verse not found");
    expect(result.clipboardText).toBeUndefined();
  });

  it("RefreshResult survives structuredClone for open", async () => {
    const result = await bible().open("/Genesis/1/1", {}, signedOut());
    expect(structuredClone(result)).toEqual(result);
  });

  it("empty versions table is the empty-data node, not a kjv fallback", async () => {
    const store = createSqliteBibleStore(openBibleDatabase(":memory:"));
    expect(store.listVersions()).toEqual([]);
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
    const verse = await instance.open("/Matthew/5/3", {}, signedOut());
    expect(verse.stack?.map((e) => e.nodeId)).toEqual([
      testamentId("NT"),
      bookId(MAT),
      chapterId(MAT, 5),
      verse.node.id,
    ]);
    expect(verse.navigationMap[verse.node.id]?.back).toEqual({
      kind: "node",
      stackBehavior: "pop",
    });
    const chapter = await refresh(instance, [
      { nodeId: chapterId(MAT, 5), label: "5 (chapter)", location: null },
    ]);
    expect(chapter.navigationMap[chapterId(MAT, 5)]?.back).toEqual({
      kind: "node",
      stackBehavior: "pop",
    });
    const book = await refresh(instance, [{ nodeId: bookId(MAT), label: "Matthew", location: null }]);
    expect(book.navigationMap[bookId(MAT)]?.back).toEqual({
      kind: "node",
      stackBehavior: "pop",
    });
  });

  it("verse Versions enter lands on the first pick, not a list heading", async () => {
    const instance = bible();
    const verseRef = canon(MAT, 5, 3);
    const option = optionId(verseRef, "versions");
    const firstPick = verseVersionPickId(verseRef, KJV);
    const menu = await refresh(instance, [{ nodeId: option, label: "Versions", location: null }]);
    expect(menu.navigationMap[option]?.enter).toEqual({
      kind: "node",
      toNodeId: firstPick,
      stackBehavior: "pushTransient",
      frame: "verse-menu",
    });
    const list = await refresh(instance, [
      { nodeId: option, label: "Versions", location: null },
      { nodeId: firstPick, label: "King James Version", location: null },
    ]);
    expect(list.node.id).toBe(firstPick);
    expect(list.navigationMap[firstPick]?.enter).toMatchObject({
      kind: "node",
      stackBehavior: "popTransient",
      action: true,
    });
    expect(list.navigationMap[firstPick]?.back).toEqual({
      kind: "node",
      stackBehavior: "pop",
    });
    expect(list.warm.some((node) => node.id === option)).toBe(true);
    expect(
      list.warm.some(
        (node) =>
          node.id === verseNodeId({ type: "chapter", bookId: MAT, chapter: 5 }, verseRef),
      ),
    ).toBe(true);
    expect(list.navigationMap[firstPick]?.next).toEqual({
      kind: "node",
      toNodeId: verseVersionPickId(verseRef, ASV),
      stackBehavior: "replace",
    });
  });

  it("version and commentary lists put the most recently used work first", async () => {
    const instance = bible();
    const ctx = signedIn();
    await refresh(
      instance,
      [{ nodeId: versionPickId(ASV), label: "American Standard Version", location: null }],
      { action: true },
      ctx,
    );
    const root = await instance.open("/", {}, ctx);
    expect(root.navigationMap[versionsHeadingId()]?.enter).toEqual({
      kind: "node",
      toNodeId: versionPickId(ASV),
      stackBehavior: "pushTransient",
      frame: "root-versions",
    });

    const verseRef = canon(MAT, 5, 3);
    await refresh(
      instance,
      commentaryChunkId(verseRef, JFB, 0),
      { action: { triggerId: commentaryWorkId(verseRef, JFB) } },
      ctx,
    );
    const option = optionId(verseRef, "commentary");
    const menu = await refresh(instance, [{ nodeId: option, label: "Commentary", location: null }], {}, ctx);
    expect(menu.navigationMap[option]?.enter).toEqual({
      kind: "node",
      toNodeId: commentaryWorkId(verseRef, JFB),
      stackBehavior: "push",
    });
  });

  it("bookmark list enter is a context verse; version switch stays on that context", async () => {
    const instance = bible();
    const ctx = signedIn();
    const verseRef = canon(GEN, 1, 1);
    await refresh(
      instance,
      [{ nodeId: optionId(verseRef, "bookmark"), label: "Bookmark", location: null }],
      { action: true },
      ctx,
    );
    const hitId = verseNodeId({ type: "bookmarks" }, verseRef);
    const contextId = verseNodeId(contextSeq(GEN, 1), verseRef);
    const hit = await refresh(instance, [{ nodeId: hitId, label: "x", location: null }], {}, ctx);
    expect(hit.node.id).toBe(hitId);
    expect(hit.location).toEqual({ appId: "bible", path: "/bookmarks/Genesis/1/1" });
    expect(hit.navigationMap[hitId]?.enter).toEqual({
      kind: "node",
      toNodeId: contextId,
      stackBehavior: "push",
    });
    const pick = verseVersionPickId(verseRef, ASV, contextSeq(GEN, 1));
    const landed = await refresh(
      instance,
      contextId,
      { action: { triggerId: pick } },
      ctx,
    );
    expect(landed.node.id).toBe(contextId);
    expect(landed.node.label).toContain("heavens and the earth");
    expect(landed.location).toEqual({ appId: "bible", path: "/Genesis/1/1" });
    expect(landed.navigationMap[landed.node.id]?.enter).toEqual({
      kind: "node",
      toNodeId: optionId(verseRef, "versions", contextSeq(GEN, 1)),
      stackBehavior: "pushTransient",
      frame: "verse-menu",
    });
    const deep = await instance.open("/bookmarks/Genesis/1/1", {}, ctx);
    expect(deep.node.id).toBe(hitId);
    expect(deep.node.label).toContain("heavens and the earth");
  });

  it("search hits stay on the searched version after an active-version change", async () => {
    const instance = bible();
    const ctx = signedOut();
    const hits = await refresh(
      instance,
      [{ nodeId: searchWorkingId(), label: "Searching…", location: null }],
      { action: { triggerId: searchInputId() }, inputText: "heaven" },
      ctx,
    );
    expect(hits.node.label).toContain("heaven and the earth");
    const queryId = searchQueryId(hits.node.id);
    const hitId = verseNodeId({ type: "search", queryId }, canon(GEN, 1, 1));
    const contextId = verseNodeId({ type: "context", bookId: GEN, chapter: 1 }, canon(GEN, 1, 1));
    const pick = verseVersionPickId(canon(GEN, 1, 1), ASV, {
      type: "context",
      bookId: GEN,
      chapter: 1,
    });
    const context = await refresh(
      instance,
      contextId,
      { action: { triggerId: pick } },
      ctx,
    );
    expect(context.node.id).toBe(contextId);
    expect(context.node.label).toContain("heavens and the earth");
    const hitAgain = await refresh(instance, [{ nodeId: hitId, label: "x", location: null }], {}, ctx);
    expect(hitAgain.node.label).toContain("heaven and the earth");
    expect(hitAgain.node.label).not.toContain("heavens");
  });

  it("unknown path falls back to Old Testament", async () => {
    const result = await bible().open("/NotABook/99/1", {}, signedOut());
    expect(result.node.id).toBe(testamentId("OT"));
  });

  it("malformed percent-encoding in a book name uses the same fallback", async () => {
    const result = await bible().open("/%E0%A4%A/1/1", {}, signedOut());
    expect(result.node.id).toBe(testamentId("OT"));
  });
});

describe("Bible store", () => {
  it("import fails when a committed source file is missing", () => {
    const db = openBibleDatabase(":memory:");
    expect(() => ensureCatalog(db, { rawDir: "missing-bible-raw" })).toThrow(
      /Bible import: missing version kjv/,
    );
    db.close();
  });

  it("keys verse text by version so translations share canon verse ids", () => {
    const db = openBibleDatabase(":memory:");
    ensureCatalog(db, { seed: fixtureBible });
    const store = createSqliteBibleStore(db);
    expect(store.listVersions().map((v) => v.abbreviation)).toEqual(["KJV", "ASV", "BBE", "YLT"]);
    const slot = store.getVerseSlot(GEN, 1, 1);
    expect(slot).toBeDefined();
    expect(store.getVerseText(KJV, slot!.id)).toContain("heaven and the earth");
    expect(store.getVerseText(ASV, slot!.id)).toContain("heavens and the earth");
    const hits = store.searchVerses(KJV, ["blessed"], 1);
    expect(hits).toHaveLength(1);
    const queryId = store.createSearchQuery("s1", "blessed", KJV, hits);
    expect(store.listSearchHits(queryId, "s1")).toEqual(hits);
    expect(store.listSearchHits(queryId, "other")).toEqual([]);
    store.touchVersionRecency("user-1", null, YLT);
    expect(store.listVersions("user-1")[0]?.id).toBe(YLT);
    expect(store.listVersions()[0]?.id).toBe(KJV);
    store.touchVersionRecency(null, "s1", ASV);
    expect(store.listVersions(null, "s1")[0]?.id).toBe(ASV);
    expect(store.listVersions("user-1", "s1")[0]?.id).toBe(YLT);
    store.close();
  });

  it("drops session recency older than the TTL and ignores it when signed in", async () => {
    const db = openBibleDatabase(":memory:");
    ensureCatalog(db, { seed: fixtureBible });
    const store = createSqliteBibleStore(db);
    store.touchVersionRecency(null, "s1", ASV);
    db.run(
      "UPDATE version_recency SET used_at = ? WHERE session_id = ?",
      Date.now() - RECENCY_TTL_MS - 1,
      "s1",
    );
    store.touchVersionRecency(null, "s1", KJV);
    expect(store.listVersions(null, "s1")[0]?.id).toBe(KJV);
    expect(
      db.get<{ n: number }>("SELECT COUNT(*) AS n FROM version_recency WHERE session_id = ? AND version_id = ?", "s1", ASV)
        ?.n,
    ).toBe(0);
    store.close();
  });

  it("keeps one search query per session and drops queries older than a day", () => {
    const db = openBibleDatabase(":memory:");
    ensureCatalog(db, { seed: fixtureBible });
    const store = createSqliteBibleStore(db);
    const hits = store.searchVerses(KJV, ["blessed"], 1);
    expect(hits).toHaveLength(1);
    const first = store.createSearchQuery("s1", "blessed", KJV, hits);
    const second = store.createSearchQuery("s1", "heaven", KJV, hits);
    expect(second).not.toBe(first);
    expect(store.getSearchQuery(first, "s1")).toBeNull();
    expect(store.listSearchHits(first, "s1")).toEqual([]);
    expect(store.listSearchHits(second, "s1")).toEqual(hits);
    const other = store.createSearchQuery("s2", "blessed", KJV, hits);
    expect(store.listSearchHits(second, "s1")).toEqual(hits);
    expect(store.listSearchHits(other, "s2")).toEqual(hits);
    db.run(
      "UPDATE search_query SET created_at = ? WHERE id = ?",
      Date.now() - SEARCH_QUERY_TTL_MS - 1,
      other,
    );
    const third = store.createSearchQuery("s1", "earth", KJV, hits);
    expect(store.getSearchQuery(second, "s1")).toBeNull();
    expect(store.getSearchQuery(other, "s2")).toBeNull();
    expect(store.listSearchHits(third, "s1")).toEqual(hits);
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
      [{ nodeId: optionId(canon(GEN, 1, 1), "copy"), label: "Copy", location: null }],
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

  it("keeps TSK out of commentary and walks expanded xref verses", async () => {
    const instance = bible();
    const verseRef = canon(MAT, 5, 3);
    const commentary = optionId(verseRef, "commentary");
    const menu = await refresh(instance, [{ nodeId: commentary, label: "Commentary", location: null }]);
    expect(menu.navigationMap[commentary]?.enter).toEqual({
      kind: "node",
      toNodeId: commentaryWorkId(verseRef, HENRY),
      stackBehavior: "push",
    });
    expect(menu.navigationMap[commentary]?.next).toEqual({
      kind: "node",
      toNodeId: optionId(verseRef, "cross-references"),
      stackBehavior: "replace",
    });
    const work = await refresh(instance, [
      { nodeId: commentaryWorkId(verseRef, HENRY), label: "Matthew Henry", location: null },
    ]);
    expect(work.warm.some((node) => node.label.includes("Treasury"))).toBe(false);

    const xrefOption = optionId(verseRef, "cross-references");
    const xrefMenu = await refresh(
      instance,
      [{ nodeId: xrefOption, label: "Cross-references", location: null }],
    );
    const xrefWork = xrefWorkId(verseRef, TSK);
    expect(xrefMenu.navigationMap[xrefOption]?.enter).toEqual({
      kind: "node",
      toNodeId: xrefWork,
      stackBehavior: "push",
    });
    const xrefWorks = await refresh(instance, [{ nodeId: xrefWork, label: "x", location: null }]);
    expect(xrefWorks.node.label).toBe("Treasury of Scripture Knowledge");
    expect(xrefWorks.navigationMap[xrefWork]?.next).toBeUndefined();
    const firstPhrase = xrefPhraseId(verseRef, TSK, 1);
    expect(xrefWorks.navigationMap[xrefWork]?.enter).toEqual({
      kind: "node",
      toNodeId: firstPhrase,
      stackBehavior: "push",
      action: true,
    });
    const phrases = await refresh(instance, [
      { nodeId: xrefWork, label: "x", location: null },
      { nodeId: firstPhrase, label: "x", location: null },
    ]);
    expect(phrases.node.label).toBe("Blessed are the poor in spirit:");
    const secondPhrase = xrefPhraseId(verseRef, TSK, 2);
    expect(phrases.navigationMap[firstPhrase]?.next).toEqual({
      kind: "node",
      toNodeId: secondPhrase,
      stackBehavior: "replace",
    });
    expect(phrases.navigationMap[firstPhrase]?.prev).toBeUndefined();
    expect(phrases.navigationMap[secondPhrase]?.next).toBeUndefined();
    expect(phrases.warm.find((node) => node.id === secondPhrase)?.label).toBe(
      "for theirs is the kingdom of heaven.",
    );
    const firstRef = verseNodeId(xrefSeq(1), canon(MAT, 5, 5));
    const secondRef = verseNodeId(xrefSeq(1), canon(MAT, 5, 6));
    const thirdRef = verseNodeId(xrefSeq(1), canon(MAT, 5, 7));
    expect(phrases.navigationMap[firstPhrase]?.enter).toEqual({
      kind: "node",
      toNodeId: firstRef,
      stackBehavior: "push",
    });
    const refs = await refresh(instance, [{ nodeId: firstRef, label: "x", location: null }]);
    expect(refs.node.label).toMatch(/^Matthew 5:5\./);
    expect(refs.location).toEqual({ appId: "bible", path: "/Matthew/5/3" });
    expect(refs.navigationMap[firstRef]?.next).toEqual({
      kind: "node",
      toNodeId: secondRef,
      stackBehavior: "replace",
    });
    expect(refs.navigationMap[secondRef]?.next).toEqual({
      kind: "node",
      toNodeId: thirdRef,
      stackBehavior: "replace",
    });
    const related = verseNodeId(contextSeq(MAT, 5), canon(MAT, 5, 5));
    expect(refs.navigationMap[firstRef]?.enter).toEqual({
      kind: "node",
      toNodeId: related,
      stackBehavior: "push",
    });
    const context = await refresh(instance, [
      { nodeId: firstRef, label: "x", location: null },
      { nodeId: related, label: "x", location: null },
    ]);
    expect(context.node.label).toMatch(/^5 \(context\)\./);
    expect(context.navigationMap[related]?.enter).toEqual({
      kind: "node",
      toNodeId: optionId(canon(MAT, 5, 5), "versions", contextSeq(MAT, 5)),
      stackBehavior: "pushTransient",
      frame: "verse-menu",
    });
    const nestedOption = optionId(canon(MAT, 5, 5), "cross-references", contextSeq(MAT, 5));
    const nestedMenu = await refresh(instance, [{ nodeId: nestedOption, label: "Cross-references", location: null }]);
    const nestedWork = xrefWorkId(canon(MAT, 5, 5), TSK);
    expect(nestedMenu.navigationMap[nestedOption]?.enter?.toNodeId).toBe(nestedWork);
    const nestedWorks = await refresh(instance, [{ nodeId: nestedWork, label: "x", location: null }]);
    const meek = xrefPhraseId(canon(MAT, 5, 5), TSK, 3);
    expect(nestedWorks.navigationMap[nestedWork]?.enter?.toNodeId).toBe(meek);
  });

  it("dictionary walk is one original-language word with the full definition", async () => {
    const instance = bible();
    const verseRef = canon(GEN, 1, 1);
    const option = optionId(verseRef, "dictionaries");
    const menu = await refresh(instance, [{ nodeId: option, label: "Dictionaries", location: null }]);
    const work = dictionaryWorkId(verseRef, STRONGS);
    expect(menu.navigationMap[option]?.enter).toEqual({
      kind: "node",
      toNodeId: work,
      stackBehavior: "push",
    });
    const works = await refresh(instance, [{ nodeId: work, label: "x", location: null }]);
    expect(works.node.label).toBe("Strong's Concordance (King James wording)");
    expect(works.navigationMap[work]?.next).toBeUndefined();
    const first = dictionaryWordId(verseRef, STRONGS, 0);
    const second = dictionaryWordId(verseRef, STRONGS, 1);
    expect(works.navigationMap[work]?.enter).toEqual({
      kind: "node",
      toNodeId: first,
      stackBehavior: "push",
      action: true,
    });
    const word = await refresh(instance, [
      { nodeId: work, label: "x", location: null },
      { nodeId: first, label: "x", location: null },
    ]);
    expect(word.node.label).toBe(
      "In the beginning. reshith. H7225. the first, in place, time, order or rank",
    );
    expect(word.navigationMap[first]?.enter).toBeUndefined();
    expect(word.navigationMap[first]?.prev).toBeUndefined();
    expect(word.navigationMap[first]?.next).toEqual({
      kind: "node",
      toNodeId: second,
      stackBehavior: "replace",
    });
    expect(word.navigationMap[second]?.next).toBeUndefined();
    const emptyVerse = optionId(canon(MAT, 5, 3), "dictionaries");
    const emptyMenu = await refresh(
      instance,
      [{ nodeId: emptyVerse, label: "Dictionaries", location: null }],
    );
    const emptyWork = dictionaryWorkId(canon(MAT, 5, 3), STRONGS);
    expect(emptyMenu.navigationMap[emptyVerse]?.enter?.toNodeId).toBe(emptyWork);
    const emptyWorks = await refresh(instance, [{ nodeId: emptyWork, label: "x", location: null }]);
    expect(emptyWorks.navigationMap[emptyWork]?.enter?.toNodeId).toMatch(/^bible:de:/);
  });
});

describe("Bible study parsers", () => {
  it("expands TSK citation strings into inclusive verse ranges", () => {
    expect(parseTskCitationRanges("isa 66:2; mt 11:5")).toEqual([
      { bookId: "ISA", startChapter: 66, startVerse: 2, endChapter: 66, endVerse: 2 },
      { bookId: "MAT", startChapter: 11, startVerse: 5, endChapter: 11, endVerse: 5 },
    ]);
    expect(parseTskCitationRanges("joh 1:1-3")).toEqual([
      { bookId: "JHN", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 3 },
    ]);
    expect(parseTskCitationRanges("ps 33:6,9")).toEqual([
      { bookId: "PSA", startChapter: 33, startVerse: 6, endChapter: 33, endVerse: 6 },
      { bookId: "PSA", startChapter: 33, startVerse: 9, endChapter: 33, endVerse: 9 },
    ]);
    expect(parseTskCitationRanges("ps 104:3,5-9")).toEqual([
      { bookId: "PSA", startChapter: 104, startVerse: 3, endChapter: 104, endVerse: 3 },
      { bookId: "PSA", startChapter: 104, startVerse: 5, endChapter: 104, endVerse: 9 },
    ]);
    expect(parseTskCitationRanges("mt 5:1-7:29")).toEqual([
      { bookId: "MAT", startChapter: 5, startVerse: 1, endChapter: 7, endVerse: 29 },
    ]);
    expect(parseTskCitationRanges("le 12,1-13:59")).toEqual([
      { bookId: "LEV", startChapter: 12, startVerse: 1, endChapter: 13, endVerse: 59 },
    ]);
    expect(parseTskCitationRanges("jude 1:4")).toEqual([
      { bookId: "JUD", startChapter: 1, startVerse: 4, endChapter: 1, endVerse: 4 },
    ]);
    expect(parseTskCitationRanges("jud 1:4")).toEqual([
      { bookId: "JDG", startChapter: 1, startVerse: 4, endChapter: 1, endVerse: 4 },
    ]);
    expect(parseTskCitationRanges("xx 1:1; ge 1:1")).toEqual([
      { bookId: "GEN", startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 1 },
    ]);
    expect(
      expandTskHeadings("Blessed are the poor in spirit: for theirs is the kingdom of heaven.", [
        "poor",
        "for",
      ]),
    ).toEqual(["Blessed are the poor in spirit:", "for theirs is the kingdom of heaven."]);
    expect(
      expandTskHeadings(
        "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.",
        ["God", "gave", "that whosoever"],
      ),
    ).toEqual([
      "For God so loved the world, that he",
      "gave his only begotten Son,",
      "that whosoever believeth in him should not perish, but have everlasting life.",
    ]);
  });

  it("maps every TSK readme abbreviation onto a canon book", () => {
    expect(Object.keys(TSK_ABBREVS)).toHaveLength(66);
    for (const [abbrev, id] of Object.entries(TSK_ABBREVS)) {
      expect(getCanonBook(id)?.id, abbrev).toBe(id);
    }
    expect(TSK_ABBREVS.ge).toBe("GEN");
    expect(TSK_ABBREVS.jud).toBe("JDG");
    expect(TSK_ABBREVS.jude).toBe("JUD");
  });

  it("collapses consecutive USFM spans that share a Strong's number", () => {
    const genesis = parseUsfmVerseSpans(
      `\\w In|strong="H7225"\\w* \\w the|strong="H7225"\\w* \\w beginning|strong="H7225"\\w*`,
    );
    expect(collapseSpans(genesis)).toEqual([
      { strongs: "H7225", english: "In the beginning" },
    ]);
    const supplied = parseUsfmVerseSpans(
      `\\w And|strong="H430"\\w* the earth \\add was\\add* without form`,
    );
    expect(collapseSpans(supplied)).toEqual([{ strongs: "H430", english: "And" }]);
    const doubled = parseUsfmVerseSpans(`\\w holy|strong="H6944,H6944"\\w*`);
    expect(collapseSpans(doubled)).toEqual([
      { strongs: "H6944", english: "holy" },
      { strongs: "H6944", english: "" },
    ]);
    const john = parseUsfmBook(
      `\\id JHN\n\\c 3\n\\v 16 \\w loved|strong="G25"\\w* the world\n`,
    );
    expect(john).toEqual([
      { bookId: "JHN", chapter: 3, verse: 16, position: 0, strongs: "G25", english: "loved" },
    ]);
    expect(
      collapseSpans(parseUsfmVerseSpans(`\\w beginning|strong="H7225"\\w* \\w God|strong="H0430"\\w*`)),
    ).toEqual([
      { strongs: "H7225", english: "beginning" },
      { strongs: "H430", english: "God" },
    ]);
  });

  it("parses Strong's XML fixtures and rejects entries without a body", () => {
    const greek = parseStrongsGreekXml(`<entry strongs="00025">
 <strongs>25</strongs>   <greek BETA="A)GAPA/W" unicode="ἀγαπάω" translit="agapáō"/>
 <strongs_derivation>perhaps from <greek BETA="A)/GAN" unicode="ἄγαν" translit="ágan"/> (much)</strongs_derivation>
 <strongs_def> to love</strongs_def><kjv_def>:--love.</kjv_def>
</entry><entry strongs="00000"><greek unicode="x" translit="x"/></entry>`);
    expect(greek).toEqual([
      {
        strongs: "G25",
        lemma: "ἀγαπάω",
        translit: "agapáō",
        body: "perhaps from ἄγαν (much) to love love.",
      },
    ]);
    const hebrew = parseHebrewStrongXml(`<entry id="H7225">
		<w pron="ray-sheeth'" xlit="rêʼshîyth">רֵאשִׁית</w>
		<source>from 7218;</source>
		<meaning>the first</meaning>
		<usage>beginning.</usage>
	</entry><entry id="H0000"><w>x</w></entry>`);
    expect(hebrew).toEqual([
      {
        strongs: "H7225",
        lemma: "רֵאשִׁית",
        translit: "ray-sheeth'",
        body: "from 7218; the first beginning.",
      },
    ]);
  });
});
