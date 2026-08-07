# Nowisee — product & architecture specification

**Audience:** planning/building agents with zero prior chat context.  
**Status:** Product/architecture **what** is locked (post adversarial review, then post longevity review). Contracts: [`ARCHITECTURE.md`](ARCHITECTURE.md). Module specs: [`MODULES.md`](MODULES.md). Review findings and deferrals: [`DESIGN-REVIEW.md`](DESIGN-REVIEW.md). Engineering proposals: [`ENGINEERING.md`](ENGINEERING.md).

---

## 1. What this product is

**Nowisee** is a website for blind (and screen-reader / keyboard-primary) users who struggle with modern, cluttered UIs.

**Core UX idea:** the page shows **one unformatted text surface** — no pictures, menus, cards, or competing chrome. When the current node is a normal text node, that surface is the node’s label. When the current node is an **input** node, that surface is a single input box. Navigation is driven by a **navigation map** of four intents — `prev`, `next`, `enter`, `back` — which core binds to `Ctrl+Alt+Shift`+arrows by default (and to VoiceOver edge pads on focus or click) and which a user or locale can rebind without any app changing.

**Why it exists:** typical sites force tabbing through chrome or exploring by touch. Users cannot quickly find content. Nowisee makes the reading cursor and the UI the same thing: whatever is on screen is what matters.

**MVP apps (portable `AppModule`s, including Home):**

1. **Home** — lists enabled apps; links to each by URL.
2. **Bible** — King James Version (public domain): Testament → book → chapter → verse → options (e.g. Copy, Commentary stub); search can be added as ordinary nodes.
3. **Demo mail** — fake inbox, sample emails, compose stub (not real Gmail/OAuth).

**Later apps (must fit the same contracts with no core special cases):** e.g. **Notes** (create, list, open, edit).

**Long-term:** many apps; possibly third-party apps and an in-product App Store. Core must never special-case product names.

**Quality bar:** prefer robust, generic, long-term design over shipping fast. Incomplete is OK; sloppy, duplicated, or product-specific core design is not.

---

## 2. User-visible navigation

Apps author **intents**. Core owns which keystroke produces each one (defaults in [`MODULES.md`](MODULES.md) §9).

| Intent | Default input (text and input tips) | Typical meaning (authored by apps via navigation map) |
|--------|-------------------------------------|--------------------------------------------------------|
| `prev` / `next` | `Ctrl+Alt+Shift+ArrowUp` / `ArrowDown`; VoiceOver pads top / bottom | Move among siblings (`stackBehavior: replace`) |
| `enter` | `Ctrl+Alt+Shift+ArrowRight`; VoiceOver pad right | Enter / follow (`stackBehavior: push`); also the deliberate trigger for actions |
| `back` | `Ctrl+Alt+Shift+ArrowLeft`; VoiceOver pad left | Inside an app: usually history back (`stackBehavior: pop`). At app root: **`app` edge to Home** |
| plain arrows on an **input** tip | unbound | Caret keeps them. Leave input via the same `enter` / `back` intents as everywhere else. |
| Missing map edge | — | Silent no-op (stay) |

Nothing above is visible to an app: an app that ships today keeps working if the bindings change, if the user remaps them, or if edge pads / other modalities deliver the same intents.

**Display:** one text blob or one input box. Screen reader announces updates via one live/focus region. Help lives **in the tree** as nodes, not modals.

**Example paths:**

- Home shows “Bible” → `next` might show “Mail” → `enter` opens the Bible app via an `app` edge.
- Bible → `enter` → “Old Testament” / `next` → “New Testament” → … → verse → `enter` → “Copy” / `next` → “Commentary”.
- Mail → Inbox → subjects → body → options; Compose uses an **input** node; `enter` commits toward Send/status.

---

## 3. Architecture — layers and ownership

