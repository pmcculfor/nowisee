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

- `parse(href) → AppLocation`.
- `hrefFor(location) → string` — **the only place in the codebase that produces a `#/...` string.** `location.path` must already be canonical (non-empty, starts with `/`); hrefFor does not rewrite empty or unslashed paths.
- `setAddressBar(location)` — write the address bar without triggering a reopen.
- Subscribe to `hashchange` for external URL changes: parse and hand the location to `Navigator.openLocation`. **Interaction with browser Back/Forward beyond “hashchange → openLocation” is deferred** (open item); do not invent session-stack sync yet.

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
- `replaceTip` refuses when the stack is empty (callers that mean push must `push`).
- Tip = last entry.

### Pop rules

- `pop` when stack length is 1: Navigator must not leave the user nowhere. **Apps MUST offer root `back` as an `app` edge to `config.rootAppId`** before the user is stuck. If a buggy app authors a `pop` on the last entry, core recovers by calling `openLocation({ appId: config.rootAppId, path: "/" })` **without popping first**, so a failed recovery leaves the last screen intact.

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
```

`openLocation(location, extras)` increments the token, sets `blocked = true`, and calls `app.open(location.path, extras)` **without** discarding the current session first. On success it then clears stack, cache, and map, sets the current app, and applies. On failure it unblocks and leaves stack, cache, map, and display as they were. Unknown `appId` still resolves to `config.rootAppId` with path `/`. A known app with a non-canonical path is a silent no-op.

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
- Core never re-issues that call — no automatic retry, no replay after a discarded result, no repeat on later revalidation. A failed action is re-triggered by the user pressing the intent again.
- Core may coalesce or debounce read-only revalidations (holding `next` through a long list should not issue one call per row). Action calls are never coalesced or dropped.

### Address bar

- If `result.location` is an `AppLocation` with a canonical path → `router.setAddressBar(location)`.
- If `result.location` is null → leave the address bar unchanged.
- Omitting the field is not allowed.

### Refresh failure

- Log/debug as appropriate.
- `blocked = false`, busy clear.
- Display, stack, map, and cache unchanged (last good).
- Note: with no status channel in MVP, a rejected action call leaves the user reading "Sending…" indefinitely. This is why apps **MUST** resolve with a status node instead of rejecting. Distinguishing busy / dead-end / failure for the user is deferred — see [`DESIGN-REVIEW.md`](DESIGN-REVIEW.md) §6.

### Non-goals

- App domain logic.
- Automatic multi-level warm expansion.
- Parsing or building URLs (Router).

---

## 8. Core: Display

**Path:** `src/core/display.ts`

### Responsibilities

- Render the current tip.
- `showText(label)` for `kind: "text"` (default) — remount + focus a `role="application"` surface so NVDA / JAWS / VoiceOver pass arrow keys to the page. Set `aria-label` to the same string as the visible text: NVDA treats application as a named widget and otherwise announces only "application".
- `showInput(initialText, options?)` for `kind: "input"` — a native `<textarea>` (Enter = newline) plus **Cancel** (`back`) and **Done** (`enter`) buttons after the field; expose `getInputText()`. When `options.secret` (or `NodePayload.secret`) is set, render `<input type="password">` and set `autocomplete` from the payload (`username` / `current-password` / `new-password` / `off`). Buttons activate on click only, never on focus.
- Focus management on load and when switching text ↔ input.
- **Announce via focus only** — the text surface is a focusable `tabindex="-1"` node with **no** `aria-live`. Combining a live region with `focus()` double-speaks on VoiceOver iOS (live insertion + focus announcement).
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
- A second SR-only status channel (deferred — see DESIGN-REVIEW §6).

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
- Touch / VoiceOver delivery (owned by NavPads, §9b).

---

## 9b. Core: NavPads

**Path:** `src/core/navPads.ts`

VoiceOver on iPhone owns gestures, so arrow keys are not available. NavPads are large edge buttons that deliver the same four intents when accessibility focus lands on them, and again on `click` (sighted tap or VoiceOver double-tap activate). A `focusin` that already fired an intent suppresses only the click that follows on that same button (one gesture). There is no time delay and no lockout of a later activation.

### Responsibilities

- Mount four native `<button type="button">` elements (top / bottom / left / right).
- Name each via `aria-label` only (`Previous` / `Next` / `Back` / `Enter`); no nested text VoiceOver can stop on separately.
- Listen for `focusin` and `click` on those buttons only; call `navigator.onIntent(intent)`.
- If blocked: ignore.
- Overlay the reading surface (pads may cover text); do not reserve a layout gutter that squishes the label.
- Hidden while Display is in input mode (`data-input-open` on the mount) so they cannot cover Cancel / Done or fire on explore-by-touch.

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

- `announce`, `requestRefresh` — declared in the type, **not provided in MVP**.
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
| `inputEdges(inputId, { commitTo, backTo })` | `enter` (+ `passInputText`) commits; `back` abandons (`backTo` is a node id or `"pop"`) |
| `rootBackToHome(rootId, rootAppId)` | `back` app edge to the root app |
| `collectNeighborhood({ tipId, neighbors, payload, depth, maxNodes })` | Callback-driven walk → warm payloads + map fragment |
| `buildMap(fragments)` | Assemble the nested `fromNodeId → intent → edge` structure |
| `signedOut({ accountAppId, rootAppId, text })` | Complete `RefreshResult` for a signed-out user-scoped app |

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
- Catalog order is registration order minus Home. Help is registered first among peers so it is the first Home item.

### Must not

- Embed other apps’ internal node ids.
- Special-case Bible/Mail/Account/Help beyond registry labels/ids for URL construction.
- Rewrite a peer app’s catalog label. Home shows `AppDescriptor.label` as registered.
- Keep a private Help node. Help is an app.

---

## 12b. App: Help (`id: "help"`)

Ordinary `AppModule`. No database. Catalog label is **Help. Tap the right side of the screen or press the right arrow to enter.** so a first-time visitor hears how to open it from Home.

### Responsibilities

- Tip: welcome (Now I See; one item per page; tap edges or arrow keys). `enter` → a back-practice node (`back` pops to welcome). `enter` from there → four sibling list items that wrap `next` / `prev`.
- Only the **fourth** list item has `enter` → typing prompt → input node. The first three list items have no `enter` edge. Done (`enter`, `passInputText`, no `action`) → a closing node that quotes what they typed and sends them Home. Cancel (`back`) returns to the prompt.
- Closing node `enter` and `back` are `app` edges to Home.
- Welcome `back` is an `app` edge to Home.

### Must not

- Live on Home as a special node.
- Bind keystrokes; intents only.

---

## 13. App: Bible (`id: "bible"`)

### Responsibilities

- Own Bible data via `BibleStore` (SQLite, version + book + chapter + verse). Seed KJV from JSON on first open of an empty Bible file.
- Graph: version root headings (Old Testament, New Testament, Bookmarks stub, Search stub) → book → chapter → verse → option nodes (Copy, Bookmark stub, Commentary stub).
- Book lists, chapter lists, and verse lists wrap at the ends. Verse `next` / `prev` stay in the chapter (last verse → first verse of the same chapter, and the reverse). They do not join the next or previous chapter.
- Chapter labels are `N (chapter)` (number first); verse labels are `N. text` only. Copy still writes `Book C:V. text`.
- Chapter → verse uses `replace` (not `push`); verse `back` replaces to that verse’s chapter so a deep-linked verse still has a chapter to return to.
- `open(path)` parses canonical verse/book paths; bootstrap stack tip = resolved node (stack may be a single leaf after open reset—the app still exposes internal pops via map once the user pushes deeper in-session).
- After open, user builds in-app stack via `push` / `replace` edges; `back` = `pop` or chapter `replace` within bible; root `back` = `app` edge to the root app.
- Copy: the `enter` edge from the Copy option carries `action: true` and lands on a status node whose warm label is “Copying…”; the resulting refresh (the only call with `extras.action`) returns `clipboardText` (the line `Book C:V. text`) and “Copied”, or an error label with no `clipboardText`. Core writes the clipboard. `prev` / `next` over the Copy option carry no flag and therefore do nothing.
- Warm + map: use app kit neighborhood helper or hand-built edges for nearby books/chapters/verses as appropriate.
- Search and bookmarks: headings and verse-menu options exist as stubs ("not available yet"). Schema already has `bookmarks`, `search_queries` / `search_hits` (session-scoped), and commentary tables. Do not implement those features in this module's current slice.

### Domain-only

- KJV indexing—never core.

---

## 14. App: Gmail (`id: "gmail"`)

Ordinary server `AppModule`. Gmail REST + MIME live in the app. Tokens via `ctx.oauth` (host lockbox). Cache and compose drafts in `data/apps/gmail.db`. See [`GMAIL.md`](GMAIL.md) and [`STORAGE.md`](STORAGE.md).

### Signed out

`ctx.userId` is null. Tip: **Sign in to use Gmail.** `enter` → Account. `back` → Home.

### Signed in, not connected

Tip: **Connect Gmail.** `enter` is `kind: "external"` to Google’s authorize URL (`ctx.oauth.start`). `back` → Home. After Google redirects to `GET /oauth/callback`, the host stores the refresh token and 302s to `/#/gmail`.

