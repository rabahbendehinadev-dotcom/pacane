import { Router, type IRouter } from "express";
import { db, adjustmentsTable, adjustmentItemsTable, adjustmentAuditLogsTable, branchesTable, productsTable, usersTable, workersTable, saleItemsTable, salesTable } from "@workspace/db";
import { eq, sql, and, gte, lte, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, visibleBranchIds } from "../middlewares/permissions";
import { P } from "../lib/permissions";
import { adjustStock } from "./stock";

const router: IRouter = Router();

function genRef() { return `ADJ-${Date.now()}`; }

function applyDateFilter(rows: { adj: { createdAt: string | Date } }[], dateFrom?: string, dateTo?: string) {
  let filtered = rows;
  if (dateFrom) {
    const from = new Date(dateFrom); from.setHours(0, 0, 0, 0);
    filtered = filtered.filter(r => new Date(r.adj.createdAt) >= from);
  }
  if (dateTo) {
    const to = new Date(dateTo); to.setHours(23, 59, 59, 999);
    filtered = filtered.filter(r => new Date(r.adj.createdAt) <= to);
  }
  return filtered;
}

async function computeOverallStatus(adjustmentId: number): Promise<string> {
  const items = await db.select({ itemStatus: adjustmentItemsTable.itemStatus })
    .from(adjustmentItemsTable)
    .where(eq(adjustmentItemsTable.adjustmentId, adjustmentId));
  if (items.length === 0) return "en_attente";
  const statuses = items.map(i => i.itemStatus);
  if (statuses.every(s => s === "confirme")) return "confirme";
  if (statuses.some(s => s === "non_confirme")) return "non_confirme";
  return "en_attente";
}

async function writeAuditLog(adjustmentId: number, userId: number | undefined, userName: string | null, action: string, details?: object) {
  await db.insert(adjustmentAuditLogsTable).values({
    adjustmentId,
    userId: userId ?? null,
    userName: userName ?? null,
    action,
    details: details ? JSON.stringify(details) : null,
  });
}

async function notifyAdminsNonConfirme(adjustmentId: number, reference: string, itemProductName: string) {
  try {
    const { sendPushToUsers } = await import("../lib/push-service");
    const admins = await db.select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.adminAccess, true));
    const adminIds = admins.map(u => u.id);
    if (adminIds.length > 0) {
      await sendPushToUsers(adminIds, {
        title: "⚠️ Ajustement non confirmé",
        body: `${itemProductName} — ${reference}`,
        data: { type: "adjustment_non_confirme", adjustmentId },
      });
    }
  } catch { /* push non-critique */ }
}

