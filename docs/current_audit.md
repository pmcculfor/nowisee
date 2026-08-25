# Nowisee — current audit (remaining work)

**Date:** 25 Aug 2026.

This file tracks what is still open after the documentation pass. It is not a third SPEC. The 24 Aug review is saved as [`original_audit.md`](original_audit.md).

Tests and the live app were **not** re-run for this update. Unused-code, bug, and security items are carried forward from that original review unless a note says otherwise.

---

## 1. Documentation — done this pass

The owner-approved documentation work from [`original_audit.md`](original_audit.md) is applied. Do not treat the deleted files as live spec.

| Change | Where it lives now |
|--------|-------------------|
| Honest onboarding | [`../README.md`](../README.md), [`.env.example`](../.env.example) |
| SPEC matches shipped apps (Gmail + commentaries) | [`SPEC.md`](SPEC.md) |
| Stack / layout / env | [`ARCHITECTURE.md`](ARCHITECTURE.md) (ENGINEERING folded in, then deleted) |
| Core modules + how apps call core | [`MODULES.md`](MODULES.md) — no per-app graphs |
| Per-app graphs | `src/apps/<id>/README.md`, [`../src/apps/home.md`](../src/apps/home.md) |
| Bible as-built (not the ticket) | [`../src/apps/bible/README.md`](../src/apps/bible/README.md) + [`SOURCES.md`](../src/apps/bible/data/SOURCES.md) |
| Gmail as-built + research | [`../src/apps/gmail/README.md`](../src/apps/gmail/README.md) + [`RESEARCH.md`](../src/apps/gmail/RESEARCH.md) |
| Why / scale / leftover deferrals | [`PREPAREDNESS.md`](PREPAREDNESS.md) (status channel + deep-link ancestry moved here; no potential-apps table) |
| Spikes marked historical | [`../spikes/README.md`](../spikes/README.md) |
| Facebook research, not a build ticket | [`FACEBOOK.md`](FACEBOOK.md) |
| Agent rules | [`../AGENTS.md`](../AGENTS.md) — no MVP-apps lock row; no `kjv.json` pipeline; **do not drive the running app in a browser**; oddly specific product locks weeded (examples remain where they illustrate a rule) |

**Deleted:** `ENGINEERING.md`, `DESIGN-REVIEW.md`, `BIBLE-PLAN.md`, `docs/GMAIL.md`, `docs/AUDIT.md`.

A few leftover nits are intentional:

- [`SOURCES.md`](../src/apps/bible/data/SOURCES.md) still warns not to extend `prepare-kjv.mjs`. That warning belongs with the corpus, not in AGENTS.
- IDENTITY’s signed-out table still names Bible / Notes / Mail / Home as **examples** of different app policies, not as core locks.
- `tests/packaging.test.ts` still forbids the string `kjv.json` in bootstrap. That is a code test, not a documentation lock.

---

## 2. Unused code and data

These items come from original §4. They are safe to delete only with the listed caveat. None of this was done in the docs pass.

### Dead runtime path

| Item | Where | Notes |
|------|--------|--------|
| `kjv.json` | `src/apps/bible/data/kjv.json` | The importer never reads it. Delete it together with `scripts/prepare-kjv.mjs`. |
| `scripts/prepare-kjv.mjs` | `scripts/` | Brace-strip pipeline; corrupts supplied words. Not in `package.json`. |
| `displayedRef` | `src/apps/bible/ids.ts` | Exported, never imported |
| `canon.ts` `testamentLabel` | Bible | Re-export; callers import from `catalog.ts` |
| `BibleStore.listTestaments` / `verseCount` / `chapterVerseMax` | store | No product-graph caller. Wire `listTestaments` or delete. |
| Empty `if` in `collectNeighborhood` | `src/app-kit/neighborhood.ts` | Harmless leftover |
| `LockboxErrorCode "missing-key"` | `server/lockbox/errors.ts` | Nothing throws it |

### Used by tests only

| Item | Production | Tests |
|------|------------|-------|
| `NotesStore.get` | View never calls | Owner-isolation |
| `GmailStore.getCached` | Inbox uses `listInbox` | Owner-isolation |
| `IdentityService.changePassword` | Not on the capability; no Account screen | `tests/identity.test.ts` |
| `Keyboard.setBindings` | Bindings at construct | Unused even in tests |
| `Display.focus` | Must not be called after open (VoiceOver) | Unused as recovery API |
| `handleAppHttp` | Production uses `handleSessionHttp` | `tests/app-host.test.ts` — keep test-only |
| `createAppHost` | Production uses `createNowiseeHost` | Shell / app-host tests |
| `collectNeighborhood` | No app imports it | `tests/app-kit.test.ts` — seam, not dead |

Either keep the store getters as a complete API or have the views use them. `changePassword` should get an Account screen or stay until that screen exists.

### Seams (do not delete as dead)

These exist on purpose: `announce` / `requestRefresh` (see PREPAREDNESS); `POST /oauth/:appId/events`; the Version `license` field; `commentary_xrefs` loaded and not shown; the Keyboard remapping API. The `001`+`002` smash could also squash into one migration (in development there is no compatibility tax).

### Orphan / duplicate

| Item | Notes |
|------|--------|
| Account Settings node | Intentional stub |
| Commentaries listed from `COMMENTARY_RECORDS`, not the `commentaries` table | Pick one owner (see §3) |
| Client stubs in `bootstrap.ts` vs `FIRST_PARTY_APPS` | Must match by hand |
| Spike copy under `public/spikes/` | For GitHub Pages |

---

## 3. Elegance / robustness

These are not bugs. They are worth doing when you are already in that file.

