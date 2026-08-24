# Nowisee — long-term preparedness

**Reviewed:** August 2026. Specs: [`SPEC.md`](SPEC.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), [`MODULES.md`](MODULES.md), [`DESIGN-REVIEW.md`](DESIGN-REVIEW.md), [`STORAGE.md`](STORAGE.md). Code: `src/` as of that date. Identity, sessions, host SQLite, and the Account app are specified and **landed** in [`IDENTITY.md`](IDENTITY.md). App-owned databases are specified in [`STORAGE.md`](STORAGE.md). The secret lockbox and generic OAuth broker **landed** (August 2026); no Gmail or Facebook app consumes them yet.

**Question asked:** how ready is Nowisee to grow into a product with a database, signed-in users, more apps (including ones we did not write), monetization, and thin native clients?

**Verdict:** the expensive architectural bets are already right — portable `AppModule`s, intents instead of keystrokes, a data-only `open` / `refresh` boundary, app-owned stores (Notes keyed by `userId`), and no product names in core. Those are the decisions that would force a rewrite later. Adding a database, app number fifty, or a phone swipe layer does **not** require a new architecture. Signed-in users are in place (identity service + Account app). Live social/AI and a native UI remain small named additions on seams already reserved, not a redesign.

---

## How to read the tables

**When** is about rewrite risk, not whether the feature is desirable.

- **Wait** — additive later; doing it now is extra work, not protection.
- **Before a named milestone** — waiting until *after* that milestone (iPhone, real mail, Facebook, synced Notes) is what creates rework.
- **Ready now / keep the discipline** — the path already exists; do not undo it.

Until the product is no longer in development, there is **no compatibility tax**: do not add code to keep old clients or existing stored data working. The binding rule lives in [`../AGENTS.md`](../AGENTS.md) (quality bar, anti-patterns, lock table).

---

## Preparedness by aspect

