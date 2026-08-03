# Nowisee — architecture contracts

Precise interfaces for the MVP and beyond. Behavior locks: [`SPEC.md`](SPEC.md). Module responsibilities: [`MODULES.md`](MODULES.md). Do not put product names in core types.

---

## Types (`src/core/types.ts`)

```ts
/** Arrow keys and named chords used as navigation-map keys. */
export type NavKey =
  | "up"
  | "down"
  | "left"
  | "right"
  | "ctrl+left"
  | "ctrl+right"
  | (string & {}); // apps may add chords; core normalizes a small built-in set

export type StackBehavior = "push" | "replace" | "pop";

export type NodeKind = "text" | "input";

/** Opaque to core beyond id, label, kind. Apps may stash private fields in data. */
export interface NodePayload {
  id: string;
  label: string;
  kind?: NodeKind; // default "text"
  /** App-private optional data; core ignores. */
  data?: unknown;
}

export type NavEdge =
  | {
      kind: "node";
      /** Required for push/replace. Omit when stackBehavior is "pop". */
      toNodeId?: string;
      stackBehavior: StackBehavior;
      /** When true and tip is input, core passes input box text into refresh extras. */
      passInputText?: boolean;
    }
  | {
      kind: "url";
      url: string;
      passInputText?: boolean;
    };

/**
 * Navigation map: edges from a node for a given key.
 * Key format: `${fromNodeId}::${navKey}` or nested map — implementation choice;
 * semantically (fromNodeId, navKey) → NavEdge.
 */
export type NavigationMap = Map<string, NavEdge> | Record<string, NavEdge>;

export interface StackEntry {
  nodeId: string;
  label: string;
  /** Last non-null share URL associated while this entry was tip, if any. */
  shareUrl: string | null;
}

export interface RefreshExtras {
  /** Present when the triggering edge had passInputText and tip was input. */
  inputText?: string;
  /**
   * Reserved extension seam for shared login / platform services.
   * Empty / undefined in MVP.
   */
  platform?: Record<string, unknown>;
}

export interface RefreshResult {
  /** Full replace of the client's navigation map. */
  navigationMap: NavigationMap;
  /** Full replace of warm set (core still pins stack entry payloads). */
  warm: NodePayload[];
  /**
   * Tip payload after refresh (authoritative).
   * May correct a stale tip within no-teleport rules (same conceptual place / fallback).
   */
  node: NodePayload;
  /**
   * Canonical share URL for the tip, or null/undefined to keep the previous address-bar URL.
   */
  url?: string | null;
}

export interface AppModule {
  id: string;
  label: string;
  /**
   * Resolve a URL path owned by this app and return an initial refresh
   * (stack will be reset by core before/as part of open).
   * `path` is the app-local portion after `#/a/<appId>` (or home's path convention).
   */
  open(path: string, extras?: RefreshExtras): Promise<RefreshResult> | RefreshResult;
  /**
   * Revalidate current stack tip; return map + warm + tip + url.
   * Perform side effects when tip is an action/status node.
   */
  refresh(
    stack: readonly StackEntry[],
    extras?: RefreshExtras,
  ): Promise<RefreshResult> | RefreshResult;
}
```

---

## Packaging

| Path (proposed) | Contents |
|-----------------|----------|
| `src/core/` | Types, router, navigator, stack, navigation-map store, NodeCache, display, keyboard, registry, busy |
| `src/app-kit/` | Optional helpers (edge builders, list edges, input chords, neighborhood walk, home URL helper) |
| `src/apps/` | `home`, `bible`, `mail` (and later `notes`) as `AppModule`s |
| `src/shell/` | Bootstrap: register apps, mount display, wire keyboard |

**Smell test:** If a third-party app can work with only `open`/`refresh`, a helper belongs in app-kit or the app—not in core. If every session would break unless Navigator runs it, it belongs in core.

---

## Core module contracts (summary)

See [`MODULES.md`](MODULES.md) for full behavior. Summary:

### Router

- Parse location hash: `#/` or home convention → Home app; `#/a/<appId>/...` → that app.
- `open(url)`: determine appId; if app changes (or always on open): **clear stack**; set current app; call `app.open(path)`; apply `RefreshResult`; block until complete.
- Unknown appId / corrupt URL: open Home (or Home with an error text node)—do not crash.

