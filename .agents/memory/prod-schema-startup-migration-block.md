---
name: Prod schema is managed by a startup migration block, NOT Replit publish
description: How this project's deployed app gets schema changes; why re-publish alone fails
---

This project's deployed app (custom domain, e.g. ihs-dz.net, autoscale; runs on its own
self-managed Postgres) does NOT use Replit's Neon publish-time schema diff. There is no
managed production Neon DB — `executeSql({ environment: "production" })` returns
PRODUCTION_DATABASE_ERROR "does not have a production Neon database". Re-publishing alone
does NOT add new columns to production.

Production schema is self-healed at **app startup** by an idempotent migration block in
`artifacts/api-server/src/index.ts` — a try/catch full of
`await db.execute(sql\`ALTER TABLE x ADD COLUMN IF NOT EXISTS ...\`)` and
`CREATE TABLE IF NOT EXISTS ...` statements (logs "DB migrations applied"). This is the
project's deliberate, established pattern (cost_per_unit, transfers.deleted_at,
workers.phone, etc.), inherited from the imported repo.

**To add a column so it reaches production:**
1. Add it to the Drizzle schema in `lib/db/src/schema/*.ts` (source of truth for types).
2. Add a matching `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` line to the startup block
   in `artifacts/api-server/src/index.ts` (match the FK/type exactly).
3. Apply to the dev DB too (direct psql or restart the API server so the block runs).
4. Then the user redeploys — the new startup line runs on the prod container and adds it.

A schema/dev-DB-only change (the common task-agent mistake) leaves the deployed app failing
with `column "..." does not exist` no matter how many times it's re-published. Note: this
block intentionally drifts from Drizzle types for some columns (e.g. workers.phone), which
is why workers.ts has pre-existing TS errors — do not try to "fix" those.
