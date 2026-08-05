import type { KeyBinding, NavIntent, NodeKind } from "./types.ts";

/** Minimal key event shape so resolve can be tested without a full KeyboardEvent. */
export interface KeyEventLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
}

/**
 * Provisional defaults from MODULES §9.
 * Escape is never bound. Tab / Shift+Tab are never bound (WCAG 2.1.2).
 * Plain arrows on input tips are unbound so the caret keeps them.
 */
export function defaultKeyBindings(): readonly KeyBinding[] {
  return [
    { intent: "prev", key: "ArrowUp", whenTip: "text" },
    { intent: "next", key: "ArrowDown", whenTip: "text" },
    { intent: "enter", key: "ArrowRight", whenTip: "text" },
    { intent: "back", key: "ArrowLeft", whenTip: "text" },
    { intent: "enter", key: "Enter", whenTip: "input" },
    { intent: "back", key: "ArrowUp", mods: { alt: true }, whenTip: "input" },
  ];
}

/**
 * Resolve (event, tipKind) → intent.
 * Unbound → undefined (caller must not preventDefault).
 * Omitted modifier flags mean that modifier must not be pressed.
 */
export function resolveIntent(
  event: KeyEventLike,
  tipKind: NodeKind,
  bindings: readonly KeyBinding[],
): NavIntent | undefined {
  for (const binding of bindings) {
    if (binding.whenTip !== undefined && binding.whenTip !== tipKind) {
      continue;
    }
    if (binding.key !== event.key) {
      continue;
    }
    if (!modsMatch(binding.mods, event)) {
      continue;
    }
    return binding.intent;
  }
  return undefined;
}

function modsMatch(
  mods: KeyBinding["mods"],
  event: KeyEventLike,
): boolean {
  const wantCtrl = mods?.ctrl === true;
  const wantAlt = mods?.alt === true;
  const wantShift = mods?.shift === true;
  const wantMeta = mods?.meta === true;
  return (
    event.ctrlKey === wantCtrl &&
    event.altKey === wantAlt &&
    event.shiftKey === wantShift &&
    event.metaKey === wantMeta
  );
}

/**
 * What Keyboard needs from Navigator (or a test double) without importing it.
 */
export interface KeyboardHost {
  getTipKind(): NodeKind;
  isBlocked(): boolean;
  onIntent(intent: NavIntent): void;
}

export interface KeyboardOptions {
  readonly target: EventTarget;
  readonly host: KeyboardHost;
  readonly bindings?: readonly KeyBinding[];
}

/**
 * Owns the physical → intent binding table and keydown listening.
 * Does not know which intents an app map contains.
 */
export class Keyboard {
  private bindings: readonly KeyBinding[];
  private readonly host: KeyboardHost;
  private readonly target: EventTarget;
  private readonly onKeyDown: (event: Event) => void;
  private attached = false;

  constructor(options: KeyboardOptions) {
    this.target = options.target;
    this.host = options.host;
    this.bindings = options.bindings ?? defaultKeyBindings();
    this.onKeyDown = (event: Event) => {
      this.handleKeyDown(event as KeyboardEvent);
    };
  }

  setBindings(bindings: readonly KeyBinding[]): void {
    this.bindings = bindings;
  }

  attach(): void {
    if (this.attached) {
      return;
    }
    this.target.addEventListener("keydown", this.onKeyDown);
    this.attached = true;
  }

  detach(): void {
    if (!this.attached) {
      return;
    }
    this.target.removeEventListener("keydown", this.onKeyDown);
    this.attached = false;
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (this.host.isBlocked()) {
      return;
    }
    const intent = resolveIntent(event, this.host.getTipKind(), this.bindings);
    if (intent === undefined) {
      return;
    }
    event.preventDefault();
    this.host.onIntent(intent);
  }
}
