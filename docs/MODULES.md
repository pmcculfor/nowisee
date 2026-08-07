# Nowisee — detailed module specifications

Normative behavior for implementers. Product locks: [`SPEC.md`](SPEC.md). Types: [`ARCHITECTURE.md`](ARCHITECTURE.md). Review history: [`DESIGN-REVIEW.md`](DESIGN-REVIEW.md). Agent rules: [`../AGENTS.md`](../AGENTS.md).

This document specifies **what each module owns**, **inputs/outputs**, **edge cases**, and **non-goals**. It does not prescribe a UI framework.

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

Only **one app is current**. Stack and warm are scoped to that app. Switching apps always goes through `Navigator.openLocation`. Router only translates between browser URLs and `AppLocation`; it never mutates state.

---

## 1. Core: Types

**Path:** `src/core/types.ts`  
**Owns:** Shared TypeScript contracts (`NavIntent`, `NavEdge`, `AppLocation`, `NodePayload`, `StackEntry`, `RefreshResult`, `AppModule`, …).  
**Must not:** Import apps or DOM.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the canonical definitions.

---

## 2. Core: AppRegistry

**Path:** `src/core/registry.ts`

### Responsibilities

- Register `AppModule` instances at bootstrap.
- `get(id) → AppModule | null` — **core-internal only**; never handed to an app.
- `listEnabled() → AppDescriptor[]` — plain `{ id, label }` data (MVP: all registered are enabled).
- Provide the catalog Home uses for labels + `app` edges.

### Edge cases

| Case | Behavior |
|------|----------|
| `get` unknown id | Return null; Navigator falls back to `config.rootAppId` |
| Double-register same id | **Reject** (throw / fail bootstrap); do not silently replace |

### Non-goals

- Lazy loading third-party apps at runtime (later).
- Per-user enabled flags (later).

---

## 3. Core: Router

**Path:** `src/core/router.ts`

Router is a **pure boundary**: it translates between browser URLs and `AppLocation`, and nothing else. It owns no stack, no cache, no map, no busy flag, and never applies a `RefreshResult`. This is deliberate — when two modules can mutate the same state, "what happens if the user presses a key mid-load" has two answers.

### Responsibilities

- `parse(href) → AppLocation | null`.
- `hrefFor(location) → string` — **the only place in the codebase that produces a `#/...` string.**
- `setAddressBar(location)` — write the address bar without triggering a reopen.
- Subscribe to `hashchange` for external URL changes: parse and hand the location to `Navigator.openLocation`. **Interaction with browser Back/Forward beyond “hashchange → openLocation” is deferred** (open item); do not invent session-stack sync yet.

Because apps address `AppLocation` rather than URL strings, moving from hash routes to History API paths, adding a locale segment, or mounting under a sub-path later changes this module and nothing else.

### URL shape (MVP)

| URL | Parsed location |
|-----|-----------------|
| `#/` (canonical) | `{ appId: config.rootAppId, path: "/" }` |
| `#/<rootAppId>` | same as above (alias) |
| `#/<appId>/rest` | `{ appId, path: "/rest" }` |

Paths are normalized to a single leading `/`. Apps must document their own path grammar; core never interprets it.

### Edge cases

| Case | Behavior |
|------|----------|
| Unknown appId | Resolve to `config.rootAppId`; do not crash |
| Corrupt or non-matching href | Resolve to `config.rootAppId` |
| `hrefFor` round-trip | `parse(hrefFor(loc))` must equal `loc` for any location core emits |
| Address bar written by core | Must not re-enter `openLocation` via `hashchange` |

### Non-goals

- Interpreting app path segments.
- Owning busy, stack, cache, or map (all Navigator).
- Server redirects.

---

## 4. Core: NavigationMapStore

**Path:** `src/core/navigationMap.ts`

### Responsibilities

- Hold the current `NavigationMap` from the last successful refresh/open.
- `lookup(fromNodeId, intent) → NavEdge | undefined`.
- `replace(map)` on every successful apply.

The map is nested (`fromNodeId → intent → edge`), so no delimiter is needed and app-owned node ids containing any character are safe. Keys are intents, never keystrokes — the physical binding table lives in Keyboard (§9).

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

## 5. Core: NodeCache (client warm)

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

## 6. Core: Stack

