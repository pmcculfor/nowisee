# Nowisee — detailed module specifications

Normative behavior for implementers. Product locks: [`SPEC.md`](SPEC.md). Types: [`ARCHITECTURE.md`](ARCHITECTURE.md). Agent rules: [`../AGENTS.md`](../AGENTS.md).

This document specifies **what each module owns**, **inputs/outputs**, **edge cases**, and **non-goals**. It does not prescribe a UI framework.

---

## 0. Runtime picture

```text
┌─────────────────────────────────────────────────────────┐
│ Shell bootstrap                                         │
│  register apps → mount Display → bind Keyboard          │
└───────────────┬─────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────┐
│ Keyboard ──► Navigator ◄── NavigationMapStore           │
│                 │    ▲                                  │
│                 │    │ stack, busy                      │
│                 ▼    │                                  │
│              Router ──► AppRegistry.get(appId)          │
│                 │                                       │
│                 ▼                                       │
│            AppModule.open / refresh                     │
│                 │                                       │
│                 ▼                                       │
│         apply RefreshResult → NodeCache + Map + Display │
└─────────────────────────────────────────────────────────┘
```

Only **one app is current**. Stack and warm are scoped to that app. Switching apps always goes through Router.open.

---

## 1. Core: Types

**Path:** `src/core/types.ts`  
**Owns:** Shared TypeScript contracts (`NavKey`, `NavEdge`, `NodePayload`, `StackEntry`, `RefreshResult`, `AppModule`, …).  
**Must not:** Import apps or DOM.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the canonical definitions.

---

## 2. Core: AppRegistry

**Path:** `src/core/registry.ts`

### Responsibilities

- Register `AppModule` instances at bootstrap.
- `get(id)`, `listEnabled()` (MVP: all registered are enabled).
- Provide the catalog Home uses for labels + enter URLs.

### Edge cases

| Case | Behavior |
|------|----------|
| `get` unknown id | Return null; Router treats as invalid URL → Home |
| Double-register same id | Reject or replace deterministically (pick one at scaffold; document it) |

### Non-goals

- Lazy loading third-party apps at runtime (later).
- Per-user enabled flags (later).

---

## 3. Core: Router

**Path:** `src/core/router.ts`

### Responsibilities

- Parse the hash URL into `{ appId, path }`.
- Own **current appId**.
- `open(url: string, extras?: RefreshExtras)`:
  1. Parse; if invalid/unknown app → open Home with a safe path.
  2. **Clear the session stack.**
  3. Clear or re-key client warm/map for the new app scope.
  4. Set current appId.
  5. Set busy/blocked.
  6. Call `app.open(path, extras)`.
  7. Hand `RefreshResult` to Navigator.applyRefresh (or equivalent).
  8. Clear busy/blocked (unless apply starts another wait—normally done).
- Subscribe to `hashchange` for external URL changes: treat as `open` (same path). **Interaction with browser Back/Forward beyond “hashchange → open” is deferred** (open item); do not invent session-stack sync yet.

### URL shape (MVP proposal)

| URL | App | Path passed to `open` |
|-----|-----|------------------------|
| `#/` or `#/a/home` | `home` | `/` or `` |
| `#/a/<appId>/rest` | `<appId>` | `/rest` or `rest` (normalize one way) |

Exact normalization is an implementation detail; apps must document their path grammar.

### Edge cases

| Case | Behavior |
|------|----------|
| Open same app different path | Still clear stack; fresh open |
| Open while busy | Ignore or queue a single latest open (prefer **latest wins**, drop older)—document choice in code; recommended: ignore keys but allow open from address bar to supersede |
| `passInputText` on url edge | Include `extras.inputText` when following that edge into `open` |

### Non-goals

- Interpreting Bible/Mail path segments.
- Server redirects.

---

## 4. Core: NavigationMapStore

**Path:** `src/core/navigationMap.ts`

### Responsibilities

- Hold the current `NavigationMap` from the last successful refresh/open.
- `lookup(fromNodeId, navKey) → NavEdge | undefined`.
- `replace(map)` on every successful apply.
- Normalize chord keys (e.g. Ctrl+Right → `ctrl+right`).

### Edge cases

| Case | Behavior |
|------|----------|
| Empty map | All keys no-op until refresh fills map |
| Edges for non-current nodes | Allowed; enables rapid local hops |

### Non-goals

- Validating that `toNodeId` exists in warm (Navigator handles miss by blocking).

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
| App switch | Clear cache (Router/Navigator coordination) |
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

