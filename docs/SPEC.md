# Nowisee — product specification

**Audience:** people (including agents) planning or building with no prior chat context.  
**Status:** The product and architecture **what** is locked. Contracts: [`ARCHITECTURE.md`](ARCHITECTURE.md). Core module behavior: [`MODULES.md`](MODULES.md). Per-app graphs live next to each app.

---

## 1. What this product is

**Nowisee** is a website for blind (and screen-reader / keyboard-primary) users who struggle with modern, cluttered UIs.

The core idea is that the page shows **one unformatted text surface** — no pictures, menus, cards, or competing chrome. When the current node is a normal text node, that surface is the node’s label (`role="application"` so arrow keys reach the page). When the current node is an **input** node, that surface is a multiline text box plus Cancel and Done. Navigation is driven by a **navigation map** of four intents — `prev`, `next`, `enter`, `back` — which core binds to the arrow keys by default on text tips (and to VoiceOver edge pads on focus or click). A user or locale can rebind those keys without any app changing.

Typical sites force tabbing through chrome or exploring by touch, so users cannot quickly find content. Nowisee makes the reading cursor and the UI the same thing: whatever is on screen is what matters.

**First-party apps** are portable `AppModule`s, including Home:

1. **Home** lists the user’s home apps (and Manage Apps) and links to each by URL.
2. **Help** is a short tutorial of intents, lists, and typing. It is the first catalog item.
3. **Bible** offers public-domain translations and commentaries: testament → book → chapter → verse → options (copy, bookmark, versions, commentary). Search and bookmarks are ordinary nodes.
4. **Notes** is per-user list/create/edit. Signed out offers a way to sign in. Titles are the first line; newest `updatedAt` first.
5. **Gmail** connects a Google account and shows inbox messages (subject, then from), body chunks, and compose/send. Tokens go through host OAuth/lockbox.
6. **Account** is sign in / register / sign out. Credentials live in the identity service, not in this app.

Long-term there should be many apps, and possibly third-party apps and an in-product App Store. Core must never special-case product names. A new app is a module plus a pack row, not a core edit.

Prefer robust, generic, long-term design over shipping fast. Incomplete is OK; sloppy, duplicated, or product-specific core design is not.

---

## 2. User-visible navigation

Apps author **intents**. Core owns which keystroke produces each one (defaults in [`MODULES.md`](MODULES.md) § Keyboard).

| Intent | Default input | Typical meaning (authored by apps via navigation map) |
|--------|---------------|--------------------------------------------------------|
| `prev` / `next` | `ArrowUp` / `ArrowDown` on a text tip; VoiceOver pads top / bottom | Move among siblings (`stackBehavior: replace`) |
| `enter` | `ArrowRight` on a text tip; VoiceOver pad right; **Done** on an input tip | Enter / follow (`stackBehavior: push`); also the deliberate trigger for actions and input commit |
| `back` | `ArrowLeft` on a text tip; VoiceOver pad left; **Cancel** on an input tip | Inside an app: usually history back (`stackBehavior: pop`). At app root: **`app` edge to Home**. On an input tip: abandon |
| plain arrows on an **input** tip | unbound | Caret keeps them. Leave via Done / Cancel, not a chord. |
| Missing map edge | — | Silent no-op (stay) |

Nothing above is visible to an app: an app that ships today keeps working if the bindings change, if the user remaps them, or if edge pads / other modalities deliver the same intents.

The display is one text blob, or a multiline field plus Cancel / Done. The screen reader announces updates by focusing the remounted text surface (there is no `aria-live` on that surface). Help is a first-class app, not a modal.

A few example paths:

- Home shows an app label; `next` shows the next app; `enter` opens that app via an `app` edge.
- A reading app typically goes list → item → options (copy, and so on).
- Compose uses an **input** node; `enter` (Done) commits toward a status node.

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

Packaging, stack, and env: [`ARCHITECTURE.md`](ARCHITECTURE.md). How apps call core: [`MODULES.md`](MODULES.md).

---

## 4. Locked decisions and why

### 4.1 Portable apps by id (Home included)

**Decision:** Apps register as `AppModule` with stable `id` + `label`. Home is an app that lists others and links by `app` edge. No core per-product repository. Home must not embed foreign **node** ids—only locations. Core identifies Home through `config.rootAppId`; no core file names it.

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

**Decision:** Side effects (copy, send) still happen inside an ordinary `refresh` on an ordinary node — there is no `activate()` call and no action edge *kind*. The app marks the single edge that constitutes the button press with `action: true`. Core sets `extras.action` on exactly the call caused by traversing that edge, and on no other call. Warm may show a working label and the resulting refresh updates **in place**.

