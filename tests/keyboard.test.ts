/** @vitest-environment happy-dom */

import { describe, expect, it, vi } from "vitest";
import {
  Keyboard,
  defaultKeyBindings,
  resolveIntent,
  type KeyEventLike,
  type KeyboardHost,
} from "../src/core/keyboard.ts";
import type { KeyBinding, NavIntent, NodeKind } from "../src/core/types.ts";

function key(
  name: string,
  mods: Partial<Pick<KeyEventLike, "ctrlKey" | "altKey" | "shiftKey" | "metaKey">> = {},
): KeyEventLike {
  return {
    key: name,
    ctrlKey: mods.ctrlKey ?? false,
    altKey: mods.altKey ?? false,
    shiftKey: mods.shiftKey ?? false,
    metaKey: mods.metaKey ?? false,
  };
}

describe("resolveIntent / defaultKeyBindings", () => {
  const bindings = defaultKeyBindings();

  it("maps text-tip arrows to prev/next/enter/back", () => {
    expect(resolveIntent(key("ArrowUp"), "text", bindings)).toBe("prev");
    expect(resolveIntent(key("ArrowDown"), "text", bindings)).toBe("next");
    expect(resolveIntent(key("ArrowRight"), "text", bindings)).toBe("enter");
    expect(resolveIntent(key("ArrowLeft"), "text", bindings)).toBe("back");
  });

  it("leaves plain arrows unbound on input tips", () => {
    expect(resolveIntent(key("ArrowUp"), "input", bindings)).toBeUndefined();
    expect(resolveIntent(key("ArrowDown"), "input", bindings)).toBeUndefined();
    expect(resolveIntent(key("ArrowLeft"), "input", bindings)).toBeUndefined();
    expect(resolveIntent(key("ArrowRight"), "input", bindings)).toBeUndefined();
  });

  it("binds Enter and Alt+ArrowUp on input tips", () => {
    expect(resolveIntent(key("Enter"), "input", bindings)).toBe("enter");
    expect(resolveIntent(key("ArrowUp", { altKey: true }), "input", bindings)).toBe("back");
  });

  it("does not bind Escape or Tab", () => {
    expect(resolveIntent(key("Escape"), "text", bindings)).toBeUndefined();
    expect(resolveIntent(key("Escape"), "input", bindings)).toBeUndefined();
    expect(resolveIntent(key("Tab"), "text", bindings)).toBeUndefined();
    expect(resolveIntent(key("Tab", { shiftKey: true }), "text", bindings)).toBeUndefined();
  });

  it("does not match when unexpected modifiers are held", () => {
    expect(resolveIntent(key("ArrowDown", { ctrlKey: true }), "text", bindings)).toBeUndefined();
    expect(resolveIntent(key("Enter", { altKey: true }), "input", bindings)).toBeUndefined();
  });

  it("rebinding the table changes behavior with zero app changes", () => {
    const custom: KeyBinding[] = [
      { intent: "next", key: "j", whenTip: "text" },
      { intent: "prev", key: "k", whenTip: "text" },
    ];
    expect(resolveIntent(key("j"), "text", custom)).toBe("next");
    expect(resolveIntent(key("ArrowDown"), "text", custom)).toBeUndefined();
  });
});

describe("Keyboard listener", () => {
  it("preventDefault and onIntent on match; ignores when blocked", () => {
    const intents: NavIntent[] = [];
    let blocked = false;
    let tipKind: NodeKind = "text";
    const host: KeyboardHost = {
      getTipKind: () => tipKind,
      isBlocked: () => blocked,
      onIntent: (intent) => {
        intents.push(intent);
      },
    };

    const target = window;
    const keyboard = new Keyboard({ target, host });
    keyboard.attach();

    const matched = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true });
    const prevent = vi.spyOn(matched, "preventDefault");
    target.dispatchEvent(matched);
    expect(intents).toEqual(["next"]);
    expect(prevent).toHaveBeenCalled();

    blocked = true;
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(intents).toEqual(["next"]);

    blocked = false;
    tipKind = "input";
    const unbound = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true });
    const preventUnbound = vi.spyOn(unbound, "preventDefault");
    target.dispatchEvent(unbound);
    expect(preventUnbound).not.toHaveBeenCalled();
    expect(intents).toEqual(["next"]);

    keyboard.detach();
  });
});
