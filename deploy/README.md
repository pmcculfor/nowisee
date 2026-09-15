# Production host (DigitalOcean)

The droplet `nowisee-prod-00` runs **two** Node processes. Caddy terminates TLS and proxies by hostname. systemd runs Node; secrets live under `/etc/nowisee/`, not in git. Do not run Vite (`npm run dev`) on the droplet.

| Origin | Checkout | Unit | Env | Port |
|--------|----------|------|-----|------|
| https://nowisee.app | `/var/www/nowisee` | [`nowisee.service`](nowisee.service) | `/etc/nowisee/nowisee.env` from [`.env.production.example`](../.env.production.example) | `127.0.0.1:3000` |
| https://dev.nowisee.app | `/var/www/nowisee-dev` | [`nowisee-dev.service`](nowisee-dev.service) | `/etc/nowisee/nowisee-dev.env` from [`.env.staging.example`](../.env.staging.example) | `127.0.0.1:3001` |

User `nowisee` owns both trees. App SQLite files are `data/apps/*.db` under that process’s working directory — there is no `NOWISEE_APPS_DIR` — so the checkouts must stay separate. Do not share `data/`, `NOWISEE_DB`, `NOWISEE_LOCKBOX_KEY`, or `NOWISEE_OTP_PEPPER`. The `__Host-` session cookie and CSRF `NOWISEE_ORIGIN` check already isolate the two hostnames.

## After a push to `main`

SSH in (usually as root) and:

```bash
sudo -u nowisee -H bash -lc 'cd /var/www/nowisee && git pull && npm ci && npm run build'
sudo systemctl restart nowisee
```

Leave `data/` alone. Do not run `npm audit fix` on the droplet; fix advisories in git and pull.

`npm ci` / `npm run build` need Vite. Do not export `NODE_ENV=production` in that shell — the unit sets it for the running process only. A staging build on this droplet can spike CPU; prefer a quiet moment.

Confirm:

```bash
systemctl status nowisee --no-pager
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/
```

You want `active (running)` and `200`.

## After a push (staging)

Staging tracks whatever branch you check out in `/var/www/nowisee-dev`. Schema changes there migrate **staging** files only.

```bash
sudo -u nowisee -H bash -lc 'cd /var/www/nowisee-dev && git fetch && git checkout <branch> && git pull && npm ci && npm run build'
sudo systemctl restart nowisee-dev
```

Leave `/var/www/nowisee-dev/data/` alone. Confirm:

```bash
systemctl status nowisee-dev --no-pager
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/
```

## Env or unit changes

Node does not read `.env` files. Edit `/etc/nowisee/nowisee.env` or `/etc/nowisee/nowisee-dev.env` (mode `640`, `root:nowisee`). Quote values with spaces:

```bash
NOWISEE_MAIL_FROM="Now I See <login@nowisee.app>"
```

Do not `source` those files — unquoted `<…>` is shell redirection. Then restart the matching unit (`nowisee` or `nowisee-dev`).

If a unit file changed in git:

```bash
sudo cp /var/www/nowisee/deploy/nowisee.service /etc/systemd/system/nowisee.service
sudo cp /var/www/nowisee-dev/deploy/nowisee-dev.service /etc/systemd/system/nowisee-dev.service
sudo systemctl daemon-reload
sudo systemctl restart nowisee
sudo systemctl restart nowisee-dev
```

Copy each unit from **that** instance’s tree so a half-deployed branch cannot overwrite the other unit.

## First install

Node 22, git, Caddy, ports 22/80/443 only (not 3000 or 3001). Domain A/AAAA `@` → droplet. User and tree:

```bash
sudo adduser --system --group --home /var/www/nowisee nowisee
sudo mkdir -p /var/www/nowisee
sudo chown nowisee:nowisee /var/www/nowisee
sudo -u nowisee -H git clone https://github.com/pmcculfor/nowisee.git /var/www/nowisee
sudo -u nowisee -H bash -lc 'cd /var/www/nowisee && npm ci && npm run build'
```

```bash
sudo mkdir -p /etc/nowisee
sudo cp /var/www/nowisee/.env.production.example /etc/nowisee/nowisee.env
sudo chown root:nowisee /etc/nowisee /etc/nowisee/nowisee.env
sudo chmod 750 /etc/nowisee
sudo chmod 640 /etc/nowisee/nowisee.env
# fill secrets in /etc/nowisee/nowisee.env
sudo cp /var/www/nowisee/deploy/nowisee.service /etc/systemd/system/nowisee.service
sudo systemctl daemon-reload
sudo systemctl enable --now nowisee
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
sudo chown nowisee:nowisee /var/www/nowisee-dev
sudo -u nowisee -H git clone https://github.com/pmcculfor/nowisee.git /var/www/nowisee-dev
sudo -u nowisee -H bash -lc 'cd /var/www/nowisee-dev && git checkout <branch> && npm ci && npm run build'
```

First boot seeds `data/apps/bible.db` from the committed corpus. That is CPU- and disk-heavy; do it when prod can take a spike.

```bash
sudo cp /var/www/nowisee-dev/.env.staging.example /etc/nowisee/nowisee-dev.env
sudo chown root:nowisee /etc/nowisee/nowisee-dev.env
sudo chmod 640 /etc/nowisee/nowisee-dev.env
# fill secrets: new lockbox key and OTP pepper; PORT=3001; NOWISEE_ORIGIN=https://dev.nowisee.app
sudo cp /var/www/nowisee-dev/deploy/nowisee-dev.service /etc/systemd/system/nowisee-dev.service
sudo systemctl daemon-reload
sudo systemctl enable --now nowisee-dev
```

Add the `dev.nowisee.app` site to the Caddyfile (do not change the prod block) and `sudo systemctl reload caddy`.

In Google Cloud, on the Web client, add authorized JavaScript origin `https://dev.nowisee.app` and redirect URI `https://dev.nowisee.app/oauth/callback`. Reusing the production OAuth client is fine; tokens still land in the staging lockbox. Resend API key may be reused. `NOWISEE_MAIL_FROM` can keep `login@nowisee.app`; put `Dev` in the display name so codes are not mistaken for production.

Registration is open. Staging is another public site. iOS stays on `https://nowisee.app` unless you change `NowiseeOrigin.url`.
