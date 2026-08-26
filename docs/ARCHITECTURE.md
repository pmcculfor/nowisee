# Nowisee — architecture

This file covers contracts, packaging, and the stack. Product locks are in [`SPEC.md`](SPEC.md). Core behavior is in [`MODULES.md`](MODULES.md). Persistence is [`STORAGE.md`](STORAGE.md). Identity is [`IDENTITY.md`](IDENTITY.md). Do not put product names in core types.

**Canonical TypeScript** is [`src/core/types.ts`](../src/core/types.ts). This file explains those contracts in words; do not treat a pasted snippet here as newer than the source.

---

## Stack

| Choice | Decision | Why |
|--------|----------|-----|
| Client | Vanilla TypeScript + Vite | One text/input surface; no UI framework |
| App host | TypeScript on Node, small `/api` router (no Express) | Same language and `RefreshResult` types as the apps |
| Where apps run | First-party `open` / `refresh` on the server | Proof of the intended split; large corpora stay off the client bundle |
| Client apps | Generic `createRemoteApp` stub, minted by app id | Not a phone book of first-party apps |
| Database | SQLite via `node:sqlite` (`server/sqlite.ts`) | Host identity in `data/nowisee.db`; each app opens `data/apps/*.db`. `:memory:` in tests |
| URL style | Hash routes behind `AppLocation` | Switching to History API later touches Router only |
| Copy | `clipboardText` on the result; Navigator writes | Apps must not think they own the clipboard |
| Identity | Host-layer service + Account app | See [`IDENTITY.md`](IDENTITY.md) |

### Layout

```text
src/core/         shell (navigator, display, …)
src/app-kit/      optional helpers apps import
src/apps/         AppModules (imported by the server host)
src/apps/remote.ts  client RPC stub
src/shell/        lazy generic stub by app id, mounts display, wires keyboard
server/           HTTP, host identity SQLite, identity service, first-party pack list
server/sqlite.ts  shared openSqlite helper (apps import this; not ctx.db)
server/index.ts   production entry (SPA + /api)
```

### Dev

`npm run dev` runs Vite plus `/api` middleware on the same origin, with SQLite and sessions.

`npm run preview` uses the same API plugin on the preview server.

`npm run build && npm start` has `server/index.ts` serve `dist/` and `/api` together. Vite `base` is `/`.

### Environment

See [`.env.example`](../.env.example). Production `npm start` and Vite grant lockbox/OAuth to apps that declare them, so they **do** need `NOWISEE_LOCKBOX_KEY`, `NOWISEE_ORIGIN`, and that app’s `NOWISEE_OAUTH_<APP>_CLIENT_*`. Tests leave those grant lists empty.

| Variable | Role |
|----------|------|
| `PORT` | Listen port (default `3000`) |
| `NOWISEE_DB` | Host SQLite file (default `data/nowisee.db`) |
| `NOWISEE_ORIGIN` | Public origin for CSRF and OAuth redirect URI |
| `NOWISEE_LOCKBOX_KEY` | 32-byte AES key, base64. Required if lockbox/OAuth apps are granted |
| `NOWISEE_LOCKBOX_KEY_ID` | Optional key id (default `v1`) |
| `NOWISEE_OAUTH_<APP>_CLIENT_ID` / `_CLIENT_SECRET` | Per-app OAuth client credentials. Not lockbox. `<APP>` is the app id, uppercased, non-alphanumerics → `_` |
| `NOWISEE_TLS_CERT` / `NOWISEE_TLS_KEY` | Optional PEM paths; both set enables HTTPS |

---

## Types (summary)

Full definitions live in [`src/core/types.ts`](../src/core/types.ts). The names below are the ones that show up in almost every conversation.

