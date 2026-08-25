# Nowisee — agent guide

This file is binding for anyone (human or agent) working on Nowisee. The lock table later in the file is meant to be scanned quickly. The surrounding sections explain the same rules in ordinary sentences.

Start with the product in [`docs/SPEC.md`](docs/SPEC.md). Contracts and stack are in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Core behavior and the app interface are in [`docs/MODULES.md`](docs/MODULES.md). Storage is [`docs/STORAGE.md`](docs/STORAGE.md); identity is [`docs/IDENTITY.md`](docs/IDENTITY.md). Scale and remaining deferrals are in [`docs/PREPAREDNESS.md`](docs/PREPAREDNESS.md). Each app’s graph and data live next to that app (`src/apps/<id>/README.md`, or [`src/apps/home.md`](src/apps/home.md)). Remaining non-doc work is listed in [`docs/current_audit.md`](docs/current_audit.md).

## Product in one paragraph

Nowisee is an accessibility-first website for blind and keyboard/screen-reader-primary users. The UI shows **one unformatted text surface** (a text node, or an input box when the current node is an input node). Navigation is driven by a **navigation map** keyed by intents (`prev`, `next`, `enter`, `back`), which core binds to keystrokes. The product is a graph of nodes served by portable **apps**, including Home. Core is a generic shell — never product-specific.

## Quality bar

- **Robust over sloppy.** Incomplete work is fine. Fragile, one-off, or product-specific core code is not.
- **Design before code.** Enumerate behaviors and edge cases first. Tests verify the design; they do not invent it.
- **DRY.** Each concern has one owner. Never two ways to compute the same thing.
- **Long-term product.** Assume years of maintenance, many apps, and other authors. That is architecture, not a promise to keep old clients or old rows working.
- **In development, no compatibility tax.** Nowisee is in development. Do not add code whose only job is keeping old clients, old `open` / `refresh` shapes, old URLs, or existing stored data working. Users, notes, settings, bookmarks, and sessions need not be preserved across schema or product changes. Export, dual-write, and client version negotiation wait until the product is no longer in development.

## Long-horizon design (binding)

This is how Nowisee work should be done — in core, in apps, and in data pipelines. Shipping a thin slice is fine; painting the product into a corner is not.

- **Objects and catalogs over special-case branches.** Put variance in typed records (rows, lists of descriptors, sequence objects). Builders interpret those records. Do not grow `if (id === "thisWork")` trees that must be edited for every new peer. A new catalog entry plus data is the extension path, not a new code path named after that product.
- **Do not block the future.** When a later feature is obvious, leave a seam (a `license` field, a structured table you flatten to text for now, a tokenizer function). Do not implement the later feature, and do not encode today's subset as if it were the whole universe.
- **Robust over clever parsing.** Prefer data that is already in the unit we navigate. Do not strip markup with regexes that can delete words. If a source format is encrypted or lossy, say so and use a better source; do not "make do" with a pipeline that silently corrupts text.
- **Same quality inside apps as in core.** Genericity is required of core. Apps should still be data-driven and boring to extend. Hard-coding a closed list of works as switch cases in an app graph is the same class of mistake as putting that app's logic in Navigator.

See [`docs/PREPAREDNESS.md`](docs/PREPAREDNESS.md) for why this layering exists and what is still deferred.

## Packaging layers (before anything enters core)

| Layer | Role |
|-------|------|
| **Core** | Client shell. Router (URL ↔ location only), per-app stack, navigation-map store, client warm cache, display, keyboard binding table, registry, busy/errors. Talks to apps only via `open` / `refresh`. |
| **Server host** | Runs `AppModule`s off-device and owns everything the browser must not: HTTP boundary and its CSRF checks, the **host** database (identity, sessions, lockbox, OAuth state), and an **identity service** that owns credentials, sessions, and cookie → user resolution. It does not open app databases or inject app data. Calls apps through `open` / `refresh` with a server-only context (`userId`, capabilities). It resolves who the user is; it does **not** gate apps on being signed in. Not core, not an app. See [`docs/IDENTITY.md`](docs/IDENTITY.md) and [`docs/STORAGE.md`](docs/STORAGE.md). |
| **App kit** | Optional helpers apps *import* (edge builders, list edges, input edges, optional neighborhood warm walk). Navigator never calls these automatically. |
| **App domain** | That app’s data, queries, graph shape, side effects, URLs. |

If any answer is “only our first apps,” it does **not** belong in core. Prefer app kit for shared boilerplate; keep domain logic in the app. Anything the page must never see — secrets, session lookup — belongs to the server host or to that app's own server store, and reaches an app as plain data (or a granted capability) on the context argument. There is no `ctx.db`.

## Genericity checklist (before anything enters core)

1. **Multiplicity.** Does this work as a list or map of many ids (fifty apps, many nodes)?
2. **Unknown app.** Could a third-party app use this with no core edits?
3. **Who decides?** Core owns mechanics. The app owns content, edges, the warm set, stale handling, and URLs.
4. **No product names in core.**
5. **Variance by tree level.** Decisions belong on each `refresh` response, not in a core one-size prefetch policy.
6. **Swap path.** The app’s data source can change without rewriting the shell.
7. **Stale-safe.** Core never assumes an old node id still exists without a refresh.
8. **One extension path.** A new app, a new node, or a richer refresh result — not new core branches per feature.
9. **DRY.** One owner per concern.
10. **Design edge cases before code.**

## Anti-patterns (do not repeat)