### Connected

- Open `/`: first inbox subject, or **Compose** if empty. List: Disconnect, Compose, then up to 20 INBOX subjects (no wrap). Root `back` → Home.
- Enter a subject **pushes** body chunk 1 (plain text, split by [`splitText`](../src/app-kit/splitText.ts)). Chunks are siblings. `back` pops. No reply/forward.
- Compose: instruction node then input for To, Subject, and Body (`action` + `passInputText` on each Done). Send stays on **Sent** / error in place — **no stack teleport**. Cancel walks back without sending.
- Disconnect: `action: true` → `ctx.oauth.disconnect` + clear cache → **Gmail disconnected.**
- `invalid_grant` / unauthorized → Connect node. Side effects only when `extras.action` is true.
- Owner: this `userId` → `getAccessToken("personal")` → `users/me`. Message ids on the stack are untrusted.

### Non-goals (v1)

Reply/forward, `requestRefresh`, Pub/Sub, search, labels, attachments, HTML formatting, multiple Google accounts.

---

## 15. App: Notes (`id: "notes"`)

Ordinary server `AppModule`. Persistence is `NotesStore` on Notes' own SQLite file (`data/apps/notes.db`). Every store method takes `ownerId` (`ctx.userId`); the host does not inject the store. See [`STORAGE.md`](STORAGE.md).

