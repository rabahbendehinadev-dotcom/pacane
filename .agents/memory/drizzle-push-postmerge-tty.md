---
name: drizzle-kit push fails in post-merge (TTY)
description: Why merged DB schema changes don't reach the dev DB automatically, and how to apply them
---

When a task agent adds a column/table to a Drizzle schema and the change is merged, the
post-merge script runs `pnpm --filter @workspace/db run push` (drizzle-kit push). This
FAILS in the main environment for two reasons:
- drizzle-kit push requires an interactive TTY ("Interactive prompts require a TTY terminal");
  post-merge runs non-interactively, so it aborts.
- It also stops on any data-loss warning (e.g. an unrelated `transfers.deleted_at` drop),
  which would need a "yes" confirmation it can't receive.

Result: the schema/codegen/API say a column exists, but the actual dev DB does NOT have it,
so SELECTs fail at runtime (e.g. "Failed query: select ... assigned_user_id ... from recipes").

**How to apply:** when a merged task adds DB columns, verify the dev DB actually has them
(`information_schema.columns`) and apply missing ones with direct idempotent SQL via
`psql "$DATABASE_URL"`, matching the Drizzle column type/FK exactly, e.g.
`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS assigned_user_id integer REFERENCES users(id) ON DELETE SET NULL;`
Do NOT run interactive `drizzle-kit push` to fix this.
