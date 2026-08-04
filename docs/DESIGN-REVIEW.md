# Nowisee — longevity design review

**Reviewed:** [`AGENTS.md`](../AGENTS.md), [`SPEC.md`](SPEC.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), [`MODULES.md`](MODULES.md), [`ENGINEERING.md`](ENGINEERING.md) at the pre-code stage.

**Question asked:** is the logic and design robust enough to last years without forced refactors as capability and scale are added?

**Verdict:** the *layering* is sound and unusually disciplined — app-as-authority, core-as-shell, no product names in core, per-app stack, no teleport. Those are the decisions that are genuinely expensive to change later, and they are right.

The risk is not in the layering. It is that several **contract details** encode assumptions that will not survive the roadmap the spec itself commits to (many apps, third-party apps, an App Store, real backends, mobile). Each one is cheap to change today because there is no code, and expensive later because it is baked into every app that ships against the contract. Nothing below asks for a change to the architecture. Everything below is a change to the *vocabulary and guarantees* of `open` / `refresh`.

---

## Disposition (owner-reviewed)

| § | Finding | Outcome |
|---|---------|---------|
| 1 | Physical keys baked into app data | **Accepted** — intents applied to the specs |
| 2 | Side effects have no identity | **Accepted, redesigned by owner** — `action: true` on the edge, simpler than the reviewed proposal; applied |
| 3 | Staleness guarded by tip id | **Accepted** — monotonic transition token + abort; applied |
| 4 | Apps mint their own `#/...` URLs | **Accepted** — `AppLocation`; applied |
| 5 | App boundary is not serializable | **Pending** — clipboard constraint recorded in `MODULES` §12 |
| 6 | Busy / dead-end / failure indistinguishable | **Deferred** — post-MVP; cost recorded |
| 7 | Screen-reader browse mode unvalidated | **Deferred** — settled during implementation |
| 8 | Deep links have no ancestry | **Deferred** — the right parent is not always obvious; additive later |
| 9 | Two owners for state transitions | **Accepted** — Router reduced to a pure boundary; applied |
| 10 | Two map representations, `::` collision | **Accepted** — nested map; applied |
| 11 | No contract version / unknown-value fallbacks | **Deferred** — revisit with third-party apps |
| 12 | Core trusts app responses | **Deferred** — first-party apps only for now |

Applied items are now normative in `SPEC.md`, `ARCHITECTURE.md`, `MODULES.md`, and the lock table in `AGENTS.md`. Deferred items are listed in `SPEC.md` §7 with their cost, and in `MODULES.md` §16. This document is kept as the reasoning record — including for the items that were declined.

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

**Status: accepted and applied.**

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

**Status: problem accepted; solved by the owner's edge-flag design rather than the one proposed here. Applied.**

**Current:** §4.5 removes `activate()`; side effects run "when the user navigates onto an action/status node and `refresh` runs". The stated safeguard is that "the app structures the graph so the effectful tip is entered deliberately."

**Why this does not last.** `refresh` is called on *every* arrival at a tip, including background revalidation after a warm hit, re-entry, and `hashchange`. Nothing in the contract distinguishes those. Three concrete failures:

1. **Sibling browsing fires effects.** The spec's own example graph — verse options `Copy` / `Commentary` as Up/Down siblings with `stackBehavior: replace` — means pressing Down onto `Copy` makes it the tip, which calls `refresh`, which performs the copy. The document's escape hatch is that apps *should* structure graphs to avoid this, but the shape the spec demonstrates is exactly the shape that breaks. A rule enforced by author discipline will be violated, by first-party apps, within the MVP.
2. **At-least-once delivery with no dedup key.** Warm hit → immediate display → background `refresh` → app sends the mail. The user presses a key; the tip changes; core discards the result as stale. The mail is still sent. Core's staleness guard protects the *display*, never the *effect*. Reload on a status tip re-sends. There is no request id, so an app cannot deduplicate even if it wants to.
3. **Apps cannot tell why they were called.** "Revalidate this view" and "the user just deliberately committed" require opposite behavior, and arrive as the identical call.

**Reviewed proposal (not adopted).** Add a `reason` (`open` / `commit` / `browse` / `revalidate`) plus a `requestId` to every call, permit effects only on `commit`, and require apps to deduplicate by id.

