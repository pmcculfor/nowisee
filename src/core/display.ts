/**
 * Single interactive surface: one text node, or one multiline input.
 *
 * Announcement contract (locked): focus only — remount the text surface and
 * move focus onto it. Do **not** put `aria-live` on the focused surface.
 * VoiceOver on iOS announces both the live-region insertion and the focus
 * change, which restarts mid-utterance even when the label never changes.
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
    el.textContent = label;

    this.root.appendChild(el);
    this.textEl = el;
    this.mode = "text";
    el.focus();
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