- App: marks the trigger edge; performs effects only when `extras.action` is true.
- Core: sets the flag on that one traversal; never on bootstrap, revalidation, replay, or retry; never re-issues, retries, aborts, or coalesces an action call.

**Why:** the effect is now tied to a *transition the user deliberately made*, not to a node merely being current. Three failure modes disappear by construction rather than by author discipline:

| Failure | Why it cannot happen |
|---------|----------------------|
| Browsing sibling options fires the effect | `prev` / `next` edges carry no flag |
| Warm-hit background revalidation repeats it | Revalidation carries no flag |
| Returning to a status node replays the effect | Ordinary edges carry no flag |

Rapid double-press is naturally safe: after the local move the tip is the status node, and the trigger edge belonged to the previous node.

**Rejected:** an `activate()` API; an `action` edge *kind* (it would duplicate `node` and `app` edges); and a richer `reason` / `requestId` protocol on every refresh — the edge flag covers the only case where the distinction was load-bearing, at a fraction of the complexity.

### 4.6 No silent teleport; no auto-dismiss

**Decision:** Apps must not rewrite the stack to jump the user after a workflow. Status/confirmation text stays until the user presses a mapped key. Refresh may update the **current tip’s text** in place.

**Why:** Blind users must not have location change without an explicit key.

### 4.7 Prefetch = app-pushed warm + map edges

**Decision:** Each refresh returns `warm` and a full navigation map. Core replaces the warm set (pinning stack payloads) and replaces the map. Core does not apply siblingRadius/childDepth.

**Why:** Only the app knows what is cheap/valuable. Optional **app kit** helpers may BFS with app callbacks—never automatic in Navigator.

**Concurrency:** Navigator owns one monotonic transition token. A result is applied only if its token is the newest issued; comparing tip ids is not sufficient, because `prev` then `next` returns to the same id and would let a stale result through. Superseded read-only calls are aborted via `extras.signal`; action calls are never aborted, only their results discarded.

### 4.8 Input nodes

**Decision:** Input is a node type (multiline `<textarea>` plus Cancel and Done, or `<input type="password">` when `secret` is set). Leave only via navigation-map edges: **Done** fires `enter` (typically commit with `passInputText`); **Cancel** fires `back` (typically abandon). Plain arrows stay unbound so the caret keeps them. **No Escape-to-exit** platform behavior. Behavior is derived from tip node type, not a separate Escape-toggled mode. The two buttons are the only extra chrome, and only while the tip is an input. `secret` is a flag on the existing input kind, not a new `NodeKind`.

**Why:** One consistent exit vocabulary that matches how people already leave a form (move to a named button and activate it), instead of a Nowisee-only chord or guessing every screen-reader blur path. Apps still author `enter` / `back`; core only supplies the controls.

### 4.9 Addressing

Apps address `AppLocation` (`{ appId, path }`). **Core alone** turns that into a browser URL, so the hash-vs-path decision, a sub-path mount, or a locale segment never reaches app code.

Shareable tips **may** return a location from refresh; that is not required for every node. Aliases are fine; the app canonicalizes on open. A null location means core **keeps** the previous address bar. The field is required; omitting it is not the same as null.

Cross-app and Home exit use `kind: "app"` edges only. `kind: "external"` leaves the platform.

### 4.10 App boundary: data in, data out

**Decision:** `open` / `refresh` is a **message protocol**. First-party apps run on the server; the browser holds generic RPC stubs. Everything crossing the boundary — stack, input text, node payloads, navigation map, result, location, `clipboardText` — must be plain data that would survive being serialized and sent as a message. The abort signal cancels the HTTP request. Platform context stays on the client (core uses it to write `clipboardText`).

Copy is `clipboardText` on the result; core writes the clipboard. Durable storage, screen-reader status, and app-initiated refresh are not in this slice. The registry hands Home plain `{ id, label }` descriptors, never the registry object.

**Why:** the roadmap includes third-party apps and an App Store, and code we did not write cannot share a page with everyone's data. The realistic containment is a worker, an iframe, or a server, and all three exchange messages rather than objects. Keeping the boundary message-shaped now costs nothing and preserves that option; letting apps quietly depend on being in-page forecloses it.

**This is a discipline, not a sandbox.** No isolation is being built. See [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`MODULES.md`](MODULES.md).

