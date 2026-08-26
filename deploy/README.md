# Production host (DigitalOcean)

https://nowisee.app is one Node process on the droplet `nowisee-prod-00`. Caddy terminates TLS and proxies to `127.0.0.1:3000`. systemd runs Node; secrets live in `/etc/nowisee/nowisee.env`, not in git.

Repo checkout: `/var/www/nowisee` (user `nowisee`). Env template: [`.env.production.example`](../.env.production.example). Unit: [`nowisee.service`](nowisee.service).

## After a push to `main`

SSH in (usually as root) and:

```bash
sudo -u nowisee -H bash -lc 'cd /var/www/nowisee && git pull && npm ci && npm run build'
sudo systemctl restart nowisee
```

Leave `data/` alone. Do not run `npm audit fix` on the droplet; fix advisories in git and pull.

`npm ci` / `npm run build` need Vite. Do not export `NODE_ENV=production` in that shell — the unit sets it for the running process only.

Confirm:

```bash
systemctl status nowisee --no-pager
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/
```

You want `active (running)` and `200`.

## Env or unit changes

Node does not read `.env` files. Edit `/etc/nowisee/nowisee.env` (mode `640`, `root:nowisee`). Quote values with spaces:

```bash
NOWISEE_MAIL_FROM="Now I See <login@nowisee.app>"
```

Do not `source` that file — unquoted `<…>` is shell redirection. Then:

```bash
sudo systemctl restart nowisee
```

If [`nowisee.service`](nowisee.service) changed in git:

```bash
sudo cp /var/www/nowisee/deploy/nowisee.service /etc/systemd/system/nowisee.service
sudo systemctl daemon-reload
sudo systemctl restart nowisee
```

## First install

Node 22, git, Caddy, ports 22/80/443 only (not 3000). Domain A/AAAA → droplet. User and tree:

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

Caddyfile (`/etc/caddy/Caddyfile`) — `127.0.0.1`, four numbers:

```caddy
nowisee.app {
    encode gzip
    reverse_proxy 127.0.0.1:3000
}
```

```bash
sudo systemctl reload caddy
```

OAuth redirect is `https://nowisee.app/oauth/callback`. Leave `NOWISEE_TLS_*` unset; Caddy owns HTTPS. Back up `data/` (identity, app SQLite) separately from the git tree.
