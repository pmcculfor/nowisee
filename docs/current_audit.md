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
3. Review the fallbacks in §7 — keep the ones that are product policy, delete the ones that hide mistakes.

Leave until a named milestone: `requestRefresh`, the status channel, the Display port, a Facebook app, a third-party sandbox, and lockbox multi-key rotation.

---

## 7. Fallbacks and two-mode functions

A pass over `src/` and `server/` (not tests). A **fallback** is: the preferred thing is missing or invalid, so the code uses a substitute instead of failing. A **two-mode function** is the same entry point behaving differently based on a flag or env.

This is an inventory, not a verdict. Several of these are locks (corrupt URL → Home, `kind` omitted → text, `location: null` keeps the bar). Others are convenience that can hide a misconfiguration.

CSRF origin no longer falls back to `Host` / `X-Forwarded-Proto`. Unset `NOWISEE_ORIGIN` fails every Origin check.

### Core and shell

**Unknown or corrupt address → Home.** Router `parse` turns an empty, malformed, or non-id hash into `{ rootAppId, "/" }`. Navigator `openLocation` does the same when the registry (and `resolveApp`) have no module: it opens Home at `/`. If we remove this, a typo in the hash or a bad `app` edge would no-op or crash instead of landing on Home. The well-formed-unknown-id path (POST and let the server 404) stays; this fallback is only for junk ids and missing modules.

**Pop on the last stack entry → open Home.** Spec recovery for a buggy app `pop` at the root. If we remove it, that Back would throw or leave the user nowhere.

**Missing `node.kind` → `"text"`.** Display and keyboard assume a kind. If we require the field, every payload must set it; omitting it would break rendering and arrow bindings.

**`location: null` keeps the previous address.** Specified for status tips. If we stop treating null as “keep,” status nodes would rewrite the hash (and a reload could re-enter an action).

**Warm miss vs warm hit.** Same `followNodeEdge`: cache hit paints now and revalidates; miss moves the stack, keeps the old label, blocks, then refreshes (failure speaks recovery copy). These are two modes of one function, not a silent substitute. Deleting either mode is a product change.

**Unknown app stub.** Bootstrap `resolveApp` mints a generic RPC module so the client is not a second catalog. If we remove it, a deep link to an app this tab has never opened would fall through to Home instead of POSTing.

**External edge handler.** Navigator defaults to `location.href = href` if nothing is injected. Tests inject a logger. If we remove the default, production `kind: "external"` (OAuth start) would no-op unless bootstrap always passed a handler.

**Copy: delayed clipboard vs immediate `writeText`.** Platform prefers the Chrome/Safari delayed `ClipboardItem` path so the write starts in the keydown. If that API is missing, it falls back to `writeText` when the app returns `clipboardText`. If the write cannot run, the tip label becomes “Copy failed…”. Removing the immediate path would break copy on browsers without delayed ClipboardItem. Removing the status labels would leave copy failures silent.

**Input autocomplete.** Secret fields default to `current-password`; other inputs to `off`. If we require the app to always set `autocomplete`, a missing flag would be a blank or browser-guessed token.

**Shell defaults.** `rootAppId` defaults to `"home"`; keyboard bindings default to the arrow table; RPC defaults to `createFetchRpc`. If we require them at the call site, bootstrap and tests must always pass them; production behavior need not change.

**Router / Keyboard injects** (`location`, `eventTarget`, `isKnownApp`, bindings). Production uses `window` and `isAppId`. If we delete the defaults, only tests break unless every constructor is explicit.

### Host, identity, HTTP

**`createNowiseeHost({ ephemeral })`.** Default `true`: in-memory identity DB if unset, pack apps on `:memory:`, silent mailer, fixed DEV OTP pepper, empty lockbox/OAuth grants. `false` (production and Vite): files, env mailer, env pepper, grants from the pack. If we drop the ephemeral mode, tests would need real files and env. If we drop the production mode, Gmail OAuth and sign-in mail would not run. If we change the default to `false`, a forgotten flag in tests would hit disk and try env.

**Mail driver.** Unset `NOWISEE_MAIL_DRIVER` means `console`, and that driver is only allowed when origin is localhost. **Unset origin is treated as local**, so console mailer is allowed when `NOWISEE_ORIGIN` is missing. If we delete that “unset = local” branch, a host without origin could not use console mail (CSRF would already be failing). If we require the driver env always, local boot without `.env` would throw.

**OTP pepper.** Resend requires `NOWISEE_OTP_PEPPER`. Console/local may use `DEV_OTP_PEPPER`. If we remove the dev pepper, every local identity host needs the env var.

**`identity.resolve` vs `lookup`.** `resolve` (every `/api` call) mints an anonymous session when the cookie is missing or dead. `lookup` (OAuth callback) never mints. If we only had `resolve` on the callback, we would mint without `Set-Cookie` again. If we stopped minting on `/api`, the first visit would have no session until some other path created one.

**Registration open vs closed.** `allowRegistration` defaults to on. Closed mode still returns “ok” for unknown emails (no mail) so the app cannot probe who exists. If we remove the default, every host must pass the flag. If we remove closed mode, invite-only deploys cannot exist.

