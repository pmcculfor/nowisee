import { describe, expect, it } from "vitest";
import { NodeCache } from "../src/core/nodeCache.ts";
import type { NodePayload } from "../src/core/types.ts";

function node(id: string, label = id): NodePayload {
  return { id, label };
}

describe("NodeCache", () => {
  it("stores and retrieves by nodeId", () => {
    const cache = new NodeCache();
    cache.replaceWarm([node("a"), node("b")], node("a"), ["a"]);
    expect(cache.get("a")?.label).toBe("a");
    expect(cache.get("b")?.label).toBe("b");
    expect(cache.get("missing")).toBeUndefined();
  });

  it("pins stack payloads omitted from a later warm replace", () => {
    const cache = new NodeCache();
    cache.replaceWarm([node("root", "Root"), node("child", "Child")], node("child"), [
      "root",
      "child",
    ]);

    // Next refresh omits ancestor "root" from warm — pin must keep it.
    cache.replaceWarm([node("child", "Child v2"), node("sib", "Sib")], node("child", "Child v2"), [
      "root",
      "child",
    ]);

    expect(cache.get("root")?.label).toBe("Root");
    expect(cache.get("child")?.label).toBe("Child v2");
    expect(cache.get("sib")?.label).toBe("Sib");
  });

  it("duplicate ids in warm: last write wins", () => {
    const cache = new NodeCache();
    cache.replaceWarm(
      [node("a", "first"), node("a", "second")],
      node("tip"),
      ["tip"],
    );
    expect(cache.get("a")?.label).toBe("second");
  });

  it("clear empties all entries", () => {
    const cache = new NodeCache();
    cache.replaceWarm([node("a")], node("a"), ["a"]);
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it("evicts non-pinned entries when over max size", () => {
    const cache = new NodeCache(3);
    cache.replaceWarm(
      [node("p1"), node("warm1"), node("warm2"), node("warm3")],
      node("p1"),
      ["p1"],
    );
    expect(cache.get("p1")).toBeDefined();
    expect(cache.size()).toBeLessThanOrEqual(3);
  });
});
