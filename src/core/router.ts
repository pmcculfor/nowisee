import type { AppLocation } from "./types.ts";

export interface RouterOptions {
  readonly rootAppId: string;
  /** Return true when the id is a registered app. */
  readonly isKnownApp: (appId: string) => boolean;
  /** Called when the browser hash changes externally (Back/Forward, edited URL). */
  readonly onLocation: (location: AppLocation) => void;
  /**
   * Optional DOM wiring. Defaults to `window` / `location` when available.
   * Injected in tests.
   */
  readonly location?: {
    getHash(): string;
    setHash(hash: string): void;
  };
  readonly eventTarget?: EventTarget;
}

/**
 * Pure URL boundary: browser hash ↔ AppLocation.
 * Owns no stack, cache, map, blocked flag, or display.
 * The only module that produces `#/...` strings.
 */
export class Router {
  private readonly rootAppId: string;
  private readonly isKnownApp: (appId: string) => boolean;
  private readonly onLocation: (location: AppLocation) => void;
  private readonly locationApi: {
    getHash(): string;
    setHash(hash: string): void;
  };
  private readonly eventTarget: EventTarget | null;
  private suppressHashChange = false;
  private readonly onHashChange: () => void;
  private attached = false;

  constructor(options: RouterOptions) {
    this.rootAppId = options.rootAppId;
    this.isKnownApp = options.isKnownApp;
    this.onLocation = options.onLocation;
    this.locationApi = options.location ?? defaultLocationApi();
    this.eventTarget = options.eventTarget ?? defaultEventTarget();
    this.onHashChange = () => {
      if (this.suppressHashChange) {
        this.suppressHashChange = false;
        return;
      }
      this.onLocation(this.parse(this.locationApi.getHash()));
    };
  }

  /**
   * Parse a hash or full href into an AppLocation.
   * Unknown / corrupt values resolve to the root app (do not crash).
   */
  parse(href: string): AppLocation {
    const hash = extractHash(href);
    if (hash === "" || hash === "#" || hash === "#/") {
      return { appId: this.rootAppId, path: "/" };
    }
    if (!hash.startsWith("#/")) {
      return { appId: this.rootAppId, path: "/" };
    }

    const rest = hash.slice(2); // after "#/"
    if (rest === "") {
      return { appId: this.rootAppId, path: "/" };
    }

    const slash = rest.indexOf("/");
    const appId = slash === -1 ? rest : rest.slice(0, slash);
    const pathRaw = slash === -1 ? "/" : rest.slice(slash);
    const path = normalizePath(pathRaw);

    if (appId === this.rootAppId && path === "/") {
      return { appId: this.rootAppId, path: "/" };
    }

    if (!this.isKnownApp(appId)) {
      return { appId: this.rootAppId, path: "/" };
    }

    return { appId, path };
  }

  /** The only place in the codebase that produces a `#/...` string. */
  hrefFor(location: AppLocation): string {
    const path = normalizePath(location.path);
    if (location.appId === this.rootAppId && path === "/") {
      return "#/";
    }
    if (path === "/") {
      return `#/${location.appId}`;
    }
    return `#/${location.appId}${path}`;
  }

  /**
   * Write the address bar without re-entering openLocation via hashchange.
   */
  setAddressBar(location: AppLocation): void {
    const href = this.hrefFor(location);
    const nextHash = href.startsWith("#") ? href : `#${href}`;
    if (this.locationApi.getHash() === nextHash) {
      return;
    }
    this.suppressHashChange = true;
    this.locationApi.setHash(nextHash);
  }

  attach(): void {
    if (this.attached || !this.eventTarget) {
      return;
    }
    this.eventTarget.addEventListener("hashchange", this.onHashChange);
    this.attached = true;
  }

  detach(): void {
    if (!this.attached || !this.eventTarget) {
      return;
    }
    this.eventTarget.removeEventListener("hashchange", this.onHashChange);
    this.attached = false;
  }
}

function extractHash(href: string): string {
  const index = href.indexOf("#");
  if (index >= 0) {
    return href.slice(index);
  }
  // Bare "#/…" or "/…" forms used in tests.
  if (href.startsWith("#")) {
    return href;
  }
  return href.startsWith("/") ? `#${href}` : `#/${href}`;
}

function normalizePath(path: string): string {
  if (path === "" || path === "/") {
    return "/";
  }
  const withSlash = path.startsWith("/") ? path : `/${path}`;
  // Collapse duplicate leading slashes only; apps own the rest.
  return withSlash.replace(/^\/+/, "/");
}

function defaultLocationApi(): { getHash(): string; setHash(hash: string): void } {
  return {
    getHash: () => {
      if (typeof globalThis.location === "undefined") {
        return "#/";
      }
      return globalThis.location.hash || "#/";
    },
    setHash: (hash: string) => {
      if (typeof globalThis.location === "undefined") {
        return;
      }
      globalThis.location.hash = hash;
    },
  };
}

function defaultEventTarget(): EventTarget | null {
  if (typeof globalThis.window !== "undefined") {
    return globalThis.window;
  }
  return null;
}