1. **Two app catalogs.** `server/firstPartyApps.ts` and `src/shell/bootstrap.ts` both list apps. One pack description both can read, or a tiny client id list next to the pack, would be enough.
2. **Bible view dispatcher.** `buildBibleView`, `payloadFor`, `versionFor`, and `locationFor` all switch on `ParsedNode`. A single `kind → { addLevel, payload, version, location }` table would match how the catalogs already work.
3. **Gmail `view.ts`** (~580 lines). Split it the way Bible was split (`connect` / `inbox` / `compose` plus a dispatcher).
4. **Notes/Gmail dual memory + SQLite stores.** Prefer `:memory:` SQLite in tests (Bible’s pattern) so the two implementations cannot drift.
5. **Commentaries list vs DB.** The catalog owns listing, but the `commentaries` table is filled and unused for the list. Pick one owner.
6. **`listTestaments` vs `ROOT_ITEMS`.** The UI hardcodes OT and NT; the store method is unused.
7. **`collectNeighborhood` unused.** Use it, or stop advertising it in MODULES.
8. **No `RefreshResult` guard.** `createFetchRpc` casts JSON and `applyResult` assumes the shape. A cheap type guard before apply would help. Full validation waits for third-party apps ([`PREPAREDNESS.md`](PREPAREDNESS.md)).
9. **Display is a DOM class.** Extract the three-method port before a native client.
10. **Account register-then-sign-in.** A typo of a new email creates an account. That is a product choice; confirm it if you ever want a separate Register path.
11. **Search tokenizer is ASCII-only.** Fine for current versions; the function is already the seam.
12. **Packaging tests are substring checks.** They do not assert Vite’s client graph.
13. **Host `isEphemeral`.** A `Db` object is always treated as ephemeral (a tests-only footgun).
14. **Hardcoded `"kjv"` fallback** in `defaultVersionId()`. Last-ditch if `versions` is empty.

The status channel (busy, dead-end, and failure all silent) is deferred, not an elegance item — see [`PREPAREDNESS.md`](PREPAREDNESS.md). It is the deferred item that most affects real users.

---

## 4. Bugs

These are still open. They come from original §6.

| Pri | Issue | Where | Fix direction |
|-----|--------|--------|----------------|
| High | Warm-miss + failed refresh leaves stack on the new id while map/display stay last-good. Further intents miss → silent no-op. Failure test does not assert tip id. | `Navigator.followNodeEdge` / `startCall` catch | Roll back stack (and cache pin) on failure, or refresh before committing the miss move |
| Medium | `decodeURIComponent` on static paths can throw | `server/index.ts` `serveStatic` | Catch → 400 |
| Medium | OAuth callback: expired cookie → `identity.resolve` mints a session and never `Set-Cookie` | `handleOAuthHttp` | Do not mint on the callback; look up without minting |
| Low | API catch-all body `"Invalid JSON"` for any non-size error | `server/index.ts` / Vite `handleApi` | Distinct unexpected-failure label |
| Low | Help / `index.html` say “Now I See.”; docs say Nowisee | Help welcome, title | Pick one |
| Low | Commentary xrefs loaded, not shown in the label | Bible `commentaryLabel` | Append or stop loading |
| Low | NavPads hidden only by CSS (`data-input-open`) | Display / pads | Pads should ignore input tips in code too |

A few silences are specified, not regressions: failed open/refresh is `console.warn` only; a missing map edge is a silent no-op; Gmail new mail waits for the next intent because `requestRefresh` is not provided.

---

## 5. Security

The trust model is sound: cookie → `userId`, CSRF, owner in queries, tokens not in `RefreshResult`. The residual gaps below come from original §7.

| Severity | Issue | Where |
|----------|--------|--------|
| Medium | No rate limit / lockout on register and sign-in. Scrypt + `HashGate(2)` still allows CPU/memory pressure via `/api` | identity + host HTTP |
| Medium | CSRF origin falls back to `Host` + `X-Forwarded-Proto` when `NOWISEE_ORIGIN` is unset (spoofable behind a bad proxy). Production OAuth requires configured origin | `csrf.ts` |
| Medium | `handleAppHttp` skips CSRF and cookies — test-only; do not bind to a public listener | `server/http.ts` |
| Medium | OAuth callback mint-without-Set-Cookie (same as bug §4) | `oauth/http.ts` |
| Low | `AppNotFoundError` 404 includes the app id | `server/errors.ts` |
| Low | `external` hrefs not restricted to `http(s)` | Navigator |
| Low | Lockbox env loads **one** key; schema has `keyId` but old keys cannot be loaded → rotation incomplete | `lockbox/crypto.ts` |
| Low | `password_algo` column stored, never consulted | identity schema |
| Low | Unauthenticated `POST /oauth/:appId/events`. No first-party handler (404). A future handler must authenticate inside the provider | `oauth/http.ts` |
| Info | Gmail `gmail.modify` is broad (intentional for send) | `gmail/oauth.ts` |
| Info | Register-then-sign-in can create accounts from email typos | Account |
| Info | Client `fetch` relies on same-origin cookie default | `rpc.ts` |

---

## 6. Suggested next code work

This is not an order you have to follow — just the highest-leverage leftovers.

1. Warm-miss refresh failure: roll back the stack.
2. OAuth callback: do not mint a session without `Set-Cookie`.
3. Catch `serveStatic` `decodeURIComponent` throws.
4. Delete `kjv.json` and `prepare-kjv.mjs` together.
5. One app catalog for host and client stubs.
6. Rate-limit identity mutations, and always set `NOWISEE_ORIGIN` in deploy.

Leave until a named milestone: `requestRefresh`, the status channel, the Display port, a Facebook app, a third-party sandbox, and lockbox multi-key rotation.
