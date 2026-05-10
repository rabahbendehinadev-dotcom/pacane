import { Router, type IRouter } from "express";
import { db, stockLevelsTable, stockMovementsTable, productsTable, branchesTable, unitsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, assertBranchAccess, visibleBranchIds } from "../middlewares/permissions";
import { P } from "../lib/permissions";

const router: IRouter = Router();

router.get("/stock", requireAuth, requirePermission(P.stock.view), async (req, res): Promise<void> => {
  const { branchId, type, alert } = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);
  if (scope !== null && scope.length === 0) { res.json([]); return; }

  const rows = await db.select({
    sl: stockLevelsTable,
    productName: productsTable.name,
    productType: productsTable.type,
    alertQty: productsTable.alertQuantity,
    costPrice: productsTable.costPrice,
    branchName: branchesTable.name,
    unitName: unitsTable.abbreviation
  }).from(stockLevelsTable)
    .leftJoin(productsTable, eq(stockLevelsTable.productId, productsTable.id))
    .leftJoin(branchesTable, eq(stockLevelsTable.branchId, branchesTable.id))
    .leftJoin(unitsTable, eq(productsTable.unitId, unitsTable.id))
    .orderBy(productsTable.name);

  let result = rows.map(r => {
    const qty = parseFloat(r.sl.quantity as string);
    const alertQty = r.alertQty ? parseFloat(r.alertQty as string) : null;
    let status: "ok" | "low" | "critical" | "out" = "ok";
    if (qty === 0) status = "out";
    else if (alertQty && qty <= alertQty * 0.5) status = "critical";
    else if (alertQty && qty <= alertQty) status = "low";
    return {
      productId: r.sl.productId, productName: r.productName ?? "", productType: r.productType ?? "",
      branchId: r.sl.branchId, branchName: r.branchName ?? "", quantity: qty,
      alertQuantity: alertQty, unitName: r.unitName ?? "", status,
      valueCost: qty * parseFloat(r.costPrice as string ?? "0")
    };
  });
  if (scope !== null) result = result.filter(r => scope.includes(r.branchId));
  if (branchId) result = result.filter(r => r.branchId === parseInt(branchId, 10));
  if (type) result = result.filter(r => r.productType === type);
  if (alert) result = result.filter(r => r.status === alert || (alert === "alert" && r.status !== "ok"));
  res.json(result);
});

router.get("/stock/alerts", requireAuth, requirePermission(P.stock.view), async (req, res): Promise<void> => {
  const scope = visibleBranchIds(req.user!);
  if (scope !== null && scope.length === 0) { res.json([]); return; }

  const rows = await db.select({
    sl: stockLevelsTable,
    productName: productsTable.name,
    alertQty: productsTable.alertQuantity,
    branchName: branchesTable.name,
    unitName: unitsTable.abbreviation
  }).from(stockLevelsTable)
    .leftJoin(productsTable, eq(stockLevelsTable.productId, productsTable.id))
    .leftJoin(branchesTable, eq(stockLevelsTable.branchId, branchesTable.id))
    .leftJoin(unitsTable, eq(productsTable.unitId, unitsTable.id));

  const alerts = rows.filter(r => {
    if (scope !== null && !scope.includes(r.sl.branchId)) return false;
    const qty = parseFloat(r.sl.quantity as string);
    const alertQty = r.alertQty ? parseFloat(r.alertQty as string) : null;
    return alertQty !== null && qty <= alertQty;
  }).map(r => {
    const qty = parseFloat(r.sl.quantity as string);
    const alertQty = parseFloat(r.alertQty as string);
    return {
      productId: r.sl.productId, productName: r.productName ?? "",
      branchId: r.sl.branchId, branchName: r.branchName ?? "",
      quantity: qty, alertQuantity: alertQty, unitName: r.unitName ?? "",
      alertLevel: qty === 0 ? "out" : qty <= alertQty * 0.5 ? "critical" : "low"
    };
  });
  res.json(alerts);
});

