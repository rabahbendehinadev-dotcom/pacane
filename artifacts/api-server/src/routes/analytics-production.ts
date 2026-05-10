/**
 * Production Analytics API
 * Atelier performance: orders, yield, cost intelligence, recipe rankings, ingredient consumption.
 *
 * GET /analytics/production/kpis        — Core KPIs
 * GET /analytics/production/trend       — Daily production trend
 * GET /analytics/production/recipes     — Top recipes by production volume
 * GET /analytics/production/yield       — Planned vs actual yield per completed order
 * GET /analytics/production/branches    — Production by branch/lab
 * GET /analytics/production/ingredients — Top consumed ingredients (from recipe × actual qty)
 * GET /analytics/production/orders      — Recent production orders table
 */

import { Router, type IRouter } from "express";
import { and, eq, gte, lte, inArray, not, sql, desc, isNotNull, isNull, or } from "drizzle-orm";
import {
  db,
  productionOrdersTable,
  recipesTable,
  recipeIngredientsTable,
  productsTable,
  branchesTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, visibleBranchIds } from "../middlewares/permissions";
import { P } from "../lib/permissions";

const router: IRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dateConds(col: any, from?: string, to?: string) {
  const c: any[] = [];
  if (from) c.push(gte(col, new Date(from)));
  if (to) {
    const d = new Date(to);
    d.setHours(23, 59, 59, 999);
    c.push(lte(col, d));
  }
  return c;
}

function scopeCond(scope: number[] | null, reqBranchId?: string) {
  const c: any[] = [];
  if (scope !== null) {
    if (scope.length === 0) return [sql`FALSE`];
    c.push(inArray(productionOrdersTable.branchId, scope));
  }
  if (reqBranchId) {
    const id = parseInt(reqBranchId, 10);
    if (!isNaN(id)) c.push(eq(productionOrdersTable.branchId, id));
  }
  return c;
}

function parseQ(req: any) {
  return {
    scope: visibleBranchIds(req.user!),
    from: req.query.from as string | undefined,
    to: req.query.to as string | undefined,
    branchId: req.query.branchId as string | undefined,
    status: req.query.status as string | undefined,
    recipeId: req.query.recipeId as string | undefined,
  };
}

function buildConds(q: ReturnType<typeof parseQ>) {
  const { scope, from, to, branchId, status, recipeId } = q;
  const c = [
    ...scopeCond(scope, branchId),
    ...dateConds(productionOrdersTable.createdAt, from, to),
  ];
  if (status) c.push(eq(productionOrdersTable.status, status));
  if (recipeId) c.push(eq(productionOrdersTable.recipeId, parseInt(recipeId, 10)));
  return c;
}

