# Nowisee — Facebook app feasibility

**Researched:** August 2026 against Meta Graph API v26, Facebook Login, Pages API, Page Public Content Access, and Nowisee contracts in [`IDENTITY.md`](IDENTITY.md), [`STORAGE.md`](STORAGE.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), and [`PREPAREDNESS.md`](PREPAREDNESS.md).

**Question asked:** can we implement a Facebook app that, on enter, shows a feed of full post text, with comment and react on navigate-right? How do we get an app key, how do users authenticate, what does it cost, and what are the gotchas? Posting new stories is out of scope.

**Verdict:** the product described cannot be built on official APIs. Graph API calls cost $0; the blocker is permission, not price. A personal News Feed — posts from friends, Pages you follow, and groups, with comment and react as yourself — was removed in 2015 (`GET /me/home` and `read_stream`). There is no replacement. Meta also removed user-as-user publishing (`publish_actions`, 2018) and the entire Groups API (April 2024). Scraping facebook.com is a Platform Terms violation.

| | |
|---|---|
| Friends News Feed API | **No** |
| Graph API per-call cost | **$0** |
| User token lifetime | **~60 days** |
| App Review beyond `email` / `public_profile` | **Required** |

This file is research, not a build ticket. A reduced product (options B–E below) would still need a product lock before any graph work. If the goal is “use Facebook the way sighted people use the Facebook app,” Meta does not sell that API.

---

## What you asked vs what Meta allows

| Capability | On facebook.com | Graph API today | Nowisee implication |
|---|---|---|---|
| News Feed (friends + followed) | Yes | Removed 2015. `GET /me/home` and `read_stream` are gone. No replacement. | Cannot be this app’s home screen. |
| Your own timeline posts | Yes | `GET /me/posts` or `/me/feed` with `user_posts`. | Possible, but it is not other people’s posts. |
| Posts on Pages you manage | Yes | Pages API. This is the supported product. | Works if the user is a Page admin. |
| Public posts on Pages you do not manage | Yes | Page Public Content Access + App Review + business verification. | Read-only. Review is for research/display tools, not a Facebook clone. |
| Facebook Groups | Yes | Removed April 2024. No replacement. | Do not design around groups. |
| Comment / react as the person | Yes | Not available. Commenting as a User returns error 1705. User reactions died with `publish_actions` (2018). | Impossible on friends’ posts and on a personal timeline as yourself. |
| Comment / react as a Page | Yes, as the Page | `POST /{post-id}/comments` and likes with a Page token + `pages_manage_engagement`. | Only if the product is “manage my Page.” The author is the Page, not the person. |
| Read comments written by other people | Yes | Stripped unless those people authorized this app, or you moderate a Page you manage. | A comments branch on personal posts will often look empty. |
| Photos, Reels, Stories | Yes | No consumer Stories/Reels feed. Photos return URLs and optional alt text, rarely filled in. | Nowisee is one text surface. Image-first posts become caption + “photo” / link, or they are thin. |

---

## Viable product shapes

Pick one before any navigation design. Mixing them in one “Facebook” app will confuse App Review (each permission has a narrow allowed usage) and confuse users (a Page comment is not “you” commenting).

| Option | What the user actually gets | Auth and review | Recommendation |
|---|---|---|---|
| **A. Honest News Feed client** | Friends’ posts, comment, react — the Facebook home screen. | No API. Unofficial clients get shut off and violate Platform Terms. | **Reject.** |
| **B. My posts (personal archive)** | Posts this person published on their own profile. Full message text is usually present. | Facebook Login + `user_posts`. App Review. Allowed usage is scrapbooks/albums or parental monitoring — an accessibility reader is a stretch. | Only if you accept “your memories,” not “Facebook.” Review may refuse it. |
| **C. Pages I manage** | Feed of posts on Pages where the user is an admin. Comment and react as the Page. Later: publish as the Page. | Login for Business (or Login + Page permissions). `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`, `pages_manage_engagement`. App Review + usually business verification for Advanced Access. | Build this only if Page operators are the users. Best technical fit for comment/react. |
| **D. Public Pages I pick** | Read public Page posts (news, churches, governments). No friends. No commenting as the person. | PPCA feature. Business verification. App Review. You still need Page IDs. `user_likes` lists Pages the user liked, not their posts. | Best “reader” compromise if you drop in-app comment/react. |
| **E. External bounce** | A Nowisee node that says Facebook only exists on facebook.com. Enter is `kind: "external"`. | None. | Fallback if you will not ship a reduced product. |
| **F. Instagram or Threads instead** | Professional-account media and comments as that professional account. Still not a personal consumer feed. | Separate APIs, separate review, professional account required. | Do not fold into a Facebook app. |

