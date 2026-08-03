# Nowisee — agent guide

This file is binding for anyone (human or agent) working on Nowisee. Product detail lives in [`docs/SPEC.md`](docs/SPEC.md). Interface contracts live in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Module responsibilities live in [`docs/MODULES.md`](docs/MODULES.md).

## Product in one paragraph

Nowisee is an accessibility-first website for blind and keyboard/screen-reader-primary users. The UI shows **one unformatted text surface** (a text node, or an input box when the current node is an input node). Navigation is driven by a **navigation map** (arrow keys and mapped chords such as Ctrl+Left / Ctrl+Right). The product is a graph of nodes served by portable **apps**, including Home. Core is a generic shell — never Bible-, Mail-, or Notes-specific.

## Quality bar

- **Robust over sloppy.** Incomplete is fine. Fragile, one-off, or product-specific core code is not.
- **Design before code.** Enumerate behaviors and edge cases first. Tests verify the design; they do not invent it.
- **DRY.** One owner for each concern. Never two ways to compute the same thing.
- **Long-term product.** Assume years of maintenance, many apps, and other authors.

## Packaging layers (before anything enters core)

| Layer | Role |
|-------|------|
| **Core** | Router, per-app stack, navigation-map store, client warm cache, display, keyboard, registry, busy/errors. Talks to apps only via `open` / `refresh`. |
| **App kit** | Optional helpers apps *import* (edge builders, list edges, input chords, optional neighborhood warm walk). Navigator never calls these automatically. |
| **App domain** | That app’s data, queries, graph shape, side effects, URLs. |

If any answer is “only Bible / mail / notes / our first apps,” it does **not** belong in core. Prefer app kit for shared boilerplate; keep domain logic in the app.

## Genericity checklist (before anything enters core)

1. **Multiplicity:** Works as a list/map of many ids (50 apps, many nodes)?
2. **Unknown app:** Could a third-party app use this with no core edits?
3. **Who decides?** Core = mechanics; app = content, edges, warm set, stale handling, URLs.
4. **No product names in core.**
5. **Variance by tree level:** Per-`refresh` response decisions, not core one-size prefetch policy.
6. **Swap path:** App data source can change without rewriting the shell.
7. **Stale-safe:** Core never assumes an old node id still exists without refresh.
8. **One extension path:** New app / new node / richer refresh result — not new core branches per feature.
9. **DRY / one owner** per concern.
10. **Design edge cases before code.**

## Anti-patterns (do not repeat)

- Core `BibleRepository` / `MailRepository` / `NotesRepository` or Home hardcoding peer app node ids
- `provide(nodeId)` / core-chosen next id for Up/Down/Right
- Core prefetch radii (`siblingRadius`, `childDepth`, etc.) or automatic multi-level warm expansion in Navigator
- Special `activate()` API or `action` edge kind (actions are ordinary nodes; side effects run on `refresh`)
- Left = tree parent only (use navigation-map edges; inside an app, typical Left is `pop`)
- Assuming every node has a unique permanent URL
- Putting Bible/Mail/Notes logic into core “just for the MVP”
- Silent stack teleport after workflows (e.g. jump to inbox after send)
- Auto-dismissing status/confirmation text without an explicit key
- Escape-as-platform-exit from input nodes

## Locked behaviors (do not change without owner approval)

| Topic | Lock |
|-------|------|
| App API | `open(url)` + `refresh(stack, extras)` → navigation map + warm + url |
| Prefetch | App pushes `warm` + navigation-map edges; core only stores/serves |
| Navigation map | `(fromNodeId, key) → node \| url` edge; missing = silent no-op |
| Stack | Per **current app** only; URL open resets stack |
| Node edge stackBehavior | `push` / `replace` / `pop` (on `pop`, omit `toNodeId`; stack tip wins) |
| Cross-app / leave app | `url` edges only; app root Left **MUST** be URL to home |
| Home | An `AppModule`, not a core-special UI |
| Input leave | Mapped chords only (recommend Ctrl+Right / Ctrl+Left); **no Escape exit** |
| Sibling ends | App choice via edges (wrap not mandated) |
| Dead-end key | Silent no-op |
| Status / action aftermath | Stay on node until user navigates; refresh may update text in place |
| URLs | App returns share URL from refresh; null/omit keeps prior address bar |
| Client vs server cache | Core owns client warm only; server cache/session behind apps |
| MVP apps | Home + KJV Bible + demo mail as portable `AppModule`s |
| Auth/DB | Not MVP; reserve empty platform context on refresh |

## Mental model

- **Core** = shell for a text-node browser (keys, stack, map, cache, registry, display, router).
- **Apps** = authorities that answer `open` / `refresh` with navigation maps and warm nodes.
- When unsure, push knowledge into the app (or optional app kit); keep core smaller.
