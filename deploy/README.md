# Production host (DigitalOcean)

The droplet `nowisee-prod-00` runs a **host** plus **one process per app**. Caddy terminates TLS and proxies only the host public port. systemd runs Node; secrets live under `/etc/nowisee/`, not in git.

| Origin | Checkout | Target | Host env | Host port | Cap port |
|--------|----------|--------|----------|-----------|----------|
| https://nowisee.app | `/var/www/nowisee` | [`nowisee.target`](nowisee.target) | `/etc/nowisee/nowisee.env` from [`.env.production.example`](../.env.production.example) | `127.0.0.1:3000` | `127.0.0.1:3020` |
| https://dev.nowisee.app | `/var/www/nowisee-dev` | [`nowisee-dev.target`](nowisee-dev.target) | `/etc/nowisee/nowisee-dev.env` from [`.env.staging.example`](../.env.staging.example) | `127.0.0.1:3001` | `127.0.0.1:3021` |

Users: `nowisee-host` runs the broker; `nowisee-notes`, `nowisee-gmail`, … run apps (`User=nowisee-%i` in [`nowisee-app@.service`](nowisee-app@.service)). A shared `nowisee` group can read the git tree. App SQLite files are `data/apps/*.db` under that process’s working directory — `600` the app user. Host `data/nowisee.db` is `600` `nowisee-host`. Do not share `data/`, `NOWISEE_DB`, `NOWISEE_LOCKBOX_KEY`, `NOWISEE_HOST_SIGNING_KEY`, or `NOWISEE_OTP_PEPPER` across prod and staging. App env files (`/etc/nowisee/apps/<id>.env`, template [`app.env.example`](app.env.example)) get the **public** signing key and capability URL, never the lockbox or OTP secrets.

App listen ports (loopback, not in Caddy): prod `3110`–`3118`, staging `3210`–`3218` (Home, Recents, Tutorial, Bible, Notes, Lists, Weather, Gmail, Account). Staging `app_catalog.locator` rows must match those ports — after first migrate, `UPDATE app_catalog SET locator = 'http://127.0.0.1:' \|\| (3210 + sort_order)`.

The `__Host-` session cookie and CSRF `NOWISEE_ORIGIN` check isolate the two hostnames.

## After a push to `main`

SSH in (usually as root) and:

```bash
sudo -u nowisee-host -H bash -lc 'cd /var/www/nowisee && git pull && npm ci && npm run build'
sudo systemctl restart nowisee.target
```

Restart `nowisee.target` for a repo-wide pull (especially wire/signing/capability APIs). Restart a single `nowisee-app@notes` only for a Notes-only change on an unchanged contract.

Leave `data/` alone. Do not run `npm audit fix` on the droplet; fix advisories in git and pull.

`npm ci` / `npm run build` need Vite. Do not export `NODE_ENV=production` in that shell — the unit sets it for the running process only. A staging build on this droplet can spike CPU; prefer a quiet moment.

Confirm:

```bash
systemctl status nowisee.target --no-pager
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/
```

You want `active` and `200`.

## After a push (staging)

Staging tracks whatever branch you check out in `/var/www/nowisee-dev`. Schema changes there migrate **staging** files only.

```bash
sudo -u nowisee-host -H bash -lc 'cd /var/www/nowisee-dev && git fetch && git checkout <branch> && git pull && npm ci && npm run build'
sudo systemctl restart nowisee-dev.target
```

Leave `/var/www/nowisee-dev/data/` alone. Confirm:

```bash
systemctl status nowisee-dev.target --no-pager
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/
```

## Env or unit changes

Node does not read `.env` files. Edit `/etc/nowisee/nowisee.env` or `/etc/nowisee/nowisee-dev.env` (mode `640`, `root:nowisee`). Quote values with spaces:

```bash
NOWISEE_MAIL_FROM="Now I See <login@nowisee.app>"
```

