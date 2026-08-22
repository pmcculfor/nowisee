# Nowisee — identity, apps on the server, and secrets

**Status:** Identity slice **landed** (August 2026). Home, Bible, and Account run on the server host. Host SQLite (`node:sqlite`) holds `users` / `sessions`. Each app opens its own database — see [`STORAGE.md`](STORAGE.md). The secret lockbox is **not** built. iPhone is in [`PREPAREDNESS.md`](PREPAREDNESS.md), not this file. Product locks: [`SPEC.md`](SPEC.md). Layer ownership: [`../AGENTS.md`](../AGENTS.md).

**Owner deltas applied in this slice**

- Registration is **open** by default. There is no invite code. `allowRegistration` on the host can close it later; the default is on because this product is not advertised.
- Combined sign-in / register: one option, then email, then a secret password field, then “Signing in…”, then “You are signed in as …”. Signed-in Account opens on Settings (a dead-end placeholder) with Sign out as the next sibling.
- Secret input is a `secret` flag on the existing `input` kind, not a new `NodeKind`.
- SQLite on a host that can keep a file; `npm start` serves the SPA and `/api` together.

---

## 1. Where code runs

**The shell stays on the device.** That is keys, swipes, the one text surface, the navigation map, and the warm cache. Pressing Down can still show the next screen immediately from cache, then the real app answers in the background. That is what the cache was for: delay between the device and the **app**, once the app is not inside the web page.

**Apps run on the server.** “Open this path” and “the user just did this” are answered by server code. The browser does not run Bible (or later Gmail) logic and does not call Google. Secrets never sit in the page.

This is not “every keypress waits on the network.” A cache hit is local. A cache miss, a first open, or a background revalidation is a server call. Copy-to-clipboard still happens on the device; the app returns `clipboardText` and core writes it.

**Landed:** Home, Bible, and Account run on the server. Notes is **not registered** (code can stay in the repo; the running app does not load it). Still not built: secret lockbox.

---

## 2. Nowisee login vs app secrets

These are **not** the same store. That is not a hack; they do different jobs.

| | Nowisee account | App secrets (Gmail, etc.) |
|---|-----------------|---------------------------|
| Purpose | Prove who is using Nowisee | Remember a token an **app** must use later |
| When it is needed | **Before** any app runs, on every request | After we already know the user, inside one app |
| What we store | Email, **one-way password hash**, session cookie | Encrypted tokens we **must be able to give back** |
| Who sees it | Identity service + the browser cookie (HttpOnly) | That app’s **server** code only, never the page |

You cannot put the Nowisee password in the secret lockbox. Opening the lockbox requires knowing which user it is; the password is how we know. Also a password must be hashed (checkable, not recoverable). Gmail tokens must be decryptable. One box cannot honestly do both.

Neither store belongs to the Account app. Who owns what is §6.

---

## 3. App secrets (when we build them — not in the identity slice)

A **platform** service (same idea as clipboard: the shell/platform provides it; Navigator does not become a password manager).

- An app says: “save this blob under slot `personal`” / “give me slot `personal`.”
- The service keys it by **this user + this app id + this slot**. One app may have many slots (two Gmail accounts). Our Gmail app and a third-party Gmail app have **different app ids** and cannot read each other’s slots.
- Only that app’s **server** code can read the blob. The browser never receives it.

Refresh tokens **are** meant to be stored — on the **server**, encrypted, never in the page. OAuth 2 warns against keeping them in browser JavaScript, not against a backend remembering them so the user is not sent through Google every hour.

Encryption at rest (plain picture): the database stores scrambled bytes. A **master key** lives on the server (environment / host secret manager), **not** in the git repo and **not** in the database file. The service uses that key to scramble on save and unscramble in memory when the app asks. Steal the database file without the key → useless. Steal the key **and** the database → they can read tokens; that is why the key is a host secret. Bible does not need this yet.

### Normative when built