| Name | Role |
|------|------|
| `NavIntent` | `prev` / `next` / `enter` / `back`, plus app-defined symbolic intents |
| `NavEdge` | `node` (push/replace/pop), `app` (`AppLocation`), or `external` (`href`); optional `action`, `passInputText` |
| `NavigationMap` | Nested `fromNodeId → intent → edge` (no delimiter) |
| `NodePayload` | `id`, `label`, optional `kind` (`text` \| `input`), `secret`, `autocomplete`, `data` (`JsonValue`) |
| `AppLocation` | `{ appId, path }` with `path` starting `/`. Apps never build `#/…` strings |
| `RefreshExtras` | `inputText`, `action`, `signal` |
| `RefreshResult` | `navigationMap`, `warm`, `node`, `location` (or `null`), optional `clipboardText` |
| `AppModule` | `open(path, extras, ctx?)` and `refresh(stack, extras, ctx?)` |
| `AppServerContext` | Server-only: `userId`, `sessionId`, `accountAppId`, optional `identity` / `lockbox` / `oauth` / `directory` |
| `PlatformContext` | Client-only clipboard (and reserved `announce` / `requestRefresh`, not provided) |
| `ShellConfig` | `rootAppId`; optional `keyBindings` |

**Display** currently uses the input node’s `label` as the field value, and the accessible name for a generic input is `"Input"`. A later payload field could name the field without changing the value. Do not add that until a slice needs it.

---

## Action edges

Side effects are ordinary navigation — there is no `activate()` and no separate action edge *kind*. The app marks the **edge** that constitutes the button press; core reports that one traversal back to the app.

| Rule | Owner |
|------|-------|
| Mark the deliberate trigger with `action: true` on the edge | App |
| Set `extras.action = true` on exactly the call caused by traversing that edge | Core |
| Never set `extras.action` on bootstrap, revalidation, retry, replay, or any other call | Core |
| Never re-issue, retry, or abort an action call | Core |
| Never coalesce or drop an action call (read-only revalidations may be coalesced) | Core |
| Perform side effects only when `extras.action` is true; otherwise read-only | App |
| Resolve with a status node on failure rather than rejecting | App |

Sibling browsing uses `prev` / `next` (no flag). Background revalidation carries no flag. Returning to a status node later carries no flag. After the local move the tip is the status node, so a rapid double-press cannot re-fire the trigger. Status tips should return `location: null` so a reload does not land the user back on the action node.

---

## App boundary: data in, data out

`open` and `refresh` are a **message protocol**. First-party apps run on the server; the browser holds generic RPC stubs. Preserving the data-only property is what makes that split (and a later Worker or iframe) possible without changing the contract.

| Crossing the boundary | Rule |
|-----------------------|------|
| `stack`, `inputText`, `NodePayload`, `NavigationMap`, `RefreshResult`, `AppLocation` | **Plain data only.** Must survive being serialized and sent as a message. No functions, class instances, DOM nodes, or live references. |
| `AbortSignal` | Call mechanic, not payload. Core never aborts an action call. On the wire, abort cancels the HTTP request. |
| Anything else | Not permitted. Core hands apps no other live object; apps return no other live object. |

Consequences:

- Apps do not touch browser APIs that core can mediate. Copy text is `clipboardText` on the refresh result; core writes the clipboard.
- The registry hands Home `AppDescriptor[]`, never the `AppRegistry` object.
- `NodePayload.data` is typed as `JsonValue`.

This is a discipline, not a sandbox.

---

## Packaging

| Path | Contents |
|------|----------|
| `src/core/` | Types, router, navigator, stack, navigation-map store, NodeCache, display, keyboard, registry, platform capabilities |
| `src/app-kit/` | Optional helpers (edge builders, list edges, input edges, neighborhood walk, signed-out, split text) |
| `src/apps/` | First-party `AppModule`s. Graph/docs next to each app |
| `src/shell/` | Bootstrap: config, lazy generic RPC stub, mount display, wire keyboard |

**Smell test:** if a third-party app can work with only `open`/`refresh`, a helper belongs in app-kit or the app — not in core. If every session would break unless Navigator runs it, it belongs in core.

To add an app, implement `AppModule` and add a pack row in [`server/firstPartyApps.ts`](../server/firstPartyApps.ts). The client POSTs `/api/apps/:id/…` using that id; it does not keep a matching stub list. Home lists whatever the server registry exposes via `ctx.directory`.

