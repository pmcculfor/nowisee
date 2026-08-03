# Nowisee — longevity design review

**Reviewed:** [`AGENTS.md`](../AGENTS.md), [`SPEC.md`](SPEC.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), [`MODULES.md`](MODULES.md), [`ENGINEERING.md`](ENGINEERING.md) at the pre-code stage.

**Question asked:** is the logic and design robust enough to last years without forced refactors as capability and scale are added?

**Verdict:** the *layering* is sound and unusually disciplined — app-as-authority, core-as-shell, no product names in core, per-app stack, no teleport. Those are the decisions that are genuinely expensive to change later, and they are right.

The risk is not in the layering. It is that several **contract details** encode assumptions that will not survive the roadmap the spec itself commits to (many apps, third-party apps, an App Store, real backends, mobile). Each one is cheap to change today because there is no code, and expensive later because it is baked into every app that ships against the contract. Nothing below asks for a change to the architecture. Everything below is a change to the *vocabulary and guarantees* of `open` / `refresh`.

This document proposes deltas to locked behavior. Per `AGENTS.md`, locks require owner approval; nothing here has been applied to the specs.

---

## 0. What is already right (do not relitigate)

| Decision | Why it holds up |
|----------|-----------------|
| App answers `open` / `refresh`; core never computes next ids | The single most important call in the whole plan. It is what lets app #50 exist without a core edit. |
| App pushes `warm` + map; no core prefetch radii | Prefetch policy is inherently per-domain and per-tree-level. Centralizing it always ends in tuning knobs that fit nobody. |
| Navigation as data (`(fromNode, key) → edge`) rather than code | Makes navigation testable, serializable, and — with §1 below — remappable and modality-independent. |
| Per-app stack, cross-app by URL only | Prevents the classic "history contains three products" mess. |
| `pop` omits `toNodeId`; stack tip wins | Correct: removes an entire class of desync bug. |
| No `activate()`, no `action` edge kind | Right instinct (small protocol), but the replacement needs a guarantee it currently lacks — see §2. |
| No teleport, no auto-dismiss, no Escape exit | These are real accessibility requirements, correctly promoted to locks. |
| Home as an ordinary app | Prevents the "home is special" rot that kills shells like this. |
| Explicit anti-pattern list in `AGENTS.md` | Rare and valuable. Keep it; add to it as decisions land. |

The findings below are ordered by *cost of fixing later*, not by severity.

---

## 1. Physical keys are baked into app-authored data

**Current:** `NavKey = "up" | "down" | "left" | "right" | "ctrl+left" | "ctrl+right" | string`. Apps author edges keyed by physical keystrokes. `AGENTS.md` locks Ctrl+Right / Ctrl+Left as the recommended input-leave chords.

**Why this does not last.** The keystroke is an *input device detail*; the map is *app semantics*. Fusing them means every one of the following requires touching every app that ever shipped:

- **Mobile / touch.** VoiceOver and TalkBack have no arrow keys. Swipe-right is the universal "next" gesture. A phone build cannot reuse a single app's map.
- **User-remappable keys.** A settings screen that lets a user swap Up/Down for `j`/`k`, or move off a chord their screen reader steals, is impossible when the binding lives in app data. For this audience, remappable input is not a luxury.
- **Other modalities.** Braille display panning keys, sip-and-puff / switch access (which emit "next"/"select" and nothing else), voice control ("next", "open"). Each is a natural fit for an intent, and unimplementable against physical keys.
- **RTL.** "Left" is directional. In Hebrew or Arabic, back is *right*. Semantics survive; directions do not.
- **Chord collisions.** `Ctrl+Left` / `Ctrl+Right` inside a text input is *word-wise caret movement* on every major platform. The spec recommends stealing it precisely on input nodes, where blind users rely on it most. Screen readers and browsers also claim various Ctrl+arrow and Alt+arrow combinations. This specific recommendation is a usability bug today, independent of the larger point.

