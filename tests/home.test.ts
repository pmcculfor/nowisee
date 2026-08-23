import { describe, expect, it } from "vitest";
import { createHomeApp } from "../src/apps/home.ts";
import type { AppDescriptor, RefreshResult } from "../src/core/types.ts";

function descriptors(list: AppDescriptor[]): () => AppDescriptor[] {
  return () => list;
}

describe("Home app", () => {
  it("open lists peer apps with wrap and app enter edges; no back", () => {
    const home = createHomeApp({
      rootAppId: "home",
      listEnabled: descriptors([
        { id: "home", label: "Home" },
        { id: "bible", label: "Bible" },
        { id: "mail", label: "Mail" },
      ]),
    });

    const result = home.open("/") as RefreshResult;
    expect(result.node.label).toBe("Bible");
    expect(result.warm.map((n) => n.label)).toEqual(["Bible", "Mail"]);

    const bibleId = result.node.id;
    const mail = result.warm.find((n) => n.label === "Mail")!;

    expect(result.navigationMap[bibleId]?.next).toEqual({
      kind: "node",
      toNodeId: mail.id,
      stackBehavior: "replace",
    });
    // wrap: last → first
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

    // Already home — no back edges
    expect(result.navigationMap[bibleId]?.back).toBeUndefined();
    expect(result.navigationMap[mail.id]?.back).toBeUndefined();
  });

  it("does not embed foreign app node ids — only home:* ids and app locations", () => {
    const home = createHomeApp({
      rootAppId: "home",
      listEnabled: descriptors([
        { id: "home", label: "Home" },
        { id: "bible", label: "Bible" },
      ]),
    });
    const result = home.open("/") as RefreshResult;
    for (const id of Object.keys(result.navigationMap)) {
      expect(id.startsWith("home:")).toBe(true);
    }
    for (const node of result.warm) {
      expect(node.id.startsWith("home:")).toBe(true);
    }
  });

  it("receives descriptors only — factory closes over listEnabled, not a registry", () => {
    const calls: AppDescriptor[][] = [];
    const home = createHomeApp({
      rootAppId: "home",
      listEnabled: () => {
        const list = [
          { id: "home", label: "Home" },
          { id: "bible", label: "Bible" },
        ];
        calls.push(list);
        return list;
      },
    });
    home.open("/");
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toEqual({ id: "home", label: "Home" });
    expect(calls[0]![0]).not.toHaveProperty("open");
  });

  it("refresh keeps tip when still present; repairs when catalog changes", () => {
    let list: AppDescriptor[] = [
      { id: "home", label: "Home" },
      { id: "bible", label: "Bible" },
      { id: "mail", label: "Mail" },
    ];
    const home = createHomeApp({
      rootAppId: "home",
      listEnabled: () => list,
    });

    const opened = home.open("/") as RefreshResult;
    const mail = opened.warm.find((n) => n.label === "Mail")!;
    const refreshed = home.refresh([
      { nodeId: mail.id, label: mail.label, location: null },
    ]) as RefreshResult;
    expect(refreshed.node.id).toBe(mail.id);

    list = [
      { id: "home", label: "Home" },
      { id: "bible", label: "Bible" },
    ];
    const repaired = home.refresh([
      { nodeId: mail.id, label: mail.label, location: null },
    ]) as RefreshResult;
    expect(repaired.node.label).toBe("Bible");
  });

  it("empty peer list shows Home root; still no back", () => {
    const home = createHomeApp({
      rootAppId: "home",
      listEnabled: descriptors([{ id: "home", label: "Home" }]),
    });
    const result = home.open("/") as RefreshResult;
    expect(result.node.label).toBe("Home");
    expect(result.navigationMap[result.node.id]?.enter).toBeUndefined();
    expect(result.navigationMap[result.node.id]?.back).toBeUndefined();
    expect(result.warm.map((n) => n.label)).toEqual(["Home"]);
  });

  it("RefreshResult survives structuredClone", () => {
    const home = createHomeApp({
      rootAppId: "home",
      listEnabled: descriptors([
        { id: "home", label: "Home" },
        { id: "bible", label: "Bible" },
      ]),
    });
    const result = home.open("/") as RefreshResult;
    expect(structuredClone(result)).toEqual(result);
  });
});
