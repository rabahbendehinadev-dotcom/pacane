import { Router, type IRouter } from "express";
import { db, stockLevelsTable, stockMovementsTable, productsTable, branchesTable, unitsTable, categoriesTable } from "@workspace/db";
import { eq, and, sql, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, assertBranchAccess, visibleBranchIds } from "../middlewares/permissions";
import { P } from "../lib/permissions";

const router: IRouter = Router();

router.get("/stock", requireAuth, requirePermission(P.stock.view), async (req, res): Promise<void> => {
  const { branchId, type, alert, categoryId } = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);
  if (scope !== null && scope.length === 0) { res.json([]); return; }

  const rows = await db.select({
    sl: stockLevelsTable,
    productName: productsTable.name,
    productType: productsTable.type,
    productCategoryId: productsTable.categoryId,
    alertQty: productsTable.alertQuantity,
    costPrice: productsTable.costPrice,
    branchName: branchesTable.name,
    unitName: unitsTable.abbreviation,
    categoryName: categoriesTable.name,
  }).from(stockLevelsTable)
    .leftJoin(productsTable, eq(stockLevelsTable.productId, productsTable.id))
    .leftJoin(branchesTable, eq(stockLevelsTable.branchId, branchesTable.id))
    .leftJoin(unitsTable, eq(productsTable.unitId, unitsTable.id))
    .leftJoin(categoriesTable, eq(productsTable.categoryId, categoriesTable.id))
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
      categoryId: r.productCategoryId ?? null, categoryName: r.categoryName ?? null,
      branchId: r.sl.branchId, branchName: r.branchName ?? "", quantity: qty,
      alertQuantity: alertQty, unitName: r.unitName ?? "", status,
      valueCost: qty * parseFloat(r.costPrice as string ?? "0")
    };
  });
  if (scope !== null) result = result.filter(r => scope.includes(r.branchId));
  if (branchId) result = result.filter(r => r.branchId === parseInt(branchId, 10));
  if (type) result = result.filter(r => r.productType === type);
  if (categoryId) result = result.filter(r => r.categoryId === parseInt(categoryId, 10));
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

