# Nowisee — data storage

**Status:** App-owned databases landed in August 2026. Identity stays on the host. The secret lockbox and generic OAuth broker also **landed** that month. Product locks: [`SPEC.md`](SPEC.md). Identity: [`IDENTITY.md`](IDENTITY.md).

Core never sees a database. There is no `ctx.db`, and there is no client `platform.storage`.

## Four kinds of durable data

| Kind | Example | Lives in | Owner | Scoped by |
|------|---------|----------|-------|-----------|
| **Identity** | email, password hash, sessions | Host SQLite (`NOWISEE_DB` / `data/nowisee.db`) | Identity service | Cookie → `ctx.userId` |
| **Secrets** | OAuth tokens | Host lockbox table + host master key | Host lockbox capability | `(userId, appId, slot)` |
| **App data** | verses, account flow, notes | That app's own SQLite file | That app | `ctx.userId` when it is user data; unscoped when it is a public corpus |
| **Large user files** | attachments (later) | Files next to that app's data, not the host db | That app (HTTP upload may pass through the host) | Owner on the metadata row |

This layer does not include the client warm cache (tab-lifetime) or anything in a `RefreshResult` (plain JSON the user is meant to hear).

## Who opens which file

The host opens **only** the host database ([`server/db/`](../server/db/)) — identity, lockbox, and OAuth state. It registers apps; it does not pass them a `Db` or a corpus.

Each app opens **its** file. [`server/sqlite.ts`](../server/sqlite.ts) is a library (`openSqlite`) that turns on WAL, foreign keys, a busy timeout, and numbered migrations for *that* path. Third-party apps do not have to use it.

| Database | Default path | Migrations / detail |
|----------|----------------|---------------------|
| Host (identity, lockbox, OAuth state) | `data/nowisee.db` | [`001_host.sql`](../server/db/migrations/001_host.sql) |
| Account | `data/apps/account.db` | [`src/apps/account/db/migrations/`](../src/apps/account/db/migrations/). Graph: [`src/apps/account/README.md`](../src/apps/account/README.md) |
| Bible | `data/apps/bible.db` | [`src/apps/bible/db/migrations/`](../src/apps/bible/db/migrations/). Corpus and graph: [`src/apps/bible/README.md`](../src/apps/bible/README.md); files: [`src/apps/bible/data/SOURCES.md`](../src/apps/bible/data/SOURCES.md). The host does not import corpus files or pass a seed. |
| Notes | `data/apps/notes.db` | [`src/apps/notes/db/migrations/`](../src/apps/notes/db/migrations/). Graph: [`src/apps/notes/README.md`](../src/apps/notes/README.md) |
| Gmail | `data/apps/gmail.db` | [`src/apps/gmail/db/migrations/`](../src/apps/gmail/db/migrations/). Tokens via `ctx.oauth` only. Graph: [`src/apps/gmail/README.md`](../src/apps/gmail/README.md) |

Tests pass `:memory:` for each file that the test needs. `createNowiseeHost({ db: ":memory:" })` (the default) also gives Account, Bible, Notes, and Gmail memory files so tests do not write `data/`.

`ctx` carries `userId`, `sessionId`, `accountAppId`, and granted capabilities (`identity`, `lockbox`, `oauth`, `directory`). It never carries a database.

Schema, import, and graph live next to each app. The client bundle must not contain app corpora.

## App-owned schemas

Apps own their columns, indexes, and when they read or write. Migrations are numbered files next to that app. In development, squash into one current schema rather than stacking files whose only job is preserving old rows. After a squash, delete the local `data/` files.

For user data, put the **owner in the query every time** — [`IDENTITY.md`](IDENTITY.md) §9. `ctx.userId` comes from the cookie only. A missing or other-user row is “not found.”

Do not put passwords (identity), OAuth tokens (lockbox), or huge binaries (files) in an app database. Do not invent a host-wide key-value store. Each app owns its store interface, and the host does not inject stores.

## Secrets lockbox — landed

See [`IDENTITY.md`](IDENTITY.md) §3. The host database holds `lockbox` and `oauth_states`. The host master key is `NOWISEE_LOCKBOX_KEY`. `ctx.lockbox` and `ctx.oauth` go to allowed apps only. This is not a place for note bodies or files. OAuth client id and secret stay in host env, not in the lockbox.

## Attachments (path only)

Bytes do not travel through `open` / `refresh` (JSON, 1 MiB cap). When attach exists, the HTTP layer may accept an upload (cookie plus CSRF), and the **app** stores the file next to its own data. No new `NodeKind` is needed in this slice.

## Transfer

1. An app talks to its own store.
2. A host engine swap is [`server/db/index.ts`](../server/db/index.ts) for the host file (identity, lockbox, OAuth state).
3. Account export and deletion are still deferred ([`IDENTITY.md`](IDENTITY.md) §13).
4. There is no app-to-app `SELECT`.

## Anti-patterns

- `ctx.db`, or the host constructing an app store from the host `Db`
- One `nowisee.db` that holds every app's tables
- Client `platform.storage` for durable app data
- Putting an app corpus in the host process as host-owned data
- Resolving user records by id without `owner_id` in the query
