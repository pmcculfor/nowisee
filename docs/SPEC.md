# Nowisee — product & architecture specification

**Audience:** planning/building agents with zero prior chat context.  
**Status:** Product/architecture **what** is locked (post adversarial review). Contracts: [`ARCHITECTURE.md`](ARCHITECTURE.md). Module specs: [`MODULES.md`](MODULES.md). Engineering proposals: [`ENGINEERING.md`](ENGINEERING.md).

---

## 1. What this product is

**Nowisee** is a website for blind (and screen-reader / keyboard-primary) users who struggle with modern, cluttered UIs.

**Core UX idea:** the page shows **one unformatted text surface** — no pictures, menus, cards, or competing chrome. When the current node is a normal text node, that surface is the node’s label. When the current node is an **input** node, that surface is a single input box. Navigation is driven by a **navigation map**: arrow keys and mapped key chords (recommended: Ctrl+Left / Ctrl+Right on input nodes).

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

| Control | Typical meaning (authored by apps via navigation map) |
|---------|--------------------------------------------------------|
| **Up / Down** | Move among siblings (`stackBehavior: replace`) |
| **Right** | Enter / follow (`stackBehavior: push`) |
| **Left** | Inside an app: usually history back (`stackBehavior: pop`). At app root: **URL to Home** |
| **Ctrl+Right / Ctrl+Left** | Recommended on **input** nodes: forward/commit and back |
| Missing map edge | Silent no-op (stay) |

**Display:** one text blob or one input box. Screen reader announces updates via one live/focus region. Help lives **in the tree** as nodes, not modals.

**Example paths:**

- Home shows “Bible” → Down might show “Mail” → Right opens the Bible app via URL.
- Bible → Right → “Old Testament” / Down → “New Testament” → … → verse → Right → “Copy” / Down → “Commentary”.
- Mail → Inbox → subjects → body → options; Compose uses an **input** node; Ctrl+Right commits toward Send/status.

---

## 3. Architecture — layers and ownership

| Layer | Owns | Must not own |
|-------|------|----------------|
| **Display** | One surface (label or input) + a11y announce | Graphs, apps, keys |
| **Keyboard** | Deliver keys/chords to navigator; caret vs nav based on tip node type | App business rules |
| **Router** | Parse URL → appId; switch current app; dispatch `open` | App path meaning inside `#/a/<appId>/...` |
| **Navigator + stack** | Per-app stack; apply map edges; busy/block; call refresh; merge warm/map | Choosing graph content; prefetch depth policy |
| **NodeCache (client warm)** | Store payloads apps returned; pin stack entries | Server cache; inventing fetches |
| **Navigation map store** | Current edge table from last refresh | Authoring edges |
| **AppRegistry** | id → AppModule | App internals |
| **App kit** | Optional shared helpers apps import | Automatic Navigator behavior |
| **Apps** | Graph, labels, edges, warm, URLs, side effects, stale handling | Arrow handling, global cache radii |

**Mental model:** Core is a **shell for a text-node browser**. Apps are **authorities** that answer `open` / `refresh`. Home is an app. Cross-app movement is by URL only.

```text
Core ──open/refresh──► AppModule
     ◄── map + warm + url ──
```

---

## 4. Locked decisions and why

### 4.1 Portable apps by id (Home included)

**Decision:** Apps register as `AppModule` with stable `id` + `label`. Home is an app that lists others and links by URL. No core `BibleRepository` / `MailRepository`. Home must not embed foreign **node** ids—only URLs.

**Why:** Many apps and possible third-party/App Store later.

### 4.2 `open` + `refresh` (not `navigate(action)` as primary)

**Decision:** Core follows the **navigation map** locally when possible, then calls `app.refresh(stack, extras)`. Cold start and all URL transitions use `router.open` → app `open`/`refresh` bootstrap. The app returns a new navigation map, warm nodes, and optional share URL.

**Why:** Instant UI from warm + map; one app call shape; stack tip encodes where the user is; app revalidates every time.

**Rejected:** Core computing next ids (`provide(nodeId)`); core-driven prefetch radii; `navigate(action)` as the only path without a map.

### 4.3 Navigation map

**Decision:** Edges keyed by `(fromNodeId, key)` where `key` is an arrow or named chord.

- `kind: "node"` + `stackBehavior: push | replace | pop`
- `kind: "url"` → always `router.open`
- Optional `passInputText` on edges leaving an input node
- On `pop`: **omit `toNodeId`**; destination is stack tip after pop
- Missing edge: silent no-op
- Apps may publish edges for nodes other than the current tip (multi-hop locally)

**Why:** Rapid keys stay coherent; Left/Right/Up/Down stack rules are data; URL exits do not require foreign node ids.

