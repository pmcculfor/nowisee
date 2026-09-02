# Nowisee — core modules

This is the normative behavior for the **client shell**, the **app kit**, and the **app ↔ core interface**. Product locks are in [`SPEC.md`](SPEC.md). Types are in [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`src/core/types.ts`](../src/core/types.ts). Agent rules are in [`../AGENTS.md`](../AGENTS.md).

Per-app graphs, stores, and corpora live next to each app (`src/apps/<id>/README.md`).

This document specifies **what each core module owns**, its **inputs and outputs**, **edge cases**, and **non-goals**. It does not prescribe a UI framework.

---

## 0. Runtime picture

```text
┌─────────────────────────────────────────────────────────┐
│ Shell bootstrap                                         │
│  config → surface + NavPads → Display → Keyboard        │
└───────────────┬─────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────┐
│ Keyboard ──intent──► Navigator ◄── NavigationMapStore   │
│ NavPads  ──intent──►│  ▲                                │
│  Router ──location────►│  │ stack, busy, token          │
│  (parse / hrefFor)  ◄──┘  │                             │
│                        ▼  │                             │
│                 AppRegistry.get(appId)                  │
│                        │                                │
│                        ▼                                │
│                AppModule.open / refresh                 │
│                        │                                │
│                        ▼                                │
│        apply RefreshResult → NodeCache + Map + Display  │
└─────────────────────────────────────────────────────────┘
```

Only **one app is current** at a time. Stack and warm are scoped to that app. Switching apps always goes through `Navigator.openLocation`. Router only translates between browser URLs and `AppLocation`; it never mutates state.

---

## How apps use core

Core talks to apps only through `open` / `refresh`. Apps never import Navigator, Display, Keyboard, or the registry.

### What core provides

| Service | How the app sees it |
|---------|---------------------|
| Intents | Edges the app authors (`prev` / `next` / `enter` / `back`). Core maps keys, pads, and Cancel/Done onto those intents. |
| Stack | `refresh` receives `StackEntry[]` for this app only. `open` resets it. |
| Warm + map | Core stores whatever the last result returned. It does not invent neighbors. |
| Display | Renders `result.node` as text or input according to `kind` / `secret`. |
| Clipboard | The app returns `clipboardText` on an **action** result; core writes. |
| Address bar | The app returns an `AppLocation` or `null`; Router serializes. |
| Server context | `ctx.userId`, `ctx.sessionId`, `ctx.accountAppId`, plus granted capabilities (`identity`, `lockbox`, `oauth`, `directory`). Never a database. |
| Abort | `extras.signal` on read-only calls. Never on action calls. |

### What apps must do

1. Return a usable `node`, `navigationMap`, and `warm` from every `open` / `refresh`.
2. Make root `back` an `app` edge to `config.rootAppId` (Home).
3. On `pop` edges, omit `toNodeId`.
4. Run side effects only when `extras.action` is true.
5. Resolve actions with a status node (including errors). Do not reject an action call — that strands the user on the working label.
6. Repair a stale stack tip; do not teleport.
7. Return plain data only. No `#/…` strings, no browser APIs, no live objects.
8. Scope user data by `ctx.userId` from the cookie, not by an id the client sent on the stack.

Optional helpers live in [`src/app-kit/`](../src/app-kit/) (edge builders, list edges, input edges, a signed-out node, split text, neighborhood walk). Navigator never calls these automatically.

