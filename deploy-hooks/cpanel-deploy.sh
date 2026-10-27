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
# Style and script files of earlier builds (.next/static, content-hashed names) are kept for two weeks: pages that
# browsers or the server's page cache still hold point at them, and would show unstyled if they vanished.
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude '.git' --exclude '.cpanel.yml' --exclude '.env.production' --exclude 'tmp/' --exclude '/.next/static/' \
    "$SRC/" "$APP/"
  mkdir -p "$APP/.next/static"
  rsync -a "$SRC/.next/static/" "$APP/.next/static/"
else
  # Fallback without rsync: replace code directories, keep .env.production, tmp/ and earlier static files.
  OLD_STATIC="$(mktemp -d)"
  if [ -d "$APP/.next/static" ]; then cp -a "$APP/.next/static/." "$OLD_STATIC/"; fi
  for item in "$SRC"/* "$SRC"/.next; do
    name="$(basename "$item")"
    [ "$name" = "tmp" ] && continue
    rm -rf "${APP:?}/$name"
    cp -a "$item" "$APP/"
  done
  cp -an "$OLD_STATIC/." "$APP/.next/static/"
  rm -rf "$OLD_STATIC"
fi
# Clean-up of earlier builds: files of THIS build are marked fresh first (unchanged files such as the logo keep the
# date they were first checked out, and must never count as "old"), then anything older than two weeks goes.
(cd "$SRC/.next/static" && find . -type f -print0 | (cd "$APP/.next/static" && xargs -0 -r touch)) 2>/dev/null || true
find "$APP/.next/static" -type f -mtime +14 -delete 2>/dev/null || true

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
