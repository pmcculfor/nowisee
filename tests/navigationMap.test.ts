import { describe, expect, it } from "vitest";
import { NavigationMapStore } from "../src/core/navigationMap.ts";
import type { NavigationMap } from "../src/core/types.ts";

describe("NavigationMapStore", () => {
  it("looks up nested (fromNodeId, intent) edges", () => {
    const store = new NavigationMapStore();
    const map: NavigationMap = {
      "book::Genesis": {
        next: {
          kind: "node",
          toNodeId: "book::Exodus",
          stackBehavior: "replace",
        },
        enter: {
          kind: "node",
          toNodeId: "ch::1",
          stackBehavior: "push",
        },
      },
      root: {
        back: {
          kind: "app",
          to: { appId: "home", path: "/" },
        },
      },
    };
    store.replace(map);

    expect(store.lookup("book::Genesis", "next")).toEqual({
      kind: "node",
      toNodeId: "book::Exodus",
      stackBehavior: "replace",
    });
    expect(store.lookup("book::Genesis", "enter")?.kind).toBe("node");
    expect(store.lookup("root", "back")).toEqual({
      kind: "app",
      to: { appId: "home", path: "/" },
    });
  });

  it("missing edge is undefined (silent no-op at Navigator)", () => {
    const store = new NavigationMapStore();
    store.replace({ a: { next: { kind: "node", toNodeId: "b", stackBehavior: "replace" } } });
    expect(store.lookup("a", "prev")).toBeUndefined();
    expect(store.lookup("missing", "next")).toBeUndefined();
  });

  it("replace fully swaps the map", () => {
    const store = new NavigationMapStore();
    store.replace({
      a: { next: { kind: "node", toNodeId: "b", stackBehavior: "replace" } },
    });
    store.replace({
      c: { enter: { kind: "node", toNodeId: "d", stackBehavior: "push" } },
    });
    expect(store.lookup("a", "next")).toBeUndefined();
    expect(store.lookup("c", "enter")?.kind).toBe("node");
  });

  it("allows node ids that contain delimiter-like characters", () => {
    const store = new NavigationMapStore();
    const weirdId = "path::with::colons";
    store.replace({
      [weirdId]: {
        next: { kind: "node", toNodeId: "other", stackBehavior: "replace" },
      },
    });
    expect(store.lookup(weirdId, "next")?.kind).toBe("node");
  });
});