| Rule | Why |
|------|-----|
| AES-256-GCM (or another AEAD), fresh random nonce per write | Detects tampering, not just hides content |
| `(userId, appId, slot)` passed as the AEAD **associated data** | A blob copied to another row in the database fails to decrypt. Without this, database write access lets an attacker move someone else’s Gmail token onto their own account |
| Every row stores a `keyId` | Master-key rotation later is a background re-encrypt, not a migration |
| `appId` is the **host’s** notion of which app is calling | Never a value taken from the request body |
| Blobs never appear in a `RefreshResult` | The lockbox is server-to-server; the page must not receive plaintext or ciphertext |

---

## 4. Data and hosting

- **Bible slice (landed):** no login on the host. KJV is seeded into Bible's own SQLite (`data/apps/bible.db`) from JSON next to the Bible app. The host does not import that file.
- **Identity slice (landed):** host SQLite (`node:sqlite`) for `users` / `sessions`. Account flow lives in Account's own database. Runtime details in §12. App files: [`STORAGE.md`](STORAGE.md).
- Public internet needs a host that runs Node and serves **both** the website and `/api` on the **same origin**. Entry point: `server/index.ts` (`npm start` after `npm run build`). Vite `npm run dev` still serves `/api` in-process. `Secure` cookies work on `http://localhost`. Production should terminate TLS (or set `NOWISEE_TLS_CERT` / `NOWISEE_TLS_KEY`); `NOWISEE_ORIGIN` is the CSRF origin when behind a proxy.

---

## 5. Identity slice — order of work

Login, cookies, Account, and SQLite were **one slice**. All five steps have landed:

1. **Host.** `server/index.ts` serves `dist/` and `/api` on one origin. Vite plugin remains for `npm run dev`.
2. **Database.** `server/db/` — host identity only (`001_identity.sql`). `openSqlite` in `server/sqlite.ts` is the shared helper. Account and Bible open their own files.
3. **Identity service.** `server/identity/` — credentials, scrypt, sessions, `resolve` / `register` / `signIn` / `signOut` / `changePassword`.
4. **Request plumbing.** Three CSRF layers, session cookie, `ctx` on `open` / `refresh`, `Cache-Control: no-store`, 1 MiB body cap.
5. **Account app.** `src/apps/account/` — ordinary `AppModule`. Graph in §11.4.

The lockbox (§3) waits for the first confidential OAuth client. iPhone waits; see [`PREPAREDNESS.md`](PREPAREDNESS.md).

---

## 6. Who owns authentication

Authentication was split between the host and the Account app in earlier drafts. Shared ownership is the one thing the quality bar refuses, so this section settles it.

The split needs one distinction: **identity** — can this request prove it belongs to a particular principal — versus **account screens** — what the user reads and types while proving it. Different jobs, different callers, different lifetimes.

### One owner per job

| Job | Owner |
|-----|-------|
| `users` and `sessions` tables and their migrations | **Identity service** |
| Hash a password; verify a candidate in constant time | **Identity service** |
| Mint, rotate, expire, and revoke session tokens | **Identity service** |
| Resolve a token to `{ sessionId, userId }` | **Identity service** |
| Email and password rules (normalization, uniqueness, length) | **Identity service**, returning a structured reason — never prose |
| Read the cookie off the request; write `Set-Cookie` | **Host HTTP layer** |
| Which apps may receive the identity capability | **Host config** |
| Sign-in / register / sign-out node graph, wording, error text | **Account app** |
| Profile that is not identity (display name, preferences) | **Account app**, its own table, keyed by `userId` |
| Scoping every query by owner | **Every app, always** (§9) |

### The identity service is not an app

It has no nodes, no graph, and neither `open` nor `refresh`. It is a **host-layer module** (`server/identity/`) that the host constructs and wires — the same way the host grants `ctx.identity` to Account and does not open Account's database.

Two reasons it cannot live inside the Account app:

