/**
 * Executive Dashboard API — Cross-module management view
 *
 * GET /dashboard/executive/overview  — All cross-module KPIs
 * GET /dashboard/executive/trend     — Daily trend: sales / expenses / net result
 * GET /dashboard/executive/branches  — Branch-level comparison
 * GET /dashboard/executive/alerts    — Actionable alerts panel
 */

import { Router, type IRouter } from "express";
import { and, eq, gte, lte, inArray, not, isNull, sql, desc, lt } from "drizzle-orm";
import {
  db,
  salesTable, salePaymentsTable,
  purchasesTable,
  expensesTable,
  productionOrdersTable,
  salesReturnsTable,
  transfersTable,
  stockLevelsTable, productsTable, branchesTable,
  alertsTable,
  internalConsumptionsTable,
  internalConsumptionItemsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, visibleBranchIds } from "../middlewares/permissions";
import { P } from "../lib/permissions";

const router: IRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseBranchFilterEx(q: Record<string, string | undefined>): number[] | null {
  if (q.branchIds) {
    const ids = q.branchIds.split(",").map(s => parseInt(s, 10)).filter(n => !isNaN(n) && n > 0);
    return ids.length > 0 ? ids : null;
  }
  if (q.branchId && q.branchId !== "all") {
    const n = parseInt(q.branchId, 10);
    return isNaN(n) ? null : [n];
  }
  return null;
}

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

function scopeCond(col: any, scope: number[] | null): any | null {
  if (scope === null) return null;
  if (scope.length === 0) return sql`FALSE`;
  return inArray(col, scope);
}

