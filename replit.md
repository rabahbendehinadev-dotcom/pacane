# Pacane ERP

Pacane ERP is a comprehensive, multi-branch Enterprise Resource Planning system for managing stock, sales, POS, purchases, production, treasury, and analytics.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/erp run dev` — run the ERP frontend (port 18996)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`, `JWT_SECRET`, `NODE_ENV`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Frontend: React + Vite, Wouter routing, React Query, shadcn/ui, Tailwind CSS

## Where things live

- **Frontend**: `artifacts/erp/src/`
- **Backend routes**: `artifacts/api-server/src/routes/`
- **DB schema**: `lib/db/src/schema/`
- **OpenAPI spec**: `lib/api-spec/openapi.yaml`
- **Generated API hooks**: `lib/api-client-react/src/generated/`
- **Generated Zod schemas**: `lib/api-zod/src/generated/`
- **Object storage helpers**: `lib/object-storage-web/src/`
- **i18n (ar/fr)**: `artifacts/erp/src/lib/i18n/`

## Architecture decisions

- **Branch Isolation**: Each operational unit (stock, sales, POS) functions independently per branch; global reporting aggregates across branches. Non-admin users can only access their assigned branches.
- **JWT Auth**: JWT tokens stored in localStorage, managed by a global AuthProvider in `artifacts/erp/src/lib/auth.tsx`.
- **Orval codegen**: API client hooks and Zod schemas are auto-generated from `openapi.yaml` — always run codegen after spec changes.
- **Object storage**: File uploads handled via `@workspace/object-storage-web` using Uppy.
- **PDF generation**: Client-side PDF generation with jspdf + jspdf-autotable via `artifacts/erp/src/lib/pdf-generator.ts`.

## Product

- **Core ERP modules**: Stock, POS, Sales, Purchases, Production, Transfers, Expenses
- **Advanced analytics**: POS, Sales, Purchases, Production, Treasury, Executive Dashboard
- **Financial management**: Treasury module, expense tracking, P&L summaries
- **Customer management**: CRM, loyalty program, RFM segmentation, wallet credit
- **RBAC**: Role-based access control with granular permissions per branch
- **Alerts & notifications**: Low stock, credit limits, overdue receivables

## User preferences

- Iterative development: ask before major changes.
- Always respect Branch Isolation as a fundamental operational boundary, not just a filter.
- Use `formatDA(n)` for displaying Algerian Dinar amounts.

## Gotchas

- **Branch Isolation**: Always filter data by `inArray(table.branchId, user.branchIds)` for non-admin users.
- **Credit overrides**: Require `P.sales.overrideCredit` permission and must be logged.
- **Currency**: Use `formatDA(n)` for display; `parseFloat()` when converting UI input to DB numeric fields.
- **Codegen**: After any changes to `openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