**Path:** `src/core/stack.ts` (or inside Navigator)

### Responsibilities

- Maintain `StackEntry[]` for the current app only.
- Operations: `push(entry)`, `replaceTip(entry)`, `pop() → entry | null`, `clear()`, `snapshot()` for refresh.
- Tip = last entry.

### Pop rules

- `pop` when stack length is 1: after pop, stack is empty—Navigator should not leave the user nowhere. **Apps MUST offer root `back` as an `app` edge to `config.rootAppId`** before the user is stuck. If a buggy app pops the last entry without such an edge, core recovers by opening the root app.
- Recommended invariant: never complete a `pop` edge that empties the stack without immediately opening the root app; prefer treating empty-after-pop as `openLocation({ appId: config.rootAppId, path: "/" })`.

### Known consequence: deep links have a one-entry stack

An `open` resets the stack, so a shared link lands the user with no ancestry, and `back` at that node exits to the root app rather than to the conceptual parent. Apps that care can inspect the stack in `refresh` (length 1 ⇒ arrived by link) and author `back` accordingly. Rehydrating ancestry from `open` was considered and **deferred** — see [`DESIGN-REVIEW.md`](DESIGN-REVIEW.md) §8 — because the correct parent is not always obvious, and adding an optional `stack` to `RefreshResult` later is backward compatible.

### Non-goals

- Storing multiple apps’ histories (cleared on app switch by design).

---

