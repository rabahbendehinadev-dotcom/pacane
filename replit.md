# Pacane ERP

A full ERP system for Pacane — imported from https://github.com/unlock-gab/pacanegabra. Covers inventory, orders, clients, suppliers, production, and more.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite (port 23023, served at `/`)
- API: Express 5 (port 8080, served at `/api`)
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/erp-app/` — React/Vite frontend
- `artifacts/api-server/` — Express backend
- `lib/` — shared libraries (db, api-spec, etc.)

## Architecture decisions

- Frontend served at root `/`, API at `/api` — path-based routing via Replit proxy.
- Frontend is served by the artifact-managed workflow `artifacts/erp-app: web` on port 23023 at path `/`.

## Product

Full ERP for Pacane: authentication, inventory management, order management, client/supplier management, and production tracking.

## User preferences

- Always respond and explain in Arabic (العربية).

## Gotchas

- The API server requires `DATABASE_URL` env var to start. Without it, the backend will fail on startup.
- `SESSION_SECRET` env var is already set.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
test push 21-06-2026