// ─── Overview (all cross-module KPIs) ────────────────────────────────────────
router.get("/overview", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const scope = visibleBranchIds(req.user!);
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const filter = parseBranchFilterEx(req.query as Record<string, string | undefined>);

  function branchConds(col: any) {
    const c: any[] = [];
    const sc = scopeCond(col, scope);
    if (sc) c.push(sc);
    if (filter && filter.length > 0) c.push(inArray(col, filter));
    return c;
  }

  // ── Sales ──────────────────────────────────────────────────────────────────
  const saleConds = [
    eq(salesTable.type, "sale"),
    eq(salesTable.status, "confirmed"),
    ...dateConds(salesTable.createdAt, from, to),
    ...branchConds(salesTable.branchId),
  ];
  const [saleAgg] = await db.select({
    grossRevenue: sql<string>`COALESCE(SUM(${salesTable.total}::numeric), 0)`,
    saleCount: sql<string>`COUNT(*)`,
    totalPaid: sql<string>`COALESCE(SUM(${salesTable.paid}::numeric), 0)`,
    totalCreditApplied: sql<string>`COALESCE(SUM(${salesTable.creditApplied}::numeric), 0)`,
    unpaidCount: sql<string>`COUNT(CASE WHEN ${salesTable.paymentStatus}='unpaid' THEN 1 END)`,
    unpaidAmount: sql<string>`COALESCE(SUM(CASE WHEN ${salesTable.paymentStatus}!='paid' THEN ${salesTable.total}::numeric - ${salesTable.paid}::numeric - ${salesTable.creditApplied}::numeric ELSE 0 END), 0)`,
  }).from(salesTable).where(and(...saleConds));

  // ── Purchases ──────────────────────────────────────────────────────────────
  const purchConds = [
    ...dateConds(purchasesTable.createdAt, from, to),
  ];
  // purchases don't have branchId in schema — skip scope filter
  const [purchAgg] = await db.select({
    totalPurchases: sql<string>`COALESCE(SUM(${purchasesTable.total}::numeric), 0)`,
    purchaseCount: sql<string>`COUNT(*)`,
    unpaidPurchases: sql<string>`COALESCE(SUM(CASE WHEN ${purchasesTable.paymentStatus}!='paid' THEN ${purchasesTable.total}::numeric ELSE 0 END), 0)`,
    pendingReception: sql<string>`COUNT(CASE WHEN ${purchasesTable.status} IN ('ordered','partially_received') THEN 1 END)`,
  }).from(purchasesTable)
    .where(purchConds.length ? and(...purchConds) : undefined);

  // ── Expenses ──────────────────────────────────────────────────────────────
  const expConds = [
    eq(expensesTable.status, "validated"),
    ...dateConds(expensesTable.createdAt, from, to),
    ...branchConds(expensesTable.branchId),
  ];
  const [expAgg] = await db.select({
    totalExpenses: sql<string>`COALESCE(SUM(${expensesTable.amount}::numeric), 0)`,
    expenseCount: sql<string>`COUNT(*)`,
  }).from(expensesTable).where(and(...expConds));

  // ── Returns ────────────────────────────────────────────────────────────────
  const [retAgg] = await db.select({
    totalRefunded: sql<string>`COALESCE(SUM(${salesReturnsTable.refundedAmount}::numeric), 0)`,
    returnCount: sql<string>`COUNT(*)`,
    pendingReturns: sql<string>`COUNT(CASE WHEN ${salesReturnsTable.status}='draft' THEN 1 END)`,
  }).from(salesReturnsTable)
    .where(inArray(salesReturnsTable.status, ["confirmed", "refunded", "draft"]));

  // ── Production ────────────────────────────────────────────────────────────
  const prodConds = [
    ...branchConds(productionOrdersTable.branchId),
  ];
  const [prodAgg] = await db.select({
    totalOrders: sql<string>`COUNT(*)`,
    inProgress: sql<string>`COUNT(CASE WHEN ${productionOrdersTable.status}='launched' THEN 1 END)`,
    planned: sql<string>`COUNT(CASE WHEN ${productionOrdersTable.status}='planned' THEN 1 END)`,
    blocked: sql<string>`COUNT(CASE WHEN ${productionOrdersTable.status}='blocked' THEN 1 END)`,
    completed: sql<string>`COUNT(CASE WHEN ${productionOrdersTable.status}='completed' THEN 1 END)`,
  }).from(productionOrdersTable)
    .where(prodConds.length ? and(...prodConds) : undefined);

  // ── Transfers ────────────────────────────────────────────────────────────
  const [transferAgg] = await db.select({
    pending: sql<string>`COUNT(CASE WHEN ${transfersTable.status} IN ('draft','sent','partially_received') THEN 1 END)`,
    total: sql<string>`COUNT(*)`,
  }).from(transfersTable);

  // ── Internal Consumption (try/catch: total_cost may not exist yet) ──────────
  let icAgg: { totalCost: string; docCount: string; branchCount: string } | undefined;
  let topInternalProduct: { name: string; totalCost: number } | null = null;
  let topInternalBranch: { name: string; totalCost: number } | null = null;
  try {
    const icDateConds = dateConds(internalConsumptionsTable.documentDate, from, to);
    const icBaseConds: any[] = [eq(internalConsumptionsTable.status, "confirmed"), ...icDateConds];
    if (scope !== null) {
      if (scope.length === 0) {
        icBaseConds.push(sql`FALSE`);
      } else {
        const ids = scope.join(",");
        icBaseConds.push(sql`(${internalConsumptionsTable.sourceBranchId} = ANY(ARRAY[${sql.raw(ids)}]::int[]) OR ${internalConsumptionsTable.destinationBranchId} = ANY(ARRAY[${sql.raw(ids)}]::int[]))`);
      }
    }
    if (filter && filter.length > 0) icBaseConds.push(inArray(internalConsumptionsTable.destinationBranchId, filter));

    [icAgg] = await db.select({
      totalCost: sql<string>`COALESCE(SUM(${internalConsumptionsTable.totalCost}::numeric), 0)`,
      docCount: sql<string>`COUNT(*)`,
      branchCount: sql<string>`COUNT(DISTINCT ${internalConsumptionsTable.destinationBranchId})`,
    }).from(internalConsumptionsTable).where(and(...icBaseConds));

    const icDocIds = (await db.select({ id: internalConsumptionsTable.id })
      .from(internalConsumptionsTable).where(and(...icBaseConds))).map(r => r.id);

    if (icDocIds.length > 0) {
      const [topProd] = await db.select({
        name: productsTable.name,
        totalCost: sql<string>`COALESCE(SUM(${internalConsumptionItemsTable.totalCost}::numeric), 0)`,
      }).from(internalConsumptionItemsTable)
        .innerJoin(productsTable, eq(internalConsumptionItemsTable.productId, productsTable.id))
        .where(inArray(internalConsumptionItemsTable.documentId, icDocIds))
        .groupBy(productsTable.name)
        .orderBy(sql`SUM(${internalConsumptionItemsTable.totalCost}::numeric) DESC`)
        .limit(1);
      if (topProd) topInternalProduct = { name: topProd.name, totalCost: parseFloat(topProd.totalCost) };

      const [topBr] = await db.select({
        branchId: internalConsumptionsTable.destinationBranchId,
        totalCost: sql<string>`COALESCE(SUM(${internalConsumptionsTable.totalCost}::numeric), 0)`,
      }).from(internalConsumptionsTable)
        .where(and(...icBaseConds))
        .groupBy(internalConsumptionsTable.destinationBranchId)
        .orderBy(sql`SUM(${internalConsumptionsTable.totalCost}::numeric) DESC`)
        .limit(1);
      if (topBr) {
        const [brRow] = await db.select({ name: branchesTable.name }).from(branchesTable).where(eq(branchesTable.id, topBr.branchId));
        topInternalBranch = { name: brRow?.name ?? String(topBr.branchId), totalCost: parseFloat(topBr.totalCost) };
      }
    }
  } catch (icErr) {
    req.log.warn({ err: icErr }, "overview: internal consumptions query failed — returning 0");
    icAgg = { totalCost: '0', docCount: '0', branchCount: '0' };
  }

  // ── Stock alerts (products with quantity <= alert_quantity) ────────────────
  const stockAlertConds: any[] = [
    sql`${stockLevelsTable.quantity}::numeric <= ${productsTable.alertQuantity}::numeric`,
    sql`${productsTable.alertQuantity}::numeric > 0`,
  ];
  const bsc = scopeCond(stockLevelsTable.branchId, scope);
  if (bsc) stockAlertConds.push(bsc);
  if (filter && filter.length > 0) stockAlertConds.push(inArray(stockLevelsTable.branchId, filter));

  const [stockAgg] = await db.select({
    lowStockCount: sql<string>`COUNT(*)`,
  }).from(stockLevelsTable)
    .innerJoin(productsTable, eq(stockLevelsTable.productId, productsTable.id))
    .where(and(...stockAlertConds));

  // ── ERP Alerts (unresolved) — try/catch: table may not exist yet ──────────
  let erpAlertAgg: { total: string; critical: string; unread: string } | undefined;
  try {
    [erpAlertAgg] = await db.select({
      total: sql<string>`COUNT(*)`,
      critical: sql<string>`COUNT(CASE WHEN ${alertsTable.severity}='critical' THEN 1 END)`,
      unread: sql<string>`COUNT(CASE WHEN NOT ${alertsTable.isRead} THEN 1 END)`,
    }).from(alertsTable)
      .where(isNull(alertsTable.resolvedAt));
  } catch {
    erpAlertAgg = { total: '0', critical: '0', unread: '0' };
  }

  const grossRevenue = parseFloat(saleAgg?.grossRevenue ?? "0");
  const totalRefunded = parseFloat(retAgg?.totalRefunded ?? "0");
  const totalExpenses = parseFloat(expAgg?.totalExpenses ?? "0");
  const totalPurchases = parseFloat(purchAgg?.totalPurchases ?? "0");
  const netRevenue = grossRevenue - totalRefunded;
  const estimatedResult = netRevenue - totalExpenses;
  const totalPaid = parseFloat(saleAgg?.totalPaid ?? "0");
  const totalCreditApplied = parseFloat(saleAgg?.totalCreditApplied ?? "0");
  const encaisse = totalPaid + totalCreditApplied;

  res.json({
    // Commercial
    grossRevenue,
    netRevenue,
    saleCount: parseInt(saleAgg?.saleCount ?? "0", 10),
    encaisse,
    paymentRate: grossRevenue > 0 ? Math.round((encaisse / grossRevenue) * 100) : 0,
    unpaidRevenue: Math.max(0, parseFloat(saleAgg?.unpaidAmount ?? "0")),
    unpaidCount: parseInt(saleAgg?.unpaidCount ?? "0", 10),
    // Purchases
    totalPurchases,
    purchaseCount: parseInt(purchAgg?.purchaseCount ?? "0", 10),
    unpaidPurchases: parseFloat(purchAgg?.unpaidPurchases ?? "0"),
    pendingReception: parseInt(purchAgg?.pendingReception ?? "0", 10),
    // Expenses
    totalExpenses,
    expenseCount: parseInt(expAgg?.expenseCount ?? "0", 10),
    // Returns
    totalRefunded,
    returnCount: parseInt(retAgg?.returnCount ?? "0", 10),
    pendingReturns: parseInt(retAgg?.pendingReturns ?? "0", 10),
    // Production
    productionTotal: parseInt(prodAgg?.totalOrders ?? "0", 10),
    productionInProgress: parseInt(prodAgg?.inProgress ?? "0", 10),
    productionPlanned: parseInt(prodAgg?.planned ?? "0", 10),
    productionBlocked: parseInt(prodAgg?.blocked ?? "0", 10),
    // Transfers
    pendingTransfers: parseInt(transferAgg?.pending ?? "0", 10),
    // Stock
    lowStockCount: parseInt(stockAgg?.lowStockCount ?? "0", 10),
    // Alerts
    erpAlerts: parseInt(erpAlertAgg?.total ?? "0", 10),
    criticalAlerts: parseInt(erpAlertAgg?.critical ?? "0", 10),
    unreadAlerts: parseInt(erpAlertAgg?.unread ?? "0", 10),
    // Financials
    estimatedResult,
    operatingMargin: netRevenue > 0 ? Math.round((estimatedResult / netRevenue) * 100) : 0,
    // Internal consumption (operational costs, NOT sales)
    totalInternalCost: parseFloat(icAgg?.totalCost ?? "0"),
    internalDocCount: parseInt(icAgg?.docCount ?? "0", 10),
    internalBranchCount: parseInt(icAgg?.branchCount ?? "0", 10),
    topInternalProduct,
    topInternalBranch,
  });
});

