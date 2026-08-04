# Nowisee — engineering notes

Proposed implementation choices for when the app is scaffolded. **No application code lives in the repo yet** — specs and module contracts only. Product locks: [`SPEC.md`](SPEC.md). Contracts: [`ARCHITECTURE.md`](ARCHITECTURE.md). Modules: [`MODULES.md`](MODULES.md).

## Proposed for MVP scaffolding (not implemented yet)

| Choice | Decision | Why |
|--------|----------|-----|
| Language | **TypeScript** | Robustness, typed `open` / `refresh` / navigation map |
| UI toolkit | **Vanilla TS + Vite** | One text/input surface; avoid framework DOM complexity |
| Topology | **Static SPA** | KJV + demo mail need no server; APIs can appear later behind apps |
| Hosting path | Static-compatible (Vite build → any static host) | Swap host without rewriting core |
| URL style | **Hash routes** (`#/…`) behind `AppLocation` | Works on static hosting without server rewrites; apps address `{ appId, path }` so a later move to History API paths touches Router only |
| Persistence | In-memory NodeCache only for MVP | IndexedDB later without changing warm ownership |
| Tests | Vitest for Navigator/Router/stack + app `open`/`refresh` units | Lock edge-case behavior from the spec |
| Shared helpers | `src/app-kit/` optional imports | DRY without core prefetch policy |

## Non-goals for first code slice

- Real Gmail / OAuth
- Server database / HTTP session cookies (none until a backend exists)
- Service worker / offline shell
- Dedicated Home key
- Third-party app loading at runtime (in-process registry is enough)
- Browser Back/Forward ↔ session stack sync beyond hashchange → open
- Notes app (design must allow it later; not MVP build)

## Proposed layout (when scaffolding)

```text
src/
  core/       # router, navigator, stack, navigationMap, nodeCache, display, keyboard, registry, types
  app-kit/    # optional helpers (edges, lists, input edges, neighborhood walk)
  apps/       # home, bible, mail (AppModules)
  shell/      # bootstrap wiring
  main.ts
index.html
public/data/  # static assets (e.g. KJV JSON)
```

## Performance expectation

An intent on a node already answerable from the navigation map + warm cache updates the single text surface immediately, then `refresh` revalidates in the background. Warm miss or open/bootstrap blocks until refresh returns. Apps (optionally via app-kit) push warm neighbors and multi-from map edges; core never invents fetches or depth policies.

## Server sessions (when backends appear)

A server must `Set-Cookie` (or issue tokens); the browser then sends credentials on same-origin requests. That binding is owned by the app/backend, not core NodeCache. Core may later pass an empty `platform` object into `refresh` for shared login—see SPEC.