**Immediate payoff:** the clipboard. Browsers only permit a write while the user's keypress is still fresh, so copying after an async (or server) refresh fails intermittently. Core opens the write inside the keydown. Apps return `clipboardText` on the action result; they never write the clipboard themselves.

### 4.11 Client vs server cache

**Client warm** is core NodeCache, as above. **Server or durable cache** sits behind the app (or its API) and is not core. HTTP cookies are set by the host (`__Host-nowisee_session`). Identity is a server-host concern, not a client platform capability. See [`IDENTITY.md`](IDENTITY.md).

### 4.12 Sibling list ends

**Not locked to wrap.** Each app authors its own edges (wrap, stop, or something else). The earlier “always wrap” rule is retired.

### 4.13 Busy / blocking / errors

| Case | Behavior |
|------|----------|
| Open/bootstrap or map target not in warm | Block on refresh; ignore further intents; no placeholder |
| Warm hit | Show immediately; background refresh; allow further map hits; discard any result whose transition token is not the newest |
| Refresh failure (warm miss) | Speak core recovery copy; keep dest; `enter` retries; `back` restores previous node |
| Refresh failure (warm hit or open) | Keep last text; clear busy; do not crash shell |
| Missing edge | Silent no-op |

**Known limitation:** blocked and dead-end still present as silence. Warm-miss failure is spoken on the content surface. A second announcement channel is deferred ([`PREPAREDNESS.md`](PREPAREDNESS.md)). Apps MUST resolve with a status node rather than reject: a rejected action on a warm dest otherwise strands the user on a working label.

### 4.14 Auth / database

Identity and per-app SQLite have landed. Clipboard is still the only platform capability the **client** provides. Auth lives on the host identity service; each app opens its own database. See [`IDENTITY.md`](IDENTITY.md) and [`STORAGE.md`](STORAGE.md).

---

## 5. Recommendations for app authors (SHOULD)

1. **Runtime-unknown next node.** Ship a temporary warm node plus an edge, then replace the content on refresh.
2. **List ends.** Choose wrap, stop, or a message. Do not assume the platform wraps.
3. **Action / send / copy.** Put `action: true` on the `enter` edge into a status node. Show a working label, then done or error in place. Leave only via mapped intents; never jump the stack silently. Resolve with an error label rather than rejecting — a rejected action call strands the user on the working label.
4. **Leaving the app.** Root `back` MUST be an `app` edge to Home.
5. **Input.** Put an instruction node before the input node. `enter` (Done) with `passInputText` commits; `back` (Cancel) abandons.
6. **Addressing.** Return a stable canonical location when the tip is bookmarkable. Use `location: null` for status tips that should not change the bar (this also stops a reload from re-entering an action node).
7. **Prefetch.** Publish likely edges plus warm payloads.
8. **Home.** Labels and `app` edges only.
9. **App kit.** Prefer shared helpers for edge, list, input, and neighborhood boilerplate.
10. **Intents only.** Never assume a keystroke, a direction, or a particular screen.
11. **Plain data only.** Return nothing that would not survive being sent as a message.
12. **Copy.** Return `clipboardText` on the action refresh result; never touch `navigator.clipboard`.

---

## 6. Roadmap

Landed so far: core and the app kit, first-party apps on a Node host, identity, lockbox, OAuth, the Bible corpus and reader features, Notes, and Gmail v1.

Later work can happen without changing the contracts above: a status channel; optional deep-link ancestry; `requestRefresh`; a Display port for a native client; third-party sandbox and contract versioning; browser Back/Forward versus the session stack.

---

## 7. Deferred (must preserve contracts above)

These can wait, as long as the locks above stay intact:

- Exact path syntax per app (behavior is locked; shapes are app-owned)
- IndexedDB / service worker
- A dedicated Home intent
- Browser Back/Forward versus the session stack (a narrow core item later)
- A warm etag/hash protocol
- A UI framework (not planned)

A few deferrals have a known cost. See [`PREPAREDNESS.md`](PREPAREDNESS.md):

| Deferred | Cost of deferring | Additive later? |
|----------|-------------------|-----------------|
| Status channel distinguishing busy / dead-end / failure | Those three states are identical to a user who cannot see a spinner | Yes — Display + Navigator addition |
| Deep-link ancestry | `back` behaves differently depending on how the user arrived | Yes — optional `stack` on `open` |
| Contract versioning + unknown-value fallbacks | Core and app must ship together | Yes |
| Validating / bounding app responses | A buggy app degrades the shell, and the shell gets blamed | Yes, until third-party apps exist |