**Closest honest shapes**, if a Facebook app is ever wanted, are **D** (read public Pages) or **C** (operate a Page). **B** is a side archive, not a social feed.

---

## Getting the app key from Meta

There is no purchase. Register a developer app at [developers.facebook.com](https://developers.facebook.com/). The App ID is public. The App Secret is a host secret. Never put the secret in the client bundle, in a `RefreshResult`, or in git.

| Step | What to do | Gotcha |
|---|---|---|
| 1. Developer account | Sign in with a personal Facebook account, accept platform terms, add a phone number if asked. | The Facebook user who creates the app becomes an admin. Use an account you will keep. |
| 2. Create app | Create App, then choose type. Consumer for personal Facebook Login (option B). Business for Pages / PPCA (C or D). | Type is hard to unwind. Do not pick Gaming or a Messenger bot. A Business app is the usual Pages path in the current use-cases dashboard. |
| 3. Add a use case | For B: Authenticate and request data from users with Facebook Login, then add `user_posts`. For C: Facebook Login for Business plus Pages permissions. For D: Page Public Content Access feature. | Do not request extra permissions “just in case.” Unused or unjustified scopes are a common review rejection. |
| 4. Copy credentials | Settings → Basic: App ID, App Secret. Store both in the host secrets capability under the Facebook app id. Read the secret per request; do not cache it forever. | Resetting the secret invalidates app-access tokens immediately. User tokens from the old secret also break; users must reconnect. |
| 5. Site + OAuth URLs | Set App Domains and Site URL to the Nowisee origin. Facebook Login → Valid OAuth Redirect URIs: exact callback **`https://example.com/oauth/callback`** (one host path for every OAuth app; dispatch by `state`). Enable Web OAuth Login. Enforce HTTPS in production. | Redirect URI is an exact string match (scheme, host, path, trailing slash). `localhost` is allowed in Development mode. Production must be HTTPS. A mismatch is a silent-looking Facebook error page. |
| 6. Legal URLs (required for Live) | Privacy Policy URL, User Data Deletion instructions or callback, Terms if you have them, Deauthorize callback URL. | Live mode will not stick without a privacy policy. The deletion callback is a public POST Meta can hit with no Nowisee cookie. |
| 7. Development vs Live | Development: only Roles (admin / developer / tester) can authorize. Add tester Facebook accounts. Live: anyone, but only Advanced Access permissions. | You can dogfood B/C against your own profile/Page without review. You cannot onboard real Nowisee users until Live plus Advanced Access for each permission. |
| 8. App Review + verification | Screencast of the real Nowisee flow, use-case text that matches Meta’s allowed usage, data-handling questions. Business verification for Advanced Access on most C/D permissions. | Reviewers walk the screencast with a test account. A text-only UI is unusual; make the screencast extremely literal. Allowed usage for `user_posts` does not mention accessibility clients — rejection is plausible. PPCA is closer to D. `pages_manage_engagement` is for Page moderation — C. |

Sources: Meta App Dashboard, [Facebook Login create-an-app](https://developers.facebook.com/docs/facebook-login/create-an-app), [Permissions Reference](https://developers.facebook.com/docs/permissions/) (`user_posts`, `pages_manage_engagement`, PPCA), [Access Levels](https://developers.facebook.com/docs/graph-api/overview/access-levels/) (Standard vs Advanced), App Review FAQs. Graph API version current in docs: v26.0.

---

## How users authenticate

Two identities, never mixed. Nowisee login proves who owns the lockbox slot. Facebook Login proves which Facebook account the app may call. Core stays unaware of both: the Facebook app returns ordinary nodes, plus one `kind: "external"` edge that leaves Nowisee for Facebook’s login page.

### First gate — Nowisee

Same as Notes. If `ctx.userId` is null, show a signed-out node, enter to Account, back to Home. The lockbox is keyed by `userId`; there is no anonymous Facebook token. Do not invent an anonymous user id.

### Second gate — Facebook

Signed in to Nowisee but no lockbox slot: “Connect Facebook.” Enter is an external edge to Meta’s OAuth dialog (it is facebook.com; a screen reader can use it). After consent, Meta redirects to a **host HTTP callback**, not to `open` / `refresh`.

### OAuth sequence (server-side code grant)

| Step | Who | What |
|---|---|---|
| Start | Facebook app | Build `https://www.facebook.com/{version}/dialog/oauth` with `client_id` (App ID), `redirect_uri` (registered callback), `scope` (exact permissions for the chosen option), `response_type=code`, and `state`. |
| `state` | Host + app | Bind `state` to the Nowisee session (`ctx.sessionId`), not a naked random in the URL. Store it server-side with expiry. Facebook will echo it back. This is CSRF protection for OAuth. |
| User at Facebook | Browser | `kind: "external"` navigates away. User signs into Facebook if needed, grants or skips scopes. Facebook may show 2FA, checkpoint, or CAPTCHA — those are Facebook pages; Nowisee cannot flatten them. |
| Callback GET | Host HTTP | `GET /oauth/callback?code=&state=`. SameSite=Lax session cookie is sent on this top-level GET, so we still know the Nowisee user. Validate `state`; reject missing or unknown state. Dispatch by `state`, not by app id in the path. |
| Exchange code | Server | Call `graph.facebook.com/{version}/oauth/access_token` with `client_id`, `client_secret` (from host secrets), `redirect_uri` (must match exactly), and `code`. Result: short-lived user token, about 1–2 hours. |
| Long-lived token | Server | Exchange with `fb_exchange_token` and the app secret. About 60 days. Store only in the lockbox keyed `(userId, facebook-app-id, slot)`. Never in `RefreshResult`. Optionally store `facebook_user_id` and expiry in the Facebook app’s own SQLite for deletion callbacks — not the token itself. |
| Inspect | Server | `debug_token` to confirm app id, user id, scopes actually granted (the user can skip optional scopes), and expiry. If `user_posts` was denied, do not pretend the feed works. |
| Return to Nowisee | Host | 302 to the SPA hash for the Facebook app (Router-owned URL). Next `open`/`refresh` reads the lockbox and builds the feed. |

**Tokens expire, and web Login does not auto-refresh.** Native Facebook SDKs refresh tokens when the user uses the app. Nowisee is a website using the manual flow, so we must extend a still-valid long-lived token ourselves (typically at most once a day). An expired token cannot be exchanged; the user must Connect Facebook again. Data access also expires after about 90 days of inactivity even if the token string looks fine — then we re-prompt for permissions. Unused permissions can expire after 90 days too. Product copy must treat reconnect as normal, not as a bug.

### Where secrets live (two stores)

| Secret | Store | Key | Why |
|---|---|---|---|
| Facebook App ID + App Secret | Host secrets capability (app credentials) | App id, not a user | Shared by every user of this Nowisee app. Needed to exchange codes and to decode `signed_request` on callbacks. |
| Per-user user/page access tokens | Host lockbox | `(userId, appId, slot)` | Decryptable credentials. [`IDENTITY.md`](IDENTITY.md) already specifies this. Do not put tokens in `facebook.db`. |
| `facebook_user_id` → Nowisee `userId` | Facebook app SQLite | `owner_id` from `ctx.userId` | Deauthorize and data-deletion callbacks have no Nowisee cookie. Look up the user by Facebook user id, then `lockbox.delete`. |

### Host HTTP that is not `open`/`refresh`

Facebook Login is the first confidential OAuth client. It forces a small host surface that apps do not have today.

| Route | Caller | Job |
|---|---|---|
| `GET /oauth/callback` | Facebook redirect (the user) | Finish the code grant, write lockbox, redirect into the SPA. One path for every OAuth app; dispatch by `state`. |
| `POST /oauth/:appId/events` | Facebook servers | Reserved for deauthorize / data-deletion. Parse `signed_request` with App Secret, drop lockbox slot and mapping row. No Facebook handler ships yet. |

Options for that surface:

| Option | Pros | Cons |
|---|---|---|
| Generic host OAuth helper | Gmail and X will need the same bounce. One CSRF state table, one redirect pattern, lockbox write in one place. | More design now. Must stay generic (provider id, redirect URI, token blob) and not learn Facebook graph paths. |
| Facebook-only routes in the host | Ships the first app faster. | Second OAuth app copies the same CSRF/cookie/redirect bugs. Host starts knowing Facebook. |
| App-owned HTTP mounted by the host | Facebook graph stays in the Facebook folder. | New app contract beyond `open`/`refresh`. Easy to leak secrets if the mount is too wide. |

**Recommendation (broker landed):** `GET /oauth/callback` plus `POST /oauth/:appId/events` for deauthorize/deletion, with the Facebook app supplying “exchange this code” and “this `signed_request` user id” via provider hooks. The host still owns cookies, CSRF state, and lockbox keys. The Facebook app still owns Graph API URLs. Do not add `/oauth/facebook/callback`.

---

## Comment and react

On a personal News Feed they are not available. The remaining options are product compromises, not API tricks.

| Approach | Works? | Notes |
|---|---|---|
| `POST /{id}/comments` as the User | No | Pages API docs: commenting as a User returns (#1705). `publish_actions` is gone. |
| `POST /{id}/likes` or reactions as the User | No | Same publishing deprecation. Like buttons on facebook.com are not an API we can call for friends’ posts. |
| Comment/react as a Page we manage | Yes | `pages_manage_engagement`. Author is the Page. Fits option C only. |
| Facebook Share / comment dialogs | Leaves Nowisee | Share Dialog is a Facebook-hosted UI. We do not get a friends feed to hang it on. An external edge “Comment on Facebook” per post is possible for option D if we have a permalink. |
| Copy permalink, comment later on facebook.com | Honest | `clipboardText` on an action, plus an external edge. Accessibility-acceptable, not in-app commenting. |

---

## Cost

| Item | Money | Time / friction |
|---|---|---|
| Graph API, Pages API, Facebook Login | $0 per call. No paid feed tier. | Rate limits: about 200 × daily active users calls per hour at the app level, plus an unpublished per-user cap. Header: `X-App-Usage`. Fine for a small accessibility product if we do not prefetch the world. |
| WhatsApp Cloud API | Pay per template message | Irrelevant unless you build WhatsApp. Do not confuse it with Facebook Login. |
| Marketing API | $0; ads spend is separate | Do not add. Wrong product. |
| Business verification | Free; needs a legal entity and documents | Days to weeks. Required for Advanced Access on the permissions C and D need. A hobby personal developer may not pass. |
| App Review | Free | Screencast plus written use case per permission. Often days; docs still warn it can take weeks. Annual Data Use Checkup after approval. Failed checkup suspends permissions. |
| Nowisee hosting | Whatever you already pay for HTTPS Node | OAuth and callbacks require a stable public origin. `localhost` is only for testers. Privacy policy must be a real URL. |
| Unofficial feed scrapers / RapidAPI wrappers | $0–$199/mo typical | Against Meta terms. They break without notice. Do not use. |

---

## Gotchas that are easy to miss

| Gotcha | Why it bites |
|---|---|
| News Feed is not `/me/feed` | `/me/feed` is the user’s profile wall (posts they made or that were posted on their profile), not the algorithm home screen. Naming the node “Feed” will be a lie if you ship B. |
| `user_posts` allowed usage is narrow | Meta’s documented allowed usage is scrapbooks/albums of your timeline, or parental monitoring of under-18s. “Make Facebook accessible” is morally right and off Meta’s script. Budget for rejection or a rewritten justification. |
| Other people’s comments are privacy-stripped | Graph will not return friends’ names and comment text on user posts unless those friends authorized this same app. A comments branch on option B will often be empty. Page moderation (C) is the exception. |
| Development mode hides the real permission story | Admins can grant `user_posts` without review. The first non-role user gets Standard Access only, which cannot request those permissions. Live + Advanced Access is a separate project from “it worked on my account.” |
| Partial grants | Users can skip optional permissions. The app must feature-detect granted scopes (`debug_token` or `/me/permissions`) and show a connect-again node, not crash or show an empty fake feed. |
| Page comments are not you | If you ship C, every comment is authored as the Page. Users who think they are posting as themselves will create public Page comments by accident. |
| Image-first Facebook | Many posts have empty `message` and a photo. Fields: `message`, `story`, `attachments` (description, title, unshimmed_url, media), `full_picture`. Alt text is uncommon. Speak “Photo. Caption: … Link: …” not a blank node. |
| 1 MiB refresh cap | Do not put 50 full posts plus comments in one warm set. Page of N posts, comments on enter, older-posts node for the next cursor. Store Graph cursors in node ids or app data, not in core. |
| No `requestRefresh` yet | [`PREPAREDNESS.md`](PREPAREDNESS.md) already flags this: the screen only changes on a user intent. A live social feed will feel stale until that capability exists. First slice can refetch on each open/enter; do not poll from the browser. |
| Do not cache Facebook bodies long-term | Platform terms: only use APIs, minimize retained Platform Data, delete on deauthorize/deletion callback. Prefer fetch-on-open. If you cache, TTL it and key by `owner_id`. |
| Owner in every query | Stack node ids will contain Graph post ids. The browser resends the stack. Resolve with `owner_id = ctx.userId` every time, same as Notes. See [`IDENTITY.md`](IDENTITY.md) §9. |
| One Facebook account, two Nowisee users | Decide uniqueness on `facebook_user_id`. Otherwise deletion callbacks and support get ambiguous. Prefer reject-and-explain if that Facebook user is already linked. |
| App Secret in the exchange URL | Only server-side. A client-side Facebook JS SDK login would put tokens in the page — forbidden by Nowisee’s app boundary. |
| Reviewer cannot use a screen reader assumption | They will keyboard through a tester account. The Connect Facebook external edge must be obvious in the screencast. Provide a tester Facebook user in the submission. |
| Platform policy vs unofficial clients | Automated collection outside Platform APIs is banned. A “we’ll just fetch facebook.com HTML” prototype is a ToS and ban risk, not a shortcut. |

---

## Nowisee wiring (once a product option is chosen)

Core unchanged. Facebook is an ordinary server `AppModule`: `open`/`refresh`, navigation map, warm nodes. Host grants lockbox (and secrets) to this app id the same way it grants identity only to Account. Home lists the registered label “Facebook”; it does not rename it to “Sign in.”

| Layer | Owns | Does not own |
|---|---|---|
| Core | Keys, stack, map, cache, external-edge navigation away from Nowisee, clipboard write from `clipboardText`. | Facebook, OAuth, tokens, 401, “signed in with Facebook.” |
| Host | CSRF/origin checks, session cookie, secrets for App Secret, lockbox, OAuth callback HTTP, deauthorize/deletion HTTP. | Graph URLs, feed shape, Page vs user product decisions. |
| Facebook app | Graph calls, node graph, wording, which scopes to request, mapping table, comment/react actions (if option C). | Cookie, App Secret storage, other apps’ catalogs. |
| App kit (optional) | Reuse `signedOut()` helper; maybe a generic “connect provider” node later. | Facebook-specific OAuth URLs as a core feature. |

Sketch of states, independent of exact keys: signed out → connect → (option B/C/D content) → disconnect. Root back is an `app` edge to Home. Side effects (comment as Page, disconnect, react as Page) only when `action: true`. Failed Graph calls become a status node, not a thrown 401.

---

## Work a reduced product would still need

Product option (B, C, D, or E) and review strategy would have to be chosen first. Graph work before that would be wasted.

| Slice | What it is | Depends on |
|---|---|---|
| 0. Product lock | Written choice: B, C, D, or E. Permissions list frozen. | This research. |
| 1. Meta app + secrets | Developer app, redirect URIs, privacy policy URL, App ID/Secret in host secrets. Testers on the Roles tab. | Public HTTPS origin for anything beyond localhost testers. |
| 2. Lockbox + OAuth bounce | **Landed** on the host ([`IDENTITY.md`](IDENTITY.md) §3). Remaining would be: grant this app id on `lockboxAppIds` / `oauthAppIds`, register the provider, long-lived token via `finalizeTokens`, reconnect node. | Slice 1. Signed-in Nowisee user. |
| 3. Deauthorize + data deletion | Public POSTs, mapping table, lockbox delete. Required before Live. | Slice 2. |
| 4. Read path | Graph client on the server, pagination cursors, text flattening for photos/links, signed-out and not-connected nodes, tests with recorded Graph fixtures (no live Facebook in CI). | Slice 2. Graph Explorer for fixture capture. |
| 5. Write path (C only) | Comment and react as Page on action edges. Stay on the node; refresh may update text in place. | Slice 4 plus `pages_manage_engagement` in Development. |
| 6. App Review | Screencast on a Live-like flow with a tester. Business verification if needed. Then open to real users. | Slices 3–5 actually working for a tester who is not you, if you can arrange that. |

---

## Open questions

These decide whether a reduced Facebook app is worth starting, more than navigation details do.

1. **Which product is actually acceptable?** If “friends’ News Feed + comment/react as me” is non-negotiable, the honest outcome is do not build a Facebook app (option E at most). If a reduced product is acceptable, is the user a Page operator (C), a reader of public Pages (D), or someone who wants their own archive (B)?

2. **Will you complete Meta business verification?** Advanced Access for Pages/PPCA usually needs a verified business, not only a personal Facebook account. Is Nowisee a legal entity with documents, or a personal project? That chooses C/D vs testers-only forever.

3. **Lockbox is landed.** [`IDENTITY.md`](IDENTITY.md) §3. App Secret stays in host env (`NOWISEE_OAUTH_FACEBOOK_CLIENT_SECRET`). Per-user tokens go in the lockbox. Remaining work is granting this app id and registering the Facebook provider — not building the vault.

4. **Public origin and privacy policy?** Live Facebook Login needs a stable HTTPS origin and a privacy policy URL that describes Facebook data use, retention, and deletion. Do those exist yet, or is this localhost-only until a later deploy slice?

5. **Comment/react: in-app or external?** For C, in-app as the Page is real. For D, the only ToS-legal “comment” is an external permalink or clipboard copy. For B, in-app comment/react as the person should be treated as impossible. Which of those are you willing to ship under the name Facebook?

6. **Generic OAuth host vs Facebook-only routes?** **Generic callback landed** (`GET /oauth/callback`; events at `POST /oauth/:appId/events`). Do not add Facebook-only OAuth routes.

7. **App Review justification for B.** If you pick B, do you want to argue accessibility as the use case knowing Meta’s written allowed usage is albums/parental monitoring? That is a product/legal call, not an engineering one. Do not spend a week on the graph until you are willing to lose that review.

8. **Photos and video.** How should a photo-only post be spoken? Caption plus “photo”? Skip posts with no message? Include the Facebook permalink as text? OCR is out of scope and would be a new capability.
