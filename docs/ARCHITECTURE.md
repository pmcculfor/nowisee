# Nowisee — architecture contracts

Precise interfaces for the MVP and beyond. Behavior locks: [`SPEC.md`](SPEC.md). Module responsibilities: [`MODULES.md`](MODULES.md). Review history and open items: [`DESIGN-REVIEW.md`](DESIGN-REVIEW.md). Do not put product names in core types.

---

## Types (`src/core/types.ts`)

```ts
/**
 * Navigation intents. Apps author edges keyed by intent, never by keystroke.
 * Core's Keyboard module owns the physical binding table (MODULES §9), so input
 * devices, remapping, touch gestures, and RTL never reach app data.
 */
export type NavIntent =
  | "prev"   // previous sibling
  | "next"   // next sibling
  | "enter"  // descend / follow / commit from an input node
  | "back"   // ascend / return / abandon from an input node
  | (string & {}); // apps may define extra symbolic intents; delivered only if bound

export type StackBehavior = "push" | "replace" | "pop";

export type NodeKind = "text" | "input";

/** Plain data — anything that survives being sent as a message. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** Opaque to core beyond id, label, kind. Apps may stash private fields in data. */
export interface NodePayload {
  id: string;
  label: string;
  kind?: NodeKind; // default "text"
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
      /** Marks this traversal as a deliberate trigger; see "Action edges" below. */
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
  /** Browser and platform operations an app may not perform itself. */
  platform?: PlatformContext;
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
  /** Per-app namespaced durable storage. Not provided in MVP. */
  readonly storage?: {
    get(key: string): Promise<JsonValue | null>;
    set(key: string, value: JsonValue): Promise<void>;
    remove(key: string): Promise<void>;
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
   * Canonical location for the tip, or null/undefined to keep the previous address bar.
   */
  location?: AppLocation | null;
}

export interface AppModule {
  id: string;
  label: string;
  /**
   * Resolve an app-local path and return an initial refresh
   * (stack is reset by core as part of open).
   * `path` is `AppLocation.path` — the portion this app owns.
   */
  open(path: string, extras?: RefreshExtras): Promise<RefreshResult> | RefreshResult;
  /**
   * Revalidate current stack tip; return map + warm + tip + location.
   * Perform side effects only when `extras.action` is true.
   */
  refresh(
    stack: readonly StackEntry[],
    extras?: RefreshExtras,
  ): Promise<RefreshResult> | RefreshResult;
}
```

---

## Action edges

Side effects are still ordinary navigation — there is no `activate()` and no separate action edge *kind*. What changed is that the app marks the **edge** that constitutes the button press, and core reports that one traversal back to the app.

| Rule | Owner |
|------|-------|
| Mark the deliberate trigger with `action: true` on the edge | App |
| Set `extras.action = true` on exactly the call caused by traversing that edge | Core |
| Never set `extras.action` on bootstrap, revalidation, retry, replay, or any other call | Core |
| Never re-issue, retry, or abort an action call | Core |
| Never coalesce or drop an action call (read-only revalidations may be coalesced) | Core |
| Perform side effects only when `extras.action` is true; otherwise read-only | App |
| Resolve with a status node on failure rather than rejecting | App |

**Why this is enough.** Sibling browsing uses `prev` / `next` edges, which carry no flag, so passing over an option node cannot fire it. Background revalidation carries no flag, so a warm-hit refresh cannot repeat a send. Returning to a status node later carries no flag, so the effect does not replay. The intended shape stays exactly as authored:

```text
"Copy"  --enter (action: true)-->  "Copying…"  (warm, shown immediately)
                                        │
                                        └── refresh(extras.action = true) → "Copied"
```

Rapid double-press is naturally safe: after the local move the tip is the status node, and the trigger edge belonged to the previous node. Status tips should return `location: null` so a reload does not land the user back on the action node.

---

## App boundary: data in, data out

`open` and `refresh` are a **message protocol that currently happens to run in-process**. Preserving that property is what makes it possible to later run an app in a Worker, an iframe, or on a server without changing the contract — which is the only realistic way to run apps we did not write.

