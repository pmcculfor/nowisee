# Nowisee — agent guide

This file is binding for anyone (human or agent) working on Nowisee. Product detail lives in [`docs/SPEC.md`](docs/SPEC.md). Interface contracts live in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Product in one paragraph

Nowisee is an accessibility-first website for blind and keyboard/screen-reader-primary users. The UI shows **one unformatted text string**. Navigation is arrow keys (plus Escape to leave text-input mode). The product is a graph of text nodes served by portable **apps**. Core is a generic shell — never Bible- or Mail-specific.

## Quality bar

- **Robust over sloppy.** Incomplete is fine. Fragile, one-off, or product-specific core code is not.
- **Design before code.** Enumerate behaviors and edge cases first. Tests verify the design; they do not invent it.
- **DRY.** One owner for each concern. Never two ways to compute the same thing.
- **Long-term product.** Assume years of maintenance, many apps, and other authors.

## Genericity checklist (before anything enters core)

If any answer is “only Bible / mail / our first apps,” it does **not** belong in core.

1. **Multiplicity:** Works as a list/map of many ids (50 apps, many nodes)?
2. **Unknown app:** Could a third-party app use this with no core edits?
3. **Who decides?** Core = mechanics; app = content, next node, warm set, stale handling.
4. **No product names in core.**
5. **Variance by tree level:** Per-`navigate` response decisions, not core one-size policy.
6. **Swap path:** App data source can change without rewriting the shell.
7. **Stale-safe:** Core never assumes an old node id still exists.
8. **One extension path:** New app / new node / richer bundle — not new core branches per feature.
9. **DRY / one owner** per concern.
10. **Design edge cases before code.**

## Anti-patterns (do not repeat)

- Core `BibleRepository` / `MailRepository` or Home hardcoding app names
- `provide(nodeId)` driven by a core-chosen next id
- Core prefetch radii (`siblingRadius`, `childDepth`, etc.)
- Special `activate()` API for actions
- Left = tree parent only (breaks cross-links)
- Assuming every node has a unique permanent URL
- Putting Bible/Mail logic into core “just for the MVP”

## Locked behaviors (do not change without owner approval)

| Topic | Lock |
|-------|------|
| Navigation API | `navigate(action)`; **app** picks next node |
| Prefetch | App pushes `warm` nodes; core `NodeCache` only stores/serves |
| Left | History **back** (stack pop); at bottom → **homepage** |
| Up/Down stack | **Replace** top |
| Right stack | **Push** |
| Sibling ends | **Wrap** |
| Right with nowhere to go | Silent no-op |
| URLs | Optional; aliases OK; ephemeral keeps prior share URL |
| Input exit | Escape |
| MVP apps | KJV Bible + demo mail as portable `AppModule`s |
| Auth/DB | Not MVP |

## Mental model

- **Core** = shell for a text-node browser (keys, stack, cache, registry, display).
- **Apps** = authorities that answer navigation actions with node bundles.
- When unsure, push knowledge into the app; keep core smaller.