router.get("/stock/movements", requireAuth, requirePermission(P.stock.view), async (req, res): Promise<void> => {
  const { branchId, productId, type } = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);
  if (scope !== null && scope.length === 0) { res.json([]); return; }

  const rows = await db.select({
    sm: stockMovementsTable,
    productName: productsTable.name,
    branchName: branchesTable.name
  }).from(stockMovementsTable)
    .leftJoin(productsTable, eq(stockMovementsTable.productId, productsTable.id))
    .leftJoin(branchesTable, eq(stockMovementsTable.branchId, branchesTable.id))
    .orderBy(sql`${stockMovementsTable.createdAt} DESC`)
    .limit(200);

  let result = rows.map(r => ({
    id: r.sm.id, type: r.sm.type, productId: r.sm.productId, productName: r.productName ?? "",
    branchId: r.sm.branchId, branchName: r.branchName ?? "",
    quantity: parseFloat(r.sm.quantity as string), unitCost: parseFloat(r.sm.unitCost as string),
    reference: r.sm.reference, notes: r.sm.notes, createdAt: r.sm.createdAt.toISOString()
  }));
  if (scope !== null) result = result.filter(r => scope.includes(r.branchId));
  if (branchId) result = result.filter(r => r.branchId === parseInt(branchId, 10));
  if (productId) result = result.filter(r => r.productId === parseInt(productId, 10));
  if (type) result = result.filter(r => r.type === type);
  res.json(result);
});

// Admin: direct stock quantity override
router.patch("/stock/:productId/:branchId", requireAuth, requirePermission(P.stock.adjust), async (req, res): Promise<void> => {
  const productId = parseInt(req.params.productId, 10);
  const branchId = parseInt(req.params.branchId, 10);
  const { newQuantity, reason } = req.body;
  if (newQuantity == null || newQuantity < 0) { res.status(400).json({ error: "Quantité invalide" }); return; }

  const [existing] = await db.select().from(stockLevelsTable)
    .where(and(eq(stockLevelsTable.productId, productId), eq(stockLevelsTable.branchId, branchId)));

  const currentQty = existing ? parseFloat(existing.quantity as string) : 0;
  const delta = newQuantity - currentQty;

  if (existing) {
    await db.update(stockLevelsTable).set({ quantity: newQuantity.toString() })
      .where(and(eq(stockLevelsTable.productId, productId), eq(stockLevelsTable.branchId, branchId)));
  } else {
    await db.insert(stockLevelsTable).values({ productId, branchId, quantity: newQuantity.toString() });
  }

  // Record as manual adjustment movement
  await db.insert(stockMovementsTable).values({
    type: "adjustment",
    productId, branchId,
    quantity: delta.toString(),
    unitCost: "0",
    reference: reason ?? "Correction manuelle",
    referenceId: null,
  });

  res.json({ productId, branchId, newQuantity, delta });
});

export async function adjustStock(productId: number, branchId: number, quantityChange: number, type: string, reference: string | null = null, unitCost: number = 0, referenceId: number | null = null) {
  const [existing] = await db.select().from(stockLevelsTable)
    .where(and(eq(stockLevelsTable.productId, productId), eq(stockLevelsTable.branchId, branchId)));
  if (existing) {
    const newQty = parseFloat(existing.quantity as string) + quantityChange;
    await db.update(stockLevelsTable).set({ quantity: Math.max(0, newQty).toString() })
      .where(and(eq(stockLevelsTable.productId, productId), eq(stockLevelsTable.branchId, branchId)));
  } else {
    await db.insert(stockLevelsTable).values({ productId, branchId, quantity: Math.max(0, quantityChange).toString() });
  }
  await db.insert(stockMovementsTable).values({
    type, productId, branchId, quantity: quantityChange.toString(),
    unitCost: unitCost.toString(), reference, referenceId
  });
}

export default router;