Do not `source` those files — unquoted `<…>` is shell redirection. Then restart `nowisee.target` or `nowisee-dev.target`. App-only env: `/etc/nowisee/apps/<id>.env` (mode `640`, `root:nowisee-<id>`).

If a unit file changed in git:

```bash
sudo cp /var/www/nowisee/deploy/nowisee.service /etc/systemd/system/nowisee.service
sudo cp /var/www/nowisee/deploy/nowisee-app@.service /etc/systemd/system/nowisee-app@.service
sudo cp /var/www/nowisee/deploy/nowisee.target /etc/systemd/system/nowisee.target
sudo cp /var/www/nowisee-dev/deploy/nowisee-dev.service /etc/systemd/system/nowisee-dev.service
sudo cp /var/www/nowisee-dev/deploy/nowisee-dev-app@.service /etc/systemd/system/nowisee-dev-app@.service
sudo cp /var/www/nowisee-dev/deploy/nowisee-dev.target /etc/systemd/system/nowisee-dev.target
sudo systemctl daemon-reload
sudo systemctl restart nowisee.target
sudo systemctl restart nowisee-dev.target
```

Copy each unit from **that** instance’s tree so a half-deployed branch cannot overwrite the other unit.

## First install

Node 22, git, Caddy, ports 22/80/443 only (not 3000, 3001, capability, or app loopback). Domain A/AAAA `@` → droplet. Shared group plus one user per process:

```bash
sudo addgroup --system nowisee
sudo adduser --system --ingroup nowisee --home /var/www/nowisee nowisee-host
for id in home recents tutorial bible notes lists weather gmail account; do
  sudo adduser --system --ingroup nowisee --no-create-home "nowisee-$id"
done
sudo mkdir -p /var/www/nowisee
sudo chown nowisee-host:nowisee /var/www/nowisee
sudo -u nowisee-host -H git clone https://github.com/pmcculfor/nowisee.git /var/www/nowisee
sudo chmod -R g+rX /var/www/nowisee
sudo -u nowisee-host -H bash -lc 'cd /var/www/nowisee && npm ci && npm run build'
sudo mkdir -p /var/www/nowisee/data/apps
sudo chown nowisee-host:nowisee /var/www/nowisee/data
sudo chmod 750 /var/www/nowisee/data
sudo chmod 1770 /var/www/nowisee/data/apps
```

```bash
sudo mkdir -p /etc/nowisee/apps
sudo cp /var/www/nowisee/.env.production.example /etc/nowisee/nowisee.env
sudo chown root:nowisee /etc/nowisee /etc/nowisee/nowisee.env
sudo chmod 750 /etc/nowisee
sudo chmod 640 /etc/nowisee/nowisee.env
# fill host secrets, including NOWISEE_HOST_SIGNING_KEY and NOWISEE_CAPABILITY_LISTEN
for id in home recents tutorial bible notes lists weather gmail account; do
  sudo cp /var/www/nowisee/deploy/app.env.example "/etc/nowisee/apps/${id}.env"
  sudo chown "root:nowisee-${id}" "/etc/nowisee/apps/${id}.env"
  sudo chmod 640 "/etc/nowisee/apps/${id}.env"
done
# fill each app env: NOWISEE_LISTEN (3110–3118), NOWISEE_APP_DB, public signing key, capability URL
sudo cp /var/www/nowisee/deploy/nowisee.service /etc/systemd/system/nowisee.service
sudo cp /var/www/nowisee/deploy/nowisee-app@.service /etc/systemd/system/nowisee-app@.service
sudo cp /var/www/nowisee/deploy/nowisee.target /etc/systemd/system/nowisee.target
sudo systemctl daemon-reload
sudo systemctl enable --now nowisee.target
```

Caddyfile (`/etc/caddy/Caddyfile`) — `127.0.0.1`, four numbers. Add the `dev.nowisee.app` block when staging exists (see below); until then prod alone is enough:

```caddy
nowisee.app {
    encode gzip
    reverse_proxy 127.0.0.1:3000
}

dev.nowisee.app {
    encode gzip
    reverse_proxy 127.0.0.1:3001
}
```

