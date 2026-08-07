/** @vitest-environment happy-dom */

import { describe, expect, it } from "vitest";
import { Display } from "../src/core/display.ts";

describe("Display", () => {
  it("showText renders one focusable text surface without aria-live", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const display = new Display(root);

    display.showText("Hello");

    const surface = root.querySelector("[data-surface='text']");
    expect(surface).not.toBeNull();
    expect(surface!.textContent).toBe("Hello");
    expect(surface!.hasAttribute("aria-live")).toBe(false);
    expect(surface!.getAttribute("tabindex")).toBe("-1");
    expect(display.getMode()).toBe("text");
    expect(document.activeElement).toBe(surface);
  });

  it("showInput replaces the surface with one text input and focuses it", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const display = new Display(root);

    display.showText("before");
    display.showInput("typed\nline two");

    expect(root.querySelector("[data-surface='text']")).toBeNull();
    const input = root.querySelector("input[type='text']");
    expect(input).not.toBeNull();
    // Text inputs strip U+000A; soft newlines are kept as U+2028 in the control.
    expect((input as HTMLInputElement).value).toBe("typed\u2028line two");
    expect(root.querySelector("textarea")).toBeNull();
    expect(display.getMode()).toBe("input");
    expect(display.getInputText()).toBe("typed\nline two");
    expect(document.activeElement).toBe(input);
  });

  it("round-trips newlines through getInputText after the user edits the field", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const display = new Display(root);

    display.showInput("a\nb");
    const input = root.querySelector<HTMLInputElement>("input[data-surface='input']")!;
    input.value = "a\u2028b\u2028c";
    expect(display.getInputText()).toBe("a\nb\nc");
  });

  it("plain Enter inserts a soft newline in the text field", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const display = new Display(root);

    display.showInput("ab");
    const input = root.querySelector<HTMLInputElement>("input[data-surface='input']")!;
    input.setSelectionRange(1, 1);
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(input.value).toBe("a\u2028b");
    expect(display.getInputText()).toBe("a\nb");
  });

  it("switching input → text replaces the surface", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const display = new Display(root);

    display.showInput("x");
    display.showText("back to text");

    expect(root.querySelector("input[data-surface='input']")).toBeNull();
    expect(root.querySelector("[data-surface='text']")!.textContent).toBe("back to text");
    expect(display.getInputText()).toBe("");
  });

  it("does not truncate long labels", () => {
    const root = document.createElement("div");
    const display = new Display(root);
    const long = "a".repeat(10_000);
    display.showText(long);
    expect(root.textContent).toBe(long);
  });
});
