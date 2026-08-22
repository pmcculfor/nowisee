import { describe, expect, it } from "vitest";
import {
  CREATE_EDIT_NODE_ID,
  CREATE_NODE_ID,
  CREATE_RESULT_NODE_ID,
  firstLineLabel,
  noteEditNodeId,
  noteNodeId,
} from "../src/apps/notes/ids.ts";
import { createNotesApp } from "../src/apps/notes/index.ts";
import {
  createMemoryNotesStore,
  createSqliteNotesStore,
  openNotesDatabase,
  startNotesApp,
} from "../src/apps/notes/store.ts";
import type { NoteRecord } from "../src/apps/notes/types.ts";
import type { AppServerContext, RefreshResult } from "../src/core/types.ts";
import { edgeApp } from "../src/app-kit/index.ts";

const OWNER = "user-1";
const OTHER = "user-2";

function signedIn(userId: string = OWNER): AppServerContext {
  return { userId, sessionId: "session-1", accountAppId: "account" };
}

function signedOutCtx(): AppServerContext {
  return { userId: null, sessionId: "session-1", accountAppId: "account" };
}

function note(
  partial: Partial<NoteRecord> & {
    readonly id: string;
    readonly body: string;
    readonly ownerId?: string;
  },
): NoteRecord & { ownerId: string } {
  return {
    createdAt: partial.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: partial.updatedAt ?? "2026-01-01T00:00:00.000Z",
    ...partial,
    ownerId: partial.ownerId ?? OWNER,
  };
}

describe("Notes app", () => {
  it("open with no notes tips Create a note", async () => {
    const app = createNotesApp({
      rootAppId: "home",
      store: createMemoryNotesStore(),
    });
    const result = await app.open("/", {}, signedIn());
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
    const edit = await app.open("/create/edit", {}, signedIn());
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
    const result = await app.open("/", {}, signedIn());

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
    const list = await app.open("/", {}, signedIn());
    const enter = list.navigationMap[noteNodeId("n1")]?.enter;
    expect(enter).toEqual({
      kind: "node",
      toNodeId: noteEditNodeId("n1"),
      stackBehavior: "replace",
    });

    const edit = (await app.open("/note/n1/edit", {}, signedIn())) as RefreshResult;
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
    const ctx = signedIn();

    const created = await app.refresh(
      [{ nodeId: "notes:create:result", label: "Saving…", location: null }],
      { action: true, inputText: "Brand new\nsecond" },
      ctx,
    );
    expect(created.node.id).toBe(noteNodeId("id-1"));
    expect(created.node.label).toBe("Brand new");
    expect(await store.list(OWNER)).toEqual([
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
      ctx,
    );
    expect(updated.node.label).toBe("Revised title");
    const listed = await store.list(OWNER);
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
      signedIn(),
    );
    expect((await store.get(OWNER, "n1"))?.body).toBe("Keep me");
  });

  it("does not save when action is set but typed text is missing", async () => {
    const store = createMemoryNotesStore({
      initial: [note({ id: "n1", body: "Keep me" })],
    });
    const app = createNotesApp({ rootAppId: "home", store });
    await app.refresh(
      [{ nodeId: noteNodeId("n1"), label: "Keep me", location: null }],
      { action: true },
      signedIn(),
    );
    expect((await store.get(OWNER, "n1"))?.body).toBe("Keep me");
  });

  it("stale edit id does not throw; list falls back to the default tip", async () => {
    const store = createMemoryNotesStore({
      initial: [note({ id: "n1", body: "Keep me" })],
    });
    const app = createNotesApp({ rootAppId: "home", store });
    const result = await app.refresh(
      [{ nodeId: noteNodeId("gone"), label: "Gone", location: null }],
      { action: true, inputText: "nope" },
      signedIn(),
    );
    expect(await store.get(OWNER, "n1")).toMatchObject({ body: "Keep me" });
    expect(result.node.id).toBe(noteNodeId("n1"));
  });

  it("deep-links resolve create and note paths", async () => {
    const store = createMemoryNotesStore({
      initial: [note({ id: "abc", body: "Hello" })],
    });
    const app = createNotesApp({ rootAppId: "home", store });
    const ctx = signedIn();
    expect((await app.open("/create", {}, ctx)).node.id).toBe(CREATE_NODE_ID);
    expect((await app.open("/note/abc", {}, ctx)).node.id).toBe(noteNodeId("abc"));
    expect((await app.open("/note/missing", {}, ctx)).node.id).toBe(noteNodeId("abc"));
  });

  it("signed out is a sign-in node and does not create a note", async () => {
    const store = createMemoryNotesStore();
    const app = createNotesApp({ rootAppId: "home", store });
    const result = await app.open("/", {}, signedOutCtx());
    expect(result.node.label).toBe("Sign in to use Notes.");
    expect(result.navigationMap[result.node.id]?.enter).toEqual(
      edgeApp({ appId: "account", path: "/" }),
    );
    expect(result.navigationMap[result.node.id]?.back).toEqual(
      edgeApp({ appId: "home", path: "/" }),
    );

    await app.refresh(
      [{ nodeId: CREATE_RESULT_NODE_ID, label: "Saving…", location: null }],
      { action: true, inputText: "should not save" },
      signedOutCtx(),
    );
    expect(await store.list(OWNER)).toEqual([]);
  });

  it("missing ctx is treated as signed out", async () => {
    const app = createNotesApp({
      rootAppId: "home",
      store: createMemoryNotesStore(),
    });
    const result = await app.open("/");
    expect(result.node.label).toBe("Sign in to use Notes.");
  });

  it("lists only the signed-in owner's notes; a forged id is not found", async () => {
    const store = createMemoryNotesStore({
      initial: [
        note({ id: "mine", body: "My note", ownerId: OWNER }),
        note({ id: "theirs", body: "Secret other note", ownerId: OTHER }),
      ],
    });
    const app = createNotesApp({ rootAppId: "home", store });
    const mine = await app.open("/", {}, signedIn(OWNER));
    expect(mine.node.label).toBe("My note");
    expect(mine.warm.some((n) => n.label.includes("Secret"))).toBe(false);

    const forged = await app.refresh(
      [{ nodeId: noteNodeId("theirs"), label: "Secret other note", location: null }],
      {},
      signedIn(OWNER),
    );
    expect(forged.node.label).not.toContain("Secret");
    expect(forged.node.id).toBe(noteNodeId("mine"));

    const stolenWrite = await app.refresh(
      [{ nodeId: noteNodeId("theirs"), label: "Secret other note", location: null }],
      { action: true, inputText: "pwned" },
      signedIn(OWNER),
    );
    expect(stolenWrite.node.label).not.toContain("pwned");
    expect((await store.get(OTHER, "theirs"))?.body).toBe("Secret other note");
  });
});

