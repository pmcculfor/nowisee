# Account (`id: "account"`)

Account is an ordinary `AppModule`. Credentials and sessions are **not** here — they live in `server/identity/`. This app receives `ctx.identity` only because the host grants that capability to this app id. Flow email is stored against `sessionId` in `account_flow`, never in a node id, label, or URL.

Code: [`index.ts`](index.ts), [`view.ts`](view.ts), [`store.ts`](store.ts). Identity contract: [`docs/IDENTITY.md`](../../../docs/IDENTITY.md). Tests: [`tests/account.test.ts`](../../../tests/account.test.ts).

## Signed out

The tip is **Sign in or register**. `enter` goes to an email prompt, then an email input (`autocomplete=username`). Email Done (`action` plus `passInputText`) goes to a password prompt, then a password input (`secret`, `autocomplete=current-password`). Password Done (`action` plus `passInputText`) shows a warm **Signing in…** node, then either **You are signed in as …** (enter/back go to Home) or **Sign-in was unsuccessful.** (enter/back `pop` to the same password input).

Authenticate tries register, then sign-in when the email is already taken. Root `back` goes to Home.

## Signed in

The tip is **Settings** (a placeholder with no enter). `next` is **Sign out**. Sign-out `enter` is `action: true` into a status node; after the action, enter and back are `app` edges to Home, which clears the client cache.

Home lists this app as **Account**, the same registered label as every other app, whether the user is signed in or out.

Status nodes return `location: null`. The password arrives in `extras.inputText` on the action call. The host never logs `/api` request bodies.
