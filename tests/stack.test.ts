import { describe, expect, it } from "vitest";
import { Stack } from "../src/core/stack.ts";
import type { StackEntry } from "../src/core/types.ts";

function entry(nodeId: string, label = nodeId): StackEntry {
  return { nodeId, label, location: null };
}

describe("Stack", () => {
  it("push and tip", () => {
    const stack = new Stack();
    stack.push(entry("a"));
    stack.push(entry("b"));
    expect(stack.tip()?.nodeId).toBe("b");
    expect(stack.length).toBe(2);
  });

  it("replaceTip swaps the last entry", () => {
    const stack = new Stack();
    stack.push(entry("a"));
    stack.push(entry("b"));
    stack.replaceTip(entry("c", "C"));
    expect(stack.snapshot().map((e) => e.nodeId)).toEqual(["a", "c"]);
    expect(stack.tip()?.label).toBe("C");
  });

  it("replaceTip on empty stack throws", () => {
    const stack = new Stack();
    expect(() => stack.replaceTip(entry("solo"))).toThrow(/empty/);
  });

  it("pop returns tip and shortens", () => {
    const stack = new Stack();
    stack.push(entry("a"));
    stack.push(entry("b"));
    expect(stack.pop()?.nodeId).toBe("b");
    expect(stack.tip()?.nodeId).toBe("a");
  });

  it("pop on empty returns null", () => {
    const stack = new Stack();
    expect(stack.pop()).toBeNull();
  });

  it("clear empties the stack", () => {
    const stack = new Stack();
    stack.push(entry("a"));
    stack.clear();
    expect(stack.length).toBe(0);
    expect(stack.tip()).toBeNull();
  });

  it("snapshot is a copy", () => {
    const stack = new Stack();
    stack.push(entry("a"));
    const snap = stack.snapshot();
    stack.push(entry("b"));
    expect(snap).toHaveLength(1);
    expect(stack.snapshot()).toHaveLength(2);
  });
});
