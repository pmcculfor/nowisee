import { afterEach, describe, expect, it } from "vitest";
import {
  ADD_EMPTY_ID,
  ADD_MENU_ID,
  MANAGE_NODE_ID,
  MANAGE_SIGNED_OUT_ID,
  REMOVE_MENU_ID,
  REORDER_MENU_ID,
  addAddedNodeId,
  addAppNodeId,
  removeAppNodeId,
  removeRemovedNodeId,
  reorderAppNodeId,
  reorderMoveDownId,
  reorderMoveUpId,
  reorderMovingId,
} from "../src/apps/home/ids.ts";
import { createHomeApp, type HomeApp } from "../src/apps/home/index.ts";
import {
  createSqliteHomeStore,
  openHomeDatabase,
  startHomeApp,
} from "../src/apps/home/store.ts";
import type { AppDescriptor, AppServerContext, RefreshResult } from "../src/core/types.ts";

const OWNER = "user-1";
const OTHER = "user-2";

function packList(): AppDescriptor[] {
  return [
    { id: "home", label: "Home", homeRole: "internal" },
    { id: "help", label: "Help", homeRole: "default" },
    { id: "bible", label: "Bible", homeRole: "default" },
    { id: "notes", label: "Notes", homeRole: "default" },
    { id: "gmail", label: "Gmail" },
    { id: "account", label: "Account", homeRole: "required" },
  ];
}

function signedOutCtx(list: AppDescriptor[] = packList()): AppServerContext {
  return {
    userId: null,
    sessionId: "test",
    accountAppId: "account",
    directory: { list: () => list },
  };
}

function signedInCtx(
  list: AppDescriptor[] = packList(),
  userId: string = OWNER,
): AppServerContext {
  return {
    userId,
    sessionId: "test",
    accountAppId: "account",
    directory: { list: () => list },
  };
}

const opened: HomeApp[] = [];

afterEach(() => {
  for (const app of opened) {
    app.close();
  }
  opened.length = 0;
});

function homeApp(): HomeApp {
  const db = openHomeDatabase(":memory:");
  const app = createHomeApp({
    store: createSqliteHomeStore(db),
    close: () => db.close(),
  });
  opened.push(app);
  return app;
}