// ─── KPIs ─────────────────────────────────────────────────────────────────────
router.get("/kpis", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const q = parseQ(req);
  const conds = buildConds(q);

  const [agg] = await db.select({
    total: sql<string>`COUNT(*)`,
    completed: sql<string>`COUNT(CASE WHEN ${productionOrdersTable.status}='completed' THEN 1 END)`,
    blocked: sql<string>`COUNT(CASE WHEN ${productionOrdersTable.status}='blocked' THEN 1 END)`,
    planned: sql<string>`COUNT(CASE WHEN ${productionOrdersTable.status} IN ('planned','in_progress') THEN 1 END)`,
    draft: sql<string>`COUNT(CASE WHEN ${productionOrdersTable.status}='draft' THEN 1 END)`,
    totalPlannedQty: sql<string>`COALESCE(SUM(${productionOrdersTable.plannedQuantity}::numeric), 0)`,
    totalActualQty: sql<string>`COALESCE(SUM(CASE WHEN ${productionOrdersTable.status}='completed' THEN ${productionOrdersTable.actualQuantity}::numeric ELSE 0 END), 0)`,
    totalTheoreticalCost: sql<string>`COALESCE(SUM(${productionOrdersTable.theoreticalCost}::numeric), 0)`,
    totalActualCost: sql<string>`COALESCE(SUM(CASE WHEN ${productionOrdersTable.actualCost} IS NOT NULL THEN ${productionOrdersTable.actualCost}::numeric ELSE 0 END), 0)`,
    avgTheoreticalCost: sql<string>`COALESCE(AVG(${productionOrdersTable.theoreticalCost}::numeric), 0)`,
  })
  .from(productionOrdersTable)
  .where(conds.length ? and(...conds) : undefined);

  const total = parseInt(agg.total, 10);
  const completed = parseInt(agg.completed, 10);
  const blocked = parseInt(agg.blocked, 10);
  const planned = parseInt(agg.planned, 10);
  const draft = parseInt(agg.draft, 10);
  const totalActualQty = parseFloat(agg.totalActualQty);
  const totalPlannedQty = parseFloat(agg.totalPlannedQty);
  const totalTheoreticalCost = parseFloat(agg.totalTheoreticalCost);
  const totalActualCost = parseFloat(agg.totalActualCost);

  // Completion rate (among non-draft orders)
  const active = total - draft;
  const completionRate = active > 0 ? Math.round((completed / active) * 100) : 0;

  // Yield efficiency (planned vs actual among completed)
  const yieldRate = totalPlannedQty > 0
    ? Math.round((totalActualQty / totalPlannedQty) * 100)
    : 0;

  // Cost variance (actual - theoretical among completed orders with actual cost)
  const completedWithCost = await db.select({
    theoreticalCost: sql<string>`COALESCE(SUM(${productionOrdersTable.theoreticalCost}::numeric), 0)`,
    actualCost: sql<string>`COALESCE(SUM(${productionOrdersTable.actualCost}::numeric), 0)`,
  })
  .from(productionOrdersTable)
  .where(and(
    ...(conds.length ? conds : []),
    eq(productionOrdersTable.status, "completed"),
    isNotNull(productionOrdersTable.actualCost),
  ));

  const cmpTheoretical = parseFloat(completedWithCost[0]?.theoreticalCost ?? "0");
  const cmpActual = parseFloat(completedWithCost[0]?.actualCost ?? "0");
  const costVariance = cmpActual - cmpTheoretical;
  const costVariancePct = cmpTheoretical > 0 ? Math.round((costVariance / cmpTheoretical) * 100) : 0;

  res.json({
    total, completed, blocked, planned, draft,
    completionRate,
    totalActualQty, totalPlannedQty, yieldRate,
    totalTheoreticalCost, totalActualCost,
    avgTheoreticalCost: parseFloat(agg.avgTheoreticalCost),
    costVariance, costVariancePct,
  });
});

// ─── Trend ────────────────────────────────────────────────────────────────────
router.get("/trend", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const q = parseQ(req);
  const conds = buildConds(q);

  const rows = await db.select({
    date: sql<string>`DATE(${productionOrdersTable.createdAt})::text`,
    orders: sql<string>`COUNT(*)`,
    completed: sql<string>`COUNT(CASE WHEN ${productionOrdersTable.status}='completed' THEN 1 END)`,
    blocked: sql<string>`COUNT(CASE WHEN ${productionOrdersTable.status}='blocked' THEN 1 END)`,
    plannedQty: sql<string>`COALESCE(SUM(${productionOrdersTable.plannedQuantity}::numeric), 0)`,
    actualQty: sql<string>`COALESCE(SUM(CASE WHEN ${productionOrdersTable.status}='completed' THEN COALESCE(${productionOrdersTable.actualQuantity}::numeric,0) ELSE 0 END), 0)`,
    theoreticalCost: sql<string>`COALESCE(SUM(${productionOrdersTable.theoreticalCost}::numeric), 0)`,
  })
  .from(productionOrdersTable)
  .where(conds.length ? and(...conds) : undefined)
  .groupBy(sql`DATE(${productionOrdersTable.createdAt})`)
  .orderBy(sql`DATE(${productionOrdersTable.createdAt})`);

  res.json(rows.map(r => ({
    date: r.date,
    orders: parseInt(r.orders, 10),
    completed: parseInt(r.completed, 10),
    blocked: parseInt(r.blocked, 10),
    plannedQty: parseFloat(r.plannedQty),
    actualQty: parseFloat(r.actualQty),
    theoreticalCost: parseFloat(r.theoreticalCost),
  })));
});

