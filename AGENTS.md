# Nowisee — agent guide

This file is binding for anyone (human or agent) working on Nowisee. Product detail lives in [`docs/SPEC.md`](docs/SPEC.md). Interface contracts live in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Module responsibilities live in [`docs/MODULES.md`](docs/MODULES.md). Review findings, accepted deltas, and deliberate deferrals live in [`docs/DESIGN-REVIEW.md`](docs/DESIGN-REVIEW.md).

## Product in one paragraph

Nowisee is an accessibility-first website for blind and keyboard/screen-reader-primary users. The UI shows **one unformatted text surface** (a text node, or an input box when the current node is an input node). Navigation is driven by a **navigation map** keyed by intents (`prev`, `next`, `enter`, `back`), which core binds to keystrokes. The product is a graph of nodes served by portable **apps**, including Home. Core is a generic shell — never Bible-, Mail-, or Notes-specific.

## Quality bar

- **Robust over sloppy.** Incomplete is fine. Fragile, one-off, or product-specific core code is not.
- **Design before code.** Enumerate behaviors and edge cases first. Tests verify the design; they do not invent it.
- **DRY.** One owner for each concern. Never two ways to compute the same thing.
- **Long-term product.** Assume years of maintenance, many apps, and other authors.

## Packaging layers (before anything enters core)

| Layer | Role |
|-------|------|
| **Core** | Client shell. Router (URL ↔ location only), per-app stack, navigation-map store, client warm cache, display, keyboard binding table, registry, busy/errors. Talks to apps only via `open` / `refresh`. |
| **Server host** | Runs `AppModule`s off-device and owns everything the browser must not: HTTP boundary and its CSRF checks, the database and migrations, the secret lockbox, and an **identity service** module that owns credentials, sessions, and cookie → user resolution. Calls apps through the same `open` / `refresh`, adding a server-only context argument. It resolves who the user is; it does **not** gate apps on being signed in — each app decides what signed-out means. Not core, not an app. See [`docs/IDENTITY.md`](docs/IDENTITY.md). |
| **App kit** | Optional helpers apps *import* (edge builders, list edges, input edges, optional neighborhood warm walk). Navigator never calls these automatically. |
| **App domain** | That app’s data, queries, graph shape, side effects, URLs. |

If any answer is “only Bible / mail / notes / our first apps,” it does **not** belong in core. Prefer app kit for shared boilerplate; keep domain logic in the app. Anything the page must never see — secrets, session lookup, raw database access — belongs to the server host, and reaches an app as plain data on the context argument.

## Genericity checklist (before anything enters core)

1. **Multiplicity:** Works as a list/map of many ids (50 apps, many nodes)?
2. **Unknown app:** Could a third-party app use this with no core edits?
3. **Who decides?** Core = mechanics; app = content, edges, warm set, stale handling, URLs.
4. **No product names in core.**
5. **Variance by tree level:** Per-`refresh` response decisions, not core one-size prefetch policy.
6. **Swap path:** App data source can change without rewriting the shell.
7. **Stale-safe:** Core never assumes an old node id still exists without refresh.
8. **One extension path:** New app / new node / richer refresh result — not new core branches per feature.
9. **DRY / one owner** per concern.
10. **Design edge cases before code.**

## Anti-patterns (do not repeat)

- Core `BibleRepository` / `MailRepository` / `NotesRepository` or Home hardcoding peer app node ids
- `provide(nodeId)` / core-chosen next id for `next` / `enter`
- Core prefetch radii (`siblingRadius`, `childDepth`, etc.) or automatic multi-level warm expansion in Navigator
- Special `activate()` API or an `action` edge *kind* (actions are ordinary nodes; the trigger is an `action: true` flag on the edge)
- Side effects on any call that does not carry `extras.action`
- Keystrokes (`"ctrl+right"`, `"ArrowLeft"`) or directions in app data — apps author intents
- Any module other than Router producing a `#/…` string
- Router (or anything but Navigator) mutating stack, cache, map, busy, or display
- Live objects across the app boundary (handing an app the registry, the DOM, or a class instance)
- Apps calling `navigator.clipboard`, `localStorage`, or the DOM instead of returning `clipboardText` / using a platform capability
- Detecting staleness by comparing tip ids instead of the transition token
- `back` = tree parent only (use navigation-map edges; inside an app, typical `back` is `pop`)
- Assuming every node has a unique permanent URL
- Putting Bible/Mail/Notes logic into core “just for the MVP”
- Silent stack teleport after workflows (e.g. jump to inbox after send)
- Auto-dismissing status/confirmation text without an explicit intent
- Escape-as-platform-exit from input nodes
- Trusting a user or owner id that came from the client (`stack`, `path`, `extras`) instead of from the session cookie on the server
- Resolving a node id out of the stack without the owner in the query — the browser resends that stack, unverified, on every refresh
- Core learning what "signed in" means: no `401` branch, no account app id in core, no shell-wide sign-in redirect. A signed-out user reaches the app like anyone else, and the app answers with an ordinary node
- Splitting authentication between the host and the Account app. One identity service owns credentials, hashing, and sessions; the Account app owns only the screens over it, through an injected capability — the same shape as `NotesStore`
- The host calling an app in order to authenticate a request. The dependency runs Account app → identity service, never the reverse

