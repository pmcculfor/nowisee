/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { NavPads, type NavPadsHost } from "../src/core/navPads.ts";
import type { NavIntent } from "../src/core/types.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("NavPads", () => {
  it("creates four native edge buttons named only via aria-label", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const host: NavPadsHost = {
      isBlocked: () => false,
      onIntent: () => {},
    };

    new NavPads({ parent, host });

    const buttons = [...parent.querySelectorAll("button[data-nav-pad]")];
    expect(buttons).toHaveLength(4);
    expect(buttons.every((b) => b instanceof HTMLButtonElement && b.type === "button")).toBe(
      true,
    );
    expect(buttons.map((b) => b.getAttribute("aria-label")).sort()).toEqual([
      "Back",
      "Enter",
      "Next",
      "Previous",
    ]);
    expect(buttons.every((b) => b.childNodes.length === 0)).toBe(true);
  });

  it("defers focusin so a following click owns the intent (iOS keyboard activation)", () => {
    vi.useFakeTimers();
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const intents: NavIntent[] = [];
    const host: NavPadsHost = {
      isBlocked: () => false,
      onIntent: (intent) => {
        intents.push(intent);
      },
    };

    const pads = new NavPads({ parent, host });
    pads.attach();

    const enter = parent.querySelector<HTMLButtonElement>('button[data-nav-pad="right"]')!;
    enter.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(intents).toEqual([]);

    enter.click();
    expect(intents).toEqual(["enter"]);

    // Deferred focusin must not fire after click already handled the gesture.
    vi.advanceTimersByTime(200);
    expect(intents).toEqual(["enter"]);

    pads.detach();
  });

  it("fires deferred focusin when no click arrives (swipe-and-rest)", () => {
    vi.useFakeTimers();
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const intents: NavIntent[] = [];
    let blocked = false;
    const host: NavPadsHost = {
      isBlocked: () => blocked,
      onIntent: (intent) => {
        intents.push(intent);
      },
    };

    const pads = new NavPads({ parent, host });
    pads.attach();

    const next = parent.querySelector<HTMLButtonElement>('button[data-nav-pad="bottom"]')!;
    next.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(intents).toEqual([]);
    vi.advanceTimersByTime(80);
    expect(intents).toEqual(["next"]);

    blocked = true;
    const prev = parent.querySelector<HTMLButtonElement>('button[data-nav-pad="top"]')!;
    prev.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    vi.advanceTimersByTime(80);
    expect(intents).toEqual(["next"]);

    blocked = false;
    const other = document.createElement("button");
    parent.appendChild(other);
    other.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    vi.advanceTimersByTime(80);
    expect(intents).toEqual(["next"]);

    const enter = parent.querySelector<HTMLButtonElement>('button[data-nav-pad="right"]')!;
    enter.focus();
    vi.advanceTimersByTime(80);
    expect(intents).toEqual(["next", "enter"]);

    pads.detach();
    const back = parent.querySelector<HTMLButtonElement>('button[data-nav-pad="left"]')!;
    back.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    vi.advanceTimersByTime(80);
    expect(intents).toEqual(["next", "enter"]);
  });

  it("cancels deferred focusin when focus leaves the pad before the delay", () => {
    vi.useFakeTimers();
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const intents: NavIntent[] = [];
    const host: NavPadsHost = {
      isBlocked: () => false,
      onIntent: (intent) => {
        intents.push(intent);
      },
    };

    const pads = new NavPads({ parent, host });
    pads.attach();

    const next = parent.querySelector<HTMLButtonElement>('button[data-nav-pad="bottom"]')!;
    next.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    next.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    vi.advanceTimersByTime(200);
    expect(intents).toEqual([]);

    pads.detach();
  });

  it("fires onIntent on click and debounces a second click of the same intent", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const intents: NavIntent[] = [];
    const host: NavPadsHost = {
      isBlocked: () => false,
      onIntent: (intent) => {
        intents.push(intent);
      },
    };

    const pads = new NavPads({ parent, host });
    pads.attach();

    const next = parent.querySelector<HTMLButtonElement>('button[data-nav-pad="bottom"]')!;
    next.click();
    next.click();
    expect(intents).toEqual(["next"]);

    const back = parent.querySelector<HTMLButtonElement>('button[data-nav-pad="left"]')!;
    back.click();
    expect(intents).toEqual(["next", "back"]);

    pads.detach();
    next.click();
    expect(intents).toEqual(["next", "back"]);
  });
});