// ── Stats ──────────────────────────────────────────────────────────────────
router.get("/adjustments/stats", requireAuth, requirePermission(P.adjustments.view), async (req, res): Promise<void> => {
  const { branchId, dateFrom, dateTo, reason } = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);
  if (scope !== null && scope.length === 0) {
    res.json({ totalPerteQuantite: 0, totalPerteValeur: 0, countPertes: 0, byReason: [] });
    return;
  }

  // Single-item adjustments
  const rows = await db.select({ adj: adjustmentsTable, costPrice: productsTable.costPrice })
    .from(adjustmentsTable)
    .leftJoin(productsTable, eq(adjustmentsTable.productId, productsTable.id));

  // Multi-item adjustments via items table
  const itemRows = await db.select({
    branchId: adjustmentsTable.branchId,
    reason: adjustmentsTable.reason,
    createdAt: adjustmentsTable.createdAt,
    quantityChange: adjustmentItemsTable.quantityChange,
    costPrice: productsTable.costPrice,
  }).from(adjustmentItemsTable)
    .innerJoin(adjustmentsTable, eq(adjustmentItemsTable.adjustmentId, adjustmentsTable.id))
    .leftJoin(productsTable, eq(adjustmentItemsTable.productId, productsTable.id));

  // Legacy single-item
  let filtered = rows.filter(r => r.adj.quantityChange != null && parseFloat(r.adj.quantityChange as string) < 0);
  if (scope !== null) filtered = filtered.filter(r => scope.includes(r.adj.branchId));
  if (branchId) filtered = filtered.filter(r => r.adj.branchId === parseInt(branchId, 10));
  filtered = applyDateFilter(filtered, dateFrom, dateTo) as typeof filtered;
  if (reason) filtered = filtered.filter(r => r.adj.reason === reason);

  let filteredItems = itemRows.filter(r => r.quantityChange != null && parseFloat(r.quantityChange as string) < 0);
  if (scope !== null) filteredItems = filteredItems.filter(r => scope.includes(r.branchId));
  if (branchId) filteredItems = filteredItems.filter(r => r.branchId === parseInt(branchId, 10));
  if (dateFrom) { const f = new Date(dateFrom); f.setHours(0,0,0,0); filteredItems = filteredItems.filter(r => new Date(r.createdAt) >= f); }
  if (dateTo) { const t = new Date(dateTo); t.setHours(23,59,59,999); filteredItems = filteredItems.filter(r => new Date(r.createdAt) <= t); }
  if (reason) filteredItems = filteredItems.filter(r => r.reason === reason);

  const byReasonMap = new Map<string, { count: number; quantite: number; valeur: number }>();
  let totalPerteQuantite = 0;
  let totalPerteValeur = 0;

  for (const r of filtered) {
    const qty = Math.abs(parseFloat(r.adj.quantityChange as string));
    const cost = parseFloat(r.costPrice as string ?? "0");
    const valeur = qty * cost;
    totalPerteQuantite += qty; totalPerteValeur += valeur;
    const ex = byReasonMap.get(r.adj.reason) ?? { count: 0, quantite: 0, valeur: 0 };
    byReasonMap.set(r.adj.reason, { count: ex.count + 1, quantite: ex.quantite + qty, valeur: ex.valeur + valeur });
  }
  for (const r of filteredItems) {
    const qty = Math.abs(parseFloat(r.quantityChange as string));
    const cost = parseFloat(r.costPrice as string ?? "0");
    const valeur = qty * cost;
    totalPerteQuantite += qty; totalPerteValeur += valeur;
    const ex = byReasonMap.get(r.reason) ?? { count: 0, quantite: 0, valeur: 0 };
    byReasonMap.set(r.reason, { count: ex.count + 1, quantite: ex.quantite + qty, valeur: ex.valeur + valeur });
  }

  const byReason = Array.from(byReasonMap.entries())
    .map(([r, v]) => ({ reason: r, ...v }))
    .sort((a, b) => b.valeur - a.valeur);

  res.json({
    totalPerteQuantite: Math.round(totalPerteQuantite * 100) / 100,
    totalPerteValeur: Math.round(totalPerteValeur * 100) / 100,
    countPertes: filtered.length + filteredItems.length,
    byReason,
  });
});