1. **It runs before any app does, on every request.** The host must produce `ctx.userId` before it can call Bible, Notes, or Home. If resolution lived in the Account app, Bible would depend on the Account app being registered and healthy, and the host would be calling one app in order to serve another.
2. **`AppModule` has exactly two methods**, and session resolution is neither. Bolting a second interface onto one app would make "the Account app" two things sharing a folder — the same shared ownership, just relocated.

### The Account app is still not special

This is the shape a domain store already established: the app owns the graph and the wording, a store the **app** opens owns persistence. Notes will own `NotesStore` (not `localStorage`, not the host `Db`). Bible owns `BibleStore` and its SQLite file. Home does not own the registry. Account does not own the users table. Account remains an ordinary `AppModule` — the registry does not know it is different, core does not know it exists, and it gains no extra methods.

The only asymmetry is a host config list naming which app ids receive `ctx.identity`. That is data, it belongs to the host, and it generalizes: the same mechanism governs the lockbox (§3) and, later, per-capability permissions for third-party apps. Building it now for one app brings a planned mechanism forward instead of carving out a special case.

Keep the dependency arrow one-way: **Account app → identity service**, through the capability on `ctx`. The host never calls an app in order to authenticate, and the identity service never knows an app exists.

### Why the cookie is not the identity service's job

The service owns *what a session is and how long it lives*. The HTTP layer owns *how it travels*. Keeping HTTP out of the service means it can be tested without a request, and reused unchanged if a native client ever prefers a bearer token to a cookie.

This is not two owners for expiry. The service decides and enforces it; the cookie's `Max-Age` is a mirror the browser is free to ignore, which §7 already tells the server to assume.

### Sketch

```ts
// server/identity/service.ts — no HTTP, no nodes, not an AppModule
export interface IdentityService {
  /** Every request. Creates an anonymous session when the token is absent or dead. */
  resolve(token: string | null): Promise<{
    sessionId: string;
    userId: string | null;
    /** Present when the caller must send a new cookie. */
    issuedToken?: { value: string; expiresAt: number };
  }>;

  register(sessionId: string, email: string, password: string): Promise<AuthOutcome>;
  signIn(sessionId: string, email: string, password: string): Promise<AuthOutcome>;
  signOut(sessionId: string): Promise<{ issuedToken: null }>;
}

/** Structured, not prose — the Account app owns the words the user hears. */
export type AuthOutcome =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid-credentials" | "email-taken" | "weak-password" | "registration-closed" };
```

The host calls `resolve` once per request and sets a cookie when `issuedToken` comes back. The Account app calls `signIn` / `register` through `ctx.identity` (which returns `AuthOutcome` without the token) and renders the outcome. The HTTP layer owns `Set-Cookie`. Neither does the other's job. The service also exposes `changePassword`, which deletes every session row for that user and issues a new token.

---

## 7. Session cookie and CSRF (normative)

### Cookie

| Property | Value | Why |
|----------|-------|-----|
| Value | 32 random bytes from `crypto.randomBytes`, base64url | Opaque; nothing derivable from it |
| Stored in the database | **SHA-256 of the token only** | Reading the database file does not hand out live sessions. No slow hash needed — the token is already high-entropy |
| Name | `__Host-nowisee_session` | The `__Host-` prefix makes the browser refuse the cookie unless it is `Secure`, `Path=/`, and has no `Domain`. Browsers treat `http://localhost` as trustworthy, so dev is unaffected |
| Flags | `HttpOnly; Secure; SameSite=Lax; Path=/` | `HttpOnly` keeps it out of page JavaScript; `SameSite=Lax` is the first CSRF layer |
| Expiry | Idle **and** absolute, both enforced server-side | A cookie `Max-Age` is a client hint, not a guarantee |
| On successful sign-in | Always mint a **new** token | Prevents session fixation: an attacker who plants a known cookie value before login does not end up sharing the session. This applies to upgrading an anonymous session too (§11.2) |
| On sign-out | Delete the row, then clear the cookie | Revocation is real because the token is opaque and looked up, not self-describing |
| On password change | Delete **all** of that user's session rows | "Someone has my account" has an answer |

