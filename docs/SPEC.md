# Nowisee — product & architecture specification

**Audience:** planning/building agents with zero prior chat context.  
**Status:** Product/architecture **what** is locked. See [`ARCHITECTURE.md`](ARCHITECTURE.md) for TypeScript contracts and [`ENGINEERING.md`](ENGINEERING.md) for implementation choices.

---

## 1. What this product is

**Nowisee** is a website for blind (and screen-reader / keyboard-primary) users who struggle with modern, cluttered UIs.

**Core UX idea:** the page shows **one unformatted text string** — no pictures, menus, cards, or competing chrome. Navigation is **only** the arrow keys (plus Escape to leave text-input mode; Home shortcut deferred). The entire product is a navigable **graph of text nodes** (often tree-shaped, but cross-links allowed).

**Why it exists:** typical sites force tabbing through chrome or exploring by touch. Users cannot quickly find content. Nowisee makes the reading cursor and the UI the same thing: whatever is on screen is what matters.

**MVP content (as ordinary apps, not core features):**

1. **Bible app** — King James Version (public domain): Testament → book → chapter → verse → options (e.g. Copy, Commentary stub).
2. **Demo mail app** — fake inbox, a few sample emails, compose stub (not real Gmail/OAuth).

**Long-term:** many apps; possibly third-party apps and an in-product App Store. Core must never special-case “Bible” or “Mail.”

**Quality bar:** prefer robust, generic, long-term design over shipping fast. Incomplete is OK; sloppy, duplicated, or product-specific core design is not. Think through edge cases before coding; do not rely on tests to invent the design.

---

## 2. User-visible navigation

| Control | Meaning |
|---------|---------|
| **Up / Down** | Move among siblings (lists wrap at ends) |
| **Right** | Enter / follow (child, option, or cross-link) |
| **Left** | **History back** (previous place in the session stack), not “tree parent” |
| **Escape** | Leave **Input** mode (e.g. compose), return to **Nav** mode |
| Left at stack bottom | Go to **homepage** (shell home / app list) |

**Display:** a single text blob (long verses/emails OK as one string). Screen reader announces updates via one live/focus region. No visual chrome competing for attention. Help lives **in the tree** as nodes, not modals.

**Example paths:**

- Home shows “Bible” → Down might show demo mail app name → Right enters that app.
- Bible → Right → “Old Testament” / Down → “New Testament” → Right → “Matthew” → … → chapter → verse text → Right → “Copy” / Down → “Commentary”.
- Mail → Inbox → subject lines → body → reply-style options; Compose uses Input mode for typing.

---

## 3. Architecture — layers and ownership

| Layer | Owns | Must not own |
|-------|------|----------------|
| **Display** | Showing one string + a11y announce | Trees, apps, keys |
| **Keyboard / Mode** | Nav vs Input; Escape | App business rules |
| **Navigator + stack** | Stack discipline, calling apps with actions, merging cache, address bar sync helpers | Choosing *which* node is next (except Left pop / home fallback mechanics) |
| **NodeCache** | Storing node payloads apps returned | Deciding *what* to prefetch |
| **AppRegistry** | id → AppModule; enabled list for Home | App internals |
| **Apps** | Graph, labels, side effects, warm set, URL canonicalization, stale/missing handling | Arrow-key handling, global cache policy radii |

**Mental model:** Core is a **shell for a text-node browser**. Apps are **authorities** that answer navigation actions with node bundles.

---

## 4. Locked decisions and why

### 4.1 Portable apps by id (not named core repos)

**Decision:** Apps register as `AppModule` with stable `id` + `label`. Home = enabled modules from the registry. Each app keeps private data code. No core `BibleRepository` / `MailRepository`.

**Why:** Many apps and possible third-party/App Store later. Named repos in core bake product into the platform.

**Rejected:** Hardcoding Bible/Gmail in core; home menu as special-cased strings.

### 4.2 App-owned `navigate(action)` (not `provide(nodeId)`)

**Decision:** Core sends an **action** (Up / Down / Left / Right / Open(url) / cold start). App returns a **NodeBundle** (new current node + optional warm nodes + optional url). Core does **not** compute “the next node id” and demand it from the app.

**Why:** Sessions go stale (deleted mail, changed lists). If core requests a missing id, navigation breaks. The app knows current truth and can return fallbacks.

**Rejected:** Navigator walks a core-side tree of ids and fetches by id.

### 4.3 No separate `activate()`

**Decision:** Side effects (copy, send) happen when the app handles navigation into that node (typically **Right** onto it). Up/Down across “Copy” / “Commentary” only changes the shown label. After an action, **the app** chooses the next node.

**Why:** Keep the node protocol minimal; actions are just nodes.

### 4.4 Prefetch = app-pushed `warm` nodes

**Decision:** Each `NodeBundle` may include `warm`: an explicit list of extra node payloads. Core merges them into **NodeCache**. Core does **not** apply siblingRadius/childDepth policies.

**Why:** Different depths need different warming. Only the app knows what is cheap/valuable at that node.

**Rejected:** Core-driven “always prefetch N siblings”; “core preloads whole KJV.”

### 4.5 Left = history back; stack discipline

| Action | Stack effect |
|--------|----------------|
| **Right** | Push (drill or cross-link) |
| **Up / Down** | Replace top (sibling move does not deepen history) |
| **Left** | Pop to previous |
| **Left at empty/single root** | Go to **homepage** |
| **Open(url)** | Establish stack appropriate for that entry |

**Why Left ≠ parent:** Cross-links; back should return to where the user came from.

**Why Up/Down replace:** Avoid “50 Downs among verses = 50 Lefts to leave.”

**MVP escape:** Rely on Left pops only (no separate Home key yet). Bottom-of-stack Left → homepage.

### 4.6 URLs

- Shareable nodes **may** expose a URL; not required for every node.
- **Aliases OK:** many URLs → one node (app canonicalizes on `Open`).
- Prefer one **canonical** share URL per shareable node.
- **Ephemeral** nodes need no permanent URL; **address bar keeps the previous share URL**.
- Avoid session-relative share URLs for bookmarkable content.

### 4.7 Nav vs Input mode

Global modes in core. **Nav** = arrows move. **Input** = typing; Escape returns to Nav. Any app may request Input.

### 4.8 Auth / database

Not in MVP. Later: generic platform capabilities — still no app-named core repositories.

### 4.9 MVP scope

Real KJV Bible app + basic demo mail only. No real Gmail.

### 4.10 Edge cases (locked)

| Case | Behavior |
|------|----------|
| Left with history | Pop |
| Left at bottom | Homepage |
| Up/Down at ends | Wrap |
| Right with nowhere to go | Silent no-op (stay) |
| Empty children on Right | Silent no-op |
| Stale/missing after action | App returns a valid fallback node |
| Rapid keys during blocking navigate | Ignore until done |
| Long content | Single text blob |
| Escape in Input | Back to Nav |
| Action aftermath | App chooses next node |

---

## 5. Roadmap

1. Persist this handoff in-repo (`AGENTS.md`, `docs/SPEC.md`, contracts).
2. Scaffold **core only** (display, mode, stack, cache, registry).
3. Implement **Bible** and **demo mail** as AppModules.
4. Accessibility pass (SR + keyboard).
5. Later: persistence, auth, real mail, App Store groundwork.

---

## 6. Deferred (choose at scaffold time; must preserve contracts)

- UI toolkit, bundler, hosting vendor
- Static-only vs edge API
- Precise URL path vs hash syntax (behavior above is locked)
- IndexedDB / service worker
- Dedicated Home key
- Real auth, DB, real mail, commentary sources