// ── List ───────────────────────────────────────────────────────────────────
router.get("/adjustments", requireAuth, requirePermission(P.adjustments.view), async (req, res): Promise<void> => {
  const { branchId, dateFrom, dateTo, reason, status } = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);
  if (scope !== null && scope.length === 0) { res.json([]); return; }

  const rows = await db.select({
    adj: adjustmentsTable,
    branchName: branchesTable.name,
    productName: productsTable.name,
    createdByName: usersTable.name,
    costPrice: productsTable.costPrice,
    workerOneName: workersTable.name,
  }).from(adjustmentsTable)
    .leftJoin(branchesTable, eq(adjustmentsTable.branchId, branchesTable.id))
    .leftJoin(productsTable, eq(adjustmentsTable.productId, productsTable.id))
    .leftJoin(usersTable, eq(adjustmentsTable.createdByUserId, usersTable.id))
    .leftJoin(workersTable, eq(adjustmentsTable.workerOneId, workersTable.id))
    .orderBy(sql`${adjustmentsTable.createdAt} DESC`);

  // Count items per adjustment for multi-item display
  const itemCounts = await db.select({
    adjustmentId: adjustmentItemsTable.adjustmentId,
    count: sql<number>`COUNT(*)`,
    totalQty: sql<number>`SUM(ABS(${adjustmentItemsTable.quantityChange}::numeric))`,
  }).from(adjustmentItemsTable)
    .groupBy(adjustmentItemsTable.adjustmentId);
  const itemCountMap = new Map(itemCounts.map(r => [r.adjustmentId, { count: Number(r.count), totalQty: Number(r.totalQty) }]));

  let result = rows.map(r => ({
    ...r.adj,
    branchName: r.branchName ?? "",
    productName: r.productName ?? null,
    createdByName: r.createdByName ?? null,
    workerOneName: r.workerOneName ?? null,
    costPrice: r.costPrice != null ? parseFloat(r.costPrice as string) : null,
    quantityChange: r.adj.quantityChange != null ? parseFloat(r.adj.quantityChange as string) : null,
    overallStatus: r.adj.overallStatus ?? null,
    itemsCount: itemCountMap.get(r.adj.id)?.count ?? 0,
    itemsTotalQty: itemCountMap.get(r.adj.id)?.totalQty ?? 0,
  }));

  if (scope !== null) result = result.filter(r => scope.includes(r.branchId));
  if (branchId) result = result.filter(r => r.branchId === parseInt(branchId, 10));
  if (dateFrom) { const f = new Date(dateFrom); f.setHours(0,0,0,0); result = result.filter(r => new Date(r.createdAt) >= f); }
  if (dateTo) { const t = new Date(dateTo); t.setHours(23,59,59,999); result = result.filter(r => new Date(r.createdAt) <= t); }
  if (reason) result = result.filter(r => r.reason === reason);
  if (status) {
    if (status === "en_attente") result = result.filter(r => r.overallStatus === "en_attente");
    else if (status === "confirme") result = result.filter(r => r.overallStatus === "confirme");
    else if (status === "non_confirme") result = result.filter(r => r.overallStatus === "non_confirme");
    else if (status === "legacy") result = result.filter(r => r.overallStatus == null);
  }

  res.json(result);
});