Opaque tokens rather than JWTs: we already have a database on the request path, so we get real revocation for free, and a session table is the thing that makes "sign out everywhere" possible.

### CSRF

Once a session cookie exists, **every** `POST /api/apps/:id/refresh` is a cookie-authenticated, state-changing endpoint — an `action: true` edge is the "send the mail" button, and the browser attaches the cookie no matter which site caused the request.

`Content-Type: application/json` is **not** protection by itself. A cross-origin `fetch` with `credentials: "include"` and `Content-Type: text/plain` is a simple request: no preflight, cookie attached, and today's `handleAppHttp` parses the body without ever looking at the content type.

Three layers, all required, all at the `/api` boundary:

1. **`SameSite=Lax` on the session cookie**, set explicitly. Browser defaults vary; do not rely on them. Our API is POST-only, so the top-level-GET exemption in `Lax` never applies to us.
2. **Reject any `/api` request whose `Content-Type` is not `application/json`.**
3. **Reject any `/api` request whose `Origin` header is not this origin.** Absent `Origin` on a POST is also a reject.

Do **not** add CORS `Access-Control-Allow-Credentials` to `/api`. The SPA and the API are same-origin by design; making the API callable from other origins would undo all three layers at once.

A double-submit CSRF token is unnecessary while everything is one origin. If a second origin ever needs the API, that is the moment to add one — not before.

---

## 8. Passwords (normative)

Owned by the identity service (§6). Argon2id would be the first choice, but it needs a native dependency and this repo deliberately has **zero** runtime dependencies. Node's built-in `crypto.scrypt` is the agreed choice; it keeps that property and is OWASP's named fallback.

| Rule | Value |
|------|-------|
| Algorithm | `crypto.scrypt` from `node:crypto` |
| Parameters | `N = 2^17`, `r = 8`, `p = 1` (OWASP floor as of 2026; ~128 MiB and roughly a quarter second per hash) |
| `maxmem` | Must be raised past the 32 MiB default, or the call throws — 128·N·r is 128 MiB, so set 256 MiB |
| Salt | 16 random bytes per user, stored alongside |
| Stored record | Algorithm name, parameters, salt, hash — so parameters can be raised later and old records rehashed on next successful sign-in |
| Comparison | `crypto.timingSafeEqual`, never `===` |
| Email | Lowercased and trimmed on write, unique index |
| Failure reason | One `invalid-credentials` outcome for both "no such email" and "wrong password" |
| Concurrency | Cap simultaneous hashes (a small queue) |

The concurrency cap is not optional bookkeeping: at 128 MiB and ~250 ms each, a few dozen simultaneous sign-in attempts are a memory and CPU exhaustion attack on their own. Rate limiting proper is deferred (§13), but the cap ships with the hashing because the hashing is what creates the exposure.

**Registration is open by default.** Owner decision, August 2026: this product is not advertised, so anyone who finds it may register. There is no invite code. `allowRegistration` on the host (default `true`) can close it later without a schema change; closed registration returns `registration-closed`. Rate limiting and email verification remain deferred (§13).

### Approved delta to a locked behavior: secret input mode

Owner-approved, August 2026. `Display.showInput` currently renders one visible `<textarea>` with `autocomplete="off"`. For password entry that means the password is on screen in cleartext, and password managers — a real accessibility win for this audience — are actively blocked from filling it.

The change is a `secret` flag on the input node that makes Display render `type="password"` and set honest `autocomplete` tokens (`username`, `current-password`, `new-password`). Notes for whoever implements it:

- A boolean flag on the existing input kind, **not** a new `NodeKind`. A new kind would collide with the unresolved "what does core do with an unrecognized node kind" question in [`DESIGN-REVIEW.md`](DESIGN-REVIEW.md) §11.
- This edits the Display contract in [`ARCHITECTURE.md`](ARCHITECTURE.md) and the input rows in [`../AGENTS.md`](../AGENTS.md). Update both in the same change; do not let the code diverge from the lock quietly.
- Input **leave** does not change: Done → `enter`, Cancel → `back`, no Escape exit.

