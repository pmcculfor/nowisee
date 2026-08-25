# Nowisee repository audit

**Snapshot of 24 August 2026.** Later documentation work is not reflected here. Live remaining work: [`current_audit.md`](current_audit.md).

**Date:** 24 August 2026  
**Scope:** documentation, architecture, unused code/data, elegance/robustness, bugs, and security.  
**Method:** read the docs and source; grep for call sites; compare claims to the running layout. Tests and the live app were not executed in this pass.

This file is a review artifact. Nothing here is an instruction to change code. Each item is something you can accept, defer, or reject.

---

## How to read this

| Section | What it answers |
|---------|-----------------|
| [1. Documentation](#1-documentation) | What to keep, rewrite, archive, or create |
| [2. Architecture](#2-architecture) | How the whole system fits together |
| [3. Component catalog](#3-component-catalog) | What each part does and who it talks to |
| [4. Unused code and data](#4-unused-code-and-data) | Safe-to-remove candidates |
| [5. Elegance and robustness](#5-elegance-and-robustness) | Where the design is awkward or fragile |
| [6. Bugs](#6-bugs) | Behavioral defects |
| [7. Security](#7-security) | Trust, CSRF, secrets, DoS |
| [8. Suggested priority](#8-suggested-priority) | A review order, not a mandate |

Confidence tags:

- **Confirmed** — unused or stale with no remaining call site / contradicting source.
- **Likely** — strongly indicated; a product choice may still want to keep it.
- **Seam** — unused on purpose (reserved for a later slice). Do not delete just because nothing calls it.

---

## 1. Documentation

The product already has more written design than most codebases of this size. The problem is not “too little writing.” It is **entry-point staleness** and **the same locks restated in too many files**, so a new reader cannot tell what is current.

### 1.1 Inventory

| File | Intended job | Current health |
|------|----------------|----------------|
| `README.md` | Public onboarding | **Wrong.** Claims “no application code yet.” |
| `AGENTS.md` | Binding rules for humans and agents | **Best current snapshot.** Locks, layers, runbook. Keep. |
| `docs/SPEC.md` | Product what/why | **Core UX still right; MVP/roadmap/deferred are stale.** |
| `docs/ARCHITECTURE.md` | TypeScript contracts | **Behind `src/core/types.ts`.** Packaging table still says “proposed.” |
| `docs/MODULES.md` | Normative per-module behavior | **Mostly current.** Shell list omits Gmail; §18 is a greenfield checklist. |
| `docs/STORAGE.md` | Who opens which DB | **Good.** Keep as storage canonical. |
| `docs/IDENTITY.md` | Sessions, CSRF, lockbox, OAuth | **Good**, with a few leftover “JSON seed” / app-list lines. |
| `docs/ENGINEERING.md` | Stack, env, how to extend | **Good.** DB row omits Gmail. |
| `docs/PREPAREDNESS.md` | Long-term readiness | **Useful.** Notes row still says “Store injected.” |
| `docs/DESIGN-REVIEW.md` | Why locks exist | **Historical.** Framing still sounds pre-code. |
| `docs/BIBLE-PLAN.md` | Implementation ticket for Bible expansion | **Mostly executed.** Still reads as a todo. |
| `docs/GMAIL.md` | v1 status + Google OAuth research | **Keep research; trim leftover “not built yet” lines.** |
| `docs/FACEBOOK.md` | Feasibility: no friends News Feed API | **Keep as research.** Not product spec. |
| `src/apps/bible/data/SOURCES.md` | Corpus files and import rules | **Good.** Keep next to the data. |
| `spikes/README.md` | How to run a11y probes | **Still useful.** Outcomes should be marked settled. |

There is no `LICENSE`, `CONTRIBUTING.md`, or `.env.example`.

### 1.2 Overlap (same facts, many owners)

These topics are copied across files. Drift is already visible:

| Fact | Lives in | Who should own it |
|------|----------|-------------------|
| Product one-liner + one-text UX | SPEC, AGENTS, MODULES Display | **SPEC** |
| Locked behaviors table | AGENTS, SPEC §4, MODULES | **AGENTS** (agents); SPEC can point |
| `NavEdge` / `RefreshResult` / `AppModule` | ARCHITECTURE **and** `types.ts` | **`types.ts` is source of truth**; ARCHITECTURE should say that and stop duplicating full interfaces |
| Navigator algorithm | ARCHITECTURE summary, MODULES §7 | **MODULES** |
| Identity / CSRF / cookies | IDENTITY, AGENTS, STORAGE, PREPAREDNESS | **IDENTITY** |
| Bible corpus rules | BIBLE-PLAN, SOURCES, ENGINEERING, STORAGE, AGENTS | **SOURCES** for files; STORAGE for schema; ENGINEERING for “do not extend prepare-kjv” |

Agents already follow AGENTS → MODULES → types. README and SPEC do not match that chain, so newcomers start in the wrong place.

### 1.3 Stale claims (highest impact)

Quoted from the docs, contradicted by the tree:

1. **`README.md`:** “Specs and module contracts only — no application code yet.”  
   Contradicted by `src/`, `server/`, `tests/`, `package.json`.

2. **`docs/SPEC.md` §4.15:** “Home + real KJV Bible + Notes + Account. No real Gmail.”  
   Contradicted by `src/apps/gmail/`, `server/firstPartyApps.ts`, `tests/gmail.test.ts`, AGENTS MVP lock.

3. **`docs/SPEC.md` §1 / §6 / §7:** Mail is “later”; roadmap still starts at “scaffold core”; deferred list still includes “Real mail, commentary sources.”  
   Gmail and commentaries have landed.

4. **`docs/ARCHITECTURE.md` packaging:** “Path (proposed)” and apps `home, bible, notes, account (and later mail)`.  
   Layout is real; apps include Help and Gmail.

5. **`docs/ARCHITECTURE.md` `AppServerContext`:** omits `directory`; does not define `LockboxCapability` / `OAuthCapability` / `DirectoryCapability`.  
   `src/core/types.ts` has all four.

6. **`docs/MODULES.md` §16:** remote stubs for “Home, Help, Bible, Notes, and Account” — omits Gmail.  
   `src/shell/bootstrap.ts` registers Gmail.

7. **`docs/IDENTITY.md` §4:** KJV seeded “from JSON next to the Bible app.”  
   Live path is VPL via `ensureCatalog` from `src/apps/bible/data/raw/`. `kjv.json` is leftover.

8. **`docs/BIBLE-PLAN.md`:** “Split `view.ts`”; “today Bible ignores `userId`”; `002_reader.sql` spoken as future.  
   View is split under `view/`; bookmarks/prefs use `userId`; 002 is applied.

9. **`docs/PREPAREDNESS.md` Notes:** “Store injected.”  
   Notes opens its own file; host does not inject a store.

10. **`docs/GMAIL.md` research body:** still says MODULES §14 describes a demo mail app.  
    MODULES §14 is the real Gmail graph. The file header already says v1 landed.

11. **`docs/DESIGN-REVIEW.md`:** “cheap to change today because there is no code”; spike §7 still open-ended.  
    Implementation settled `role="application"` + focus announce + Cancel/Done.

12. **Branding:** HTML title and Help welcome say **“Now I See”**; docs and AGENTS say **Nowisee**. Product decision, not a typo in one place.

13. **`scripts/download-bible-sources.mjs` header:** “Raw files go in … (gitignored).”  
    Import texts are committed; only zips/USFM/SWORD are gitignored.

### 1.4 Gaps a new contributor actually hits

- Honest README: what the product is, how to run it, which docs are normative.
- How to add an app: one pack row in `FIRST_PARTY_APPS` **and** a matching `createRemoteApp` in `bootstrap.ts` (two lists today).
- `.env.example` for `NOWISEE_ORIGIN`, `NOWISEE_LOCKBOX_KEY`, Gmail OAuth vars.
- A Bible “as built” page (or a rewritten BIBLE-PLAN) so agents do not re-implement the slice.
- Spike outcomes recorded as settled, not as open questions.
- Deploy story: PREPAREDNESS says Node host, not GitHub Pages; README still points at Pages for spikes only.

### 1.5 Proposed doc map

| Action | File | Why |
|--------|------|-----|
| **Rewrite** | `README.md` | Blocks every newcomer. Status, runbook, doc index. Mirror the AGENTS Cloud section lightly. |
| **Update in place** | `SPEC.md` | Fix MVP (§1, §4.15), roadmap §6, deferred §7. Keep the UX/locks that are still true. |
| **Update** | `ARCHITECTURE.md` | Drop “proposed.” Point at `types.ts` instead of pasting full interfaces, **or** regenerate from types. Add `directory` and Help/Gmail. |
| **Update** | `MODULES.md` §16 | Include Gmail. Move §18 to archive or delete. |
| **Update** | `IDENTITY.md` §4 / §1 / §14 | VPL seed; app lists include Help and Gmail. |
| **Update** | `ENGINEERING.md`, `PREPAREDNESS.md` | Gmail DB; Notes is app-owned, not injected. |
| **Keep as normative** | `AGENTS.md`, `MODULES.md`, `STORAGE.md`, `IDENTITY.md`, `ENGINEERING.md`, `SOURCES.md` | These are the files people actually follow. |
| **Banner as historical** | `DESIGN-REVIEW.md` | Reasoning record. Locks live in AGENTS/SPEC/MODULES. Do not treat the body as current API. |
| **Rewrite or archive** | `BIBLE-PLAN.md` | Convert to a short “Bible as built” or move under `docs/archive/` and point MODULES §13 + SOURCES. |
| **Keep research, trim todos** | `GMAIL.md`, `FACEBOOK.md` | Research is valuable. Do not leave “build this next” language that contradicts the code. |
| **Update** | `spikes/README.md` | Mark which questions MODULES already settled. Keep the HTML probes. |
| **Create** | `.env.example` | Same vars as ENGINEERING. |
| **Optional create** | `docs/CONTRIBUTING.md` | Only if you do not want README to carry “how to add an app.” |
| **Do not add** | Another lock table | Fix SPEC/README so AGENTS stays the one agent lock. |

`docs/AUDIT.md` (this file) is a one-time review. After you pick actions, it can be archived or deleted so it does not become a third SPEC.

---

## 2. Architecture

Nowisee is a **text-node browser**: one unformatted surface, four navigation intents, portable apps that answer `open` / `refresh` with a map and warm nodes. Core is a generic shell. Product knowledge lives in apps. Secrets and identity live on the server host.

### 2.1 Layers

```text
┌─────────────────────────────────────────────────────────────────┐
│ Browser                                                         │
│  index.html → main.ts → startShell                              │
│  Display (one text or input)  Keyboard  NavPads                 │
│  Navigator owns stack, map, warm cache, busy, clipboard write   │
│  Router: hash ↔ AppLocation only                                │
│  AppRegistry of createRemoteApp stubs (no Bible/Notes code)     │
└───────────────────────────────┬─────────────────────────────────┘
                                │ POST /api/apps/:id/open|refresh
                                │ cookie + Origin + JSON content-type
┌───────────────────────────────▼─────────────────────────────────┐
│ Server host (not core, not an app)                              │
│  HTTP + CSRF + session cookie                                   │
│  Identity service (users, sessions, scrypt)                     │
│  Lockbox (AES-GCM) + OAuth broker                               │
│  Host SQLite: data/nowisee.db                                   │
│  FIRST_PARTY_APPS → real AppModules + ctx grants                │
└───┬───────────┬───────────┬───────────┬───────────┬─────────────┘
    │           │           │           │           │
  Home        Help        Bible       Notes       Gmail       Account
  (directory) (static)    bible.db    notes.db    gmail.db    account.db
                          + raw/                  oauth only  identity
```

| Layer | Path | Owns | Must not own |
|-------|------|------|----------------|
| **Core** | `src/core/` | Intents, stack, map, warm cache, display, keys, pads, registry, clipboard fulfill | Product graphs, DBs, “signed in” |
| **Shell** | `src/shell/`, `src/main.ts` | Wire core; register **remote** app stubs | App domain logic |
| **App kit** | `src/app-kit/` | Optional helpers apps import | Automatic Navigator behavior |
| **Apps** | `src/apps/` | Graphs, URLs, stores, side effects | Keystrokes, `#/…` strings, browser APIs |
| **Host** | `server/` | HTTP, CSRF, identity, lockbox, OAuth, packing apps | Opening app databases, injecting corpora |
| **Tests** | `tests/` | Contracts per module | Production runtime |

There is no UI framework. The client has **zero runtime npm dependencies**. Apps run on the server; the browser holds generic RPC stubs.

### 2.2 Navigation lifecycle

```text
User: arrow / pad / Done / Cancel
  → Keyboard | NavPads | Display.fireIntent
  → Navigator.onIntent(intent)
  → NavigationMapStore.lookup(tipId, intent)
  → missing: silent no-op
  → node edge:
        warm hit: paint locally, then refresh (revalidate)
        warm miss: move stack, keep old text, block, then refresh
  → app edge: Navigator.openLocation → AppModule.open (new stack)
  → external edge: location.assign(href)
  → apply RefreshResult: replace map + warm, update tip, maybe set hash
```

**Open vs refresh**

- `open(path)` — enter an app or jump by URL. Core **resets** that app’s stack.
- `refresh(stack, extras)` — continue inside an app. Core sends the stack the browser already has. Apps must not trust owner ids on that stack; they scope by `ctx.userId` from the cookie.

**Actions:** an edge may set `action: true`. Core sets `extras.action` on **that traversal only**, never aborts it, never retries it. Apps run side effects only then. Copy is `clipboardText` on the result; Navigator writes the clipboard.

**Address bar:** Router is the only producer of `#/…`. Apps return `AppLocation` or `location: null` (keep prior URL — used for status nodes).

### 2.3 Client ↔ server

| Piece | Role |
|--------|------|
| `createFetchRpc` | `POST /api/apps/:id/open\|refresh`, JSON body, same-origin cookies |
| `createRemoteApp` | Same stub for every app id |
| Host `handleSessionHttp` | CSRF (content-type + Origin) → cookie → `identity.resolve` → `ctx` → app |
| `toRefreshExtras` | Wire allows only `inputText` and `action` |
| OAuth | Separate `GET /oauth/callback`; not the app RPC |

CSRF is three layers: `SameSite=Lax` cookie, `Content-Type: application/json`, exact `Origin` match. There is no CSRF token header (documented).

### 2.4 Data ownership

| Kind | Where | Who |
|------|--------|-----|
| Session + password hashes | `data/nowisee.db` | Identity service |
| OAuth tokens | Host lockbox table, AES-GCM | Host; Gmail sees `ctx.oauth` only |
| Bible corpus, bookmarks, prefs | `data/apps/bible.db` | Bible app; corpus from committed `raw/` |
| Notes | `data/apps/notes.db` | Notes; every query takes `ownerId` |
| Gmail inbox cache + drafts | `data/apps/gmail.db` | Gmail; tokens never here |
| Account email-in-progress | `data/apps/account.db` | Account; keyed by `sessionId` |
| Client warm cache | Memory, tab lifetime | Navigator |

`ctx.userId` comes only from the session cookie. There is no `ctx.db`.

### 2.5 How a new app is added today

1. Implement `AppModule` under `src/apps/<id>/`.
2. Add a pack row to `server/firstPartyApps.ts` (start fn + capability flags).
3. Register a matching `createRemoteApp({ id, label, rpc })` in `src/shell/bootstrap.ts`.
4. Home lists it automatically via `ctx.directory` (server registry).

Steps 2 and 3 are **two catalogs**. They can drift. That is the main packaging seam (see §5).

---

## 3. Component catalog

Enough to drill into a folder. Not every file.

### 3.1 Client entry

| Component | Path | What it does | Talks to |
|-----------|------|----------------|----------|
| Page shell | `index.html`, `src/styles.css` | Mount `#app`; serif reading surface; invisible VoiceOver pads; hide pads while input is open | `main.ts` |
| Entry | `src/main.ts` | Finds `#app`, calls `startShell` | Bootstrap |
| Bootstrap | `src/shell/bootstrap.ts` | Builds Display, Keyboard, NavPads, Router, Navigator, cache, map, stack, platform; registers six remote apps; opens initial hash. **Does not** call `display.focus()` after open (VoiceOver restart). | All of core + `rpc` / `remote` |

Product app ids are allowed here. They are not allowed in `src/core/`.

### 3.2 Core

| Component | Path | What it does | Talks to |
|-----------|------|----------------|----------|
| Types | `src/core/types.ts` | Shared contracts: intents, edges, payloads, `AppModule`, server `ctx` capabilities. **Canonical types.** | Imported everywhere; erased in the client bundle |
| Navigator | `src/core/navigator.ts` | Sole owner of transitions. Looks up edges, moves stack, calls open/refresh, applies results, fulfills clipboard, holds the monotonic transition token | Registry, Display, Platform, Map, Cache, Stack, Router setter |
| Router | `src/core/router.ts` | Hash ↔ `AppLocation`. `hrefFor` is the only `#/…` producer. Unknown hash → root | Navigator `openLocation` / `setAddressBar` |
| Display | `src/core/display.ts` | Text: `role="application"` + remount + focus (announce). Input: textarea or password + Cancel/Done (click only). No `aria-live` on the surface | Navigator (show, `getInputText`, Done/Cancel intents) |
| Keyboard | `src/core/keyboard.ts` | Physical keys → intents. Arrows unbound on input tips. Escape/Tab never bound | Navigator |
| NavPads | `src/core/navPads.ts` | Four edge buttons; `focusin` and `click` with one-gesture click suppress (VoiceOver) | Same intent host as Keyboard |
| Navigation map | `src/core/navigationMap.ts` | Nested `(fromId, intent) → edge` | Navigator only |
| NodeCache | `src/core/nodeCache.ts` | Stores warm payloads; pins stack ids; evicts unpinned | Navigator |
| Stack | `src/core/stack.ts` | Per current app only. `push` / `replaceTip` / `pop` | Navigator |
| Registry | `src/core/registry.ts` | `register` / `get` / `listDescriptors`. Never handed to an app | Shell (client stubs), host (real modules) |
| Platform | `src/core/platform.ts` | Action-scoped clipboard. `announce` / `requestRefresh` declared, not provided | Navigator |

### 3.3 Client RPC

| Component | Path | What it does |
|-----------|------|----------------|
| RPC | `src/apps/rpc.ts` | `AppRpc` + `toWireExtras` + `createFetchRpc`. Casts JSON to `RefreshResult` with no schema check |
| Remote stub | `src/apps/remote.ts` | Generic `AppModule` over RPC. Same for every app |

### 3.4 App kit

Apps import these. Navigator never calls them.

| Helper | Path | Used by production apps? |
|--------|------|---------------------------|
| Edge builders | `edges.ts` | Yes — all apps |
| List / map merge | `lists.ts` | Yes |
| Input Cancel/Done | `input.ts` | Help, Notes, Account, Gmail, Bible search |
| Home URL + root back | `home.ts` | Home, every app root `back` |
| Signed-out node | `signedOut.ts` | Notes, Gmail (Bible uses a custom sign-in node because the rest of Bible is public) |
| Neighborhood BFS | `neighborhood.ts` | **Tests only** |
| Split long text | `splitText.ts` | Gmail body chunks |

### 3.5 Apps

All six are `AppModule`s. Home is not special in core; it is `config.rootAppId`.

**Home** — `src/apps/home.ts`  
Lists peers from `ctx.directory` (not the registry object). Sibling list wraps. `enter` is an `app` edge to `{ appId, path: "/" }`. No `back` (already home). Does not filter by signed-in.

**Help** — `src/apps/help/`  
Fixed tutorial graph: welcome → back practice → wrapping list → type prompt → input → Home. Ignores `ctx`. Welcome copy says “Now I See.”

**Bible** — `src/apps/bible/`  
Public corpus + signed-in extras.

| Piece | Role |
|-------|------|
| `catalog.ts` | Versions, commentaries, root headings, verse options, canon books. Graph code walks records |
| `ids.ts` | Node id mint/parse (sequence encoded in the id) |
| `canon.ts` | Labels and URL book segments |
| `import.ts` | `ensureCatalog`: VPL + HelloAO JSON + TSK table → SQLite. Tests pass a tiny `seed` |
| `store.ts` | SQLite store; opens `data/apps/bible.db`; runs `001` then `002` |
| `search.ts` | Tokenizer (ASCII letters, unique, AND later in SQL) |
| `memorySeed.ts` | Tiny in-process seed when no raw files |
| `view/index.ts` | Dispatcher: path/open, actions, `switch (parsed.kind)` |
| `view/root.ts`, `verse.ts`, `search.ts`, `bookmarks.ts`, `commentary.ts`, `copy.ts`, `signin.ts`, `path.ts`, `helpers.ts` | Graph slices |
| `data/raw/` | Committed import texts |
| `data/SOURCES.md` | What those files are |
| `db/migrations/` | `001_corpus.sql` (placeholders) + `002_reader.sql` (drops 001, real schema) |

Graph: root (OT/NT/Bookmarks/Search/Version) → books → chapters → verses (wrap in chapter; no wrap in bookmarks/search) → options (Copy, Bookmark, Versions, Commentary). Active version: `reader_prefs` if signed in, else URL, else first version row (fallback string `"kjv"`).

**Notes** — `src/apps/notes/`  
Signed-out → kit `signedOut()`. Signed-in: Create + notes (no wrap); enter → input (`replace`); Done → `action` save. Store methods all take `ownerId`. Memory store for tests; SQLite for production.

**Gmail** — `src/apps/gmail/`  
Signed-out → kit `signedOut()`. No `ctx.oauth` → “not configured.” Not connected → Connect (`external` Google URL). Connected: Disconnect / Compose / subjects; enter subject → `splitText` chunks; compose pipeline with actions. Tokens via `ctx.oauth` only. `view.ts` is the largest app module (~580 lines). Scope is `gmail.modify`.

**Account** — `src/apps/account/`  
The only app granted `ctx.identity`. Signed-out: email → password → register-then-sign-in. Signed-in: Settings stub + Sign out. Flow email stored by `sessionId` in Account’s DB, not in node labels. `changePassword` exists on the identity **service** but is not on `IdentityCapability` and has no screen.

### 3.6 Server host

| Component | Path | What it does |
|-----------|------|----------------|
| Production entry | `server/index.ts` | Optional TLS; static `dist/`; `/api` + `/oauth` |
| Vite plugin | `server/vitePlugin.ts` | Same `/api` + `/oauth` in `npm run dev` |
| Host composer | `server/host.ts` | Opens host DB, identity, lockbox, OAuth; walks `FIRST_PARTY_APPS`; `dispatch` is the real HTTP path |
| Pack catalog | `server/firstPartyApps.ts` | One row per app: start + `directory` / `identity` / `lockbox` / `oauth` flags |
| Session HTTP | `server/http.ts` | Parse open/refresh bodies; CSRF; cookie; call host. `handleAppHttp` is tests-only (no CSRF) |
| CSRF | `server/csrf.ts` | JSON content-type + exact Origin. If `NOWISEE_ORIGIN` unset, origin is derived from `Host` + `X-Forwarded-Proto` |
| Cookie | `server/cookie.ts` | `__Host-nowisee_session`, HttpOnly, Secure, SameSite=Lax, Path=/ |
| Body cap | `server/readBody.ts` | 1 MiB; destroy socket when exceeded |
| SQLite helper | `server/sqlite.ts` | WAL, FKs, busy timeout, numbered migrations. **Apps import this** — library, not `ctx.db` |
| Host DB | `server/db/` | `users`, `sessions`, `lockbox`, `oauth_states` |
| Identity | `server/identity/` | Resolve/mint sessions; register/sign-in/sign-out; scrypt + concurrency gate; bind `ctx.identity` |
| Lockbox | `server/lockbox/` | AES-256-GCM, AAD `userId\0appId\0slot`; capability bound to user+app |
| OAuth | `server/oauth/` | Auth-code + PKCE; state hashed; tokens in lockbox; callback `GET /oauth/callback`; returnPath sanitized |

### 3.7 Tests, scripts, spikes, CI

| Component | Path | What it does |
|-----------|------|----------------|
| Tests | `tests/*.test.ts` | One file per core module and app; CSRF, identity, OAuth, lockbox, owner-scope, packaging |
| Fixtures | `tests/helpers/` | Tiny Bible seed; fake `AppModule` |
| Packaging test | `tests/packaging.test.ts` | String checks: core must not mention app-kit; bootstrap must not mention `kjv.json` / in-page app modules; remote stub must not mention bible/kjv |
| Download corpus | `scripts/download-bible-sources.mjs` | Fetch VPL/USFM/HelloAO/TSK/SWORD. Manual; not in `package.json` |
| Old KJV pipeline | `scripts/prepare-kjv.mjs` | Brace-strip nested JSON → `kjv.json`. **Do not use.** Deletes supplied words |
| Spikes | `spikes/`, `public/spikes/` | Historical a11y probes. Not imported by the app |
| CI | `.github/workflows/ci.yml` | Node 22, `npm ci`, `npm test`, `npm run build` |
| Typecheck split | `tsconfig.app.json` / `tsconfig.node.json` / `tsconfig.test.json` | Client tsc **excludes** Node-only stores, Gmail client, importer so the browser graph cannot typecheck them in |

---

## 4. Unused code and data

Items you can remove **without changing user-visible behavior**, if you accept the listed caveat.

### 4.1 Safe to delete (confirmed dead runtime path)

| Item | Where | Why it is unused | Caveat |
|------|--------|------------------|--------|
| `kjv.json` | `src/apps/bible/data/kjv.json` | Importer never reads it. Live corpus is VPL under `raw/`. Packaging test only forbids the **string** in bootstrap | Large leftover; `prepare-kjv.mjs` still writes it. Delete script + file together |
| `scripts/prepare-kjv.mjs` | `scripts/` | Explicitly forbidden to extend; not in `package.json`; corrupts supplied words | Keep a one-line warning in SOURCES/ENGINEERING after deletion |
| `displayedRef` | `src/apps/bible/ids.ts` | Exported, never imported | Tiny |
| `canon.ts` `testamentLabel` | `src/apps/bible/canon.ts` | Re-export; all callers import from `catalog.ts` | Tiny |
| `BibleStore.listTestaments` | `types.ts` + `store.ts` | Root uses static `ROOT_ITEMS`, not this query | If you later want testaments from data, keep it |
| `BibleStore.verseCount` | same | No caller outside the store | Same |
| `BibleStore.chapterVerseMax` | same | No caller outside the store | Same |
| Empty `if` body in `collectNeighborhood` | `src/app-kit/neighborhood.ts` ~48–50 | Comment-only leftover | Harmless |
| `LockboxErrorCode "missing-key"` | `server/lockbox/errors.ts` | Nothing throws it | Schema/`keyId` still matter for rotation |

### 4.2 Unused by the product graph; still used by tests (delete only with the tests)

| Item | Where | Production | Tests |
|------|--------|------------|-------|
| `NotesStore.get` | `notes/types.ts`, stores | View never calls; list/create/update only | Owner-isolation tests |
| `GmailStore.getCached` | `gmail/store.ts` | Inbox uses `listInbox` + client `cached` option | Owner-isolation tests |
| `IdentityService.changePassword` | `server/identity/service.ts` | Not on `IdentityCapability`; no Account screen | `tests/identity.test.ts` |
| `Keyboard.setBindings` | `src/core/keyboard.ts` | Bootstrap passes bindings at construct | Unused even in tests |
| `Display.focus` | `src/core/display.ts` | Bootstrap **must not** call it (VoiceOver); `showText`/`showInput` already focus | Unused as a public recovery API |
| `handleAppHttp` | `server/http.ts` | Production uses `handleSessionHttp` | `tests/app-host.test.ts` |
| `createAppHost` | `server/host.ts` | Production uses `createNowiseeHost` + dispatch | Shell / app-host tests |
| `collectNeighborhood` | `app-kit/neighborhood.ts` | No app imports it | `tests/app-kit.test.ts` |

Recommendation: keep `NotesStore.get` / `GmailStore.getCached` as store API completeness **or** have the views use them. Do not leave “implemented + tested + never called from the app.” `changePassword` should either get an Account screen or leave the service until that screen exists — deleting it now only shrinks a tested capability.

`collectNeighborhood` is a **seam** (MODULES documents it; apps warm by hand today). Keep unless you want a smaller kit.

### 4.3 Seams (do not delete as “dead”)

| Item | Why it exists |
|------|----------------|
| `PlatformContext.announce` / `requestRefresh` | Declared, not provided. PREPAREDNESS: implement before live mail/social |
| `OAuth` `POST /oauth/:appId/events` | Reserved; Gmail has no `onProviderEvent` → 404 |
| Version `license` field | Catalog/DB seam for licensed translations; unused for gating |
| `commentary_xrefs` table + `section.xrefs` on the store | Plan: flatten into the label. TSK already inlines refs into `body` at import; Henry/JFB store empty `xrefs`. Loaded in `findSection`, **never rendered** |
| `Keyboard` remapping API (`setBindings`) | Locked design: bindings are core-owned and user-remapable later |
| `001_corpus.sql` then `002` DROP | In-development smash of the KJV-only schema. Could squash into one file because compatibility is not required — that is cleanup, not a functional unused path |

### 4.4 Unfinished / orphan in the working tree

| Item | Notes |
|------|--------|
| `src/apps/bible/db/migrations/003_recency.sql` | Present in the tree (untracked at audit start). **Not** listed in `openBibleDatabase` (`001` + `002` only). Do not leave a migration file that is never applied — wire it in or delete it |
| Account Settings node | Label: “Settings. This screen is not available yet.” Intentional stub, not dead code |

### 4.5 Duplicate / leftover data sources

| Item | Live path | Leftover |
|------|-----------|----------|
| KJV text | `raw/bibles/kjv_vpl/eng-kjv2006_vpl.txt` via `ensureCatalog` | `kjv.json` + `prepare-kjv.mjs` |
| Commentaries list | `COMMENTARY_RECORDS` in `catalog.ts` (store `listCommentaries` returns the catalog, not a DB query) | `commentaries` table still filled by import; listing ignores those rows |
| Client app list | Hardcoded in `bootstrap.ts` | Must match `FIRST_PARTY_APPS` by hand |
| Spike copies | `spikes/voiceover-dom-focus-probe.html` | Duplicate under `public/spikes/` for GitHub Pages |

### 4.6 Docs that are “unused” as current spec

Not code, but they cost the same as dead code: people follow them.

- `README.md` as onboarding (wrong).
- `BIBLE-PLAN.md` as a build ticket (slice is largely done).
- `MODULES.md` §18 implementation order.
- `DESIGN-REVIEW.md` body as if there were still no code.
- `spikes/README.md` as if browse-mode were still an open product question.

---

## 5. Elegance and robustness

What is already in good shape, then where the design is awkward.

### 5.1 What is already robust (do not “simplify” these)

- Core has **no** Bible/Mail/Notes branches. Product names stop at bootstrap and `FIRST_PARTY_APPS`.
- Navigation is data (`intent → edge`), not keystrokes in apps.
- Actions cannot fire on browse, revalidation, or replay.
- Owner is in the SQL (`ctx.userId`), not in the node id the browser resends.
- Bible works are catalog records + import formats, not `if (id === "henry")` in the graph.
- Host does not open app DBs or inject KJV.
- Display announcement is focus-only (the VoiceOver iOS trap is documented and avoided).

### 5.2 Two catalogs for the same apps

**Where:** `server/firstPartyApps.ts` vs `src/shell/bootstrap.ts`.

Home’s labels come from the **server** registry (`ctx.directory`). The **client** must still register a stub per id or `open` cannot be called. Adding Gmail required both files; MODULES §16 already forgot Gmail on the client list.

**Direction:** one pack description the shell and host both read, **or** a tiny client catalog next to the pack (id + label only). Do not invent a plugin loader.

### 5.3 Bible view: four switches on the same `ParsedNode`

**Where:** `view/index.ts` — `buildBibleView`, `payloadFor`, `versionFor`, `locationFor`; plus `ids.parseNodeId` as a long regex ladder.

The view **files** were split (root/verse/search/…). The **dispatcher** still encodes “what every kind means” four times. A new node kind is four edits plus id mint/parse.

**Direction:** one table `kind → { addLevel, payload, version, location }` the dispatcher interprets — same catalog idea already used for `ROOT_ITEMS` / `VERSE_OPTIONS`. Do not replace regex ids with a parser framework.

`parseNodeId` is also a long `if` chain. That is appropriate for a closed id language. Collisions are possible if a book id or version id ever contains `:`; today USFM ids do not.

### 5.4 Gmail `view.ts` is one module doing too much

**Where:** `src/apps/gmail/view.ts` (~580 lines): signed-out, unavailable, connect, inbox, bodies, compose, send, disconnect, paths, errors.

Bible already split this shape. Gmail did not.

**Direction:** same split as Bible: `view/connect.ts`, `view/inbox.ts`, `view/compose.ts`, dispatcher. Keep `gmailClient.ts` / `mime.ts` / `store.ts` as they are.

`viewFromState` always builds Disconnect + Compose + every subject + any fetched chunks. Fine at inbox size; it will get expensive if you warm many message bodies. That is a later policy issue, not a split blocker.

### 5.5 Dual store implementations (Notes, Gmail)

Memory store + SQLite store with the same interface. Tests prefer memory; production uses SQLite. Drift risk: a method added to one and not the other.

Bible tests use SQLite `:memory:` + seed instead. That is the more robust pattern (one implementation).

**Direction:** prefer `:memory:` SQLite in tests for Notes/Gmail too, **or** generate both from one helper. Not urgent while the interfaces are small.

### 5.6 Commentaries listed from catalog, sections from DB

`listCommentaries()` / `getCommentary()` return `COMMENTARY_RECORDS`. `findSection` reads SQLite. The `commentaries` table is written at import and not used for listing.

This matches “catalog owns the works.” It also means a DB row without a catalog entry is invisible, and a catalog entry without imported sections still appears.

**Direction:** either always list from DB (catalog is import-only) or stop inserting into `commentaries` and treat the table as leftover. Pick one owner.

### 5.7 `listTestaments` vs `ROOT_ITEMS`

`ROOT_ITEMS` always shows OT and NT. `listTestaments` would hide a testament with no books. Tests use a tiny seed that still has both. Production VPL has both.

The unused store method is the data-driven version; the UI is the hardcoded catalog. Either delete the method or drive the root from it (and keep `ROOT_ITEMS` for Bookmarks/Search/Version).

### 5.8 Hardcoded `"kjv"` fallback

`defaultVersionId()` uses `ORDER BY sort_order` then `?? "kjv"`. Catalog already has sort order; the string is a last-ditch if `versions` is empty (then the app is already on the empty-data node). Mild smell, not a branch tree.

Warm neighborhood in `root.ts` uses `.slice(0, 8)` for books/verses. Magic number; not a catalog policy. Fine for MVP; a `WarmPolicy` on the catalog would match the project’s own rule if you touch this anyway.

### 5.9 Kit neighborhood unused; apps hand-roll warm

`collectNeighborhood` was built so apps would not copy BFS. No app uses it. Bible/Gmail/Notes each assemble `warm` + fragments by hand.

**Direction:** use the helper **or** drop it from the public kit so MODULES does not advertise a path nobody takes.

### 5.10 Combined too far / split too far

| Too combined | Too split / extra layer |
|--------------|-------------------------|
| Gmail `view.ts` | `canon.testamentLabel` wrapping `catalog.testamentLabel` |
| Bible `view/index.ts` dispatcher + payload/location switches | `ARCHITECTURE.md` duplicating `types.ts` |
| Identity `changePassword` on the service but not the capability | Client `types.ts` carrying lockbox/oauth interfaces the browser never instantiates (acceptable as one contract file) |
| Account `authenticate` = register then sign-in in one function (product choice, but two outcomes mixed) | Apps importing `server/sqlite.ts` (library is fine; the path looks like “apps depend on the host”) |

`server/sqlite.ts` as a shared helper is the right size. If it bothers packaging, move it to something like `src/server-kit/sqlite.ts` so “server/” is only HTTP + identity.

### 5.11 Giant switches and awkward logic

| Location | What it is | Verdict |
|----------|------------|---------|
| Bible `parseNodeId` | Closed id language | Keep; table-driven optional |
| Bible `buildBibleView` / `payloadFor` / `locationFor` | Same kinds, four times | **Worth combining** |
| Gmail `tipIdForPath` / `locationFor` | Path ↔ node | Fine for a small path language |
| Help `view.ts` node switches | Fixed tutorial | Fine |
| Navigator edge kinds | `node` / `app` / `external` | Correct; do not abstract further |
| Import `record.format` | `helloao-chapter-json` vs `tsk-xref-table` | Correct catalog dispatch |
| `optionEnter` if/else on option type | Mirrors `VERSE_OPTIONS` | Could be a field on `VerseOption` (`enter: "action-copy" \| …`) so a new option is data |

### 5.12 Client trusts `RefreshResult` shape

`createFetchRpc` casts JSON. Navigator `applyResult` assumes `navigationMap` / `node` exist. DESIGN-REVIEW deferred validation until third-party apps.

A malformed first-party response can throw **outside** `startCall`’s catch after a partial apply. Cheap robustness: a type guard before `applyResult`. Not a rewrite.

### 5.13 Display is a DOM class Navigator constructs

PREPAREDNESS: extract a three-method Display port before iOS. Navigator still imports the DOM `Display`. Small now; stickier after more Display calls.

### 5.14 Account register-then-sign-in

`authenticate` always `register`s; on `email-taken` it `signIn`s. A typo of a new email **creates an account**. Wrong password on an existing email fails at sign-in (OK). This is a product choice, not a switch-statement problem. Worth a deliberate confirm or a separate Register vs Sign in branch if you ever want that.

### 5.15 Search tokenizer is ASCII-only

`split(/[^a-z]+/)` drops anything that is not a–z. Fine for KJV/ASV/BBE/YLT. A later non-English version needs a tokenizer swap — the function is already the right seam. Do not inline a second splitter.

### 5.16 MIME HTML strip

`gmail/mime.ts` prefers `text/plain`; HTML uses a conservative tag strip. Display then uses `textContent`, so this is a **reading quality** issue, not XSS. Rich mail will lose structure. Acceptable for v1.

### 5.17 Packaging tests are string searches

`tests/packaging.test.ts` forbids substrings in a few files. It does not:

- Assert Vite’s client graph excludes `store.ts` / `import.ts` / `kjv.json`
- Notice a new app added only on the server
- Replace `tsconfig.app.json`’s exclude list (which is the real client firewall)

A Vite `ssr.noExternal` / `build.rollupOptions` check, or an explicit `client/apps.ts` catalog, would be stronger.

### 5.18 Host `isEphemeral`

A `Db` object is always treated as ephemeral, even if that handle is file-backed. Tests-only footgun: apps get `:memory:` while the host DB might persist. Production passes a path string, so it is fine.

### 5.19 Silent busy / dead-end / failure

Locked for MVP, recorded as expensive for this audience (DESIGN-REVIEW §6). Three different states feel identical. Not an architecture rewrite; it is the deferred item that most affects real users.

---

## 6. Bugs

Defects, not style.

### 6.1 Warm-miss + failed refresh can trap the user (high)

**Where:** `Navigator.followNodeEdge` + `startCall` catch.

On a warm miss, Navigator **moves the stack** to `destId` with an empty label, keeps the old display, and refreshes. If refresh throws, the catch keeps “last good” **map and display** but **does not roll back the stack**. Tip id is the new node; the map is still keyed by the old nodes. Further intents miss → silent no-op.

The failure test (`tests/navigator.test.ts`) asserts display text and `isBlocked() === false`. It does **not** assert tip id. MODULES/ARCHITECTURE say stack stays last-good on refresh failure.

**Fix direction:** roll back stack (and cache pin) on failure for the warm-miss path, or refresh **before** committing the miss move.

Related: if `applyResult` throws on a malformed map, that throw is inside the try (good). If something after apply throws, the stack may already have moved.

### 6.2 `decodeURIComponent` on static files (medium)

**Where:** `server/index.ts` `serveStatic`.

A request with a broken `%` sequence can throw and become an unhandled rejection on that request. Catch and 400.

### 6.3 API catch-all reports “Invalid JSON” (low)

**Where:** `server/index.ts` / Vite plugin `handleApi`.

Any error that is not `BodyTooLarge` is returned as 400 `"Invalid JSON"`. Unexpected failures are mislabeled. Makes ops harder; not a user-facing Bible bug.

### 6.4 OAuth callback can mint a session and never set the cookie (medium)

**Where:** `handleOAuthHttp` + `identity.resolve`.

No cookie: callback does **not** call `resolve(null)` — empty `sessionId` → mismatch → Home. Matches spec.

Present but **expired/invalid** cookie: `resolve(token)` **mints a new anonymous session** (`issuedToken`) and the callback **never sends `Set-Cookie`**. Orphan session rows; the browser still holds the dead cookie.

**Fix direction:** callback should look up the session without minting, or only mint when it will `Set-Cookie`. Prefer: never mint on the callback.

### 6.5 Help / HTML branding vs product name (low)

`index.html` title and Help welcome: “Now I See.” Docs: Nowisee. Screen-reader users hear the Help string. Pick one.

### 6.6 Commentary xrefs not shown (low / product)

Plan said flatten xrefs into the section label. TSK inlines into `body` at import. `findSection` still loads `commentary_xrefs` and `commentaryLabel` returns `section.body` only. Duplicate work, not a crash. Either stop loading xrefs or append them.

### 6.7 NavPads hidden only by CSS (low)

Pads are `display: none` while `data-input-open` is set. If CSS failed to load, pads could still fire on an input tip. Keyboard already ignores arrows on input; pads do not check tip kind. Unlikely in production.

### 6.8 Known deferred, still user-visible

- Failed open/refresh: `console.warn` only; the surface does not say anything.
- Missing map edge: silent no-op (locked).
- Gmail new mail only appears on the next intent (`requestRefresh` not provided).

These are product bugs for a non-visual UI even though they are specified.

---

## 7. Security

Overall trust model is sound: cookie → `userId`, CSRF on `/api`, owner in every user-data query, tokens not in `RefreshResult`. No secrets in source. Findings below are gaps and residual risks, not a claim that auth is broken.

### 7.1 What is already right

- Client cannot send `userId`. Host `toRefreshExtras` only forwards `inputText` / `action`.
- Notes / Gmail / Bible bookmarks scope by `ctx.userId`. `tests/owner-scope.test.ts` covers forged stack ids.
- Passwords: scrypt with production params, dummy verify on missing email, timing-safe compare, session token hashed at rest, rotated on sign-in.
- Cookie: `__Host-` prefix, Secure, HttpOnly, SameSite=Lax, no `Domain`.
- Lockbox: AES-GCM + AAD binding user/app/slot; capability cannot name another user.
- OAuth: PKCE S256; state hashed; callback binds `sessionId` + `userId`; `returnPath` rejects `//`, `..`, `:`, `?`, `#`; client secret only in server→Google POST.
- Host does not open `data/apps/*.db`.
- Clipboard writes only during an action.

### 7.2 Issues

| Severity | Issue | Where |
|----------|--------|--------|
| **Medium** | No rate limit / lockout on register and sign-in. Scrypt `N=2^17` (~128 MiB) + `HashGate(2)` still allows CPU/memory pressure via `/api` | `identity/service.ts`, host HTTP |
| **Medium** | CSRF origin falls back to `Host` + first `X-Forwarded-Proto` hop when `NOWISEE_ORIGIN` is unset. Spoofable behind a bad proxy. Production OAuth path **requires** `configuredOrigin`, so a correctly configured deploy is pinned; tests/dev without the env var are weaker | `csrf.ts` `expectedOriginFromRequest` |
| **Medium** | `handleAppHttp` skips CSRF and cookies. Fine for tests; catastrophic if bound to a public listener. Keep it test-only (rename or do not export from the production entry) | `server/http.ts` |
| **Medium** | OAuth callback mint-without-Set-Cookie (see §6.4) | `oauth/http.ts` |
| **Low** | `AppNotFoundError` 404 body includes the app id (`Unknown app "…"`) | `server/errors.ts` |
| **Low** | `external` hrefs are not restricted to `http(s)`. First-party apps only today. Untrusted apps later could `javascript:` | Navigator |
| **Low** | Lockbox keyring from env loads **one** key. Schema has `keyId` and re-encrypt-on-read, but old keys cannot be loaded → rotation is incomplete | `lockbox/crypto.ts` |
| **Low** | `password_algo` column stored, never consulted (always current scrypt params). Upgrade-safe verify uses stored N/r/p; the algo name is unused | identity schema |
| **Low** | Unauthenticated `POST /oauth/:appId/events`. Gmail has no handler (404). A future `onProviderEvent` must authenticate inside the provider | `oauth/http.ts` |
| **Info** | Gmail scope `gmail.modify` is broad (read + send + modify). Intentional for send; remember at verification time | `gmail/oauth.ts` |
| **Info** | Register-then-sign-in can create accounts from email typos (see §5.14) | `account/view.ts` |
| **Info** | Client `fetch` does not set `credentials` explicitly; same-origin default includes cookies. Fine today; would break if the API origin ever splits | `rpc.ts` |

### 7.3 Not issues (checked)

- XSS via Gmail HTML: Display uses `textContent` / form values, not `innerHTML`.
- Stack replay as another user: queries include `owner_id` / `user_id` from `ctx`.
- Host injecting Bible JSON: it does not; app opens its own file.
- CSRF token missing: documented SameSite + Origin + JSON content-type design.
- Secrets in repo: OAuth client secrets and lockbox key are env-only.

---

## 8. Suggested priority

Order for **your** review, not an implementation plan.

### Documentation (cheap, high leverage)

1. Rewrite `README.md`.
2. Fix `SPEC.md` MVP / roadmap / deferred (Gmail and commentaries landed).
3. Sync `ARCHITECTURE.md` with `types.ts`; add Gmail/Help/`directory`.
4. Banner `DESIGN-REVIEW.md`; rewrite or archive `BIBLE-PLAN.md`.
5. Small accuracy: IDENTITY VPL seed, MODULES §16 Gmail, ENGINEERING/PREPAREDNESS Gmail + Notes ownership, GMAIL.md leftover “demo” line, download-script gitignore comment.

### Delete / quarantine (no behavior change)

1. `kjv.json` + `scripts/prepare-kjv.mjs`.
2. Unused Bible exports: `displayedRef`, `canon.testamentLabel`, `listTestaments` / `verseCount` / `chapterVerseMax` (or wire `listTestaments`).
3. Decide `003_recency.sql`: apply or delete.
4. Optional: squash `001`+`002` into one migration (in development, no compatibility tax).

### Bugs worth fixing even if you ignore the rest

1. Warm-miss refresh failure: roll back stack.
2. OAuth callback: do not mint a session without `Set-Cookie`.
3. `serveStatic` `decodeURIComponent` throw.

### Robustness if you are already in that file

1. One app catalog for host + client stubs.
2. Bible dispatcher table instead of four switches.
3. Split Gmail `view.ts`.
4. Guard `RefreshResult` before `applyResult`.
5. Rate-limit identity mutations.
6. Always set `NOWISEE_ORIGIN` in deploy; treat Host-derived origin as test-only.

### Leave alone until a named milestone

- `requestRefresh` / status channel / Display port (PREPAREDNESS).
- `collectNeighborhood` unless you are changing warm policy.
- Facebook research; do not start that app on current Meta APIs.
- Third-party sandbox, contract versioning, response caps.
- Lockbox multi-key rotation until you actually rotate.

---

## Appendix: file map (quick)

```text
AGENTS.md                 binding rules
README.md                 stale onboarding
docs/SPEC.md              product (partially stale)
docs/ARCHITECTURE.md      types (behind types.ts)
docs/MODULES.md           module behavior
docs/STORAGE.md           databases
docs/IDENTITY.md          auth
docs/ENGINEERING.md       stack / env
docs/PREPAREDNESS.md      later milestones
docs/DESIGN-REVIEW.md     historical reasoning
docs/BIBLE-PLAN.md        executed ticket
docs/GMAIL.md             v1 + Google research
docs/FACEBOOK.md          Meta API dead end
docs/AUDIT.md             this review

src/main.ts               browser entry
src/shell/bootstrap.ts    wires core + remote apps
src/core/                 generic shell
src/app-kit/              optional app helpers
src/apps/home.ts
src/apps/help/
src/apps/bible/           graph + SQLite + raw corpus
src/apps/notes/
src/apps/gmail/
src/apps/account/
src/apps/rpc.ts           client HTTP
src/apps/remote.ts        generic stub

server/index.ts           production HTTP
server/host.ts            compose identity + apps
server/firstPartyApps.ts  pack list
server/identity/
server/lockbox/
server/oauth/
server/db/                host schema only

tests/                    vitest, node env
scripts/                  corpus download; dead prepare-kjv
spikes/                   a11y probes
```
