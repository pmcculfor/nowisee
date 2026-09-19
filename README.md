# Nowisee

Nowisee is an accessibility-first website for people who use a keyboard or a screen reader as their primary way to browse. The page shows **one unformatted text surface** at a time. Navigation uses four intents — `prev`, `next`, `enter`, and `back` — which core binds to keys and to VoiceOver edge pads. Content comes from portable **apps** (Home, Tutorial, Bible, Notes, Lists, Weather, Gmail, and Account, plus a Recents switcher that Home does not list). Core is a generic shell and never special-cases those products.

## Run

You need Node 22. There are no runtime npm dependencies.

```bash
npm ci
npm test
npm run build
npm start            # host only — serves dist/ and /api; does not start apps
```

Nowisee runs only on a server. There is no local-machine mode: `npm start` reads everything from the environment and refuses to boot if a required value is missing. Develop against the staging host, **https://dev.nowisee.app**.

The public origin is **https://nowisee.app**. Staging on the same droplet is **https://dev.nowisee.app**. Droplet pull/restart: [`deploy/README.md`](deploy/README.md).

The running host grants Gmail lockbox and OAuth from `app_catalog`, so that path **does** need `NOWISEE_LOCKBOX_KEY`, `NOWISEE_LOCKBOX_KEY_ID`, `NOWISEE_ORIGIN`, `NOWISEE_HOST_SIGNING_KEY`, `NOWISEE_CAPABILITY_LISTEN`, and `NOWISEE_OAUTH_GMAIL_CLIENT_ID` / `_CLIENT_SECRET` on the **host**. Sign-in codes need `NOWISEE_MAIL_FROM`, `NOWISEE_RESEND_API_KEY`, and `NOWISEE_OTP_PEPPER`.

**Production env:** Node does not read `.env` files. Put host secrets in `/etc/nowisee/host/nowisee.env` (mode `640`, `root:nowisee-host`) from [`.env.production.example`](.env.production.example). App env files: [`deploy/app.env.example`](deploy/app.env.example). Staging uses `/etc/nowisee-dev/host/nowisee.env` and [`deploy/nowisee-dev.target`](deploy/nowisee-dev.target). The host unit loads `EnvironmentFile=` — do not paste keys into the unit. OAuth redirect: `{NOWISEE_ORIGIN}/oauth/callback`. If a reverse proxy terminates TLS, leave `NOWISEE_TLS_*` unset. Production listens on `PORT=3000`; staging on `3001`.

On a text node, Up/Down move prev/next, Right enters, and Left goes back. On an input node, type in the field (Enter inserts a newline); **Done** commits and **Cancel** abandons. Tab and Escape are unbound.

## Layout

```text
src/core/       client shell (navigator, display, keyboard, …)
src/app-kit/    optional graph helpers apps import
src/node-kit/   shared Node: sqlite, serveApp, signed ctx
src/host/       HTTP broker, CSRF, identity, lockbox, OAuth, app_catalog
src/apps/       Home, Recents, Tutorial, Bible, Notes, Lists, Weather, Gmail, Account (`main.ts` per app)
src/shell/      browser bootstrap — remote stubs only
ios/            Swift client (Navigator + URLSession; build on a Mac; see ios/README.md)
tests/          Vitest, node environment; `fixtures/navigator/` is shared with `swift test`
```

Each app’s graph, data, and corpus notes live next to that app (`src/apps/<id>/README.md`).

## Docs

| File | Role |
|------|------|
| [`AGENTS.md`](AGENTS.md) | Binding rules and locks for contributors and agents |
| [`docs/SPEC.md`](docs/SPEC.md) | Product: what this is and why |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Contracts, packaging, and stack |
| [`docs/MODULES.md`](docs/MODULES.md) | Core module behavior and the app ↔ core interface |
| [`docs/STORAGE.md`](docs/STORAGE.md) | Who opens which database |
| [`docs/IDENTITY.md`](docs/IDENTITY.md) | Sessions, CSRF, lockbox, and OAuth |
| [`docs/PREPAREDNESS.md`](docs/PREPAREDNESS.md) | Why this architecture, how it scales, and what is still deferred |
| [`deploy/README.md`](deploy/README.md) | DigitalOcean droplet: prod + staging pull, build, restart |
| [`spikes/`](spikes/) | Historical accessibility probes (not application code) |