---

## 9. Where the verified user id enters an app

Today `server/host.ts` calls `app.open(path, toRefreshExtras(extras))`, and `RefreshExtras` is filled in by the **client**. There is no channel for "the server knows who this is," so this decision must be made before any user-owned data exists.

**Agreed:** the host passes the verified user as a third, server-only context argument — `open(path, extras, ctx)` / `refresh(stack, extras, ctx)` — where `ctx` carries at least `userId: string | null`, and later the lockbox handle. `ctx` never crosses to the browser.

| Rule | Note |
|------|------|
| `ctx.userId` comes from the identity service resolving the session cookie | **Never** from `extras`, the path, the stack, or any other client-supplied field |
| `ctx` is optional in the type | In-process unit tests pass nothing; apps that do not care never look |
| Signed out is `userId: null`, not a missing app | The request still reaches the app. What that means is the app's decision — §10 |
| `ctx.sessionId` is always present, signed in or not | This browser, not this account. Server-side only — never in a node id, label, or URL. See §11.2 |
| `ctx.accountAppId` | Host config, so no app hardcodes a peer app's id when it offers a "sign in" edge |
| `ctx.identity` | Only for apps the host allows (§6). Everything else never sees it |

`ctx` may carry host **capabilities** (methods), not only data — see §11.3. That does not weaken the app boundary: the plain-data rule in [`ARCHITECTURE.md`](ARCHITECTURE.md) governs *payloads* (`stack`, `RefreshResult`, `NodePayload`, `NavigationMap`), and `PlatformContext` already establishes that capabilities are method-bearing.

### The stack is attacker-controlled input

`refresh(appId, stack, extras)` takes the whole stack **from the browser**, and node ids are exactly where an app naturally puts record ids (`note:123`). The browser sends that stack again on every single refresh, so anyone can edit it and ask for a node that belongs to someone else. If the app resolves `note:123` by fetching note 123 and returning its text as the tip label, one user reads another user's notes.

Therefore, normative for every user-scoped app:

- Resolve node ids from the stack **with the owner in the query** (`WHERE id = ? AND owner_id = ?`), never by id alone.
- Do this on **every** call, not only on `open`. There is no "already checked" state; each request arrives with a fresh, untrusted stack.
- The same applies to writes. `action: true` on a node id you did not authorize is how one user deletes another user's record.
- A node the user does not own is "not found," not "forbidden" — do not confirm that the record exists.

This discipline is also the backstop for §10: with the owner in every query, a signed-out user (`userId` null) matches no rows and sees nothing, even if the app forgot to write a friendlier signed-out screen.

---

## 10. Signed out, expired sessions, and sign-out

### Signed out is the app's decision, not a core redirect

**Owner decision, August 2026.** Being signed out means something different in every app, so no single shell-level rule fits:

| App | Signed out means |
|-----|------------------|
| Bible | Almost nothing. Reading works. Bookmarks and last-place are missing |
| Notes | Nothing to list. An explanation and a way to sign in |
| Mail | Nothing works at all. An explanation and a way to sign in |
| Home | A default catalog rather than that user's catalog |

So the host does **not** gate apps by sign-in state, and core learns **nothing** about authentication. Every request reaches the app with `ctx.userId` set to `null`, and the app answers with an ordinary `RefreshResult` — a real text node the user can hear, with edges to somewhere useful.

The app RPC therefore does not use `401` at all. The host resolves an absent or expired cookie to `userId: null` and calls the app normally. Do not add a 401 branch to the client.

**Rejected alternatives**, recorded so they are not revisited: a `401` plus an `accountAppId` in `ShellConfig` (core would learn what authentication is), and a `401` carrying a redirect location (smaller, but still one shell-wide policy for apps whose needs differ, and it buys nothing an ordinary node does not).

