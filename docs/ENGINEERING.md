# Nowisee — engineering notes

Proposed implementation choices for when the app is scaffolded later. **No application code lives in the repo yet** — only specs. Product locks: [`SPEC.md`](SPEC.md). Contracts: [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Proposed for MVP scaffolding (not implemented yet)

| Choice | Decision | Why |
|--------|----------|-----|
| Language | **TypeScript** | Robustness, typed contracts for `navigate` / bundles |
| UI toolkit | **Vanilla TS + Vite** | One text node; avoid framework DOM complexity |
| Topology | **Static SPA** | KJV + demo mail need no server; APIs can appear later behind apps |
| Hosting path | Static-compatible (Vite build → any static host) | Swap host without rewriting core |
| URL style | **Hash routes** (`#/…`) | Works on static hosting without server rewrites; apps still own canonicalization |
| Persistence | In-memory `NodeCache` only for MVP | IndexedDB later without changing warm ownership |
| Tests | Vitest for Navigator stack + app navigate units | Lock edge-case behavior from the spec |

## Non-goals for first code slice

- Real Gmail / OAuth
- Server database
- Service worker / offline shell
- Dedicated Home key (Left-to-home is enough)
- Third-party app loading at runtime (in-process registry is enough)

## Proposed layout (when scaffolding)

```text
src/
  core/       # shell: display, mode, navigator, cache, registry, types
  apps/       # portable AppModules (bible, mail-demo, help)
  shell/      # bootstrap: wire registry, mount display, keyboard
  main.ts
index.html
public/data/  # static assets (e.g. KJV JSON)
```

## Performance expectation

Arrow key on a node already answerable from app memory / `NodeCache` updates the single text surface immediately. Apps push `warm` neighbors; core never invents fetches.