**Proposed delta.** Keep the map shape exactly as locked — `(fromNodeId, key) → NavEdge`. Change only the *vocabulary* of `key` from physical keystrokes to intents, and give the Keyboard module ownership of the physical → intent binding table.

```ts
export type NavIntent =
  | "prev" | "next"        // sibling movement
  | "enter" | "back"       // descend / ascend
  | "commit" | "cancel"    // leaving an input node
  | (string & {});         // app-declared symbolic intents

export interface KeyBinding {
  readonly intent: NavIntent;
  readonly key: string;                       // KeyboardEvent.key
  readonly mods?: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean };
  readonly whenTip?: NodeKind;                // e.g. commit binding only on input tips
}
```

Core ships a default binding table (arrows plus a commit chord that is *not* Ctrl+arrow — `Ctrl+Enter` for commit and `Alt+Up`/`Shift+Tab`-class for cancel are better candidates, to be settled in the accessibility spike of §7). A future settings app replaces the table. Apps never learn what a keyboard is.

This preserves every lock's *structure*, costs one indirection in Keyboard, and buys mobile, remapping, alternative input, and RTL for free. Retrofitting it after N apps exist means rewriting N apps' maps.

---

## 2. Side effects have no identity, and the recommended graph shape fires them by accident

**Current:** §4.5 removes `activate()`; side effects run "when the user navigates onto an action/status node and `refresh` runs". The stated safeguard is that "the app structures the graph so the effectful tip is entered deliberately."

**Why this does not last.** `refresh` is called on *every* arrival at a tip, including background revalidation after a warm hit, re-entry, and `hashchange`. Nothing in the contract distinguishes those. Three concrete failures:

1. **Sibling browsing fires effects.** The spec's own example graph — verse options `Copy` / `Commentary` as Up/Down siblings with `stackBehavior: replace` — means pressing Down onto `Copy` makes it the tip, which calls `refresh`, which performs the copy. The document's escape hatch is that apps *should* structure graphs to avoid this, but the shape the spec demonstrates is exactly the shape that breaks. A rule enforced by author discipline will be violated, by first-party apps, within the MVP.
2. **At-least-once delivery with no dedup key.** Warm hit → immediate display → background `refresh` → app sends the mail. The user presses a key; the tip changes; core discards the result as stale. The mail is still sent. Core's staleness guard protects the *display*, never the *effect*. Reload on a status tip re-sends. There is no request id, so an app cannot deduplicate even if it wants to.
3. **Apps cannot tell why they were called.** "Revalidate this view" and "the user just deliberately committed" require opposite behavior, and arrive as the identical call.

**Proposed delta.** Do not reintroduce `activate()`. Add *cause* to the existing call, and make the safe rule structural rather than advisory:

```ts
export type RefreshReason =
  | "open"        // URL entry / bootstrap
  | "commit"      // user traversed an `enter` / `commit` intent — effects permitted
  | "browse"      // user traversed `prev` / `next` / `back` — effects forbidden
  | "revalidate"; // core-initiated background refresh — effects forbidden

export interface RefreshTrigger {
  readonly reason: RefreshReason;
  readonly requestId: string;   // stable per user-initiated transition
  readonly fromNodeId?: string;
  readonly intent?: NavIntent;
}
```

Then three normative rules:

- Apps **MUST NOT** perform side effects unless `reason === "commit"`.
- Apps **MUST** treat `refresh` as at-least-once and deduplicate by `requestId`.
- Core **SHOULD** coalesce `browse` and `revalidate` refreshes behind a short settle window, so holding Down through a list issues one refresh rather than twenty.

`reason` composes directly with the intents from §1: browsing intents can never be effectful, by construction, which is what §4.5 wants and cannot currently guarantee.

---

## 3. Staleness is guarded by tip id, which is not a correctness guard

**Current:** `MODULES` §7 — record `startedTipId` when a refresh begins; on completion, discard if the current tip id differs. Elsewhere the same section mentions "(+ monotonic token)". The two descriptions are not the same mechanism, and only one of them works.

**Why this does not last.**

