# Nowisee — data storage

**Status:** App-owned databases landed (August 2026). Identity stays on the host. The secret lockbox and generic OAuth broker **landed** (August 2026). Product locks: [`SPEC.md`](SPEC.md). Identity: [`IDENTITY.md`](IDENTITY.md).

Core never sees a database. There is no `ctx.db`. There is no client `platform.storage`.

## Four kinds of durable data

| Kind | Example | Lives in | Owner | Scoped by |
|------|---------|----------|-------|-----------|
| **Identity** | email, password hash, sessions | Host SQLite (`NOWISEE_DB` / `data/nowisee.db`) | Identity service | Cookie → `ctx.userId` |
| **Secrets** | OAuth tokens | Host lockbox table + host master key | Host lockbox capability | `(userId, appId, slot)` |
| **App data** | verses, account flow, notes | That app's own SQLite file | That app | `ctx.userId` when it is user data; unscoped when it is a public corpus |
| **Large user files** | attachments (later) | Files next to that app's data, not the host db | That app (HTTP upload may pass through the host) | Owner on the metadata row |

Not this layer: the client warm cache (tab-lifetime) and anything in a `RefreshResult` (plain JSON the user is meant to hear).

## Who opens which file

The host opens **only** the host database ([`server/db/`](../server/db/)) — identity, lockbox, and OAuth state. It registers apps; it does not pass them a `Db` or a corpus.

Each app opens **its** file. [`server/sqlite.ts`](../server/sqlite.ts) is a library (`openSqlite`) — WAL, foreign keys, busy timeout, numbered migrations for *that* path. Third-party apps do not have to use it.

| Database | Default path | Migrations |
|----------|----------------|------------|
| Host (identity, lockbox, OAuth state) | `data/nowisee.db` | [`001_identity.sql`](../server/db/migrations/001_identity.sql), [`002_lockbox.sql`](../server/db/migrations/002_lockbox.sql) |
| Account | `data/apps/account.db` | [`src/apps/account/db/migrations/`](../src/apps/account/db/migrations/) |
| Bible | `data/apps/bible.db` | [`src/apps/bible/db/migrations/`](../src/apps/bible/db/migrations/) |
| Notes | `data/apps/notes.db` | [`src/apps/notes/db/migrations/`](../src/apps/notes/db/migrations/) |
| Gmail | `data/apps/gmail.db` | [`src/apps/gmail/db/migrations/`](../src/apps/gmail/db/migrations/) |

Tests pass `:memory:` for each file that the test needs. `createNowiseeHost({ db: ":memory:" })` (the default) also gives Account, Bible, Notes, and Gmail memory files so tests do not write `data/`.

`ctx` carries `userId`, `sessionId`, `accountAppId`, and granted capabilities (`identity`, `lockbox`, `oauth`, `directory`). Never a database.

## App-owned schemas

Apps own columns, indexes, and when they read or write. Migrations are numbered files next to that app; never edit an applied file.

**Owner in the query, every time** for user data — [`IDENTITY.md`](IDENTITY.md) §9. `ctx.userId` from the cookie only. Missing or other-user → "not found."

**Do not put in an app database:** passwords (identity), OAuth tokens (lockbox), huge binaries (files).

**Do not invent a host-wide KV.** `NotesStore` stays Notes' own interface; the host does not inject it.

## Bible

Bible talks to a [`BibleStore`](../src/apps/bible/store.ts), not to JSON arrays in the view. Production opens `data/apps/bible.db` and runs [`ensureCatalog`](../src/apps/bible/import.ts) against the committed import files under [`src/apps/bible/data/raw/`](../src/apps/bible/data/raw/) (VPL texts, HelloAO JSON, TSK table). Tests pass a tiny seed into `startBibleApp` and never load those files. The host does not import corpus files or pass a seed. The client bundle still must not contain them.

Lookup is **version + canon book id + chapter + verse**. Reading URLs still include version (`/asv/Matthew/5/8`). Bookmark keys are canon refs without version. Later translations are more `VersionRecord`s plus rows, not new code paths.

Do not seed from e-Sword `.bblx`/`.cmtx` (removed; encrypted). Do not extend `prepare-kjv.mjs` brace-stripping. Corpus import: verse-aligned public-domain files listed in [`src/apps/bible/data/SOURCES.md`](../src/apps/bible/data/SOURCES.md). See [`ENGINEERING.md`](ENGINEERING.md) and [`BIBLE-PLAN.md`](BIBLE-PLAN.md).

Tables:

- `canon_books`, `books` (per version), `verses`, `verse_words`
- `reader_prefs` — signed-in active version; no session owner
- `reader_recency` — recently used versions and commentaries; owner is the signed-in user or the session
- `bookmarks` — **user id only** (not session). Signed-out → sign-in node, no row
- `commentaries` / range-keyed `commentary_sections` + `commentary_coverage` + `commentary_xrefs`
- `search_queries` (session-scoped query text; hits are re-run)

## Notes

Notes talks to a [`NotesStore`](../src/apps/notes/store.ts). Production opens `data/apps/notes.db`. [`startNotesApp`](../src/apps/notes/store.ts) opens the file (Node-only). The graph module does not import SQLite. The host does not inject the store.

Every method takes `ownerId` — `ctx.userId` from the cookie, never `sessionId`. `userId` null → a sign-in node; no row is written. List order is `updated_at` descending (most recently edited first). List tips are the first line of the body.

## Gmail

Gmail talks to a [`GmailStore`](../src/apps/gmail/store.ts) (inbox metadata cache + compose drafts) and Gmail REST via [`gmailClient.ts`](../src/apps/gmail/gmailClient.ts). Production opens `data/apps/gmail.db`. Tokens never go in that file — `ctx.oauth` only. [`startGmailApp`](../src/apps/gmail/store.ts) opens the file (Node-only). The graph module does not import SQLite.

Every store method takes `ownerId`. Message ids on the stack are untrusted; fetches always use this user's access token → `users/me`.

## Secrets lockbox — landed

[`IDENTITY.md`](IDENTITY.md) §3. Host database (`lockbox` + `oauth_states`), host master key (`NOWISEE_LOCKBOX_KEY`), `ctx.lockbox` / `ctx.oauth` for allowed apps only. Not a place for note bodies or files. OAuth client id/secret stay in host env, not in the lockbox.

## Attachments (path only)

Bytes do not travel through `open` / `refresh` (JSON, 1 MiB cap). When attach exists: the HTTP layer may accept an upload (cookie + CSRF); the **app** stores the file next to its own data. No new `NodeKind` in this slice.

## Transfer

1. App ↔ its store (BibleStore, AccountFlowStore, NotesStore, GmailStore).
2. Host engine swap: [`server/db/index.ts`](../server/db/index.ts) for the host file (identity, lockbox, OAuth state).
3. Account export / deletion: still deferred ([`IDENTITY.md`](IDENTITY.md) §13).
4. No app-to-app `SELECT`.

## Anti-patterns

- `ctx.db` or the host constructing an app store from the host `Db`
- One `nowisee.db` with every app's tables
- Client `platform.storage` for durable app data
- Putting KJV in the host process as a host-owned corpus
- Resolving user records by id without `owner_id` in the query