## Locked behaviors (do not change without owner approval)

| Topic | Lock |
|-------|------|
| App API | `open(path)` + `refresh(stack, extras)` → navigation map + warm + tip + location |
| Prefetch | App pushes `warm` + navigation-map edges; core only stores/serves |
| Navigation map | `(fromNodeId, intent) → node \| app \| external` edge; missing = silent no-op; nested structure, no delimiter |
| Intents | Apps author `prev` / `next` / `enter` / `back`; **core alone** maps keystrokes, edge pads, and input Cancel/Done to intents |
| Actions | `action: true` on an edge; core sets `extras.action` on that traversal **only**; never re-issues, retries, aborts, or coalesces it; apps run side effects only then |
| Stack | Per **current app** only; opening a location resets stack |
| Node edge stackBehavior | `push` / `replace` / `pop` (on `pop`, omit `toNodeId`; stack tip wins) |
| Cross-app / leave app | `app` location edges only; app root `back` **MUST** be an `app` edge to home |
| Home | An `AppModule`, not a core-special UI; identified by `config.rootAppId`, never a core constant |
| Input leave | Done → `enter`, Cancel → `back`; plain arrows unbound for the caret; **no Escape exit** |
| Sibling ends | App choice via edges (wrap not mandated) |
| Dead-end intent | Silent no-op |
| Status / action aftermath | Stay on node until user navigates; refresh may update text in place |
| Addressing | Apps use `AppLocation`; Router alone serializes; `location: null` keeps prior address bar |
| App boundary | Plain data in, plain data out — must survive being sent as a message. The abort signal is the only non-data member |
| Platform capabilities | Copy is `clipboardText` on the refresh result; core writes the clipboard during an action. Apps never touch browser APIs directly |
| Concurrency | One monotonic transition token in Navigator decides what applies; tip-id comparison is not a staleness guard |
| Ownership | Navigator owns every state transition; Router is a pure URL boundary |
| Client vs server cache | Core owns client warm only; server cache/session behind apps |
| MVP apps | Home + KJV Bible as server `AppModule`s reached via a generic client RPC stub. Notes exists in `src/apps/notes` but is not registered. |
| Identity ownership | A host-layer **identity service** owns credentials, hashing, sessions, and cookie → user resolution. The Account app owns only the screens, through `ctx.identity`, which the host grants per request to allowed apps only. See [`docs/IDENTITY.md`](docs/IDENTITY.md) §6 |
| Signed out | `ctx.userId` is `null`; the request still reaches the app; the **app** decides what that means. No `401`, no core redirect, no host gate |
| Sessions | One per visitor from the first `/api` call. Anonymous **session**, never an anonymous *user* id. Opaque token, only its hash stored, rotated on sign-in |
| Auth/DB | Identity slice specified in [`docs/IDENTITY.md`](docs/IDENTITY.md) and not yet built; clipboard remains the only platform capability the client provides |

## Mental model

- **Core** = shell for a text-node browser (keys, stack, map, cache, registry, display, router).
- **Apps** = authorities that answer `open` / `refresh` with navigation maps and warm nodes.
- **Server host** = where apps run and where anything the page must not hold lives (sessions, database, secrets).
- When unsure, push knowledge into the app (or optional app kit); keep core smaller.

## Cursor Cloud specific instructions

Frontend SPA (Vanilla TS + Vite) plus a same-origin app host under `server/` (Home + Bible `open`/`refresh`). No database, environment variables, or secrets are needed to run, test, or build. Commands live in `package.json`; Node 22 is expected (matches `.github/workflows/ci.yml`).

- **Dev server:** `npm run dev` serves at `http://localhost:5173/`. POST `/api/apps/:id/open` and `/refresh` are served in-process. Production with server apps needs a Node host that serves the site and `/api` together.
- **Tests:** `npm test` (Vitest, node environment). `tests/navigator.test.ts` intentionally logs `Navigator: refresh/open failed Error: boom` to stderr while exercising the failure path — that stderr line is expected and does **not** mean the suite failed.
- **Lint / typecheck:** there is no ESLint/Prettier. `npm run build` runs `tsc -p tsconfig.app.json --noEmit` and `tsc -p tsconfig.node.json --noEmit`, then `vite build`.
- **Build:** the client bundle should **not** include KJV JSON (that file is loaded by the server host). A "chunks are larger than 500 kB" warning, if it still appears, is not an error.
- **KJV data:** committed at `src/apps/bible/data/kjv.json`. `scripts/prepare-kjv.mjs` is a one-off regeneration step that reads the gitignored `public/data/kjv.raw.json`; it is **not** needed for dev/test/build.
- **Navigating the running app:** on a text node, the arrow keys navigate (Up=prev, Down=next, Right=enter, Left=back). The text surface has `role="application"` so those keys reach the page. Invisible edge pads still exist for VoiceOver (right=enter, left=back, top=prev, bottom=next). On an input node, type in the multiline field (Enter = newline) and activate **Done** (`enter`) or **Cancel** (`back`). Tab and Escape stay unbound. Notes is not in the running catalog.
