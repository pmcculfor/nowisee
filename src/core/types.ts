/**
 * Shared TypeScript contracts for Nowisee core.
 * Canonical definitions also live in docs/ARCHITECTURE.md — keep them in sync.
 */

/**
 * Navigation intents. Apps author edges keyed by intent, never by keystroke.
 * Core's Keyboard module owns the physical binding table (MODULES §9), so input
 * devices, remapping, touch gestures, and RTL never reach app data.
 */
export type NavIntent =
  | "prev" // previous sibling
  | "next" // next sibling
  | "enter" // descend / follow / commit from an input node
  | "back" // ascend / return / abandon from an input node
  | (string & {}); // apps may define extra symbolic intents; delivered only if bound

export type StackBehavior = "push" | "replace" | "pop";

export type NodeKind = "text" | "input";

/** HTML autocomplete tokens Display may set on an input node. */
export type InputAutocomplete = "off" | "username" | "current-password" | "new-password";

/** Plain data — anything that survives being sent as a message. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** Opaque to core beyond id, label, kind, and input flags. Apps may stash private fields in data. */
export interface NodePayload {
  id: string;
  label: string;
  kind?: NodeKind; // default "text"
  /**
   * When kind is "input": mask typed characters (`<input type="password">`).
   * Not a separate NodeKind — unknown kinds would otherwise collide with
   * the unresolved forward-compat question.
   */
  secret?: boolean;
  /** When kind is "input": HTML autocomplete token. Default "off". */
  autocomplete?: InputAutocomplete;
  /** App-private optional data; core ignores it but requires it to be plain data. */
  data?: JsonValue;
}

/**
 * An address inside Nowisee. Core owns how this becomes a browser URL
 * (Router.hrefFor); apps never build `#/...` strings.
 */
export interface AppLocation {
  readonly appId: string;
  /** App-owned remainder, normalized to start with "/" (e.g. "/kjv/Matthew/5/8"). */
  readonly path: string;
}

export type NavEdge =
  | {
      kind: "node";
      /** Required for push/replace. Omit when stackBehavior is "pop". */
      toNodeId?: string;
      stackBehavior: StackBehavior;
      /** When true and tip is input, core passes input box text into refresh extras. */
      passInputText?: boolean;
      /** Marks this traversal as a deliberate trigger; see ARCHITECTURE "Action edges". */
      action?: boolean;
    }
  | {
      kind: "app";
      /** Another location inside Nowisee (same app or another app). */
      to: AppLocation;
      passInputText?: boolean;
      action?: boolean;
    }
  | {
      kind: "external";
      /** Leaves Nowisee entirely. Core does not manage what happens next. */
      href: string;
    };

/**
 * Navigation map: nested so no delimiter can collide with app-owned node ids.
 * Semantically (fromNodeId, intent) → NavEdge.
 */
export type NavigationMap = Readonly<
  Record<string /* fromNodeId */, Readonly<Record<string /* NavIntent */, NavEdge>>>
>;

export interface StackEntry {
  nodeId: string;
  label: string;
  /** Last non-null location associated while this entry was tip, if any. */
  location: AppLocation | null;
}

export interface RefreshExtras {
  /** Present when the triggering edge had passInputText and tip was input. */
  inputText?: string;
  /**
   * True only on the single call caused by traversing an edge with `action: true`.
   * Absent on bootstrap, revalidation, and every other call. Apps perform side
   * effects only when this is true.
   */
  action?: boolean;
  /**
   * Aborted when a read-only call is superseded by a newer transition.
   * Core never aborts an action call.
   */
  signal?: AbortSignal;
}

/**
 * The only sanctioned channel for effects an app cannot perform itself.
 * Every member is optional: apps must feature-detect, because a given host
 * (or a future sandboxed host) may not offer all of them.
 */
export interface PlatformContext {
  /**
   * Copy text to the clipboard. Only meaningful during an action call —
   * browsers only permit a clipboard write while the user's keypress is
   * still fresh, and core is the only party holding that. See MODULES §10.
   */
  readonly clipboard?: {
    writeText(text: string): Promise<void>;
  };
  /** Screen-reader-only status text. Does not move the tip. Not provided in MVP. */
  readonly announce?: (text: string) => void;
  /** Ask core for a read-only refresh of the current tip. Not provided in MVP. */
  readonly requestRefresh?: () => void;
}

/** What the registry exposes about an app. Plain data, not the module. */
export interface AppDescriptor {
  readonly id: string;
  readonly label: string;
}

/**
 * Host-owned directory of installed apps as descriptors, never modules.
 * Granted only to apps the catalog marks (today: Home). Feature-detect.
 */
