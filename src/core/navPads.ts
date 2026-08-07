import type { NavIntent } from "./types.ts";

/**
 * Edge pads for VoiceOver / explore-by-touch: native buttons at screen edges.
 * Navigation fires on accessibility focus (`focusin`) and on `click` (sighted
 * tap, or VoiceOver double-tap activate). A short debounce collapses focus+click
 * from the same gesture into one intent.
 */

export interface NavPadsHost {
  isBlocked(): boolean;
  onIntent(intent: NavIntent): void;
}

export interface NavPadsOptions {
  readonly parent: HTMLElement;
  readonly host: NavPadsHost;
}

/** Collapse focusin + click from one activation into a single intent. */
const FIRE_DEBOUNCE_MS = 400;

const PADS: readonly {
  readonly intent: NavIntent;
  readonly edge: "top" | "bottom" | "left" | "right";
  readonly label: string;
}[] = [
  { intent: "prev", edge: "top", label: "Previous" },
  { intent: "next", edge: "bottom", label: "Next" },
  { intent: "back", edge: "left", label: "Back" },
  { intent: "enter", edge: "right", label: "Enter" },
];

export class NavPads {
  private readonly host: NavPadsHost;
  private readonly buttons = new Map<HTMLButtonElement, NavIntent>();
  private readonly onFocusIn: (event: Event) => void;
  private readonly onClick: (event: Event) => void;
  private attached = false;
  private lastFiredAt = 0;
  private lastFiredIntent: NavIntent | null = null;

  constructor(options: NavPadsOptions) {
    this.host = options.host;
    this.onFocusIn = (event: Event) => {
      this.handlePadEvent(event);
    };
    this.onClick = (event: Event) => {
      this.handlePadEvent(event);
    };

    for (const pad of PADS) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", pad.label);
      button.dataset.navPad = pad.edge;
      // Name lives on aria-label only — no nested text for VoiceOver to stop on.
      options.parent.appendChild(button);
      this.buttons.set(button, pad.intent);
    }
  }

  attach(): void {
    if (this.attached) {
      return;
    }
    for (const button of this.buttons.keys()) {
      button.addEventListener("focusin", this.onFocusIn);
      button.addEventListener("click", this.onClick);
    }
    this.attached = true;
  }

  detach(): void {
    if (!this.attached) {
      return;
    }
    for (const button of this.buttons.keys()) {
      button.removeEventListener("focusin", this.onFocusIn);
      button.removeEventListener("click", this.onClick);
    }
    this.attached = false;
  }

  private handlePadEvent(event: Event): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }
    const intent = this.buttons.get(target);
    if (intent === undefined) {
      return;
    }
    if (this.host.isBlocked()) {
      return;
    }
    const now = Date.now();
    if (
      this.lastFiredIntent === intent &&
      now - this.lastFiredAt < FIRE_DEBOUNCE_MS
    ) {
      return;
    }
    this.lastFiredIntent = intent;
    this.lastFiredAt = now;
    this.host.onIntent(intent);
  }
}