// ─── Recipes ranking ──────────────────────────────────────────────────────────
router.get("/recipes", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const q = parseQ(req);
  const conds = buildConds(q);

  const rows = await db.select({
    recipeId: productionOrdersTable.recipeId,
    recipeName: recipesTable.name,
    orderCount: sql<string>`COUNT(*)`,
    completedCount: sql<string>`COUNT(CASE WHEN ${productionOrdersTable.status}='completed' THEN 1 END)`,
    blockedCount: sql<string>`COUNT(CASE WHEN ${productionOrdersTable.status}='blocked' THEN 1 END)`,
    totalPlannedQty: sql<string>`COALESCE(SUM(${productionOrdersTable.plannedQuantity}::numeric), 0)`,
    totalActualQty: sql<string>`COALESCE(SUM(CASE WHEN ${productionOrdersTable.status}='completed' THEN COALESCE(${productionOrdersTable.actualQuantity}::numeric,0) ELSE 0 END), 0)`,
    totalTheoreticalCost: sql<string>`COALESCE(SUM(${productionOrdersTable.theoreticalCost}::numeric), 0)`,
    totalActualCost: sql<string>`COALESCE(SUM(CASE WHEN ${productionOrdersTable.actualCost} IS NOT NULL THEN ${productionOrdersTable.actualCost}::numeric ELSE 0 END), 0)`,
  })
  .from(productionOrdersTable)
  .innerJoin(recipesTable, eq(productionOrdersTable.recipeId, recipesTable.id))
  .where(conds.length ? and(...conds) : undefined)
  .groupBy(productionOrdersTable.recipeId, recipesTable.name)
  .orderBy(sql`COUNT(*) DESC`)
  .limit(20);

  res.json(rows.map(r => {
    const cnt = parseInt(r.orderCount, 10);
    const cmp = parseInt(r.completedCount, 10);
    const blk = parseInt(r.blockedCount, 10);
    const plannedQty = parseFloat(r.totalPlannedQty);
    const actualQty = parseFloat(r.totalActualQty);
    const theoreticalCost = parseFloat(r.totalTheoreticalCost);
    const actualCost = parseFloat(r.totalActualCost);
    return {
      recipeId: r.recipeId,
      recipeName: r.recipeName,
      orderCount: cnt,
      completedCount: cmp,
      blockedCount: blk,
      completionRate: cnt > 0 ? Math.round((cmp / cnt) * 100) : 0,
      totalPlannedQty: plannedQty,
      totalActualQty: actualQty,
      yieldRate: plannedQty > 0 ? Math.round((actualQty / plannedQty) * 100) : 0,
      totalTheoreticalCost: theoreticalCost,
      totalActualCost: actualCost,
      costVariance: actualCost - theoreticalCost,
    };
  }));
});

// ─── Yield analysis (completed orders) ────────────────────────────────────────
router.get("/yield", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const q = parseQ(req);
  const conds = [...buildConds(q), eq(productionOrdersTable.status, "completed")];

  const rows = await db.select({
    id: productionOrdersTable.id,
    reference: productionOrdersTable.reference,
    recipeName: recipesTable.name,
    branchName: branchesTable.name,
    plannedQuantity: productionOrdersTable.plannedQuantity,
    actualQuantity: productionOrdersTable.actualQuantity,
    theoreticalCost: productionOrdersTable.theoreticalCost,
    actualCost: productionOrdersTable.actualCost,
    startedAt: productionOrdersTable.startedAt,
    completedAt: productionOrdersTable.completedAt,
    createdAt: productionOrdersTable.createdAt,
  })
  .from(productionOrdersTable)
  .innerJoin(recipesTable, eq(productionOrdersTable.recipeId, recipesTable.id))
  .innerJoin(branchesTable, eq(productionOrdersTable.branchId, branchesTable.id))
  .where(conds.length ? and(...conds) : undefined)
  .orderBy(desc(productionOrdersTable.completedAt))
  .limit(50);

  res.json(rows.map(r => {
    const planned = parseFloat(r.plannedQuantity ?? "0");
    const actual = parseFloat(r.actualQuantity ?? "0");
    const theoretical = parseFloat(r.theoreticalCost ?? "0");
    const actualCost = parseFloat(r.actualCost ?? "0");
    // Cycle time in hours
    let cycleTimeHours: number | null = null;
    if (r.startedAt && r.completedAt) {
      cycleTimeHours = Math.round((new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()) / 3_600_000 * 10) / 10;
    }
    return {
      id: r.id,
      reference: r.reference,
      recipeName: r.recipeName,
      branchName: r.branchName,
      plannedQuantity: planned,
      actualQuantity: actual,
      yieldRate: planned > 0 ? Math.round((actual / planned) * 100) : 0,
      theoreticalCost: theoretical,
      actualCost,
      costVariance: r.actualCost != null ? actualCost - theoretical : null,
      costVariancePct: theoretical > 0 && r.actualCost != null
        ? Math.round(((actualCost - theoretical) / theoretical) * 100)
        : null,
      cycleTimeHours,
      completedAt: r.completedAt,
      createdAt: r.createdAt,
    };
  }));
});