export interface DirectoryCapability {
  list(): readonly AppDescriptor[];
}

export interface RefreshResult {
  /** Full replace of the client's navigation map. */
  navigationMap: NavigationMap;
  /** Full replace of warm set (core still pins stack entry payloads). */
  warm: NodePayload[];
  /**
   * Tip payload after refresh (authoritative).
   * May correct a stale tip within no-teleport rules (same conceptual place / fallback).
   * Core adopts `node.id` as the new tip id.
   */
  node: NodePayload;
  /**
   * Canonical location for the tip, or null to keep the previous address bar.
   * Required — omit is not the same as null.
   */
  location: AppLocation | null;
  /**
   * Text the client should copy during an action traversal.
   * Apps return this string; they never write the clipboard themselves.
   * Core copies it (or reports failure on the status label).
   */
  clipboardText?: string;
}

/**
 * Structured outcome from the host identity capability.
 * The Account app owns the words the user hears; this type never carries prose.
 */
export type AuthOutcome =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid-credentials" | "email-taken" | "weak-password" | "registration-closed" };

/**
 * Host-granted capability to establish and end a Nowisee session.
 * Only apps the host allows receive this (today: Account). Never present in the browser.
 */
export interface IdentityCapability {
  register(email: string, password: string): Promise<AuthOutcome>;
  signIn(email: string, password: string): Promise<AuthOutcome>;
  signOut(): Promise<void>;
}

/**
 * Host-granted encrypted blob store. Bound to (userId, appId); the app cannot
 * name another user or app. Never present in the browser. Blobs must not be
 * copied onto RefreshResult.
 */
export interface LockboxCapability {
  get(slot: string): Promise<Uint8Array | null>;
  put(slot: string, plaintext: Uint8Array): Promise<void>;
  delete(slot: string): Promise<void>;
}

export type OAuthConnectionStatus = "missing" | "ready" | "needs-reconnect";

/**
 * Host-granted OAuth 2 authorization-code helper. Bound to (userId, appId).
 * Access tokens stay in process memory — never in labels, node ids, paths, or clipboardText.
 */
export interface OAuthCapability {
  start(opts: { slot: string; returnPath?: string }): Promise<{ authorizeUrl: string }>;
  status(slot: string): Promise<OAuthConnectionStatus>;
  getAccessToken(slot: string): Promise<string>;
  disconnect(slot: string): Promise<void>;
}

/**
 * Server-only argument to `open` / `refresh`. Never serialized to the browser.
 * Optional in the type: in-process tests pass nothing; apps that do not care never look.
 * `userId` comes only from the identity service resolving the session cookie.
 */
export interface AppServerContext {
  readonly userId: string | null;
  /** This browser, signed in or not. Server-side only — never in a node id, label, or URL. */
  readonly sessionId: string;
  /** Host config, so no app hardcodes a peer app's id when it offers a "sign in" edge. */
  readonly accountAppId: string;
  /** Present only for apps the host allows. Feature-detect. */
  readonly identity?: IdentityCapability;
  /** Present only for apps the host allows. Feature-detect. */
  readonly lockbox?: LockboxCapability;
  /** Present only for apps the host allows. Feature-detect. */
  readonly oauth?: OAuthCapability;
  /** Present only for apps the host allows. Feature-detect. */
  readonly directory?: DirectoryCapability;
}

export interface AppModule {
  id: string;
  label: string;
  /**
   * Resolve an app-local path and return an initial refresh
   * (stack is reset by core as part of open).
   * `path` is `AppLocation.path` — the portion this app owns.
   * `ctx` is server-only and omitted in the browser.
   */
  open(
    path: string,
    extras?: RefreshExtras,
    ctx?: AppServerContext,
  ): Promise<RefreshResult> | RefreshResult;
  /**
   * Revalidate current stack tip; return map + warm + tip + location.
   * Perform side effects only when `extras.action` is true.
   * `ctx` is server-only and omitted in the browser.
   */
  refresh(
    stack: readonly StackEntry[],
    extras?: RefreshExtras,
    ctx?: AppServerContext,
  ): Promise<RefreshResult> | RefreshResult;
}

/**
 * Bootstrap supplies this. Core files never name a product app.
 */
export interface ShellConfig {
  /** App used for the empty path and for recovery. No core file names it. */
  readonly rootAppId: string;
  readonly keyBindings?: readonly KeyBinding[];
}

export interface KeyBinding {
  readonly intent: NavIntent;
  readonly key: string; // KeyboardEvent.key
  readonly mods?: {
    ctrl?: boolean;
    alt?: boolean;
    shift?: boolean;
    meta?: boolean;
  };
  /** Omit = both tip kinds. */
  readonly whenTip?: NodeKind;
}