// ─── Trend ────────────────────────────────────────────────────────────────────
router.get("/trend", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const scope = visibleBranchIds(req.user!);
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const filter = parseBranchFilterEx(req.query as Record<string, string | undefined>);

  const sc = scopeCond(salesTable.branchId, scope);
  const saleConds: any[] = [
    eq(salesTable.type, "sale"),
    eq(salesTable.status, "confirmed"),
    ...dateConds(salesTable.createdAt, from, to),
  ];
  if (sc) saleConds.push(sc);
  if (filter && filter.length > 0) saleConds.push(inArray(salesTable.branchId, filter));

  const expSc = scopeCond(expensesTable.branchId, scope);
  const expConds: any[] = [
    eq(expensesTable.status, "validated"),
    ...dateConds(expensesTable.createdAt, from, to),
  ];
  if (expSc) expConds.push(expSc);
  if (filter && filter.length > 0) expConds.push(inArray(expensesTable.branchId, filter));

  const [salesByDay, expByDay] = await Promise.all([
    db.select({
      date: sql<string>`DATE(${salesTable.createdAt})::text`,
      revenue: sql<string>`COALESCE(SUM(${salesTable.total}::numeric), 0)`,
      paid: sql<string>`COALESCE(SUM(${salesTable.paid}::numeric), 0)`,
      saleCount: sql<string>`COUNT(*)`,
    }).from(salesTable)
      .where(saleConds.length ? and(...saleConds) : undefined)
      .groupBy(sql`DATE(${salesTable.createdAt})`)
      .orderBy(sql`DATE(${salesTable.createdAt})`),

    db.select({
      date: sql<string>`DATE(${expensesTable.createdAt})::text`,
      expenses: sql<string>`COALESCE(SUM(${expensesTable.amount}::numeric), 0)`,
    }).from(expensesTable)
      .where(expConds.length ? and(...expConds) : undefined)
      .groupBy(sql`DATE(${expensesTable.createdAt})`)
      .orderBy(sql`DATE(${expensesTable.createdAt})`),
  ]);

  // Merge on date
  const dateMap: Record<string, any> = {};
  for (const r of salesByDay) {
    dateMap[r.date] = {
      date: r.date,
      revenue: parseFloat(r.revenue),
      paid: parseFloat(r.paid),
      saleCount: parseInt(r.saleCount, 10),
      expenses: 0,
      netResult: 0,
    };
  }
  for (const r of expByDay) {
    if (!dateMap[r.date]) dateMap[r.date] = { date: r.date, revenue: 0, paid: 0, saleCount: 0, expenses: 0, netResult: 0 };
    dateMap[r.date].expenses = parseFloat(r.expenses);
  }
  const rows = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));
  for (const r of rows) r.netResult = r.revenue - r.expenses;

  res.json(rows);
});

