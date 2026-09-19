# Production host (DigitalOcean)

The droplet `nowisee-prod-00` runs a **host** plus **one process per app**. Caddy terminates TLS and proxies only the host public port. systemd runs Node.

| Origin | Checkout | Target | Host env | Host port | Cap port |
|--------|----------|--------|----------|-----------|----------|
| https://nowisee.app | `/var/www/nowisee` | [`nowisee.target`](nowisee.target) | `/etc/nowisee/host/nowisee.env` from [`.env.production.example`](../.env.production.example) | `127.0.0.1:3000` | `127.0.0.1:3020` |
| https://dev.nowisee.app | `/var/www/nowisee-dev` | [`nowisee-dev.target`](nowisee-dev.target) | `/etc/nowisee-dev/host/nowisee.env` from [`.env.staging.example`](../.env.staging.example) | `127.0.0.1:3001` | `127.0.0.1:3021` |

## Layout

Three trees, one owner per process. Staging is the same shape with `nowisee-dev` users and the `-dev` prefixes.

```text
/var/www/nowisee/                    git checkout (group nowisee, readable)
  src/host/index.ts                  host process  (User=nowisee-host)
  src/node-kit/                      sqlite, listen, serveApp, signed ctx (host + every app)
  src/apps/notes/main.ts             Notes process (User=nowisee-notes)
  src/app-kit/  src/core/  src/shell/

/etc/nowisee/host/nowisee.env        600 root:root            lockbox, OTP, signing private, Gmail client secret
/etc/nowisee/notes/notes.env         600 root:root            listen, NOWISEE_APP_DB, public key, cap URL

/var/lib/nowisee/host/nowisee.db     700 nowisee-host:nowisee
/var/lib/nowisee/notes/notes.db      700 nowisee-notes:nowisee
```

`ExecStart` is `src/host/index.ts` for the broker and `src/apps/%i/main.ts` for each app ([`nowisee.service`](nowisee.service), [`nowisee-app@.service`](nowisee-app@.service)). Apps never receive lockbox, OTP, or OAuth client secrets. Gmail’s client id/secret stay in the **host** env.

`adduser --ingroup nowisee` puts every prod process in group `nowisee` (there is no `nowisee-notes` group). Data dirs are `700`, so only the owning UID can open them. systemd reads `EnvironmentFile` as root, so env files are `600 root:root`.

Do not share `/var/lib/nowisee/`, `NOWISEE_DB`, `NOWISEE_LOCKBOX_KEY`, `NOWISEE_HOST_SIGNING_KEY`, or `NOWISEE_OTP_PEPPER` across prod and staging.

App listen ports (loopback, not in Caddy): prod `3110`–`3118`, staging `3210`–`3218` (Home, Recents, Tutorial, Bible, Notes, Lists, Weather, Gmail, Account). Staging `app_catalog.locator` rows must match those ports — after first migrate, `UPDATE app_catalog SET locator = 'http://127.0.0.1:' \|\| (3210 + sort_order)`.

The `__Host-` session cookie and CSRF `NOWISEE_ORIGIN` check isolate the two hostnames.

## After a push to `main`

SSH in (usually as root) and:

```bash
sudo -u nowisee-host -H bash -lc 'cd /var/www/nowisee && git pull && npm ci && npm run build'
sudo systemctl restart nowisee.target
```

Restart `nowisee.target` for a repo-wide pull (especially wire/signing/capability APIs). Restart a single `nowisee-app@notes` only for a Notes-only change on an unchanged contract.