| Layer | Owns | Must not own |
|-------|------|----------------|
| **Display** | One surface (label or input) + a11y announce | Graphs, apps, keys |
| **Keyboard** | The physical binding table; resolve keystroke + tip kind → intent | App business rules; which intents exist in a map |
| **Router** | Translate browser URL ↔ `AppLocation`; the only producer of `#/…` strings | Any state; applying results; app path meaning |
| **Navigator + stack** | **Every** state transition: per-app stack, map edges, busy/block, transition token, refresh calls, warm/map merge, address bar | Choosing graph content; prefetch depth policy |
| **NodeCache (client warm)** | Store payloads apps returned; pin stack entries | Server cache; inventing fetches |
| **Navigation map store** | Current edge table from last refresh | Authoring edges |
| **AppRegistry** | id → AppModule | App internals |
| **App kit** | Optional shared helpers apps import | Automatic Navigator behavior |
| **Apps** | Graph, labels, edges, warm, locations, side effects, stale handling | Keystrokes, URL strings, global cache radii |

**Mental model:** Core is a **shell for a text-node browser**. Apps are **authorities** that answer `open` / `refresh`. Home is an app. Cross-app movement is by `app` edge only.

```text
Core ──open/refresh(+action?)──► AppModule
     ◄── map + warm + tip + location ──
```

---

## 4. Locked decisions and why

### 4.1 Portable apps by id (Home included)

**Decision:** Apps register as `AppModule` with stable `id` + `label`. Home is an app that lists others and links by `app` edge. No core `BibleRepository` / `MailRepository`. Home must not embed foreign **node** ids—only locations. Core identifies Home through `config.rootAppId`; no core file names it.

**Why:** Many apps and possible third-party/App Store later.

### 4.2 `open` + `refresh` (not `navigate(action)` as primary)

**Decision:** Core follows the **navigation map** locally when possible, then calls `app.refresh(stack, extras)`. Cold start and all location transitions go through `navigator.openLocation` → app `open` bootstrap. The app returns a new navigation map, warm nodes, the authoritative tip, and an optional location.

**Why:** Instant UI from warm + map; one app call shape; stack tip encodes where the user is; app revalidates every time.

**Rejected:** Core computing next ids (`provide(nodeId)`); core-driven prefetch radii; `navigate(action)` as the only path without a map.

### 4.3 Navigation map

**Decision:** Edges keyed by `(fromNodeId, intent)` where `intent` is `prev | next | enter | back` (or an app-defined symbolic intent), **never a keystroke**.

- `kind: "node"` + `stackBehavior: push | replace | pop`
- `kind: "app"` → an `AppLocation` inside Nowisee; core serializes it
- `kind: "external"` → leaves the platform
- Optional `passInputText` on edges leaving an input node
- Optional `action: true` marking a deliberate trigger (§4.5)
- On `pop`: **omit `toNodeId`**; destination is stack tip after pop
- Missing edge: silent no-op
- Apps may publish edges for nodes other than the current tip (multi-hop locally)
- Map structure is nested (`fromNodeId → intent → edge`) so no delimiter can collide with app-owned ids

**Why:** Rapid keys stay coherent; stack rules are data; cross-app exits do not require foreign node ids.

**Why intents rather than keystrokes:** the keystroke is an input-device detail and the map is app semantics. Fusing them would mean that touch/mobile, user-remappable keys, switch and voice input, braille panning, and right-to-left locales each require rewriting every app ever shipped. With intents, all of those are edits to one table in core.

**Rejected:** `NavKey` values like `"ctrl+right"` in app data. Also rejected as a *default binding*: Ctrl+Left / Ctrl+Right on input nodes, which are word-wise caret movement on every major platform.

### 4.4 Per-app stack; URL open resets stack

**Decision:** The session stack holds only node ids for the **current app**. Every location open (including same-app jumps and returning to Home) goes through `navigator.openLocation` and **resets** that app’s stack, then bootstraps with `open`.

**Why:** Stacks never mix apps; cross-app is URL; history back (`pop`) stays inside one app.

### 4.5 No separate `activate()`; effects are marked on the **edge**

**Decision:** Side effects (copy, send) still happen inside an ordinary `refresh` on an ordinary node — there is no `activate()` call and no action edge *kind*. The app marks the single edge that constitutes the button press with `action: true`. Core sets `extras.action` on exactly the call caused by traversing that edge, and on no other call. Warm may show “Sending…” and the resulting refresh updates to “Sent” **in place**.

- App: marks the trigger edge; performs effects only when `extras.action` is true.
- Core: sets the flag on that one traversal; never on bootstrap, revalidation, replay, or retry; never re-issues, retries, aborts, or coalesces an action call.