// ─── Branches comparison ──────────────────────────────────────────────────────
router.get("/branches", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const scope = visibleBranchIds(req.user!);
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  // Get all branches in scope
  const branchConds: any[] = [];
  const bsc = scopeCond(branchesTable.id, scope);
  if (bsc) branchConds.push(bsc);

  const branches = await db.select({ id: branchesTable.id, name: branchesTable.name })
    .from(branchesTable)
    .where(branchConds.length ? and(...branchConds) : undefined);

  if (branches.length === 0) { res.json([]); return; }
  const branchIds = branches.map(b => b.id);

  const dateSaleConds = dateConds(salesTable.createdAt, from, to);
  const dateExpConds = dateConds(expensesTable.createdAt, from, to);

  const dateIcConds = dateConds(internalConsumptionsTable.documentDate, from, to);

  const [salesByBranch, expByBranch, prodByBranch, stockByBranch, icByBranch] = await Promise.all([
    db.select({
      branchId: salesTable.branchId,
      revenue: sql<string>`COALESCE(SUM(${salesTable.total}::numeric), 0)`,
      saleCount: sql<string>`COUNT(*)`,
      paid: sql<string>`COALESCE(SUM(${salesTable.paid}::numeric), 0)`,
      unpaid: sql<string>`COALESCE(SUM(CASE WHEN ${salesTable.paymentStatus}!='paid' THEN ${salesTable.total}::numeric - ${salesTable.paid}::numeric ELSE 0 END), 0)`,
    }).from(salesTable)
      .where(and(
        eq(salesTable.type, "sale"),
        eq(salesTable.status, "confirmed"),
        inArray(salesTable.branchId, branchIds),
        ...dateSaleConds,
      ))
      .groupBy(salesTable.branchId),

    db.select({
      branchId: expensesTable.branchId,
      expenses: sql<string>`COALESCE(SUM(${expensesTable.amount}::numeric), 0)`,
      expCount: sql<string>`COUNT(*)`,
    }).from(expensesTable)
      .where(and(
        eq(expensesTable.status, "validated"),
        inArray(expensesTable.branchId, branchIds),
        ...dateExpConds,
      ))
      .groupBy(expensesTable.branchId),

    db.select({
      branchId: productionOrdersTable.branchId,
      total: sql<string>`COUNT(*)`,
      inProgress: sql<string>`COUNT(CASE WHEN ${productionOrdersTable.status}='launched' THEN 1 END)`,
      blocked: sql<string>`COUNT(CASE WHEN ${productionOrdersTable.status}='blocked' THEN 1 END)`,
    }).from(productionOrdersTable)
      .where(inArray(productionOrdersTable.branchId, branchIds))
      .groupBy(productionOrdersTable.branchId),

    db.select({
      branchId: stockLevelsTable.branchId,
      lowStock: sql<string>`COUNT(CASE WHEN ${stockLevelsTable.quantity}::numeric <= ${productsTable.alertQuantity}::numeric AND ${productsTable.alertQuantity}::numeric > 0 THEN 1 END)`,
      totalProducts: sql<string>`COUNT(*)`,
    }).from(stockLevelsTable)
      .innerJoin(productsTable, eq(stockLevelsTable.productId, productsTable.id))
      .where(inArray(stockLevelsTable.branchId, branchIds))
      .groupBy(stockLevelsTable.branchId),

    db.select({
      branchId: internalConsumptionsTable.destinationBranchId,
      internalCost: sql<string>`COALESCE(SUM(${internalConsumptionsTable.totalCost}::numeric), 0)`,
      icDocCount: sql<string>`COUNT(*)`,
    }).from(internalConsumptionsTable)
      .where(and(
        eq(internalConsumptionsTable.status, "confirmed"),
        inArray(internalConsumptionsTable.destinationBranchId, branchIds),
        ...dateIcConds,
      ))
      .groupBy(internalConsumptionsTable.destinationBranchId),
  ]);

  // Index maps
  const salesMap = Object.fromEntries(salesByBranch.map(r => [r.branchId, r]));
  const expMap = Object.fromEntries(expByBranch.map(r => [r.branchId, r]));
  const prodMap = Object.fromEntries(prodByBranch.map(r => [r.branchId, r]));
  const stockMap = Object.fromEntries(stockByBranch.map(r => [r.branchId, r]));
  const icMap = Object.fromEntries(icByBranch.map(r => [r.branchId, r]));

  const result = branches.map(b => {
    const s = salesMap[b.id];
    const e = expMap[b.id];
    const p = prodMap[b.id];
    const st = stockMap[b.id];
    const ic = icMap[b.id];
    const revenue = parseFloat(s?.revenue ?? "0");
    const expenses = parseFloat(e?.expenses ?? "0");
    const internalCost = parseFloat(ic?.internalCost ?? "0");
    return {
      branchId: b.id,
      branchName: b.name,
      revenue,
      saleCount: parseInt(s?.saleCount ?? "0", 10),
      paid: parseFloat(s?.paid ?? "0"),
      unpaidRevenue: Math.max(0, parseFloat(s?.unpaid ?? "0")),
      expenses,
      internalCost,
      estimatedResult: revenue - expenses,
      productionInProgress: parseInt(p?.inProgress ?? "0", 10),
      productionBlocked: parseInt(p?.blocked ?? "0", 10),
      lowStockCount: parseInt(st?.lowStock ?? "0", 10),
      stockProducts: parseInt(st?.totalProducts ?? "0", 10),
    };
  });

  result.sort((a, b) => b.revenue - a.revenue);
  res.json(result);
});