---

## Core module contracts (summary)

See [`MODULES.md`](MODULES.md) for full behavior.

**Router** is a pure boundary: `parse` / `hrefFor` / `setAddressBar`, and `hashchange` → `openLocation`. It never owns stack, cache, map, or busy.

**Navigator** is the single owner of every state transition: stack, blocked, token, display, address bar, and clipboard fulfill. `onIntent` looks up the map. A warm hit paints locally then revalidates. A warm miss moves the stack, keeps the previous label, and blocks until refresh. Failure should leave last-good state (see MODULES).

**Display:** text tips use `role="application"`, remount, and focus, with no `aria-live`. Input tips use a textarea or password field plus Cancel/Done (click only). Hide NavPads while input is open.

**Keyboard** owns the physical → intent table. By default, plain arrows apply on text tips only.

**NavPads** deliver the same four intents on VoiceOver focus or click.

**NodeCache** stores warm payloads, pins stack ids, and clears on app switch.

**AppRegistry** has `register`, `get` (core-internal), and `listDescriptors` (host directory).

**Platform** owns the clipboard write for `clipboardText` during an action.

---

## Addressing (MVP)

Apps address `AppLocation`; core serializes. Hash routes are used today (`#/…`); a later History API change touches Router only.

The root app lives at `#/` (canonical). `#/<rootAppId>` may alias. Other apps are `#/<appId>/...` with an app-owned remainder. Status tips often return `location: null`.

---

## AppModule MUST / SHOULD

### MUST

1. Implement `open` and `refresh` returning a usable `node`, `navigationMap`, and `warm` array (possibly empty warm).
2. Publish a **`back`** edge from the app's root experience as `kind: "app"` to the root app.
3. On `pop` edges, omit `toNodeId`.
4. Not embed foreign apps' node ids in the navigation map (use `app` edges).
5. Not silently rewrite the stack to teleport the user after a workflow.
6. Perform side effects only when `extras.action` is true.
7. Not throw through to freeze core busy state—prefer status text on failure. This matters most for action calls.
8. Treat stack tip as possibly stale; return a valid fallback `node` when needed (repair, not teleport).
9. Author edges by intent only; never assume a keystroke.
10. Return plain data only — nothing that would fail to survive being sent as a message.
11. Return copy text as `clipboardText` on the refresh result when the user should copy; never call `navigator.clipboard`.

### SHOULD

1. Prefetch likely neighbors via map edges + warm.
2. Use app-kit helpers instead of copying edge boilerplate.
3. Put the effectful transition on an `enter` edge with `action: true`, landing on a status node.
4. Put instruction text on a normal node before an input node.
5. Return `location: null` for status tips that should not change the address bar.
6. Return stable canonical locations for bookmarkable tips.
7. Choose list-end behavior deliberately (wrap is optional).
8. Set `passInputText` on the commit edge leaving an input node.

---

## Testing contracts

Unit-test without the DOM where possible. The list below is the behavior to cover, not a second spec.

- Map lookup; push/replace/pop; pop omits toNodeId; `app` edge clears stack and switches app.
- Warm hit vs warm miss (block); refresh failure clears busy.
- Transition token: an A → B → A sequence discards the first A's in-flight result.
- A superseded read-only call receives an aborted signal; an action call never does.
- `extras.action` is set on exactly the traversal of an `action: true` edge, and on no other call.
- Walking the full sibling option list past an effectful node performs no effect.
- `passInputText` included only when flag set from input tip.
- Home lists apps as `app` edges; app root `back` opens the root app.
- Rebinding the keyboard table changes behavior with zero app changes.
- `Router.hrefFor(Router.parse(href))` round-trips; no other module emits a `#` string.
- Every `RefreshResult` an app returns survives a `structuredClone` round-trip.
- Copy with no device clipboard → Navigator shows “clipboard unavailable”; the app still only returned `clipboardText`.
- `listDescriptors()` returns descriptors; the registry object is not reachable from any app.
- App refresh: wrap-or-not is app-defined; action tip updates label in place without stack jump.