Leave `/var/lib/nowisee/` alone. Do not run `npm audit fix` on the droplet; fix advisories in git and pull.

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
sudo -u nowisee-dev-host -H bash -lc 'cd /var/www/nowisee-dev && git fetch && git checkout <branch> && git pull && npm ci && npm run build'
sudo systemctl restart nowisee-dev.target
```

Leave `/var/lib/nowisee-dev/` alone. Confirm:

```bash
systemctl status nowisee-dev.target --no-pager
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/
```

## Env or unit changes

Node does not read `.env` files. Edit `/etc/nowisee/host/nowisee.env` or `/etc/nowisee-dev/host/nowisee.env` (mode `600`, `root:root`). Quote values with spaces:

```bash
NOWISEE_MAIL_FROM="Now I See <login@nowisee.app>"
```

Do not `source` those files — unquoted `<…>` is shell redirection. Then restart `nowisee.target` or `nowisee-dev.target`. App env: `/etc/nowisee/<id>/<id>.env` (mode `600`, `root:root`).

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

Node 22, git, Caddy, ports 22/80/443 only (not 3000, 3001, capability, or app loopback). Domain A/AAAA `@` → droplet.

Users, checkout, data dirs:

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

sudo mkdir -p /var/lib/nowisee/host
sudo chown nowisee-host:nowisee /var/lib/nowisee/host
sudo chmod 700 /var/lib/nowisee/host
for id in home recents tutorial bible notes lists weather gmail account; do
  sudo mkdir -p "/var/lib/nowisee/${id}"
  sudo chown "nowisee-${id}:nowisee" "/var/lib/nowisee/${id}"
  sudo chmod 700 "/var/lib/nowisee/${id}"
done
```

Copy the host env, then **stop and fill it** before the next block. systemd will not start without every required value.

```bash
sudo mkdir -p /etc/nowisee/host
sudo cp /var/www/nowisee/.env.production.example /etc/nowisee/host/nowisee.env
sudo chmod 600 /etc/nowisee/host/nowisee.env
```

Edit `/etc/nowisee/host/nowisee.env`: lockbox, OTP, mail, Gmail client id/secret, `NOWISEE_HOST_SIGNING_KEY`, `NOWISEE_CAPABILITY_LISTEN`. The generate command in [`.env.production.example`](../.env.production.example) prints a private key (into this file) and a matching public key (into `PUB` below).

App env files, units, start:

```bash
PUB='<host public key>'
i=0
for id in home recents tutorial bible notes lists weather gmail account; do
  port=$((3110 + i))
  sudo mkdir -p "/etc/nowisee/${id}"
  sudo tee "/etc/nowisee/${id}/${id}.env" >/dev/null <<EOF
NOWISEE_LISTEN=127.0.0.1:${port}
NOWISEE_APP_DB=/var/lib/nowisee/${id}/${id}.db
NOWISEE_HOST_CAPABILITY_URL=http://127.0.0.1:3020
NOWISEE_HOST_SIGNING_PUB=${PUB}
NOWISEE_ROOT_APP_ID=home
EOF
  sudo chmod 600 "/etc/nowisee/${id}/${id}.env"
  i=$((i + 1))
done
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

OAuth redirect is `{NOWISEE_ORIGIN}/oauth/callback`. Leave `NOWISEE_TLS_*` unset; Caddy owns HTTPS. Back up `/var/lib/nowisee/` (identity, app SQLite) separately from the git tree. Staging `/var/lib/nowisee-dev/` is disposable; production `/var/lib/nowisee/` is not.

## Staging instance

Same droplet, second origin. Do not copy production env or `/var/lib/nowisee/`.

DNS: A (and AAAA if the apex has IPv6) with host **`dev`**, not `dev.nowisee.app`, same IP as `@`. Wait until it resolves before reloading Caddy.

Users, checkout, data dirs. `--ingroup nowisee-dev` means the group is `nowisee-dev`, not `nowisee-dev-host`.

```bash
sudo addgroup --system nowisee-dev
sudo adduser --system --ingroup nowisee-dev --home /var/www/nowisee-dev nowisee-dev-host
for id in home recents tutorial bible notes lists weather gmail account; do
  sudo adduser --system --ingroup nowisee-dev --no-create-home "nowisee-dev-$id"
done
sudo mkdir -p /var/www/nowisee-dev
sudo chown nowisee-dev-host:nowisee-dev /var/www/nowisee-dev
sudo -u nowisee-dev-host -H git clone https://github.com/pmcculfor/nowisee.git /var/www/nowisee-dev
sudo chmod -R g+rX /var/www/nowisee-dev
sudo -u nowisee-dev-host -H bash -lc 'cd /var/www/nowisee-dev && git checkout <branch> && npm ci && npm run build'

