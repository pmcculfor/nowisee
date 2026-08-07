/** @vitest-environment happy-dom */

import { describe, expect, it } from "vitest";
import { NavPads, type NavPadsHost } from "../src/core/navPads.ts";
import type { NavIntent } from "../src/core/types.ts";

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

  it("fires onIntent on focusin, not when blocked, and ignores other focus targets", () => {
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
    expect(intents).toEqual(["next"]);

    blocked = true;
    const prev = parent.querySelector<HTMLButtonElement>('button[data-nav-pad="top"]')!;
    prev.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(intents).toEqual(["next"]);

    blocked = false;
    const other = document.createElement("button");
    parent.appendChild(other);
    other.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(intents).toEqual(["next"]);

    const enter = parent.querySelector<HTMLButtonElement>('button[data-nav-pad="right"]')!;
    enter.focus();
    expect(intents).toEqual(["next", "enter"]);

    pads.detach();
    const back = parent.querySelector<HTMLButtonElement>('button[data-nav-pad="left"]')!;
    back.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(intents).toEqual(["next", "enter"]);
  });
});
