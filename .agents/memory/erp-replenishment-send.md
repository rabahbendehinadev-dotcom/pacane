---
name: ERP replenishment send flow
description: Architecture of the preparation orders send feature in Pacane ERP
---

The "Envoyer aux ouvriers" (send to workers) feature converts replenishment calculation results into per-worker preparation orders.

**Why:** Workers need individual task lists derived from the replenishment plan. Each worker gets a separate `preparation_order` record with its own reference (OP-YYYY-NNNN).

**How it works:**
- POST `/api/preparation-orders/send` groups `items[]` by `workerId`, creates one order per worker, inserts items
- 409 response signals duplicate order (same branch+date+worker) — client can retry with `force: true`
- 422 response signals unassigned products (no workerId on item)
- Workers see their orders at GET `/api/my-preparations` — filtered by `user.workerId`
- `user.workerId` comes from `users.worker_id` FK column (set via PATCH `/api/users/:id`)
- Opening an order auto-marks it `viewed` (first fetch sets viewedAt)

**Dialog placement:** The send confirmation Dialog must be inside `ReplenishmentPage` function body (same scope as `sendModalOpen` state), not inside the helper `ReplenishmentTable` function below it.