| Crossing the boundary | Rule |
|-----------------------|------|
| `stack`, `inputText`, `NodePayload`, `NavigationMap`, `RefreshResult`, `AppLocation` | **Plain data only.** Must survive being serialized and sent as a message. No functions, class instances, DOM nodes, or live references. |
| `PlatformContext`, `AbortSignal` | Call mechanics, not payload. These are the sanctioned non-data members, and each has a message-based equivalent (an RPC proxy, and an abort message) when a sandbox arrives. |
| Anything else | Not permitted. Core hands apps no other live object; apps return no other live object. |

Consequences, all normative:

- Apps do not touch browser APIs that core can mediate. Clipboard goes through `platform.clipboard`; durable storage will go through `platform.storage`. An app reaching for `navigator.clipboard` or `localStorage` directly is a bug even though nothing stops it today.
- The registry hands Home `AppDescriptor[]`, never the `AppRegistry` object.
- `NodePayload.data` is typed as `JsonValue` so the compiler catches accidents rather than a sandbox migration years later.

This is a discipline, not a sandbox. Nothing here builds isolation; it only avoids foreclosing it.

---

## Packaging

| Path (proposed) | Contents |
|-----------------|----------|
| `src/core/` | Types, router, navigator, stack, navigation-map store, NodeCache, display, keyboard, registry, platform capabilities, busy |
| `src/app-kit/` | Optional helpers (edge builders, list edges, input edges, neighborhood walk) |
| `src/apps/` | `home`, `bible`, `mail` (and later `notes`) as `AppModule`s |
| `src/shell/` | Bootstrap: config, register apps, mount display, wire keyboard |

**Smell test:** If a third-party app can work with only `open`/`refresh`, a helper belongs in app-kit or the app—not in core. If every session would break unless Navigator runs it, it belongs in core.

---

## Core module contracts (summary)

See [`MODULES.md`](MODULES.md) for full behavior. Summary:

### Shell config

Core has no product constants. Bootstrap supplies:

```ts
export interface ShellConfig {
  /** App used for the empty path and for recovery. No core file names it. */
  readonly rootAppId: string;
  readonly keyBindings?: readonly KeyBinding[]; // defaults in MODULES §9
}
```

### Router (pure boundary)

- `parse(href) → AppLocation | null` — `#/` → `{ rootAppId, "/" }`; `#/<appId>/rest` → `{ appId, "/rest" }`.
- `hrefFor(location) → string` — the only place a `#/...` string is produced.
- Listens for `hashchange` and forwards the parsed location to Navigator.
- Unknown appId / corrupt href: resolve to the root app; do not crash.
- Does **not** own stack, cache, map, busy, or the display.

### Navigator (single owner of state transitions)

1. Own per-app **stack**, **blocked** (intents ignored while true; “busy” in older wording means the same flag), and a monotonic transition token.
2. `onIntent(intent)`: look up `(tipId, intent)`; missing → silent no-op.
3. `openLocation(location, extras)`: clear stack, clear cache/map, set current app, call `app.open(path)`, apply.
4. `kind: "app"` edge → `openLocation`. `kind: "external"` → hand the href to the browser.
5. `kind: "node"`:
   - `push`: push `toNodeId`
   - `replace`: replace tip with `toNodeId`
   - `pop`: pop; destination = new tip; **ignore any toNodeId**
6. If destination payload in warm (or pinned stack): display immediately; start `refresh`.
7. Else: block until `refresh` returns; then display.
8. Apply: replace map; replace warm (re-pin stack); set tip from `result.node` (**including its id**); set address bar from `result.location` rules.
9. Every transition increments the token. A result is applied only if its token is the newest issued — tip-id comparison is not sufficient.
10. On refresh failure: keep display; clear block/busy.

### NodeCache

- Key by `nodeId` within current app scope; app switch clears the cache.
- `replace` from refresh warm; `get`; pin stack ids.
- Defensive max size allowed; never invents network fetches.

### Display

- Text node: show `label` in one focusable live region.
- Input node: show one input box (same single-surface rule); seed from `label` or app `data` as the app defines.
- `aria-live`: assertive by default; revisit in the accessibility pass.

