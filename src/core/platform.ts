import type { PlatformContext } from "./types.ts";

/**
 * Browser clipboard surface core can talk to.
 * Injected in tests; defaults to `globalThis.navigator.clipboard` when present.
 */
export interface ClipboardHost {
  writeText(text: string): Promise<void>;
  /**
   * Promise-valued ClipboardItem path (Chrome/Safari).
   * When available, core starts the write during keydown so activation stays fresh.
   */
  writeWithDelayedText?: (textPromise: Promise<string>) => Promise<void>;
}

export interface PlatformOptions {
  readonly clipboard?: ClipboardHost | null;
}

type PendingClipboard = {
  resolveText: (text: string) => void;
  rejectText: (reason: unknown) => void;
  textPromise: Promise<string>;
  /** Settles when the browser write finishes (or is cancelled). */
  writeStarted: Promise<void> | null;
  lastAppRequest: Deferred<void> | null;
  cancelled: boolean;
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Owns the action-scoped clipboard write channel.
 * storage / announce / requestRefresh are declared on PlatformContext but not provided.
 */
export class PlatformCapabilities {
  private readonly clipboardHost: ClipboardHost | null;
  private pending: PendingClipboard | null = null;

  constructor(options: PlatformOptions = {}) {
    if (options.clipboard === null) {
      this.clipboardHost = null;
    } else if (options.clipboard) {
      this.clipboardHost = options.clipboard;
    } else {
      this.clipboardHost = detectDefaultClipboardHost();
    }
  }

  /**
   * Clipboard write surface for Navigator during an action.
   * `clipboard` is absent when the host cannot honour it.
   */
  createContext(): PlatformContext {
    if (!this.clipboardHost) {
      return {};
    }
    return {
      clipboard: {
        writeText: (text: string) => this.writeText(text),
      },
    };
  }

  /**
   * Open the clipboard write channel synchronously inside the keydown that
   * traversed an `action: true` edge — before any await into the app.
   */
  beginClipboardWrite(): void {
    if (!this.clipboardHost) {
      return;
    }
    if (this.pending) {
      this.cancelPending("superseded by a new action clipboard channel");
    }

    let resolveText!: (text: string) => void;
    let rejectText!: (reason: unknown) => void;
    const textPromise = new Promise<string>((resolve, reject) => {
      resolveText = resolve;
      rejectText = reject;
    });

    const pending: PendingClipboard = {
      resolveText,
      rejectText,
      textPromise,
      writeStarted: null,
      lastAppRequest: null,
      cancelled: false,
    };
    this.pending = pending;
    // Absorb cancel/unused rejections when nothing awaits textPromise (fallback path).
    void textPromise.catch(() => undefined);

    if (this.clipboardHost.writeWithDelayedText) {
      pending.writeStarted = this.clipboardHost
        .writeWithDelayedText(textPromise)
        .then(() => {
          pending.lastAppRequest?.resolve();
        })
        .catch((err: unknown) => {
          pending.lastAppRequest?.reject(err);
        });
    }
  }

  /**
   * After the action call finishes: if the app never supplied text, cancel.
   */
  endClipboardWrite(): void {
    if (!this.pending || this.pending.cancelled) {
      this.pending = null;
      return;
    }
    // App never called writeText — abandon the delayed write.
    if (!this.pending.lastAppRequest) {
      this.cancelPending("clipboard write unused");
    }
    this.pending = null;
  }

  private async writeText(text: string): Promise<void> {
    if (!this.clipboardHost) {
      throw new Error("Platform: clipboard is not available");
    }
    if (!this.pending || this.pending.cancelled) {
      throw new Error("Platform: clipboard.writeText is only valid during an action call");
    }

    const pending = this.pending;

    if (pending.lastAppRequest) {
      // Last call wins; prior request is abandoned as an app bug.
      console.warn(
        "Platform: clipboard.writeText called more than once in one action; last call wins",
      );
      pending.lastAppRequest.reject(
        new Error("Platform: clipboard.writeText superseded by a later call"),
      );
    }

    const appRequest = deferred<void>();
    pending.lastAppRequest = appRequest;

    if (this.clipboardHost.writeWithDelayedText && pending.writeStarted) {
      pending.resolveText(text);
      return appRequest.promise;
    }

    // Fallback: write immediately when the app supplies text.
    try {
      await this.clipboardHost.writeText(text);
      appRequest.resolve();
    } catch (err) {
      appRequest.reject(err);
    }
    return appRequest.promise;
  }

  private cancelPending(reason: string): void {
    if (!this.pending) {
      return;
    }
    this.pending.cancelled = true;
    this.pending.rejectText(new Error(reason));
    this.pending.lastAppRequest?.reject(new Error(reason));
    this.pending = null;
  }
}

function detectDefaultClipboardHost(): ClipboardHost | null {
  const nav = globalThis.navigator as Navigator | undefined;
  const clipboard = nav?.clipboard;
  if (!clipboard || typeof clipboard.writeText !== "function") {
    return null;
  }

  const host: ClipboardHost = {
    writeText: (text: string) => clipboard.writeText(text),
  };

  // Prefer delayed ClipboardItem write when the browser supports it.
  if (
    typeof clipboard.write === "function" &&
    typeof globalThis.ClipboardItem === "function"
  ) {
    host.writeWithDelayedText = (textPromise: Promise<string>) => {
      const item = new ClipboardItem({
        "text/plain": textPromise,
      });
      return clipboard.write([item]);
    };
  }

  return host;
}
