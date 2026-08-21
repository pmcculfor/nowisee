import { describe, expect, it, vi } from "vitest";
import { createBibleApp } from "../src/apps/bible/index.ts";
import {
  bookId,
  chapterId,
  optionId,
  testamentId,
  verseId,
} from "../src/apps/bible/ids.ts";
import type { RefreshResult } from "../src/core/types.ts";
import { fixtureKjv } from "./helpers/kjvFixture.ts";

function bible() {
  return createBibleApp({ rootAppId: "home", data: fixtureKjv });
}

async function refresh(
  app: ReturnType<typeof bible>,
  ...args: Parameters<typeof app.refresh>
): Promise<RefreshResult> {
  return app.refresh(...args);
}

describe("Bible app", () => {
  it("open / lands on Old Testament with home back", async () => {
    const app = bible();
    const result = await app.open("/");
    expect(result.node.id).toBe(testamentId("OT"));
    expect(result.node.label).toBe("Old Testament");
    expect(result.navigationMap[testamentId("OT")]?.back).toEqual({
      kind: "app",
      to: { appId: "home", path: "/" },
    });
    expect(result.location).toEqual({ appId: "bible", path: "/kjv" });
  });

  it("open deep verse path resolves tip and location", async () => {
    const app = bible();
    const result = await app.open("/kjv/Matthew/5/3");
    expect(result.node.id).toBe(verseId({ book: "Matthew", chapter: 5, verse: 3 }));
    expect(result.node.label).toBe(
      "3. Blessed are the poor in spirit: for theirs is the kingdom of heaven.",
    );
    expect(result.location).toEqual({
      appId: "bible",
      path: "/kjv/Matthew/5/3",
    });
  });

  it("books and chapters wrap at list ends", async () => {
    const app = bible();
    // Books already author wrap: true; fixture has one book per testament, so
    // siblingListEdges omits self-edges when length === 1. Chapters have many.
    const first = chapterId("Matthew", 1);
    const last = chapterId("Matthew", 5);
    const chList = await refresh(app, [
      { nodeId: bookId("Matthew"), label: "Matthew", location: null },
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

    const books = await app.open("/kjv/Matthew");
    expect(books.navigationMap[bookId("Matthew")]?.next).toBeUndefined();
    // Enter still lands on wrapped chapter list.
    expect(books.navigationMap[bookId("Matthew")]?.enter).toEqual({
      kind: "node",
      toNodeId: first,
      stackBehavior: "push",
    });
  });

  it("last verse next joins the first verse of the next chapter", async () => {
    const app = bible();
    const result = await app.open("/kjv/Matthew/4/1");
    const lastOf4 = verseId({ book: "Matthew", chapter: 4, verse: 1 });
    const firstOf5 = verseId({ book: "Matthew", chapter: 5, verse: 1 });
    expect(result.node.label).toBe("1. Placeholder Matthew 4:1");
    expect(result.navigationMap[lastOf4]?.next).toEqual({
      kind: "node",
      toNodeId: firstOf5,
      stackBehavior: "replace",
    });

    const ch5 = await app.open("/kjv/Matthew/5/1");
    expect(ch5.navigationMap[firstOf5]?.prev).toEqual({
      kind: "node",
      toNodeId: lastOf4,
      stackBehavior: "replace",
    });
  });

  it("verse enter pushes Copy; option next has no action flag", async () => {
    const app = bible();
    const verse = await app.open("/kjv/Genesis/1/1");
    expect(verse.navigationMap[verse.node.id]?.enter).toEqual({
      kind: "node",
      toNodeId: optionId({ book: "Genesis", chapter: 1, verse: 1 }, "copy"),
      stackBehavior: "push",
    });

    const copyId = optionId({ book: "Genesis", chapter: 1, verse: 1 }, "copy");
    const result = await refresh(app, [{ nodeId: copyId, label: "Copy", location: null }]);
    expect(result.navigationMap[copyId]?.enter).toMatchObject({
      action: true,
    });
    expect(result.navigationMap[copyId]?.next).toMatchObject({
      kind: "node",
      stackBehavior: "replace",
    });
    expect(result.navigationMap[copyId]?.next).not.toHaveProperty("action");
  });

  it("Copy action returns clipboardText with book and chapter; display is verse number only", async () => {
    const app = bible();
    const ref = { book: "Genesis", chapter: 1, verse: 1 };
    const statusId = `bible:s:${ref.book}:${ref.chapter}:${ref.verse}:copy`;
    const copyId = optionId(ref, "copy");

    const verse = await app.open("/kjv/Genesis/1/1");
    expect(verse.node.label).toBe(
      "1. In the beginning God created the heaven and the earth.",
    );

    await refresh(app, [{ nodeId: copyId, label: "Copy", location: null }]);

    const copied = await refresh(
      app,
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

    const idle = await refresh(app, [{ nodeId: statusId, label: "Copied", location: null }]);
    expect(idle.clipboardText).toBeUndefined();
  });

  it("Copy without a verse line does not ask the client to copy", async () => {
    const app = bible();
    const result = await refresh(
      app,
      [{ nodeId: "bible:s:NotABook:1:1:copy", label: "Copying…", location: null }],
      { action: true },
    );
    expect(result.node.label).toContain("verse not found");
    expect(result.clipboardText).toBeUndefined();
  });

  it("RefreshResult survives structuredClone for open", async () => {
    const app = bible();
    const result = await app.open("/kjv/Genesis/1/1");
    expect(structuredClone(result)).toEqual(result);
  });

  it("unknown path falls back to Old Testament", async () => {
    const app = bible();
    const result = await app.open("/kjv/NotABook/99/1");
    expect(result.node.id).toBe(testamentId("OT"));
  });

  it("malformed percent-encoding in a book name uses the same fallback", async () => {
    const app = bible();
    const result = await app.open("/kjv/%E0%A4%A/1/1");
    expect(result.node.id).toBe(testamentId("OT"));
  });
});

describe("Bible packaging", () => {
  it("does not touch navigator.clipboard", async () => {
    const app = bible();
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
      app,
      [{ nodeId: "bible:s:Genesis:1:1:copy", label: "Copying…", location: null }],
      { action: true },
    );
    expect(clipboardGetter).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
