import { afterEach, describe, expect, it } from "vitest";
import { edgeApp } from "../src/app-kit/index.ts";
import {
  CREATE_EDIT_NODE_ID,
  CREATE_NODE_ID,
  CREATE_RESULT_NODE_ID,
  activeItemNodeId,
  addNodeId,
  addResultNodeId,
  catalogListNodeId,
  completedEmptyNodeId,
  completedItemNodeId,
  completedOpenNodeId,
  deleteConfirmNodeId,
  deleteNodeId,
  deletedNodeId,
  firstLineLabel,
  itemDoneNodeId,
  itemRestoredNodeId,
  itemUndoNodeId,
} from "../src/apps/lists/ids.ts";
import { createListsApp, type ListsApp } from "../src/apps/lists/index.ts";
import {
  createSqliteListsStore,
  openListsDatabase,
  startListsApp,
} from "../src/apps/lists/store.ts";
import type { ListItemRecord, ListRecord, ListsStore } from "../src/apps/lists/types.ts";
import type { AppServerContext } from "../src/core/types.ts";

const OWNER = "user-1";
const OTHER = "user-2";

function signedIn(userId: string = OWNER): AppServerContext {
  return { userId, sessionId: "session-1", accountAppId: "account" };
}

function signedOutCtx(): AppServerContext {
  return { userId: null, sessionId: "session-1", accountAppId: "account" };
}

type SeedList = ListRecord & { readonly ownerId: string };
type SeedItem = ListItemRecord;

const opened: ListsApp[] = [];

afterEach(() => {
  for (const app of opened) {
    app.close();
  }
  opened.length = 0;
});