- `pop` when stack length is 1: after pop, stack is empty—Router/Navigator should not leave the user nowhere. **Apps MUST offer root Left as URL to Home** before the user is stuck. If a buggy app pops the last entry without a url edge, core recovers by `open(Home)`.
- Recommended invariant: never complete a `pop` edge that empties the stack without immediately opening Home; prefer treating empty-after-pop as `open(Home)`.

### Non-goals

- Storing multiple apps’ histories (cleared on app switch by design).

---

## 7. Core: Navigator

**Path:** `src/core/navigator.ts`

### Responsibilities

- Orchestrate key → map → stack → display → refresh.
- Track `busy` / `blocked` and refresh **generation** (tip id + monotonic token).
- Apply `RefreshResult` to map, cache, stack tip label/shareUrl, display, address bar.
- Read input text from Display when `passInputText` is set.

### Key handling algorithm

```text
onNavKey(key):
  if blocked: return
  if tip.kind == input and key is plain arrow: return // caret handled by Display
  edge = map.lookup(tip.id, key)
  if !edge: return  // silent no-op

  extras = {}
  if edge.passInputText and tip.kind == input:
    extras.inputText = display.getInputText()

  if edge.kind == "url":
    router.open(edge.url, extras)
    return

  // node edge
  if edge.stackBehavior == "pop":
    popped = stack.pop()
    if stack.isEmpty(): router.open(HOME_URL); return
    destId = stack.tip.nodeId
  else if edge.stackBehavior == "push":
    destId = edge.toNodeId  // required
    // push happens after we know payload label (from warm or after refresh)
  else: // replace
    destId = edge.toNodeId

  payload = cache.get(destId)
  if payload:
    applyLocalMove(edge.stackBehavior, payload)  // update stack + display
    startRefresh(stack.snapshot(), extras)
  else:
    blocked = true
    // tentatively adjust stack for push/replace using destId with placeholder label?
    // SPEC: no placeholder text — wait for refresh before changing display.
    // Stack update timing: update stack to dest, keep showing old text until refresh
    // OR don't update stack until refresh. Prefer: update stack to intended dest ids,
    // keep previous visible label until result.node arrives, then show result.node.
    startRefresh(...); on result: applyRefresh; blocked = false
```

**Local move vs refresh authority:** After warm hit, display `payload.label` immediately, then refresh may replace tip with `result.node` (same id or stale fallback). Do not teleport to an unrelated workflow destination.

### Address bar

- If `result.url` is a non-empty string → set hash/share URL (via Router helper).
- If null/undefined → leave address bar unchanged.

### Refresh failure

- Log/debug as appropriate.
- `blocked = false`, busy clear.
- Display unchanged.
- Map/cache unchanged (last good).

### Stale refresh

- When starting refresh, record `startedTipId` (+ generation).
- On completion, if current tip id ≠ `startedTipId`, discard result entirely.

### Non-goals

- App domain logic.
- Automatic multi-level warm expansion.

---

## 8. Core: Display

**Path:** `src/core/display.ts`

### Responsibilities

- Render exactly one interactive surface.
- `showText(label)` for `kind: "text"` (default).
- `showInput(initialText)` for `kind: "input"`; expose `getInputText()`.
- Focus management on load and when switching text ↔ input.
- Announce updates (`aria-live` assertive default).

### Edge cases

| Case | Behavior |
|------|----------|
| Long label | Single blob; no truncation required in MVP |
| Switch text → input | Replace surface; focus input |
| Switch input → text | Replace surface; focus live region |

### Non-goals

- Multi-field forms, visible chrome, Escape-to-blur platform behavior.

---

## 9. Core: Keyboard

**Path:** `src/core/keyboard.ts`

### Responsibilities

- Listen to keydown on window/document as appropriate.
- Map event to `NavKey` (arrows, ctrl+arrows, future chords).
- If Display tip is input and key is plain arrow: do not call Navigator (native caret).
- If chord matches a potential nav key: `preventDefault` and call Navigator (Navigator no-ops if no edge).
- If blocked: ignore nav keys.

### Non-goals

- Defining app-specific chords beyond delivering normalized key ids (apps author edges for those ids).
- Escape exits input (explicitly **not** supported).

---

## 10. App kit (optional shared library)

**Path:** `src/app-kit/`

Navigator **never** imports these for automatic behavior. Apps may import freely.

