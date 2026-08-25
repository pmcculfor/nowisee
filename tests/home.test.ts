import { describe, expect, it } from "vitest";
import { createHomeApp } from "../src/apps/home.ts";
import type { AppDescriptor, AppServerContext, RefreshResult } from "../src/core/types.ts";

function directoryCtx(list: AppDescriptor[]): AppServerContext {
  return {
    userId: null,
    sessionId: "test",
    accountAppId: "account",
    directory: { list: () => list },
  };
}

describe("Home app", () => {
  it("open lists peer apps with wrap and app enter edges; no back", () => {
    const home = createHomeApp({ rootAppId: "home" });
    const ctx = directoryCtx([
      { id: "home", label: "Home" },
      { id: "bible", label: "Bible" },
      { id: "mail", label: "Mail" },
    ]);

    const result = home.open("/", {}, ctx) as RefreshResult;
    expect(result.node.label).toBe("Bible");
    expect(result.warm.map((n) => n.label)).toEqual(["Bible", "Mail"]);

    const bibleId = result.node.id;
    const mail = result.warm.find((n) => n.label === "Mail")!;

    expect(result.navigationMap[bibleId]?.next).toEqual({
      kind: "node",
      toNodeId: mail.id,
      stackBehavior: "replace",
    });
    expect(result.navigationMap[mail.id]?.next).toEqual({
      kind: "node",
      toNodeId: bibleId,
      stackBehavior: "replace",
    });

    expect(result.navigationMap[bibleId]?.enter).toEqual({
      kind: "app",
      to: { appId: "bible", path: "/" },
    });
    expect(result.navigationMap[mail.id]?.enter).toEqual({
      kind: "app",
      to: { appId: "mail", path: "/" },
    });

    expect(result.navigationMap[bibleId]?.back).toBeUndefined();
    expect(result.navigationMap[mail.id]?.back).toBeUndefined();
  });

  it("open /app/:id lands on that catalog row", () => {
    const home = createHomeApp({ rootAppId: "home" });
    const ctx = directoryCtx([
      { id: "home", label: "Home" },
      { id: "help", label: "Help" },
      { id: "bible", label: "Bible" },
    ]);
    const result = home.open("/app/bible", {}, ctx) as RefreshResult;
    expect(result.node.label).toBe("Bible");
    expect(result.location).toEqual({ appId: "home", path: "/app/bible" });
  });

  it("does not embed foreign app node ids — only home:* ids and app locations", () => {
    const home = createHomeApp({ rootAppId: "home" });
    const result = home.open(
      "/",
      {},
      directoryCtx([
        { id: "home", label: "Home" },
        { id: "bible", label: "Bible" },
      ]),
    ) as RefreshResult;
    for (const id of Object.keys(result.navigationMap)) {
      expect(id.startsWith("home:")).toBe(true);
    }
    for (const node of result.warm) {
      expect(node.id.startsWith("home:")).toBe(true);
    }
  });

  it("reads descriptors from ctx.directory, not a registry handle", () => {
    const calls: AppDescriptor[][] = [];
    const home = createHomeApp({ rootAppId: "home" });
    const ctx = directoryCtx([]);
    const list = [
      { id: "home", label: "Home" },
      { id: "bible", label: "Bible" },
    ];
    const withList: AppServerContext = {
      ...ctx,
      directory: {
        list() {
          calls.push(list);
          return list;
        },
      },
    };
    home.open("/", {}, withList);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toEqual({ id: "home", label: "Home" });
    expect(calls[0]![0]).not.toHaveProperty("open");
    expect(home).not.toHaveProperty("registry");
  });

  it("refresh keeps tip when still present; repairs when catalog changes", () => {
    let list: AppDescriptor[] = [
      { id: "home", label: "Home" },
      { id: "bible", label: "Bible" },
      { id: "mail", label: "Mail" },
    ];
    const home = createHomeApp({ rootAppId: "home" });
    const ctx = (): AppServerContext => directoryCtx(list);

    const opened = home.open("/", {}, ctx()) as RefreshResult;
    const mail = opened.warm.find((n) => n.label === "Mail")!;
    const refreshed = home.refresh(
      [{ nodeId: mail.id, label: mail.label, location: null }],
      {},
      ctx(),
    ) as RefreshResult;
    expect(refreshed.node.id).toBe(mail.id);

    list = [
      { id: "home", label: "Home" },
      { id: "bible", label: "Bible" },
    ];
    const repaired = home.refresh(
      [{ nodeId: mail.id, label: mail.label, location: null }],
      {},
      ctx(),
    ) as RefreshResult;
    expect(repaired.node.label).toBe("Bible");
  });

  it("empty peer list shows Home root; still no back", () => {
    const home = createHomeApp({ rootAppId: "home" });
    const result = home.open(
      "/",
      {},
      directoryCtx([{ id: "home", label: "Home" }]),
    ) as RefreshResult;
    expect(result.node.label).toBe("Home");
    expect(result.navigationMap[result.node.id]?.enter).toBeUndefined();
    expect(result.navigationMap[result.node.id]?.back).toBeUndefined();
    expect(result.warm.map((n) => n.label)).toEqual(["Home"]);
  });

  it("missing directory capability shows Home root", () => {
    const home = createHomeApp({ rootAppId: "home" });
    const result = home.open("/") as RefreshResult;
    expect(result.node.label).toBe("Home");
  });

  it("RefreshResult survives structuredClone", () => {
    const home = createHomeApp({ rootAppId: "home" });
    const result = home.open(
      "/",
      {},
      directoryCtx([
        { id: "home", label: "Home" },
        { id: "bible", label: "Bible" },
      ]),
    ) as RefreshResult;
    expect(structuredClone(result)).toEqual(result);
  });
});
