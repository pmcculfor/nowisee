import { afterEach, describe, expect, it } from "vitest";
import { edgeApp } from "../src/app-kit/index.ts";
import {
  CREATE_EDIT_NODE_ID,
  CREATE_NODE_ID,
  activeItemNodeId,
  addEditNodeId,
  addNodeId,
  catalogListNodeId,
  completedEmptyNodeId,
  completedItemNodeId,
  completedOpenNodeId,
  deleteConfirmNodeId,
  deleteNodeId,
  deletedNodeId,
  firstLineLabel,
  itemDoneNodeId,
  itemUndoNodeId,
} from "../src/apps/lists/ids.ts";
import { createListsApp, startListsApp, type ListsApp } from "../src/apps/lists/index.ts";
import { createSqliteListsStore, openListsDatabase } from "../src/apps/lists/store.ts";
import type { ListItemRecord, ListRecord, ListsStore } from "../src/apps/lists/types.ts";
import type { AppServerContext } from "../src/core/types.ts";
import { nodeEdge } from "./helpers/edges.ts";
import { refreshApp } from "./helpers/refreshCall.ts";

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
    const createEnter = edit.navigationMap[CREATE_EDIT_NODE_ID]?.enter;
    expect(createEnter).toMatchObject({
      kind: "node",
      stackBehavior: "replace",
      passInputText: true,
      action: true,
    });
    expect(createEnter && "toNodeId" in createEnter ? createEnter.toNodeId : "").toMatch(
      /^lists:list:[0-9a-f-]{36}:add$/,
    );
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
    expect(nodeEdge(interior.navigationMap[activeItemNodeId("older")]?.next)?.toNodeId).toBe(
      activeItemNodeId("newer"),
    );
    expect(interior.navigationMap[activeItemNodeId("older")]?.back).toEqual({
      kind: "node",
      stackBehavior: "pop",
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
    const edit = await app.open("/create/edit", {}, signedIn());
    const dest =
      edit.navigationMap[CREATE_EDIT_NODE_ID]?.enter &&
      "toNodeId" in edit.navigationMap[CREATE_EDIT_NODE_ID]!.enter!
        ? edit.navigationMap[CREATE_EDIT_NODE_ID]!.enter!.toNodeId!
        : "";
    const created = await app.refresh(
      dest,
      { action: { triggerId: CREATE_EDIT_NODE_ID }, inputText: "Shopping" },
      signedIn(),
    );
    expect(created.node.id).toBe(dest);
    expect(created.node.label).toBe("Add an item");
    const lists = await store.listLists(OWNER);
    expect(lists).toHaveLength(1);
    expect(lists[0]?.title).toBe("Shopping");
    expect(created.node.id).toBe(addNodeId(lists[0]!.id));
  });

  it("create item action lands on Add an item, not the new row", async () => {
    let clock = 0;
    const { app, store } = listsHarness({
      lists: [listRow({ id: "shop", title: "Shopping" })],
      idFactory: () => `item-${clock}`,
      now: () => `2026-04-0${++clock}T00:00:00.000Z`,
    });
    const created = await app.refresh(
      addNodeId("shop"),
      { action: { triggerId: addEditNodeId("shop") }, inputText: "Milk" },
      signedIn(),
    );
    expect(created.node.id).toBe(addNodeId("shop"));
    expect(created.node.label).toBe("Add an item");
    const items = await store.listItems(OWNER, "shop", "active");
    expect(items.map((i) => i.body)).toEqual(["Milk"]);
    expect(nodeEdge(created.navigationMap[addNodeId("shop")]?.next)?.toNodeId).toBe(activeItemNodeId("item-1"));
  });

  it("trimmed empty create and add do not write", async () => {
    const { app, store } = listsHarness({
      lists: [listRow({ id: "shop", title: "Shopping" })],
    });
    await app.refresh(
      addNodeId("shop"),
      { action: { triggerId: CREATE_EDIT_NODE_ID }, inputText: "   " },
      signedIn(),
    );
    expect(await store.listLists(OWNER)).toHaveLength(1);

    await app.refresh(
      addNodeId("shop"),
      { action: { triggerId: addEditNodeId("shop") }, inputText: "\n" },
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
      itemDoneNodeId("milk"),
      { action: { triggerId: activeItemNodeId("milk") } },
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
      stackBehavior: "stay",
    });
    expect(done.navigationMap[itemUndoNodeId("milk")]?.back).toEqual({
      kind: "node",
      stackBehavior: "pop",
    });
    expect(done.navigationMap[itemUndoNodeId("milk")]?.back).not.toMatchObject({
      action: true,
    });
    expect((await store.getItem(OWNER, "milk"))?.completedAt).not.toBeNull();

    const backToList = await app.refresh(activeItemNodeId("milk"), {}, signedIn());
    expect(backToList.node.id).toBe(addNodeId("shop"));
    expect((await store.getItem(OWNER, "milk"))?.completedAt).not.toBeNull();
  });

  it("refresh after complete repairs an active-item tip onto remaining items", async () => {
    const { app, store } = listsHarness({
      lists: [listRow({ id: "shop", title: "Shopping" })],
      items: [
        itemRow({ id: "milk", listId: "shop", body: "Milk" }),
        itemRow({ id: "eggs", listId: "shop", body: "Eggs" }),
      ],
    });
    await app.refresh(
      itemDoneNodeId("milk"),
      { action: { triggerId: activeItemNodeId("milk") } },
      signedIn(),
    );
    const backToList = await app.refresh(activeItemNodeId("milk"), {}, signedIn());
    expect(backToList.node.id).toBe(activeItemNodeId("eggs"));
    expect(backToList.node.label).toBe("Eggs");
    expect((await store.getItem(OWNER, "milk"))?.completedAt).not.toBeNull();
    expect((await store.getItem(OWNER, "eggs"))?.completedAt).toBeNull();
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
    const repaired = await refreshApp(app, activeItemNodeId("milk"), {}, signedIn());
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
      itemUndoNodeId("milk"),
      { action: { triggerId: itemUndoNodeId("milk") } },
      signedIn(),
    );
    expect(restored.node.id).toBe(itemUndoNodeId("milk"));
    expect(restored.node.label).toBe("Restored.");
    expect(restored.navigationMap[itemUndoNodeId("milk")]).toEqual({
      back: { kind: "node", stackBehavior: "pop" },
      enter: { kind: "node", stackBehavior: "pop" },
    });
    expect((await store.getItem(OWNER, "milk"))?.completedAt).toBeNull();
  });

  it("back from Undo complete pops without restoring", async () => {
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
    const interior = await app.open("/list/shop", {}, signedIn());
    expect(interior.navigationMap[itemUndoNodeId("milk")]?.back).toEqual({
      kind: "node",
      stackBehavior: "pop",
    });
    expect(interior.navigationMap[itemUndoNodeId("milk")]?.enter).toMatchObject({
      action: true,
    });

    const left = await app.refresh(itemUndoNodeId("milk"), {}, signedIn());
    expect(left.node.id).toBe(itemUndoNodeId("milk"));
    expect(left.node.label).toBe("Undo complete");
    expect((await store.getItem(OWNER, "milk"))?.completedAt).toBe("2026-05-01T00:00:00.000Z");
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
    expect(nodeEdge(completed.navigationMap[completedItemNodeId("newDone")]?.next)?.toNodeId).toBe(
      completedItemNodeId("oldDone"),
    );
    expect(completed.navigationMap[completedItemNodeId("newDone")]?.enter).toMatchObject({
      action: true,
      stackBehavior: "stay",
    });

    const restored = await app.refresh(
      completedItemNodeId("newDone"),
      { action: { triggerId: completedItemNodeId("newDone") } },
      signedIn(),
    );
    expect(restored.node.id).toBe(completedItemNodeId("newDone"));
    expect(restored.node.label).toBe("Restored.");
    expect(restored.navigationMap[completedItemNodeId("newDone")]).toEqual({
      back: { kind: "node", stackBehavior: "pop" },
      enter: { kind: "node", stackBehavior: "pop" },
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
      deletedNodeId("shop"),
      { action: { triggerId: deleteConfirmNodeId("shop") } },
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
    await refreshApp(app, itemDoneNodeId("milk"), {}, signedIn());
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
    await refreshApp(
      app,
      CREATE_EDIT_NODE_ID,
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

    const forgedList = await refreshApp(app, catalogListNodeId("theirs"), {}, signedIn(OWNER));
    expect(forgedList.node.label).not.toContain("Secret");
    expect(forgedList.node.id).toBe(catalogListNodeId("mine"));

    const forgedItem = await refreshApp(app, activeItemNodeId("their-item"), {}, signedIn(OWNER));
    expect(forgedItem.node.label).not.toContain("Secret");

    await app.refresh(
      itemDoneNodeId("their-item"),
      { action: { triggerId: activeItemNodeId("their-item") } },
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
    const result = await refreshApp(app, activeItemNodeId("milk"), {}, signedIn());
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
      const edit = await app.open("/create/edit", {}, ctx);
      const dest =
        edit.navigationMap[CREATE_EDIT_NODE_ID]?.enter &&
        "toNodeId" in edit.navigationMap[CREATE_EDIT_NODE_ID]!.enter!
          ? edit.navigationMap[CREATE_EDIT_NODE_ID]!.enter!.toNodeId!
          : "";
      const created = await app.refresh(
        dest,
        { action: { triggerId: CREATE_EDIT_NODE_ID }, inputText: "Errands" },
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
