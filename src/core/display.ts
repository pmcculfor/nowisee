/**
 * Single interactive surface: one text node, or one input box.
 *
 * Announcement contract (locked): focus only — remount the text surface and
 * move focus onto it. Do **not** put `aria-live` on the focused surface.
 * VoiceOver on iOS announces both the live-region insertion and the focus
 * change, which restarts mid-utterance even when the label never changes.
 *
 * Input surface is a single-line `<input type="text">`, not a `<textarea>`.
 * After programmatic focus, VoiceOver on iOS parks on a textarea as
 * “multi-line text field, double tap to edit” and that double-tap often never
 * enters editing or raises the keyboard. A text field does enter editing and
 * raise the keyboard. Prefer that robust path over timer hacks around pads.
 *
 * HTML text inputs strip U+000A/U+000D from `.value`. Soft newlines in app
 * labels (e.g. Notes bodies) are stored in the control as U+2028 and mapped
 * back to `\n` in `getInputText()` so round-trips keep paragraph breaks.
 */

export type DisplayMode = "text" | "input";

/** Survives `<input type="text">` value sanitization; stands in for `\n`. */
const FIELD_NEWLINE = "\u2028";

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
    el.textContent = label;

    this.root.appendChild(el);
    this.textEl = el;
    this.mode = "text";
    el.focus();
  }

  showInput(initialText: string): void {
    this.root.replaceChildren();
    this.textEl = null;

    const input = document.createElement("input");
    input.type = "text";
    input.dataset.surface = "input";
    input.value = toFieldValue(initialText);
    input.setAttribute("aria-label", "Input");
    // Avoid browser spellcheck chrome fighting screen readers in MVP.
    input.setAttribute("spellcheck", "false");
    // Return stays in-field; leave via chord / pads (not a form submit).
    input.setAttribute("enterkeyhint", "enter");

    this.root.appendChild(input);
    this.inputEl = input;
    this.mode = "input";
    // Plain Enter inserts a soft newline (U+2028) so apps like Notes can keep
    // paragraph breaks without a <textarea>. Nav leave uses the chord / pads.
    input.addEventListener("keydown", onInputEnterKeyDown);
    input.focus();
    try {
      const end = input.value.length;
      input.setSelectionRange(end, end);
    } catch {
      // Some hosts reject selection APIs on detached/unfocused controls.
    }
  }

  getInputText(): string {
    return fromFieldValue(this.inputEl?.value ?? "");
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

function toFieldValue(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n/g, FIELD_NEWLINE);
}

function fromFieldValue(text: string): string {
  return text.replace(new RegExp(FIELD_NEWLINE, "g"), "\n");
}

function onInputEnterKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Enter" || event.isComposing) {
    return;
  }
  // Leave chord/mod shortcuts alone; only plain Enter inserts a soft newline.
  if (event.ctrlKey || event.altKey || event.metaKey) {
    return;
  }
  event.preventDefault();
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  input.value =
    input.value.slice(0, start) + FIELD_NEWLINE + input.value.slice(end);
  const caret = start + FIELD_NEWLINE.length;
  try {
    input.setSelectionRange(caret, caret);
  } catch {
    // Ignore hosts that reject selection changes.
  }
}
