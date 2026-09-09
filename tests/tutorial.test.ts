import { describe, expect, it } from "vitest";
import { createTutorialApp, NODE, TUTORIAL_APP_LABEL } from "../src/apps/tutorial/index.ts";
import type { RefreshResult } from "../src/core/types.ts";

const ROOT = "home";

function tutorial() {
  return createTutorialApp({ rootAppId: ROOT });
}

describe("Tutorial app", () => {
  it("catalog label names Tutorial and tells the user how to enter", () => {
    expect(tutorial().id).toBe("tutorial");
    expect(tutorial().label).toBe(TUTORIAL_APP_LABEL);
    expect(TUTORIAL_APP_LABEL).toMatch(/^Tutorial app\./);
    expect(TUTORIAL_APP_LABEL).toMatch(/right/i);
  });

  it("open starts on welcome; enter goes to tree then back practice; back goes to Home", () => {
    const result = tutorial().open("/") as RefreshResult;
    expect(result.node.id).toBe(NODE.welcome);
    expect(result.node.label).toContain("Welcome to Now I See");
    expect(result.navigationMap[NODE.welcome]?.back).toEqual({
      kind: "app",
      to: { appId: ROOT, path: "/app/tutorial" },
    });
    expect(result.navigationMap[NODE.welcome]?.enter).toEqual({
      kind: "node",
      toNodeId: NODE.tree,
      stackBehavior: "push",
    });
    expect(result.navigationMap[NODE.tree]?.enter).toEqual({
      kind: "node",
      toNodeId: NODE.backPractice,
      stackBehavior: "push",
    });
    expect(result.navigationMap[NODE.tree]?.back).toEqual({
      kind: "node",
      stackBehavior: "pop",
    });
    expect(result.navigationMap[NODE.backPractice]?.enter).toEqual({
      kind: "node",
      toNodeId: NODE.item1,
      stackBehavior: "push",
    });
    expect(result.navigationMap[NODE.backPractice]?.back).toEqual({
      kind: "node",
      stackBehavior: "pop",
    });
  });

  it("unknown paths including the retired recents path repair to welcome", () => {
    const result = tutorial().open("/recents") as RefreshResult;
    expect(result.node.id).toBe(NODE.welcome);
    expect(result.location).toEqual({ appId: "tutorial", path: "/" });
  });

  it("tree node teaches the left-to-right tree and device gestures", () => {
    const result = tutorial().open("/tree") as RefreshResult;
    expect(result.node.id).toBe(NODE.tree);
    expect(result.node.label).toContain("left-to-right tree");
    expect(result.location).toEqual({ appId: "tutorial", path: "/tree" });
  });

  it("four list items wrap; only the fourth enters typing practice", () => {
    const result = tutorial().open("/practice/1") as RefreshResult;
    expect(result.node.id).toBe(NODE.item1);
    expect(result.node.label).toContain("Navigate down to explore the list");
    expect(result.navigationMap[NODE.item1]?.next).toEqual({
      kind: "node",
      toNodeId: NODE.item2,
      stackBehavior: "replace",
    });
    expect(result.navigationMap[NODE.item4]?.next).toEqual({
      kind: "node",
      toNodeId: NODE.item1,
      stackBehavior: "replace",
    });
    expect(result.navigationMap[NODE.item1]?.prev).toEqual({
      kind: "node",
      toNodeId: NODE.item4,
      stackBehavior: "replace",
    });
    expect(result.navigationMap[NODE.item1]?.enter).toBeUndefined();
    expect(result.navigationMap[NODE.item2]?.enter).toBeUndefined();
    expect(result.navigationMap[NODE.item3]?.enter).toBeUndefined();
    expect(result.navigationMap[NODE.item4]?.enter).toEqual({
      kind: "node",
      toNodeId: NODE.typePrompt,
      stackBehavior: "push",
    });
  });

  it("input node commits to a done screen that leaves to Home and backs to the input", () => {
    const opened = tutorial().open("/type/input") as RefreshResult;
    expect(opened.node.kind).toBe("input");
    expect(opened.navigationMap[NODE.input]?.enter).toMatchObject({
      kind: "node",
      toNodeId: NODE.done,
      stackBehavior: "push",
      passInputText: true,
    });
    expect(opened.navigationMap[NODE.done]?.enter).toEqual({
      kind: "app",
      to: { appId: ROOT, path: "/app/tutorial" },
    });
    expect(opened.navigationMap[NODE.done]?.back).toEqual({
      kind: "node",
      stackBehavior: "pop",
    });

    const prompt = tutorial().open("/type") as RefreshResult;
    expect(prompt.node.label).toMatch(/Cancel or Done/);
    expect(prompt.node.label).not.toMatch(/Recent apps/i);

    const typed = tutorial().refresh(
      [{ nodeId: NODE.done, label: "", location: null }],
      { inputText: "hello" },
    ) as RefreshResult;
    expect(typed.node.label).toContain('You typed "hello".');
    expect(typed.node.label).toContain("home screen");
    expect(typed.node.label).toMatch(/"r" key/);
    expect(typed.node.label).toMatch(/Recent Apps button/);
  });
});
