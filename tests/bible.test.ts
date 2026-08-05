import { describe, expect, it, vi } from "vitest";
import { createBibleApp } from "../src/apps/bible/index.ts";
import { optionId, testamentId, verseId } from "../src/apps/bible/ids.ts";
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
    expect(result.node.label).toContain("Blessed are the poor in spirit");
    expect(result.location).toEqual({
      appId: "bible",
      path: "/kjv/Matthew/5/3",
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

  it("Copy action writes clipboard once; sibling browse does not", async () => {
    const app = bible();
    const written: string[] = [];
    const ref = { book: "Genesis", chapter: 1, verse: 1 };
    const statusId = `bible:s:${ref.book}:${ref.chapter}:${ref.verse}:copy`;
    const copyId = optionId(ref, "copy");

    await refresh(app, [{ nodeId: copyId, label: "Copy", location: null }]);
    expect(written).toEqual([]);

    const copied = await refresh(
      app,
      [
        { nodeId: copyId, label: "Copy", location: null },
        { nodeId: statusId, label: "Copying…", location: null },
      ],
      {
        action: true,
        platform: {
          clipboard: {
            writeText: async (text) => {
              written.push(text);
            },
          },
        },
      },
    );
    expect(copied.node.label).toBe("Copied");
    expect(copied.location).toBeNull();
    expect(written).toHaveLength(1);
    expect(written[0]).toContain("In the beginning God created");

    await refresh(
      app,
      [{ nodeId: statusId, label: "Copied", location: null }],
      {
        platform: {
          clipboard: {
            writeText: async (text) => {
              written.push(text);
            },
          },
        },
      },
    );
    expect(written).toHaveLength(1);
  });

  it("Copy fails gracefully when clipboard missing", async () => {
    const app = bible();
    const result = await refresh(
      app,
      [{ nodeId: "bible:s:Genesis:1:1:copy", label: "Copying…", location: null }],
      { action: true, platform: {} },
    );
    expect(result.node.label).toContain("clipboard unavailable");
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
      {
        action: true,
        platform: {
          clipboard: { writeText: async () => undefined },
        },
      },
    );
    expect(clipboardGetter).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