**Adopted instead (owner's design, and the better one).** Mark the *edge*, not the call. An edge may carry `action: true`; core sets `extras.action` on exactly the call caused by traversing that edge, and on no other call.

```ts
// edge
{ kind: "node", toNodeId: "copy-status", stackBehavior: "push", action: true }

// what core passes on that one traversal, and nowhere else
refresh(stack, { action: true })
```

Why it is better than what was proposed:

- **The owner is right.** Which transition constitutes a button press is app knowledge, and it is already expressed in app-authored data. A `reason` enum makes core classify app semantics; a flag lets the app state them.
- **It is smaller.** No enum, no request ids, no dedup obligation on every app. One optional boolean, alongside `passInputText`, which it exactly parallels.
- **It closes the same three holes structurally**, not by discipline: `prev` / `next` edges carry no flag so browsing options cannot fire them; revalidation carries no flag so a warm-hit refresh cannot repeat a send; re-entry carries no flag so nothing replays.
- **Double-press is naturally safe** — after the local move the tip is the status node, and the trigger edge belonged to the previous node.
- **Reload is safe** when status tips return `location: null`, which they should anyway, since the address bar then never points at an action node.

Three core rules make it airtight, all recorded in `ARCHITECTURE.md`:

1. The flag appears on exactly the call caused by that traversal — never on bootstrap, revalidation, replay, or retry.
2. Core never re-issues, retries, or aborts an action call. A failed action is re-triggered by the user, which is the only correct retry policy for a non-idempotent operation.
3. Core may coalesce read-only revalidations (holding `next` through a long list should not issue one call per row), but never an action call.

Residual risk, accepted: if an action call rejects, core keeps the last text and the user reads "Sending…" forever. Mitigated by the existing MUST that apps resolve with a status node rather than reject; fully addressed only when §6 lands.

---

## 3. Staleness is guarded by tip id, which is not a correctness guard

**Status: accepted and applied.**

**Current:** `MODULES` §7 — record `startedTipId` when a refresh begins; on completion, discard if the current tip id differs. Elsewhere the same section mentions "(+ monotonic token)". The two descriptions are not the same mechanism, and only one of them works.

**Why this does not last.**

- **A → B → A returns to the same id.** The in-flight result from the first visit to A passes the equality check and is applied over newer state. This is not exotic; it is Down-then-Up.
- **Router and Navigator both start work.** `MODULES` §3 has Router setting busy, calling `open`, applying the result, and clearing busy; §7 has Navigator doing the same for navigation. Two independent generation domains cannot arbitrate between an in-flight `open` and an in-flight `refresh`.
- **"Open while busy: ignore or queue latest wins — document choice in code."** Concurrency policy deferred to an implementation comment is how a shell acquires two conflicting behaviors.

**Proposed delta.** One monotonic counter owned by Navigator, incremented by *every* transition (key, open, hashchange). A result is applied only if its token is the newest issued; otherwise it is dropped whatever the tip id says. Router does not own busy and does not apply results (see §9). Pass an `AbortSignal` in `RefreshExtras` so a superseded app call can cancel real network work instead of running to completion — free now, awkward to add once apps assume they run to completion.

---

## 4. Apps mint their own `#/...` URLs, so core does not own its address space

**Status: accepted and applied.** Core also gained `config.rootAppId`, so no core file names the Home app.

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

**Status: pending.** Restated in plain terms below, since the original write-up assumed too much.

### What is true today

Apps are plain JavaScript objects living in the same page as core. An app can therefore reach anything the page can reach: the DOM, globals, the clipboard, the network. Core also hands apps live objects — Home gets the actual `AppRegistry` — and `data?: unknown` lets an app put literally anything into a node payload, including functions and DOM nodes.

For apps we write ourselves, none of that is a problem.

### Why it matters if apps you did not write ever run here

You cannot run someone else's code in the same page as everyone's data. A buggy or hostile app could read what the user is doing in other apps, hijack the keyboard, or crash the shell. The standard fix is to run each app in a sandbox — a Web Worker, an iframe, or on a server — and all three work the same way: the two sides **send messages** instead of sharing objects. Messages can carry plain data (strings, numbers, arrays, plain objects) and nothing else. No functions, no DOM nodes, no live references.

The good news is that `open` / `refresh` is *already* message-shaped: you call it with plain data and it answers with plain data. That is genuinely valuable and worth protecting, because it means the sandbox move is later a change of transport, not a change of contract.

Three things currently poke a hole through that line, and each gets harder to remove the more apps rely on it:

1. `data?: unknown` — the type permits things that cannot be sent as a message.
2. Home receives the registry object rather than a list of app descriptions.
3. Apps perform browser-privileged operations themselves — the Bible app calling the clipboard.

### The immediate, non-hypothetical part: Copy is broken as specified

Browsers only permit a clipboard write while the user's keypress is still "fresh" (transient user activation). `refresh` is async, so by the time the app calls `writeText`, the browser has often stopped counting the keypress as recent — Safari strictly, Chrome under some focus conditions. The MVP Copy flow will fail intermittently.

Note carefully: **routing the call through core does not by itself fix this.** The problem is *when* the write happens, not *who* calls it. The fix is that the write must begin inside the keypress. Only core is in that position, because only core handles the keydown. The two workable implementations are (a) core starts the write during the keydown using the promise form of `ClipboardItem`, resolving it with text the app supplies, or (b) the app puts the copy text in the warm payload so core has it before any await. Both require core to know a clipboard write is coming, which the `action` edge already signals.

### What would be asked for, if and when this is taken up

- Type payload `data` as plain JSON so the compiler prevents accidents.
- Hand Home a list of app descriptions rather than the registry object.
- Give the already-reserved `platform` seam a shape, so browser-privileged operations go through core:

```ts
export interface PlatformContext {
  readonly clipboard?: { writeText(text: string): Promise<void> };
  readonly storage?: { get(k: string): Promise<JsonValue | null>; set(k: string, v: JsonValue): Promise<void> };
  readonly announce?: (text: string) => void;   // SR-only status, does not move the tip
  readonly requestRefresh?: () => void;         // app-initiated update (new mail, etc.)
}
```

`requestRefresh` deserves attention on its own merits, independent of sandboxing: today the screen can only change when the user presses a key. Mail, notifications, and any live data source eventually need a way to say "the text on the current node changed". Reserving the capability costs nothing; retrofitting a push channel onto a pull-only protocol does not.

---

## 6. Busy, dead end, and failure are all silent — and the audience cannot see a spinner

**Status: deferred past MVP.** Additive when taken up: a second SR-only region in Display plus announcements at the existing Navigator transition points. No contract change, so nothing here constrains the MVP build. The one interaction to keep in mind is that a rejected action call (§2) strands the user on "Sending…" until this lands, which is why apps MUST resolve with a status node rather than reject.

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

**Status: deferred to implementation.** The owner's position is that the DOM setup can be worked out once something is running, and that if it cannot be made to work the premise fails regardless. That is true. The counter-argument, recorded and not pressed further: the spike is a single static HTML page with three variants and no dependency on any core decision, so it can be run in parallel with the build rather than after it, and it is the only finding in this document that can invalidate the product rather than cost a refactor. It also settles the provisional key bindings in `MODULES` §9 and the assertive-vs-polite question below.

**Why this is existential rather than merely important.** NVDA and JAWS run web content in *browse mode* by default, where the screen reader consumes arrow keys for its own virtual cursor and the page never sees them. VoiceOver on macOS with QuickNav enabled does the same with Left/Right. If arrows never reach the page, Nowisee's entire navigation model is inert for a large share of its intended users, and no amount of `preventDefault` helps — the interception happens above the browser.

The escapes are known but each has a cost: `role="application"` on the surface forces focus mode but suppresses the screen reader's normal reading conventions and its own text-reading commands; keeping focus permanently inside an input-like element forces forms mode but constrains presentation. This is a decision with visible product consequences, and the spec does not currently mention that the problem exists.

**Proposed action (before Display and Keyboard are written).** A short spike: one static page, one surface, three configurations (`role="application"`, focused `contenteditable`/input, plain focused `div` with a live region), tested against NVDA + Firefox, NVDA + Chrome, JAWS + Chrome, VoiceOver + Safari, VoiceOver iOS, and TalkBack. Record which arrow keys arrive, how updates are announced, and whether the screen reader's own reading commands remain usable. Write the outcome into `MODULES` §8/§9 as a lock. This spike also settles §6's assertive-vs-polite question and confirms whether the §1 default binding table is reachable.

**Related product question the spec has not answered:** with browse mode suppressed, the screen reader's line/word/paragraph reading commands may be unavailable, and `MODULES` §8 explicitly allows arbitrarily long labels ("single blob; no truncation required"). A full email body or a long chapter then becomes an uninterruptible monologue with no way to rewind. The Bible app happens to dodge this by chunking at verse granularity; mail does not. Either apps **MUST** chunk long content into nodes, or a `NodeKind` variant releases arrows to the screen reader for long-form reading. Worth deciding now, since it is a `NodeKind` extension and §11 governs how those evolve.

---

## 8. Deep links have no ancestry, so `back` means two different things at the same node

**Status: deferred.** The owner's objection is sound: for many nodes there is no obviously correct parent to synthesize, and inventing one is worse than having none. `RefreshResult.stack` remains available as a purely additive change if the inconsistency proves annoying in practice. The consequence is recorded in `MODULES` §6 so nobody rediscovers it as a bug.

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

**Status: accepted and applied.** In plain terms:

The specs describe the same job twice. `MODULES` §3 told Router to clear the stack, clear the cache and map, set the busy flag, call the app, apply the answer, and clear busy. `MODULES` §7 told Navigator to do all of those things too. So both modules could change the same state, from two different code paths, with no arbitration between them.

The concrete symptom is already visible in the old text. §3 asked "what if the user opens a URL while a refresh is already running?" and answered "ignore or queue a single latest open — document choice in code". That question has no clean answer while two modules are in charge, because there is nowhere for the answer to live. You would end up with Router's idea of what is in flight and Navigator's idea of what is in flight, and the bug that follows — an old app response landing on top of newer state — is the kind that reproduces once a week and never in a test.

**What changed.** Router now does two things and nothing else: turn a browser URL into `{ appId, path }`, and turn `{ appId, path }` back into a URL. It also listens for the browser's `hashchange` and hands the result to Navigator. It owns no stack, no cache, no busy flag, and it never applies an app's answer.

Everything that actually changes what the user sees goes through one entry point in Navigator, which owns the stack, the cache, the map, busy, the display, the address bar, and the transition token from §3. Opening a URL is just another transition through that same path.

No behavior was added or removed — the steps that used to live in Router moved into Navigator. The payoff is that "what happens if the user presses a key mid-load" now has exactly one implementation and one place to test it.

---

## 10. Two map representations and a collision-prone key encoding

**Status: accepted and applied.**

**Current:** `NavigationMap = Map<string, NavEdge> | Record<string, NavEdge>`, with a suggested key format of `` `${fromNodeId}::${navKey}` ``.

Two representations means every consumer normalizes, or normalization gets duplicated. Node ids are explicitly app-owned opaque strings — they will contain paths, URLs, and colons — so a `::` delimiter is a latent collision that will surface as an unreproducible "one key does the wrong thing" bug years from now.

**Proposed delta.** One representation, nested, no delimiter at all:

```ts
export type NavigationMap = Readonly<Record<string /* fromNodeId */, Readonly<Record<NavIntent, NavEdge>>>>;
```

Cheap, total, and it makes the map trivially serializable for §5.

---

## 11. No contract version and no defined behavior for unknown values

**Status: deferred, and partly resolved by §1.** Worth clarifying, because the word "intents" caused confusion here: this finding proposed nothing new about intents. Its third bullet only observed that `NavKey` invited apps to invent chords that core had no way to deliver, and that accepting §1 makes the problem disappear — which it now has, since apps author intents and core owns the bindings. What is left is two small, unrelated things: an `apiVersion` field, and deciding what core does when it meets a value it does not recognize (proposal: unknown edge kind → treat as a missing edge; unknown node kind → render as text). Both only matter once a core and an app can ship separately, so deferring alongside §12 is consistent.

**Current:** `AppModule` has `id` and `label`. `NodeKind` is a closed union. `NavEdge.kind` is a closed union. `NavKey` is open-ended, but there is no mechanism by which an app-defined chord ever reaches an app, since Keyboard normalizes only a built-in set.

For first-party apps compiled together this is fine. For third-party apps — which the spec commits to — a core and an app can be built months apart, and every unspecified case is a crash or a silent dead end in the field.

**Proposed delta.**

- `readonly apiVersion: 1` on `AppModule`; registry rejects versions it cannot serve, with a legible error rather than a crash.
- Normative forward-compatibility rules: unknown `NavEdge.kind` → treat as a missing edge (silent no-op, consistent with the existing lock); unknown `NodeKind` → render as text; unknown `NavIntent` in a map → simply never matched.
- Resolve the chord-extension ambiguity by folding it into §1: apps declare *intents*, and the binding table decides what reaches them. No per-app core change, ever.

---

## 12. Core trusts app responses completely

**Status: deferred until third-party apps are real.** Reasonable while every app is first-party. One caveat worth holding onto: "we'll try not to abuse it" is a policy that only holds while the same people write core and every app. The validation layer sits at a single choke point (the one function that applies a `RefreshResult`), so it stays cheap to add later — provided nothing starts *depending* on core being permissive.

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

## Testing contract additions

The accepted ones are now in `ARCHITECTURE.md`. Recorded here for the deferred items, to be added when they land:

1. Malformed / oversized app responses are rejected without corrupting core state (§12).
2. Deep-link entry yields the same `back` behavior as arriving by navigation (§8).
3. Blocking, dead-end, and failure each produce a *distinguishable* announcement (§6).

---

## Where this leaves the plan

Applied: intents (§1), edge-flagged actions (§2), transition token and abort (§3), `AppLocation` (§4), Router/Navigator ownership split (§9), nested map (§10). These were the items that touch every app or every transition, so doing them before any code exists is the whole point.

Deferred with the cost written down: the status channel (§6), the screen-reader spike (§7), deep-link ancestry (§8), the serializable boundary and capabilities (§5), versioning (§11), and response validation (§12). Each is additive, and each is recorded in `SPEC.md` §7 and `MODULES.md` §16 so it resurfaces rather than being quietly forgotten.

Build order is unchanged — `MODULES.md` §17 still applies.
