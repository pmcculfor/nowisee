import type { AppLocation } from "./types.ts";

export interface RouterOptions {
  readonly rootAppId: string;
  /**
   * True when this segment may be an app id. Defaults to {@link isAppId}.
   * Not a catalog — the server decides whether that id exists.
   * Tests may pass a smaller set. Corrupt / non-id hashes still fall back to root.
   */
  readonly isKnownApp?: (appId: string) => boolean;
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
 * An app-owned path: non-empty, starts with `/`.
 * Raw href recovery lives in `parse`; AppLocation values must already be canonical.
 */
export function isCanonicalPath(path: string): boolean {
  return path.startsWith("/");
}

/**
 * Syntactic app id: lowercase letter, then lowercase letters, digits, or hyphens.
 * Router uses this so a well-formed `#/some-app` is parsed even if the client
 * has never opened it. The server 404s unknown ids; the client does not keep a catalog.
 */
export function isAppId(id: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(id);
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
    this.isKnownApp = options.isKnownApp ?? isAppId;
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
   * Syntactically invalid ids and corrupt hashes resolve to the root app (do not crash).
   * A well-formed id is kept even if this client has never opened that app.
   * Always returns a location — never null.
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
    const slash = rest.indexOf("/");
    const appId = slash === -1 ? rest : rest.slice(0, slash);
    const pathRaw = slash === -1 ? "/" : rest.slice(slash);
    const path = pathFromHash(pathRaw);

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
    if (!isCanonicalPath(location.path)) {
      throw new Error('Router.hrefFor: path must be non-empty and start with "/"');
    }
    if (location.appId === this.rootAppId && location.path === "/") {
      return "#/";
    }
    if (location.path === "/") {
      return `#/${location.appId}`;
    }
    return `#/${location.appId}${location.path}`;
  }

  /**
   * Write the address bar without re-entering openLocation via hashchange.
   */
  setAddressBar(location: AppLocation): void {
    const nextHash = this.hrefFor(location);
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
  // Bare path forms used in tests ("/…" or "app/…").
  return href.startsWith("/") ? `#${href}` : `#/${href}`;
}

/** Href recovery only — empty or unslashed segments become a canonical path. */
function pathFromHash(pathRaw: string): string {
  if (pathRaw === "" || pathRaw === "/") {
    return "/";
  }
  const withSlash = pathRaw.startsWith("/") ? pathRaw : `/${pathRaw}`;
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