## 7. Core: Navigator

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
  edge = map.lookup(tip.id, intent)
  if !edge: return                                   // silent no-op

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
  if edge.stackBehavior == "pop":
    stack.pop()
    if stack.isEmpty():
      openLocation({ appId: config.rootAppId, path: "/" }); return
    destId = stack.tip.nodeId
  else:
    destId = edge.toNodeId                           // required for push/replace
    if !destId: return                               // malformed → silent no-op

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
```

`openLocation(location, extras)` runs the same transition machinery: increment token, clear stack, clear cache and map, set current app, `blocked = true`, call `app.open(location.path, extras)`, apply, clear blocked.

**Local move vs refresh authority:** After a warm hit, display `payload.label` immediately, then refresh may replace the tip with `result.node` (same id or a stale-repair fallback). Core adopts `result.node.id` as the tip id, since subsequent map lookups key off it. Do not teleport to an unrelated workflow destination.

**Display after revalidation:** If `result.node` matches what Display already shows (same app, id, kind, and — for text — label), do **not** remount the surface. Remounting restarts screen-reader utterance (VoiceOver on iOS especially). Same-id text with a new label updates the live region in place (`replaceText`) without stealing focus. Same-id input tips leave the mounted input alone so revalidation cannot wipe caret or typed text.

### Transition token

- Every transition (intent, `openLocation`, `hashchange`) increments a monotonic token and records it on the call it starts.
- On completion, apply the result **only if its token is the newest issued**; otherwise discard.
- Comparing tip ids is *not* sufficient: an A → B → A sequence returns to the same id, and the first visit's stale result would pass an id check.
- Superseded **read-only** calls get their `AbortSignal` aborted so apps can cancel real work.
- Superseded **action** calls are never aborted — the effect may already be in flight and cancelling it midway is worse than letting it finish. Only the result is discarded.

### Action calls

- `extras.action` is set on exactly one call: the one caused by traversing an edge with `action: true`.
- Core never re-issues that call — no automatic retry, no replay after a discarded result, no repeat on later revalidation. A failed action is re-triggered by the user pressing the intent again.
- Core may coalesce or debounce read-only revalidations (holding `next` through a long list should not issue one call per row). Action calls are never coalesced or dropped.

### Address bar

- If `result.location` is present → `router.setAddressBar(location)`.
- If null/undefined → leave the address bar unchanged.

### Refresh failure

- Log/debug as appropriate.
- `blocked = false`, busy clear.
- Display unchanged.
- Map/cache unchanged (last good).
- Note: with no status channel in MVP, a rejected action call leaves the user reading "Sending…" indefinitely. This is why apps **MUST** resolve with a status node instead of rejecting. Distinguishing busy / dead-end / failure for the user is deferred — see [`DESIGN-REVIEW.md`](DESIGN-REVIEW.md) §6.

### Non-goals

- App domain logic.
- Automatic multi-level warm expansion.
- Parsing or building URLs (Router).

---

## 8. Core: Display

**Path:** `src/core/display.ts`

### Responsibilities

- Render exactly one interactive surface.
- `showText(label)` for `kind: "text"` (default) — remount + focus.
- `replaceText(label)` — in-place label change when the text surface is already mounted (no remount, no focus steal).
- `showInput(initialText)` for `kind: "input"` — multiline `<textarea>`; expose `getInputText()`.
- Focus management on load and when switching text ↔ input.
- Announce updates (`aria-live` assertive default).

### Edge cases

| Case | Behavior |
|------|----------|
| Long label | Single blob; no truncation required in MVP |
| Switch text → input | Replace surface; focus input |
| Switch input → text | Replace surface; focus live region |
| Identical tip revalidated | Navigator skips Display; no remount / no re-focus |
| Same text tip, new label | `replaceText` — in-place live-region update, no focus steal |

### Non-goals

- Multi-field forms, visible chrome, Escape-to-blur platform behavior.

---

## 9. Core: Keyboard

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

Same chord on **text** and **input** tips. Plain arrows stay unbound so the caret keeps them in fields.

| Tip kind | Key | Intent |
|----------|-----|--------|
| text / input | `Ctrl+Alt+Shift+ArrowUp` / `ArrowDown` | `prev` / `next` |
| text / input | `Ctrl+Alt+Shift+ArrowRight` / `ArrowLeft` | `enter` / `back` |
| either | plain arrows | *unbound* |

Notes on the defaults:

- The full `Ctrl+Alt+Shift` chord avoids colliding with caret movement (`Ctrl+Arrow`), browser/OS shortcuts, and common screen-reader keys.
- `Tab` / `Shift+Tab` must **not** be bound. Consuming Tab would trap the keyboard inside the page (WCAG 2.1.2).
- Right-to-left locales swap the `enter` / `back` arrows here. Apps are unaffected.
- Changing defaults is a change to this table only; apps author intents, never keys.

### Non-goals

- Knowing which intents an app actually uses (Navigator no-ops on unmapped intents).
- Escape exits input (explicitly **not** supported).
- Persisting a user's custom bindings (a future settings app supplies `config.keyBindings`).
- Touch / VoiceOver delivery (owned by NavPads, §9b).

---

## 9b. Core: NavPads

**Path:** `src/core/navPads.ts`

VoiceOver on iPhone owns gestures, so arrow keys are not available. NavPads are large edge buttons that deliver the same four intents when accessibility focus lands on them, and again on `click` (sighted tap or VoiceOver double-tap activate). A short debounce collapses focus+click from one gesture into a single intent.

### Responsibilities

- Mount four native `<button type="button">` elements (top / bottom / left / right).
- Name each via `aria-label` only (`Previous` / `Next` / `Back` / `Enter`); no nested text VoiceOver can stop on separately.
- Listen for `focusin` and `click` on those buttons only; call `navigator.onIntent(intent)`.
- If blocked: ignore.
- Overlay the reading surface (pads may cover text); do not reserve a layout gutter that squishes the label.

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

## 10. Core: Platform capabilities

**Path:** `src/core/platform.ts`

Apps are handed a `PlatformContext` on every `open` / `refresh`. It is the only channel for effects an app cannot or should not perform itself, and the only non-data thing core passes besides the abort signal. Keeping browser access here — rather than letting apps reach for `navigator.*` — is what leaves the door open to running an app in a Worker, an iframe, or on a server later.

### Responsibilities

- Construct the context; expose a capability **only** when the host can honour it, so `if (platform.clipboard)` means something.
- Own the browser-side mechanics, including the awkward ones below.

### Clipboard, and why core has to own it

Browsers only permit a clipboard write while the user's keypress is still counted as recent (*transient user activation*). An action `refresh` is asynchronous, so by the time an app could call `writeText` the activation has often expired — Safari strictly, Chrome under some focus conditions. **Routing the call through core does not fix this on its own; the write has to begin inside the keypress, and core is the only party holding it.**

Core therefore opens a write channel at the moment it traverses an `action: true` edge — synchronously, inside the keydown, before any app call:

```text
keydown → edge has action: true
  ├─ open a pending clipboard write (a promise core will resolve)
  ├─ call app.refresh(stack, { action: true, platform })
  │     └─ app calls platform.clipboard.writeText(text)  → resolves the pending write
  └─ if the app never calls it, cancel the pending write