function listsHarness(
  options: {
    readonly lists?: readonly SeedList[];
    readonly items?: readonly SeedItem[];
    readonly idFactory?: () => string;
    readonly now?: () => string;
  } = {},
): { app: ListsApp; store: ListsStore } {
  const db = openListsDatabase(":memory:");
  const store = createSqliteListsStore(db, {
    idFactory: options.idFactory,
    now: options.now,
  });
  for (const list of options.lists ?? []) {
    db.run(
      "INSERT INTO list (id, owner_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      list.id,
      list.ownerId,
      list.title,
      list.createdAt,
      list.updatedAt,
    );
  }
  for (const item of options.items ?? []) {
    db.run(
      `INSERT INTO list_item (id, list_id, body, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      item.id,
      item.listId,
      item.body,
      item.completedAt,
      item.createdAt,
      item.updatedAt,
    );
  }
  const app = createListsApp({
    rootAppId: "home",
    store,
    close: () => db.close(),
  });
  opened.push(app);
  return { app, store };
}

function listRow(
  partial: Partial<SeedList> & { readonly id: string; readonly title: string },
): SeedList {
  return {
    createdAt: partial.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: partial.updatedAt ?? "2026-01-01T00:00:00.000Z",
    ownerId: partial.ownerId ?? OWNER,
    ...partial,
  };
}

function itemRow(
  partial: Partial<SeedItem> & { readonly id: string; readonly listId: string; readonly body: string },
): SeedItem {
  return {
    completedAt: partial.completedAt ?? null,
    createdAt: partial.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: partial.updatedAt ?? "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("Lists app", () => {
  it("open with no lists tips Create a list", async () => {
    const { app } = listsHarness();
    const result = await app.open("/", {}, signedIn());
    expect(result.node.id).toBe(CREATE_NODE_ID);
    expect(result.node.label).toBe("Create a list");
    expect(result.location).toEqual({ appId: "lists", path: "/create" });
    expect(result.navigationMap[CREATE_NODE_ID]?.back).toEqual({
      kind: "app",
      to: { appId: "home", path: "/app/lists" },
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
  });

  it("open with lists tips the most recently updated title; create sits above", async () => {
    const { app } = listsHarness({
      lists: [
        listRow({ id: "old", title: "Todo", updatedAt: "2026-01-01T00:00:00.000Z" }),
        listRow({ id: "new", title: "Shopping", updatedAt: "2026-06-01T00:00:00.000Z" }),
      ],
    });
    const result = await app.open("/", {}, signedIn());
    expect(result.node.id).toBe(catalogListNodeId("new"));
    expect(result.node.label).toBe("Shopping");
    expect(result.navigationMap[catalogListNodeId("new")]?.prev).toEqual({
      kind: "node",
      toNodeId: CREATE_NODE_ID,
      stackBehavior: "replace",
    });
    expect(result.navigationMap[catalogListNodeId("new")]?.next).toEqual({
      kind: "node",
      toNodeId: catalogListNodeId("old"),
      stackBehavior: "replace",
    });
    expect(result.navigationMap[CREATE_NODE_ID]?.prev).toBeUndefined();
    expect(result.navigationMap[catalogListNodeId("old")]?.next).toBeUndefined();
  });

  it("enter on a list lands on the oldest active item, not add", async () => {
    const { app } = listsHarness({
      lists: [listRow({ id: "shop", title: "Shopping" })],
      items: [
        itemRow({
          id: "newer",
          listId: "shop",
          body: "Yogurt",
          updatedAt: "2026-01-03T00:00:00.000Z",
        }),
        itemRow({
          id: "older",
          listId: "shop",
          body: "Bread",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
      ],
    });
    const catalog = await app.open("/", {}, signedIn());
    expect(catalog.navigationMap[catalogListNodeId("shop")]?.enter).toEqual({
      kind: "node",
      toNodeId: activeItemNodeId("older"),
      stackBehavior: "push",
    });

    const interior = await app.open("/list/shop", {}, signedIn());
    expect(interior.node.id).toBe(activeItemNodeId("older"));
    expect(interior.node.label).toBe("Bread");
    expect(interior.navigationMap[activeItemNodeId("older")]?.prev).toEqual({
      kind: "node",
      toNodeId: addNodeId("shop"),
      stackBehavior: "replace",
    });
    expect(interior.navigationMap[addNodeId("shop")]?.prev).toEqual({
      kind: "node",
      toNodeId: completedOpenNodeId("shop"),
      stackBehavior: "replace",
    });
    expect(interior.navigationMap[completedOpenNodeId("shop")]?.prev).toEqual({
      kind: "node",
      toNodeId: deleteNodeId("shop"),
      stackBehavior: "replace",
    });
    expect(interior.navigationMap[deleteNodeId("shop")]?.prev).toBeUndefined();
    expect(interior.navigationMap[activeItemNodeId("older")]?.next?.toNodeId).toBe(
      activeItemNodeId("newer"),
    );
    expect(interior.navigationMap[activeItemNodeId("older")]?.back).toEqual({
      kind: "node",
      toNodeId: catalogListNodeId("shop"),
      stackBehavior: "replace",
    });
  });

  it("empty list interior lands on Add an item", async () => {
    const { app } = listsHarness({
      lists: [listRow({ id: "empty", title: "Blank" })],
    });
    const interior = await app.open("/list/empty", {}, signedIn());
    expect(interior.node.id).toBe(addNodeId("empty"));
    expect(interior.node.label).toBe("Add an item");
  });

  it("create list action writes a row and lands on Add an item", async () => {
    let clock = 0;
    const { app, store } = listsHarness({
      idFactory: () => `id-${clock}`,
      now: () => `2026-03-0${++clock}T00:00:00.000Z`,
    });
    const created = await app.refresh(
      [{ nodeId: CREATE_RESULT_NODE_ID, label: "Saving…", location: null }],
      { action: true, inputText: "Shopping" },
      signedIn(),
    );
    expect(created.node.id).toBe(addNodeId("id-1"));
    expect(created.node.label).toBe("Add an item");
    expect(await store.listLists(OWNER)).toEqual([
      {
        id: "id-1",
        title: "Shopping",
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
    ]);
  });

  it("create item action lands on Add an item, not the new row", async () => {
    let clock = 0;
    const { app, store } = listsHarness({
      lists: [listRow({ id: "shop", title: "Shopping" })],
      idFactory: () => `item-${clock}`,
      now: () => `2026-04-0${++clock}T00:00:00.000Z`,
    });
    const created = await app.refresh(
      [{ nodeId: addResultNodeId("shop"), label: "Saving…", location: null }],
      { action: true, inputText: "Milk" },
      signedIn(),
    );
    expect(created.node.id).toBe(addNodeId("shop"));
    expect(created.node.label).toBe("Add an item");
    const items = await store.listItems(OWNER, "shop", "active");
    expect(items.map((i) => i.body)).toEqual(["Milk"]);
    expect(created.navigationMap[addNodeId("shop")]?.next?.toNodeId).toBe(activeItemNodeId("item-1"));
  });

  it("trimmed empty create and add do not write", async () => {
    const { app, store } = listsHarness({
      lists: [listRow({ id: "shop", title: "Shopping" })],
    });
    await app.refresh(
      [{ nodeId: CREATE_RESULT_NODE_ID, label: "Saving…", location: null }],
      { action: true, inputText: "   " },
      signedIn(),
    );
    expect(await store.listLists(OWNER)).toHaveLength(1);

    await app.refresh(
      [{ nodeId: addResultNodeId("shop"), label: "Saving…", location: null }],
      { action: true, inputText: "\n" },
      signedIn(),
    );
    expect(await store.listItems(OWNER, "shop", "active")).toEqual([]);
  });

  it("complete action stays on Completed; left and right pop; down is undo", async () => {
    const { app, store } = listsHarness({
      lists: [listRow({ id: "shop", title: "Shopping" })],
      items: [itemRow({ id: "milk", listId: "shop", body: "Milk" })],
    });
    const interior = await app.open("/list/shop", {}, signedIn());
    expect(interior.navigationMap[activeItemNodeId("milk")]?.enter).toMatchObject({
      kind: "node",
      toNodeId: itemDoneNodeId("milk"),
      stackBehavior: "push",
      action: true,
    });

    const done = await app.refresh(
      [
        { nodeId: catalogListNodeId("shop"), label: "Shopping", location: null },
        { nodeId: activeItemNodeId("milk"), label: "Milk", location: null },
        { nodeId: itemDoneNodeId("milk"), label: "Completed.", location: null },
      ],
      { action: true },
      signedIn(),
    );
    expect(done.node.id).toBe(itemDoneNodeId("milk"));
    expect(done.node.label).toBe("Completed.");
    expect(done.location).toBeNull();
    expect(done.navigationMap[itemDoneNodeId("milk")]?.back).toEqual({
      kind: "node",
      stackBehavior: "pop",
    });
    expect(done.navigationMap[itemDoneNodeId("milk")]?.enter).toEqual({
      kind: "node",
      stackBehavior: "pop",
    });
    expect(done.navigationMap[itemDoneNodeId("milk")]?.next).toEqual({
      kind: "node",
      toNodeId: itemUndoNodeId("milk"),
      stackBehavior: "replace",
    });
    expect(done.navigationMap[itemUndoNodeId("milk")]?.enter).toMatchObject({
      action: true,
      toNodeId: itemRestoredNodeId("milk"),
      stackBehavior: "replace",
    });
    expect((await store.getItem(OWNER, "milk"))?.completedAt).not.toBeNull();
  });

  it("refresh after complete repairs an active-item tip onto Add when the list is empty", async () => {
    const { app } = listsHarness({
      lists: [listRow({ id: "shop", title: "Shopping" })],
      items: [
        itemRow({
          id: "milk",
          listId: "shop",
          body: "Milk",
          completedAt: "2026-05-01T00:00:00.000Z",
        }),
      ],
    });
    const repaired = await app.refresh(
      [{ nodeId: activeItemNodeId("milk"), label: "Milk", location: null }],
      {},
      signedIn(),
    );
    expect(repaired.node.id).toBe(addNodeId("shop"));
  });

  it("undo restore action clears completed_at and lands on Restored", async () => {
    const { app, store } = listsHarness({
      lists: [listRow({ id: "shop", title: "Shopping" })],
      items: [
        itemRow({
          id: "milk",
          listId: "shop",
          body: "Milk",
          completedAt: "2026-05-01T00:00:00.000Z",
        }),
      ],
    });
    const restored = await app.refresh(
      [{ nodeId: itemRestoredNodeId("milk"), label: "Restored.", location: null }],
      { action: true },
      signedIn(),
    );
    expect(restored.node.id).toBe(itemRestoredNodeId("milk"));
    expect(restored.node.label).toBe("Restored.");
    expect((await store.getItem(OWNER, "milk"))?.completedAt).toBeNull();
  });

  it("completed list is newest completed first; restore is an action", async () => {
    const { app } = listsHarness({
      lists: [listRow({ id: "shop", title: "Shopping" })],
      items: [
        itemRow({
          id: "oldDone",
          listId: "shop",
          body: "Bread",
          completedAt: "2026-01-01T00:00:00.000Z",
        }),
        itemRow({
          id: "newDone",
          listId: "shop",
          body: "Milk",
          completedAt: "2026-06-01T00:00:00.000Z",
        }),
      ],
    });
    const completed = await app.open("/list/shop/completed", {}, signedIn());
    expect(completed.node.id).toBe(completedItemNodeId("newDone"));
    expect(completed.navigationMap[completedItemNodeId("newDone")]?.next?.toNodeId).toBe(
      completedItemNodeId("oldDone"),
    );
    expect(completed.navigationMap[completedItemNodeId("newDone")]?.enter).toMatchObject({
      action: true,
      toNodeId: itemRestoredNodeId("newDone"),
      stackBehavior: "replace",
    });
  });

  it("empty completed list tips No completed items", async () => {
    const { app } = listsHarness({
      lists: [listRow({ id: "shop", title: "Shopping" })],
    });
    const completed = await app.open("/list/shop/completed", {}, signedIn());
    expect(completed.node.id).toBe(completedEmptyNodeId("shop"));
    expect(completed.node.label).toBe("No completed items.");
  });

  it("delete confirmation is not an action; confirm deletes and status leaves via app open", async () => {
    const { app, store } = listsHarness({
      lists: [listRow({ id: "shop", title: "Shopping" })],
      items: [itemRow({ id: "milk", listId: "shop", body: "Milk" })],
    });
    const del = await app.open("/list/shop/delete", {}, signedIn());
    expect(del.navigationMap[deleteNodeId("shop")]?.enter).toEqual({
      kind: "node",
      toNodeId: deleteConfirmNodeId("shop"),
      stackBehavior: "push",
    });
    expect(del.navigationMap[deleteNodeId("shop")]?.enter).not.toMatchObject({ action: true });

    const confirm = await app.open("/list/shop/delete/confirm", {}, signedIn());
    expect(confirm.node.label).toBe("This list will be permanently deleted.");
    expect(confirm.navigationMap[deleteConfirmNodeId("shop")]?.enter).toMatchObject({
      action: true,
      toNodeId: deletedNodeId("shop"),
    });

    const gone = await app.refresh(
      [{ nodeId: deletedNodeId("shop"), label: "List deleted.", location: null }],
      { action: true },
      signedIn(),
    );
    expect(gone.node.label).toBe("List deleted.");
    expect(gone.location).toBeNull();
    expect(gone.navigationMap[deletedNodeId("shop")]?.back).toEqual(
      edgeApp({ appId: "lists", path: "/" }),
    );
    expect(gone.navigationMap[deletedNodeId("shop")]?.enter).toEqual(
      edgeApp({ appId: "lists", path: "/" }),
    );
    expect(await store.getList(OWNER, "shop")).toBeNull();
    expect(await store.getItem(OWNER, "milk")).toBeNull();
  });

  it("does not mutate without extras.action", async () => {
    const { app, store } = listsHarness({
      lists: [listRow({ id: "shop", title: "Shopping" })],
      items: [itemRow({ id: "milk", listId: "shop", body: "Milk" })],
    });
    await app.refresh(
      [{ nodeId: itemDoneNodeId("milk"), label: "Completed.", location: null }],
      {},
      signedIn(),
    );
    expect((await store.getItem(OWNER, "milk"))?.completedAt).toBeNull();
  });

  it("signed out is a sign-in node and does not create a list", async () => {
    const { app, store } = listsHarness();
    const result = await app.open("/", {}, signedOutCtx());
    expect(result.node.label).toBe("Sign in to use Lists.");
    expect(result.navigationMap[result.node.id]?.enter).toEqual(
      edgeApp({ appId: "account", path: "/" }),
    );
    expect(result.navigationMap[result.node.id]?.back).toEqual(
      edgeApp({ appId: "home", path: "/app/lists" }),
    );
    await app.refresh(
      [{ nodeId: CREATE_RESULT_NODE_ID, label: "Saving…", location: null }],
      { action: true, inputText: "Nope" },
      signedOutCtx(),
    );
    expect(await store.listLists(OWNER)).toEqual([]);
  });

  it("missing ctx is treated as signed out", async () => {
    const { app } = listsHarness();
    const result = await app.open("/");
    expect(result.node.label).toBe("Sign in to use Lists.");
  });

  it("lists only the signed-in owner's rows; a forged id is not found", async () => {
    const { app, store } = listsHarness({
      lists: [
        listRow({ id: "mine", title: "My list", ownerId: OWNER }),
        listRow({ id: "theirs", title: "Secret list", ownerId: OTHER }),
      ],
      items: [
        itemRow({ id: "my-item", listId: "mine", body: "Eggs" }),
        itemRow({ id: "their-item", listId: "theirs", body: "Secret item" }),
      ],
    });
    const mine = await app.open("/", {}, signedIn(OWNER));
    expect(mine.node.label).toBe("My list");
    expect(mine.warm.some((n) => n.label.includes("Secret"))).toBe(false);

    const forgedList = await app.refresh(
      [{ nodeId: catalogListNodeId("theirs"), label: "Secret list", location: null }],
      {},
      signedIn(OWNER),
    );
    expect(forgedList.node.label).not.toContain("Secret");
    expect(forgedList.node.id).toBe(catalogListNodeId("mine"));

    const forgedItem = await app.refresh(
      [{ nodeId: activeItemNodeId("their-item"), label: "Secret item", location: null }],
      {},
      signedIn(OWNER),
    );
    expect(forgedItem.node.label).not.toContain("Secret");

    await app.refresh(
      [{ nodeId: itemDoneNodeId("their-item"), label: "Completed.", location: null }],
      { action: true },
      signedIn(OWNER),
    );
    expect((await store.getItem(OTHER, "their-item"))?.completedAt).toBeNull();
  });

  it("firstLineLabel uses the first line or a placeholder", () => {
    expect(firstLineLabel("Hello\nMore", "Empty item")).toBe("Hello");
    expect(firstLineLabel("   ", "Empty item")).toBe("Empty item");
  });

  it("interior with a parent on the stack pops on back", async () => {
    const { app } = listsHarness({
      lists: [listRow({ id: "shop", title: "Shopping" })],
      items: [itemRow({ id: "milk", listId: "shop", body: "Milk" })],
    });
    const result = await app.refresh(
      [
        { nodeId: catalogListNodeId("shop"), label: "Shopping", location: null },
        { nodeId: activeItemNodeId("milk"), label: "Milk", location: null },
      ],
      {},
      signedIn(),
    );
    expect(result.navigationMap[activeItemNodeId("milk")]?.back).toEqual({
      kind: "node",
      stackBehavior: "pop",
    });
  });
});

describe("Lists sqlite store", () => {
  it("scopes every query by list.owner_id and sorts by timestamps", async () => {
    const db = openListsDatabase(":memory:");
    const store = createSqliteListsStore(db);
    db.run(
      "INSERT INTO list (id, owner_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      "old",
      OWNER,
      "Todo",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
    db.run(
      "INSERT INTO list (id, owner_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      "new",
      OWNER,
      "Shopping",
      "2026-01-02T00:00:00.000Z",
      "2026-06-01T00:00:00.000Z",
    );
    db.run(
      "INSERT INTO list (id, owner_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      "other",
      OTHER,
      "Not yours",
      "2026-07-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
    );
    db.run(
      `INSERT INTO list_item (id, list_id, body, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?)`,
      "a",
      "new",
      "Bread",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
    db.run(
      `INSERT INTO list_item (id, list_id, body, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?)`,
      "b",
      "new",
      "Milk",
      "2026-01-02T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
    );
    db.run(
      `INSERT INTO list_item (id, list_id, body, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      "secret",
      "other",
      "Secret",
      null,
      "2026-07-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
    );

    const listed = await store.listLists(OWNER);
    expect(listed.map((l) => l.id)).toEqual(["new", "old"]);
    expect(await store.getList(OWNER, "other")).toBeNull();
    expect(await store.getItem(OWNER, "secret")).toBeNull();
    expect((await store.listItems(OWNER, "new", "active")).map((i) => i.id)).toEqual(["a", "b"]);
    expect(await store.completeItem(OWNER, "secret")).toBeNull();
    expect(await store.deleteList(OWNER, "other")).toBe(false);

    const first = await store.firstActiveItems(OWNER);
    expect(first).toEqual([{ listId: "new", itemId: "a", body: "Bread" }]);
    db.close();
  });

  it("complete then restore and cascade delete", async () => {
    const db = openListsDatabase(":memory:");
    const store = createSqliteListsStore(db, {
      now: (() => {
        let n = 0;
        return () => `2026-08-0${++n}T00:00:00.000Z`;
      })(),
    });
    await store.createList(OWNER, "Shop");
    const lists = await store.listLists(OWNER);
    const listId = lists[0]!.id;
    const item = await store.createItem(OWNER, listId, "Eggs");
    expect(item).not.toBeNull();
    const completed = await store.completeItem(OWNER, item!.id);
    expect(completed?.completedAt).toBe("2026-08-03T00:00:00.000Z");
    expect((await store.listItems(OWNER, listId, "completed")).map((i) => i.id)).toEqual([item!.id]);
    const restored = await store.restoreItem(OWNER, item!.id);
    expect(restored?.completedAt).toBeNull();
    expect((await store.listItems(OWNER, listId, "active")).map((i) => i.id)).toEqual([item!.id]);
    expect(await store.deleteList(OWNER, listId)).toBe(true);
    expect(await store.getItem(OWNER, item!.id)).toBeNull();
    db.close();
  });

  it("startListsApp create then open lands on the new list", async () => {
    const app = startListsApp({ rootAppId: "home", dbPath: ":memory:" });
    try {
      const ctx = signedIn();
      const created = await app.refresh(
        [{ nodeId: CREATE_RESULT_NODE_ID, label: "Saving…", location: null }],
        { action: true, inputText: "Errands" },
        ctx,
      );
      expect(created.node.label).toBe("Add an item");
      const openedRoot = await app.open("/", {}, ctx);
      expect(openedRoot.node.label).toBe("Errands");
    } finally {
      app.close();
    }
  });
});