**The signed-out node.** Text explaining the situation, `enter` → `app` edge to `ctx.accountAppId`, `back` → `app` edge to the root app. This is boilerplate every user-scoped app repeats, so it belongs in **app-kit** as a helper (`signedOut({ accountAppId, rootAppId, text })` returning a complete `RefreshResult`) — optional, imported by apps, never called by Navigator.

An app may also carry a return address in the account app's path (`{ appId: "account", path: "/sign-in/from/mail" }`) so that finishing sign-in can offer a way back. That is app-owned path shape, and it is not a teleport: the user navigates each step deliberately.

**Expired mid-session** needs no separate mechanism. The next refresh simply arrives with `userId: null` and a stack of nodes the app can no longer authorize; the app returns the signed-out node as the tip. That is the existing "repair, not teleport" rule (`AppModule` MUST #8), not a new one.

**What is still silent:** the transport failing — network down, host restarting. Navigator keeps the last good display and says nothing. That is the deferred status channel (§13), and after this decision it is the *only* remaining silent case, which is a good place to be.

### Sign-out must clear the client

The warm cache, the per-app stack, and the navigation map are all **user data sitting in the browser tab**. Signing out without clearing them leaves the previous user's text on screen and in memory.

The mechanism already exists and needs no new core concept: an `app` edge triggers `Navigator.openLocation`, which clears stack, cache, and map before applying the new result. So sign-out is an ordinary `action: true` edge that lands on an `app` edge back to Home. Write it that way. Do **not** implement sign-out as a bare fetch that leaves the user standing on cached private text.

### Home is an ordinary app

`AppRegistry.listEnabled()` returns `[{ id, label }]` for every registered app — plain descriptors, never the registry object — and Home is handed it as an injected callback to build its menu.

Home is **not special here**. Like every app it receives `ctx.userId`: `null` when nobody is signed in, a user when somebody is. Like every app it owns its own data, so which apps a given user sees, in what order, enabled or hidden, is Home's table and Home's decision. Signed out yields a sensible default catalog.

The only core-side consequence is plumbing: the catalog callback currently takes no arguments and the host builds Home **once at startup**, so it must become per-request (or take the user) once `ctx` exists. Nothing about this belongs in core, and there is no host-level "requires a signed-in user" flag — that was an earlier idea, dropped with the decision above.

Not needed for the first slice. Signed-out Home listing Bible, Account, and Help is enough to ship. The host does not rewrite any app's catalog label.

---

## 11. Session lifecycle and the sign-in flow

### 11.1 When a session is created — decided

**Owner decision, August 2026.** A session exists for **every visitor**, not only signed-in ones. The **host HTTP layer** asks the identity service to resolve the request on the first `/api` call, and the service creates an anonymous session when the cookie is absent or dead. The host does not ask the Account app, which would make the whole site depend on one product app existing.

First `/api` call rather than first page load, because the two are the same moment for a real visitor — `src/shell/bootstrap.ts` calls `navigator.openLocation` as soon as it mounts, which is an `/api` POST — while the HTML document is a static asset that may be cached or CDN-served, and every crawler and health check fetching it would otherwise mint a row. Keeping `Set-Cookie` inside `/api`, which is already POST-only, origin-checked, and `no-store`, avoids both problems. Abandoned rows still need a periodic sweep.

**No client code is involved.** The host sends a `Set-Cookie` header; the browser stores it and re-attaches it to every later same-origin request on its own. That is what `HttpOnly` buys — page JavaScript cannot read or write it, and does not need to. `createFetchRpc` already posts to relative same-origin URLs, and `fetch` defaults to `credentials: "same-origin"`, so cookies ride along with no change to core, the RPC stub, or the shell.

### 11.2 An anonymous **session**, not an anonymous user — decided

The tempting shortcut is to mint an anonymous *user id* and let it flow through `ctx.userId` like any other. It reads well — one query shape, no null branch, and data created before sign-up is already owned — but it inverts the failure mode:

| Problem | Consequence |
|---------|-------------|
| `userId: null` is exactly what makes signed-out provably safe (§9) | Give everyone an id and "is this a real account?" is no longer expressible in the type. An app that forgets the check now **grants** access instead of denying it |
| Anonymous ids are minted on request, without limit | Clear cookies, get another one. Per-user quotas and storage limits stop meaning anything |
| An anonymous visitor with data who then signs into an existing account | Two ids holding data, so every such app needs a merge with conflict rules — the hardest problem handed to the app least able to afford it |
| `users` rows with no email and no hash | "User" stops meaning "account" for every query, index, and admin view from then on |

**Decided shape — two ids with different jobs:**

| | Always present | Means |
|---|---|---|
| `ctx.sessionId` | Yes | This browser, right now. Where flow state, rate-limit counters, and any pre-sign-in app data hang |
| `ctx.userId` | No — `null` until sign-in | A real account |

An app that wants to be useful before sign-up scopes to `sessionId` and migrates deliberately at sign-in, owning its own merge rule. An app that needs an account checks `userId` and falls back to §10. `sessionId` is server-side only: it must never appear in a node id, a label, or a URL.

Email and password hash belong to the identity service (§6), not to an app's schema — the host must resolve cookie → user on every request without reaching into app tables. What the Account app may keep against `sessionId` is *in-progress* flow state, such as the email typed on the previous screen, which is the problem anonymous sessions were needed to solve: it cannot live in a node label (visible, spoken, cached, and in the stack), a node id (client-controlled, ends up in the URL), or `NodePayload.data` (warm payloads do not round-trip; stack entries carry only `nodeId`, `label`, `location`).

At sign-in, attach the `userId` and **rotate the token** (§7). Keeping the same session row across that upgrade is what makes migrating `sessionId`-scoped data trivial; the fixation rule governs the token the browser holds, not the row behind it.

Note the privacy consequence to decide alongside this: every visitor now receives a cookie.

### 11.3 How sign-in establishes the session — decided

**Owner decision, August 2026.** The Account app receives `ctx.identity`, the capability from §6. `await ctx.identity.signIn(email, password)` returns an `AuthOutcome`, the app renders it, and the HTTP layer sets the cookie on that response because the outcome carried a new token.

Why a capability rather than a declarative field like `clipboardText`: the app must **render the outcome** — "signed in" or "that password did not match" — in the same response, and a declarative field is only read *after* the app has already answered. The app needs the result before it can build its node.

**How the HTTP layer learns a token was issued.** The host constructs `ctx.identity` **per request**, bound to that request's `sessionId` and to a pending-cookie slot the HTTP layer owns. Whenever the service issues or clears a token — anonymous creation, sign-in rotation, sign-out — it records that in the slot. After the app returns, successfully or not, the HTTP layer reads the slot and emits at most one `Set-Cookie`. Building the capability per request also means an app cannot stash it for later and cannot act for a different session.

- This does not break the app boundary. The plain-data rule governs payloads; `PlatformContext` already sanctions method-bearing capabilities (`clipboard.writeText`). Because the call is already async, a future worker or sandbox host turns it into a message round-trip with no contract change.
- The app never sees a password hash, never writes the `sessions` table, and never names a `userId` it was not handed. Credentials in, structured outcome out.
- **Only apps the host allows receive `ctx.identity`** (today: the Account app). A third-party app must never be able to mint a session — this is the one capability that would be catastrophic to hand out by default.
- Sign-out is the same capability, and it is what performs the row deletion §7 requires.

### 11.4 The sign-in flow on screen — landed

**Owner decision, August 2026.** Sign-in reuses the action-edge status pattern exactly as Copy does. Combined register / sign-in (one option, not two):

```text
"Sign in or register"
    --enter-->  "Please enter your email."
                    --enter-->  email input (autocomplete=username)
                                    --enter (action, passInputText)-->  "Please enter your password."
                                                                          --enter-->  password input (secret)
                                                                                          --enter (action, passInputText)-->  "Signing in…"
                                                                                                                                │
                                                                                                                                └── success → "You are signed in as …"  (enter/back → Home)
                                                                                                                                └── failure → "Sign-in was unsuccessful."  (enter/back → pop to the password input)
```

Typed email is stored against `ctx.sessionId` in Account's `account_flow` table (never in a node id, label, or URL). Authenticate tries `register`, then `signIn` on `email-taken`. Failed auth, including a password that is too short to register, is one unsuccessful message — the Account app does not teach password rules on this screen. Failure `pop`s so the stack still has a single password input.

Signed-in Account at `/`:

```text
Settings (dead-end placeholder)  --next-->  Sign out  --enter (action)-->  "Signing out…"
                                                                              └── "You are signed out."  (enter/back → Home)
```

Status nodes return `location: null`. Sign-out is an action to a status node whose enter/back are `app` edges to Home, which clears the client cache.

The password arrives in `extras.inputText` on that action call. The host never logs `/api` request bodies.

---

## 12. SQLite (normative)

| Choice | Value |
|--------|-------|
| Driver | Built-in `node:sqlite`. Unflagged since Node 22.13 and CI already pins Node 22, so this keeps the zero-runtime-dependency property |
| Caveat | Still marked experimental in Node 22. Keep driver wrapping in [`server/sqlite.ts`](../server/sqlite.ts) so swapping to `better-sqlite3` is one library file, and pin the Node major in CI and in production |
| Journal mode | WAL |
| Pragmas | `foreign_keys = ON`, a `busy_timeout` |
| Schema changes | A numbered migration runner per database — a `migrations` table plus ordered files, applied in a transaction when *that* file is opened. Not scattered `CREATE TABLE IF NOT EXISTS` |
| Backups | Required before real user data. "A file on one machine with a disk" is also a file you can lose |
| Ownership | `users` and `sessions` belong to the **identity service** (§6) on the **host** file. Other app tables belong to that app's own database. Core never sees a database — no core `NotesRepository`, same rule as always. There is no `ctx.db`. See [`STORAGE.md`](STORAGE.md) |

---

## 13. Deferred on purpose

Recorded so these are decisions rather than oversights. None of them change the architecture; all are additive.

| Deferred | Why it is safe for now | What makes it urgent |
|----------|------------------------|----------------------|
| **Rate limiting / brute-force protection** on sign-in | Registration is open but the product is unadvertised; the §8 concurrency cap covers the memory-exhaustion half | Public discovery or abuse. Per-account throttling belongs to the identity service, per-IP to the HTTP layer. **CAPTCHA is not an option for this audience** |
| **Request body size limit** on `/api` | **Landed** — 1 MiB in `server/readBody.ts` | — |
| **`Cache-Control: no-store` on `/api` responses** | **Landed** on the session HTTP pipeline | — |
| **Status channel** (busy vs dead-end vs failure) | Already a known gap in [`PREPAREDNESS.md`](PREPAREDNESS.md) | After §10, transport failure is the only silent case left — but it is still silent, and sign-in is when people notice |
| **Password reset** | No reset flow means "contact the owner" for a small user base | It needs an email sender, which is a new dependency and a new cost. Budget it before sign-up is public |
| **Email verification** | Same dependency as reset | Public sign-up, or anything that mails the user |
| **Account deletion and data export** | No user data exists yet | Real users in a real jurisdiction |
| **Server-held stacks** | Explored and set aside; see [`DESIGN-REVIEW.md`](DESIGN-REVIEW.md) §13 | Untrusted third-party apps, or cross-device continuity |

---

## 14. History: the first server slice (Bible)

Landed. Kept for context.

- Generic client stub: `open` / `refresh` POST to `/api/apps/:appId/…` with plain JSON (stack, path, `inputText`, `action`). Abort cancels the fetch.
- Apps return `clipboardText` when Copy should happen. Core writes the device clipboard. No fake clipboard on the server.
- Client registers only generic remote stubs (`home`, `bible`). Notes is not in the running catalog.
- Browser bootstrap does not bundle `kjv.json`. The Bible app loads and seeds it. The same Bible and Home modules are unit-tested in-process (that is not a second product path).