router.get("/stock/ruptures", requireAuth, requirePermission(P.stock.view), async (req, res): Promise<void> => {
  const { branchId, branchIds, productId, dateFrom, dateTo, status } = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);
  if (scope !== null && scope.length === 0) { res.json([]); return; }

  // Resolve requested branch IDs: branchIds (comma-separated multi) or branchId (single)
  let requestedBranchIds: number[] | null = null;
  if (branchIds) {
    requestedBranchIds = branchIds.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
  } else if (branchId) {
    requestedBranchIds = [parseInt(branchId, 10)];
  }

  // Intersect with permission scope
  let effectiveBranchIds: number[] | null = requestedBranchIds;
  if (scope !== null) {
    effectiveBranchIds = requestedBranchIds
      ? requestedBranchIds.filter(id => scope.includes(id))
      : scope;
    if (effectiveBranchIds.length === 0) { res.json([]); return; }
  }

  // Build DB-level conditions (push branch/product/dateTo into SQL to avoid loading irrelevant data)
  const conditions = [];
  if (effectiveBranchIds !== null) conditions.push(inArray(stockMovementsTable.branchId, effectiveBranchIds));
  if (productId) conditions.push(eq(stockMovementsTable.productId, parseInt(productId, 10)));
  if (dateTo) {
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);
    conditions.push(sql`${stockMovementsTable.createdAt} <= ${to.toISOString()}`);
  }

  const rows = await db.select({
    sm: stockMovementsTable,
    productName: productsTable.name,
    branchName: branchesTable.name,
  }).from(stockMovementsTable)
    .leftJoin(productsTable, eq(stockMovementsTable.productId, productsTable.id))
    .leftJoin(branchesTable, eq(stockMovementsTable.branchId, branchesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(
      stockMovementsTable.productId,
      stockMovementsTable.branchId,
      stockMovementsTable.createdAt,
      stockMovementsTable.id
    );

  // Group movements by (productId, branchId)
  const groups = new Map<string, {
    productId: number; productName: string;
    branchId: number; branchName: string;
    movements: { delta: number; createdAt: Date }[];
  }>();
  for (const r of rows) {
    const key = `${r.sm.productId}_${r.sm.branchId}`;
    if (!groups.has(key)) {
      groups.set(key, {
        productId: r.sm.productId, productName: r.productName ?? "",
        branchId: r.sm.branchId, branchName: r.branchName ?? "",
        movements: [],
      });
    }
    groups.get(key)!.movements.push({
      delta: parseFloat(r.sm.quantity as string),
      createdAt: r.sm.createdAt,
    });
  }

  // Simulate running balance per group applying floor(0), detect rupture/restock events
  const ruptures: Array<{
    productId: number; productName: string;
    branchId: number; branchName: string;
    ruptureAt: string; restockedAt: string | null;
    durationHours: number; status: string;
  }> = [];
  const now = new Date();

  for (const group of groups.values()) {
    let balance = 0;
    let inRupture = false;
    let ruptureAt: Date | null = null;

    for (const m of group.movements) {
      const prevBalance = balance;
      balance = Math.max(0, balance + m.delta);

      if (!inRupture && prevBalance > 0 && balance === 0) {
        inRupture = true;
        ruptureAt = m.createdAt;
      } else if (inRupture && ruptureAt && prevBalance === 0 && balance > 0) {
        const durationHours = (m.createdAt.getTime() - ruptureAt.getTime()) / 3_600_000;
        ruptures.push({
          productId: group.productId, productName: group.productName,
          branchId: group.branchId, branchName: group.branchName,
          ruptureAt: ruptureAt.toISOString(),
          restockedAt: m.createdAt.toISOString(),
          durationHours: Math.round(durationHours * 100) / 100,
          status: "resolved",
        });
        inRupture = false;
        ruptureAt = null;
      }
    }

    // Still in rupture after all movements
    if (inRupture && ruptureAt) {
      const durationHours = (now.getTime() - ruptureAt.getTime()) / 3_600_000;
      ruptures.push({
        productId: group.productId, productName: group.productName,
        branchId: group.branchId, branchName: group.branchName,
        ruptureAt: ruptureAt.toISOString(),
        restockedAt: null,
        durationHours: Math.round(durationHours * 100) / 100,
        status: "ongoing",
      });
    }
  }

  // Post-simulation filters
  let result = ruptures;
  if (status) result = result.filter(r => r.status === status);
  if (dateFrom) {
    const from = new Date(dateFrom);
    from.setHours(0, 0, 0, 0);
    result = result.filter(r => new Date(r.ruptureAt) >= from || (r.restockedAt !== null && new Date(r.restockedAt) >= from));
  }

  result.sort((a, b) => new Date(b.ruptureAt).getTime() - new Date(a.ruptureAt).getTime());
  res.json(result);
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
  const productId = parseInt(req.params.productId as string, 10);
  const branchId = parseInt(req.params.branchId as string, 10);
  const { newQuantity, reason } = req.body;
  if (newQuantity == null || newQuantity < 0) { res.status(400).json({ error: "Quantité invalide" }); return; }

  const [existing] = await db.select().from(stockLevelsTable)
    .where(and(eq(stockLevelsTable.productId, productId), eq(stockLevelsTable.branchId, branchId)));

  const currentQty = existing ? parseFloat(existing.quantity as string) : 0;
  const delta = newQuantity - currentQty;

  // Atomic UPSERT — safe against concurrent adjustments
  await db.execute(
    sql`INSERT INTO stock_levels (product_id, branch_id, quantity, updated_at)
        VALUES (${productId}, ${branchId}, ${newQuantity}::numeric, NOW())
        ON CONFLICT (product_id, branch_id) DO UPDATE
        SET quantity = ${newQuantity}::numeric,
            updated_at = NOW()`
  );

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

/**
 * Atomic stock adjustment using UPSERT.
 * Safe for concurrent calls — no read-modify-write race condition.
 * Floors at 0 for production/transfer/adjustment use-cases.
 *
 * @param txOrDb - pass a Drizzle transaction context to participate in a tx, or omit for standalone
 */
export async function adjustStock(
  productId: number,
  branchId: number,
  quantityChange: number,
  type: string,
  reference: string | null = null,
  unitCost: number = 0,
  referenceId: number | null = null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  txOrDb: any = db
) {
  await txOrDb.execute(
    sql`INSERT INTO stock_levels (product_id, branch_id, quantity, updated_at)
        VALUES (${productId}, ${branchId}, GREATEST(0, ${quantityChange}::numeric), NOW())
        ON CONFLICT (product_id, branch_id) DO UPDATE
        SET quantity = GREATEST(0, stock_levels.quantity + ${quantityChange}::numeric),
            updated_at = NOW()`
  );
  await txOrDb.insert(stockMovementsTable).values({
    type, productId, branchId,
    quantity: quantityChange.toString(),
    unitCost: unitCost.toString(),
    reference, referenceId,
  });
}

/**
 * Atomic check-and-deduct for POS/sale use-cases.
 * Executes a single atomic UPDATE that only succeeds if stock >= qty.
 * Must be called inside a db.transaction() so that a failed deduction
 * rolls back all prior inserts in the same request.
 *
 * Throws an error with { message: "STOCK_INSUFFICIENT", productId, productName }
 * if the deduction cannot be satisfied.
 *
 * @param txOrDb - Drizzle transaction context (required for atomicity)
 */
export async function deductStockChecked(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  txOrDb: any,
  productId: number,
  branchId: number,
  qty: number,
  type: string,
  reference: string | null = null,
  unitCost: number = 0,
  referenceId: number | null = null,
  productName = ""
) {
  const result = await txOrDb.execute(
    sql`UPDATE stock_levels
        SET quantity = quantity - ${qty}::numeric,
            updated_at = NOW()
        WHERE product_id = ${productId}
          AND branch_id = ${branchId}
          AND quantity >= ${qty}::numeric
        RETURNING quantity`
  );

  if (!result.rows?.length) {
    const err: Error & { productId?: number; productName?: string } = new Error("STOCK_INSUFFICIENT");
    err.productId = productId;
    err.productName = productName;
    throw err;
  }

  await txOrDb.insert(stockMovementsTable).values({
    type, productId, branchId,
    quantity: (-qty).toString(),
    unitCost: unitCost.toString(),
    reference, referenceId,
  });
}

export default router;
