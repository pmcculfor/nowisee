import type { AppLocation } from "./types.ts";

/** First path segments the host owns. They are not app ids. */
export const HOST_PATH_SEGMENTS = ["api", "oauth", "admin", "assets"] as const;

export interface RouterOptions {
  readonly rootAppId: string;
  /**
   * True when this segment may be an app id. Defaults to {@link isAppId}.
   * Not a catalog — the server decides whether that id exists.
   * Tests may pass a smaller set. Corrupt / non-id paths still fall back to root.
   */
  readonly isKnownApp?: (appId: string) => boolean;
  /** Called when the browser path changes externally (Back/Forward, edited URL). */
  readonly onLocation: (location: AppLocation) => void;
  /**
   * Optional DOM wiring. Defaults to `window` / `location` / `history` when available.
   * Injected in tests.
   */
  readonly location?: {
    getPath(): string;
    pushPath(path: string): void;
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

export function isHostPathSegment(id: string): boolean {
  return (HOST_PATH_SEGMENTS as readonly string[]).includes(id);
}

/**
 * Syntactic app id: lowercase letter, then lowercase letters, digits, or hyphens,
 * and not a host-owned first segment. Router uses this so a well-formed `/some-app`
 * is parsed even if the client has never opened it. The server 404s unknown ids;
 * the client does not keep a catalog.
 */
export function isAppId(id: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(id) && !isHostPathSegment(id);
}

/**
 * Pure URL boundary: browser pathname ↔ AppLocation.
 * Owns no stack, cache, map, blocked flag, or display.
 * The only module that produces browser pathnames.
 */
export class Router {
  private readonly rootAppId: string;
  private readonly isKnownApp: (appId: string) => boolean;
  private readonly onLocation: (location: AppLocation) => void;
  private readonly locationApi: {
    getPath(): string;
    pushPath(path: string): void;
  };
  private readonly eventTarget: EventTarget | null;
  private readonly onPopState: () => void;
  private attached = false;

  constructor(options: RouterOptions) {
    this.rootAppId = options.rootAppId;
    this.isKnownApp = options.isKnownApp ?? isAppId;
    this.onLocation = options.onLocation;
    this.locationApi = options.location ?? defaultLocationApi();
    this.eventTarget = options.eventTarget ?? defaultEventTarget();
    this.onPopState = () => {
      this.onLocation(this.parse(this.locationApi.getPath()));
    };
  }

  /**
   * Parse a pathname or full href into an AppLocation.
   * Syntactically invalid ids and corrupt hrefs resolve to the root app (do not crash).
   * A well-formed id is kept even if this client has never opened that app.
   * Always returns a location — never null.
   */
  parse(href: string): AppLocation {
    const pathname = extractPath(href);
    if (pathname === "/") {
      return { appId: this.rootAppId, path: "/" };
    }

    const rest = pathname.slice(1);
    const slash = rest.indexOf("/");
    const appId = slash === -1 ? rest : rest.slice(0, slash);
    const pathRaw = slash === -1 ? "/" : rest.slice(slash);
    const path = pathFromHref(pathRaw);

    if (appId === this.rootAppId && path === "/") {
      return { appId: this.rootAppId, path: "/" };
    }

    if (!this.isKnownApp(appId)) {
      return { appId: this.rootAppId, path: "/" };
    }

    return { appId, path };
  }

  /** The only place in the codebase that produces a browser pathname. */
  hrefFor(location: AppLocation): string {
    if (!isCanonicalPath(location.path)) {
      throw new Error('Router.hrefFor: path must be non-empty and start with "/"');
    }
    if (location.appId === this.rootAppId && location.path === "/") {
      return "/";
    }
    if (location.path === "/") {
      return `/${location.appId}`;
    }
    return `/${location.appId}${location.path}`;
  }

  /**
   * Write the address bar. `history.pushState` does not fire `popstate`,
   * so this does not re-enter openLocation.
   */
  setAddressBar(location: AppLocation): void {
    const nextPath = this.hrefFor(location);
    if (this.locationApi.getPath() === nextPath) {
      return;
    }
    this.locationApi.pushPath(nextPath);
  }

  attach(): void {
    if (this.attached || !this.eventTarget) {
      return;
    }
    this.eventTarget.addEventListener("popstate", this.onPopState);
    this.attached = true;
  }

  detach(): void {
    if (!this.attached || !this.eventTarget) {
      return;
    }
    this.eventTarget.removeEventListener("popstate", this.onPopState);
    this.attached = false;
  }
}

function extractPath(href: string): string {
  const trimmed = href.trim();
  if (trimmed === "") {
    return "/";
  }
  try {
    if (/^[a-zA-Z][a-zA-Z+.-]*:/.test(trimmed)) {
      const pathname = new URL(trimmed).pathname;
      return pathname === "" ? "/" : pathname;
    }
  } catch {
    return "/";
  }
  const beforeQuery = trimmed.split("?")[0] ?? "";
  const beforeHash = beforeQuery.split("#")[0] ?? "";
  if (beforeHash.startsWith("/")) {
    return beforeHash;
  }
  return "/";
}

/** Href recovery only — empty or unslashed segments become a canonical path. */
function pathFromHref(pathRaw: string): string {
  if (pathRaw === "" || pathRaw === "/") {
    return "/";
  }
  const withSlash = pathRaw.startsWith("/") ? pathRaw : `/${pathRaw}`;
  return withSlash.replace(/^\/+/, "/");
}

function defaultLocationApi(): { getPath(): string; pushPath(path: string): void } {
  return {
    getPath: () => {
      if (typeof globalThis.location === "undefined") {
        return "/";
      }
      return globalThis.location.pathname || "/";
    },
    pushPath: (path: string) => {
      if (typeof globalThis.history === "undefined") {
        return;
      }
      globalThis.history.pushState(null, "", path);
    },
  };
}

function defaultEventTarget(): EventTarget | null {
  if (typeof globalThis.window !== "undefined") {
    return globalThis.window;
  }
  return null;
}
