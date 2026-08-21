# Nowisee — identity, apps on the server, and secrets

**Status:** Agreed direction (owner, August 2026). **Bible on the server has landed** (Home + Bible via `/api`; Notes unplugged). Login, SQLite, the secret lockbox, and the Account app are **not** implemented. iPhone is in [`PREPAREDNESS.md`](PREPAREDNESS.md), not this file. Product locks: [`SPEC.md`](SPEC.md).

---

## 1. Where code runs

**The shell stays on the device.** That is keys, swipes, the one text surface, the navigation map, and the warm cache. Pressing Down can still show the next screen immediately from cache, then the real app answers in the background. That is what the cache was for: delay between the device and the **app**, once the app is not inside the web page.

**Apps run on the server.** “Open this path” and “the user just did this” are answered by server code. The browser does not run Bible (or later Gmail) logic and does not call Google. Secrets never sit in the page.

This is not “every keypress waits on the network.” A cache hit is local. A cache miss, a first open, or a background revalidation is a server call. Copy-to-clipboard still happens on the device; the app returns `clipboardText` and core writes it.

**Landed:** Home and Bible run on the server. Notes is **not registered** (code can stay in the repo; the running app does not load it). Still not built: login, SQLite, secret lockbox.

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

The **Account app** is still a normal Nowisee app (sign-in screens). It talks to the identity service. It does not retrieve “the Nowisee password” from the secret lockbox.

---

## 3. App secrets (when we build them — not in the Bible slice)

A **platform** service (same idea as clipboard: the shell/platform provides it; Navigator does not become a password manager).

- An app says: “save this blob under slot `personal`” / “give me slot `personal`.”
- The service keys it by **this user + this app id + this slot**. One app may have many slots (two Gmail accounts). Our Gmail app and a third-party Gmail app have **different app ids** and cannot read each other’s slots.
- Only that app’s **server** code can read the blob. The browser never receives it.

Refresh tokens **are** meant to be stored — on the **server**, encrypted, never in the page. OAuth 2 warns against keeping them in browser JavaScript, not against a backend remembering them so the user is not sent through Google every hour. Details in the discussion that agreed this file.

Encryption at rest (plain picture): the database stores scrambled bytes. A **master key** lives on the server (environment / host secret manager), **not** in the git repo and **not** in the database file. The service uses that key to scramble on save and unscramble in memory when the app asks. Steal the database file without the key → useless. Steal the key **and** the database → they can read tokens; that is why the key is a host secret. Bible does not need this yet.

---

## 4. Data and hosting

- **Bible slice:** no login, no SQLite. KJV stays a JSON file next to the server.
- **Later (accounts, Notes):** one database, many tables (users/sessions vs notes vs later mail). SQLite as a file on **one** machine with a disk is enough for a long time. Many serverless copies of the app sharing one SQLite *file* is a bad fit; then use the host’s SQLite product (e.g. Cloudflare D1) or Postgres.
- Public internet needs a host that runs Node (or equivalent) and serves **both** the website and `/api` on the **same site** (needed later for login cookies; also simplest now). A static-only host cannot run the app API.

---

## 5. First code slice (Bible on the server)

See the plan in the discussion that agreed this file. Short form:

- Generic client stub: `open` / `refresh` POST to `/api/apps/:appId/…` with plain JSON (stack, path, `inputText`, `action`). Abort cancels the fetch.
- Apps return `clipboardText` when Copy should happen. Core writes the device clipboard. No fake clipboard on the server.
- Client registers only generic remote stubs (`home`, `bible`). Notes is not in the running catalog.
- Browser bootstrap does not bundle `kjv.json`. The same Bible and Home modules are unit-tested in-process (that is not a second product path).