```bash
sudo systemctl reload caddy
```

OAuth redirect is `{NOWISEE_ORIGIN}/oauth/callback`. Leave `NOWISEE_TLS_*` unset; Caddy owns HTTPS. Back up each tree’s `data/` (identity, app SQLite) separately from the git tree. Staging `data/` is disposable; production `data/` is not.

## Staging instance

Same droplet, second origin. Do not copy production env or `data/`.

DNS: A (and AAAA if the apex has IPv6) with host **`dev`**, not `dev.nowisee.app`, same IP as `@`. Wait until it resolves before reloading Caddy.

```bash
sudo mkdir -p /var/www/nowisee-dev
sudo chown nowisee-host:nowisee /var/www/nowisee-dev
sudo -u nowisee-host -H git clone https://github.com/pmcculfor/nowisee.git /var/www/nowisee-dev
sudo chmod -R g+rX /var/www/nowisee-dev
sudo -u nowisee-host -H bash -lc 'cd /var/www/nowisee-dev && git checkout <branch> && npm ci && npm run build'
sudo mkdir -p /var/www/nowisee-dev/data/apps
sudo chown nowisee-host:nowisee /var/www/nowisee-dev/data
sudo chmod 750 /var/www/nowisee-dev/data
sudo chmod 1770 /var/www/nowisee-dev/data/apps
```

First boot seeds `data/apps/bible.db` from the committed corpus. That is CPU- and disk-heavy; do it when prod can take a spike.

```bash
sudo mkdir -p /etc/nowisee/apps-dev
sudo cp /var/www/nowisee-dev/.env.staging.example /etc/nowisee/nowisee-dev.env
sudo chown root:nowisee /etc/nowisee/nowisee-dev.env
sudo chmod 640 /etc/nowisee/nowisee-dev.env
# fill secrets: new lockbox, signing, and OTP keys; PORT=3001; cap 3021; NOWISEE_ORIGIN=https://dev.nowisee.app
for id in home recents tutorial bible notes lists weather gmail account; do
  sudo cp /var/www/nowisee-dev/deploy/app.env.example "/etc/nowisee/apps-dev/${id}.env"
  sudo chown "root:nowisee-${id}" "/etc/nowisee/apps-dev/${id}.env"
  sudo chmod 640 "/etc/nowisee/apps-dev/${id}.env"
done
# listen ports 3210–3218; NOWISEE_APP_DB under /var/www/nowisee-dev/data/apps
sudo cp /var/www/nowisee-dev/deploy/nowisee-dev.service /etc/systemd/system/nowisee-dev.service
sudo cp /var/www/nowisee-dev/deploy/nowisee-dev-app@.service /etc/systemd/system/nowisee-dev-app@.service
sudo cp /var/www/nowisee-dev/deploy/nowisee-dev.target /etc/systemd/system/nowisee-dev.target
sudo systemctl daemon-reload
sudo systemctl enable --now nowisee-dev.target
```

Seed locators are production `3110`–`3118`. After the staging host first-migrates, point rows at `3210`–`3218`:

```bash
sudo -u nowisee-host sqlite3 /var/www/nowisee-dev/data/nowisee.db \
  "UPDATE app_catalog SET locator = 'http://127.0.0.1:' || (3210 + sort_order);"
```

Add the `dev.nowisee.app` site to the Caddyfile (do not change the prod block) and `sudo systemctl reload caddy`.

In Google Cloud, on the Web client, add authorized JavaScript origin `https://dev.nowisee.app` and redirect URI `https://dev.nowisee.app/oauth/callback`. Reusing the production OAuth client is fine; tokens still land in the staging lockbox. Resend API key may be reused. `NOWISEE_MAIL_FROM` can keep `login@nowisee.app`; put `Dev` in the display name so codes are not mistaken for production.

Registration is open. Staging is another public site. iOS stays on `https://nowisee.app` unless you change `NowiseeOrigin.url`.