// ── Create ─────────────────────────────────────────────────────────────────
router.post("/adjustments", requireAuth, requirePermission(P.adjustments.create), async (req, res): Promise<void> => {
  const { branchId, reason, notes, photoData, items, productId, quantityChange } = req.body;
  if (!branchId || !reason) { res.status(400).json({ error: "Champs requis manquants" }); return; }

  const isMultiItem = Array.isArray(items) && items.length > 0;
  const isLegacy = !isMultiItem && productId != null && quantityChange != null;

  // Photo required for any déstockage (negative quantity)
  const hasNegative = isMultiItem
    ? items.some((i: any) => parseFloat(i.quantityChange) < 0)
    : quantityChange < 0;

  if (hasNegative && !photoData) {
    res.status(400).json({ error: "Une photo est obligatoire pour tout déstockage", code: "PHOTO_REQUIRED" });
    return;
  }

  if (!isMultiItem && !isLegacy) {
    res.status(400).json({ error: "Fournir soit productId+quantityChange, soit items[]" });
    return;
  }

  const reference = genRef();
  const workerOneId = (req.user as any)?.workerId ?? null;

  if (isMultiItem) {
    // Validate items
    for (const item of items) {
      if (!item.productId || item.quantityChange == null) {
        res.status(400).json({ error: "Chaque item doit avoir productId et quantityChange" });
        return;
      }
    }

    // Create header
    const [adj] = await db.insert(adjustmentsTable).values({
      reference, branchId, reason, notes: notes ?? null,
      photoData: photoData ?? null,
      createdByUserId: req.userId,
      workerOneId,
      overallStatus: "en_attente",
      productId: null,
      quantityChange: null,
    }).returning();

    // Fetch product info for snapshots
    const productIds = items.map((i: any) => i.productId);
    const productRows = await db.select({ id: productsTable.id, name: productsTable.name, sku: productsTable.sku })
      .from(productsTable).where(inArray(productsTable.id, productIds));
    const productMap = new Map(productRows.map(p => [p.id, p]));

    // Insert items and adjust stock for each
    const itemInserts = [];
    for (const item of items) {
      const product = productMap.get(item.productId);
      const qty = parseFloat(item.quantityChange.toString());
      await adjustStock(item.productId, branchId, qty, "adjustment", reference);
      itemInserts.push({
        adjustmentId: adj.id,
        productId: item.productId,
        productNameSnapshot: product?.name ?? `Produit ${item.productId}`,
        skuSnapshot: product?.sku ?? null,
        quantityChange: qty.toString(),
        itemStatus: "en_attente",
      });
    }
    await db.insert(adjustmentItemsTable).values(itemInserts);

    // Audit log
    const creatorRow = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
    await writeAuditLog(adj.id, req.userId, creatorRow[0]?.name ?? null, "created", {
      branchId, reason, itemCount: items.length, reference,
    });

    const [branch] = await db.select().from(branchesTable).where(eq(branchesTable.id, branchId));
    res.status(201).json({
      ...adj,
      branchName: branch?.name ?? "",
      itemsCount: items.length,
      overallStatus: "en_attente",
    });

  } else {
    // Legacy single-item
    const qty = parseFloat(quantityChange.toString());
    const [adj] = await db.insert(adjustmentsTable).values({
      reference, branchId,
      productId: productId ?? null,
      quantityChange: qty.toString(),
      reason, notes: notes ?? null,
      photoData: photoData ?? null,
      createdByUserId: req.userId,
      workerOneId,
      overallStatus: "en_attente",
    }).returning();

    // Insert item row for confirmation tracking
    const [product] = await db.select({ name: productsTable.name, sku: productsTable.sku })
      .from(productsTable).where(eq(productsTable.id, productId)).limit(1);

    await db.insert(adjustmentItemsTable).values({
      adjustmentId: adj.id,
      productId,
      productNameSnapshot: product?.name ?? `Produit ${productId}`,
      skuSnapshot: product?.sku ?? null,
      quantityChange: qty.toString(),
      itemStatus: "en_attente",
    });

    await adjustStock(productId, branchId, qty, "adjustment", reference);

    const creatorRow = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
    await writeAuditLog(adj.id, req.userId, creatorRow[0]?.name ?? null, "created", { branchId, reason, productId, quantityChange: qty, reference });

    const [branch] = await db.select().from(branchesTable).where(eq(branchesTable.id, branchId));
    const [prod] = await db.select({ name: productsTable.name, costPrice: productsTable.costPrice }).from(productsTable).where(eq(productsTable.id, productId));
    res.status(201).json({
      ...adj,
      branchName: branch?.name ?? "",
      productName: prod?.name ?? "",
      quantityChange: qty,
      costPrice: prod?.costPrice != null ? parseFloat(prod.costPrice as string) : null,
      overallStatus: "en_attente",
      itemsCount: 1,
    });
  }
});

// ── Sold quantities (batch) ────────────────────────────────────────────────
router.get("/adjustments/sold-quantities", requireAuth, requirePermission(P.adjustments.view), async (req, res): Promise<void> => {
  const { productIds: productIdsRaw, dates: datesRaw, branchId, branchIds } = req.query as Record<string, string>;
  if (!productIdsRaw) { res.json({}); return; }

  const productIds = productIdsRaw.split(",").map(x => parseInt(x.trim(), 10)).filter(Boolean);
  if (productIds.length === 0) { res.json({}); return; }

  const scope = visibleBranchIds(req.user!);
  if (scope !== null && scope.length === 0) { res.json({}); return; }

  const conds: any[] = [
    inArray(saleItemsTable.productId, productIds),
    sql`${salesTable.type} IN ('order', 'sale')`,
  ];
  if (scope !== null) conds.push(inArray(salesTable.branchId, scope));
  if (branchIds) {
    const ids = branchIds.split(",").map(x => parseInt(x.trim(), 10)).filter(Boolean);
    const allowed = scope !== null ? ids.filter(id => scope.includes(id)) : ids;
    if (allowed.length > 0) conds.push(inArray(salesTable.branchId, allowed));
  } else if (branchId) {
    conds.push(eq(salesTable.branchId, parseInt(branchId, 10)));
  }
  const dates = datesRaw
    ? datesRaw.split(",").map(d => d.trim()).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    : [];
  if (dates.length > 0) {
    conds.push(sql`DATE(${salesTable.createdAt}) IN (${sql.raw(dates.map(d => `'${d}'`).join(","))})`);
  }

  const rows = await db.select({
    productId: saleItemsTable.productId,
    saleDate: sql<string>`DATE(${salesTable.createdAt})`,
    soldQty: sql<number>`COALESCE(SUM(${saleItemsTable.quantity}::numeric), 0)`,
  }).from(saleItemsTable)
    .innerJoin(salesTable, eq(saleItemsTable.saleId, salesTable.id))
    .where(and(...conds))
    .groupBy(saleItemsTable.productId, sql`DATE(${salesTable.createdAt})`);

  const result: Record<string, number> = {};
  for (const r of rows) result[`${r.productId}_${r.saleDate}`] = Number(r.soldQty);
  res.json(result);
});