// ─── Alerts panel ────────────────────────────────────────────────────────────
router.get("/alerts", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const scope = visibleBranchIds(req.user!);
  const filter = parseBranchFilterEx(req.query as Record<string, string | undefined>);

  // ERP alerts (system-generated)
  const alertConds: any[] = [isNull(alertsTable.resolvedAt)];
  const asc = scopeCond(alertsTable.branchId, scope);
  if (asc) alertConds.push(sql`(${alertsTable.branchId} IS NULL OR ${asc})`);
  if (filter && filter.length > 0) alertConds.push(sql`(${alertsTable.branchId} IS NULL OR ${alertsTable.branchId} = ANY(ARRAY[${sql.raw(filter.join(","))}]::int[]))`);

  const erpAlerts = await db.select({
    id: alertsTable.id,
    type: alertsTable.type,
    severity: alertsTable.severity,
    title: alertsTable.title,
    message: alertsTable.message,
    module: alertsTable.module,
    branchId: alertsTable.branchId,
    isRead: alertsTable.isRead,
    createdAt: alertsTable.createdAt,
  }).from(alertsTable)
    .where(alertConds.length ? and(...alertConds) : undefined)
    .orderBy(desc(alertsTable.createdAt))
    .limit(30);

  // Computed alerts: low stock
  const stockConds: any[] = [
    sql`${stockLevelsTable.quantity}::numeric <= ${productsTable.alertQuantity}::numeric`,
    sql`${productsTable.alertQuantity}::numeric > 0`,
  ];
  const bsc = scopeCond(stockLevelsTable.branchId, scope);
  if (bsc) stockConds.push(bsc);
  if (filter && filter.length > 0) stockConds.push(inArray(stockLevelsTable.branchId, filter));

  const lowStockItems = await db.select({
    productName: productsTable.name,
    branchName: branchesTable.name,
    quantity: stockLevelsTable.quantity,
    alertQuantity: productsTable.alertQuantity,
  }).from(stockLevelsTable)
    .innerJoin(productsTable, eq(stockLevelsTable.productId, productsTable.id))
    .innerJoin(branchesTable, eq(stockLevelsTable.branchId, branchesTable.id))
    .where(and(...stockConds))
    .orderBy(sql`${stockLevelsTable.quantity}::numeric ASC`)
    .limit(10);

  // Computed alerts: pending purchases
  const pendingPurchases = await db.select({
    total: sql<string>`COUNT(*)`,
    amount: sql<string>`COALESCE(SUM(${purchasesTable.total}::numeric), 0)`,
  }).from(purchasesTable)
    .where(inArray(purchasesTable.status, ["ordered", "partially_received"]));

  // Computed: pending returns
  const pendingReturns = await db.select({
    total: sql<string>`COUNT(*)`,
    amount: sql<string>`COALESCE(SUM(${salesReturnsTable.totalAmount}::numeric), 0)`,
  }).from(salesReturnsTable)
    .where(eq(salesReturnsTable.status, "draft"));

  // Computed: pending transfers
  const pendingTransfers = await db.select({
    total: sql<string>`COUNT(*)`,
  }).from(transfersTable)
    .where(inArray(transfersTable.status, ["draft", "sent", "partially_received"]));

  res.json({
    erpAlerts,
    computed: {
      lowStock: {
        count: lowStockItems.length,
        items: lowStockItems.map(r => ({
          productName: r.productName,
          branchName: r.branchName,
          quantity: parseFloat(r.quantity),
          threshold: parseFloat(r.alertQuantity ?? "0"),
        })),
      },
      pendingPurchases: {
        count: parseInt(pendingPurchases[0]?.total ?? "0", 10),
        amount: parseFloat(pendingPurchases[0]?.amount ?? "0"),
      },
      pendingReturns: {
        count: parseInt(pendingReturns[0]?.total ?? "0", 10),
        amount: parseFloat(pendingReturns[0]?.amount ?? "0"),
      },
      pendingTransfers: {
        count: parseInt(pendingTransfers[0]?.total ?? "0", 10),
      },
    },
  });
});

