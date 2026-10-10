# Deploying to InMotion Hosting (Power shared plan) — synclyticsenterprisesystems.com

> Built and smoke-tested locally (the bundle starts, serves pages, secures the cron endpoint and runs maintenance commands). **Not yet run on the InMotion server.** Do steps 1–2 first to confirm your plan offers what is needed.

## How the app runs on shared hosting

| Concern | Approach on the Power plan |
|---|---|
| Node.js | cPanel **Setup Node.js App** (Passenger) runs `passenger.cjs`, which starts the bundled Next.js server |
| Build | GitHub Actions builds on every push to `main` and publishes to the `deploy` branch; cPanel Git Version Control pulls it. No `npm install` or build on the server |
| Database | cPanel **PostgreSQL Databases** (on the same server; older than PostgreSQL 15, so migrations avoid newer syntax — guarded by tests/postgres-compat.test.ts). Connect via `127.0.0.1` after **Synchronize Grants** |
| Background jobs (partner events, e-mail, payment checks, stock-hold expiry) | Run inside the app while it is awake, **plus a cPanel cron job** calling `/api/cron/tick` every 5 minutes, because Passenger may stop an idle app |
| Live page updates | Pages refresh every 30 s (polling) instead of streaming, to avoid tying up the plan's limited processes |
| E-mail | Your cPanel mailbox over SMTP |

**What to expect.** Paystack and partner webhooks wake the app and are acknowledged at once. Follow-up work (verification, e-mails, partner deliveries) runs within seconds when the app is awake, and **within about 5 minutes** when it was idle. If you later need faster partner synchronisation or see resource-limit restarts (cPanel → *Resource Usage*), move to an InMotion VPS. The same code supports both.

## 1. Check the plan (once)

In cPanel, confirm you can see:
- **Software → Setup Node.js App**, offering **Node.js 22 or 24** (minimum 20.9).
- **Databases → PostgreSQL Databases**.
- **Advanced → Cron Jobs**.
- **Files → Git Version Control** and **Security → SSH Access** (needed for the private GitHub repository).
- **Advanced → Terminal** (or SSH).

If Setup Node.js App or PostgreSQL is missing, ask InMotion support to enable them on your account.

## 2. Create the database

cPanel → **PostgreSQL Databases**:
1. Create a database, for example `ses`. cPanel prefixes it as `cpaneluser_ses`.
2. Create a user with a strong password, for example `cpaneluser_sesapp`.
3. Add the user to the database with **ALL PRIVILEGES**.

Your connection string is then:
`postgres://cpaneluser_sesapp:<password>@localhost:5432/cpaneluser_ses`
URL-encode any special characters in the password.

## 3. Connect GitHub with cPanel Git Version Control (recommended)

How it works:
- The source code lives on the `main` branch of the private repository **github.com/washeeb/ses-web-app**.
- On every push to `main`, the GitHub Actions workflow *Build deploy bundle* runs the checks and tests, builds the app on Linux, and publishes the ready-to-run bundle to the **`deploy`** branch.
- cPanel clones the `deploy` branch. **Deploy HEAD Commit** runs `deploy-hooks/cpanel-deploy.sh`, which copies the files to `~/ses-app`, keeps `.env.production`, runs database migrations and restarts the app.

One-time setup:

1. **Give the server read access to the private repository.** cPanel's *SSH Access* key generator insists on a passphrase, and cPanel's Git cannot use a key that has one, so create the key in cPanel → **Terminal** instead:
   ```bash
   mkdir -p ~/.ssh && chmod 700 ~/.ssh && ssh-keygen -t ed25519 -N "" -C "inmotion-cpanel-deploy" -f ~/.ssh/id_ed25519
   ```
   ```bash
   printf 'Host github.com\n  HostName github.com\n  User git\n  IdentityFile ~/.ssh/id_ed25519\n  IdentitiesOnly yes\n' >> ~/.ssh/config && chmod 600 ~/.ssh/config
   ```
   ```bash
   cat ~/.ssh/id_ed25519.pub
   ```
   Copy the single line the last command prints; it starts with `ssh-ed25519`. Never share the private key file, the one without `.pub`.
