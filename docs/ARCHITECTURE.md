# Nowisee — architecture contracts

Precise interfaces for the MVP. Behavior locks: [`SPEC.md`](SPEC.md). Do not put product names in core types.

---

## Types (`src/core/types.ts`)

```ts
export type NavAction =
  | { type: "up" }
  | { type: "down" }
  | { type: "left" }
  | { type: "right" }
  | { type: "open"; url: string }
  | { type: "enter" }; // cold start / enter app root

export type InputMode = "nav" | "input";

/** Opaque to core beyond id + label. Apps may stash private fields. */
export interface NodePayload {
  id: string;
  label: string;
  /** App-private optional data; core ignores. */
  data?: unknown;
}

export interface NodeBundle {
  node: NodePayload;
  /** Extra nodes to merge into NodeCache. App chooses exact set. */
  warm?: NodePayload[];
  /**
   * Canonical share URL for this node, or null/undefined if ephemeral.
   * When omitted/null, core keeps the previous share URL in the address bar.
   */
  url?: string | null;
  /** Request Input mode (compose, etc.). Default stays Nav. */
  mode?: InputMode;
  /** When true, treat as no-op for stack (stay); used for silent dead-ends. */
  noop?: boolean;
}

export interface NavigateContext {
  /** Current node id if known; may be stale. */
  currentId: string | null;
  /** App id that owns the current graph segment, or null on shell home. */
  appId: string | null;
}

export interface AppModule {
  id: string;
  label: string;
  navigate(action: NavAction, ctx: NavigateContext): Promise<NodeBundle> | NodeBundle;
}

export interface StackEntry {
  appId: string | null; // null = shell home
  nodeId: string;
  label: string;
  /** Last non-ephemeral share URL for this entry, if any. */
  shareUrl: string | null;
}
```

---

## Core modules

### Display

- Single focusable element showing `label`.
- `aria-live="assertive"` (or polite if SR testing prefers) on updates.
- Focus on load; no competing interactive chrome in the reading path.

### ModeController

- `nav` | `input`.
- Escape in `input` → `nav` (and notify shell to restore nav keyboard).
- Apps request `input` via `NodeBundle.mode`.

### NodeCache

- Key: `${appId}::${nodeId}` (shell home uses `appId = ""` or `"shell"`).
- `merge(appId, bundle)` stores `node` + each `warm` entry.
- `get(appId, nodeId)`.
- Core never invents ids to fetch.

### AppRegistry

- `register(app)`, `get(id)`, `listEnabled()`.
- Home labels come only from the registry.

### Navigator

Responsibilities:

1. Own the **history stack** of `StackEntry`.
2. On arrow keys in nav mode, build `NavAction` and resolve next UI state.
3. **Stack rules:**
   - `right` (and successful enter into content): **push**
   - `up` / `down`: **replace** top
   - `left`: **pop**; if stack would be empty / single root left-at-bottom → **homepage**
   - `open(url)`: reset stack per resolution
4. Call `app.navigate(action, ctx)` for moves inside an app (and for `open`).
5. Shell home is core-owned list of enabled apps (not an AppModule product name). Entering an app: `right` on an app label → that app’s `navigate({ type: "enter" }, …)`.
6. Merge every returned bundle into `NodeCache`.
7. Update Display from the resulting current label.
8. Address bar: if `bundle.url` is a non-empty string, set share URL; if null/omitted, **keep** previous share URL.
9. While a navigate is in flight (blocking), **ignore** further nav keys.
10. `noop: true` → do not change stack or display (silent dead-end).

**Left at homepage:** already home → silent no-op.

**App switch on home:** up/down replace among app labels; right enters selected app (push).

### Keyboard

- Nav mode: ArrowUp/Down/Left/Right → navigator; preventDefault.
- Input mode: arrows are normal text; Escape → nav mode.
- Ignore nav keys while `navigator.isBusy`.

---

## Shell home

Not a product app. Core presents enabled `AppModule.label` values as siblings plus a Help entry if registered. First focus: first enabled app.

Suggested home node ids: `shell:app:<appId>`, `shell:help`.

---

## URL conventions (MVP)

- Hash router: `#/` = home; `#/a/<appId>/...` paths owned by each app.
- `Open` passes the hash path (without `#`) or full hash; app canonicalizes.
- Bible example canonical: `#/a/bible/kjv/Matthew/5/8` (exact shape is the Bible app’s choice).
- Demo mail: `#/a/mail/...` as the mail app defines.
- Ephemeral (copy confirmation): `url: null` → address bar unchanged.

---

## App responsibilities

### Bible (`id: "bible"`)

- KJV data private to the app.
- Graph: Testament → book → chapter → verse → options (Copy, Commentary stub).
- Wrap siblings; silent no-op on dead-end right.
- On Copy via Right: perform clipboard write; return ephemeral confirmation node (or return to verse — app chooses; MVP: short “Copied” then user Lefts back, or app returns verse — prefer confirmation node with `url: null`).
- Push useful `warm` neighbors per level (e.g. nearby books/chapters/verses) without core policy.

### Mail demo (`id: "mail"`)

- In-memory sample messages.
- Inbox / Compose / message body / stubs.
- Compose body may set `mode: "input"`.
- No network.

### Help (optional small module or shell nodes)

- In-tree keyboard map text.

---

## Testing contracts

Unit-test without DOM where possible:

- Stack push/replace/pop and left-to-home.
- Busy flag ignores actions.
- URL retention on ephemeral bundles.
- Bible/mail `navigate` wrap and dead-end silent stay (`noop` or same id).
