import { describe, expect, it } from "vitest";
import { createHelpApp, HELP_APP_LABEL, NODE } from "../src/apps/help/index.ts";
import type { RefreshResult } from "../src/core/types.ts";

const ROOT = "home";

function help() {
  return createHelpApp({ rootAppId: ROOT });
}

describe("Help app", () => {
  it("catalog label tells the user how to enter", () => {
    expect(help().label).toBe(HELP_APP_LABEL);
    expect(HELP_APP_LABEL).toMatch(/right/i);
  });

  it("open starts on welcome; enter goes to back practice; back goes to Home", () => {
    const result = help().open("/") as RefreshResult;
    expect(result.node.id).toBe(NODE.welcome);
    expect(result.node.label).toContain("Welcome to Now I See");
    expect(result.navigationMap[NODE.welcome]?.back).toEqual({
      kind: "app",
      to: { appId: ROOT, path: "/app/help" },
    });
    expect(result.navigationMap[NODE.welcome]?.enter).toEqual({
      kind: "node",
      toNodeId: NODE.backPractice,
      stackBehavior: "push",
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

  it("four list items wrap; only the fourth enters typing practice", () => {
    const result = help().open("/practice/1") as RefreshResult;
    expect(result.node.id).toBe(NODE.item1);
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

  it("input node commits to a done screen that leaves to Home", () => {
    const opened = help().open("/type/input") as RefreshResult;
    expect(opened.node.kind).toBe("input");
    expect(opened.navigationMap[NODE.input]?.enter).toMatchObject({
      kind: "node",
      toNodeId: NODE.done,
      stackBehavior: "push",
      passInputText: true,
    });
    expect(opened.navigationMap[NODE.done]?.enter).toEqual({
      kind: "app",
      to: { appId: ROOT, path: "/app/help" },
    });

    const typed = help().refresh(
      [{ nodeId: NODE.done, label: "", location: null }],
      { inputText: "hello" },
    ) as RefreshResult;
    expect(typed.node.label).toContain('You typed "hello".');
    expect(typed.node.label).toContain("home screen");
  });
});
