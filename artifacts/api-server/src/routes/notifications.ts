/**
 * Notifications / ERP Operational Alerts
 *
 * Architecture: stateless alert generator that upserts real conditions into
 * `erp_alerts` table on every refresh call.  All reads/writes go through this
 * single route file.  Branch-scope is enforced via `visibleBranchIds()`.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  alertsTable,
  productsTable,
  stockLevelsTable,
  branchesTable,
  contactsTable,
  salesReturnsTable,
  salesTable,
  productionOrdersTable,
} from "@workspace/db/schema";
import { eq, and, sql, inArray, isNull, not, isNotNull, or } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { visibleBranchIds } from "../middlewares/permissions";

const router = Router();

// ─── Types ────────────────────────────────────────────────────────────────────

type AlertRow = {
  alertKey: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  module: string;
  branchId: number | null;
  entityId: number | null;
  entityType: string | null;
  meta: Record<string, unknown> | null;
};

// ─── Alert Generator ──────────────────────────────────────────────────────────

async function generateAlerts(allowedBranchIds: number[] | null): Promise<void> {
  const fresh: AlertRow[] = [];

  const allBranches = await db.select().from(branchesTable);

  // ── 1. Stock bas (stock < alertQuantity) ────────────────────────────────────
  const lowStockRows = await db
    .select({
      productId: productsTable.id,
      productName: productsTable.name,
      alertQty: productsTable.alertQuantity,
      branchId: stockLevelsTable.branchId,
      qty: stockLevelsTable.quantity,
      branchName: branchesTable.name,
    })
    .from(stockLevelsTable)
    .innerJoin(productsTable, eq(stockLevelsTable.productId, productsTable.id))
    .innerJoin(branchesTable, eq(stockLevelsTable.branchId, branchesTable.id))
    .where(
      and(
        isNotNull(productsTable.alertQuantity),
        sql`${stockLevelsTable.quantity}::numeric < ${productsTable.alertQuantity}::numeric`,
        allowedBranchIds !== null
          ? inArray(stockLevelsTable.branchId, allowedBranchIds.length > 0 ? allowedBranchIds : [0])
          : sql`true`,
      )
    );

  for (const row of lowStockRows) {
    const qty = parseFloat(row.qty as string);
    const alertQty = parseFloat(row.alertQty as string);
    const severity = qty <= 0 ? "critical" : qty < alertQty * 0.5 ? "critical" : "warning";
    fresh.push({
      alertKey: `stock_low:${row.productId}:${row.branchId}`,
      type: "stock_low",
      severity,
      title: qty <= 0 ? `Rupture de stock — ${row.productName}` : `Stock bas — ${row.productName}`,
      message: qty <= 0
        ? `Stock épuisé dans ${row.branchName}. Seuil d'alerte : ${alertQty} unités.`
        : `Stock actuel : ${qty.toFixed(2)} (seuil : ${alertQty}) dans ${row.branchName}.`,
      module: "stock",
      branchId: row.branchId,
      entityId: row.productId,
      entityType: "product",
      meta: { quantity: qty, alertQuantity: alertQty, branchName: row.branchName },
    });
  }

  // ── 2. Retours en attente > 2 jours ─────────────────────────────────────────
  const pendingReturnsRows = await db
    .select({
      id: salesReturnsTable.id,
      reference: salesReturnsTable.reference,
      branchId: salesReturnsTable.branchId,
      branchName: branchesTable.name,
      createdAt: salesReturnsTable.createdAt,
    })
    .from(salesReturnsTable)
    .innerJoin(branchesTable, eq(salesReturnsTable.branchId, branchesTable.id))
    .where(
      and(
        eq(salesReturnsTable.status, "pending"),
        sql`${salesReturnsTable.createdAt} < now() - interval '2 days'`,
        allowedBranchIds !== null
          ? inArray(salesReturnsTable.branchId, allowedBranchIds.length > 0 ? allowedBranchIds : [0])
          : sql`true`,
      )
    );

  for (const row of pendingReturnsRows) {
    const ageMs = Date.now() - new Date(row.createdAt as Date).getTime();
    const ageDays = Math.floor(ageMs / 86_400_000);
    fresh.push({
      alertKey: `return_pending:${row.id}`,
      type: "return_pending",
      severity: ageDays > 5 ? "critical" : "warning",
      title: `Retour en attente — ${row.reference}`,
      message: `Le retour ${row.reference} dans ${row.branchName} est en attente depuis ${ageDays} jours.`,
      module: "returns",
      branchId: row.branchId,
      entityId: row.id,
      entityType: "return",
      meta: { ageDays, branchName: row.branchName },
    });
  }

  // ── 3. Remboursements en suspens > 3 jours ───────────────────────────────────
  const pendingRefundRows = await db
    .select({
      id: salesReturnsTable.id,
      reference: salesReturnsTable.reference,
      branchId: salesReturnsTable.branchId,
      branchName: branchesTable.name,
      totalAmount: salesReturnsTable.totalAmount,
      refundedAmount: salesReturnsTable.refundedAmount,
      creditAmount: salesReturnsTable.creditAmount,
      updatedAt: salesReturnsTable.updatedAt,
    })
    .from(salesReturnsTable)
    .innerJoin(branchesTable, eq(salesReturnsTable.branchId, branchesTable.id))
    .where(
      and(
        inArray(salesReturnsTable.status, ["confirmed", "partially_refunded"]),
        sql`${salesReturnsTable.updatedAt} < now() - interval '3 days'`,
        allowedBranchIds !== null
          ? inArray(salesReturnsTable.branchId, allowedBranchIds.length > 0 ? allowedBranchIds : [0])
          : sql`true`,
      )
    );

  for (const row of pendingRefundRows) {
    const total = parseFloat(row.totalAmount as string);
    const refunded = parseFloat(row.refundedAmount as string || "0");
    const credited = parseFloat(row.creditAmount as string || "0");
    const due = total - refunded - credited;
    if (due <= 0) continue;
    const ageMs = Date.now() - new Date(row.updatedAt as Date).getTime();
    const ageDays = Math.floor(ageMs / 86_400_000);
    fresh.push({
      alertKey: `refund_pending:${row.id}`,
      type: "refund_pending",
      severity: ageDays > 7 ? "critical" : "warning",
      title: `Remboursement en suspens — ${row.reference}`,
      message: `${formatDA(due)} restant à rembourser sur ${row.reference} (${row.branchName}) depuis ${ageDays} j.`,
      module: "returns",
      branchId: row.branchId,
      entityId: row.id,
      entityType: "return",
      meta: { due, ageDays, branchName: row.branchName },
    });
  }

  // ── 4. Clients dépassant leur limite de crédit ────────────────────────────────
  // Compute unpaid balance from sales and compare with credit_limit
  const creditRiskRows = await db
    .select({
      customerId: salesTable.customerId,
      displayName: contactsTable.displayName,
      creditLimit: contactsTable.creditLimit,
      unpaidBalance: sql<string>`SUM(${salesTable.total}::numeric - ${salesTable.paid}::numeric - COALESCE(${salesTable.creditApplied}::numeric, 0))`,
    })
    .from(salesTable)
    .innerJoin(contactsTable, eq(salesTable.customerId, contactsTable.id))
    .where(
      and(
        eq(salesTable.type, "sale"),
        eq(salesTable.status, "confirmed"),
        not(eq(salesTable.paymentStatus, "paid")),
        isNotNull(salesTable.customerId),
        isNotNull(contactsTable.creditLimit),
        allowedBranchIds !== null
          ? inArray(salesTable.branchId, allowedBranchIds.length > 0 ? allowedBranchIds : [0])
          : sql`true`,
      )
    )
    .groupBy(salesTable.customerId, contactsTable.displayName, contactsTable.creditLimit)
    .having(sql`SUM(${salesTable.total}::numeric - ${salesTable.paid}::numeric - COALESCE(${salesTable.creditApplied}::numeric, 0)) > ${contactsTable.creditLimit}::numeric`);

  for (const row of creditRiskRows) {
    const balance = parseFloat(row.unpaidBalance);
    const limit = parseFloat(row.creditLimit as string);
    const excess = balance - limit;
    const pct = ((excess / limit) * 100).toFixed(0);
    fresh.push({
      alertKey: `credit_limit:${row.customerId}`,
      type: "credit_limit_exceeded",
      severity: excess > limit * 0.5 ? "critical" : "warning",
      title: `Dépassement crédit — ${row.displayName}`,
      message: `Solde impayé ${formatDA(balance)} dépasse la limite ${formatDA(limit)} de ${pct}%.`,
      module: "contacts",
      branchId: null,
      entityId: row.customerId,
      entityType: "contact",
      meta: { balance, limit, excess },
    });
  }

  // ── 5. Ordres de production bloqués (pending > 1 jour sans démarrage) ────────
  const blockedProductionRows = await db
    .select({
      id: productionOrdersTable.id,
      reference: productionOrdersTable.reference,
      branchId: productionOrdersTable.branchId,
      branchName: branchesTable.name,
      createdAt: productionOrdersTable.createdAt,
      status: productionOrdersTable.status,
    })
    .from(productionOrdersTable)
    .innerJoin(branchesTable, eq(productionOrdersTable.branchId, branchesTable.id))
    .where(
      and(
        inArray(productionOrdersTable.status, ["pending", "draft"]),
        sql`${productionOrdersTable.createdAt} < now() - interval '1 day'`,
        allowedBranchIds !== null
          ? inArray(productionOrdersTable.branchId, allowedBranchIds.length > 0 ? allowedBranchIds : [0])
          : sql`true`,
      )
    );

  for (const row of blockedProductionRows) {
    const ageMs = Date.now() - new Date(row.createdAt as Date).getTime();
    const ageDays = Math.floor(ageMs / 86_400_000);
    fresh.push({
      alertKey: `production_blocked:${row.id}`,
      type: "production_blocked",
      severity: ageDays > 3 ? "critical" : "warning",
      title: `Production en attente — ${row.reference}`,
      message: `L'ordre ${row.reference} (${row.branchName}) est en statut "${row.status}" depuis ${ageDays} j. sans être lancé.`,
      module: "production",
      branchId: row.branchId,
      entityId: row.id,
      entityType: "production_order",
      meta: { ageDays, status: row.status, branchName: row.branchName },
    });
  }

  // ── 6. Ventes impayées > 30 jours (créances à risque) ────────────────────────
  const overdueReceivableRows = await db
    .select({
      customerId: salesTable.customerId,
      customerName: contactsTable.displayName,
      totalDue: sql<string>`SUM(${salesTable.total}::numeric - ${salesTable.paid}::numeric - COALESCE(${salesTable.creditApplied}::numeric, 0))`,
      count: sql<string>`COUNT(*)`,
      branchId: salesTable.branchId,
      branchName: branchesTable.name,
    })
    .from(salesTable)
    .innerJoin(contactsTable, eq(salesTable.customerId, contactsTable.id))
    .innerJoin(branchesTable, eq(salesTable.branchId, branchesTable.id))
    .where(
      and(
        eq(salesTable.type, "sale"),
        eq(salesTable.status, "confirmed"),
        not(eq(salesTable.paymentStatus, "paid")),
        isNotNull(salesTable.customerId),
        sql`${salesTable.createdAt} < now() - interval '30 days'`,
        allowedBranchIds !== null
          ? inArray(salesTable.branchId, allowedBranchIds.length > 0 ? allowedBranchIds : [0])
          : sql`true`,
      )
    )
    .groupBy(salesTable.customerId, contactsTable.displayName, salesTable.branchId, branchesTable.name);

  for (const row of overdueReceivableRows) {
    const due = parseFloat(row.totalDue);
    if (due <= 0) continue;
    fresh.push({
      alertKey: `receivable_overdue:${row.customerId}:${row.branchId}`,
      type: "receivable_overdue",
      severity: due > 50_000 ? "critical" : "warning",
      title: `Créance en retard — ${row.customerName}`,
      message: `${formatDA(due)} impayé${row.count > "1" ? ` sur ${row.count} factures` : ""} depuis > 30 jours dans ${row.branchName}.`,
      module: "sales",
      branchId: row.branchId,
      entityId: row.customerId,
      entityType: "contact",
      meta: { due, count: row.count, branchName: row.branchName },
    });
  }

  // ── Upsert all fresh alerts & resolve stale ones ─────────────────────────────
  const freshKeys = fresh.map(a => a.alertKey);

  if (fresh.length > 0) {
    for (const alert of fresh) {
      await db
        .insert(alertsTable)
        .values({ ...alert, resolvedAt: null })
        .onConflictDoUpdate({
          target: alertsTable.alertKey,
          set: {
            severity: alert.severity,
            title: alert.title,
            message: alert.message,
            meta: alert.meta,
            resolvedAt: null,
            updatedAt: new Date(),
          },
        });
    }
  }

  // Mark resolved: keys we generated are no longer in fresh
  if (allowedBranchIds === null && freshKeys.length > 0) {
    await db
      .update(alertsTable)
      .set({ resolvedAt: new Date() })
      .where(
        and(
          isNull(alertsTable.resolvedAt),
          not(inArray(alertsTable.alertKey, freshKeys)),
        )
      );
  } else if (allowedBranchIds === null && freshKeys.length === 0) {
    await db.update(alertsTable).set({ resolvedAt: new Date() }).where(isNull(alertsTable.resolvedAt));
  }
}

function formatDA(n: number) {
  return new Intl.NumberFormat("fr-DZ", { style: "currency", currency: "DZD", minimumFractionDigits: 0 }).format(n);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/notifications — generate + return alerts (branch-scoped)
router.get("/notifications", requireAuth, async (req, res) => {
  const allowed = visibleBranchIds(req.user!);
  const { severity, module: mod, unread, branchId } = req.query as Record<string, string>;

  await generateAlerts(allowed);

  const conditions = [isNull(alertsTable.resolvedAt)];

  if (allowed !== null) {
    const ids = allowed.length > 0 ? allowed : [0];
    conditions.push(or(isNull(alertsTable.branchId), inArray(alertsTable.branchId, ids))!);
  }
  if (severity) conditions.push(eq(alertsTable.severity, severity));
  if (mod) conditions.push(eq(alertsTable.module, mod));
  if (unread === "true") conditions.push(eq(alertsTable.isRead, false));
  if (branchId && branchId !== "all") {
    conditions.push(or(isNull(alertsTable.branchId), eq(alertsTable.branchId, parseInt(branchId, 10)))!);
  }

  const alerts = await db
    .select()
    .from(alertsTable)
    .where(and(...conditions))
    .orderBy(
      sql`CASE ${alertsTable.severity} WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END`,
      sql`${alertsTable.createdAt} DESC`
    )
    .limit(200);

  res.json(alerts);
});

// GET /api/notifications/badge — fast unread count
router.get("/notifications/badge", requireAuth, async (req, res) => {
  const allowed = visibleBranchIds(req.user!);

  const conditions = [isNull(alertsTable.resolvedAt), eq(alertsTable.isRead, false)];
  if (allowed !== null && allowed.length > 0) {
    conditions.push(or(isNull(alertsTable.branchId), inArray(alertsTable.branchId, allowed))!);
  } else if (allowed !== null && allowed.length === 0) {
    conditions.push(sql`false`);
  }

  const [row] = await db
    .select({ count: sql<string>`COUNT(*)` })
    .from(alertsTable)
    .where(and(...conditions));

  res.json({ count: parseInt(row?.count ?? "0", 10) });
});

// POST /api/notifications/:id/read — mark single alert as read
router.post("/notifications/:id/read", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [updated] = await db
    .update(alertsTable)
    .set({ isRead: true, readByUserId: req.user!.id, readAt: new Date() })
    .where(eq(alertsTable.id, id))
    .returning();
  res.json(updated ?? { error: "Not found" });
});

// POST /api/notifications/read-all — mark all (scoped) as read
router.post("/notifications/read-all", requireAuth, async (req, res) => {
  const allowed = visibleBranchIds(req.user!);

  const conditions = [isNull(alertsTable.resolvedAt), eq(alertsTable.isRead, false)];
  if (allowed !== null && allowed.length > 0) {
    conditions.push(or(isNull(alertsTable.branchId), inArray(alertsTable.branchId, allowed))!);
  } else if (allowed !== null && allowed.length === 0) {
    return res.json({ updated: 0 });
  }

  const updated = await db
    .update(alertsTable)
    .set({ isRead: true, readByUserId: req.user!.id, readAt: new Date() })
    .where(and(...conditions))
    .returning({ id: alertsTable.id });

  res.json({ updated: updated.length });
});

export default router;
