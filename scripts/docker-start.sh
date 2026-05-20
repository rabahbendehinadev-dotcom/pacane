#!/bin/sh
set -e

echo "==> Pacane ERP — starting..."

# NOTE: drizzle-kit push is intentionally NOT used here.
# All schema changes are handled safely via runMigrations() in the API server
# using only ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS.

echo "==> Seeding initial data (idempotent)..."
cd /app
node /app/scripts/prod-seed.mjs

echo "==> Starting API server on port $PORT..."
exec node --enable-source-maps ./dist/index.mjs