// ─── Branch comparison ────────────────────────────────────────────────────────
router.get("/branches", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const q = parseQ(req);
  // Don't filter by branchId here — we want all branches in scope for comparison
  const conds = [
    ...scopeCond(q.scope),
    ...dateConds(productionOrdersTable.createdAt, q.from, q.to),
  ];
  if (q.status) conds.push(eq(productionOrdersTable.status, q.status));

  const rows = await db.select({
    branchId: productionOrdersTable.branchId,
    branchName: branchesTable.name,
    total: sql<string>`COUNT(*)`,
    completed: sql<string>`COUNT(CASE WHEN ${productionOrdersTable.status}='completed' THEN 1 END)`,
    blocked: sql<string>`COUNT(CASE WHEN ${productionOrdersTable.status}='blocked' THEN 1 END)`,
    totalPlannedQty: sql<string>`COALESCE(SUM(${productionOrdersTable.plannedQuantity}::numeric), 0)`,
    totalActualQty: sql<string>`COALESCE(SUM(CASE WHEN ${productionOrdersTable.status}='completed' THEN COALESCE(${productionOrdersTable.actualQuantity}::numeric,0) ELSE 0 END), 0)`,
    totalCost: sql<string>`COALESCE(SUM(${productionOrdersTable.theoreticalCost}::numeric), 0)`,
  })
  .from(productionOrdersTable)
  .innerJoin(branchesTable, eq(productionOrdersTable.branchId, branchesTable.id))
  .where(conds.length ? and(...conds) : undefined)
  .groupBy(productionOrdersTable.branchId, branchesTable.name)
  .orderBy(sql`COUNT(*) DESC`);

  res.json(rows.map(r => {
    const total = parseInt(r.total, 10);
    const completed = parseInt(r.completed, 10);
    return {
      branchId: r.branchId,
      branchName: r.branchName,
      total,
      completed,
      blocked: parseInt(r.blocked, 10),
      completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
      totalPlannedQty: parseFloat(r.totalPlannedQty),
      totalActualQty: parseFloat(r.totalActualQty),
      totalCost: parseFloat(r.totalCost),
    };
  }));
});

