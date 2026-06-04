import { Router, type IRouter } from "express";
import { db, adjustmentsTable, branchesTable, productsTable, usersTable, saleItemsTable, salesTable } from "@workspace/db";
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
    const from = new Date(dateFrom);
    from.setHours(0, 0, 0, 0);
    filtered = filtered.filter(r => new Date(r.adj.createdAt) >= from);
  }
  if (dateTo) {
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);
    filtered = filtered.filter(r => new Date(r.adj.createdAt) <= to);
  }
  return filtered;
}

router.get("/adjustments/stats", requireAuth, requirePermission(P.adjustments.view), async (req, res): Promise<void> => {
  const { branchId, dateFrom, dateTo, reason } = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);
  if (scope !== null && scope.length === 0) {
    res.json({ totalPerteQuantite: 0, totalPerteValeur: 0, countPertes: 0, byReason: [] });
    return;
  }

  const rows = await db.select({
    adj: adjustmentsTable,
    costPrice: productsTable.costPrice,
  }).from(adjustmentsTable)
    .leftJoin(productsTable, eq(adjustmentsTable.productId, productsTable.id));

  let filtered = rows.filter(r => parseFloat(r.adj.quantityChange as string) < 0);
  if (scope !== null) filtered = filtered.filter(r => scope.includes(r.adj.branchId));
  if (branchId) filtered = filtered.filter(r => r.adj.branchId === parseInt(branchId, 10));
  filtered = applyDateFilter(filtered, dateFrom, dateTo) as typeof filtered;
  if (reason) filtered = filtered.filter(r => r.adj.reason === reason);

  const byReasonMap = new Map<string, { count: number; quantite: number; valeur: number }>();
  let totalPerteQuantite = 0;
  let totalPerteValeur = 0;

  for (const r of filtered) {
    const qty = Math.abs(parseFloat(r.adj.quantityChange as string));
    const cost = parseFloat(r.costPrice as string ?? "0");
    const valeur = qty * cost;
    totalPerteQuantite += qty;
    totalPerteValeur += valeur;

    const existing = byReasonMap.get(r.adj.reason) ?? { count: 0, quantite: 0, valeur: 0 };
    byReasonMap.set(r.adj.reason, {
      count: existing.count + 1,
      quantite: existing.quantite + qty,
      valeur: existing.valeur + valeur,
    });
  }

  const byReason = Array.from(byReasonMap.entries())
    .map(([reason, v]) => ({ reason, ...v }))
    .sort((a, b) => b.valeur - a.valeur);

  res.json({
    totalPerteQuantite: Math.round(totalPerteQuantite * 100) / 100,
    totalPerteValeur: Math.round(totalPerteValeur * 100) / 100,
    countPertes: filtered.length,
    byReason,
  });
});

router.get("/adjustments", requireAuth, requirePermission(P.adjustments.view), async (req, res): Promise<void> => {
  const { branchId, dateFrom, dateTo, reason } = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);
  if (scope !== null && scope.length === 0) { res.json([]); return; }

  const rows = await db.select({
    adj: adjustmentsTable,
    branchName: branchesTable.name,
    productName: productsTable.name,
    createdByName: usersTable.name,
    costPrice: productsTable.costPrice,
  }).from(adjustmentsTable)
    .leftJoin(branchesTable, eq(adjustmentsTable.branchId, branchesTable.id))
    .leftJoin(productsTable, eq(adjustmentsTable.productId, productsTable.id))
    .leftJoin(usersTable, eq(adjustmentsTable.createdByUserId, usersTable.id))
    .orderBy(sql`${adjustmentsTable.createdAt} DESC`);

  let result = rows.map(r => ({
    ...r.adj, branchName: r.branchName ?? "", productName: r.productName ?? "",
    createdByName: r.createdByName ?? null,
    costPrice: r.costPrice != null ? parseFloat(r.costPrice as string) : null,
    quantityChange: parseFloat(r.adj.quantityChange as string)
  }));

  if (scope !== null) result = result.filter(r => scope.includes(r.branchId));
  if (branchId) result = result.filter(r => r.branchId === parseInt(branchId, 10));
  if (dateFrom) {
    const from = new Date(dateFrom); from.setHours(0, 0, 0, 0);
    result = result.filter(r => new Date(r.createdAt) >= from);
  }
  if (dateTo) {
    const to = new Date(dateTo); to.setHours(23, 59, 59, 999);
    result = result.filter(r => new Date(r.createdAt) <= to);
  }
  if (reason) result = result.filter(r => r.reason === reason);

  res.json(result);
});

