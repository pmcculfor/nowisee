/**
 * Single interactive surface: one text live region, or one input box.
 * DOM strategy (role=application vs live region) is provisional pending the
 * screen-reader spike — assertive aria-live is the documented MVP default.
 *
 * Remounting the text surface (replaceChildren + focus) restarts screen-reader
 * utterance. Callers that already showed a tip and only need a label change
 * should use `replaceText` instead of `showText`.
 */

export type DisplayMode = "text" | "input";

export class Display {
  private readonly root: HTMLElement;
  private mode: DisplayMode = "text";
  private textEl: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.replaceChildren();
  }

  getMode(): DisplayMode {
    return this.mode;
  }

  showText(label: string): void {
    this.root.replaceChildren();
    this.inputEl = null;

    const el = document.createElement("div");
    el.dataset.surface = "text";
    el.setAttribute("tabindex", "-1");
    el.setAttribute("aria-live", "assertive");
    el.setAttribute("aria-atomic", "true");
    el.textContent = label;

    this.root.appendChild(el);
    this.textEl = el;
    this.mode = "text";
    el.focus();
  }

  /**
   * Change the text surface label without remounting or stealing focus.
   * Falls back to `showText` if the text surface is not mounted.
   */
  replaceText(label: string): void {
    if (this.mode !== "text" || !this.textEl) {
      this.showText(label);
      return;
    }
    if (this.textEl.textContent !== label) {
      this.textEl.textContent = label;
    }
  }

  showInput(initialText: string): void {
    this.root.replaceChildren();
    this.textEl = null;

    const input = document.createElement("input");
    input.type = "text";
    input.dataset.surface = "input";
    input.value = initialText;
    input.setAttribute("aria-label", "Input");

    this.root.appendChild(input);
    this.inputEl = input;
    this.mode = "input";
    input.focus();
  }

  getInputText(): string {
    return this.inputEl?.value ?? "";
  }

  /** Focus the current surface (load / recovery). */
  focus(): void {
    if (this.mode === "input") {
      this.inputEl?.focus();
      return;
    }
    this.textEl?.focus();
  }
}
