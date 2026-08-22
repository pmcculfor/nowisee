# Nowisee — engineering notes

Implementation choices. Product locks: [`SPEC.md`](SPEC.md). Contracts: [`ARCHITECTURE.md`](ARCHITECTURE.md). Modules: [`MODULES.md`](MODULES.md). Identity (landed): [`IDENTITY.md`](IDENTITY.md). Preparedness: [`PREPAREDNESS.md`](PREPAREDNESS.md).

## Current stack

| Choice | Decision | Why |
|--------|----------|-----|
| Client | **Vanilla TypeScript + Vite** | One text/input surface; no UI framework |
| App host | **TypeScript on Node**, small `/api` router (no Express) | Same language and `RefreshResult` types as the apps |
| Where apps run | Home + Bible + Account `open`/`refresh` on the server | Proof of the intended split; KJV stays off the client bundle |
| Client apps | Generic `createRemoteApp` stubs | Not a second Bible |
| Notes | Source remains; **not registered** | Avoid a local-app leftover next to remote apps |
| Database | SQLite via `node:sqlite` (`server/db/`) | Identity + Account flow. File `data/nowisee.db` in dev/start; `:memory:` in tests |
| URL style | Hash routes behind `AppLocation` | Unchanged |
| Copy | `clipboardText` on the result; Navigator writes | Apps must not think they own the clipboard |
| Identity | Host-layer service + Account app | See [`IDENTITY.md`](IDENTITY.md) |

## Layout

```text
src/core/       shell (navigator, display, …)
src/apps/       home, bible, account modules (imported by the server host)
src/apps/remote.ts  client RPC stub
src/shell/      registers remote Home + Bible + Account
server/         HTTP, SQLite, identity service, createNowiseeHost
server/index.ts production entry (SPA + /api)
```

## Dev

`npm run dev` — Vite plus `/api` middleware (same origin, SQLite, sessions).

`npm run preview` — same API plugin on the preview server.

`npm run build && npm start` — `server/index.ts` serves `dist/` and `/api` together. Vite `base` is `/`.
