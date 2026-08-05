/** @vitest-environment happy-dom */

import { describe, expect, it } from "vitest";
import { Display } from "../src/core/display.ts";

describe("Display", () => {
  it("showText renders one focusable assertive live region", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const display = new Display(root);

    display.showText("Hello");

    const surface = root.querySelector("[data-surface='text']");
    expect(surface).not.toBeNull();
    expect(surface!.textContent).toBe("Hello");
    expect(surface!.getAttribute("aria-live")).toBe("assertive");
    expect(surface!.getAttribute("tabindex")).toBe("-1");
    expect(display.getMode()).toBe("text");
    expect(document.activeElement).toBe(surface);
  });

  it("showInput replaces the surface with one input and focuses it", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const display = new Display(root);

    display.showText("before");
    display.showInput("typed");

    expect(root.querySelector("[data-surface='text']")).toBeNull();
    const input = root.querySelector("input");
    expect(input).not.toBeNull();
    expect(input!.value).toBe("typed");
    expect(display.getMode()).toBe("input");
    expect(display.getInputText()).toBe("typed");
    expect(document.activeElement).toBe(input);
  });

  it("switching input → text replaces the surface", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const display = new Display(root);

    display.showInput("x");
    display.showText("back to text");

    expect(root.querySelector("input")).toBeNull();
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
