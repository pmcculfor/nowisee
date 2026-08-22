/**
 * Reading surface, or a multiline field plus Cancel / Done.
 *
 * Announcement contract (locked): focus only — remount the text surface and
 * move focus onto it. Do **not** put `aria-live` on the focused surface.
 * VoiceOver on iOS announces both the live-region insertion and the focus
 * change, which restarts mid-utterance even when the label never changes.
 *
 * Text tips use `role="application"` so NVDA / JAWS / VoiceOver pass plain
 * arrow keys to the page. An application is a named widget: without
 * `aria-label`, NVDA announces only "application" and never the node text
 * (the spike that *did* speak used an inner live region; we name the widget
 * with the label instead so we do not put `aria-live` on the focused surface).
 * Input tips are a native `<textarea>` (Enter = newline) plus Cancel (`back`)
 * and Done (`enter`) buttons. Those buttons fire on click only — never on focus.
 */

import type { InputAutocomplete, NavIntent } from "./types.ts";

export type ShowInputOptions = {
  readonly secret?: boolean;
  readonly autocomplete?: InputAutocomplete;
};

export type DisplayMode = "text" | "input";

export interface DisplayHost {
  isBlocked(): boolean;
  onIntent(intent: NavIntent): void;
}

export class Display {
  private readonly root: HTMLElement;
  private readonly host: DisplayHost | undefined;
  private mode: DisplayMode = "text";
  private textEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | HTMLInputElement | null = null;

  constructor(root: HTMLElement, host?: DisplayHost) {
    this.root = root;
    this.host = host;
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
    el.setAttribute("role", "application");
    el.setAttribute("tabindex", "-1");
    // Name the widget. NVDA will not read textContent of role=application.
    el.setAttribute("aria-label", label);
    el.textContent = label;

    this.root.appendChild(el);
    this.textEl = el;
    this.setMode("text");
    el.focus();
  }

  showInput(initialText: string, options: ShowInputOptions = {}): void {
    this.root.replaceChildren();
    this.textEl = null;

    const secret = options.secret === true;
    const autocomplete = options.autocomplete ?? (secret ? "current-password" : "off");
    const input = secret ? document.createElement("input") : document.createElement("textarea");
    input.dataset.surface = "input";
    input.value = initialText;
    input.setAttribute("aria-label", ariaLabelFor(secret, autocomplete));
    input.setAttribute("spellcheck", "false");
    input.setAttribute("autocomplete", autocomplete);
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("autocorrect", "off");

    if (input instanceof HTMLInputElement) {
      input.type = "password";
    } else {
      input.setAttribute("rows", "8");
      input.setAttribute("enterkeyhint", "enter");
    }

    const actions = document.createElement("div");
    actions.dataset.inputActions = "";
    const cancel = makeActionButton("cancel", "Cancel");
    const done = makeActionButton("done", "Done");
    actions.append(cancel, done);

    this.root.append(input, actions);
    this.inputEl = input;
    this.setMode("input");

    cancel.addEventListener("click", () => {
      this.fireIntent("back");
    });
    done.addEventListener("click", () => {
      this.fireIntent("enter");
    });

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

  private setMode(mode: DisplayMode): void {
    this.mode = mode;
    this.root.dataset.mode = mode;
    const parent = this.root.parentElement;
    if (!parent) {
      return;
    }
    if (mode === "input") {
      parent.setAttribute("data-input-open", "");
    } else {
      parent.removeAttribute("data-input-open");
    }
  }

  private fireIntent(intent: NavIntent): void {
    if (!this.host || this.host.isBlocked()) {
      return;
    }
    this.host.onIntent(intent);
  }
}

function ariaLabelFor(secret: boolean, autocomplete: InputAutocomplete): string {
  if (secret || autocomplete === "current-password" || autocomplete === "new-password") {
    return "Password";
  }
  if (autocomplete === "username") {
    return "Email";
  }
  return "Input";
}

function makeActionButton(
  action: "cancel" | "done",
  label: string,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.inputAction = action;
  button.textContent = label;
  return button;
}