### Signed out

`ctx.userId` is null. Tip: **Sign in to use Notes.** `enter` → `app` edge to `ctx.accountAppId`. `back` → Home. No notes are listed or created. Ownership is never `sessionId`.

### Signed in

- Open `/`: tip is the most recently edited note if any, otherwise **Create a note**. Prev from that first note reaches Create. Create has no prev; the oldest note has no next (no wrap).
- List order: **Create a note**, then notes sorted by `updatedAt` descending.
- List tips show the **first line** of each note body (empty → “Empty note”).
- Enter on Create or a note → input tip with the full body (multiline field). **Done** (`enter`) commits with `passInputText` + `action: true`; **Cancel** (`back`) returns to the list/create node without saving.
- Side effects (create/update) run **only** when `extras.action` is true.
- Resolve stack node ids with the owner in the query. A note the user does not own is the default list tip, not a confirmation that it exists.
- Root list tips: `back` is an `app` edge to Home.

### Non-goals

- Shared multi-device sync beyond this server file, rich text, folders, delete.

---

## 15b. App: Account (`id: "account"`)

Ordinary `AppModule`. Credentials and sessions are **not** here — they live in `server/identity/`. The app receives `ctx.identity` only because the host grants it to this app id.

### Signed out

- Tip: **Sign in or register**. `enter` → “Please enter your email on the next screen.” → email input (`autocomplete=username`). Email Done (`action` + `passInputText`) → “Please enter your password on the next screen.” → password input (`secret`, `autocomplete=current-password`). Password Done (`action` + `passInputText`) → warm **Signing in…**, then **You are signed in as …** (enter/back → Home) or **Sign-in was unsuccessful.** (enter/back → `pop` to the same password input).
- Combined register then sign-in on `email-taken`. Email is stored against `sessionId` in `account_flow`, never in a node id, label, or URL.
- Root `back` → Home.