sudo mkdir -p /var/lib/nowisee-dev/host
sudo chown nowisee-dev-host:nowisee-dev /var/lib/nowisee-dev/host
sudo chmod 700 /var/lib/nowisee-dev/host
for id in home recents tutorial bible notes lists weather gmail account; do
  sudo mkdir -p "/var/lib/nowisee-dev/${id}"
  sudo chown "nowisee-dev-${id}:nowisee-dev" "/var/lib/nowisee-dev/${id}"
  sudo chmod 700 "/var/lib/nowisee-dev/${id}"
done
```

Copy the host env, then **stop and fill it**. New lockbox, signing, and OTP keys — not copies from production. `PORT=3001`, cap `3021`, `NOWISEE_ORIGIN=https://dev.nowisee.app`.

```bash
sudo mkdir -p /etc/nowisee-dev/host
sudo cp /var/www/nowisee-dev/.env.staging.example /etc/nowisee-dev/host/nowisee.env
sudo chmod 600 /etc/nowisee-dev/host/nowisee.env
```

Keep the matching public key for `PUB` in the next block. First boot after start seeds `/var/lib/nowisee-dev/bible/bible.db` from the committed corpus (CPU- and disk-heavy; do it when prod can take a spike).

App env files, units, start:

```bash
PUB='<staging host public key>'
i=0
for id in home recents tutorial bible notes lists weather gmail account; do
  port=$((3210 + i))
  sudo mkdir -p "/etc/nowisee-dev/${id}"
  sudo tee "/etc/nowisee-dev/${id}/${id}.env" >/dev/null <<EOF
NOWISEE_LISTEN=127.0.0.1:${port}
NOWISEE_APP_DB=/var/lib/nowisee-dev/${id}/${id}.db
NOWISEE_HOST_CAPABILITY_URL=http://127.0.0.1:3021
NOWISEE_HOST_SIGNING_PUB=${PUB}
NOWISEE_ROOT_APP_ID=home
EOF
  sudo chmod 600 "/etc/nowisee-dev/${id}/${id}.env"
  i=$((i + 1))
done
sudo cp /var/www/nowisee-dev/deploy/nowisee-dev.service /etc/systemd/system/nowisee-dev.service
sudo cp /var/www/nowisee-dev/deploy/nowisee-dev-app@.service /etc/systemd/system/nowisee-dev-app@.service
sudo cp /var/www/nowisee-dev/deploy/nowisee-dev.target /etc/systemd/system/nowisee-dev.target
sudo systemctl daemon-reload
sudo systemctl disable nowisee-dev
sudo systemctl start nowisee-dev.service
until sudo -u nowisee-dev-host node --input-type=module -e '
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("/var/lib/nowisee-dev/host/nowisee.db");
if (db.prepare("SELECT COUNT(*) AS n FROM app_catalog").get().n < 1) process.exit(1);
' 2>/dev/null; do sleep 0.2; done
sudo -u nowisee-dev-host node --input-type=module -e '
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("/var/lib/nowisee-dev/host/nowisee.db");
db.exec("UPDATE app_catalog SET locator = '\''http://127.0.0.1:'\'' || (3210 + sort_order)");
for (const row of db.prepare("SELECT app_id, locator FROM app_catalog ORDER BY sort_order").all()) {
  console.log(row.app_id, row.locator);
}
'
sudo systemctl enable --now nowisee-dev.target
```

Add the `dev.nowisee.app` site to the Caddyfile (do not change the prod block) and `sudo systemctl reload caddy`.

In Google Cloud, on the Web client, add authorized JavaScript origin `https://dev.nowisee.app` and redirect URI `https://dev.nowisee.app/oauth/callback`. Reusing the production OAuth client is fine; tokens still land in the staging lockbox. Resend API key may be reused. `NOWISEE_MAIL_FROM` can keep `login@nowisee.app`; put `Dev` in the display name so codes are not mistaken for production.

Registration is open. Staging is another public site. iOS stays on `https://nowisee.app` unless you change `NowiseeOrigin.url`.