**Why:** the effect is now tied to a *transition the user deliberately made*, not to a node merely being current. Three failure modes disappear by construction rather than by author discipline:

| Failure | Why it cannot happen |
|---------|----------------------|
| Browsing sibling options fires Copy | `prev` / `next` edges carry no flag |
| Warm-hit background revalidation re-sends | Revalidation carries no flag |
| Returning to a status node replays the effect | Ordinary edges carry no flag |

Rapid double-press is naturally safe: after the local move the tip is the status node, and the trigger edge belonged to the previous node.

**Rejected:** an `activate()` API; an `action` edge *kind* (it would duplicate `node` and `app` edges); and a richer `reason` / `requestId` protocol on every refresh — the edge flag covers the only case where the distinction was load-bearing, at a fraction of the complexity.

### 4.6 No silent teleport; no auto-dismiss

**Decision:** Apps must not rewrite the stack to jump the user (e.g. to inbox after send). Status/confirmation text stays until the user presses a mapped key. Refresh may update the **current tip’s text** in place.

**Why:** Blind users must not have location change without an explicit key.

### 4.7 Prefetch = app-pushed warm + map edges

**Decision:** Each refresh returns `warm` and a full navigation map. Core replaces the warm set (pinning stack payloads) and replaces the map. Core does not apply siblingRadius/childDepth.

**Why:** Only the app knows what is cheap/valuable. Optional **app kit** helpers may BFS with app callbacks—never automatic in Navigator.

**Concurrency:** Navigator owns one monotonic transition token. A result is applied only if its token is the newest issued; comparing tip ids is not sufficient, because `prev` then `next` returns to the same id and would let a stale result through. Superseded read-only calls are aborted via `extras.signal`; action calls are never aborted, only their results discarded.

### 4.8 Input nodes

**Decision:** Input is a node type (single input box). Leave only via navigation-map edges — the same `enter` / `back` intents used everywhere else, bound to the same non-caret chord (and edge pads) as on text tips so plain arrows keep driving the caret. **No Escape-to-exit** platform behavior. Behavior is derived from tip node type, not a separate Escape-toggled mode.

**Why:** One consistent exit vocabulary, and apps author the same four intents whether the tip is text or input.

### 4.9 Addressing

- Apps address `AppLocation` (`{ appId, path }`). **Core alone** turns that into a browser URL, so the hash-vs-path decision, a sub-path mount, or a locale segment never reaches app code.
- Shareable tips **may** return a location from refresh; not required for every node.
- Aliases OK; app canonicalizes on open.
- Null/omit location → core **keeps** the previous address bar.
- Cross-app and Home exit: `kind: "app"` edges only. `kind: "external"` leaves the platform.

### 4.10 App boundary: data in, data out

**Decision:** `open` / `refresh` is a **message protocol that currently runs in-process**. Everything crossing it — stack, input text, node payloads, navigation map, result, location — must be plain data that would survive being serialized and sent as a message. The only non-data things core passes are the abort signal and a **platform context**, and both have message-based equivalents.

Browser operations core can mediate go through that platform context, not through app code: clipboard in MVP; durable storage, screen-reader status, and app-initiated refresh are declared but not provided yet. The registry hands Home plain `{ id, label }` descriptors, never the registry object.

**Why:** the roadmap includes third-party apps and an App Store, and code we did not write cannot share a page with everyone's data. The realistic containment is a worker, an iframe, or a server, and all three exchange messages rather than objects. Keeping the boundary message-shaped now costs nothing and preserves that option; letting apps quietly depend on being in-page forecloses it.

**This is a discipline, not a sandbox.** No isolation is being built. See [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`MODULES.md`](MODULES.md) §10.

**Immediate payoff:** the clipboard. Browsers only permit a write while the user's keypress is still fresh, so an app calling `writeText` after an async refresh fails intermittently. Core traverses the action edge inside the keydown, so core is the only party that can open the write in time. Apps call one method and never see the problem.

### 4.11 Client vs server cache

- **Client warm:** core NodeCache as above.
- **Server/durable cache:** behind the app (or its API). Not core. HTTP cookies are set by servers when backends exist; shared login will arrive as a platform capability.

