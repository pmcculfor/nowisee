# Nowisee — long-term preparedness

**Reviewed:** August 2026. Specs: [`SPEC.md`](SPEC.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), [`MODULES.md`](MODULES.md), [`DESIGN-REVIEW.md`](DESIGN-REVIEW.md). Code: `src/` as of that date. Identity notes (draft, not locked): [`IDENTITY.md`](IDENTITY.md).

**Question asked:** how ready is Nowisee to grow into a product with a database, signed-in users, more apps (including ones we did not write), monetization, and thin native clients?

**Verdict:** the expensive architectural bets are already right — portable `AppModule`s, intents instead of keystrokes, a data-only `open` / `refresh` boundary, injected Notes storage, and no product names in core. Those are the decisions that would force a rewrite later. Adding a database, app number fifty, or a phone swipe layer does **not** require a new architecture. Signed-in users, live social/AI, and a native UI are **not** ready yet; they are small named additions on seams already reserved, not a redesign.

---

## How to read the tables

**When** is about rewrite risk, not whether the feature is desirable.

- **Wait** — additive later; doing it now is extra work, not protection.
- **Before a named milestone** — waiting until *after* that milestone (iPhone, real mail, Facebook, synced Notes) is what creates rework.
- **Ready now / keep the discipline** — the path already exists; do not undo it.

---

## Preparedness by aspect

| Aspect | Current state | Scaled long-term | Getting there | When |
|--------|---------------|------------------|---------------|------|
| **Database** | No server database. Bible is bundled JSON. Notes persist through an injected `NotesStore`; the shell wires `localStorage`. `platform.storage` is declared and unused. Demo mail was specified, not built. | Core still has no database. Each app keeps a store adapter (`NotesStore` talks HTTP/Postgres). Optional `platform.storage` KV for prefs. Server cache and sessions stay behind apps, never in NodeCache. | Write a remote `NotesStore` with the same list/get/create/update shape. Add `ownerId` when auth exists. Provide `platform.storage` so the next small app does not invent another KV wrapper. Never add a core `BibleRepository` or `NotesRepository`. | **Wait on a real DB as a core concern.** The swap path already exists. Fill `platform.storage` when a second simple-KV app appears. See draft notes in [`IDENTITY.md`](IDENTITY.md). |
| **User logins** | None. Notes are one unowned pool on this browser. No session, OAuth, or credential vault. SPEC deferred auth onto the platform seam. | Identity as a platform capability that web and native both implement. An Account app for sign-in. Gmail/Facebook/X go through a server-side vault. Apps feature-detect; they never touch `localStorage` for secrets or hold client secrets. | Auth service, Account app, `platform.identity`. Notes (and later mail accounts) filter by owner on the **server**. Native uses the same capability, not a second login system. First confidential OAuth client is also the moment a backend is required. | **Before first OAuth or sync.** Real mail, Facebook, X, or multi-device Notes. Building those on ad-hoc tokens is the expensive rework. Draft notes in [`IDENTITY.md`](IDENTITY.md). |
| **Saved user data** | Notes: `id`, `body`, timestamps; no owner; device-local; no delete on the store. No stored email or social logins. Schema comment already said add `ownerId` later and keep the graph. | User-scoped records on a backend. Notes, drafts, enabled-app flags. Credentials in a secrets vault, not in a Notes-like JSON blob. Web and phone share the same APIs. | `ownerId` (or equivalent) enforced by the API, not trusted from the client. Export/import of local notes at first sign-in. New credential capability for mail/social tokens. Keep using store injection — do not start new apps on raw `localStorage`. | **With the first auth drop.** Not harder if you wait, as long as every stateful app keeps an injected store. |
| **Hosting and traffic** | Vite SPA plus same-origin `/api` in dev. Home and Bible run on the Node host. Vite base `/`. KJV is not in the client bundle. | Keep the shell static (or same-site with the API). Add a small API plus one database only when user data exists. Public corpora on CDN and lazy-loaded. Traffic stays cheap until social or AI (API rate limits, LLM cost). | No host migration needed to scale the Bible. Stand up a public Node (or equivalent) host that serves the site and `/api` together. History API paths, if wanted, touch Router only. **Login wants same-site cookies** — a real domain (SPA + API on one site) is the production auth host. | **A static-only host cannot run this slice.** Public deploy is a Node host, not GitHub Pages. |
| **First-party apps** | Home, Bible, Notes. Registry is compile-time `register()`. Home lists descriptors, not the registry object. App-kit helpers exist. Core has no product names. | New app = folder + `AppModule` + one register line (later: lazy import and per-user enabled flags). Facebook, X, and AI chat are graphs of text/input nodes. Home stays an ordinary app. | Almost no core work. Domain, URLs, and warm policy stay in the app. Lazy-load large apps so a game or social client does not ship KJV. | **Ready now.** Adding apps you write will not get harder. |
| **Third-party apps** | Message-shaped `open`/`refresh`, in-process. No sandbox, no `apiVersion`, no response caps, no runtime loading, no App Store. Discipline, not isolation. | Each untrusted app in a worker, iframe, or server. Versioned contract, warm/map caps, per-capability permissions, catalog and review. Same `open`/`refresh` messages over a different transport. | Keep returning plain JSON from every app. Then add validation at the single Navigator `apply()` choke point, `apiVersion`, a sandbox host, and store UI. Do not hand apps the DOM, registry, or live objects. | **Wait until you want outsiders.** Sandbox is additive if the data-only rule holds. |
| **Live data and push** | The screen changes only when the user fires an intent. `requestRefresh` is typed and not provided. `AbortSignal` already cancels superseded reads. Action calls are never aborted. | Apps call `platform.requestRefresh()` when mail, social, or a chat reply has new text for the current tip. Label updates in place; no teleport. Streaming AI is in-place label refresh or chunked nodes, not a new core workflow. | Implement the reserved capability in Navigator as a read-only refresh of the current tip. Decide AI streaming without a new `NodeKind` if possible. Do not let apps `setInterval` or touch the DOM to fake push. | **Before mail, social, or AI.** If those apps poll internally, that polling becomes the rework. |
| **Monetization** | None. No accounts, payments, or ad surface. Display is one text blob or one input (locked). | Subscription (sync, extra apps, AI quota) via an Account app and Stripe. Optional later cut of a third-party store. Sponsorships need no architecture. Display ads fight the product: they need chrome core must not grow, and impression ads for people who cannot see them are hostile and likely invalid traffic for ad networks. | Auth first, then Account + Stripe. Freemium at the app layer (Bible free, sync paid). Do not add an ad region, banner slot, or second competing surface to Display. | **Wait.** Do not leave an ad hole in core. Payments need auth anyway. |
| **Maintenance** | Small vanilla TS shell, strict `tsc`, Vitest, Pages CI. Specs are strong and partly duplicate `types.ts`. Busy, dead-end, and failure are all silent to the user. No backend to operate. | Keep core small and generic. Apps proliferate. Status channel so silence is not three meanings. Telemetry at Navigator. Contract version when apps ship on a different cadence. Operate a small API when it exists. | Status channel is Display + Navigator, additive. Telemetry is one hook at `apply()`. Do not add a UI framework. Treat `ARCHITECTURE.md` and `types.ts` as one contract. | **Status channel sooner; rest wait.** Silence is a product bug for this audience, not an architecture rewrite. |
| **iPhone thin client** | Intents already exist. Keyboard and VoiceOver edge pads are two input hosts. Navigator imports the DOM `Display` class (`showText`, `showInput`, `getInputText`). Apps run in-page. No JS bridge, no native gesture layer. | Native maps swipe and direct-touch to `prev`/`next`/`enter`/`back`. Near term: native chrome + hidden WKWebView running this core, bridge to `onIntent`, native text/input (VoiceOver bypassed for navigation). Scaled: the same messages over a session API so apps can run on a server. | Extract a Display port so Navigator is headless (three methods today). Native Done/Cancel fire `enter`/`back`. Implement platform clipboard, storage, and later auth on iOS. Do not port apps to Swift. Do not teach apps about swipes. | **Display port before iOS starts.** Small now; stickier after more Display calls. Gesture UI is new native work, not a core rewrite. Session API only if you outgrow WebView. |
| **Android** | None. TalkBack users would use the website. NavPads were built for VoiceOver, not TalkBack as a first-class host. | Second host of the same intent protocol and Display port. Direct-touch vs TalkBack is an Android input module. Apps unchanged. | Reuse the iPhone bridge. Do not fork `AppModule`s per OS. | **After the iPhone path.** Not harder later. |

