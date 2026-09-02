/** @vitest-environment happy-dom */

import { describe, expect, it } from "vitest";
import { Display, type DisplayHost } from "../src/core/display.ts";
import type { NavIntent } from "../src/core/types.ts";

function hostMock(): DisplayHost & { intents: NavIntent[]; blocked: boolean } {
  const state = { intents: [] as NavIntent[], blocked: false };
  return {
    get intents() {
      return state.intents;
    },
    get blocked() {
      return state.blocked;
    },
    set blocked(value: boolean) {
      state.blocked = value;
    },
    isBlocked: () => state.blocked,
    onIntent: (intent) => {
      state.intents.push(intent);
    },
  };
}

describe("Display", () => {
  it("showText renders a focusable application surface without aria-live", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const display = new Display(root);

    display.showText("Hello");

    const surface = root.querySelector("[data-surface='text']");
    expect(surface).not.toBeNull();
    expect(surface!.textContent).toBe("Hello");
    expect(surface!.getAttribute("role")).toBe("application");
    expect(surface!.getAttribute("aria-label")).toBe("Hello");
    expect(surface!.hasAttribute("aria-live")).toBe(false);
    expect(surface!.getAttribute("tabindex")).toBe("-1");
    expect(display.getMode()).toBe("text");
    expect(display.getLabel()).toBe("Hello");
    expect(document.activeElement).toBe(surface);
  });

  it("showInput mounts a textarea with real newlines, Cancel, and Done", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const display = new Display(root);

    display.showText("before");
    display.showInput("typed\nline two");

    expect(root.querySelector("[data-surface='text']")).toBeNull();
    expect(root.querySelector("input[type='text']")).toBeNull();
    const input = root.querySelector<HTMLTextAreaElement>("textarea[data-surface='input']");
    expect(input).not.toBeNull();
    expect(input!.value).toBe("typed\nline two");
    expect(display.getMode()).toBe("input");
    expect(display.getInputText()).toBe("typed\nline two");
    expect(document.activeElement).toBe(input);

    const cancel = root.querySelector("[data-input-action='cancel']");
    const done = root.querySelector("[data-input-action='done']");
    expect(cancel?.textContent).toBe("Cancel");
    expect(done?.textContent).toBe("Done");
    expect(cancel?.getAttribute("type")).toBe("button");
    expect(done?.getAttribute("type")).toBe("button");
    expect(input!.compareDocumentPosition(cancel!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cancel!.compareDocumentPosition(done!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(root.dataset.mode).toBe("input");
    expect(document.body.hasAttribute("data-input-open")).toBe(true);
  });

  it("round-trips newlines through getInputText after the user edits the field", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const display = new Display(root);

    display.showInput("a\nb");
    const input = root.querySelector<HTMLTextAreaElement>("textarea[data-surface='input']")!;
    input.value = "a\nb\nc";
    expect(display.getInputText()).toBe("a\nb\nc");
  });

  it("Done click fires enter; Cancel click fires back; neither fires on focus", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const host = hostMock();
    const display = new Display(root, host);

    display.showInput("draft");
    const cancel = root.querySelector<HTMLButtonElement>("[data-input-action='cancel']")!;
    const done = root.querySelector<HTMLButtonElement>("[data-input-action='done']")!;

    cancel.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    done.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(host.intents).toEqual([]);

    done.click();
    expect(host.intents).toEqual(["enter"]);
    cancel.click();
    expect(host.intents).toEqual(["enter", "back"]);
  });

  it("action buttons do not fire while blocked", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const host = hostMock();
    const display = new Display(root, host);

    display.showInput("draft");
    host.blocked = true;
    root.querySelector<HTMLButtonElement>("[data-input-action='done']")!.click();
    root.querySelector<HTMLButtonElement>("[data-input-action='cancel']")!.click();
    expect(host.intents).toEqual([]);
  });

  it("plain Enter in the textarea does not fire an intent", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const host = hostMock();
    const display = new Display(root, host);

    display.showInput("ab");
    const input = root.querySelector<HTMLTextAreaElement>("textarea[data-surface='input']")!;
    input.setSelectionRange(1, 1);
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(host.intents).toEqual([]);
    expect(display.getInputText()).toBe("ab");
  });

  it("switching input → text replaces the surface and clears input-open", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const display = new Display(root);

    display.showInput("x");
    expect(document.body.hasAttribute("data-input-open")).toBe(true);
    display.showText("back to text");

    expect(root.querySelector("textarea[data-surface='input']")).toBeNull();
    expect(root.querySelector("[data-input-action]")).toBeNull();
    expect(root.querySelector("[data-surface='text']")!.textContent).toBe("back to text");
    expect(root.querySelector("[data-surface='text']")!.getAttribute("role")).toBe(
      "application",
    );
    expect(root.querySelector("[data-surface='text']")!.getAttribute("aria-label")).toBe(
      "back to text",
    );
    expect(display.getInputText()).toBe("");
    expect(document.body.hasAttribute("data-input-open")).toBe(false);
  });

  it("does not truncate long labels", () => {
    const root = document.createElement("div");
    const display = new Display(root);
    const long = "a".repeat(10_000);
    display.showText(long);
    expect(root.textContent).toBe(long);
  });

  it("secret input renders type=password with honest autocomplete", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const display = new Display(root);

    display.showInput("", { secret: true, autocomplete: "current-password" });

    expect(root.querySelector("textarea")).toBeNull();
    const input = root.querySelector<HTMLInputElement>("input[data-surface='input']");
    expect(input).not.toBeNull();
    expect(input!.type).toBe("password");
    expect(input!.getAttribute("autocomplete")).toBe("current-password");
    expect(input!.getAttribute("aria-label")).toBe("Password");
    input!.value = "secret-value";
    expect(display.getInputText()).toBe("secret-value");
  });

  it("onSurfaceChange fires after showText and showInput", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const modes: string[] = [];
    const display = new Display(root, {
      isBlocked: () => false,
      onIntent: () => {},
      onSurfaceChange: () => {
        modes.push(`${display.getMode()}:${display.getLabel()}`);
      },
    });

    display.showText("Verse");
    display.showInput("", { secret: true });
    expect(modes).toEqual(["text:Verse", "input:Password"]);
  });

  it("skipTextFocus leaves the text surface unfocused", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const previous = document.activeElement;
    const display = new Display(root, {
      isBlocked: () => false,
      onIntent: () => {},
      skipTextFocus: () => true,
    });

    display.showText("Hello");
    const surface = root.querySelector("[data-surface='text']");
    expect(surface).not.toBeNull();
    expect(document.activeElement).not.toBe(surface);
    expect(document.activeElement).toBe(previous);
  });
});
