# Nowisee — agent guide

This file is binding for anyone (human or agent) working on Nowisee. The lock table later in the file is meant to be scanned quickly. The surrounding sections explain the same rules in ordinary sentences.

Start with the product in [`docs/SPEC.md`](docs/SPEC.md). Contracts and stack are in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Core behavior and the app interface are in [`docs/MODULES.md`](docs/MODULES.md). Storage is [`docs/STORAGE.md`](docs/STORAGE.md); identity is [`docs/IDENTITY.md`](docs/IDENTITY.md). Scale and remaining deferrals are in [`docs/PREPAREDNESS.md`](docs/PREPAREDNESS.md). Each app’s graph and data live next to that app (`src/apps/<id>/README.md`).

## Product in one paragraph

Nowisee is an accessibility-first website for blind and keyboard/screen-reader-primary users. The UI shows **one unformatted text surface** (a text node, or an input box when the current node is an input node). Navigation is driven by a **navigation map** keyed by intents (`prev`, `next`, `enter`, `back`), which core binds to keystrokes. The product is a graph of nodes served by portable **apps**, including Home. Core is a generic shell — never product-specific.

## Quality bar

- **Robust over sloppy.** Incomplete work is fine. Fragile, one-off, or product-specific core code is not.
- **Design before code.** Enumerate behaviors and edge cases first. Tests verify the design; they do not invent it.
- **DRY.** Each concern has one owner. Never two ways to compute the same thing.
- **Long-term product.** Assume years of maintenance, many apps, and other authors. That is architecture, not a promise to keep old clients or old rows working.
- **In development, no compatibility tax.** Nowisee is in development. Do not add code whose only job is keeping old clients, old `open` / `refresh` shapes, old URLs, or existing stored data working. Users, notes, settings, bookmarks, and sessions need not be preserved across schema or product changes. Export, dual-write, and client version negotiation wait until the product is no longer in development.
- **Fail loudly.** Missing or invalid required values must surface, not be replaced with a default so the path still runs. We want the failure now.

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
| **Host** | HTTP broker only (`src/host/`). CSRF, host SQLite (`app_catalog`, identity, sessions, lockbox, OAuth state), identity service, and a loopback **capability** port. It never imports or starts apps. Each request `SELECT`s `app_catalog` and POSTs signed ctx to that row's locator. Identity is hardcoded to `accountAppId` (`"account"`). See [`docs/IDENTITY.md`](docs/IDENTITY.md) and [`docs/STORAGE.md`](docs/STORAGE.md). |
| **Node kit** | Shared Node runtime apps and the host import: `openSqlite`, HTTP listen/body, signed wire ctx, capability HTTP client, `serveApp`. Not graph helpers. |
| **App kit** | Optional helpers apps *import* (edge builders, list edges, input edges, signed-out node, split text). Navigator never calls these automatically. |
| **App domain** | That app’s data, queries, graph shape, side effects, URLs. An app may import `core`, `app-kit`, and `node-kit`. It may not import `host` or another app. |

