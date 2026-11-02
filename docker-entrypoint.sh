#!/bin/sh
set -e

if [ -z "$HEALTH_ENCRYPTION_KEY" ]; then
  echo "FATAL: HEALTH_ENCRYPTION_KEY is not set."
  echo "The health store holds clinical data and must not run unencrypted."
  echo "Generate one with: openssl rand -hex 32"
  exit 1
fi

if [ -z "$JWT_SECRET" ] || [ "${JWT_SECRET#dev_only}" != "$JWT_SECRET" ]; then
  echo "FATAL: JWT_SECRET is unset or still the development default."
  echo "Generate one with: openssl rand -hex 32"
  exit 1
fi

# Create the schema if this is a fresh volume. Never seeds: production starts empty.
npx tsx apps/api/src/db/migrate.ts

if [ "$SEED_DEMO_DATA" = "true" ]; then
  echo "SEED_DEMO_DATA=true — loading synthetic demonstration data."
  echo "Never set this against a database holding real records."
  npx tsx apps/api/src/db/seed.ts
fi

# The solver runs alongside the API. If it fails, the API falls back.
if [ -x services/scheduler/.venv/bin/python ]; then
  services/scheduler/.venv/bin/python -m uvicorn main:app \
    --app-dir services/scheduler --host 127.0.0.1 --port 8000 &
fi

exec npx tsx apps/api/src/index.ts