2. On GitHub → **washeeb/ses-web-app → Settings → Deploy keys → Add deploy key**: paste the public key, title it `InMotion cPanel`, and leave **Allow write access unticked**.
3. In Terminal, run this once to trust GitHub's host key. Answer `yes`; it should greet you by repository name.
   ```bash
   ssh -T git@github.com
   ```
4. cPanel → **Git Version Control → Create**:
   - **Clone a Repository**: on
   - **Clone URL**: `git@github.com:washeeb/ses-web-app.git`
   - **Repository Path**: `repositories/ses-web-app`
   - **Repository Name**: `ses-web-app`
5. After it clones, open **Manage → Basic Information** and set **Checked-Out Branch** to **`deploy`**. Then open **Pull or Deploy** and click **Deploy HEAD Commit**. The first deploy copies the app to `~/ses-app`, and skips migrations until steps 4–6 below are done.

## 4. Settings file

In `~/ses-app` (**not** inside `public_html`), create a file named `.env.production` with permissions **600**. The app and the maintenance commands both read it, and deployments never overwrite it.

**Easiest way:** paste this into cPanel **Terminal**. It generates `APP_ENCRYPTION_KEY` and `CRON_SECRET` on the server and refuses to overwrite an existing file. Then replace the placeholders `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `OUTGOING_SERVER` and `MAILBOX_PASSWORD` in File Manager (Settings → Show Hidden Files). Use a database password made of letters and numbers only. Back up `APP_ENCRYPTION_KEY` in a password manager.

```bash
F=~/ses-app/.env.production; mkdir -p ~/ses-app; if [ -e "$F" ]; then echo "STOP: $F already exists - not overwritten"; else umask 077; cat > "$F" <<EOF
NODE_ENV=production
APP_URL=https://synclyticsenterprisesystems.com
DATABASE_URL=postgres://DB_USER:DB_PASSWORD@localhost:5432/DB_NAME
DB_POOL_MAX=3
APP_ENCRYPTION_KEY=$(openssl rand -base64 32)
CRON_SECRET=$(openssl rand -hex 24)
WORKER_MODE=inline
SIMULATORS_ENABLED=false
TRUST_PROXY=true

MAIL_ADAPTER=smtp
SMTP_HOST=OUTGOING_SERVER
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=no-reply@synclyticsenterprisesystems.com
SMTP_PASSWORD=MAILBOX_PASSWORD
MAIL_FROM="Synclytics Enterprise Systems <no-reply@synclyticsenterprisesystems.com>"

PAYSTACK_SECRET_KEY=
PAYSTACK_CHANNELS=card,mobile_money
EOF
echo "Created $F"; ls -l "$F"; fi
```

Check the database login: `psql "$(grep '^DATABASE_URL=' ~/ses-app/.env.production | cut -d= -f2-)" -c "select current_user;"`

Alternatively, create the file by hand with the contents below.

> No Git? Run `npm run package:shared` on your PC, then upload and extract `deploy/ses-shared-YYYY-MM-DD.zip` into `~/ses-app` instead.

```
NODE_ENV=production
APP_URL=https://synclyticsenterprisesystems.com
DATABASE_URL=postgres://cpaneluser_sesapp:<password>@localhost:5432/cpaneluser_ses
DB_POOL_MAX=3
APP_ENCRYPTION_KEY=<32 random bytes, base64 — generate once, back up offline, never change>
CRON_SECRET=<40+ random characters>
WORKER_MODE=inline
SIMULATORS_ENABLED=false
TRUST_PROXY=true

MAIL_ADAPTER=smtp
SMTP_HOST=<outgoing server from cPanel → Email Accounts → Connect Devices>
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=no-reply@synclyticsenterprisesystems.com
SMTP_PASSWORD=<mailbox password>
MAIL_FROM="Synclytics Enterprise Systems <no-reply@synclyticsenterprisesystems.com>"

PAYSTACK_SECRET_KEY=sk_test_...
PAYSTACK_CHANNELS=card,mobile_money