The full MUST/SHOULD list is in [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## 1. Types

**Path:** `src/core/types.ts`  
**Owns:** shared TypeScript contracts.  
**Must not:** import apps or the DOM.

The source file is canonical. The narrative lives in [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## 2. AppRegistry

**Path:** `src/core/registry.ts`

### Responsibilities

- Hold `AppModule` instances for this process (host: pack at start; client: lazy RPC stubs).
- `get(id) → AppModule | null` — **core-internal only**; never handed to an app.
- `listDescriptors() → AppDescriptor[]` — plain `{ id, label }` data. Home reads installed apps through `ctx.directory.list()`, never the client registry. The host may add `homeRole` from the pack when building that directory list; `listDescriptors()` itself does not.

### Edge cases

| Case | Behavior |
|------|----------|
| `get` unknown id | Return null. Navigator may ask `resolveApp`, then fall back to `config.rootAppId` |
| Double-register same id | **Reject** (throw); do not silently replace |

### Non-goals

- Being a product catalog. The host pack and `ctx.directory` own installed apps; `homeRole` and per-user visible apps are a Home concern. `rootAppId` remains the shell root.
- Loading third-party *server* modules on demand (the host still starts the pack at process start).

---

## 3. Router

**Path:** `src/core/router.ts`

Router is a **pure boundary**: it translates between browser URLs and `AppLocation`, and nothing else. It owns no stack, no cache, no map, no busy flag, and never applies a `RefreshResult`. This is deliberate — when two modules can mutate the same state, "what happens if the user presses a key mid-load" has two answers.

### Responsibilities

- `parse(href) → AppLocation`.
- `hrefFor(location) → string` — **the only place in the codebase that produces a `#/...` string.** `location.path` must already be canonical (non-empty, starts with `/`); hrefFor does not rewrite empty or unslashed paths.
- `setAddressBar(location)` — write the address bar without triggering a reopen.
- Subscribe to `hashchange` for external URL changes: parse and hand the location to `Navigator.openLocation`. Deeper interaction with browser Back/Forward is deferred ([`PREPAREDNESS.md`](PREPAREDNESS.md)); do not invent session-stack sync yet.

Because apps address `AppLocation` rather than URL strings, moving from hash routes to History API paths, adding a locale segment, or mounting under a sub-path later changes this module and nothing else.

### URL shape (MVP)

| URL | Parsed location |
|-----|-----------------|
| `#/` (canonical) | `{ appId: config.rootAppId, path: "/" }` |
| `#/<rootAppId>` | same as above (alias) |
| `#/<appId>/rest` | `{ appId, path: "/rest" }` |

Paths on `AppLocation` are canonical: non-empty, starting with `/`. `parse` recovers messy hrefs into that shape. Apps must not emit empty or unslashed paths; `hrefFor` rejects them.

### Edge cases

| Case | Behavior |
|------|----------|
| Well-formed app id (`isAppId`) | Keep that id; the server decides whether it exists |
| Syntactically invalid app id | Resolve to `config.rootAppId`; do not crash |
| Corrupt or non-matching href | Resolve to `config.rootAppId` |
| `hrefFor` round-trip | `parse(hrefFor(loc))` must equal `loc` for any location core emits |
| Address bar written by core | Must not re-enter `openLocation` via `hashchange` |

### Non-goals

- Interpreting app path segments.
- Owning busy, stack, cache, or map (all Navigator).
- Server redirects.

---

## 4. NavigationMapStore

**Path:** `src/core/navigationMap.ts`

### Responsibilities

- Hold the current `NavigationMap` from the last successful refresh/open.
- `lookup(fromNodeId, intent) → NavEdge | undefined`.
- `replace(map)` on every successful apply.

The map is nested (`fromNodeId → intent → edge`), so no delimiter is needed and app-owned node ids containing any character are safe. Keys are intents, never keystrokes — the physical binding table lives in Keyboard.

### Edge cases

| Case | Behavior |
|------|----------|
| Empty map | All intents no-op until refresh fills map |
| Edges for non-current nodes | Allowed; enables rapid local hops |
| Unknown intent in the map | Simply never matched; not an error |

### Non-goals

- Validating that `toNodeId` exists in warm (Navigator handles miss by blocking).
- Knowing what key produced an intent.

---

## 5. NodeCache (client warm)

**Path:** `src/core/nodeCache.ts`

### Responsibilities

- Store `NodePayload` by `nodeId` for the **current app**.
- On successful refresh: **replace** warm entries from `result.warm`, then ensure `result.node` is stored, then **re-pin** all stack entry ids (keep their payloads even if omitted from `warm`).
- `get(nodeId)`, optional defensive max entries (evict non-pinned first).

### Edge cases

| Case | Behavior |
|------|----------|
| App switch | Clear cache (Navigator, as part of the open transition) |
| Pin vs replace | Stack ids survive warm replace |
| Duplicate ids in warm | Last write wins |

### Non-goals

- Server-side cache, TTL, etags (app/backend).
- Fetching by id without app refresh.

---

## 6. Stack

**Path:** `src/core/stack.ts`

### Responsibilities

- Maintain `StackEntry[]` for the current app only.
- Operations: `push(entry)`, `replaceTip(entry)`, `pop() → entry | null`, `clear()`, `snapshot()` for refresh, `restore(snapshot)` when the user backs out of load recovery.
- `replaceTip` refuses when the stack is empty (callers that mean push must `push`).
- Tip = last entry.

### Pop rules

- `pop` when stack length is 1: Navigator must not leave the user nowhere. **Apps MUST offer root `back` as an `app` edge to `config.rootAppId`** before the user is stuck. If a buggy app authors a `pop` on the last entry, core recovers by calling `openLocation({ appId: config.rootAppId, path: "/" })` **without popping first**, so a failed recovery leaves the last screen intact.

### Known consequence: deep links have a one-entry stack

An `open` resets the stack, so a shared link lands the user with no ancestry, and `back` at that node exits to the root app rather than to the conceptual parent. Apps that care can inspect the stack in `refresh` (length 1 ⇒ arrived by link) and author `back` accordingly. Rehydrating ancestry from `open` is **deferred** — see [`PREPAREDNESS.md`](PREPAREDNESS.md) — because the correct parent is not always obvious, and adding an optional `stack` to `RefreshResult` later is additive.

### Non-goals

- Storing multiple apps’ histories (cleared on app switch by design).

---

## 7. Navigator

**Path:** `src/core/navigator.ts`

Navigator is the **single owner** of every state transition: stack, cache, map, busy, display, address bar, and the transition token. Router asks it to open a location; Keyboard asks it to follow an intent. Nothing else mutates.

### Responsibilities

- Orchestrate intent → map → stack → display → refresh.
- Own **`blocked`** (intents ignored while true) and the monotonic **transition token**. Specs may say “busy”; that means the same flag.
- Apply `RefreshResult` to map, cache, stack tip (id, label, location), display, address bar.
- Read input text from Display when `passInputText` is set.
- Set `extras.action` on exactly the traversal of an `action: true` edge.

### Intent handling algorithm

```text
onIntent(intent):
  if blocked: return
  if loadRecovery:
    if intent == enter: refresh current stack (no extras.action); return
    if intent == back: restore stack+display snapshot; return
    return                                           // prev/next silent no-op
  edge = map.lookup(tip.id, intent)
  if !edge: return                                   // silent no-op
  if edge is malformed (push/replace missing toNodeId,
     app location path not canonical, empty external href):
    return                                           // no token bump

  extras = {}
  if edge.passInputText and tip.kind == "input":
    extras.inputText = display.getInputText()
  if edge.action:
    extras.action = true                             // this traversal only

  token = ++transitionToken                          // supersedes anything in flight

  if edge.kind == "external":
    handOffToBrowser(edge.href); return
  if edge.kind == "app":
    openLocation(edge.to, extras); return

  // node edge
  snapshot stack and current payload                  // load-recovery back
  if edge.stackBehavior == "pop":
    if stack.length <= 1:
      openLocation({ appId: config.rootAppId, path: "/" }); return
    stack.pop()
    destId = stack.tip.nodeId
  else:
    destId = edge.toNodeId                           // required; already validated

  payload = cache.get(destId)
  if payload:
    applyLocalMove(edge.stackBehavior, payload)      // update stack + display now
    startCall(refresh, extras, token)                // revalidate in background
  else:
    blocked = true
    applyLocalMove(edge.stackBehavior, { nodeId: destId, label: "" })
    // stack moves so refresh sees the intended tip; Display keeps the previous
    // label (no placeholder, no empty flash) until result.node arrives
    startCall(refresh, extras, token)
    // on result (if token is newest): apply; blocked = false
    // on failure: load recovery (below); stack stays on dest
```

`openLocation(location, extras)` increments the token, sets `blocked = true`, and calls `app.open(location.path, extras)` **without** discarding the current session first. On success it then clears stack, cache, and map, sets the current app, and applies. On failure it unblocks and leaves stack, cache, map, and display as they were. If the registry has no module, Navigator asks optional `resolveApp` (bootstrap mints a generic RPC stub). If that is missing or returns null, the id still resolves to `config.rootAppId` with path `/`. A known app with a non-canonical path is a silent no-op.

**Local move vs refresh authority:** After a warm hit, display `payload.label` immediately, then refresh may replace the tip with `result.node` (same id or a stale-repair fallback). Core adopts `result.node.id` as the tip id, since subsequent map lookups key off it. Do not teleport to an unrelated workflow destination.

**Display after revalidation:** If `result.node` matches what Display already shows (same app, id, kind, and — for text — label), do **not** remount the surface. Remounting restarts screen-reader utterance. Same-id text with a new label remounts once via `showText` (focus announces the new label). Same-id input tips leave the mounted input alone so revalidation cannot wipe caret or typed text.

### Transition token

- Every transition (intent, `openLocation`, `hashchange`) increments a monotonic token and records it on the call it starts.
- On completion, apply the result **only if its token is the newest issued**; otherwise discard.
- Comparing tip ids is *not* sufficient: an A → B → A sequence returns to the same id, and the first visit's stale result would pass an id check.
- Superseded **read-only** calls get their `AbortSignal` aborted so apps can cancel real work.
- Superseded **action** calls are never aborted — the effect may already be in flight and cancelling it midway is worse than letting it finish. Only the result is discarded.

### Action calls

- `extras.action` is set on exactly one call: the one caused by traversing an edge with `action: true`.
- Core never re-issues that call — no automatic retry, no replay after a discarded result, no repeat on later revalidation. A failed action is re-triggered by the user pressing the intent again. Load-recovery `enter` is a new read refresh, not a re-issue of a failed action.
- Core may coalesce or debounce read-only revalidations (holding `next` through a long list should not issue one call per row). Action calls are never coalesced or dropped.

### Address bar

- If `result.location` is an `AppLocation` with a canonical path → `router.setAddressBar(location)`.
- If `result.location` is null → leave the address bar unchanged.
- Omitting the field is not allowed.

### Refresh failure

- Log/debug as appropriate.
- `blocked = false`, busy clear.
- **Warm miss:** keep the dest on the stack. Map and cache stay last-good. Display the core recovery copy (`LOAD_FAILURE_LABEL`). `enter` retries `refresh` on the current stack with **no** `extras.action`. `back` restores the pre-miss stack and the previous payload. Other intents are a silent no-op. This is Navigator recovery, not an app-authored edge.
- **Warm hit or failed open:** display, stack, map, and cache unchanged (last good). Do not overwrite cached dest text.
- A rejected action call still leaves the user reading a working label if the dest was warm. Apps **MUST** resolve with a status node instead of rejecting. Busy and dead-end remain silent — [`PREPAREDNESS.md`](PREPAREDNESS.md).

### Non-goals

- App domain logic.
- Automatic multi-level warm expansion.
- Parsing or building URLs (Router).

---

## 8. Display

**Path:** `src/core/display.ts`

### Responsibilities

- Render the current tip.
- `showText(label)` for `kind: "text"` (default) — remount + focus a `role="application"` surface so NVDA / JAWS / VoiceOver pass arrow keys to the page. Set `aria-label` to the same string as the visible text: NVDA treats application as a named widget and otherwise announces only "application".
- `showInput(initialText, options?)` for `kind: "input"` — a native `<textarea>` (Enter = newline) plus **Cancel** (`back`) and **Done** (`enter`) buttons after the field; expose `getInputText()`. When `options.secret` (or `NodePayload.secret`) is set, render `<input type="password">` and set `autocomplete` from the payload (`username` / `current-password` / `new-password` / `off`). Buttons activate on click only, never on focus.
- Focus management on load and when switching text ↔ input.
- **Announce via focus only** — the text surface is a focusable `tabindex="-1"` node with **no** `aria-live`. Combining a live region with `focus()` double-speaks on VoiceOver iOS (live insertion + focus announcement).
- Optional `skipTextFocus`: the iOS wrapper uses this so VoiceOver is not moved onto the web surface while the Direct Touch overlay owns speech.
- Mark the shell `data-input-open` while an input tip is showing so NavPads can be hidden (they would cover Cancel / Done).

### Edge cases

| Case | Behavior |
|------|----------|
| Long label | Single blob; no truncation required in MVP |
| Switch text → input | Replace surface; focus textarea |
| Switch input → text | Replace surface; focus application text surface |
| Identical tip revalidated | Navigator skips Display; no remount / no re-focus |
| Same text tip, new label | Remount + focus once so the new label is announced |

### Non-goals

- Multi-field forms, Escape-to-blur platform behavior.
- A second SR-only status channel (deferred — [`PREPAREDNESS.md`](PREPAREDNESS.md)).

---

## 9. Keyboard

**Path:** `src/core/keyboard.ts`

Keyboard is the **only** module that knows what a keystroke is. Apps author intents; this table decides which physical input produces them. That indirection is what keeps touch gestures, user remapping, alternative input devices, and RTL out of app data.

### Responsibilities

- Listen to keydown on window/document as appropriate.
- Own the binding table and resolve `(event, tipKind) → NavIntent | none`.
- On a match: `preventDefault` and call `navigator.onIntent(intent)` (Navigator no-ops if there is no edge).
- On no match: do nothing and do not `preventDefault`.
- If blocked: ignore.

```ts
export interface KeyBinding {
  readonly intent: NavIntent;
  readonly key: string;                    // KeyboardEvent.key
  readonly mods?: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean };
  readonly whenTip?: NodeKind;             // omit = both kinds
}
```

### Default binding table

Plain arrows on **text** tips (`role="application"`). Unbound on **input** tips so the caret keeps them. Leave an input via Cancel / Done.

| Tip kind | Key | Intent |
|----------|-----|--------|
| text | `ArrowUp` / `ArrowDown` | `prev` / `next` |
| text | `ArrowRight` / `ArrowLeft` | `enter` / `back` |
| input | plain arrows | *unbound* (caret) |
| either | Escape, Tab, Enter | *unbound* |

Notes on the defaults:

- `role="application"` on the text surface is what lets these keys reach the page under NVDA / JAWS / desktop VoiceOver. It is not a substitute for Cancel / Done on input tips.
- `Tab` / `Shift+Tab` must **not** be bound. Consuming Tab would trap the keyboard inside the page (WCAG 2.1.2). Tab moves between the textarea and Cancel / Done.
- Right-to-left locales swap the `enter` / `back` arrows here. Apps are unaffected.
- Changing defaults is a change to this table only; apps author intents, never keys.
- Keystrokes that originate in a `<textarea>` or `<input>` are ignored even if a binding would otherwise match.

### Non-goals

- Knowing which intents an app actually uses (Navigator no-ops on unmapped intents).
- Escape exits input (explicitly **not** supported).
- Persisting a user's custom bindings (a future settings app supplies `config.keyBindings`).
- Touch / VoiceOver delivery (owned by NavPads).

---

## 9b. NavPads

**Path:** `src/core/navPads.ts`

VoiceOver on iPhone owns gestures, so arrow keys are not available. NavPads are large edge buttons that deliver the same four intents when accessibility focus lands on them, and again on `click` (sighted tap or VoiceOver double-tap activate). A `focusin` that already fired an intent suppresses only the click that follows on that same button (one gesture). There is no time delay and no lockout of a later activation.

### Responsibilities

- Mount four native `<button type="button">` elements (top / bottom / left / right).
- Name each via `aria-label` only (`Previous` / `Next` / `Back` / `Enter`); no nested text VoiceOver can stop on separately.
- Listen for `focusin` and `click` on those buttons only; call `navigator.onIntent(intent)`.
- If blocked: ignore.
- Overlay the reading surface (pads may cover text); do not reserve a layout gutter that squishes the label.
- Hidden while Display is in input mode (`data-input-open` on the mount) so they cannot cover Cancel / Done or fire on explore-by-touch.
- **Not mounted** when the iOS WKWebView host is present (`webkit.messageHandlers.nowisee`); the native overlay is the intent host then.

| Edge | Intent |
|------|--------|
| top | `prev` |
| bottom | `next` |
| left | `back` |
| right | `enter` |

### Non-goals

- Visible chrome or sighted affordances (pads are intentionally transparent).
- Knowing which intents an app map contains.
- Replacing Keyboard on desktop; both paths coexist.

---

## 9c. Native WKWebView host

**Path:** `src/shell/nativeBridge.ts` (page), `ios/` (Swift overlay)

The iPhone app is a visible `WKWebView` of the production origin plus a transparent touch overlay. It is a **fourth intent host**, same as Keyboard and NavPads: it calls `navigator.onIntent`. Apps and the server host do not know it exists.

The overlay is a Direct Touch accessibility element so one-finger swipes reach the app instead of VoiceOver. It speaks `accessibilityLabel` (and posts an announcement when the label changes). The WKWebView is hidden from VoiceOver while the overlay is up (`accessibilityViewIsModal` on the overlay). After an input node, VoiceOver focus is moved back onto the overlay with a screen-changed notification so the page behind it is not still focused.

The page attaches the bridge only when `webkit.messageHandlers.nowisee` is present (the iOS wrapper). Safari and desktop never set that, so NavPads still mount there.

### Page → native

`postMessage({ mode, label, blocked })` after Display surface changes and after an intent settles. `mode === "input"` tells native to hide the overlay so VoiceOver uses the web field and Cancel/Done.

### Native → page

`window.__nowiseeNative.onIntent("prev"|"next"|"enter"|"back")`. Other strings are ignored.

### Non-goals

- A Display port or native text renderer (deferred until device spikes fail).
- Teaching apps about swipes or User-Agent.
- A second login path; the WebView keeps the session cookie.

---

## 10. Platform capabilities

**Path:** `src/core/platform.ts`

Apps are not handed a live clipboard. Copy text is `clipboardText` on the refresh result. Core still owns the browser clipboard write (user-activation) and fills it from that string. `PlatformContext` remains the seam for later capabilities (`announce`, `requestRefresh`). Identity is a **server** capability on `ctx`, not a client platform member.

### Responsibilities

- Own the clipboard write channel used when an action result includes `clipboardText`.
- Honour it only when the host can actually write.

### Clipboard, and why core has to own it

Browsers only permit a clipboard write while the user's keypress is still counted as recent (*transient user activation*). `refresh` is asynchronous (and may be a server round-trip), so a write that starts after the response often fails — Safari strictly, Chrome under some focus conditions.

Apps **do not write the clipboard**. On an action they return `clipboardText` on the refresh result. Core opens a write channel synchronously inside the keydown, then fills it from that string:

```text
keydown → edge has action: true
  ├─ open a pending clipboard write (a promise core will resolve)
  ├─ call app.refresh (may be HTTP) with extras.action = true
  │     └─ result.clipboardText  → core writeText → resolves the pending write
  └─ if the result has no clipboardText, cancel the pending write
```

If the host has no clipboard, core changes the status label to “Copy failed: clipboard unavailable.” If the browser denies the write, the label becomes “Copy failed.”

Where the browser supports a promise-valued `ClipboardItem`, core hands that promise straight to `navigator.clipboard.write` during the keydown. Where it does not, core falls back to `writeText` when the string arrives.

### Edge cases

| Case | Behavior |
|------|----------|
| `clipboardText` outside an action call | Ignored (no channel; core does not write) |
| Browser denies the write | Status label “Copy failed.” |
| Host has no clipboard | Status label “Copy failed: clipboard unavailable.” |

### Non-goals (MVP)

- `announce`, `requestRefresh` — declared in the type, **not provided**. See [`PREPAREDNESS.md`](PREPAREDNESS.md).
- Per-app permissions or capability grants (arrives with third-party apps).
- Any product-specific capability. Everything here is a browser or platform primitive.

---

## 11. App kit (optional shared library)

**Path:** `src/app-kit/`

Navigator **never** imports these for automatic behavior. Apps may import freely.

| Helper | Purpose |
|--------|---------|
| `edgeNode / edgePop / edgeApp / edgeExternal` | Construct `NavEdge` values; `edgePop` omits `toNodeId` |
| `edgeAction(toNodeId)` | `enter` edge with `action: true` — the one-line button press |
| `siblingListEdges(ids, opts)` | `prev` / `next` `replace` edges; `wrap?: boolean`; `around?: { index, radius }` windows the emitted rows |
| `inputEdges(inputId, { commitTo, backTo })` | `enter` (+ `passInputText`) commits; `back` abandons (`backTo` is a node id or `"pop"`) |
| `rootBackToHome(rootId, rootAppId, fromAppId)` | `back` app edge to that app's Home catalog row (`/app/:fromAppId`) |
| `edgeToHome(rootAppId, fromAppId)` / `homeCatalogPath(appId)` | Same Home row address |
| `collectNeighborhood({ tipId, neighbors, payload, depth, maxNodes })` | Callback-driven walk → warm payloads + map fragment |
| `buildMap(fragments)` | Assemble the nested `fromNodeId → intent → edge` structure |
| `signedOut({ accountAppId, rootAppId, appId, text })` | Complete `RefreshResult` for a signed-out user-scoped app |
| `splitText` | Chunk a long body into sibling labels |

### Non-goals

- Knowing any app’s schema.
- Talking to Navigator internals.
- Building URL strings (only Router does that).

---

## 12. Shell bootstrap

**Path:** `src/shell/` + `main.ts`

### Responsibilities

- Build `ShellConfig` (`rootAppId`, optional `keyBindings`). Core files never name an app.
- Construct an empty registry. Inject `resolveApp` so Navigator can mint a generic `createRemoteApp` stub for whatever id the URL or an `app` edge names. Do **not** pre-register a product list.
- Inject `AppRpc` (default: POST `/api/apps/:id/…`; tests pass `createAppHost`).
- Construct cache, map store, display, navigator, router, keyboard, platform capabilities.
- Router uses `isAppId` (syntax), not the client registry, to accept a hash segment.
- Initial `navigator.openLocation(router.parse(location.hash) ?? rootLocation)`.
- Do **not** focus the surface again after open resolves — `showText` / `showInput` already focused; a second focus restarts VoiceOver.

### Non-goals

- Feature flags UI, app store UI.

---

## 13. Core open items

Content announcement is settled: it is focus-only (no `aria-live` on the reading surface). Screen-reader browse mode is handled by `role="application"` on text tips plus Cancel/Done on input (see [`spikes/README.md`](../spikes/README.md)).

What is still deferred lives in [`PREPAREDNESS.md`](PREPAREDNESS.md):

| Item | Notes |
|------|-------|
| Browser Back/Forward vs session stack | Hashchange → `openLocation` is enough; deeper sync later |
| Warm etags | Deferred |
| Status channel (busy / dead-end / failure) | Display + Navigator; additive |
| Deep-link ancestry | Optional `stack` on `open`; additive |
| Contract versioning + unknown-value fallbacks | Until third-party apps |
| Validating / bounding app responses | Until third-party apps |
| Sandboxing (worker / iframe / server apps) | The boundary stays message-shaped so this stays possible |
| `announce` / `requestRefresh` | Declared, not provided |
