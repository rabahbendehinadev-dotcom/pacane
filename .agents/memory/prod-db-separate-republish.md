---
name: Prod DB is separate — fix "column does not exist" by re-publishing
description: Why a dev-DB schema fix doesn't reach the deployed app, and the only supported fix
---

This project's **development** database (`helium/heliumdb`, Replit's built-in legacy
Postgres) and the **deployed app's production** database are SEPARATE. Adding a column to
the dev DB (direct SQL or db push) does NOT fix the deployed app.

Symptoms: the live deployment (custom domain, e.g. ihs-dz.net, an autoscale deployment)
returns HTTP 500 "Failed query: select ... <new_column> ... " while dev returns 200. Auth
still works on prod, so the prod DB is reachable — it's just missing the new column.

`executeSql({ environment: "production" })` cannot read this prod DB — it returns
PRODUCTION_DATABASE_ERROR "does not have a production Neon database" because prod is the
legacy (non-Neon) database, not exposed to the read-replica tool.

**The only supported fix: re-publish.** The Publish flow diffs dev DB vs prod DB and
applies additive changes (a nullable FK column is backwards-compatible, no data loss).
NEVER run DDL against prod, write a migrate-prod script, add a db:push deploy/build hook,
or add startup-time DDL — these are all explicitly forbidden. See the `database` skill's
`database-migrations-on-publish.md`.

Before recommending re-publish: ensure dev DB actually has the column and dev API returns
200, so the publish diff is correct.