UPLOAD_DIR=/home/<cpanel-user>/ses-data/uploads
```

> **Uploaded documents** are stored in `~/ses-data/uploads`, beside (never inside) `~/ses-app`, because each deployment replaces `~/ses-app`. Include `~/ses-data` in your cPanel backups together with the database.
>
> **Current backup setup (confirmed 2026-10-10):** InMotion *Backup Manager* (automatic, stored off-server) backs up *Home Directory & Mail* (which includes `~/ses-data` and `~/ses-app/.env.production`) and *PgSQL* every 3 days, all data, on a 10 GB allowance. Restores are in cPanel → Backup Manager → *Perform a Restore*.

To generate the two secrets on your PC:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
```bash
node -e "console.log(require('crypto').randomBytes(30).toString('base64url'))"
```

## 5. Create the Node.js application

cPanel → **Setup Node.js App → Create Application**:

| Field | Value |
|---|---|
| Node.js version | 22.x or 24.x |
| Application mode | Production |
| Application root | `ses-app` |
| Application URL | `synclyticsenterprisesystems.com` (root) |
| Application startup file | `passenger.cjs` |

Save. **Do not** click "Run NPM Install"; dependencies are already in the bundle.

## 6. Prepare the database and first administrator

Open **Terminal**. Copy the "Enter to the virtual environment" command shown at the top of the application page, then run:

```bash
cd ~/ses-app
node ops/migrate.mjs
NODE_ENV=production node ops/seed-reference.mjs
node ops/create-admin.mjs you@synclyticsenterprisesystems.com "Your Name"
```

The last command prints a one-time link (valid for 30 minutes) to set your password. Two-step verification with your authenticator app (QR code) is required on first sign-in.

Without Terminal, use the application page's **Run JS script** for `db:migrate` and `db:seed-reference`, then ask InMotion support to run the `create-admin` command once.

## 7. Restart and check

- Click **Restart** on the application page.
- Open `https://synclyticsenterprisesystems.com/api/health`. It should return `"status":"ok"`.
- cPanel → **SSL/TLS Status**: make sure AutoSSL covers the domain, and force HTTPS (cPanel → *Domains* → Force HTTPS Redirect).

## 8. Cron job (keeps background work flowing)

cPanel → **Cron Jobs** → *Every 5 minutes* (`*/5 * * * *`):

```
curl -fsS -m 120 -H "Authorization: Bearer <CRON_SECRET>" https://synclyticsenterprisesystems.com/api/cron/tick > /dev/null
```

## 9. E-mail deliverability and Paystack

- **E-mail:** cPanel → *Email Deliverability* shows SPF and DKIM as valid. Add a DMARC TXT record `_dmarc` → `v=DMARC1; p=quarantine; rua=mailto:postmaster@synclyticsenterprisesystems.com`. Test a password reset to Gmail and Outlook. If messages land in spam or exceed the plan's hourly sending limit, switch `SMTP_*` to a transactional provider (Brevo, Postmark, Amazon SES); no code change is needed.
- **Paystack:** in the dashboard (test mode), set the webhook URL to `https://synclyticsenterprisesystems.com/api/webhooks/paystack`. Pay a test order from the customer portal. To go live, replace the key with `sk_live_…` once Paystack approves the business.

## Releasing an update (Git)

1. Push to `main`. In GitHub → **Actions**, wait for *Build deploy bundle* to pass. Failing checks or tests mean nothing is published.
2. Back up the database (cPanel → *Backup*, or `pg_dump`) before releases that change the schema.
3. cPanel → **Git Version Control → Manage → Pull or Deploy**:
   - click **Update from Remote**
   - then click **Deploy HEAD Commit**
4. Open `/api/health` to check the site.

**Roll back:** revert the change on `main` and push; a new bundle is built from the reverted code and added to `deploy`. (The `deploy` branch only ever gains commits, so "Update from Remote" always works.) Migrations only add to the schema, so older code keeps working.

**Without Git:** run `npm run package:shared`, extract the zip over `~/ses-app`, run `node ops/migrate.mjs` in the virtual environment, then restart the app.

## Moving to a VPS later

Use the same bundle, or `npm run build` + PM2 (`ecosystem.config.cjs`) and `NEXT_PUBLIC_LIVE_UPDATES=sse` for instant live updates. Point `DATABASE_URL` at the VPS PostgreSQL and restore a `pg_dump` backup.