describe("Notes sqlite store", () => {
  it("scopes every query by owner_id and orders by updated_at descending", async () => {
    const db = openNotesDatabase(":memory:");
    const store = createSqliteNotesStore(db);
    db.run(
      "INSERT INTO notes (id, owner_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      "old",
      OWNER,
      "Older note",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
    db.run(
      "INSERT INTO notes (id, owner_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      "new",
      OWNER,
      "Fresh headline",
      "2026-01-02T00:00:00.000Z",
      "2026-06-01T00:00:00.000Z",
    );
    db.run(
      "INSERT INTO notes (id, owner_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      "other",
      OTHER,
      "Not yours",
      "2026-07-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
    );

    const listed = await store.list(OWNER);
    expect(listed.map((n) => n.id)).toEqual(["new", "old"]);
    expect(await store.get(OWNER, "other")).toBeNull();
    expect(await store.update(OWNER, "other", "pwned")).toBeNull();
    expect((await store.get(OTHER, "other"))?.body).toBe("Not yours");
    db.close();
  });

  it("startNotesApp create then list returns the new note as the tip", async () => {
    const app = startNotesApp({ rootAppId: "home", dbPath: ":memory:" });
    try {
      const ctx = signedIn();
      const created = await app.refresh(
        [{ nodeId: CREATE_RESULT_NODE_ID, label: "Saving…", location: null }],
        { action: true, inputText: "Hello sqlite\nbody" },
        ctx,
      );
      expect(created.node.label).toBe("Hello sqlite");
      const opened = await app.open("/", {}, ctx);
      expect(opened.node.label).toBe("Hello sqlite");
    } finally {
      app.close();
    }
  });
});