### 4.4 Per-app stack; URL open resets stack

**Decision:** The session stack holds only node ids for the **current app**. Every URL open (including same-app jumps and returning to Home) goes through the router and **resets** that app’s stack, then bootstraps with refresh.

**Why:** Stacks never mix apps; cross-app is URL; history back (`pop`) stays inside one app.

### 4.5 No separate `activate()` / no `action` edge kind

**Decision:** Side effects (copy, send) happen when the user navigates onto an action/status **node** and `refresh` runs. The app recognizes the tip and performs work. Warm may show “Sending…” then refresh updates to “Sent” **in place**.

**Why:** Keep the protocol minimal; avoid firing copy when merely browsing sibling option labels if the app structures the graph so the effectful tip is entered deliberately (typically Right / Ctrl+Right onto the action node).

### 4.6 No silent teleport; no auto-dismiss

**Decision:** Apps must not rewrite the stack to jump the user (e.g. to inbox after send). Status/confirmation text stays until the user presses a mapped key. Refresh may update the **current tip’s text** in place.

**Why:** Blind users must not have location change without an explicit key.

### 4.7 Prefetch = app-pushed warm + map edges

**Decision:** Each refresh returns `warm` and a full navigation map. Core replaces the warm set (pinning stack payloads) and replaces the map. Core does not apply siblingRadius/childDepth.

**Why:** Only the app knows what is cheap/valuable. Optional **app kit** helpers may BFS with app callbacks—never automatic in Navigator.

### 4.8 Input nodes

**Decision:** Input is a node type (single input box). Leave only via navigation-map edges (recommend Ctrl+Right forward with `passInputText`, Ctrl+Left back). **No Escape-to-exit** platform behavior. Behavior is derived from tip node type, not a separate Escape-toggled mode.

**Why:** One consistent exit vocabulary; chords are explicit map data.

### 4.9 URLs

- Shareable tips **may** expose a URL from refresh; not required for every node.
- Aliases OK; app canonicalizes on open.
- Null/omit url → core **keeps** previous address-bar URL.
- Cross-app and Home exit: `kind: "url"` only.

### 4.10 Client vs server cache

- **Client warm:** core NodeCache as above.
- **Server/durable cache:** behind the app (or its API). Not core. HTTP cookies are set by servers when backends exist; core may later pass an empty **platform context** into refresh for shared login—details deferred.

### 4.11 Sibling list ends

**Not locked to wrap.** Each app authors edges (wrap, stop, or other). Earlier “always wrap” is retired.

### 4.12 Busy / blocking / errors

| Case | Behavior |
|------|----------|
| Open/bootstrap or map target not in warm | Block on refresh; ignore further nav keys; no placeholder |
| Warm hit | Show immediately; background refresh; allow further map hits; ignore stale refresh if tip changed |
| Refresh failure | Keep last text; clear busy; do not crash shell |
| Missing edge | Silent no-op |

### 4.13 Auth / database

Not in MVP. Later: generic platform capabilities — still no app-named core repositories.

### 4.14 MVP scope

Home + real KJV Bible + basic demo mail. No real Gmail. Notes is a planned future app, not MVP.

---

## 5. Recommendations for app authors (SHOULD)

1. **Runtime-unknown next node:** Temporary warm node + edge; replace content on refresh.
2. **List ends:** Choose wrap/stop/message; do not assume platform wrap.
3. **Action / send / copy:** Navigate to a status node; “Sending…” → “Sent”/error in place; leave only via mapped keys; never silent stack jump.
4. **Leaving the app:** Root Left MUST be URL to Home.
5. **Input:** Instruction node → input node; Ctrl+Right + `passInputText`; Ctrl+Left back.
6. **URLs:** Stable canonical share URL when bookmarkable; omit/null for status tips that should not change the bar.
7. **Prefetch:** Publish likely edges + warm payloads.
8. **Home:** Labels + URL edges only.
9. **App kit:** Prefer shared helpers for edge/list/input/neighborhood boilerplate.

---

## 6. Roadmap

1. Persist handoff + adversarial locks in-repo — **this revision**.
2. Scaffold core + app kit + Home/Bible/Mail modules.
3. Accessibility pass (SR + keyboard).
4. Later: persistence, auth, real mail, notes, App Store groundwork; browser Back/Forward policy.

---

## 7. Deferred (must preserve contracts above)

- UI toolkit, bundler, hosting vendor (see ENGINEERING proposals)
- Exact hash path syntax per app (behavior locked; shapes app-owned)
- IndexedDB / service worker
- Dedicated Home key
- Browser Back/Forward vs session stack (narrow core item later)
- Server session TTL, cache keys, auth provider
- Warm etag/hash protocol
- Real auth, DB, real mail, commentary sources, notes storage