// ─── Comparative analysis ────────────────────────────────────────────────────
router.get("/compare", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const scope = visibleBranchIds(req.user!);
  const q = req.query as Record<string, string | undefined>;
  const { fromA, toA, fromB, toB } = q;
  const filter = parseBranchFilterEx(q);

  async function periodAgg(from: string | undefined, to: string | undefined) {
    function brConds(col: any) {
      const c: any[] = [];
      const sc = scopeCond(col, scope);
      if (sc) c.push(sc);
      if (filter && filter.length > 0) c.push(inArray(col, filter));
      return c;
    }

    const saleConds = [
      eq(salesTable.type, "sale"),
      eq(salesTable.status, "confirmed"),
      ...dateConds(salesTable.createdAt, from, to),
      ...brConds(salesTable.branchId),
    ];
    const [saleAgg] = await db.select({
      grossRevenue: sql<string>`COALESCE(SUM(${salesTable.total}::numeric), 0)`,
      saleCount:    sql<string>`COUNT(*)`,
      totalPaid:    sql<string>`COALESCE(SUM(${salesTable.paid}::numeric), 0)`,
      totalCredit:  sql<string>`COALESCE(SUM(${salesTable.creditApplied}::numeric), 0)`,
    }).from(salesTable).where(and(...saleConds));

    const retConds = [
      inArray(salesReturnsTable.status, ["confirmed", "refunded"]),
      ...dateConds(salesReturnsTable.createdAt, from, to),
      ...brConds(salesReturnsTable.branchId),
    ];
    const [retAgg] = await db.select({
      returnAmount: sql<string>`COALESCE(SUM(${salesReturnsTable.refundedAmount}::numeric), 0)`,
      returnCount:  sql<string>`COUNT(*)`,
    }).from(salesReturnsTable).where(and(...retConds));

    const expConds = [
      eq(expensesTable.status, "validated"),
      ...dateConds(expensesTable.createdAt, from, to),
      ...brConds(expensesTable.branchId),
    ];
    const [expAgg] = await db.select({
      totalExpenses: sql<string>`COALESCE(SUM(${expensesTable.amount}::numeric), 0)`,
      expenseCount:  sql<string>`COUNT(*)`,
    }).from(expensesTable).where(and(...expConds));

    const byCategory = await db.select({
      category: expensesTable.category,
      amount:   sql<string>`COALESCE(SUM(${expensesTable.amount}::numeric), 0)`,
    }).from(expensesTable)
      .where(and(...expConds))
      .groupBy(expensesTable.category)
      .orderBy(sql`SUM(${expensesTable.amount}::numeric) DESC`)
      .limit(8);

    const branchScopeConds: any[] = [];
    const bsc2 = scopeCond(branchesTable.id, scope);
    if (bsc2) branchScopeConds.push(bsc2);
    if (filter && filter.length > 0) branchScopeConds.push(inArray(branchesTable.id, filter));

    const branches = await db.select({ id: branchesTable.id, name: branchesTable.name })
      .from(branchesTable)
      .where(branchScopeConds.length ? and(...branchScopeConds) : undefined);

    let byBranch: any[] = [];
    if (branches.length > 0) {
      const bIds = branches.map(b => b.id);
      const [salesByBranch, expByBranch] = await Promise.all([
        db.select({
          branchId:  salesTable.branchId,
          revenue:   sql<string>`COALESCE(SUM(${salesTable.total}::numeric), 0)`,
          saleCount: sql<string>`COUNT(*)`,
        }).from(salesTable)
          .where(and(
            eq(salesTable.type, "sale"),
            eq(salesTable.status, "confirmed"),
            inArray(salesTable.branchId, bIds),
            ...dateConds(salesTable.createdAt, from, to),
          ))
          .groupBy(salesTable.branchId),

        db.select({
          branchId: expensesTable.branchId,
          expenses: sql<string>`COALESCE(SUM(${expensesTable.amount}::numeric), 0)`,
        }).from(expensesTable)
          .where(and(
            eq(expensesTable.status, "validated"),
            inArray(expensesTable.branchId, bIds),
            ...dateConds(expensesTable.createdAt, from, to),
          ))
          .groupBy(expensesTable.branchId),
      ]);

      const salesMap = Object.fromEntries(salesByBranch.map(r => [r.branchId, r]));
      const expMap   = Object.fromEntries(expByBranch.map(r => [r.branchId, r]));
      byBranch = branches.map(b => {
        const s = salesMap[b.id];
        const e = expMap[b.id];
        const revenue  = parseFloat(s?.revenue ?? "0");
        const expenses = parseFloat(e?.expenses ?? "0");
        return {
          branchId: b.id, branchName: b.name,
          revenue, saleCount: parseInt(s?.saleCount ?? "0", 10),
          expenses, result: revenue - expenses,
        };
      });
    }

    const grossRevenue  = parseFloat(saleAgg?.grossRevenue ?? "0");
    const returnAmount  = parseFloat(retAgg?.returnAmount ?? "0");
    const totalExpenses = parseFloat(expAgg?.totalExpenses ?? "0");
    const netRevenue    = grossRevenue - returnAmount;
    const encaisse      = parseFloat(saleAgg?.totalPaid ?? "0") + parseFloat(saleAgg?.totalCredit ?? "0");

    return {
      grossRevenue, netRevenue,
      expenses: totalExpenses,
      result: netRevenue - totalExpenses,
      saleCount: parseInt(saleAgg?.saleCount ?? "0", 10),
      returnAmount, returnCount: parseInt(retAgg?.returnCount ?? "0", 10),
      encaisse,
      byCategory: byCategory.map(c => ({ category: c.category ?? "Autre", amount: parseFloat(c.amount) })),
      byBranch,
    };
  }

  const [pA, pB] = await Promise.all([periodAgg(fromA, toA), periodAgg(fromB, toB)]);
  res.json({
    periodA: { from: fromA, to: toA, ...pA },
    periodB: { from: fromB, to: toB, ...pB },
  });
});

export default router;