| Aspect | Current state | Scaled long-term | Getting there | When |
|--------|---------------|------------------|---------------|------|
| **Database** | Host SQLite for `users` / `sessions`. Account, Bible, and Notes each open `data/apps/*.db`. Notes rows are keyed by `owner_id` (`ctx.userId`). Bible verses are keyed by version. No `platform.storage`, no `ctx.db`. | Core still has no database. Each app owns its file or remote store. Host identity may later swap to Postgres; that does not rewrite apps. | Keep `owner_id` in every user-data query. Never add a core `BibleRepository` or `NotesRepository`. | **Keep the discipline.** Spec in [`STORAGE.md`](STORAGE.md). |
| **User logins** | Identity service + Account app landed. HttpOnly session cookie, anonymous sessions, `ctx.userId` from the cookie only. Lockbox and generic OAuth broker landed (`ctx.lockbox` / `ctx.oauth`, grant lists default empty). Notes lists and writes only when `userId` is set. | Identity lives on the **server host**, not as a client capability. Each app decides what signed-out means — Bible still reads, Notes and later Mail explain and offer a way in. Gmail/Facebook/X go through the host vault. | First confidential OAuth **app** (Gmail, Facebook) is the remaining consumer. **No `platform.identity` on the client.** | **Gmail/Facebook apps next.** Vault and callback exist. Spec in [`IDENTITY.md`](IDENTITY.md) §3. |
| **Saved user data** | Account flow is session-scoped in Account's db. Notes are user-scoped in Notes' db (`owner_id` = `ctx.userId`, never session id). | User-scoped records in that app's database. Credentials in the lockbox, not in a Notes-like JSON blob. | `ownerId` in every query ([`IDENTITY.md`](IDENTITY.md) §9). Export/deletion deferred. Do not start new apps on raw `localStorage`. | **Keep the discipline.** |
| **Hosting and traffic** | Vite SPA plus same-origin `/api` in dev. `npm start` serves `dist/` and `/api`. Home, Bible, Notes, and Account run on the Node host. SQLite file on disk. Vite base `/`. KJV is not in the client bundle. | Keep the shell static (or same-site with the API). Add a small API plus one database only when user data exists. Public corpora on CDN and lazy-loaded. Traffic stays cheap until social or AI (API rate limits, LLM cost). | No host migration needed to scale the Bible. Stand up a public Node (or equivalent) host that serves the site and `/api` together. History API paths, if wanted, touch Router only. **Login wants same-site cookies** — a real domain (SPA + API on one site) is the production auth host. | **A static-only host cannot run this slice.** Public deploy is a Node host, not GitHub Pages. |
| **First-party apps** | Home, Help, Bible, Notes, Account. Registry is compile-time `register()`. Home lists descriptors, not the registry object. Help is first in the catalog. App-kit helpers exist. Core has no product names. The host still names each `start*` for apps that own a file. | New app = folder + `AppModule` + one catalog/start row (later: lazy import and per-user enabled flags). Facebook, X, and AI chat are graphs of text/input nodes. Home stays an ordinary app. | Almost no core work. Domain, URLs, and warm policy stay in the app. Lazy-load large apps so a game or social client does not ship KJV. Collapse the host’s per-app start list — see **Owner follow-ups**. | **Ready now**, aside from the host start list. Adding apps you write will not get harder once that lands. |
| **Third-party apps** | Message-shaped `open`/`refresh`, in-process. No sandbox, no `apiVersion`, no response caps, no runtime loading, no App Store. Discipline, not isolation. | Each untrusted app in a worker, iframe, or server. Versioned contract, warm/map caps, per-capability permissions, catalog and review. Same `open`/`refresh` messages over a different transport. | Keep returning plain JSON from every app. Then add validation at the single Navigator `apply()` choke point, `apiVersion`, a sandbox host, and store UI. Do not hand apps the DOM, registry, or live objects. | **Wait until you want outsiders.** Sandbox is additive if the data-only rule holds. |
| **Live data and push** | The screen changes only when the user fires an intent. `requestRefresh` is typed and not provided. `AbortSignal` already cancels superseded reads. Action calls are never aborted. | Apps call `platform.requestRefresh()` when mail, social, or a chat reply has new text for the current tip. Label updates in place; no teleport. Streaming AI is in-place label refresh or chunked nodes, not a new core workflow. | Implement the reserved capability in Navigator as a read-only refresh of the current tip. Decide AI streaming without a new `NodeKind` if possible. Do not let apps `setInterval` or touch the DOM to fake push. | **Before mail, social, or AI.** If those apps poll internally, that polling becomes the rework. |
| **Monetization** | Accounts exist; no payments or ad surface. Display is one text blob or one input (locked). | Subscription (sync, extra apps, AI quota) via an Account app and Stripe. Optional later cut of a third-party store. Sponsorships need no architecture. Display ads fight the product: they need chrome core must not grow, and impression ads for people who cannot see them are hostile and likely invalid traffic for ad networks. | Auth first, then Account + Stripe. Freemium at the app layer (Bible free, sync paid). Do not add an ad region, banner slot, or second competing surface to Display. | **Wait.** Do not leave an ad hole in core. Payments need auth anyway. |
| **Maintenance** | Small vanilla TS shell, strict `tsc`, Vitest. CI runs tests and the build on Node 22; there is no deploy step yet. Specs are strong and partly duplicate `types.ts`. Busy, dead-end, and failure are all silent to the user. No backend to operate. | Keep core small and generic. Apps proliferate. Status channel so silence is not three meanings. Telemetry at Navigator. Contract version when apps ship on a different cadence. Operate a small API when it exists. | Status channel is Display + Navigator, additive. Telemetry is one hook at `apply()`. Do not add a UI framework. Treat `ARCHITECTURE.md` and `types.ts` as one contract. | **Status channel sooner; rest wait.** Silence is a product bug for this audience, not an architecture rewrite. |
| **iPhone thin client** | Intents already exist. Keyboard and VoiceOver edge pads are two input hosts. Navigator imports the DOM `Display` class (`showText`, `showInput`, `getInputText`). Apps run in-page. No JS bridge, no native gesture layer. | Native maps swipe and direct-touch to `prev`/`next`/`enter`/`back`. Near term: native chrome + hidden WKWebView running this core, bridge to `onIntent`, native text/input (VoiceOver bypassed for navigation). Scaled: the same messages over a session API so apps can run on a server. | Extract a Display port so Navigator is headless (three methods today). Native Done/Cancel fire `enter`/`back`. Implement platform clipboard on iOS. Identity needs no iOS work beyond letting the WKWebView keep the session cookie — do not build a second login path. Do not port apps to Swift. Do not teach apps about swipes. | **Display port before iOS starts.** Small now; stickier after more Display calls. Gesture UI is new native work, not a core rewrite. Session API only if you outgrow WebView. |
| **Android** | None. TalkBack users would use the website. NavPads were built for VoiceOver, not TalkBack as a first-class host. | Second host of the same intent protocol and Display port. Direct-touch vs TalkBack is an Android input module. Apps unchanged. | Reuse the iPhone bridge. Do not fork `AppModule`s per OS. | **After the iPhone path.** Not harder later. |

