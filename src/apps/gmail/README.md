# Gmail (`id: "gmail"`)

Gmail is an ordinary server `AppModule`. Gmail REST and MIME parsing live in this app. Tokens come through `ctx.oauth` (the host lockbox). Inbox cache and compose drafts live in `data/apps/gmail.db`. Tokens never go in that file or in a `RefreshResult`.

Code: [`index.ts`](index.ts), [`view.ts`](view.ts), [`store.ts`](store.ts), [`gmailClient.ts`](gmailClient.ts), [`mime.ts`](mime.ts), [`oauth.ts`](oauth.ts). Tests: [`tests/gmail.test.ts`](../../../tests/gmail.test.ts). Google Cloud and verification research: [`RESEARCH.md`](RESEARCH.md).

On the running host this app needs `NOWISEE_LOCKBOX_KEY`, `NOWISEE_OAUTH_GMAIL_CLIENT_ID`, `NOWISEE_OAUTH_GMAIL_CLIENT_SECRET`, and `NOWISEE_ORIGIN`. The OAuth redirect is `{origin}/oauth/callback`. See [`.env.example`](../../../.env.example).

Version 1 covers inbox subjects, body chunks, compose/send, and connect/disconnect. It does not include reply or forward. New mail appears on the next intent, because `requestRefresh` is not provided.

## Signed out

When `ctx.userId` is null, the tip is **Sign in to use Gmail.** `enter` goes to Account. `back` goes to Home.

## Signed in, not connected

The tip is **Connect Gmail.** `enter` is `kind: "external"` to Google’s authorize URL (`ctx.oauth.start`). `back` goes to Home. After Google redirects to `GET /oauth/callback`, the host stores the refresh token and 302s to `/#/gmail`.

## Connected

Open `/` lands on the first inbox subject, or on **Compose** if the inbox is empty. The list is Disconnect, Compose, then up to 20 INBOX subjects (no wrap). Root `back` goes to Home.

Enter on a subject **pushes** body chunk 1 (plain text, split by `splitText`). Chunks are siblings. `back` pops.

Compose walks an instruction node, then input for To, Subject, and Body (`action` plus `passInputText` on each Done). Send stays on **Sent** or an error in place — there is **no stack teleport**. Cancel walks back without sending.

Disconnect is `action: true`: `ctx.oauth.disconnect`, clear the cache, then **Gmail disconnected.** `invalid_grant` or unauthorized returns the Connect node. Side effects run only when `extras.action` is true.

Ownership: this `userId` → `getAccessToken` → `users/me`. Message ids on the stack are untrusted.

The requested scope is `gmail.modify` (restricted). Prefer `text/plain` in MIME. HTML is a conservative tag strip for reading; Display then uses `textContent`.
