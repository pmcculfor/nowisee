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

const chord = { ctrlKey: true, altKey: true, shiftKey: true };

describe("resolveIntent / defaultKeyBindings", () => {
  const bindings = defaultKeyBindings();

  it("maps Ctrl+Alt+Shift+arrows to prev/next/enter/back on text tips", () => {
    expect(resolveIntent(key("ArrowUp", chord), "text", bindings)).toBe("prev");
    expect(resolveIntent(key("ArrowDown", chord), "text", bindings)).toBe("next");
    expect(resolveIntent(key("ArrowRight", chord), "text", bindings)).toBe("enter");
    expect(resolveIntent(key("ArrowLeft", chord), "text", bindings)).toBe("back");
  });

  it("uses the same chord on input tips", () => {
    expect(resolveIntent(key("ArrowUp", chord), "input", bindings)).toBe("prev");
    expect(resolveIntent(key("ArrowDown", chord), "input", bindings)).toBe("next");
    expect(resolveIntent(key("ArrowRight", chord), "input", bindings)).toBe("enter");
    expect(resolveIntent(key("ArrowLeft", chord), "input", bindings)).toBe("back");
  });

  it("leaves plain arrows unbound so the caret keeps them on input tips", () => {
    expect(resolveIntent(key("ArrowUp"), "text", bindings)).toBeUndefined();
    expect(resolveIntent(key("ArrowDown"), "input", bindings)).toBeUndefined();
    expect(resolveIntent(key("ArrowLeft"), "input", bindings)).toBeUndefined();
    expect(resolveIntent(key("ArrowRight"), "input", bindings)).toBeUndefined();
  });

  it("does not bind Escape, Tab, or Enter alone", () => {
    expect(resolveIntent(key("Escape"), "text", bindings)).toBeUndefined();
    expect(resolveIntent(key("Escape"), "input", bindings)).toBeUndefined();
    expect(resolveIntent(key("Tab"), "text", bindings)).toBeUndefined();
    expect(resolveIntent(key("Tab", { shiftKey: true }), "text", bindings)).toBeUndefined();
    expect(resolveIntent(key("Enter"), "input", bindings)).toBeUndefined();
  });

  it("does not match when the full chord is incomplete", () => {
    expect(resolveIntent(key("ArrowDown", { ctrlKey: true }), "text", bindings)).toBeUndefined();
    expect(
      resolveIntent(key("ArrowDown", { ctrlKey: true, altKey: true }), "text", bindings),
    ).toBeUndefined();
    expect(
      resolveIntent(key("ArrowUp", { altKey: true }), "input", bindings),
    ).toBeUndefined();
  });

  it("rebinding the table changes behavior with zero app changes", () => {
    const custom: KeyBinding[] = [
      { intent: "next", key: "j", whenTip: "text" },
      { intent: "prev", key: "k", whenTip: "text" },
    ];
    expect(resolveIntent(key("j"), "text", custom)).toBe("next");
    expect(resolveIntent(key("ArrowDown", chord), "text", custom)).toBeUndefined();
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

    const matched = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      ctrlKey: true,
      altKey: true,
      shiftKey: true,
      bubbles: true,
    });
    const prevent = vi.spyOn(matched, "preventDefault");
    target.dispatchEvent(matched);
    expect(intents).toEqual(["next"]);
    expect(prevent).toHaveBeenCalled();

    blocked = true;
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowUp",
        ctrlKey: true,
        altKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
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
