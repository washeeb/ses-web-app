#!/bin/bash
# Runs on the InMotion server when "Deploy HEAD Commit" is clicked in cPanel → Git Version Control
# (triggered by .cpanel.yml in the `deploy` branch). Copies the prebuilt app into place, applies
# database migrations and restarts the Node.js app. Never touches .env.production.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP="${SES_APP_DIR:-$HOME/ses-app}"
echo "Deploying $(git -C "$SRC" log -1 --format='%h %s' 2>/dev/null || echo bundle) → $APP"

mkdir -p "$APP"
# Uploaded documents live beside the app, never inside it (rsync --delete would remove them).
mkdir -p "$HOME/ses-data/uploads" && chmod 700 "$HOME/ses-data" 2>/dev/null || true
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude '.git' --exclude '.cpanel.yml' --exclude '.env.production' --exclude 'tmp/' \
    "$SRC/" "$APP/"
else
  # Fallback without rsync: replace code directories, keep .env.production and tmp/.
  for item in "$SRC"/* "$SRC"/.next; do
    name="$(basename "$item")"
    [ "$name" = "tmp" ] && continue
    rm -rf "${APP:?}/$name"
    cp -a "$item" "$APP/"
  done
fi

# Node.js chosen in "Setup Node.js App" lives in a CloudLinux virtual environment; use the newest.
NODE="$(ls -d "$HOME"/nodevenv/*/*/bin/node 2>/dev/null | grep "/nodevenv/$(basename "$APP")/" | sort -V | tail -1 || true)"
if [ -n "$NODE" ] && [ -f "$APP/.env.production" ]; then
  echo "Running database migrations with $NODE"
  (cd "$APP" && "$NODE" ops/migrate.mjs)
  # Keeps system role permission sets in step with the code (idempotent; never touches business data).
  (cd "$APP" && NODE_ENV=production "$NODE" ops/seed-reference.mjs)
else
  echo "Skipping migrations: create the Node.js app and .env.production first (see docs/deploy-inmotion.md)."
fi

# Passenger restarts the app on its next request when this file changes.
mkdir -p "$APP/tmp"
touch "$APP/tmp/restart.txt"
echo "Deployed. Check https://synclyticsenterprisesystems.com/api/health"