If any answer is “only our first apps,” it does **not** belong in core. Prefer app kit for shared graph boilerplate and node-kit for shared Node glue; keep domain logic in the app. Anything the page must never see — secrets, session lookup — belongs to the host or to that app's own store, and reaches an app as plain data (or a granted capability) on the context argument. There is no `ctx.db`.

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
- Any module other than Router producing a browser pathname
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
- Resolving a tip or `triggerId` without the owner in the query — the browser sends those ids, unverified, on every refresh
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
| App API | `open(path)` + `refresh(nodeId, extras)` → navigation map + warm + tip + location. `open` may also return committed `stack` ancestry. Refresh never carries `stack`. |
| Prefetch | App pushes `warm` + navigation-map edges; core only stores/serves |
| Navigation map | `(fromNodeId, intent) → node \| app \| external \| resume` edge; missing = silent no-op; nested structure, no delimiter |
| Intents | Apps author `prev` / `next` / `enter` / `back`; **core alone** maps keystrokes, edge pads, and input Cancel/Done/Recent apps to intents. Reserved `recents` is intercepted by Navigator (opens `config.recentsAppId`) |
| Actions | `action: true` on an edge; core sets `extras.action = { triggerId }` (pre-move tip) on that traversal **only**; never re-issues, retries, aborts, or coalesces it; apps run side effects only then. The write is chosen by `triggerId`; rendering keys on the refresh tip. Core **blocks** for the duration of every action call. Action failure offers **back only** (never retry). |
| Stack | One **current** stack per session; Navigator parks the previous app's stack on successful cross-app `open`. `kind: "resume"` restores then `refresh`. URL `open` still resets **that** app, then may install `OpenResult.stack` |
| Node edge stackBehavior | `push` / `replace` / `pop` / `stay` / `pushTransient` / `popTransient`. `push`/`replace`/`pushTransient` require `toNodeId`. `pushTransient` also requires a non-empty `frame`. `pop`/`stay`/`popTransient` omit `toNodeId`. `replace` onto its own `fromNodeId` is malformed. `popTransient` never pops the last entry. |
| Cross-app / leave app | `app` location edges (fresh `open`, drops destination park); `resume` restores a parked stack. App root `back` **MUST** be an `app` edge to home |
| Home | An `AppModule`, not a core-special UI; identified by `config.rootAppId`, never a core constant |
| Recents | A first-party app (`config.recentsAppId`). Hidden from Home (`homeRole: internal`, `parkable: false`). Navigator intercepts `recents`. Home is parkable but never listed |
| Input leave | Done → `enter`, Cancel → `back`, Recent apps → `recents`; plain arrows unbound for the caret; **no Escape exit** |
| Sibling ends | App choice via edges (wrap not mandated) |
| Dead-end intent | Silent no-op |
| Status / action aftermath | Stay on node until user navigates; refresh may update text in place |
| Addressing | Apps use `AppLocation`; Router alone serializes; `location: null` keeps prior address bar |
| App boundary | Plain data in, plain data out — must survive being sent as a message. The abort signal is the only non-data member |
| Platform capabilities | Copy is `clipboardText` on the refresh result; core writes the clipboard during an action. Apps never touch browser APIs directly |
| Concurrency | One monotonic transition token decides full apply; a covering stale read-only result may replace warm/map without taking the tip; read-only: one in-flight + one pending; tip-id comparison is not a full-apply guard |
| Ownership | Navigator owns every state transition; Router is a pure URL boundary |
| Client vs server cache | Core owns client warm only; server cache/session behind apps |
| Identity ownership | A host-layer **identity service** owns credentials, hashing, sessions, and cookie → user resolution. The Account app owns only the screens. Capability HTTP grants identity only when the ticket's `appId === accountAppId`. See [`docs/IDENTITY.md`](docs/IDENTITY.md) §6 |
| Signed out | `ctx.userId` is `null`; the request still reaches the app; the **app** decides what that means. No `401`, no core redirect, no host gate |
| Sessions | One per visitor from the first `/api` call. Anonymous **session**, never an anonymous *user* id. Opaque token, only its hash stored, rotated on sign-in |
| Auth/DB | Identity on the host SQLite file; each app opens its own database via `NOWISEE_APP_DB`. Lockbox and OAuth live on the host capability port (403 if `grant_*` is 0). Tests use `startTestFleet` and the seeded catalog grants plus a test keyring. Clipboard remains the only platform capability the client provides. See [`docs/STORAGE.md`](docs/STORAGE.md) |
| App catalog | `app_catalog` is the only app list. Read on every dispatch. `grant_*` are integer columns. No compile-time pack. Locators are loopback HTTP this slice. Host never starts apps. |
| App processes | Each first-party app is `src/apps/<id>/main.ts` over the same HTTP contract as a future remote locator. Wire ctx is data only (signed); lockbox/oauth/identity are not on the wire. |
| Secret input | A `secret` flag on `kind: "input"` (not a new NodeKind). Display renders `type="password"` and honest `autocomplete` tokens. Leave path unchanged: Done → `enter`, Cancel → `back`, Recent apps → `recents` |
| In development | No backwards compatibility. Existing stored data (users, notes, settings, bookmarks, sessions) need not be preserved across changes. Do not add shims for old clients, old contracts, or old rows. |

## Mental model

