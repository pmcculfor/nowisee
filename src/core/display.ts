/**
 * Single interactive surface: one text node, or one multiline input.
 *
 * Announcement contract (locked): focus only — remount the text surface and
 * move focus onto it. Do **not** put `aria-live` on the focused surface.
 * VoiceOver on iOS announces both the live-region insertion and the focus
 * change, which restarts mid-utterance even when the label never changes.
 *
 * Input surface: a single reused `<textarea>`. iOS Safari raises the software
 * keyboard for programmatic `focus()` only inside a user-activation gesture
 * (NavPads click). Recreating the control on every `showInput` made that
 * focus less reliable than the earlier single-line `<input>`; keep one node
 * and re-attach it.
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

    const input = this.ensureInputEl();
    input.value = initialText;
    input.rows = Math.max(3, initialText.split(/\r?\n/).length);

    this.root.appendChild(input);
    this.mode = "input";
    // Must stay synchronous with the triggering gesture (NavPads click) so
    // iOS will raise the software keyboard.
    input.focus();
    try {
      const end = input.value.length;
      input.setSelectionRange(end, end);
    } catch {
      // Some hosts reject selection APIs on detached/unfocused controls.
    }
  }

  getInputText(): string {
    if (this.mode !== "input") {
      return "";
    }
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

  private ensureInputEl(): HTMLTextAreaElement {
    if (this.inputEl) {
      return this.inputEl;
    }
    const input = document.createElement("textarea");
    input.dataset.surface = "input";
    input.setAttribute("aria-label", "Input");
    // Avoid browser spellcheck chrome fighting screen readers in MVP.
    input.setAttribute("spellcheck", "false");
    // Enter inserts a newline; leave via chord / pads (not a form submit).
    input.setAttribute("enterkeyhint", "enter");
    this.inputEl = input;
    return input;
  }
}