- **A → B → A returns to the same id.** The in-flight result from the first visit to A passes the equality check and is applied over newer state. This is not exotic; it is Down-then-Up.
- **Router and Navigator both start work.** `MODULES` §3 has Router setting busy, calling `open`, applying the result, and clearing busy; §7 has Navigator doing the same for navigation. Two independent generation domains cannot arbitrate between an in-flight `open` and an in-flight `refresh`.
- **"Open while busy: ignore or queue latest wins — document choice in code."** Concurrency policy deferred to an implementation comment is how a shell acquires two conflicting behaviors.

**Proposed delta.** One monotonic counter owned by Navigator, incremented by *every* transition (key, open, hashchange). A result is applied only if its token is the newest issued; otherwise it is dropped whatever the tip id says. Router does not own busy and does not apply results (see §9). Pass an `AbortSignal` in `RefreshExtras` so a superseded app call can cancel real network work instead of running to completion — free now, awkward to add once apps assume they run to completion.

---

## 4. Apps mint their own `#/...` URLs, so core does not own its address space

**Current:** `NavEdge { kind: "url", url: string }`, `RefreshResult.url?: string | null`, app-kit `homeEnterUrl(appId)` building `#/<appId>`, Router parsing the same grammar.

**Why this does not last.** The hash-route grammar is written down in Router (parser), app-kit (builder), and implicitly in every app that returns a share URL. Two owners of one format, which `AGENTS.md` explicitly forbids. Any of the following then becomes a rewrite across all apps: moving from hash routes to History API paths (wanted eventually for sharing, previews, and service workers), mounting the app under a sub-path, adding a locale segment, or adding a native/mobile shell with a custom scheme. `ENGINEERING.md` already flags hash routing as an MVP convenience, which means the migration is planned, not hypothetical.

There is also no structural distinction between "another Nowisee app" and "somewhere on the web", so Router cannot validate a target before navigating.

**Proposed delta.** Apps address *locations*; core serializes them.

```ts
export interface AppLocation { readonly appId: string; readonly path: string }

export type NavEdge =
  | { kind: "node";     toNodeId?: string; stackBehavior: StackBehavior; passInputText?: boolean }
  | { kind: "app";      to: AppLocation;   passInputText?: boolean }   // internal
  | { kind: "external"; href: string };                                 // genuinely off-platform

// RefreshResult
location?: AppLocation | null;   // replaces `url`; null/omit keeps the address bar
```

Core exposes `router.hrefFor(location)` for anything that needs a real string (a Copy-link node, for instance). `homeEnterUrl` collapses into `{ appId, path: "/" }`. The URL grammar acquires exactly one owner, and the eventual hash → path migration touches Router alone.

---

## 5. The app boundary is not serializable, which forecloses the App Store

**Current:** apps are in-process objects. `NodePayload.data?: unknown`. Home takes a live `AppRegistry` reference by closure. The Bible app performs the clipboard write itself inside `refresh`.

**Why this does not last.** `SPEC` §1 commits to "possibly third-party apps and an in-product App Store". Third-party code cannot run in-realm with full DOM access, and it cannot be trusted to be well-behaved. The good news is that `open`/`refresh` is *already* shaped like a message protocol — request in, plain data out. That is the property that lets an app later live in a Worker, an iframe, or on a server with no contract change. Three details currently break it, and each gets harder to remove as apps rely on it:

