import type { NavIntent } from "./types.ts";

/**
 * Edge pads for VoiceOver / explore-by-touch: native buttons at screen edges.
 *
 * Navigation fires when accessibility focus lands on a pad (`focusin`) and on
 * `click` (sighted tap, or VoiceOver double-tap activate).
 *
 * **Click wins over focusin.** VoiceOver double-tap typically delivers
 * focusin then click. If focusin navigated immediately, Display would
 * `focus()` the new textarea outside the click's user-activation window and
 * iOS would refuse to raise the software keyboard. So focusin is deferred
 * briefly; a following click cancels that timer and fires instead, keeping
 * `showInput` → `textarea.focus()` inside the activation gesture. A bare
 * focusin (swipe onto the pad and rest) still navigates after the delay.
 * Leaving the pad before the delay cancels the pending intent.
 */

export interface NavPadsHost {
  isBlocked(): boolean;
  onIntent(intent: NavIntent): void;
}

export interface NavPadsOptions {
  readonly parent: HTMLElement;
  readonly host: NavPadsHost;
}

/**
 * Wait long enough for a paired click to arrive after focusin on the same
 * VoiceOver double-tap, but short enough that resting on a pad still feels
 * immediate.
 */
const FOCUSIN_DEFER_MS = 80;

/** Collapse accidental double-clicks / repeat activations of the same intent. */
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
  private readonly onFocusOut: (event: Event) => void;
  private readonly onClick: (event: Event) => void;
  private attached = false;
  private lastFiredAt = 0;
  private lastFiredIntent: NavIntent | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingIntent: NavIntent | null = null;
  private pendingButton: HTMLButtonElement | null = null;

  constructor(options: NavPadsOptions) {
    this.host = options.host;
    this.onFocusIn = (event: Event) => {
      this.handleFocusIn(event);
    };
    this.onFocusOut = (event: Event) => {
      this.handleFocusOut(event);
    };
    this.onClick = (event: Event) => {
      this.handleClick(event);
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
      button.addEventListener("focusout", this.onFocusOut);
      button.addEventListener("click", this.onClick);
    }
    this.attached = true;
  }

  detach(): void {
    if (!this.attached) {
      return;
    }
    this.clearPending();
    for (const button of this.buttons.keys()) {
      button.removeEventListener("focusin", this.onFocusIn);
      button.removeEventListener("focusout", this.onFocusOut);
      button.removeEventListener("click", this.onClick);
    }
    this.attached = false;
  }

  private handleFocusIn(event: Event): void {
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
    this.clearPending();
    this.pendingIntent = intent;
    this.pendingButton = target;
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      const scheduled = this.pendingIntent;
      this.pendingIntent = null;
      this.pendingButton = null;
      if (scheduled !== null) {
        this.fire(scheduled);
      }
    }, FOCUSIN_DEFER_MS);
  }

  private handleFocusOut(event: Event): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }
    // Swiped past the pad before the defer elapsed — do not navigate.
    if (this.pendingButton === target) {
      this.clearPending();
    }
  }

  private handleClick(event: Event): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }
    const intent = this.buttons.get(target);
    if (intent === undefined) {
      return;
    }
    if (this.host.isBlocked()) {
      this.clearPending();
      return;
    }
    // Prefer click so textarea.focus() runs under user activation (iOS keyboard).
    this.clearPending();
    this.fire(intent);
  }

  private clearPending(): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    this.pendingIntent = null;
    this.pendingButton = null;
  }

  private fire(intent: NavIntent): void {
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