// ── Sales context ──────────────────────────────────────────────────────────
router.get("/adjustments/sales-context", requireAuth, requirePermission(P.adjustments.view), async (req, res): Promise<void> => {
  const { productId, productIds: productIdsRaw, dateFrom, dateTo, branchId, branchIds } = req.query as Record<string, string>;
  const ids: number[] = productIdsRaw
    ? productIdsRaw.split(",").map(x => parseInt(x.trim(), 10)).filter(Boolean)
    : productId ? [parseInt(productId, 10)] : [];
  if (ids.length === 0) { res.json({ soldQty: 0, soldValue: 0 }); return; }

  const scope = visibleBranchIds(req.user!);
  if (scope !== null && scope.length === 0) { res.json({ soldQty: 0, soldValue: 0 }); return; }

  const conds: any[] = [
    ids.length === 1 ? eq(saleItemsTable.productId, ids[0]) : inArray(saleItemsTable.productId, ids),
    sql`${salesTable.type} IN ('order', 'sale')`,
  ];
  if (scope !== null) conds.push(inArray(salesTable.branchId, scope));
  if (branchIds) {
    const bIds = branchIds.split(",").map(x => parseInt(x.trim(), 10)).filter(Boolean);
    const allowed = scope !== null ? bIds.filter(id => scope.includes(id)) : bIds;
    if (allowed.length > 0) conds.push(inArray(salesTable.branchId, allowed));
  } else if (branchId) {
    conds.push(eq(salesTable.branchId, parseInt(branchId, 10)));
  }
  if (dateFrom) conds.push(gte(salesTable.createdAt, new Date(dateFrom)));
  if (dateTo) { const d = new Date(dateTo); d.setHours(23, 59, 59, 999); conds.push(lte(salesTable.createdAt, d)); }

  const [row] = await db.select({
    soldQty:   sql<number>`COALESCE(SUM(${saleItemsTable.quantity}::numeric), 0)`,
    soldValue: sql<number>`COALESCE(SUM(${saleItemsTable.quantity}::numeric * ${saleItemsTable.unitPrice}::numeric), 0)`,
  }).from(saleItemsTable)
    .innerJoin(salesTable, eq(saleItemsTable.saleId, salesTable.id))
    .where(and(...conds));

  res.json({ soldQty: Number(row?.soldQty ?? 0), soldValue: Number(row?.soldValue ?? 0) });
});