- Core `SomeAppRepository` or Home hardcoding peer app node ids
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
- Putting product logic into core “just for the first apps”
- Silent stack teleport after workflows (e.g. jump to a list after send)
- Auto-dismissing status/confirmation text without an explicit intent
- Escape-as-platform-exit from input nodes
- Trusting a user or owner id that came from the client (`stack`, `path`, `extras`) instead of from the session cookie on the server
- Resolving a node id out of the stack without the owner in the query — the browser resends that stack, unverified, on every refresh
- Core learning what "signed in" means: no `401` branch, no account app id in core, no shell-wide sign-in redirect. A signed-out user reaches the app like anyone else, and the app answers with an ordinary node
- Splitting authentication between the host and the Account app. One identity service owns credentials, hashing, and sessions; the Account app owns only the screens over it, through an injected capability
- The host calling an app in order to authenticate a request. The dependency runs Account app → identity service, never the reverse
- Host or Home rewriting one app's catalog label. Home lists each app's registered `label`; screen wording stays inside that app
- The host opening an app's database or injecting that app's data. Apps open their own files. See [`docs/STORAGE.md`](docs/STORAGE.md)
- Backwards-compat shims, dual-write, client version negotiation, or schema/migration code whose only purpose is preserving existing users, notes, settings, bookmarks, or other stored data

## Locked behaviors (do not change without owner approval)

These rows are the scanable form of the locks. The surrounding docs explain why.

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
| Identity ownership | A host-layer **identity service** owns credentials, hashing, sessions, and cookie → user resolution. The Account app owns only the screens, through `ctx.identity`, which the host grants per request to allowed apps only. See [`docs/IDENTITY.md`](docs/IDENTITY.md) §6 |
| Signed out | `ctx.userId` is `null`; the request still reaches the app; the **app** decides what that means. No `401`, no core redirect, no host gate |
| Sessions | One per visitor from the first `/api` call. Anonymous **session**, never an anonymous *user* id. Opaque token, only its hash stored, rotated on sign-in |
| Auth/DB | Identity on the host SQLite file; each app opens its own database. Secret lockbox and generic OAuth broker landed (`ctx.lockbox` / `ctx.oauth`). Tests leave grant lists empty; the running host grants lockbox/OAuth to apps that declare them. Clipboard remains the only platform capability the client provides. See [`docs/STORAGE.md`](docs/STORAGE.md) |
| Secret input | A `secret` flag on `kind: "input"` (not a new NodeKind). Display renders `type="password"` and honest `autocomplete` tokens. Leave path unchanged: Done → `enter`, Cancel → `back` |
| In development | No backwards compatibility. Existing stored data (users, notes, settings, bookmarks, sessions) need not be preserved across changes. Do not add shims for old clients, old contracts, or old rows. |

## Mental model

- **Core** is the shell for a text-node browser: keys, stack, map, cache, registry, display, and router.
- **Apps** are the authorities that answer `open` / `refresh` with navigation maps and warm nodes.
- **Server host** is HTTP, CSRF, identity/sessions, and granted capabilities. App data lives in that app's own database.
- When unsure, push knowledge into the app (or the optional app kit) and keep core smaller.

## How to work in this repo

The product is a frontend SPA (Vanilla TypeScript + Vite) plus a same-origin app host under `server/`. First-party apps answer `open` / `refresh` on the server; the browser holds generic RPC stubs. Tests use in-memory SQLite and need no environment variables or secrets. Dev and `npm start` create `data/nowisee.db` (host identity) and `data/apps/*.db` (gitignored) if those paths are unset. Apps that use OAuth/lockbox on the running host need `NOWISEE_LOCKBOX_KEY`, `NOWISEE_ORIGIN`, and `NOWISEE_OAUTH_<APP>_CLIENT_ID` / `_CLIENT_SECRET`. Commands live in `package.json`. Node 22 is expected (that matches `.github/workflows/ci.yml`).

- **Dev server:** `npm run dev` serves at `http://localhost:5173/`. POST `/api/apps/:id/open` and `/refresh` are served in-process with CSRF, sessions, and SQLite.
- **Production:** `npm run build && npm start` — `server/index.ts` serves `dist/` and `/api` together. OAuth redirect is `{NOWISEE_ORIGIN}/oauth/callback`. Env vars: [`.env.example`](.env.example).
- **Tests:** `npm test` (Vitest, node environment). `tests/navigator.test.ts` intentionally logs `Navigator: refresh/open failed Error: boom` to stderr while exercising the failure path — that stderr line is expected and does **not** mean the suite failed.
- **Lint / typecheck:** there is no ESLint/Prettier. `npm run build` runs `tsc -p tsconfig.app.json --noEmit` and `tsc -p tsconfig.node.json --noEmit`, then `vite build`. A "chunks are larger than 500 kB" warning, if it still appears, is not an error. Large corpora stay on the server; see each app’s README for how that app seeds.
- **Do not drive the running app in a browser.** The owner prefers agents verify with `npm test` (and, if needed, HTTP against `/api`). Browser automation is slow. Humans may still use a browser locally.

Humans using the running app: on a text node, arrow keys navigate (Up=prev, Down=next, Right=enter, Left=back). The text surface has `role="application"` so those keys reach the page. Invisible edge pads still exist for VoiceOver (right=enter, left=back, top=prev, bottom=next). On an input node, type in the multiline field (Enter inserts a newline) and activate **Done** (`enter`) or **Cancel** (`back`). Password nodes use a masked field. Tab and Escape stay unbound.
