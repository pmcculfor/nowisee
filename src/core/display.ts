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
  /** Multiline surface — plain Enter inserts a newline; nav uses the chord/pads. */
  private inputEl: HTMLTextAreaElement | null = null;

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

    const input = document.createElement("textarea");
    input.dataset.surface = "input";
    input.value = initialText;
    input.rows = Math.max(3, initialText.split(/\r?\n/).length);
    input.setAttribute("aria-label", "Input");
    // Avoid browser spellcheck chrome fighting screen readers in MVP.
    input.setAttribute("spellcheck", "false");

    this.root.appendChild(input);
    this.inputEl = input;
    this.mode = "input";
    input.focus();
    try {
      const end = input.value.length;
      input.setSelectionRange(end, end);
    } catch {
      // Some hosts reject selection APIs on detached/unfocused controls.
    }
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
