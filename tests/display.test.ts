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

  it("showInput replaces the surface with one textarea and focuses it", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const display = new Display(root);

    display.showText("before");
    display.showInput("typed\nline two");

    expect(root.querySelector("[data-surface='text']")).toBeNull();
    const input = root.querySelector("textarea");
    expect(input).not.toBeNull();
    expect(input!.value).toBe("typed\nline two");
    expect(display.getMode()).toBe("input");
    expect(display.getInputText()).toBe("typed\nline two");
    expect(document.activeElement).toBe(input);
  });

  it("switching input → text replaces the surface", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const display = new Display(root);

    display.showInput("x");
    display.showText("back to text");

    expect(root.querySelector("textarea")).toBeNull();
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