### Keyboard

- Owns the physical → intent binding table; resolves `(event, tipKind) → NavIntent | none`.
- Unbound key: no call to Navigator, no `preventDefault`.
- Plain arrows on an input tip are not bound, so the caret keeps them.
- While blocked: ignore intents.
- Escape is **not** a platform exit.

### AppRegistry

- `register` / `get(id) → AppModule | null` (core-internal) / `listEnabled() → AppDescriptor[]` (app-facing).
- Home app uses `listEnabled()` for labels + `app` edges (not node ids of other apps, and not the registry object).

### Platform capabilities

- Builds the `PlatformContext` core passes on every `open` / `refresh`.
- Owns the browser-side mechanics apps must not perform themselves — in MVP, the clipboard and its user-activation problem (MODULES §10).
- Offers a capability only when the host can actually honour it, so feature detection means something.

---

## Addressing conventions (MVP)

- Apps address `AppLocation`; core serializes. Hash routes today (`#/…`) because static hosting needs no rewrites; switching to History API paths later touches Router only.
- Root app at `#/` (canonical); `#/<rootAppId>` may alias.
- Other apps: `#/<appId>/...` with app-owned remainder.
- Bible example: `{ appId: "bible", path: "/kjv/Matthew/5/8" }` (path shape is Bible's choice).
- Status tips often return `location: null` so the address bar stays on the prior shareable node.

---

## AppModule MUST / SHOULD

### MUST

1. Implement `open` and `refresh` returning a usable `node`, `navigationMap`, and `warm` array (possibly empty warm).
2. Publish a **`back`** edge from the app's root experience as `kind: "app"` to the root app.
3. On `pop` edges, omit `toNodeId`.
4. Not embed foreign apps' node ids in the navigation map (use `app` edges).
5. Not silently rewrite the stack to teleport the user after a workflow.
6. Perform side effects only when `extras.action` is true.
7. Not throw through to freeze core busy state—prefer status text on failure. This matters most for action calls, where a rejection strands the user on "Sending…".
8. Treat stack tip as possibly stale; return a valid fallback `node` when needed (repair, not teleport).
9. Author edges by intent only; never assume a keystroke.
10. Return plain data only — nothing that would fail to survive being sent as a message.
11. Use `extras.platform` for browser operations core can mediate; never reach for `navigator.clipboard`, `localStorage`, or the DOM directly.
12. Feature-detect every platform capability before calling it.

### SHOULD

1. Prefetch likely neighbors via map edges + warm.
2. Use app-kit helpers instead of copying edge boilerplate.
3. Put the effectful transition on an `enter` edge with `action: true`, landing on a status node.
4. Put instruction text on a normal node before an input node.
5. Return `location: null` for status tips that should not change the address bar.
6. Return stable canonical locations for bookmarkable tips.
7. Choose list-end behavior deliberately (wrap is optional).
8. Set `passInputText` on the commit edge leaving an input node.

---

## Testing contracts

Unit-test without DOM where possible:

- Map lookup; push/replace/pop; pop omits toNodeId; `app` edge clears stack and switches app.
- Warm hit vs warm miss (block); refresh failure clears busy.
- Transition token: an A → B → A sequence discards the first A's in-flight result.
- A superseded read-only call receives an aborted signal; an action call never does.
- `extras.action` is set on exactly the traversal of an `action: true` edge, and on no other call — including the revalidation that follows a warm hit, and re-entry to the same node later.
- Walking the full sibling option list past an effectful node performs no effect.
- `passInputText` included only when flag set from input tip.
- Home lists apps as `app` edges; app root `back` opens the root app.
- Rebinding the keyboard table changes behavior with zero app changes.
- `Router.hrefFor(Router.parse(href))` round-trips; no other module emits a `#` string.
- Every `RefreshResult` an MVP app returns survives a `structuredClone` round-trip.
- An app calling a platform capability the host did not provide fails gracefully (status text, not a crash).
- `listEnabled()` returns descriptors; the registry object is not reachable from any app.
- App refresh: wrap-or-not is app-defined; action tip updates label in place without stack jump.
