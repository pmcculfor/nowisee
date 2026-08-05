import { describe, expect, it } from "vitest";
import { AppRegistry } from "../src/core/registry.ts";
import type { AppModule, RefreshResult } from "../src/core/types.ts";

function emptyResult(id: string): RefreshResult {
  return {
    navigationMap: {},
    warm: [],
    node: { id, label: id },
  };
}

function fakeApp(id: string, label: string): AppModule {
  return {
    id,
    label,
    open: () => emptyResult(`${id}-root`),
    refresh: () => emptyResult(`${id}-tip`),
  };
}

describe("AppRegistry", () => {
  it("registers and gets by id", () => {
    const registry = new AppRegistry();
    const app = fakeApp("alpha", "Alpha");
    registry.register(app);
    expect(registry.get("alpha")).toBe(app);
    expect(registry.get("missing")).toBeNull();
  });

  it("rejects double-register of the same id", () => {
    const registry = new AppRegistry();
    registry.register(fakeApp("alpha", "Alpha"));
    expect(() => registry.register(fakeApp("alpha", "Alpha 2"))).toThrow(
      /duplicate app id "alpha"/,
    );
  });

  it("listEnabled returns plain descriptors, not modules", () => {
    const registry = new AppRegistry();
    registry.register(fakeApp("a", "A"));
    registry.register(fakeApp("b", "B"));
    const list = registry.listEnabled();
    expect(list).toEqual([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);
    expect(list[0]).not.toHaveProperty("open");
    expect(list[0]).not.toHaveProperty("refresh");
  });
});