router.post("/adjustments", requireAuth, requirePermission(P.adjustments.create), async (req, res): Promise<void> => {
  const { branchId, productId, quantityChange, reason, notes, photoData } = req.body;
  if (!branchId || !productId || quantityChange == null || !reason) { res.status(400).json({ error: "Champs requis manquants" }); return; }
  const reference = genRef();
  const [adj] = await db.insert(adjustmentsTable).values({
    reference, branchId, productId, quantityChange: quantityChange.toString(), reason, notes,
    photoData: photoData ?? null,
    createdByUserId: req.userId
  }).returning();
  await adjustStock(productId, branchId, parseFloat(quantityChange.toString()), "adjustment", reference);
  const [branch] = await db.select().from(branchesTable).where(eq(branchesTable.id, branchId));
  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, productId));
  res.status(201).json({ ...adj, branchName: branch?.name ?? "", productName: product?.name ?? "", quantityChange: parseFloat(adj.quantityChange as string) });
});

// ── Batch sold quantities for multiple products (for per-row comparison)
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

  // Filter to specific adjustment dates only (YYYY-MM-DD format validated)
  const dates = datesRaw
    ? datesRaw.split(",").map(d => d.trim()).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    : [];
  if (dates.length > 0) {
    conds.push(sql`DATE(${salesTable.createdAt}) IN (${sql.raw(dates.map(d => `'${d}'`).join(","))})`);
  }

  const rows = await db
    .select({
      productId: saleItemsTable.productId,
      saleDate: sql<string>`DATE(${salesTable.createdAt})`,
      soldQty: sql<number>`COALESCE(SUM(${saleItemsTable.quantity}::numeric), 0)`,
    })
    .from(saleItemsTable)
    .innerJoin(salesTable, eq(saleItemsTable.saleId, salesTable.id))
    .where(and(...conds))
    .groupBy(saleItemsTable.productId, sql`DATE(${salesTable.createdAt})`);

  // Key format: "productId_YYYY-MM-DD"
  const result: Record<string, number> = {};
  for (const r of rows) result[`${r.productId}_${r.saleDate}`] = Number(r.soldQty);
  res.json(result);
});

// ── Sales context: sold qty for one or more products in a period (for loss comparison)
router.get("/adjustments/sales-context", requireAuth, requirePermission(P.adjustments.view), async (req, res): Promise<void> => {
  const { productId, productIds: productIdsRaw, dateFrom, dateTo, branchId, branchIds } = req.query as Record<string, string>;

  // Accept either a single productId or a comma-separated productIds list
  const ids: number[] = productIdsRaw
    ? productIdsRaw.split(",").map(x => parseInt(x.trim(), 10)).filter(Boolean)
    : productId ? [parseInt(productId, 10)] : [];

  if (ids.length === 0) { res.json({ soldQty: 0, soldValue: 0 }); return; }

  const scope = visibleBranchIds(req.user!);
  if (scope !== null && scope.length === 0) { res.json({ soldQty: 0, soldValue: 0 }); return; }

  const conds: any[] = [
    ids.length === 1 ? eq(saleItemsTable.productId, ids[0]) : inArray(saleItemsTable.productId, ids),
    // Only confirmed sales (not drafts/quotations)
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

  if (dateFrom) conds.push(gte(salesTable.createdAt, new Date(dateFrom)));
  if (dateTo) {
    const d = new Date(dateTo); d.setHours(23, 59, 59, 999);
    conds.push(lte(salesTable.createdAt, d));
  }

  const [row] = await db
    .select({
      soldQty:   sql<number>`COALESCE(SUM(${saleItemsTable.quantity}::numeric), 0)`,
      soldValue: sql<number>`COALESCE(SUM(${saleItemsTable.quantity}::numeric * ${saleItemsTable.unitPrice}::numeric), 0)`,
    })
    .from(saleItemsTable)
    .innerJoin(salesTable, eq(saleItemsTable.saleId, salesTable.id))
    .where(and(...conds));

  res.json({ soldQty: Number(row?.soldQty ?? 0), soldValue: Number(row?.soldValue ?? 0) });
});

router.delete("/adjustments/:id", requireAuth, requirePermission(P.adjustments.create), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [adj] = await db.select().from(adjustmentsTable).where(eq(adjustmentsTable.id, id));
  if (!adj) { res.status(404).json({ error: "Ajustement introuvable" }); return; }

  // Reverse the stock change
  const reversal = -parseFloat(adj.quantityChange as string);
  await adjustStock(adj.productId, adj.branchId, reversal, "adjustment", `REV-${adj.reference}`);

  await db.delete(adjustmentsTable).where(eq(adjustmentsTable.id, id));
  res.json({ success: true });
});

export default router;
