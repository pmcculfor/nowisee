# Nowisee — engineering notes

Implementation choices. Product locks: [`SPEC.md`](SPEC.md). Contracts: [`ARCHITECTURE.md`](ARCHITECTURE.md). Modules: [`MODULES.md`](MODULES.md). Identity (landed): [`IDENTITY.md`](IDENTITY.md). Storage: [`STORAGE.md`](STORAGE.md). Preparedness: [`PREPAREDNESS.md`](PREPAREDNESS.md).

## Current stack

| Choice | Decision | Why |
|--------|----------|-----|
| Client | **Vanilla TypeScript + Vite** | One text/input surface; no UI framework |
| App host | **TypeScript on Node**, small `/api` router (no Express) | Same language and `RefreshResult` types as the apps |
| Where apps run | Home + Help + Bible + Notes + Gmail + Account `open`/`refresh` on the server | Proof of the intended split; KJV stays off the client bundle; Bible seeds its own SQLite |
| Client apps | Generic `createRemoteApp` stubs | Not a second Bible |
| Database | SQLite via `node:sqlite` (`server/sqlite.ts`) | Host identity in `data/nowisee.db`; Account, Bible, and Notes each open `data/apps/*.db`. `:memory:` in tests |
| URL style | Hash routes behind `AppLocation` | Unchanged |
| Copy | `clipboardText` on the result; Navigator writes | Apps must not think they own the clipboard |
| Identity | Host-layer service + Account app | See [`IDENTITY.md`](IDENTITY.md) |

## Layout

```text
src/core/       shell (navigator, display, …)
src/apps/       home, help, bible, notes, gmail, account modules (imported by the server host)
src/apps/remote.ts  client RPC stub
src/shell/      registers remote Home + Help + Bible + Notes + Gmail + Account
server/         HTTP, host identity SQLite, identity service, createNowiseeHost, first-party app pack list
server/sqlite.ts  shared openSqlite helper (apps import this; not ctx.db)
server/index.ts production entry (SPA + /api)
```

## Dev

`npm run dev` — Vite plus `/api` middleware (same origin, SQLite, sessions).

`npm run preview` — same API plugin on the preview server.

`npm run build && npm start` — `server/index.ts` serves `dist/` and `/api` together. Vite `base` is `/`.

## Environment

| Variable | Role |
|----------|------|
| `PORT` | Listen port (default `3000`) |
| `NOWISEE_DB` | Host SQLite file (default `data/nowisee.db`) |
| `NOWISEE_ORIGIN` | Public origin for CSRF and OAuth redirect URI |
| `NOWISEE_LOCKBOX_KEY` | 32-byte AES key, base64. Required if `lockboxAppIds` or `oauthAppIds` is non-empty |
| `NOWISEE_LOCKBOX_KEY_ID` | Optional key id (default `v1`) |
| `NOWISEE_OAUTH_<APP>_CLIENT_ID` / `_CLIENT_SECRET` | Per-app OAuth client credentials. Not lockbox. `<APP>` is the app id, uppercased, non-alphanumerics → `_` |
| `NOWISEE_TLS_CERT` / `NOWISEE_TLS_KEY` | Optional PEM paths; both set enables HTTPS |

Production `npm start` and Vite grant Gmail `lockboxAppIds` / `oauthAppIds`, so they **do** need `NOWISEE_LOCKBOX_KEY`, `NOWISEE_ORIGIN`, and `NOWISEE_OAUTH_GMAIL_CLIENT_ID` / `_CLIENT_SECRET`. Tests leave those grant lists empty. See [`IDENTITY.md`](IDENTITY.md) §3.

## How to extend (binding)

Follow [`../AGENTS.md`](../AGENTS.md) **Long-horizon design**. In practice:

- Add a peer (Bible version, commentary, root heading, verse action) as **data**: a catalog object and rows. Graph code walks the catalog. It does not name the peer.
- Prefer one verse renderer plus a **sequence object** (chapter siblings vs bookmark siblings vs search hits) over three copy-pasted graphs.
- Leave seams for obvious next features; do not implement them. Example: store commentary cross-references as rows and flatten them into the section label; do not make those refs navigable until that slice is scheduled.
- **Input accessible name vs value (deferred).** Today an input node's `label` is the field value, and Display's `aria-label` for a generic input is `"Input"`. A later, generic `NodePayload` field (e.g. `inputName`) could supply the accessible name without putting the prompt in the value. Do not add it until a slice needs it. Search can ship with the current `"Input"` name.

## Bible corpus files

e-Sword `.bblx` / `.cmtx` modules (removed; do not re-add) are SQLite with a useful *shape* (one Bible row per verse; commentary `VerseCommentary` has `ChapterBegin`/`VerseBegin`/`ChapterEnd`/`VerseEnd`). The `Scripture` / `Comments` columns are proprietary **SQLitePlus `BLOB_TEXT`**: ciphertext, length always a multiple of 16. There is no public decryptor; do not reverse-engineer the codec. Use that range shape as a schema hint only.

The current `scripts/prepare-kjv.mjs` path that strips `{...}` from a nested JSON dump **deletes words**. Do not extend that pipeline.

Import KJV, ASV, BBE, YLT, Matthew Henry, JFB, and TSK from **public-domain verse-aligned** sources (one record per verse or per commentary range). Catalog: [`src/apps/bible/data/SOURCES.md`](../src/apps/bible/data/SOURCES.md). Do not add translations or commentaries that are not on that list. Test fixtures stay tiny and hand-written.

**Import sources are committed** under `src/apps/bible/data/raw/` (VPL texts, HelloAO JSON, TSK table). Zips, USFM, and SWORD backups stay gitignored; re-fetch those with `node scripts/download-bible-sources.mjs`. Primary Bible text is eBible `_vpl.txt`. Primary Henry/JFB is HelloAO chapter JSON. Primary TSK is `tskxref.txt`. Plan: [`BIBLE-PLAN.md`](BIBLE-PLAN.md).
