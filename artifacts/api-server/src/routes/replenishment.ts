import { Router } from "express";
import { db, productReplenishmentRulesTable, productsTable, branchesTable, stockLevelsTable, categoriesTable, unitsTable, contactsTable, purchaseItemsTable, purchasesTable, workersTable } from "@workspace/db";
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, assertBranchAccess } from "../middlewares/permissions";
import { P } from "../lib/permissions";

const router = Router();

const DAY_COLS = ["targetDim", "targetLun", "targetMar", "targetMer", "targetJeu", "targetVen", "targetSat"] as const;
type DayKey = typeof DAY_COLS[number];

function getDayTarget(rule: Record<string, any>, dayOfWeek: number): number {
  const key = DAY_COLS[dayOfWeek];
  const val = parseFloat(rule[key] ?? "0");
  return isNaN(val) ? 0 : val;
}

function getDayLabel(day: number): string {
  return ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"][day] ?? "";
}

// GET /replenishment/calculate
router.get("/replenishment/calculate", requireAuth, requirePermission(P.replenishment.view), async (req, res): Promise<void> => {
  const user = req.user!;
  const { branchId: branchIdStr, date: dateStr, categoryId: categoryIdStr, workerId: workerIdStr } = req.query as Record<string, string>;

  if (!branchIdStr) { res.status(400).json({ error: "branchId requis" }); return; }
  const branchId = parseInt(branchIdStr, 10);
  if (isNaN(branchId)) { res.status(400).json({ error: "branchId invalide" }); return; }

  if (!assertBranchAccess(user, branchId, res)) return;

  const date = dateStr ? new Date(dateStr) : new Date();
  const dayOfWeek = date.getDay(); // 0=Sun/Dim, 1=Mon/Lun, ..., 6=Sat/Sam
  const dayLabel = getDayLabel(dayOfWeek);

  // Fetch branch info
  const [branch] = await db.select().from(branchesTable).where(eq(branchesTable.id, branchId));
  if (!branch) { res.status(404).json({ error: "Boutique introuvable" }); return; }

  // Fetch all active replenishment rules for this branch
  const rules = await db.select().from(productReplenishmentRulesTable)
    .where(and(
      eq(productReplenishmentRulesTable.branchId, branchId),
      eq(productReplenishmentRulesTable.isActive, true)
    ));

  // Filter rules: only those that have a target > 0 for today's day
  const rulesForToday = rules.filter(r => getDayTarget(r, dayOfWeek) > 0);

  if (rulesForToday.length === 0) {
    res.json({
      branchId, branchName: branch.name,
      date: date.toISOString().split("T")[0],
      dayOfWeek, dayLabel,
      items: [], stats: { totalProducts: 0, toOrderCount: 0, totalQuantityToOrder: 0, suppliersCount: 0 }
    });
    return;
  }

  const productIds = rulesForToday.map(r => r.productId);

  // Fetch products with category, unit and worker
  const products = await db.select({
    id: productsTable.id,
    name: productsTable.name,
    sku: productsTable.sku,
    categoryId: productsTable.categoryId,
    categoryName: categoriesTable.name,
    unitId: productsTable.unitId,
    unitName: unitsTable.name,
    unitAbbr: unitsTable.abbreviation,
    workerId: productsTable.workerId,
    workerName: workersTable.name,
  }).from(productsTable)
    .leftJoin(categoriesTable, eq(productsTable.categoryId, categoriesTable.id))
    .leftJoin(unitsTable, eq(productsTable.unitId, unitsTable.id))
    .leftJoin(workersTable, eq(productsTable.workerId, workersTable.id))
    .where(inArray(productsTable.id, productIds));

  // Fetch last supplier per product from purchase history
  const lastPurchaseRows = await db.select({
    productId: purchaseItemsTable.productId,
    supplierId: contactsTable.id,
    supplierName: contactsTable.displayName,
  }).from(purchaseItemsTable)
    .innerJoin(purchasesTable, eq(purchaseItemsTable.purchaseId, purchasesTable.id))
    .innerJoin(contactsTable, eq(purchasesTable.supplierId, contactsTable.id))
    .where(inArray(purchaseItemsTable.productId, productIds))
    .orderBy(desc(purchasesTable.id));

  const supplierMap = new Map<number, { supplierId: number; supplierName: string }>();
  for (const row of lastPurchaseRows) {
    if (!supplierMap.has(row.productId!) && row.supplierId && row.supplierName) {
      supplierMap.set(row.productId!, { supplierId: row.supplierId, supplierName: row.supplierName });
    }
  }

  // Fetch stock levels for this branch only
  const stockLevels = await db.select().from(stockLevelsTable)
    .where(and(
      eq(stockLevelsTable.branchId, branchId),
      inArray(stockLevelsTable.productId, productIds)
    ));

  const stockMap = new Map<number, number>();
  for (const sl of stockLevels) {
    stockMap.set(sl.productId, parseFloat(sl.quantity));
  }

  const ruleMap = new Map<number, typeof rules[0]>();
  for (const r of rulesForToday) {
    ruleMap.set(r.productId, r);
  }

  const categoryId = categoryIdStr ? parseInt(categoryIdStr, 10) : null;
  const workerIdFilter = workerIdStr && workerIdStr !== "all" ? (workerIdStr === "none" ? 0 : parseInt(workerIdStr, 10)) : null;

  const items = products
    .filter(p => !categoryId || p.categoryId === categoryId)
    .filter(p => {
      if (workerIdFilter === null) return true;
      if (workerIdFilter === 0) return p.workerId === null;
      return p.workerId === workerIdFilter;
    })
    .map(p => {
      const rule = ruleMap.get(p.id);
      if (!rule) return null;
      const currentStock = stockMap.get(p.id) ?? 0;
      const targetStock = getDayTarget(rule, dayOfWeek);
      const quantityToOrder = Math.max(0, targetStock - currentStock);
      return {
        productId: p.id,
        productName: p.name,
        sku: p.sku ?? null,
        categoryName: p.categoryName ?? null,
        unitName: p.unitAbbr ?? p.unitName ?? "",
        workerId: p.workerId ?? null,
        workerName: p.workerName ?? null,
        currentStock,
        targetStock,
        quantityToOrder,
        supplierId: supplierMap.get(p.id)?.supplierId ?? null,
        supplierName: supplierMap.get(p.id)?.supplierName ?? null,
        status: quantityToOrder > 0 ? "to_order" : "ok" as "to_order" | "ok",
      };
    })
    .filter(Boolean) as NonNullable<ReturnType<typeof items[0]>>[];

  const toOrderItems = items.filter(i => i.status === "to_order");
  const suppliersSet = new Set(toOrderItems.map(i => i.supplierId).filter(Boolean));

  res.json({
    branchId, branchName: branch.name,
    date: date.toISOString().split("T")[0],
    dayOfWeek, dayLabel,
    // Keep weekdayGroup for backward compat with frontend replenishment page
    weekdayGroup: dayOfWeek <= 3 ? "sun_wed" : "thu_sat",
    weekdayGroupLabel: dayLabel,
    items,
    stats: {
      totalProducts: items.length,
      toOrderCount: toOrderItems.length,
      totalQuantityToOrder: toOrderItems.reduce((s, i) => s + i.quantityToOrder, 0),
      suppliersCount: suppliersSet.size,
    }
  });
});

