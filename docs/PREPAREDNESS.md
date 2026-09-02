# Nowisee — preparedness

This file explains why the architecture looks the way it does, how it is meant to scale, and what is still deferred. Product locks live in [`SPEC.md`](SPEC.md). Layering rules live in [`../AGENTS.md`](../AGENTS.md).

Until the product is no longer in development, there is **no compatibility tax**: do not add code whose only job is keeping old clients or existing stored data working.

---

## Why this shape

The expensive bets are already in place. They exist so that app number fifty, a phone swipe layer, or a worker/iframe host do not force a rewrite of the shell.

- **Apps answer `open` / `refresh`.** Core never computes the next node id. A new app is a module plus a pack row.
- **Intents, not keystrokes, in app data.** Remapping, right-to-left locales, VoiceOver pads, and a native gesture layer are all one binding table in core.
- **Message-shaped boundary.** Stack, map, and payloads are plain data. That is what makes a later sandbox — a worker, an iframe, or a server — the same protocol over a different transport. It is a discipline today, not isolation yet.
- **Per-app stack; Home is an app.** Histories do not mix products. Core identifies Home only as `config.rootAppId`.
- **App-owned stores; host-owned identity.** Core has no database. `ctx.userId` comes from the session cookie. Secrets such as OAuth tokens sit in the host lockbox, not in an app file and not in a `RefreshResult`.

Rapid keys stay local because of the navigation map plus the warm cache. Do not move Navigator or first-party apps onto the server just to add a feature that the cache already covers.

Production is a Node host that serves the site and `/api` together (`npm start`). A static-only host cannot run this product. Login wants same-site cookies, so the SPA and the API stay on one origin.

---

## How it scales

| Growth | What changes | What must not change |
|--------|----------------|----------------------|
| More first-party apps | A folder, an `AppModule`, a pack row, and a remote stub. Home lists `ctx.directory`. | No product names in core. The host does not open that app’s database. |
| Larger corpora | They stay on the server; the app seeds its own file. The client bundle stays a shell. | No corpus in `src/core/` or in the browser graph. |
| Hosted identity at volume | The identity service could swap SQLite for another engine behind `server/db`. | Apps still see `ctx.userId`, never `ctx.db`. |
| Native client (iPhone) | Map swipe and direct-touch to the same four intents. Extract a three-method Display port (`showText` / `showInput` / `getInputText`) so Navigator can run headless. Keep the session cookie in the WebView. | Do not port apps to Swift. Do not teach apps about swipes. Do not build a second login path. |
| Live updates | Implement reserved `platform.requestRefresh()` as a read-only refresh of the current tip. The label updates in place; there is no teleport. | Apps must not `setInterval` or touch the DOM to fake push. |
| Third-party apps | Same `open` / `refresh` messages. Then validate at Navigator `apply()`, add `apiVersion`, cap warm/map size, and run a sandbox host with catalog/review. | Do not hand apps the DOM, the registry, or live objects. Do not grow core branches per outsider feature. |
| Payments | The Account app plus an external processor. Freemium stays at the app layer. | No ad region or second competing surface on Display. |

Keep `owner_id` (from `ctx.userId`) in every user-data query. Keep returning JSON that would survive `structuredClone`.

---

## Still deferred

These items are additive. The cost of waiting is recorded so they are not treated as accidents later.

### Status channel (busy / dead-end / failure)

A dead-end key is a silent no-op (locked). A warm miss blocks with no placeholder. A warm-miss refresh failure now speaks on the content surface (retry / back). Warm-hit revalidation failure and failed open still keep last-good text.

Busy and dead-end are still identical silence for this audience. They cannot tell “nothing that way” from “still working.” The predictable coping behavior is to mash the key, which is the worst input pattern for in-flight transitions.

**When taken up:** add a second, screen-reader-only announcement channel in Display, distinct from the focused content surface. It is an announcement, not a competing interactive region. Pending work after a short delay can speak a polite “working”; a dead end can use a distinguishable cue (or silence as a setting). Warm-miss load failure already uses the content surface. Content announcement stays focus-only. Until this lands, apps **MUST** resolve action calls with a status node rather than reject — a rejection strands the user on the working label.

### Deep-link ancestry

URL `open` resets the stack (locked), so a shared link starts with one entry. Reaching a node by navigating leaves parents on the stack, and `back` returns to the parent. Reaching the same node from a link makes `back` exit to Home. Apps can inspect stack length in `refresh` and author `back` accordingly; that is boilerplate, and the key’s meaning still depends on how the user arrived.

**When taken up:** allow optional ancestry on `open` only (`RefreshResult.stack`). Core validates that the last entry matches `node.id` and ignores the field on `refresh`. This is rehydration at entry, not a teleport. The correct parent is not always obvious — inventing one is worse than having none — which is why this stayed deferred.

### Other reserved work

| Item | Notes |
|------|--------|
| `requestRefresh` | Typed, not provided. Implement it before a tip must update without a user intent (for example, new mail on the current subject). |
| Display port | Three methods. Extract them before a native iOS surface. The seam gets stickier after more Display calls. |
| Response validation / `apiVersion` / unknown values | Typed, not provided. The single choke point is Navigator `apply()`. Wait until apps you did not write exist. Intended later: unknown edge kind → missing edge; unknown node kind → render as text; unknown intent → never matched. |
| Browser Back/Forward vs session stack | Hashchange → `openLocation` is enough for now. |
| Identity rate limits, password reset, email verify, export/deletion | See [`IDENTITY.md`](IDENTITY.md) §13. |
| Monetization | Wait. Do not leave an ad hole in core. |

Screen-reader browse mode (arrows never reaching the page) was an existential risk. It is **settled** in the product: `role="application"` on text tips, Cancel/Done on input, and VoiceOver edge pads. Evidence is in [`spikes/README.md`](../spikes/README.md).