---

## Planned and hypothetical apps

| App | Fit with the shell | What would actually block it | When |
|-----|--------------------|------------------------------|------|
| **Notes** (shipped) | List / create / edit as text and input nodes. Store injected. Graph does not need to change for a remote DB. | Multi-device sync and owner enforcement. Delete is missing on the store. No conflict policy yet. | Sync with auth. Local Notes can stay as they are. |
| **Real mail** | Inbox as siblings, body as enter, compose as input + action send. Demo mail in the spec is this graph with fake data. | OAuth, token vault, `requestRefresh`, a backend if you need a confidential client. Do not put SMTP in core. | After identity + `requestRefresh`. A portable fake-data Mail module would still be useful. |
| **Facebook / X** | Feed as a sibling list, post as enter, comments as children. Images become text descriptions or skipped. | OAuth, token vault, `requestRefresh`, pagination in the app’s warm/map. Meta and X platform rules are the real risk: unofficial clients get shut off; official APIs are restricted or paid. That is product/legal, not a shell gap. | After auth + live refresh. Do not prototype these as client-only `fetch` + `localStorage`. |
| **AI chat** | Prompt as an input node, history as a list, “Thinking…” then the reply updating in place. Fits the no-teleport rule. | API keys and cost (subscription maps well). Streaming: prefer in-place label updates via `requestRefresh`. Do not let the app write the DOM. | After `requestRefresh`. Quota/billing wait for payments. The graph can be sketched anytime. |
| **Games** | Text adventures, quizzes, and turn-based games are ordinary `AppModule`s. Visual or real-time action games are not a one-text-surface product. | Do not add sprites, canvas, or a game loop to core. A visual game should be `kind: "external"` or a different product. Third-party games need the sandbox path. | Text games anytime. Do not extend `NodeKind` for graphics. |

---

## What to schedule (from the review)

**Do before the next milestone**

- If iPhone is soon: extract a three-method Display port from Navigator so a native surface can replace the DOM without forking the shell.
- Before real mail, Facebook, X, or synced Notes: lock identity / OAuth / token vault, and implement `requestRefresh`. Those apps cannot be honest static-SPA clients.
- Keep the discipline that makes later sandbox possible: apps return plain data and never touch `localStorage`, clipboard, or the DOM.

**Safe to postpone**

- An App Store, contract versioning, response validation, Android, Stripe, and any ad system.
- A status channel (busy vs dead-end vs failure) is not a rewrite, but it is the deferred item not to keep postponing for users who cannot see a spinner.

**Runtime (draft in [`IDENTITY.md`](IDENTITY.md); under discussion)**

- Do **not** move Navigator or first-party `AppModule`s onto the server in order to add login. Rapid keys stay local because of the navigation map + warm cache.
- Do **stand up** a small same-origin API for identity, sessions, and app data. That is the server work login actually needs.