// GET /replenishment/rules/product/:productId
router.get("/replenishment/rules/product/:productId", requireAuth, requirePermission(P.replenishment.view), async (req, res): Promise<void> => {
  const productId = parseInt(req.params.productId, 10);
  if (isNaN(productId)) { res.status(400).json({ error: "productId invalide" }); return; }

  const rules = await db.select({
    id: productReplenishmentRulesTable.id,
    branchId: productReplenishmentRulesTable.branchId,
    branchName: branchesTable.name,
    targetDim: productReplenishmentRulesTable.targetDim,
    targetLun: productReplenishmentRulesTable.targetLun,
    targetMar: productReplenishmentRulesTable.targetMar,
    targetMer: productReplenishmentRulesTable.targetMer,
    targetJeu: productReplenishmentRulesTable.targetJeu,
    targetVen: productReplenishmentRulesTable.targetVen,
    targetSat: productReplenishmentRulesTable.targetSat,
    isActive: productReplenishmentRulesTable.isActive,
  }).from(productReplenishmentRulesTable)
    .leftJoin(branchesTable, eq(productReplenishmentRulesTable.branchId, branchesTable.id))
    .where(eq(productReplenishmentRulesTable.productId, productId));

  res.json(rules);
});

// PUT /replenishment/rules/product/:productId
router.put("/replenishment/rules/product/:productId", requireAuth, requirePermission(P.replenishment.create), async (req, res): Promise<void> => {
  const productId = parseInt(req.params.productId, 10);
  if (isNaN(productId)) { res.status(400).json({ error: "productId invalide" }); return; }

  const { rules } = req.body as {
    rules: Array<{
      branchId: number;
      targetDim: number; targetLun: number; targetMar: number; targetMer: number;
      targetJeu: number; targetVen: number; targetSat: number;
    }>
  };

  if (!Array.isArray(rules)) { res.status(400).json({ error: "rules doit être un tableau" }); return; }

  for (const rule of rules) {
    if (!assertBranchAccess(req.user!, rule.branchId, res)) return;
    const vals = [rule.targetDim, rule.targetLun, rule.targetMar, rule.targetMer, rule.targetJeu, rule.targetVen, rule.targetSat];
    if (vals.some(v => v < 0)) {
      res.status(400).json({ error: "Les valeurs cibles ne peuvent pas être négatives" }); return;
    }
  }

  for (const rule of rules) {
    const dayData = {
      targetDim: rule.targetDim.toString(),
      targetLun: rule.targetLun.toString(),
      targetMar: rule.targetMar.toString(),
      targetMer: rule.targetMer.toString(),
      targetJeu: rule.targetJeu.toString(),
      targetVen: rule.targetVen.toString(),
      targetSat: rule.targetSat.toString(),
    };
    const hasAnyTarget = Object.values(dayData).some(v => parseFloat(v) > 0);

    const existing = await db.select().from(productReplenishmentRulesTable)
      .where(and(
        eq(productReplenishmentRulesTable.productId, productId),
        eq(productReplenishmentRulesTable.branchId, rule.branchId)
      ));

    if (existing.length > 0) {
      await db.update(productReplenishmentRulesTable)
        .set({ ...dayData, isActive: hasAnyTarget })
        .where(and(
          eq(productReplenishmentRulesTable.productId, productId),
          eq(productReplenishmentRulesTable.branchId, rule.branchId)
        ));
    } else if (hasAnyTarget) {
      await db.insert(productReplenishmentRulesTable).values({
        productId,
        branchId: rule.branchId,
        ...dayData,
        isActive: true,
      });
    }
  }

  res.json({ success: true });
});

export default router;
