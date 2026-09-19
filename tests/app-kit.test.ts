import { describe, expect, it } from "vitest";
import {
  buildMap,
  edgeAction,
  edgeApp,
  edgeExternal,
  edgeNode,
  edgePop,
  edgePopTransient,
  edgePushTransient,
  edgeResume,
  edgeStay,
  inputEdges,
  rootBackToHome,
  siblingListEdges,
  signedOut,
  splitText,
} from "../src/app-kit/index.ts";

describe("edge builders", () => {
  it("edgeNode / edgePop / edgeApp / edgeResume / edgeExternal", () => {
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
    expect(edgeResume("bible")).toEqual({ kind: "resume", appId: "bible" });
    expect(edgeExternal("https://example.com")).toEqual({
      kind: "external",
      href: "https://example.com",
    });
    expect(edgeStay({ action: true })).toEqual({
      kind: "node",
      stackBehavior: "stay",
      action: true,
    });
    expect(edgePushTransient("menu", "verse-menu")).toEqual({
      kind: "node",
      toNodeId: "menu",
      stackBehavior: "pushTransient",
      frame: "verse-menu",
    });
    expect(edgePopTransient({ action: true })).toEqual({
      kind: "node",
      stackBehavior: "popTransient",
      action: true,
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

  it("around emits a window; prev/next still address the full list", () => {
    const frag = siblingListEdges(["a", "b", "c", "d", "e"], { around: { index: 2, radius: 1 } });
    expect(Object.keys(frag).sort()).toEqual(["b", "c", "d"]);
    expect(frag.b).toEqual({
      prev: edgeNode("a", "replace"),
      next: edgeNode("c", "replace"),
    });
    expect(frag.d).toEqual({
      prev: edgeNode("c", "replace"),
      next: edgeNode("e", "replace"),
    });
    expect(frag.a).toBeUndefined();
    expect(frag.e).toBeUndefined();
  });

  it("around with an out-of-range index emits nothing", () => {
    expect(siblingListEdges(["a", "b"], { around: { index: 2, radius: 1 } })).toEqual({});
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
  it("authors an app back edge to that app's Home catalog row", () => {
    expect(rootBackToHome("bible-root", "home", "bible")).toEqual({
      "bible-root": {
        back: edgeApp({ appId: "home", path: "/app/bible" }),
      },
    });
  });
});

describe("signedOut", () => {
  it("returns a complete result with enter to Account and back to this app on Home", () => {
    const result = signedOut({
      accountAppId: "account",
      rootAppId: "home",
      appId: "notes",
      text: "Sign in to use Notes.",
    });
    expect(result.node.label).toBe("Sign in to use Notes.");
    expect(result.navigationMap[result.node.id]?.enter).toEqual(
      edgeApp({ appId: "account", path: "/" }),
    );
    expect(result.navigationMap[result.node.id]?.back).toEqual(
      edgeApp({ appId: "home", path: "/app/notes" }),
    );
    expect(result.location).toBeNull();
  });
});

describe("buildMap", () => {
  it("merges fragments into a nested map", () => {
    const map = buildMap(
      siblingListEdges(["a", "b"]),
      rootBackToHome("a", "home", "a"),
      { a: { enter: edgeNode("child", "push") } },
      { a: { enter: edgeNode("other", "push") } }, // overwrite
    );
    expect(map.a?.prev).toBeUndefined();
    expect(map.a?.next).toEqual(edgeNode("b", "replace"));
    expect(map.a?.back).toEqual(edgeApp({ appId: "home", path: "/app/a" }));
    expect(map.a?.enter).toEqual(edgeNode("other", "push"));
    expect(map.b?.prev).toEqual(edgeNode("a", "replace"));
  });
});

describe("splitText", () => {
  it("returns one empty string for blank input", () => {
    expect(splitText("")).toEqual([""]);
    expect(splitText("   \n\n  ")).toEqual([""]);
  });

  it("packs a short heading with the following paragraph", () => {
    expect(
      splitText("The Beatitudes.\n\nBlessed are the poor in spirit: for theirs is the kingdom of heaven."),
    ).toEqual([
      "The Beatitudes.\n\nBlessed are the poor in spirit: for theirs is the kingdom of heaven.",
    ]);
  });

  it("keeps paragraphs that already meet the minimum as separate chunks", () => {
    const first = "A".repeat(200);
    const second = "B".repeat(200);
    expect(splitText(`${first}\n\n${second}`)).toEqual([first, second]);
  });

  it("attaches a trailing short paragraph to the previous chunk", () => {
    const body = "A".repeat(200);
    expect(splitText(`${body}\n\nNext: Matthew Chapter 6`)).toEqual([
      `${body}\n\nNext: Matthew Chapter 6`,
    ]);
  });

  it("keeps a short heading on the first chunk of a long following paragraph", () => {
    const heading = "IDENTITY OF THESE PRINCIPLES WITH THOSE OF THE ANCIENT ECONOMY.";
    const body = "Word ".repeat(400).trim();
    const chunks = splitText(`${heading}\n\n${body}`, 80);
    expect(chunks[0]).toMatch(/^IDENTITY OF THESE PRINCIPLES/);
    expect(chunks[0]!.length).toBeGreaterThan(heading.length);
    expect(chunks.every((c) => c.length <= 80)).toBe(true);
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