### 4.12 Sibling list ends

**Not locked to wrap.** Each app authors edges (wrap, stop, or other). Earlier “always wrap” is retired.

### 4.13 Busy / blocking / errors

| Case | Behavior |
|------|----------|
| Open/bootstrap or map target not in warm | Block on refresh; ignore further intents; no placeholder |
| Warm hit | Show immediately; background refresh; allow further map hits; discard any result whose transition token is not the newest |
| Refresh failure | Keep last text; clear busy; do not crash shell |
| Missing edge | Silent no-op |

**Known MVP limitation:** those first three states are indistinguishable to a user who cannot see a spinner — blocked, dead-end, and failed all present as silence. Accepted for MVP; a status channel is deferred (see [`DESIGN-REVIEW.md`](DESIGN-REVIEW.md) §6). This is also why apps MUST resolve with a status node rather than reject: a rejected action call otherwise strands the user on “Sending…”.

### 4.14 Auth / database

Not in MVP. Clipboard is the only platform capability provided now (§4.10). Auth, durable storage, and shared login arrive later on that same seam — still no app-named core repositories.

### 4.15 MVP scope

Home + real KJV Bible + basic demo mail. No real Gmail. Notes is a planned future app, not MVP.

---

## 5. Recommendations for app authors (SHOULD)

1. **Runtime-unknown next node:** Temporary warm node + edge; replace content on refresh.
2. **List ends:** Choose wrap/stop/message; do not assume platform wrap.
3. **Action / send / copy:** Put `action: true` on the `enter` edge into a status node; “Sending…” → “Sent”/error in place; leave only via mapped intents; never silent stack jump. Resolve with an error label rather than rejecting — a rejected action call strands the user on “Sending…”.
4. **Leaving the app:** Root `back` MUST be an `app` edge to Home.
5. **Input:** Instruction node → input node; `enter` with `passInputText` to commit; `back` to abandon.
6. **Addressing:** Stable canonical location when bookmarkable; omit/null for status tips that should not change the bar (this also stops a reload from re-entering an action node).
7. **Prefetch:** Publish likely edges + warm payloads.
8. **Home:** Labels + `app` edges only.
9. **App kit:** Prefer shared helpers for edge/list/input/neighborhood boilerplate.
10. **Intents only:** Never assume a keystroke, a direction, or a screen.
11. **Plain data only:** Return nothing that would not survive being sent as a message.
12. **Platform capabilities:** Use `extras.platform` for clipboard and (later) storage; feature-detect before calling; never touch browser APIs directly.

---

## 6. Roadmap

1. Persist handoff + adversarial locks in-repo — **this revision**.
2. Scaffold core + app kit + Home/Bible/Mail modules.
3. Accessibility pass (SR + keyboard).
4. Later: persistence, auth, real mail, notes, App Store groundwork; browser Back/Forward policy.

---

## 7. Deferred (must preserve contracts above)

- UI toolkit, bundler, hosting vendor (see ENGINEERING proposals)
- Exact path syntax per app (behavior locked; shapes app-owned)
- IndexedDB / service worker
- Dedicated Home intent
- Browser Back/Forward vs session stack (narrow core item later)
- Server session TTL, cache keys, auth provider
- Warm etag/hash protocol
- Real auth, DB, real mail, commentary sources, notes storage

Deferred with a known cost, each recorded in [`DESIGN-REVIEW.md`](DESIGN-REVIEW.md) with the argument for and against:

| Deferred | Cost of deferring | Additive later? |
|----------|-------------------|-----------------|
| Status channel distinguishing busy / dead-end / failure (§6) | Those three states are identical to a user who cannot see a spinner | Yes — Display + Navigator addition |
| Screen-reader browse-mode spike (§7) | The one risk that can invalidate the product premise | Yes, but it may force DOM changes in Display/Keyboard |
| Deep-link ancestry (§8) | `back` behaves differently depending on how the user arrived | Yes — optional `stack` on `open` |
| Contract versioning + unknown-value fallbacks (§11) | Core and app must ship together | Yes |
| Validating / bounding app responses (§12) | A buggy app degrades the shell, and the shell gets blamed | Yes, until third-party apps exist |