---

## Planned and hypothetical apps

| App | Fit with the shell | What would actually block it | When |
|-----|--------------------|------------------------------|------|
| **Notes** (shipped) | List / create / edit as text and input nodes. Store injected. Graph does not need to change for a remote DB. | Multi-device sync and owner enforcement. Delete is missing on the store. No conflict policy yet. | Sync with auth. Local Notes can stay as they are. |
| **Real mail** | Inbox as siblings, body as enter, compose as input + action send. Demo mail in the spec is this graph with fake data. | Gmail app, `requestRefresh`, restricted-scope verification. Lockbox and OAuth broker already exist. Do not put SMTP in core. | After `requestRefresh`. Vault is done; the Gmail app is not. |
| **Facebook / X** | Feed as a sibling list, post as enter, comments as children. Images become text descriptions or skipped. | App graph + `requestRefresh`. Lockbox and generic callback already exist. Meta and X platform rules are the real risk: unofficial clients get shut off; official APIs are restricted or paid. That is product/legal, not a shell gap. | After live refresh. Do not prototype these as client-only `fetch` + `localStorage`. |
| **AI chat** | Prompt as an input node, history as a list, “Thinking…” then the reply updating in place. Fits the no-teleport rule. | API keys and cost (subscription maps well). Streaming: prefer in-place label updates via `requestRefresh`. Do not let the app write the DOM. | After `requestRefresh`. Quota/billing wait for payments. The graph can be sketched anytime. |
| **Games** | Text adventures, quizzes, and turn-based games are ordinary `AppModule`s. Visual or real-time action games are not a one-text-surface product. | Do not add sprites, canvas, or a game loop to core. A visual game should be `kind: "external"` or a different product. Third-party games need the sandbox path. | Text games anytime. Do not extend `NodeKind` for graphics. |

---

## What to schedule (from the review)

**Do before the next milestone**

- If iPhone is soon: extract a three-method Display port from Navigator so a native surface can replace the DOM without forking the shell.
- Before real mail, Facebook, X, or synced Notes: implement `requestRefresh`. Identity, lockbox, and the OAuth broker have landed; those apps still cannot be honest static-SPA clients.
- Keep the discipline that makes later sandbox possible: apps return plain data and never touch `localStorage`, clipboard, or the DOM.

**Safe to postpone**

- An App Store, contract versioning, response validation, Android, Stripe, and any ad system.
- A status channel (busy vs dead-end vs failure) is not a rewrite, but it is the deferred item not to keep postponing for users who cannot see a spinner.

**Runtime (specified in [`IDENTITY.md`](IDENTITY.md))**

- Do **not** move Navigator or first-party `AppModule`s onto the server in order to add login. Rapid keys stay local because of the navigation map + warm cache.
- Production is a Node host that serves the site and `/api` together (`npm start`). A static-only host cannot run this slice.

---

## Owner follow-ups (not yet scheduled)

Wanted eventually. Not a rewrite; recorded so it is not treated as an accident of the current host.

| Item | Current | Wanted | Constraint |
|------|---------|--------|------------|
| **Generic host start** | `createNowiseeHost` names `createHomeApp`, `createHelpApp`, `startBibleApp`, `startNotesApp`, and `startAccountApp`, and `close()` names each file-backed app again. | A catalog of starters the host walks: for each registered app, start it (and later close it). Adding an app is a catalog row, not a new host branch. | Each app still owns its own start — opens its own file, seeds, receives granted capabilities. The host must not grow a `switch (appId)` or open app databases itself. This is the “one register line” path in **First-party apps** above; the host is the remaining per-app list. |
