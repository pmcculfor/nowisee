import { describe, expect, it } from "vitest";
import {
  CREATE_EDIT_NODE_ID,
  CREATE_NODE_ID,
  CREATE_RESULT_NODE_ID,
  firstLineLabel,
  noteEditNodeId,
  noteNodeId,
} from "../src/apps/notes/ids.ts";
import {
  createLocalNotesStore,
  createMemoryNotesStore,
  createNotesApp,
  NOTES_STORAGE_KEY,
} from "../src/apps/notes/index.ts";
import type { NoteRecord } from "../src/apps/notes/types.ts";
import type { RefreshResult } from "../src/core/types.ts";

function note(
  partial: Partial<NoteRecord> & Pick<NoteRecord, "id" | "body">,
): NoteRecord {
  return {
    createdAt: partial.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: partial.updatedAt ?? "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("Notes app", () => {
  it("open with no notes tips Create a note", async () => {
    const app = createNotesApp({
      rootAppId: "home",
      store: createMemoryNotesStore(),
    });
    const result = await app.open("/");
    expect(result.node.id).toBe(CREATE_NODE_ID);
    expect(result.node.label).toBe("Create a note");
    expect(result.location).toEqual({ appId: "notes", path: "/create" });
    expect(result.navigationMap[CREATE_NODE_ID]?.back).toEqual({
      kind: "app",
      to: { appId: "home", path: "/" },
    });
    expect(result.navigationMap[CREATE_NODE_ID]?.enter).toEqual({
      kind: "node",
      toNodeId: CREATE_EDIT_NODE_ID,
      stackBehavior: "replace",
    });
    const edit = await app.open("/create/edit");
    expect(edit.navigationMap[CREATE_EDIT_NODE_ID]?.enter).toMatchObject({
      kind: "node",
      toNodeId: CREATE_RESULT_NODE_ID,
      stackBehavior: "replace",
      passInputText: true,
      action: true,
    });
    expect(edit.navigationMap[CREATE_EDIT_NODE_ID]?.back).toEqual({
      kind: "node",
      toNodeId: CREATE_NODE_ID,
      stackBehavior: "replace",
    });
  });

  it("open with notes tips the most recently edited note, not Create", async () => {
    const store = createMemoryNotesStore({
      initial: [
        note({
          id: "old",
          body: "Older note\nsecond line",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
        note({
          id: "new",
          body: "Fresh headline\nbody",
          updatedAt: "2026-06-01T00:00:00.000Z",
        }),
      ],
    });
    const app = createNotesApp({ rootAppId: "home", store });
    const result = await app.open("/");

    expect(result.node.id).toBe(noteNodeId("new"));
    expect(result.node.label).toBe("Fresh headline");
    expect(result.location).toEqual({
      appId: "notes",
      path: "/note/new",
    });

    // Create sits above the first note (prev).
    expect(result.navigationMap[noteNodeId("new")]?.prev).toEqual({
      kind: "node",
      toNodeId: CREATE_NODE_ID,
      stackBehavior: "replace",
    });
    expect(result.navigationMap[CREATE_NODE_ID]?.next).toEqual({
      kind: "node",
      toNodeId: noteNodeId("new"),
      stackBehavior: "replace",
    });
    // Sorted by updatedAt desc: new → old
    expect(result.navigationMap[noteNodeId("new")]?.next).toEqual({
      kind: "node",
      toNodeId: noteNodeId("old"),
      stackBehavior: "replace",
    });
    // No wrap at ends
    expect(result.navigationMap[CREATE_NODE_ID]?.prev).toBeUndefined();
    expect(result.navigationMap[noteNodeId("old")]?.next).toBeUndefined();
  });

  it("list tips show only the first line", () => {
    expect(firstLineLabel("Hello world\nMore")).toBe("Hello world");
    expect(firstLineLabel("   ")).toBe("Empty note");
    expect(firstLineLabel("")).toBe("Empty note");
  });

  it("enter on a note opens an input with the full body", async () => {
    const store = createMemoryNotesStore({
      initial: [
        note({
          id: "n1",
          body: "Line one\nLine two",
          updatedAt: "2026-02-01T00:00:00.000Z",
        }),
      ],
    });
    const app = createNotesApp({ rootAppId: "home", store });
    const list = await app.open("/");
    const enter = list.navigationMap[noteNodeId("n1")]?.enter;
    expect(enter).toEqual({
      kind: "node",
      toNodeId: noteEditNodeId("n1"),
      stackBehavior: "replace",
    });

    const edit = (await app.open("/note/n1/edit")) as RefreshResult;
    expect(edit.node).toEqual({
      id: noteEditNodeId("n1"),
      label: "Line one\nLine two",
      kind: "input",
    });
    expect(edit.navigationMap[noteEditNodeId("n1")]?.enter).toMatchObject({
      kind: "node",
      toNodeId: noteNodeId("n1"),
      stackBehavior: "replace",
      passInputText: true,
      action: true,
    });
    expect(edit.navigationMap[noteEditNodeId("n1")]?.back).toEqual({
      kind: "node",
      toNodeId: noteNodeId("n1"),
      stackBehavior: "replace",
    });
  });

  it("create action writes a note; edit action updates body and updatedAt", async () => {
    let clock = 0;
    const store = createMemoryNotesStore({
      idFactory: () => `id-${clock}`,
      now: () => `2026-03-0${++clock}T00:00:00.000Z`,
    });
    const app = createNotesApp({ rootAppId: "home", store });

    const created = await app.refresh(
      [{ nodeId: "notes:create:result", label: "Saving…", location: null }],
      { action: true, inputText: "Brand new\nsecond" },
    );
    expect(created.node.id).toBe(noteNodeId("id-1"));
    expect(created.node.label).toBe("Brand new");
    expect(await store.list()).toEqual([
      {
        id: "id-1",
        body: "Brand new\nsecond",
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
    ]);

    const updated = await app.refresh(
      [{ nodeId: noteNodeId("id-1"), label: "Brand new", location: null }],
      { action: true, inputText: "Revised title\nmore" },
    );
    expect(updated.node.label).toBe("Revised title");
    const listed = await store.list();
    expect(listed[0]?.body).toBe("Revised title\nmore");
    expect(listed[0]?.updatedAt).toBe("2026-03-02T00:00:00.000Z");
    expect(listed[0]?.createdAt).toBe("2026-03-01T00:00:00.000Z");
  });

  it("does not create or update without extras.action", async () => {
    const store = createMemoryNotesStore({
      initial: [note({ id: "n1", body: "Keep me" })],
    });
    const app = createNotesApp({ rootAppId: "home", store });
    await app.refresh(
      [{ nodeId: noteNodeId("n1"), label: "Keep me", location: null }],
      { inputText: "should not save" },
    );
    expect((await store.get("n1"))?.body).toBe("Keep me");
  });

  it("deep-links resolve create and note paths", async () => {
    const store = createMemoryNotesStore({
      initial: [note({ id: "abc", body: "Hello" })],
    });
    const app = createNotesApp({ rootAppId: "home", store });
    expect((await app.open("/create")).node.id).toBe(CREATE_NODE_ID);
    expect((await app.open("/note/abc")).node.id).toBe(noteNodeId("abc"));
    expect((await app.open("/note/missing")).node.id).toBe(noteNodeId("abc"));
  });
});

describe("Notes local store seam", () => {
  it("persists through a KV adapter without touching browser APIs in the app", async () => {
    const bag = new Map<string, string>();
    const store = createLocalNotesStore({
      kv: {
        get: (k) => bag.get(k) ?? null,
        set: (k, v) => {
          bag.set(k, v);
        },
      },
      idFactory: () => "persisted-1",
      now: () => "2026-04-01T00:00:00.000Z",
    });

    await store.create("Saved locally");
    expect(bag.has(NOTES_STORAGE_KEY)).toBe(true);

    const reopened = createLocalNotesStore({
      kv: {
        get: (k) => bag.get(k) ?? null,
        set: (k, v) => {
          bag.set(k, v);
        },
      },
    });
    const list = await reopened.list();
    expect(list).toEqual([
      {
        id: "persisted-1",
        body: "Saved locally",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
      },
    ]);
  });
});
