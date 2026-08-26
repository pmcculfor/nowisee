# Nowisee

Nowisee is an accessibility-first website for people who use a keyboard or a screen reader as their primary way to browse. The page shows **one unformatted text surface** at a time. Navigation uses four intents — `prev`, `next`, `enter`, and `back` — which core binds to keys and to VoiceOver edge pads. Content comes from portable **apps** (Home, Help, Bible, Notes, Gmail, and Account). Core is a generic shell and never special-cases those products.

## Run

You need Node 22. There are no runtime npm dependencies.

```bash
npm ci
npm test
npm run dev          # http://localhost:5173/  (Vite + same-origin /api)
```

For production, `npm run build && npm start` serves `dist/` and `/api` together. The public origin is **https://nowisee.app**. Droplet pull/restart: [`deploy/README.md`](deploy/README.md).

Copy [`.env.example`](.env.example) to `.env` for local Vite (`npm run dev` loads it). Tests use in-memory SQLite and need no secrets. The running host grants Gmail lockbox and OAuth, so that path **does** need `NOWISEE_LOCKBOX_KEY`, `NOWISEE_ORIGIN`, and `NOWISEE_OAUTH_GMAIL_CLIENT_ID` / `_CLIENT_SECRET`. Sign-in codes on a non-localhost origin also need Resend vars.

**Production env:** Node does not read `.env` files. Put secrets in `/etc/nowisee/nowisee.env` (mode `640`, `root:nowisee`) from [`.env.production.example`](.env.production.example). The unit [`deploy/nowisee.service`](deploy/nowisee.service) loads that file with `EnvironmentFile=` — do not paste keys into the unit. OAuth redirect: `https://nowisee.app/oauth/callback`. If a reverse proxy terminates TLS, leave `NOWISEE_TLS_*` unset and keep `PORT=3000`.

On a text node, Up/Down move prev/next, Right enters, and Left goes back. On an input node, type in the field (Enter inserts a newline); **Done** commits and **Cancel** abandons. Tab and Escape are unbound.

## Layout

```text
src/core/       client shell (navigator, display, keyboard, …)
src/app-kit/    optional helpers apps import
src/apps/       Home, Help, Bible, Notes, Gmail, Account (server AppModules)
src/shell/      browser bootstrap — remote stubs only
server/         HTTP, CSRF, identity, lockbox, OAuth; packs first-party apps
tests/          Vitest, node environment
```

Each app’s graph, data, and corpus notes live next to that app (`src/apps/<id>/README.md`, or `src/apps/home.md` for Home).

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
| [`docs/FACEBOOK.md`](docs/FACEBOOK.md) | Research: Meta has no friends News Feed API |
| [`docs/current_audit.md`](docs/current_audit.md) | Remaining non-doc work (unused code, bugs, security) |
| [`docs/original_audit.md`](docs/original_audit.md) | Snapshot of the 24 Aug 2026 review |
| [`deploy/README.md`](deploy/README.md) | DigitalOcean droplet: pull, build, restart |
| [`spikes/`](spikes/) | Historical accessibility probes (not application code) |