### Navigator

1. Own per-app **stack** of `StackEntry`.
2. On nav key (when not blocked; and when tip is not input, or key is a mapped chord): lookup `(currentNodeId, key)` in navigation map.
3. Missing → silent no-op.
4. `kind: "url"` → `router.open` (with optional `passInputText` extras).
5. `kind: "node"`:
   - `push`: push `toNodeId`
   - `replace`: replace tip with `toNodeId`
   - `pop`: pop; destination = new tip; **ignore any toNodeId**
6. If destination payload in warm (or pinned stack): display immediately; start `refresh`.
7. Else: block until `refresh` returns; then display.
8. Apply refresh: replace map; replace warm (re-pin stack); set tip from `result.node`; update address bar from `result.url` rules.
9. Ignore completing refresh if tip id ≠ tip id when that refresh started.
10. On refresh failure: keep display; clear block/busy.

### NodeCache

- Key by `nodeId` within current app scope (app switch clears or namespaces cache).
- `merge`/`replace` from refresh warm; `get`; pin stack ids.
- Defensive max size allowed; never invents network fetches.

### Display

- Text node: show `label` in one focusable live region.
- Input node: show one input box (same single-surface rule); seed from `label` or app `data` as the app defines.
- `aria-live`: assertive by default; may switch to polite after SR testing.

### Keyboard

- Tip `text`: arrows/chords → navigator (preventDefault on handled keys).
- Tip `input`: plain arrows move caret; mapped chords → navigator; **Escape is not** a platform exit.
- While blocked: ignore nav keys/chords.

### AppRegistry

- `register` / `get` / `listEnabled`.
- Home app uses `listEnabled()` for labels + URL edges (not node ids of other apps).

---

## URL conventions (MVP)

- Hash router: Home at `#/` (or `#/a/home`—pick one in scaffold and keep stable).
- Other apps: `#/a/<appId>/...` with app-owned remainder.
- Bible example: `#/a/bible/kjv/Matthew/5/8` (exact shape is Bible’s choice).
- Mail: `#/a/mail/...` as mail defines.
- Status tips often return `url: null` so the address bar stays on the prior shareable node.

---

## AppModule MUST / SHOULD

### MUST

1. Implement `open` and `refresh` returning a usable `node`, `navigationMap`, and `warm` array (possibly empty warm).
2. Publish a **Left** edge from the app’s root experience as `kind: "url"` to Home.
3. On `pop` edges, omit `toNodeId`.
4. Not embed foreign apps’ node ids in the navigation map (use URLs).
5. Not silently rewrite the stack to teleport the user after a workflow.
6. Not throw through to freeze core busy state—prefer status text on failure; if a promise rejects, core recovers, but apps SHOULD resolve with error text instead.
7. Treat stack tip as possibly stale; return a valid fallback `node` when needed (repair, not teleport).

### SHOULD

1. Prefetch likely neighbors via map edges + warm.
2. Use app-kit helpers instead of copying edge boilerplate.
3. Prefer Ctrl+Right / Ctrl+Left on input nodes; set `passInputText` on commit edges.
4. Put instruction text on a normal node before an input node.
5. For actions: dedicated status node; in-place “Sending…” → “Sent”/error; explicit leave edges.
6. Return stable canonical URLs for bookmarkable tips.
7. Choose list-end behavior deliberately (wrap is optional).

---

## Testing contracts

Unit-test without DOM where possible:

- Map lookup; push/replace/pop; pop omits toNodeId; url edge clears stack and switches app.
- Warm hit vs warm miss (block); stale refresh ignored; refresh failure clears busy.
- `passInputText` included only when flag set from input tip.
- Home lists apps by URL; app root Left opens Home.
- App refresh: wrap-or-not is app-defined; action tip updates label in place without stack jump.
