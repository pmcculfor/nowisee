/**
 * Optional WKWebView host. Present only when iOS injected
 * `webkit.messageHandlers.nowisee`. Safari and desktop never set that, so
 * NavPads stay the VoiceOver path there.
 *
 * Native → page: `__nowiseeNative.onIntent(intent)`.
 * Page → native: `postMessage({ mode, label, blocked })`.
 */

import type { DisplayMode } from "../core/display.ts";
import type { NavIntent } from "../core/types.ts";

export type NativeSurfaceState = {
  readonly mode: DisplayMode;
  readonly label: string;
  readonly blocked: boolean;
};

export type NativeBridgeHost = {
  onIntent(intent: NavIntent): void | Promise<void>;
  getState(): NativeSurfaceState;
};

type NowiseeHandler = {
  postMessage: (message: unknown) => void;
};

type WebkitNamespace = {
  readonly messageHandlers?: {
    readonly nowisee?: NowiseeHandler;
  };
};

const INTENTS: readonly NavIntent[] = ["prev", "next", "enter", "back"];

function webkitOf(win: Window): WebkitNamespace | undefined {
  return (win as Window & { webkit?: WebkitNamespace }).webkit;
}

export function isNativeHostPresent(win: Window = window): boolean {
  return typeof webkitOf(win)?.messageHandlers?.nowisee?.postMessage === "function";
}

export type NativeBridgeHandle = {
  notify(): void;
  detach(): void;
};

export function attachNativeBridge(
  host: NativeBridgeHost,
  win: Window = window,
): NativeBridgeHandle {
  const handler = webkitOf(win)?.messageHandlers?.nowisee;

  function post(state: NativeSurfaceState): void {
    handler?.postMessage(state);
  }

  function notify(): void {
    post(host.getState());
  }

  const api = {
    onIntent(intent: string): NativeSurfaceState {
      if ((INTENTS as readonly string[]).includes(intent)) {
        const result = host.onIntent(intent);
        if (isPromise(result)) {
          void result.finally(notify);
        } else {
          notify();
        }
      }
      return host.getState();
    },
    getState(): NativeSurfaceState {
      return host.getState();
    },
    notify,
  };

  (
    win as Window & {
      __nowiseeNative?: typeof api;
    }
  ).__nowiseeNative = api;
  notify();

  return {
    notify,
    detach() {
      delete (
        win as Window & {
          __nowiseeNative?: typeof api;
        }
      ).__nowiseeNative;
    },
  };
}

function isPromise(value: unknown): value is Promise<void> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then: unknown }).then === "function"
  );
}