- **Core** is the shell for a text-node browser: keys, stack, map, cache, registry, display, and router.
- **Apps** are the authorities that answer `open` / `refresh` with navigation maps and warm nodes.
- **Host** is an HTTP broker (`src/host/`): CSRF, identity/sessions, catalog, signed dispatch, capability port. It does not start apps.
- **Node kit** is shared Node glue. **App kit** is optional graph helpers.
- When unsure, push knowledge into the app (or the optional app kit) and keep core smaller.

## How to work in this repo

The product is a frontend SPA (Vanilla TypeScript + Vite) plus a same-origin broker under `src/host/`. Each first-party app is its own Node process (`src/apps/<id>/main.ts`). The browser holds generic RPC stubs. Tests use `startTestFleet()` (ephemeral ports, in-memory SQLite) and need no environment variables or secrets. **Nowisee runs only on a server — there is no local-machine mode.** `npm start` is the host only; it reads every value from the environment and refuses to boot when one is missing. Host boot also needs `NOWISEE_HOST_SIGNING_KEY` and `NOWISEE_CAPABILITY_LISTEN`. Apps that use OAuth/lockbox need `NOWISEE_LOCKBOX_KEY`, `NOWISEE_LOCKBOX_KEY_ID`, `NOWISEE_ORIGIN`, and `NOWISEE_OAUTH_<APP>_CLIENT_ID` / `_CLIENT_SECRET` on the **host**, not in app env. Sign-in codes need `NOWISEE_MAIL_FROM`, `NOWISEE_RESEND_API_KEY`, and `NOWISEE_OTP_PEPPER`. Commands live in `package.json`. Node 22 is expected (that matches `.github/workflows/ci.yml`).

- **Running it:** `npm run build && npm start`. Staging is https://dev.nowisee.app; production is https://nowisee.app. There is no Vite dev server — verify with `npm test`, then deploy to staging.
- **Production:** `npm run build && npm start` is the **host** (`src/host/index.ts`); apps are `nowisee-app@<id>`. Staging on the same droplet is **https://dev.nowisee.app**. OAuth redirect is `{NOWISEE_ORIGIN}/oauth/callback`. Env templates: [`.env.production.example`](.env.production.example), [`.env.staging.example`](.env.staging.example), [`deploy/app.env.example`](deploy/app.env.example); units: [`deploy/nowisee.target`](deploy/nowisee.target), [`deploy/nowisee-dev.target`](deploy/nowisee-dev.target). Node does not load `.env` files — systemd `EnvironmentFile=` injects them. Droplet commands: [`deploy/README.md`](deploy/README.md).
- **Tests:** `npm test` (Vitest, node environment). Host/HTTP tests use `startTestFleet`. Some tests deliberately exercise failure paths and log to stderr — `Navigator: refresh/open failed` from `tests/navigator.test.ts`, `sign-in mail failed` from `tests/identity.test.ts`. Those lines are expected and do **not** mean the suite failed. Dual-Navigator JSON in `tests/fixtures/navigator/` is part of that suite; a core Navigator/decode change should add or extend a scenario there. CI also runs `swift test` in `ios/` (Mac) against the same files.
- **Lint / typecheck:** there is no ESLint/Prettier. `npm run build` type-checks the app, the host, **and the tests** (`tsconfig.app.json`, `tsconfig.node.json`, `tsconfig.test.json`, all `--noEmit`), then runs `vite build`. Tests are checked against the real contracts on purpose: they are the most-read example of how to call an app, so a test that no longer matches `open` / `refresh` must fail the build rather than pass on a lenient helper. A "chunks are larger than 500 kB" warning, if it still appears, is not an error. Large corpora stay on the server; see each app’s README for how that app seeds.
- **Do not drive the running app in a browser.** The owner prefers agents verify with `npm test` (and, if needed, HTTP against `/api`). Browser automation is slow. Humans may still use a browser locally.

Humans using the running app: on a text node, arrow keys navigate (Up=prev, Down=next, Right=enter, Left=back). Press **r** for recent apps. The text surface has `role="application"` so those keys reach the page. Invisible edge pads still exist for VoiceOver (right=enter, left=back, top=prev, bottom=next). On the iPhone overlay, hold one finger still for **one second** for recents. On an input node, type in the multiline field (Enter inserts a newline) and activate **Done** (`enter`), **Cancel** (`back`), or **Recent apps**. Password nodes use a masked field. Tab and Escape stay unbound.