### Signed in

- Tip: **Settings** (placeholder, no enter). `next` → **Sign out**. Sign-out `enter` is `action: true` to a status node; after the action, enter/back are `app` edges to Home (clears client cache).
- Home lists this app as **Account**, the same registered label as every other app, signed in or out. The host does not rewrite catalog labels.

---

## 16. Shell bootstrap

**Path:** `src/shell/` + `main.ts`

### Responsibilities

- Build `ShellConfig` (`rootAppId`, optional `keyBindings`). Core files never name an app.
- Construct registry; register remote stubs for Home, Help, Bible, Notes, and Account (`createRemoteApp`).
- Inject `AppRpc` (default: POST `/api/apps/:id/…`; tests pass `createAppHost`).
- Construct cache, map store, display, navigator, router, keyboard, platform capabilities.
- Initial `navigator.openLocation(router.parse(location.hash) ?? rootLocation)`.
- Do **not** call `display.focus()` again after open resolves — `showText` / `showInput` already focused; a second focus restarts VoiceOver.

### Non-goals

- Feature flags UI, app store UI.

---

## 17. Cross-cutting open items (documented, not implemented as locks)

| Item | Notes |
|------|-------|
| Browser Back/Forward vs session stack | Hashchange → `openLocation` is enough for MVP; deeper sync deferred |
| Server session TTL / auth | Landed on the host (identity service + Account). Not a client platform capability. See [`IDENTITY.md`](IDENTITY.md) |
| Warm etags | Deferred |
| aria-live assertive vs polite | **Settled:** neither — announce via focus only; no `aria-live` on the content surface (VoiceOver iOS double-speaks live+focus) |
| Busy / dead-end / failure are indistinguishable to the user | Accepted for MVP; status channel deferred (review §6) |
| Screen-reader browse mode eating arrows | Spike deferred; DOM strategy settled during implementation (review §7) |
| Deep-link ancestry | Deferred; optional `stack` on `open` is additive (review §8) |
| Contract versioning + unknown-value fallbacks | Deferred until third-party apps (review §11) |
| Validating / bounding app responses | Deferred; first-party apps only (review §12) |
| Actual sandboxing (worker / iframe / server apps) | Deferred; §10 keeps the boundary message-shaped so it stays possible (review §5) |
| `announce` / `requestRefresh` | Declared, not provided in MVP |
| Home URL canonical form | `#/` canonical; `#/<rootAppId>` may alias |

---

## 18. Implementation order (when coding)

1. Types + config + registry + cache + map store + stack  
2. Display + keyboard binding table (text only) + platform context (clipboard)  
3. Navigator (transitions, token, action flag) + Router boundary, with a tiny fake app  
4. App kit edge helpers  
5. Home app  
6. Bible app + data  
7. Gmail app + input nodes + action edges  
8. Tests per ARCHITECTURE testing contracts  
9. Accessibility pass (settles the deferred items in §17)  