// ─── Ingredient consumption (derived from recipe × actual quantity) ────────────
router.get("/ingredients", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const q = parseQ(req);
  // Only completed orders have real consumption
  const conds = [
    ...buildConds(q),
    eq(productionOrdersTable.status, "completed"),
    isNotNull(productionOrdersTable.actualQuantity),
  ];

  // Get completed orders with their recipes and actual qty
  const completedOrders = await db.select({
    recipeId: productionOrdersTable.recipeId,
    actualQuantity: productionOrdersTable.actualQuantity,
    recipeYield: recipesTable.yield,
  })
  .from(productionOrdersTable)
  .innerJoin(recipesTable, eq(productionOrdersTable.recipeId, recipesTable.id))
  .where(conds.length ? and(...conds) : undefined);

  if (completedOrders.length === 0) {
    res.json([]);
    return;
  }

  // Unique recipeIds
  const recipeIds = [...new Set(completedOrders.map(o => o.recipeId))];

  // Get recipe ingredients for these recipes
  const ingredients = await db.select({
    recipeId: recipeIngredientsTable.recipeId,
    productId: recipeIngredientsTable.productId,
    productName: productsTable.name,
    ingredientQty: recipeIngredientsTable.quantity,
    wastageRate: recipeIngredientsTable.wastageRate,
  })
  .from(recipeIngredientsTable)
  .innerJoin(productsTable, eq(recipeIngredientsTable.productId, productsTable.id))
  .where(inArray(recipeIngredientsTable.recipeId, recipeIds));

  // Build ingredient → total consumption map
  const consumptionMap = new Map<number, { productName: string; totalQty: number; orderCount: number }>();

  for (const order of completedOrders) {
    const actualQty = parseFloat(order.actualQuantity ?? "0");
    const recipeYield = parseFloat(order.recipeYield ?? "1");
    // Scale factor: actual qty / recipe yield = number of recipe "batches"
    const batchFactor = recipeYield > 0 ? actualQty / recipeYield : 1;

    const recipeIngredients = ingredients.filter(i => i.recipeId === order.recipeId);
    for (const ing of recipeIngredients) {
      const ingQty = parseFloat(ing.ingredientQty ?? "0");
      const wastage = parseFloat(ing.wastageRate ?? "0") / 100;
      const consumed = ingQty * batchFactor * (1 + wastage);
      const entry = consumptionMap.get(ing.productId);
      if (entry) {
        entry.totalQty += consumed;
        entry.orderCount++;
      } else {
        consumptionMap.set(ing.productId, { productName: ing.productName, totalQty: consumed, orderCount: 1 });
      }
    }
  }

  const result = [...consumptionMap.entries()]
    .map(([productId, data]) => ({
      productId,
      productName: data.productName,
      totalQty: Math.round(data.totalQty * 100) / 100,
      orderCount: data.orderCount,
    }))
    .sort((a, b) => b.totalQty - a.totalQty)
    .slice(0, 20);

  res.json(result);
});

// ─── Recent orders table ──────────────────────────────────────────────────────
router.get("/orders", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const q = parseQ(req);
  const conds = buildConds(q);
  const limit = Math.min(200, parseInt(req.query.limit as string ?? "100", 10));

  const rows = await db.select({
    id: productionOrdersTable.id,
    reference: productionOrdersTable.reference,
    recipeId: productionOrdersTable.recipeId,
    recipeName: recipesTable.name,
    branchName: branchesTable.name,
    branchId: productionOrdersTable.branchId,
    status: productionOrdersTable.status,
    plannedQuantity: productionOrdersTable.plannedQuantity,
    actualQuantity: productionOrdersTable.actualQuantity,
    theoreticalCost: productionOrdersTable.theoreticalCost,
    actualCost: productionOrdersTable.actualCost,
    notes: productionOrdersTable.notes,
    startedAt: productionOrdersTable.startedAt,
    completedAt: productionOrdersTable.completedAt,
    createdAt: productionOrdersTable.createdAt,
  })
  .from(productionOrdersTable)
  .innerJoin(recipesTable, eq(productionOrdersTable.recipeId, recipesTable.id))
  .innerJoin(branchesTable, eq(productionOrdersTable.branchId, branchesTable.id))
  .where(conds.length ? and(...conds) : undefined)
  .orderBy(desc(productionOrdersTable.createdAt))
  .limit(limit);

  res.json(rows.map(r => {
    const planned = parseFloat(r.plannedQuantity ?? "0");
    const actual = parseFloat(r.actualQuantity ?? "0");
    const theoretical = parseFloat(r.theoreticalCost ?? "0");
    const actualCost = parseFloat(r.actualCost ?? "0");
    return {
      id: r.id,
      reference: r.reference,
      recipeName: r.recipeName,
      branchName: r.branchName,
      status: r.status,
      plannedQuantity: planned,
      actualQuantity: actual,
      yieldRate: planned > 0 && r.status === "completed" ? Math.round((actual / planned) * 100) : null,
      theoreticalCost: theoretical,
      actualCost: r.actualCost != null ? actualCost : null,
      costVariance: r.actualCost != null ? actualCost - theoretical : null,
      notes: r.notes,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      createdAt: r.createdAt,
    };
  }));
});

export default router;
