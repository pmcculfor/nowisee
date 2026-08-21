# Nowisee — engineering notes

Implementation choices. Product locks: [`SPEC.md`](SPEC.md). Contracts: [`ARCHITECTURE.md`](ARCHITECTURE.md). Modules: [`MODULES.md`](MODULES.md). Identity (agreed, not fully built): [`IDENTITY.md`](IDENTITY.md). Preparedness: [`PREPAREDNESS.md`](PREPAREDNESS.md).

## Current stack

| Choice | Decision | Why |
|--------|----------|-----|
| Client | **Vanilla TypeScript + Vite** | One text/input surface; no UI framework |
| App host | **TypeScript on Node**, small `/api` router (no Express) | Same language and `RefreshResult` types as the apps |
| Where apps run | Home + Bible `open`/`refresh` on the server | Proof of the intended split; KJV stays off the client bundle |
| Client apps | Generic `createRemoteApp` stubs | Not a second Bible |
| Notes | Source remains; **not registered** | Avoid a local-app leftover next to remote apps |
| Database | None in this slice | Bible is a JSON file |
| URL style | Hash routes behind `AppLocation` | Unchanged |
| Copy | `clipboardText` on the result; Navigator writes | Apps must not think they own the clipboard |

## Layout

```text
src/core/       shell (navigator, display, …)
src/apps/       home + bible modules (imported by the server host)
src/apps/remote.ts  client RPC stub
src/shell/      registers remote Home + Bible
server/         HTTP + createAppHost
```

## Dev

`npm run dev` — Vite plus `/api` middleware (same origin).

`npm run preview` — same API plugin on the preview server.

Production needs a Node (or equivalent) host that serves the site and `/api` together. Vite `base` is `/`.