**Sign-in mail `catch`.** A send failure deletes the challenge and logs; the capability still returns ok. If we let the error through, the Account app would see a thrown refresh instead of the usual “check your mail” node.

**OAuth return path.** Missing or `"/"` becomes `/{appId}`. If we reject instead, Connect with no return path would fail the start.

**Corrupt lockbox token JSON.** Treated as needs-reconnect rather than a throw. If we throw, a bad row would 500 the refresh instead of the reconnect node.

**Lockbox key id.** Unset `NOWISEE_LOCKBOX_KEY_ID` is `"v1"`. If we require it, env must always set the id even with one key.

**OAuth callback with no live session.** Empty `sessionId` / null `userId` (same as no cookie). If we mint here, we reintroduce the orphan-row bug.

**Listen defaults.** `PORT` 3000, `NOWISEE_DB` `data/nowisee.db`, Vite DB the same. If we require env, `npm start` / `npm run dev` without those vars would not listen.

**Static files.** Directory URL serves `index.html`. Unknown extension is `application/octet-stream`. If we remove those, `/` might 404 and odd assets might have no Content-Type.

**`decodeAppId`.** A broken `%` sequence keeps the raw string instead of 400. Static files already 400 on the same class of error. If we 400 here too, a bad app id in the URL would not reach the app as a literal.

**`/api` catch-all.** Any non-size exception becomes 400 `"Invalid JSON"`. Already a listed bug. If we split it, parse errors and unexpected throws would be distinguishable.

**In-process `dispatch`.** Missing `path` → `"/"`; missing `stack` → `[]`. If we reject, a buggy caller would 400 instead of opening the app root.

**In-process missing `ctx`.** Host calls `identity.resolve(null)` and mints. If we require ctx, tests that call `host.open` without HTTP would have to mint a session first.

### Apps

**`ctx.accountAppId` missing → `rootAppId`.** Bible, Notes, and Gmail use this for the signed-out “sign in” edge. If we require the host to always grant `accountAppId`, a missing grant would be a crash instead of a Back-to-Home edge. If the fallback stays, a mis-packed host silently sends people to Home instead of Account.

**Home directory missing → empty list.** Home still shows a synthetic root. If we throw, a host that forgot `ctx.directory` would 500 Home.

**Stale tip id → first / start / welcome / create.** Home, Help, Account, Notes, Gmail, and Bible rebuild or pick a default tip when the requested id is not in this result. That is “repair, not teleport” (MUST #8). If we fail instead, a deleted note, old mail id, or bad Help hash would error the refresh rather than show a live node.

**Empty Notes → create node.** Open, unknown path, and empty-stack refresh all land on create. If we show an empty-list node instead, there is no current “no notes” screen. If we throw, first use would fail.

**Empty Gmail inbox → compose.** Same idea. If we remove it, an empty inbox would have no tip.

**Blank Gmail subject → “No subject”; empty body → “Empty message”; blank note → “Empty note”.** If we speak nothing, list rows would be silent. If we drop the mail, we would skip those messages.

**Gmail HTML-only MIME → strip tags / empty.** If we only accept `text/plain`, HTML-only mail would have no body node.

**Gmail send/profile errors → status or reconnect nodes, not throws.** If we throw, a Google 401 would freeze or hit load recovery instead of the app’s reconnect graph.

**Bible version: path, then user pref, then first row by sort order.** If we drop the first-row default, a user with no pref and a version-less URL would get the empty-data node even when versions exist.

**Bible book label: that version’s name, then canon label, then the id.** If we only use the store, a book missing from a version would speak a raw id (or blank).

**Bible `displayedVerse`.** Clamp into the chapter; if clamp fails, keep the original numbers. If we only clamp, a missing book/chapter would have no verse payload. If we never clamp, a too-large verse number would miss the row.

**Bible path parse.** Bad version/book/chapter/verse walks back to the first root tip or empty-data, not a throw. If we 404 inside the app, a truncated share link would fail open.

**Bible empty catalog → `bible:empty`.** If we remove it, an unseeded DB would crash root open.

**Bible commentary chunk index out of range → first chunk.** If we drop it, a stale chunk id would blank the tip.

**Bible in-memory seed.** `:memory:` without an explicit seed loads `MEMORY_SEED` (includes KJV). File DBs do not auto-seed. If we stop auto-seeding memory, ephemeral Bible tests and empty-memory hosts would show empty-data unless they pass seed. If we seed files too, production would rewrite the corpus on boot.

**App DB paths.** Each app defaults `dbPath` to its `data/apps/*.db` (or `:memory:` from the pack when ephemeral). If we require the path always, the pack must always pass it (it already does when ephemeral).

### App kit

**Node / input edges default `stackBehavior` to `push`.** If we require it on every helper call, omitted behavior would be a type error instead of a silent push.

**Input Cancel: `pop` vs replace-to a node.** Two modes of `backTo`. Deleting one would force every input to cancel the same way.

**Signed-out helper** is a chosen graph, not a fallback. Callers still fall back `accountAppId` → `rootAppId` before they call it (see above).

### Display two-mode (not a fallback)

**Text vs input vs secret.** `showText` vs textarea vs `type="password"`. Keyboard arrows bind only on text tips. Deleting a mode is a product change (no OTP field, or arrows captured by the caret).

