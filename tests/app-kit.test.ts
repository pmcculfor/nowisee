import { describe, expect, it } from "vitest";
import {
  buildMap,
  collectNeighborhood,
  edgeAction,
  edgeApp,
  edgeExternal,
  edgeNode,
  edgePop,
  inputEdges,
  rootBackToHome,
  siblingListEdges,
  signedOut,
  splitText,
} from "../src/app-kit/index.ts";
import type { NavEdge, NodePayload } from "../src/core/types.ts";

describe("edge builders", () => {
  it("edgeNode / edgePop / edgeApp / edgeExternal", () => {
    expect(edgeNode("b", "replace")).toEqual({
      kind: "node",
      toNodeId: "b",
      stackBehavior: "replace",
    });
    expect(edgePop()).toEqual({ kind: "node", stackBehavior: "pop" });
    expect(edgePop()).not.toHaveProperty("toNodeId");
    expect(edgeApp({ appId: "home", path: "/" })).toEqual({
      kind: "app",
      to: { appId: "home", path: "/" },
    });
    expect(edgeExternal("https://example.com")).toEqual({
      kind: "external",
      href: "https://example.com",
    });
  });

  it("edgeAction marks action: true and defaults to push", () => {
    expect(edgeAction("status")).toEqual({
      kind: "node",
      toNodeId: "status",
      stackBehavior: "push",
      action: true,
    });
    expect(edgeAction("status", { passInputText: true, stackBehavior: "replace" })).toEqual({
      kind: "node",
      toNodeId: "status",
      stackBehavior: "replace",
      passInputText: true,
      action: true,
    });
  });
});

describe("siblingListEdges", () => {
  it("builds prev/next replace edges without wrap by default", () => {
    const frag = siblingListEdges(["a", "b", "c"]);
    expect(frag.a).toEqual({
      next: edgeNode("b", "replace"),
    });
    expect(frag.b).toEqual({
      prev: edgeNode("a", "replace"),
      next: edgeNode("c", "replace"),
    });
    expect(frag.c).toEqual({
      prev: edgeNode("b", "replace"),
    });
  });

  it("wraps ends when wrap: true", () => {
    const frag = siblingListEdges(["a", "b", "c"], { wrap: true });
    expect(frag.a?.prev).toEqual(edgeNode("c", "replace"));
    expect(frag.c?.next).toEqual(edgeNode("a", "replace"));
  });

  it("single-item list has no prev/next even with wrap", () => {
    expect(siblingListEdges(["only"], { wrap: true })).toEqual({ only: {} });
  });
});

describe("inputEdges", () => {
  it("commit with passInputText; back replace or pop", () => {
    const withReplace = inputEdges("field", {
      commitTo: "done",
      backTo: "hint",
    });
    expect(withReplace.field?.enter).toEqual(
      edgeNode("done", "push", { passInputText: true }),
    );
    expect(withReplace.field?.back).toEqual(edgeNode("hint", "replace"));

    const withPop = inputEdges("field", {
      commitTo: "sent",
      backTo: "pop",
      action: true,
    });
    expect(withPop.field?.enter).toEqual(
      edgeAction("sent", { passInputText: true }),
    );
    expect(withPop.field?.back).toEqual(edgePop());
  });
});

describe("rootBackToHome", () => {
  it("authors an app back edge to the root app", () => {
    expect(rootBackToHome("bible-root", "home")).toEqual({
      "bible-root": {
        back: edgeApp({ appId: "home", path: "/" }),
      },
    });
  });
});

describe("signedOut", () => {
  it("returns a complete result with enter to Account and back to Home", () => {
    const result = signedOut({
      accountAppId: "account",
      rootAppId: "home",
      text: "Sign in to use Notes.",
    });
    expect(result.node.label).toBe("Sign in to use Notes.");
    expect(result.navigationMap[result.node.id]?.enter).toEqual(
      edgeApp({ appId: "account", path: "/" }),
    );
    expect(result.navigationMap[result.node.id]?.back).toEqual(
      edgeApp({ appId: "home", path: "/" }),
    );
    expect(result.location).toBeNull();
  });
});

describe("buildMap", () => {
  it("merges fragments into a nested map", () => {
    const map = buildMap(
      siblingListEdges(["a", "b"]),
      rootBackToHome("a", "home"),
      { a: { enter: edgeNode("child", "push") } },
      { a: { enter: edgeNode("other", "push") } }, // overwrite
    );
    expect(map.a?.prev).toBeUndefined();
    expect(map.a?.next).toEqual(edgeNode("b", "replace"));
    expect(map.a?.back).toEqual(edgeApp({ appId: "home", path: "/" }));
    expect(map.a?.enter).toEqual(edgeNode("other", "push"));
    expect(map.b?.prev).toEqual(edgeNode("a", "replace"));
  });
});

describe("collectNeighborhood", () => {
  it("walks via callbacks into warm + map, respecting depth and maxNodes", () => {
    const payloads: Record<string, NodePayload> = {
      root: { id: "root", label: "Root" },
      a: { id: "a", label: "A" },
      b: { id: "b", label: "B" },
      deep: { id: "deep", label: "Deep" },
    };

    const graph: Record<string, Array<{ intent: "enter" | "next"; edge: NavEdge }>> = {
      root: [
        { intent: "next", edge: edgeNode("a", "replace") },
        { intent: "enter", edge: edgeNode("deep", "push") },
      ],
      a: [{ intent: "next", edge: edgeNode("b", "replace") }],
      b: [],
      deep: [],
    };

    const { warm, navigationMap } = collectNeighborhood({
      tipId: "root",
      depth: 1,
      maxNodes: 10,
      payload: (id) => payloads[id],
      neighbors: (id) => graph[id] ?? [],
    });

    expect(warm.map((n) => n.id).sort()).toEqual(["a", "deep", "root"].sort());
    expect(navigationMap.root?.next).toEqual(edgeNode("a", "replace"));
    expect(navigationMap.root?.enter).toEqual(edgeNode("deep", "push"));
    // depth 1 does not expand a → b into warm from walking b's payload via queue
    // but a is visited at depth 1; b would be depth 2 and not queued for visit from a's expansion...
    // Actually: root depth 0, enqueue a and deep at depth 1. Visit a at depth 1: add edges, depth >= 1 so don't enqueue b.
    expect(warm.find((n) => n.id === "b")).toBeUndefined();
    expect(navigationMap.a?.next).toEqual(edgeNode("b", "replace"));
  });

  it("caps warm at maxNodes", () => {
    const ids = ["n0", "n1", "n2", "n3"];
    const { warm } = collectNeighborhood({
      tipId: "n0",
      depth: 5,
      maxNodes: 2,
      payload: (id) => ({ id, label: id }),
      neighbors: (id) => {
        const i = ids.indexOf(id);
        if (i < 0 || i >= ids.length - 1) {
          return [];
        }
        return [{ intent: "next", edge: edgeNode(ids[i + 1]!, "replace") }];
      },
    });
    expect(warm.length).toBe(2);
  });
});

describe("splitText", () => {
  it("returns one empty string for blank input", () => {
    expect(splitText("")).toEqual([""]);
    expect(splitText("   \n\n  ")).toEqual([""]);
  });

  it("splits on blank lines", () => {
    expect(splitText("One.\n\nTwo.\n\nThree.")).toEqual(["One.", "Two.", "Three."]);
  });

  it("hard-caps a giant paragraph", () => {
    const word = "word ";
    const text = word.repeat(400).trim();
    const chunks = splitText(text, 80);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 80)).toBe(true);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " "));
  });
});