// ── Detail ─────────────────────────────────────────────────────────────────
router.get("/adjustments/:id", requireAuth, requirePermission(P.adjustments.view), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [row] = await db.select({
    adj: adjustmentsTable,
    branchName: branchesTable.name,
    productName: productsTable.name,
    createdByName: usersTable.name,
    costPrice: productsTable.costPrice,
    workerOneName: workersTable.name,
  }).from(adjustmentsTable)
    .leftJoin(branchesTable, eq(adjustmentsTable.branchId, branchesTable.id))
    .leftJoin(productsTable, eq(adjustmentsTable.productId, productsTable.id))
    .leftJoin(usersTable, eq(adjustmentsTable.createdByUserId, usersTable.id))
    .leftJoin(workersTable, eq(adjustmentsTable.workerOneId, workersTable.id))
    .where(eq(adjustmentsTable.id, id));

  if (!row) { res.status(404).json({ error: "Ajustement introuvable" }); return; }

  const items = await db.select({
    item: adjustmentItemsTable,
    confirmedByName: usersTable.name,
  }).from(adjustmentItemsTable)
    .leftJoin(usersTable, eq(adjustmentItemsTable.confirmedByUserId, usersTable.id))
    .where(eq(adjustmentItemsTable.adjustmentId, id))
    .orderBy(adjustmentItemsTable.id);

  const auditLogs = await db.select()
    .from(adjustmentAuditLogsTable)
    .where(eq(adjustmentAuditLogsTable.adjustmentId, id))
    .orderBy(adjustmentAuditLogsTable.createdAt);

  res.json({
    ...row.adj,
    branchName: row.branchName ?? "",
    productName: row.productName ?? null,
    createdByName: row.createdByName ?? null,
    workerOneName: row.workerOneName ?? null,
    costPrice: row.costPrice != null ? parseFloat(row.costPrice as string) : null,
    quantityChange: row.adj.quantityChange != null ? parseFloat(row.adj.quantityChange as string) : null,
    overallStatus: row.adj.overallStatus ?? null,
    items: items.map(i => ({
      ...i.item,
      quantityChange: parseFloat(i.item.quantityChange as string),
      confirmedByName: i.confirmedByName ?? null,
    })),
    auditLogs,
  });
});

// ── Confirm item ───────────────────────────────────────────────────────────
router.post("/adjustments/:id/items/:itemId/confirm", requireAuth, requirePermission(P.adjustments.confirm), async (req, res): Promise<void> => {
  const adjId = parseInt(req.params.id, 10);
  const itemId = parseInt(req.params.itemId, 10);
  if (isNaN(adjId) || isNaN(itemId)) { res.status(400).json({ error: "ID invalide" }); return; }

  // Fetch adjustment
  const [adj] = await db.select().from(adjustmentsTable).where(eq(adjustmentsTable.id, adjId)).limit(1);
  if (!adj) { res.status(404).json({ error: "Ajustement introuvable" }); return; }

  // Guard: same person cannot create + confirm
  if (adj.createdByUserId === req.userId) {
    res.status(403).json({ error: "Vous ne pouvez pas confirmer un ajustement que vous avez créé", code: "SELF_CONFIRM_FORBIDDEN" });
    return;
  }

  // Fetch item
  const [item] = await db.select().from(adjustmentItemsTable)
    .where(and(eq(adjustmentItemsTable.id, itemId), eq(adjustmentItemsTable.adjustmentId, adjId)));
  if (!item) { res.status(404).json({ error: "Article introuvable" }); return; }
  if (item.itemStatus !== "en_attente") { res.status(409).json({ error: "Cet article a déjà été traité" }); return; }

  // Update item
  await db.update(adjustmentItemsTable).set({
    itemStatus: "confirme",
    confirmedByUserId: req.userId,
    confirmedAt: new Date(),
  }).where(eq(adjustmentItemsTable.id, itemId));

  // Recompute overall status
  const overall = await computeOverallStatus(adjId);
  await db.update(adjustmentsTable).set({
    overallStatus: overall,
    confirmedByUserId: req.userId,
    confirmedAt: new Date(),
  }).where(eq(adjustmentsTable.id, adjId));

  const confirmerRow = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
  await writeAuditLog(adjId, req.userId, confirmerRow[0]?.name ?? null, "item_confirmed", {
    itemId, productName: item.productNameSnapshot, quantityChange: item.quantityChange,
  });

  res.json({ success: true, overallStatus: overall, itemStatus: "confirme" });
});