- `data?: unknown` invites non-cloneable values (functions, class instances, DOM nodes, live app state).
- Live object references across the boundary (Home's registry handle) do not survive a serialization boundary.
- Privileged effects performed by app code directly. Clipboard is the immediate example, and it is *already broken on its own terms*: `navigator.clipboard.writeText` requires transient user activation, which is gone after `refresh` awaits anything. The MVP "Copy" flow will fail intermittently in Safari and under some Chrome focus conditions.

**Proposed delta.**

- Everything crossing `open` / `refresh` **MUST** be structured-cloneable. Type `data` as a JSON-ish value rather than `unknown` so the compiler enforces it.
- Give the reserved `platform` seam a shape now, as capabilities rather than an untyped bag. Effects go through core, which holds the user gesture and can be granted or denied per app:

```ts
export interface PlatformContext {
  readonly clipboard?: { writeText(text: string): Promise<void> };
  readonly storage?: { get(k: string): Promise<JsonValue | null>; set(k: string, v: JsonValue): Promise<void> }; // per-app namespace
  readonly announce?: (text: string) => void;   // SR-only status, does not move the tip
  readonly requestRefresh?: () => void;         // app-initiated update (new mail, etc.)
  readonly signal: AbortSignal;
}
```

- Home receives `listEnabled()` results as data, not a registry object.

`requestRefresh` deserves attention independently: today the graph can only change when the user presses a key. Mail, notifications, and any live data source need a way to say "the current node's text changed". Reserving the capability now costs nothing; adding a push channel to a pull-only protocol later does not.

---

## 6. Busy, dead end, and failure are all silent — and the audience cannot see a spinner

**Current:** dead-end key → silent no-op (locked). Warm miss → "block on refresh; ignore further nav keys; **no placeholder**". Refresh failure → "keep last text; clear busy". Display announces via one `aria-live="assertive"` region.

**Why this does not last.** For a sighted user these three states are trivially distinguishable. For this product's entire user base they are byte-identical: *press key, nothing is spoken*. The user cannot tell "there is nothing that way" from "the network is slow" from "it failed". The predictable coping behavior is to press the key repeatedly, which — combined with §2 and §3 — is exactly the input pattern that triggers the worst races.

This is the finding I would rank highest on product risk, and it is cheap now because it is a small addition to the Display and Navigator contracts rather than a change to either.

**Proposed delta.** Core owns a second, SR-only status channel, distinct from the content surface (this does not violate "one text surface" — it is announcement, not a competing interactive region):

- Transition still pending after ~150 ms → polite "working" announcement; announce completion or failure.
- Refresh failure → generic core-owned announcement; content stays put. Apps may still return their own error *text*, but core must not be silent when the app never answers.
- Dead-end no-op → a distinguishable minimal cue (a short earcon or a terse announcement), with silence available as a user setting rather than as the only behavior.

Separately: `aria-live="assertive"` as the default is very likely wrong for this interaction model. Assertive interrupts, and rapid arrow navigation will produce interruption storms and double-speak. The two viable strategies are (a) `role="status"` / polite with `aria-atomic`, or (b) move focus to the (re-rendered, `tabindex="-1"`) surface and let the screen reader announce it naturally. Which one wins is an empirical question — see §7 — but it should be answered before Display is written, because the choice determines Display's DOM contract.

---

## 7. The core interaction premise has not been validated against screen-reader browse mode

**Current:** Keyboard listens for arrows and calls `preventDefault` on handled keys.

**Why this is existential rather than merely important.** NVDA and JAWS run web content in *browse mode* by default, where the screen reader consumes arrow keys for its own virtual cursor and the page never sees them. VoiceOver on macOS with QuickNav enabled does the same with Left/Right. If arrows never reach the page, Nowisee's entire navigation model is inert for a large share of its intended users, and no amount of `preventDefault` helps — the interception happens above the browser.

The escapes are known but each has a cost: `role="application"` on the surface forces focus mode but suppresses the screen reader's normal reading conventions and its own text-reading commands; keeping focus permanently inside an input-like element forces forms mode but constrains presentation. This is a decision with visible product consequences, and the spec does not currently mention that the problem exists.

**Proposed action (before Display and Keyboard are written).** A short spike: one static page, one surface, three configurations (`role="application"`, focused `contenteditable`/input, plain focused `div` with a live region), tested against NVDA + Firefox, NVDA + Chrome, JAWS + Chrome, VoiceOver + Safari, VoiceOver iOS, and TalkBack. Record which arrow keys arrive, how updates are announced, and whether the screen reader's own reading commands remain usable. Write the outcome into `MODULES` §8/§9 as a lock. This spike also settles §6's assertive-vs-polite question and confirms whether the §1 default binding table is reachable.

**Related product question the spec has not answered:** with browse mode suppressed, the screen reader's line/word/paragraph reading commands may be unavailable, and `MODULES` §8 explicitly allows arbitrarily long labels ("single blob; no truncation required"). A full email body or a long chapter then becomes an uninterruptible monologue with no way to rewind. The Bible app happens to dodge this by chunking at verse granularity; mail does not. Either apps **MUST** chunk long content into nodes, or a `NodeKind` variant releases arrows to the screen reader for long-form reading. Worth deciding now, since it is a `NodeKind` extension and §11 governs how those evolve.

---

## 8. Deep links have no ancestry, so `back` means two different things at the same node

**Current:** URL open resets the stack (locked); `RefreshResult` carries a single `node`, so an opened deep link starts with a one-entry stack. `MODULES` §12 acknowledges this. `MODULES` §6 says popping the last entry lands the user at Home.

**Consequence.** Reaching `Matthew 5:8` by navigating leaves a stack of Testament → Book → Chapter → Verse, and `back` returns to the chapter. Reaching the *same node* from a shared link leaves a one-entry stack, and `back` exits to Home. The app can work around this — it sees the stack in `refresh` and can author `back` as a URL edge when the stack has length 1 — but that means every app carries branching boilerplate, and the user-visible behavior of a key silently depends on how they arrived. For an audience that navigates by memorized spatial habit, an inconsistent `back` is a significant regression, and shared links are the main growth channel a product like this has.

**Proposed delta.** Let `open` (only `open`, never `refresh`) return an optional ancestry proposal:

```ts
export interface RefreshResult {
  // ...
  /** open() only: rehydrate the stack so deep links have a real ancestry. Tip must be `node`. */
  stack?: readonly StackEntry[];
}
```

This is stack *rehydration at entry*, not a teleport: the user has not moved, and the no-teleport lock (which governs `refresh` rewriting the stack under a user who is already somewhere) is untouched. Core validates that the last entry matches `node.id` and ignores the field on `refresh`.

---

## 9. Two modules own the same state transition

**Current:** `MODULES` §3 gives Router an eight-step sequence that clears the stack, clears cache and map, sets busy, calls `app.open`, applies the result, and clears busy. `MODULES` §7 gives Navigator ownership of stack, busy, generation, and applying results.

Both modules mutate stack, cache, map, busy, and the display. That is precisely the "two ways to compute the same thing" that `AGENTS.md` bans, and it is why §3's concurrency question ("ignore or queue — document choice in code") has no clean answer: there is no single place where the answer could live.

**Proposed delta.** Router becomes a pure boundary: parse location → `AppLocation`, serialize `AppLocation` → href, listen for `hashchange`. All state transitions — including the open transaction — run through one Navigator entry point that owns the generation counter, busy, stack, cache, map, and display. Concurrency policy then has exactly one implementation and one test surface.

---

## 10. Two map representations and a collision-prone key encoding

**Current:** `NavigationMap = Map<string, NavEdge> | Record<string, NavEdge>`, with a suggested key format of `` `${fromNodeId}::${navKey}` ``.

Two representations means every consumer normalizes, or normalization gets duplicated. Node ids are explicitly app-owned opaque strings — they will contain paths, URLs, and colons — so a `::` delimiter is a latent collision that will surface as an unreproducible "one key does the wrong thing" bug years from now.

**Proposed delta.** One representation, nested, no delimiter at all:

```ts
export type NavigationMap = Readonly<Record<string /* fromNodeId */, Readonly<Record<NavIntent, NavEdge>>>>;
```

Cheap, total, and it makes the map trivially serializable for §5.

---

## 11. No contract version and no defined behavior for unknown values

**Current:** `AppModule` has `id` and `label`. `NodeKind` is a closed union. `NavEdge.kind` is a closed union. `NavKey` is open-ended, but there is no mechanism by which an app-defined chord ever reaches an app, since Keyboard normalizes only a built-in set.

For first-party apps compiled together this is fine. For third-party apps — which the spec commits to — a core and an app can be built months apart, and every unspecified case is a crash or a silent dead end in the field.

**Proposed delta.**

- `readonly apiVersion: 1` on `AppModule`; registry rejects versions it cannot serve, with a legible error rather than a crash.
- Normative forward-compatibility rules: unknown `NavEdge.kind` → treat as a missing edge (silent no-op, consistent with the existing lock); unknown `NodeKind` → render as text; unknown `NavIntent` in a map → simply never matched.
- Resolve the chord-extension ambiguity by folding it into §1: apps declare *intents*, and the binding table decides what reaches them. No per-app core change, ever.

---

## 12. Core trusts app responses completely

**Current:** core applies `navigationMap` and `warm` verbatim. `NodeCache` mentions an optional defensive max size; nothing else is bounded or validated.

A buggy first-party app returning a 50,000-entry `warm` array on every keystroke will simply make the product unusable, with the failure appearing in core. A hostile third-party app can do worse — `pop` edges that empty the stack, `app` edges impersonating another app id, absurd label lengths, cyclic instant-navigation edges.

Since every app response passes through one function, validation is a single choke point and costs almost nothing now. Retrofitting it after apps have come to depend on lax behavior is a compatibility break.

**Proposed delta.** Validate and clamp at the boundary: reject malformed edges rather than storing them, cap warm entries / map edges / string lengths, and surface violations through the §5 platform error channel so app bugs are attributable to the app rather than to the shell.

---

## Safe to defer (explicitly, so nobody over-builds)

These are genuinely additive and will not force a refactor, provided the items above land:

| Item | Why deferral is safe |
|------|----------------------|
| Optional `init` / `dispose` lifecycle hooks on `AppModule` | Optional methods are backward-compatible additions. |
| Telemetry / structured logging | A single core event hook can be added at the Navigator choke point later. |
| IndexedDB, service worker, offline | Sits behind the `storage` capability from §5. |
| Real auth and databases | The `platform` seam already exists; give it a shape (§5) and the rest follows. |
| Browser Back/Forward ↔ session stack | Contained inside Router once Router is a pure boundary (§9). |
| Per-user enabled apps, lazy app loading, App Store UI | Registry-level concerns; unaffected by the core protocol. |
| Multi-tab coordination | No shared mutable state in the design today. |
| Notes app | The fit check in `MODULES` §14 is correct; nothing blocks it. |
| Warm etags / cache invalidation protocol | Additive to `RefreshResult`. |

---

## Suggested additions to the testing contract

The current list in `ARCHITECTURE.md` covers structure well and concurrency not at all. Add:

1. `refresh` is at-least-once: the same `requestId` delivered twice performs one effect.
2. Effects never run for `reason` of `browse` or `revalidate` — including a test that walks the full sibling option list past an effectful node.
3. Generation: an A → B → A sequence discards the first A's in-flight result (the case tip-id equality gets wrong).
4. A superseded refresh receives an aborted signal.
5. An `open` racing an in-flight `refresh` resolves to exactly one applied result.
6. Malformed / oversized app responses are rejected without corrupting core state.
7. Deep-link entry with a rehydrated stack yields the same `back` behavior as arriving by navigation.
8. Blocking, dead-end, and failure each produce a *distinguishable* announcement.
9. Intent remapping: rebinding the keymap changes behavior with zero app changes.

---

## Recommended sequence

1. Run the screen-reader spike (§7). It can invalidate assumptions in Display, Keyboard, and the §1 default bindings, and it is the cheapest way to de-risk the product's central premise.
2. Land the protocol deltas that touch every app — intents (§1), refresh trigger and effect rules (§2), locations (§4), serializable boundary and capabilities (§5), map shape (§10), versioning (§11).
3. Land the core-internal deltas — generation and abort (§3), ownership split (§9), boundary validation (§12), status channel (§6).
4. Then scaffold in the order already given in `MODULES` §17.

Steps 2 and 3 are edits to `ARCHITECTURE.md` and `MODULES.md` plus the corresponding locks in `AGENTS.md`. There is no code to migrate yet, which is the entire reason to do it now.