```

Where the browser supports a promise-valued `ClipboardItem`, core hands that promise straight to `navigator.clipboard.write` during the keydown. Where it does not, core falls back to calling `writeText` when the app asks, which still succeeds while the activation window is open. Either way the app's side is one line and it never sees the problem.

### Edge cases

| Case | Behavior |
|------|----------|
| App calls `writeText` outside an action call | Reject; no channel is open |
| App calls `writeText` twice in one action call | Last call wins; log the first as an app bug |
| Browser denies the write | Reject the app's promise; the app turns it into an error label |
| Host does not offer a capability | The member is absent; apps must feature-detect |

### Non-goals (MVP)

- `storage`, `announce`, `requestRefresh` — declared in the type, **not provided in MVP**.
- Per-app permissions or capability grants (arrives with third-party apps).
- Any product-specific capability. Everything here is a browser or platform primitive.

---

## 11. App kit (optional shared library)

**Path:** `src/app-kit/`

Navigator **never** imports these for automatic behavior. Apps may import freely.

### Proposed helpers

| Helper | Purpose |
|--------|---------|
| `edgeNode / edgePop / edgeApp / edgeExternal` | Construct `NavEdge` values; `edgePop` omits `toNodeId` |
| `edgeAction(toNodeId)` | `enter` edge with `action: true` — the one-line button press |
| `siblingListEdges(ids, opts)` | `prev` / `next` `replace` edges; `wrap?: boolean` |
| `inputEdges(inputId, { commitTo, backTo })` | `enter` (+ `passInputText`) / `back` from an input node |
| `rootBackToHome(rootId, rootAppId)` | `back` app edge to the root app |
| `collectNeighborhood({ tipId, neighbors, payload, depth, maxNodes })` | Callback-driven walk → warm payloads + map fragment |
| `buildMap(entries)` | Assemble the nested `fromNodeId → intent → edge` structure |

### Non-goals

- Knowing Bible/Mail schemas.
- Talking to Navigator internals.
- Building URL strings (only Router does that).

---

## 12. App: Home (`id: "home"`)

### Responsibilities

- `open` / `refresh`: present sibling list of enabled apps from a `listEnabled(): AppDescriptor[]` callback injected at construction. Home receives descriptors, **not** the registry object — it is an ordinary app and gets no privileged handle.
- Each app label is a node; `enter` is `kind: "app"` to `{ appId, path: "/" }`.
- `prev` / `next` among app labels with `replace` (wrap optional—Home SHOULD wrap for a short list).
- `back` at home root: missing edge or no-op (already home).
- Optional Help node (text explaining the current bindings) as sibling or child.

### Must not

- Embed other apps’ internal node ids.
- Special-case Bible/Mail beyond registry labels/ids for URL construction.

---

## 13. App: Bible (`id: "bible"`)

### Responsibilities

- Own KJV data (static JSON or equivalent).
- Graph: Testament → book → chapter → verse → option nodes (Copy, Commentary stub).
- Book lists and chapter lists wrap at the ends; verse `next` / `prev` join adjacent chapters (last verse → first of next chapter, and the reverse).
- Chapter labels are `N (chapter)` (number first); verse labels are `N. text` only. Copy still writes `Book C:V. text`.
- Chapter → verse uses `replace` (not `push`) so cross-chapter verse joins keep a clean stack; verse `back` replaces to that verse’s chapter.
- `open(path)` parses canonical verse/book paths; bootstrap stack tip = resolved node (stack may be a single leaf after open reset—the app still exposes internal pops via map once the user pushes deeper in-session).
- After open, user builds in-app stack via `push` / `replace` edges; `back` = `pop` or chapter `replace` within bible; root `back` = `app` edge to the root app.
- Copy: the `enter` edge from the Copy option carries `action: true` and lands on a status node whose warm label is “Copying…”; the resulting refresh (the only call with `extras.action`) calls `extras.platform.clipboard?.writeText(verse)` and returns “Copied” / an error label in place. `prev` / `next` over the Copy option carry no flag and therefore do nothing. The app never touches `navigator.clipboard`, and never has to think about user activation — see §10.
- Warm + map: use app kit neighborhood helper or hand-built edges for nearby books/chapters/verses as appropriate.
- Search (optional/later): input node → results list as normal nodes in warm/map; client warm holds the hit list.

### Domain-only

- Chapter/verse joins, KJV indexing—never core.

---

## 14. App: Demo mail (`id: "mail"`)

### Responsibilities

- In-memory sample messages; no network.
- Inbox list, message body, compose instruction → input → send/status nodes.
- Compose: input node; `enter` edge carries `passInputText` **and** `action: true` to the send/status node; `back` edge returns without sending.
- Send tip: warm shows “Sending…”, the action refresh performs the send and returns “Sent” / error in place; edges back to inbox or pops—**no stack teleport**.
- Re-entering the sent status node later carries no action flag, so nothing is re-sent.
- Root `back` → `app` edge to the root app.

### Non-goals

- OAuth, real SMTP/IMAP, server cache (until a real mail app exists).

---

## 15. App: Notes (`id: "notes"`)

### Responsibilities

- Portable `AppModule` — list / create / edit via text + input nodes only.
- List order: **Create a note**, then notes sorted by `updatedAt` descending.
- Open `/`: tip is the first note if any, otherwise Create. Prev from the first note reaches Create.
- List tips show the **first line** of each note body (empty → “Empty note”).
- Enter on Create or a note → multiline input (full body). **Back** commits with `passInputText` + `action: true`; **enter** is unbound on the input so plain Enter inserts newlines. There is no discard-via-back path.
- Side effects (create/update) run **only** when `extras.action` is true.
- Root list tips: `back` is an `app` edge to Home.
- Persistence behind an injected `NotesStore` (shell wires localStorage for MVP). Schema carries `id`, `body`, `createdAt`, `updatedAt` — no owner yet; swap the store for a DB/API later without core changes.

### Non-goals

- Per-user auth, shared multi-device sync, rich text, folders.

---

## 16. Shell bootstrap

**Path:** `src/shell/` + `main.ts`

### Responsibilities

- Build `ShellConfig` (`rootAppId`, optional `keyBindings`). Core files never name an app.
- Construct registry; register Home, Bible, Mail.
- Construct cache, map store, display, navigator, router, keyboard, platform capabilities.
- Pass Home a `listEnabled` callback returning descriptors (never the registry itself).
- Initial `navigator.openLocation(router.parse(location.hash) ?? rootLocation)`.
- Focus display on load.

### Non-goals

- Feature flags UI, app store UI.

---

## 17. Cross-cutting open items (documented, not implemented as locks)

| Item | Notes |
|------|-------|
| Browser Back/Forward vs session stack | Hashchange → `openLocation` is enough for MVP; deeper sync deferred |
| Server session TTL / auth | App/backend; platform context seam reserved empty |
| Warm etags | Deferred |
| aria-live assertive vs polite | Default assertive; revisit in a11y pass |
| Busy / dead-end / failure are indistinguishable to the user | Accepted for MVP; status channel deferred (review §6) |
| Screen-reader browse mode eating arrows | Spike deferred; DOM strategy settled during implementation (review §7) |
| Deep-link ancestry | Deferred; optional `stack` on `open` is additive (review §8) |
| Contract versioning + unknown-value fallbacks | Deferred until third-party apps (review §11) |
| Validating / bounding app responses | Deferred; first-party apps only (review §12) |
| Actual sandboxing (worker / iframe / server apps) | Deferred; §10 keeps the boundary message-shaped so it stays possible (review §5) |
| `platform.storage` / `announce` / `requestRefresh` | Declared, not provided in MVP |
| Home URL canonical form | `#/` canonical; `#/<rootAppId>` may alias |

---

## 18. Implementation order (when coding)

1. Types + config + registry + cache + map store + stack  
2. Display + keyboard binding table (text only) + platform context (clipboard)  
3. Navigator (transitions, token, action flag) + Router boundary, with a tiny fake app  
4. App kit edge helpers  
5. Home app  
6. Bible app + data  
7. Mail demo + input nodes + action edges  
8. Tests per ARCHITECTURE testing contracts  
9. Accessibility pass (settles the deferred items in §17)  