describe("Home app", () => {
  it("signed out lists default ∪ required then Manage Apps; omits Gmail and Home", async () => {
    const result = (await homeApp().open("/", {}, signedOutCtx())) as RefreshResult;
    expect(result.warm.map((n) => n.label)).toEqual([
      "Help",
      "Bible",
      "Notes",
      "Account",
      "Manage Apps",
    ]);
    expect(result.node.label).toBe("Help");
    expect(result.navigationMap[result.node.id]?.back).toBeUndefined();
    expect(result.navigationMap[MANAGE_NODE_ID]?.enter).toEqual({
      kind: "node",
      toNodeId: MANAGE_SIGNED_OUT_ID,
      stackBehavior: "push",
    });
  });

  it("open lists peer apps with wrap and app enter edges; no back", async () => {
    const home = createHomeApp();
    const ctx = signedOutCtx([
      { id: "home", label: "Home", homeRole: "internal" },
      { id: "bible", label: "Bible", homeRole: "default" },
      { id: "mail", label: "Mail", homeRole: "default" },
    ]);

    const result = (await home.open("/", {}, ctx)) as RefreshResult;
    expect(result.node.label).toBe("Bible");
    expect(result.warm.map((n) => n.label)).toEqual(["Bible", "Mail", "Manage Apps"]);

    const bibleId = result.node.id;
    const mail = result.warm.find((n) => n.label === "Mail")!;

    expect(result.navigationMap[bibleId]?.next).toEqual({
      kind: "node",
      toNodeId: mail.id,
      stackBehavior: "replace",
    });
    expect(result.navigationMap[mail.id]?.next).toEqual({
      kind: "node",
      toNodeId: MANAGE_NODE_ID,
      stackBehavior: "replace",
    });
    expect(result.navigationMap[MANAGE_NODE_ID]?.next).toEqual({
      kind: "node",
      toNodeId: bibleId,
      stackBehavior: "replace",
    });

    expect(result.navigationMap[bibleId]?.enter).toEqual({
      kind: "app",
      to: { appId: "bible", path: "/" },
    });
    expect(result.navigationMap[bibleId]?.back).toBeUndefined();
  });

  it("open /app/:id lands on that catalog row", async () => {
    const result = (await homeApp().open("/app/bible", {}, signedOutCtx())) as RefreshResult;
    expect(result.node.label).toBe("Bible");
    expect(result.location).toEqual({ appId: "home", path: "/app/bible" });
  });

  it("does not embed foreign app node ids — only home:* ids and app locations", async () => {
    const result = (await homeApp().open("/", {}, signedOutCtx())) as RefreshResult;
    for (const id of Object.keys(result.navigationMap)) {
      expect(id.startsWith("home:")).toBe(true);
    }
    for (const node of result.warm) {
      expect(node.id.startsWith("home:")).toBe(true);
    }
  });

  it("reads descriptors from ctx.directory, not a registry handle", async () => {
    const calls: AppDescriptor[][] = [];
    const home = createHomeApp();
    const list = packList();
    const ctx: AppServerContext = {
      userId: null,
      sessionId: "test",
      accountAppId: "account",
      directory: {
        list() {
          calls.push(list);
          return list;
        },
      },
    };
    await home.open("/", {}, ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toEqual({ id: "home", label: "Home", homeRole: "internal" });
    expect(calls[0]![0]).not.toHaveProperty("open");
    expect(home).not.toHaveProperty("registry");
  });

  it("refresh keeps tip when still present; repairs when catalog changes", async () => {
    let list: AppDescriptor[] = [
      { id: "home", label: "Home", homeRole: "internal" },
      { id: "bible", label: "Bible", homeRole: "default" },
      { id: "mail", label: "Mail", homeRole: "default" },
    ];
    const home = createHomeApp();
    const ctx = (): AppServerContext => signedOutCtx(list);

    const openedResult = (await home.open("/", {}, ctx())) as RefreshResult;
    const mail = openedResult.warm.find((n) => n.label === "Mail")!;
    const refreshed = (await home.refresh(
      [{ nodeId: mail.id, label: mail.label, location: null }],
      {},
      ctx(),
    )) as RefreshResult;
    expect(refreshed.node.id).toBe(mail.id);

    list = [
      { id: "home", label: "Home", homeRole: "internal" },
      { id: "bible", label: "Bible", homeRole: "default" },
    ];
    const repaired = (await home.refresh(
      [{ nodeId: mail.id, label: mail.label, location: null }],
      {},
      ctx(),
    )) as RefreshResult;
    expect(repaired.node.label).toBe("Bible");
  });

  it("Home's own id is omitted even without a homeRole flag", async () => {
    const home = createHomeApp();
    const result = (await home.open(
      "/",
      {},
      signedOutCtx([
        { id: "home", label: "Home" },
        { id: "bible", label: "Bible", homeRole: "default" },
      ]),
    )) as RefreshResult;
    expect(result.warm.map((n) => n.label)).toEqual(["Bible", "Manage Apps"]);
  });

  it("internal apps are omitted from home, add, remove, and reorder", async () => {
    const list: AppDescriptor[] = [
      { id: "home", label: "Home", homeRole: "internal" },
      { id: "switcher", label: "App Switcher", homeRole: "internal" },
      { id: "bible", label: "Bible", homeRole: "default" },
      { id: "account", label: "Account", homeRole: "required" },
    ];
    const app = homeApp();
    const ctx = signedInCtx(list);
    const home = (await app.open("/", {}, ctx)) as RefreshResult;
    expect(home.warm.map((n) => n.label)).toEqual(["Bible", "Account", "Manage Apps"]);

    const add = (await app.open("/manage/add", {}, ctx)) as RefreshResult;
    expect(add.navigationMap[ADD_MENU_ID]?.enter).toMatchObject({
      kind: "node",
      toNodeId: ADD_EMPTY_ID,
    });
  });

  it("missing directory capability shows Home root", async () => {
    const home = createHomeApp();
    const result = (await home.open("/")) as RefreshResult;
    expect(result.node.label).toBe("Home");
  });

  it("RefreshResult survives structuredClone", async () => {
    const result = (await homeApp().open("/", {}, signedOutCtx())) as RefreshResult;
    expect(structuredClone(result)).toEqual(result);
  });

  it("signed-out refresh of Manage Apps stays on the catalog row", async () => {
    const app = homeApp();
    const ctx = signedOutCtx();
    const opened = (await app.open("/", {}, ctx)) as RefreshResult;
    expect(opened.navigationMap[MANAGE_NODE_ID]?.enter).toEqual({
      kind: "node",
      toNodeId: MANAGE_SIGNED_OUT_ID,
      stackBehavior: "push",
    });

    const refreshed = (await app.refresh(
      [{ nodeId: MANAGE_NODE_ID, label: "Manage Apps", location: null }],
      {},
      ctx,
    )) as RefreshResult;
    expect(refreshed.node.id).toBe(MANAGE_NODE_ID);
    expect(refreshed.node.label).toBe("Manage Apps");
    expect(refreshed.location).toEqual({ appId: "home", path: "/manage" });
  });

  it("signed-out enter into Manage Apps is a sign-in node", async () => {
    const app = homeApp();
    const ctx = signedOutCtx();
    const catalog = (await app.open("/manage", {}, ctx)) as RefreshResult;
    expect(catalog.node.label).toBe("Manage Apps");

    const result = (await app.refresh(
      [{ nodeId: MANAGE_SIGNED_OUT_ID, label: "Sign in to manage apps.", location: null }],
      {},
      ctx,
    )) as RefreshResult;
    expect(result.node.label).toBe("Sign in to manage apps.");
    expect(result.node.id).toBe(MANAGE_SIGNED_OUT_ID);
    expect(result.navigationMap[MANAGE_SIGNED_OUT_ID]?.enter).toEqual({
      kind: "app",
      to: { appId: "account", path: "/" },
    });
    expect(result.navigationMap[MANAGE_SIGNED_OUT_ID]?.back).toEqual({
      kind: "node",
      stackBehavior: "pop",
    });
  });

  it("signed-in Manage Apps is Add / Remove / Reorder", async () => {
    const result = (await homeApp().open("/manage", {}, signedInCtx())) as RefreshResult;
    expect(result.node.label).toBe("Manage Apps");
    const entered = (await homeApp().open("/manage/add", {}, signedInCtx())) as RefreshResult;
    expect(entered.node.label).toBe("Add Apps");
    expect(entered.warm.map((n) => n.label)).toEqual(["Add Apps", "Remove Apps", "Reorder Apps"]);
    expect(entered.navigationMap[ADD_MENU_ID]?.next?.toNodeId).toBe(REMOVE_MENU_ID);
    expect(entered.navigationMap[REMOVE_MENU_ID]?.next?.toNodeId).toBe(REORDER_MENU_ID);
    expect(entered.navigationMap[REORDER_MENU_ID]?.next).toBeUndefined();
  });

  it("adds Gmail and shows App added to home screen", async () => {
    const app = homeApp();
    const ctx = signedInCtx();
    const addList = (await app.open("/manage/add/gmail", {}, ctx)) as RefreshResult;
    expect(addList.node.label).toBe("Gmail");
    expect(addList.navigationMap[addAppNodeId("gmail")]?.enter).toMatchObject({
      action: true,
      toNodeId: addAddedNodeId("gmail"),
    });

    const added = (await app.refresh(
      [{ nodeId: addAddedNodeId("gmail"), label: "App added to home screen", location: null }],
      { action: true },
      ctx,
    )) as RefreshResult;
    expect(added.node.label).toBe("App added to home screen");
    expect(added.location).toBeNull();

    const home = (await app.open("/", {}, ctx)) as RefreshResult;
    expect(home.warm.map((n) => n.label)).toEqual([
      "Help",
      "Bible",
      "Notes",
      "Account",
      "Gmail",
      "Manage Apps",
    ]);
  });

  it("removes Help and shows App removed from home screen", async () => {
    const app = homeApp();
    const ctx = signedInCtx();
    const list = (await app.open("/manage/remove/help", {}, ctx)) as RefreshResult;
    expect(list.node.label).toBe("Help");
    expect(list.warm.map((n) => n.label).includes("Account")).toBe(false);

    const removed = (await app.refresh(
      [{ nodeId: removeRemovedNodeId("help"), label: "App removed from home screen", location: null }],
      { action: true },
      ctx,
    )) as RefreshResult;
    expect(removed.node.label).toBe("App removed from home screen");

    const home = (await app.open("/", {}, ctx)) as RefreshResult;
    expect(home.warm.map((n) => n.label)).toEqual(["Bible", "Notes", "Account", "Manage Apps"]);
  });

  it("required apps are omitted from Add and Remove but present in Reorder", async () => {
    const app = homeApp();
    const ctx = signedInCtx();
    const add = (await app.open("/manage/add", {}, ctx)) as RefreshResult;
    expect(add.navigationMap[ADD_MENU_ID]?.enter).toMatchObject({
      toNodeId: addAppNodeId("gmail"),
    });
    const remove = (await app.open("/manage/remove", {}, ctx)) as RefreshResult;
    expect(remove.navigationMap[REMOVE_MENU_ID]?.enter).toMatchObject({
      toNodeId: removeAppNodeId("help"),
    });
    const reorder = (await app.open("/manage/reorder", {}, ctx)) as RefreshResult;
    expect(reorder.navigationMap[REORDER_MENU_ID]?.enter).toMatchObject({
      toNodeId: reorderAppNodeId("help"),
    });
    const order = (await app.open("/manage/reorder/account", {}, ctx)) as RefreshResult;
    expect(order.node.label).toBe("Account");
  });

  it("empty add and remove lists speak a node, not a silent no-op", async () => {
    const list: AppDescriptor[] = [
      { id: "home", label: "Home", homeRole: "internal" },
      { id: "account", label: "Account", homeRole: "required" },
    ];
    const app = homeApp();
    const ctx = signedInCtx(list);
    const add = (await app.open("/manage/add", {}, ctx)) as RefreshResult;
    expect(add.navigationMap[ADD_MENU_ID]?.enter).toMatchObject({ toNodeId: "home:manage:add:empty" });
    const emptyAdd = (await app.open("/manage/add/missing", {}, ctx)) as RefreshResult;
    expect(emptyAdd.node.label).toBe("No apps to add.");
    const emptyRemove = (await app.open("/manage/remove/missing", {}, ctx)) as RefreshResult;
    expect(emptyRemove.node.label).toBe("No apps to remove.");
  });

  it("move up swaps order and returns to the app on the reorder list", async () => {
    const app = homeApp();
    const ctx = signedInCtx();
    const bible = (await app.open("/manage/reorder/bible", {}, ctx)) as RefreshResult;
    expect(bible.node.label).toBe("Bible");
    expect(bible.navigationMap[reorderAppNodeId("bible")]?.enter).toMatchObject({
      stackBehavior: "replace",
      toNodeId: reorderMoveUpId("bible"),
    });

    const moveUp = (await app.refresh(
      [{ nodeId: reorderMoveUpId("bible"), label: "Move up", location: null }],
      {},
      ctx,
    )) as RefreshResult;
    expect(moveUp.node.label).toBe("Move up");
    expect(moveUp.navigationMap[reorderMoveUpId("bible")]?.enter).toMatchObject({
      action: true,
      stackBehavior: "replace",
      toNodeId: reorderMovingId("bible", "up"),
    });
    expect(moveUp.navigationMap[reorderMoveUpId("bible")]?.next?.toNodeId).toBe(
      reorderMoveDownId("bible"),
    );

    const moved = (await app.refresh(
      [{ nodeId: reorderMovingId("bible", "up"), label: "Bible", location: null }],
      { action: true },
      ctx,
    )) as RefreshResult;
    expect(moved.node.id).toBe(reorderAppNodeId("bible"));
    expect(moved.node.label).toBe("Bible");
    const helpId = reorderAppNodeId("help");
    expect(moved.navigationMap[moved.node.id]?.prev?.toNodeId).toBeUndefined();
    expect(moved.navigationMap[moved.node.id]?.next?.toNodeId).toBe(helpId);

    const home = (await app.open("/", {}, ctx)) as RefreshResult;
    expect(home.warm.map((n) => n.label)).toEqual([
      "Bible",
      "Help",
      "Notes",
      "Account",
      "Manage Apps",
    ]);
  });

  it("first reorder item has no Move up", async () => {
    const app = homeApp();
    const ctx = signedInCtx();
    const help = (await app.open("/manage/reorder/help", {}, ctx)) as RefreshResult;
    expect(help.navigationMap[reorderAppNodeId("help")]?.enter).toMatchObject({
      toNodeId: reorderMoveDownId("help"),
    });
    const move = (await app.refresh(
      [{ nodeId: reorderMoveDownId("help"), label: "Move down", location: null }],
      {},
      ctx,
    )) as RefreshResult;
    expect(move.node.label).toBe("Move down");
    expect(move.navigationMap[reorderMoveUpId("help")]).toBeUndefined();
  });

  it("store is owner-scoped", async () => {
    const app = homeApp();
    await app.refresh(
      [{ nodeId: addAddedNodeId("gmail"), label: ADDED, location: null }],
      { action: true },
      signedInCtx(),
    );
    const ownerHome = (await app.open("/", {}, signedInCtx(packList(), OWNER))) as RefreshResult;
    expect(ownerHome.warm.map((n) => n.label)).toContain("Gmail");
    const otherHome = (await app.open("/", {}, signedInCtx(packList(), OTHER))) as RefreshResult;
    expect(otherHome.warm.map((n) => n.label)).not.toContain("Gmail");
  });

  it("startHomeApp signed-out does not require a user", async () => {
    const app = startHomeApp({ dbPath: ":memory:" });
    opened.push(app);
    const result = (await app.open("/", {}, signedOutCtx())) as RefreshResult;
    expect(result.node.label).toBe("Help");
  });
});

const ADDED = "App added to home screen";