// ── Reject item ────────────────────────────────────────────────────────────
router.post("/adjustments/:id/items/:itemId/reject", requireAuth, requirePermission(P.adjustments.confirm), async (req, res): Promise<void> => {
  const adjId = parseInt(req.params.id, 10);
  const itemId = parseInt(req.params.itemId, 10);
  if (isNaN(adjId) || isNaN(itemId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { rejectionReason, rejectionPhotoData } = req.body;
  if (!rejectionReason) { res.status(400).json({ error: "Le motif de refus est obligatoire", code: "REASON_REQUIRED" }); return; }
  if (!rejectionPhotoData) { res.status(400).json({ error: "Une photo est obligatoire pour le refus", code: "PHOTO_REQUIRED" }); return; }

  const [adj] = await db.select().from(adjustmentsTable).where(eq(adjustmentsTable.id, adjId)).limit(1);
  if (!adj) { res.status(404).json({ error: "Ajustement introuvable" }); return; }

  if (adj.createdByUserId === req.userId) {
    res.status(403).json({ error: "Vous ne pouvez pas confirmer un ajustement que vous avez créé", code: "SELF_CONFIRM_FORBIDDEN" });
    return;
  }

  const [item] = await db.select().from(adjustmentItemsTable)
    .where(and(eq(adjustmentItemsTable.id, itemId), eq(adjustmentItemsTable.adjustmentId, adjId)));
  if (!item) { res.status(404).json({ error: "Article introuvable" }); return; }
  if (item.itemStatus !== "en_attente") { res.status(409).json({ error: "Cet article a déjà été traité" }); return; }

  await db.update(adjustmentItemsTable).set({
    itemStatus: "non_confirme",
    rejectionReason,
    rejectionPhotoData,
    confirmedByUserId: req.userId,
    confirmedAt: new Date(),
  }).where(eq(adjustmentItemsTable.id, itemId));

  const overall = await computeOverallStatus(adjId);
  await db.update(adjustmentsTable).set({
    overallStatus: overall,
    confirmedByUserId: req.userId,
    confirmedAt: new Date(),
  }).where(eq(adjustmentsTable.id, adjId));

  const confirmerRow = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
  await writeAuditLog(adjId, req.userId, confirmerRow[0]?.name ?? null, "item_rejected", {
    itemId, productName: item.productNameSnapshot, rejectionReason,
  });

  // Notify admins
  const [adjRef] = await db.select({ reference: adjustmentsTable.reference }).from(adjustmentsTable).where(eq(adjustmentsTable.id, adjId)).limit(1);
  await notifyAdminsNonConfirme(adjId, adjRef?.reference ?? "", item.productNameSnapshot);

  res.json({ success: true, overallStatus: overall, itemStatus: "non_confirme" });
});

// ── Delete ─────────────────────────────────────────────────────────────────
router.delete("/adjustments/:id", requireAuth, requirePermission(P.adjustments.create), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [adj] = await db.select().from(adjustmentsTable).where(eq(adjustmentsTable.id, id));
  if (!adj) { res.status(404).json({ error: "Ajustement introuvable" }); return; }

  // Block deletion if already confirmed
  if (adj.overallStatus === "confirme") {
    res.status(409).json({ error: "Impossible de supprimer un ajustement déjà confirmé", code: "ALREADY_CONFIRMED" });
    return;
  }

  // Reverse stock: legacy single-item
  if (adj.productId != null && adj.quantityChange != null) {
    const reversal = -parseFloat(adj.quantityChange as string);
    await adjustStock(adj.productId, adj.branchId, reversal, "adjustment", `REV-${adj.reference}`);
  }

  // Reverse stock: multi-item
  const items = await db.select().from(adjustmentItemsTable).where(eq(adjustmentItemsTable.adjustmentId, id));
  for (const item of items) {
    if (adj.productId == null) { // only reverse if it's a multi-item adj (not already reversed above)
      const reversal = -parseFloat(item.quantityChange as string);
      await adjustStock(item.productId, adj.branchId, reversal, "adjustment", `REV-${adj.reference}`);
    }
  }

  const deleterRow = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
  await writeAuditLog(id, req.userId, deleterRow[0]?.name ?? null, "deleted", { reference: adj.reference });

  await db.delete(adjustmentsTable).where(eq(adjustmentsTable.id, id));
  res.json({ success: true });
});

export default router;
