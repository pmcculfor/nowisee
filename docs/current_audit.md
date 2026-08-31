# Nowisee — current audit (remaining work)

**Date:** 30 Aug 2026.

This file tracks what is still open after the documentation pass. It is not a third SPEC. The 24 Aug review is saved as [`original_audit.md`](original_audit.md).

Landed since the 25 Aug snapshot: first-party client stubs are generic; Bible view is one kind table; host `ephemeral` is an explicit flag; Navigator rejects a malformed `RefreshResult`; emailed sign-in codes replaced passwords (`adb3670`); user-facing product name is **Now I See** in Help, mail, and `NOWISEE_MAIL_FROM`. `Display.focus` and the CSRF-free `handleAppHttp` helper are gone. Static `decodeURIComponent` throws become 400; OAuth callback looks up sessions without minting; CSRF origin is only `NOWISEE_ORIGIN` (no Host fallback). Warm-miss refresh failure speaks recovery copy (`enter` retries, `back` restores).

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

- IDENTITY’s signed-out table still names Bible / Notes / Mail / Home as **examples** of different app policies, not as core locks.
- Spoken and mailed product name is **Now I See**; the repo and docs still say Nowisee.

---

## 2. Unused code and data

These items come from original §4. They are safe to delete only with the listed caveat. `IdentityService.changePassword` and `password_algo` are **gone** with emailed codes.

### Used by tests only

| Item | Production | Tests |
|------|------------|-------|
| `NotesStore.get` | View uses `list` / `create` / `update` only | Owner-isolation and “did not save” assertions |
| `GmailStore.getCached` | Inbox uses `listInbox` + client `cached` option | One owner-isolation assertion |
| `createAppHost` | Production uses `createNowiseeHost` | Shell / app-host tests inject it as `AppRpc` |
| `collectNeighborhood` | No app imports it | `tests/app-kit.test.ts` — seam, not dead |

`NotesStore.get` / `GmailStore.getCached` are complete-store methods the graphs never call. Keep them as a by-id lookup in the store API.

### Seams (do not delete as dead)

These exist on purpose: `announce` / `requestRefresh` (see PREPAREDNESS); `POST /oauth/:appId/events`; the Version `license` field; `commentary_xrefs` loaded and not shown in `commentaryLabel`; Keyboard constructor bindings (user remapping later reconstructs Keyboard or adds a setter); lockbox `missing-key` (thrown when a blob’s `keyId` is not in the env ring — multi-key rotation still deferred).

### Orphan / duplicate

| Item | Notes |
|------|--------|
| Account Settings node | Intentional stub |
| Spike copy under `public/spikes/` | For GitHub Pages |

---

## 3. Elegance / robustness

These are not bugs. They are worth doing when you are already in that file.

1. **Two app catalogs.** Done: the client no longer lists first-party apps. A generic stub POSTs `/api/apps/:id/…`; Home lists `ctx.directory` from the host pack.
2. **Bible view dispatcher.** Done: `view/kinds.ts` is one `kind → { addLevel, payload, version, location }` table.
3. **Gmail `view.ts`** (~580 lines). Leave as one file for now; split later if it grows.
4. **`collectNeighborhood` unused.** Keep as a seam; apps may use it later.
5. **Display is a DOM class.** Leave for now. Extract the three-method port before a native client.
6. **Account register-then-sign-in.** Done: emailed six-character codes (`adb3670`).
7. **Search tokenizer is ASCII-only.** Fine for current versions; the function is already the seam.
8. **Host `ephemeral`.** Done: `createNowiseeHost({ ephemeral })` is an explicit flag (default `true`). Production passes `false`. Do not infer from `typeof db`.

The status channel (busy, dead-end, and failure all silent) is deferred, not an elegance item — see [`PREPAREDNESS.md`](PREPAREDNESS.md). It is the deferred item that most affects real users.

---

## 4. Bugs

These are still open. They come from original §6.

| Pri | Issue | Where | Fix direction |
|-----|--------|--------|----------------|
| Low | API catch-all body `"Invalid JSON"` for any non-size error | `server/index.ts` / Vite `handleApi` | Distinct unexpected-failure label |
| Low | Commentary xrefs loaded, not shown in the label | Bible `commentaryLabel` | Append or stop loading |
| Low | NavPads hidden only by CSS (`data-input-open`) | Display / pads | Pads should ignore input tips in code too |

A few silences are specified, not regressions: failed open and warm-hit revalidation stay last-good with `console.warn`; a missing map edge is a silent no-op; Gmail new mail waits for the next intent because `requestRefresh` is not provided. Warm-miss failure speaks recovery copy.

---

## 5. Security

The trust model is sound: cookie → `userId`, CSRF, owner in queries, tokens not in `RefreshResult`. The residual gaps below come from original §7. Password hashing / `HashGate` / `password_algo` are gone with emailed codes. `requestSignIn` is throttled (`login_throttles`); verify has a max attempt count.

| Severity | Issue | Where |
|----------|--------|--------|
| Low | `AppNotFoundError` 404 includes the app id | `server/errors.ts` |
| Low | `external` hrefs not restricted to `http(s)` | Navigator |
| Low | Lockbox env loads **one** key; schema has `keyId` but old keys cannot be loaded → rotation incomplete | `lockbox/crypto.ts` |
| Low | Unauthenticated `POST /oauth/:appId/events`. No first-party handler (404). A future handler must authenticate inside the provider | `oauth/http.ts` |
| Info | Gmail `gmail.modify` is broad (intentional for send) | `gmail/oauth.ts` |
| Info | A new email that completes a code becomes an account (typos still create users when registration is open) | Account |
| Info | Client `fetch` relies on same-origin cookie default | `rpc.ts` |

Sign-in mail and per-session / per-email throttles landed with codes. There is still no IP lockout; that is the leftover of the old “no rate limit” row.

---

## 6. Suggested next code work

This is not an order you have to follow — just the highest-leverage leftovers.

1. Distinct unexpected-failure JSON from the `/api` catch-all (today every non-size error is `"Invalid JSON"`).
2. NavPads should ignore input tips in code, not only via CSS.

Leave until a named milestone: `requestRefresh`, the status channel, the Display port, a Facebook app, a third-party sandbox, and lockbox multi-key rotation.