### Proposed helpers

| Helper | Purpose |
|--------|---------|
| `edgeNode / edgePop / edgeUrl` | Construct `NavEdge` values; `edgePop` omits `toNodeId` |
| `siblingListEdges(ids, opts)` | Up/Down `replace` edges; `wrap?: boolean` |
| `standardInputChords(inputId, { forward, back })` | Ctrl+Right (+ `passInputText`) / Ctrl+Left |
| `rootLeftToHome(rootId, homeUrl)` | Left url edge to Home |
| `collectNeighborhood({ tipId, neighbors, payload, depth, maxNodes })` | Callback-driven walk → warm payloads + map fragment |
| `homeEnterUrl(appId)` | Build `#/a/<appId>` enter URL |

### Non-goals

- Knowing Bible/Mail schemas.
- Talking to Navigator internals.

---

## 11. App: Home (`id: "home"`)

### Responsibilities

- `open` / `refresh`: present sibling list of enabled apps from `AppRegistry.listEnabled()` (inject registry via closure at construction).
- Each app label is a node; **Right** (and optionally the whole node as enter) is `kind: "url"` to that app’s enter URL.
- Up/Down among app labels with `replace` (wrap optional—Home SHOULD wrap for a short list).
- Left at home root: missing edge or no-op (already home).
- Optional Help node (text with keyboard explanation) as sibling or child.

### Must not

- Embed other apps’ internal node ids.
- Special-case Bible/Mail beyond registry labels/ids for URL construction.

---

## 12. App: Bible (`id: "bible"`)

### Responsibilities

- Own KJV data (static JSON or equivalent).
- Graph: Testament → book → chapter → verse → option nodes (Copy, Commentary stub).
- `open(path)` parses canonical verse/book paths; bootstrap stack tip = resolved node (stack may be single leaf after open reset—app still exposes internal pops via map for in-app history after the user pushes deeper in-session).
- After open, user builds in-app stack via `push` edges; Left `pop` within bible; root Left `url` to Home.
- Copy: Right onto Copy/status node; refresh performs clipboard write; label becomes success/failure; user leaves explicitly.
- Warm + map: use app kit neighborhood helper or hand-built edges for nearby books/chapters/verses as appropriate.
- Search (optional/later): input node → results list as normal nodes in warm/map; client warm holds the hit list.

### Domain-only

- Chapter/verse joins, KJV indexing—never core.

---

## 13. App: Demo mail (`id: "mail"`)

### Responsibilities

- In-memory sample messages; no network.
- Inbox list, message body, compose instruction → input → send/status nodes.
- Compose: input node; Ctrl+Right with `passInputText` to send/status; Ctrl+Left back.
- Send tip refresh: may show “Sending…” from warm then “Sent” / error in place; edges back to inbox or pops—**no stack teleport**.
- Root Left → Home URL.

### Non-goals

- OAuth, real SMTP/IMAP, server cache (until a real mail app exists).

---

## 14. Future app: Notes (non-MVP)

### Fit check

Must work as `AppModule` only: list/create/edit via text + input nodes, save status nodes, optional share URLs, root Left to Home, durable storage **behind** the app or future generic platform storage—not `NotesRepository` in core.

---

## 15. Shell bootstrap

**Path:** `src/shell/` + `main.ts`

### Responsibilities

- Construct registry; register Home, Bible, Mail.
- Construct cache, map store, display, navigator, router, keyboard.
- Pass Home a registry reference or `listEnabled` callback.
- Initial `router.open` from `location.hash` or Home default.
- Focus display on load.

### Non-goals

- Feature flags UI, app store UI.

---

## 16. Cross-cutting open items (documented, not implemented as locks)

| Item | Notes |
|------|-------|
| Browser Back/Forward vs session stack | Hashchange → open is enough for MVP; deeper sync deferred |
| Server session TTL / auth | App/backend; platform context seam reserved empty |
| Warm etags | Deferred |
| aria-live assertive vs polite | Default assertive; revisit in a11y pass |
| Home URL canonical form | `#/` vs `#/a/home` — choose at scaffold |

---

## 17. Implementation order (when coding)

1. Types + registry + cache + map store + stack  
2. Display + keyboard (text only)  
3. Navigator + Router with a tiny fake app  
4. App kit edge helpers  
5. Home app  
6. Bible app + data  
7. Mail demo + input nodes  
8. Tests per ARCHITECTURE testing contracts  
9. Accessibility pass  
