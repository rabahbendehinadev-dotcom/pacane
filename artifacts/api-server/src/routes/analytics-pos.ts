/**
 * POS Analytics API
 * Branch-scoped advanced analytics for point-of-sale performance.
 *
 * GET /analytics/pos/kpis        — core KPIs (sales, tickets, avg ticket, payment mix, sessions)
 * GET /analytics/pos/hourly      — sales & tickets by hour of day
 * GET /analytics/pos/daily       — sales & tickets by day
 * GET /analytics/pos/products    — top products (qty + revenue)
 * GET /analytics/pos/cashiers    — performance by cashier/user
 * GET /analytics/pos/sessions    — session-level summary table
 *
 * Common query params: from, to, branchId, userId (cashier), paymentMethod
 * All data is real — no mocked values.
 */

import { Router, type IRouter } from "express";
import {
  db, salesTable, saleItemsTable, salePaymentsTable,
  productsTable, branchesTable, posSessionsTable,
  usersTable, salesReturnsTable,
} from "@workspace/db";
import { eq, and, gte, lte, sql, inArray, desc, isNotNull, not } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, visibleBranchIds } from "../middlewares/permissions";
import { P } from "../lib/permissions";

const router: IRouter = Router();

function n(v: unknown): number { return parseFloat((v as string) ?? "0") || 0; }

// ─── Helper: build WHERE conditions respecting branch scope ───────────────────
function buildConds(
  table: { branchId: any; createdAt: any },
  scope: number[] | null,
  q: Record<string, string>,
) {
  const conds: any[] = [];

  // Branch scope
  if (scope !== null) {
    const allowed = scope.length > 0 ? scope : [0];
    if (q.branchId) {
      const bid = parseInt(q.branchId);
      if (!scope.includes(bid)) conds.push(sql`false`);
      else conds.push(eq(table.branchId, bid));
    } else {
      conds.push(inArray(table.branchId, allowed));
    }
  } else if (q.branchId) {
    conds.push(eq(table.branchId, parseInt(q.branchId)));
  }

  // Date range
  if (q.from) conds.push(gte(table.createdAt, new Date(q.from)));
  if (q.to) {
    const d = new Date(q.to); d.setHours(23, 59, 59, 999);
    conds.push(lte(table.createdAt, d));
  }

  return conds;
}

// ─── 1. Core KPIs ────────────────────────────────────────────────────────────
router.get("/analytics/pos/kpis", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const q = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);

  if (scope !== null && scope.length === 0) {
    res.json(emptyKpis()); return;
  }

  const saleConds = buildConds(salesTable, scope, q);

  // Filter to POS sales only
  const posConds = [
    ...saleConds,
    eq(salesTable.fulfillmentType, "pos"),
    eq(salesTable.type, "sale"),
    eq(salesTable.status, "confirmed"),
  ];

  if (q.userId) posConds.push(eq(salesTable.createdByUserId, parseInt(q.userId)));

  // Core sales aggregate
  const [kpiRow] = await db
    .select({
      totalRevenue: sql<string>`COALESCE(SUM(${salesTable.total}::numeric), 0)`,
      totalPaid: sql<string>`COALESCE(SUM(${salesTable.paid}::numeric), 0)`,
      ticketCount: sql<string>`COUNT(*)`,
      avgTicket: sql<string>`COALESCE(AVG(${salesTable.total}::numeric), 0)`,
      totalItems: sql<string>`COALESCE(SUM((SELECT SUM(si.quantity::numeric) FROM sale_items si WHERE si.sale_id = ${salesTable.id})), 0)`,
    })
    .from(salesTable)
    .where(and(...posConds));

  // Payment method breakdown (from sale_payments joined to POS sales)
  const posSaleIds = await db
    .select({ id: salesTable.id })
    .from(salesTable)
    .where(and(...posConds));

  const ids = posSaleIds.map(r => r.id);

  let paymentBreakdown: { method: string; amount: string; count: string }[] = [];
  if (ids.length > 0) {
    const pmConds: any[] = [inArray(salePaymentsTable.saleId, ids)];
    if (q.paymentMethod) pmConds.push(eq(salePaymentsTable.method, q.paymentMethod));
    paymentBreakdown = await db
      .select({
        method: salePaymentsTable.method,
        amount: sql<string>`SUM(${salePaymentsTable.amount}::numeric)`,
        count: sql<string>`COUNT(*)`,
      })
      .from(salePaymentsTable)
      .where(and(...pmConds))
      .groupBy(salePaymentsTable.method);
  }

  // Returns/refunds at POS
  const returnConds = buildConds(salesReturnsTable, scope, q);
  const [retRow] = await db
    .select({
      returnCount: sql<string>`COUNT(*)`,
      returnAmount: sql<string>`COALESCE(SUM(${salesReturnsTable.totalAmount}::numeric), 0)`,
    })
    .from(salesReturnsTable)
    .where(and(...returnConds, inArray(salesReturnsTable.status, ["confirmed", "partially_refunded"])));

  // Sessions
  const sessionConds: any[] = [];
  if (scope !== null) {
    const allowed = scope.length > 0 ? scope : [0];
    if (q.branchId) {
      const bid = parseInt(q.branchId);
      if (scope.includes(bid)) sessionConds.push(eq(posSessionsTable.branchId, bid));
      else sessionConds.push(sql`false`);
    } else {
      sessionConds.push(inArray(posSessionsTable.branchId, allowed));
    }
  } else if (q.branchId) {
    sessionConds.push(eq(posSessionsTable.branchId, parseInt(q.branchId)));
  }
  if (q.from) sessionConds.push(gte(posSessionsTable.openedAt, new Date(q.from)));
  if (q.to) {
    const d = new Date(q.to); d.setHours(23, 59, 59, 999);
    sessionConds.push(lte(posSessionsTable.openedAt, d));
  }
  if (q.userId) sessionConds.push(eq(posSessionsTable.userId, parseInt(q.userId)));

  const [sessRow] = await db
    .select({
      totalSessions: sql<string>`COUNT(*)`,
      openSessions: sql<string>`SUM(CASE WHEN ${posSessionsTable.status} = 'open' THEN 1 ELSE 0 END)`,
      closedSessions: sql<string>`SUM(CASE WHEN ${posSessionsTable.status} = 'closed' THEN 1 ELSE 0 END)`,
      avgVariance: sql<string>`COALESCE(AVG(ABS(${posSessionsTable.variance}::numeric)), 0)`,
    })
    .from(posSessionsTable)
    .where(sessionConds.length ? and(...sessionConds) : undefined);

  const totalRevenue = n(kpiRow?.totalRevenue);
  const ticketCount = n(kpiRow?.ticketCount);
  const totalPayments = paymentBreakdown.reduce((s, r) => s + n(r.amount), 0);

  res.json({
    totalRevenue,
    totalPaid: n(kpiRow?.totalPaid),
    ticketCount,
    avgTicket: n(kpiRow?.avgTicket),
    totalItems: n(kpiRow?.totalItems),
    returnCount: n(retRow?.returnCount),
    returnAmount: n(retRow?.returnAmount),
    totalSessions: n(sessRow?.totalSessions),
    openSessions: n(sessRow?.openSessions),
    closedSessions: n(sessRow?.closedSessions),
    avgVariance: n(sessRow?.avgVariance),
    paymentBreakdown: paymentBreakdown.map(r => ({
      method: r.method,
      amount: n(r.amount),
      count: n(r.count),
      pct: totalPayments > 0 ? Math.round((n(r.amount) / totalPayments) * 100) : 0,
    })),
  });
});

function emptyKpis() {
  return {
    totalRevenue: 0, totalPaid: 0, ticketCount: 0, avgTicket: 0,
    totalItems: 0, returnCount: 0, returnAmount: 0,
    totalSessions: 0, openSessions: 0, closedSessions: 0, avgVariance: 0,
    paymentBreakdown: [],
  };
}

// ─── 2. Hourly breakdown ─────────────────────────────────────────────────────
router.get("/analytics/pos/hourly", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const q = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);

  if (scope !== null && scope.length === 0) { res.json([]); return; }

  const conds = buildConds(salesTable, scope, q);
  conds.push(eq(salesTable.fulfillmentType, "pos"), eq(salesTable.type, "sale"), eq(salesTable.status, "confirmed"));
  if (q.userId) conds.push(eq(salesTable.createdByUserId, parseInt(q.userId)));

  const rows = await db
    .select({
      hour: sql<number>`EXTRACT(HOUR FROM ${salesTable.createdAt} AT TIME ZONE 'Africa/Algiers')`,
      revenue: sql<string>`COALESCE(SUM(${salesTable.total}::numeric), 0)`,
      tickets: sql<string>`COUNT(*)`,
      avgTicket: sql<string>`COALESCE(AVG(${salesTable.total}::numeric), 0)`,
    })
    .from(salesTable)
    .where(and(...conds))
    .groupBy(sql`EXTRACT(HOUR FROM ${salesTable.createdAt} AT TIME ZONE 'Africa/Algiers')`)
    .orderBy(sql`EXTRACT(HOUR FROM ${salesTable.createdAt} AT TIME ZONE 'Africa/Algiers')`);

  // Fill all 24 hours with zeros
  const byHour: Record<number, any> = {};
  for (const r of rows) byHour[r.hour] = { revenue: n(r.revenue), tickets: n(r.tickets), avgTicket: n(r.avgTicket) };

  const result = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    label: `${String(h).padStart(2, "0")}h`,
    revenue: byHour[h]?.revenue ?? 0,
    tickets: byHour[h]?.tickets ?? 0,
    avgTicket: byHour[h]?.avgTicket ?? 0,
  }));

  res.json(result);
});

// ─── 3. Daily breakdown ──────────────────────────────────────────────────────
router.get("/analytics/pos/daily", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const q = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);

  if (scope !== null && scope.length === 0) { res.json([]); return; }

  const conds = buildConds(salesTable, scope, q);
  conds.push(eq(salesTable.fulfillmentType, "pos"), eq(salesTable.type, "sale"), eq(salesTable.status, "confirmed"));
  if (q.userId) conds.push(eq(salesTable.createdByUserId, parseInt(q.userId)));

  const rows = await db
    .select({
      date: sql<string>`DATE(${salesTable.createdAt} AT TIME ZONE 'Africa/Algiers')`,
      revenue: sql<string>`COALESCE(SUM(${salesTable.total}::numeric), 0)`,
      tickets: sql<string>`COUNT(*)`,
      avgTicket: sql<string>`COALESCE(AVG(${salesTable.total}::numeric), 0)`,
    })
    .from(salesTable)
    .where(and(...conds))
    .groupBy(sql`DATE(${salesTable.createdAt} AT TIME ZONE 'Africa/Algiers')`)
    .orderBy(sql`DATE(${salesTable.createdAt} AT TIME ZONE 'Africa/Algiers')`);

  res.json(rows.map(r => ({
    date: r.date,
    revenue: n(r.revenue),
    tickets: n(r.tickets),
    avgTicket: n(r.avgTicket),
  })));
});

// ─── 4. Top products ─────────────────────────────────────────────────────────
router.get("/analytics/pos/products", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const q = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);

  if (scope !== null && scope.length === 0) { res.json([]); return; }

  const saleConds = buildConds(salesTable, scope, q);
  saleConds.push(eq(salesTable.fulfillmentType, "pos"), eq(salesTable.type, "sale"), eq(salesTable.status, "confirmed"));
  if (q.userId) saleConds.push(eq(salesTable.createdByUserId, parseInt(q.userId)));

  const rows = await db
    .select({
      productId: saleItemsTable.productId,
      productName: productsTable.name,
      categoryId: productsTable.categoryId,
      qty: sql<string>`SUM(${saleItemsTable.quantity}::numeric)`,
      revenue: sql<string>`SUM(${saleItemsTable.total}::numeric)`,
      txCount: sql<string>`COUNT(DISTINCT ${salesTable.id})`,
    })
    .from(saleItemsTable)
    .innerJoin(salesTable, eq(saleItemsTable.saleId, salesTable.id))
    .innerJoin(productsTable, eq(saleItemsTable.productId, productsTable.id))
    .where(and(...saleConds))
    .groupBy(saleItemsTable.productId, productsTable.name, productsTable.categoryId)
    .orderBy(desc(sql`SUM(${saleItemsTable.total}::numeric)`))
    .limit(20);

  const totalRevenue = rows.reduce((s, r) => s + n(r.revenue), 0);

  res.json(rows.map(r => ({
    productId: r.productId,
    productName: r.productName,
    qty: n(r.qty),
    revenue: n(r.revenue),
    txCount: n(r.txCount),
    revenuePct: totalRevenue > 0 ? Math.round((n(r.revenue) / totalRevenue) * 100) : 0,
    avgPrice: n(r.qty) > 0 ? n(r.revenue) / n(r.qty) : 0,
  })));
});

// ─── 5. Cashier performance ───────────────────────────────────────────────────
router.get("/analytics/pos/cashiers", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const q = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);

  if (scope !== null && scope.length === 0) { res.json([]); return; }

  const saleConds = buildConds(salesTable, scope, q);
  saleConds.push(eq(salesTable.fulfillmentType, "pos"), eq(salesTable.type, "sale"), eq(salesTable.status, "confirmed"), isNotNull(salesTable.createdByUserId));
  if (q.userId) saleConds.push(eq(salesTable.createdByUserId, parseInt(q.userId)));

  const rows = await db
    .select({
      userId: salesTable.createdByUserId,
      username: usersTable.username,
      displayName: usersTable.name,
      revenue: sql<string>`COALESCE(SUM(${salesTable.total}::numeric), 0)`,
      tickets: sql<string>`COUNT(*)`,
      avgTicket: sql<string>`COALESCE(AVG(${salesTable.total}::numeric), 0)`,
    })
    .from(salesTable)
    .innerJoin(usersTable, eq(salesTable.createdByUserId, usersTable.id))
    .where(and(...saleConds))
    .groupBy(salesTable.createdByUserId, usersTable.username, usersTable.name)
    .orderBy(desc(sql`SUM(${salesTable.total}::numeric)`));

  // Sessions per cashier
  const sessionConds: any[] = [];
  if (scope !== null) {
    const allowed = scope.length > 0 ? scope : [0];
    if (q.branchId) {
      const bid = parseInt(q.branchId);
      if (scope.includes(bid)) sessionConds.push(eq(posSessionsTable.branchId, bid));
      else sessionConds.push(sql`false`);
    } else sessionConds.push(inArray(posSessionsTable.branchId, allowed));
  } else if (q.branchId) {
    sessionConds.push(eq(posSessionsTable.branchId, parseInt(q.branchId)));
  }
  if (q.from) sessionConds.push(gte(posSessionsTable.openedAt, new Date(q.from)));
  if (q.to) {
    const d = new Date(q.to); d.setHours(23, 59, 59, 999);
    sessionConds.push(lte(posSessionsTable.openedAt, d));
  }

  const sessRows = await db
    .select({
      userId: posSessionsTable.userId,
      sessionCount: sql<string>`COUNT(*)`,
      totalVariance: sql<string>`COALESCE(SUM(ABS(${posSessionsTable.variance}::numeric)), 0)`,
    })
    .from(posSessionsTable)
    .where(sessionConds.length ? and(...sessionConds) : undefined)
    .groupBy(posSessionsTable.userId);

  const sessMap = Object.fromEntries(sessRows.map(r => [r.userId, r]));
  const totalRevenue = rows.reduce((s, r) => s + n(r.revenue), 0);

  res.json(rows.map(r => ({
    userId: r.userId,
    username: r.username,
    displayName: r.displayName ?? r.username,
    revenue: n(r.revenue),
    tickets: n(r.tickets),
    avgTicket: n(r.avgTicket),
    revenuePct: totalRevenue > 0 ? Math.round((n(r.revenue) / totalRevenue) * 100) : 0,
    sessionCount: n(sessMap[r.userId!]?.sessionCount),
    totalVariance: n(sessMap[r.userId!]?.totalVariance),
  })));
});

// ─── 6. Sessions summary ────────────────────────────────────────────────────
router.get("/analytics/pos/sessions", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const q = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);

  if (scope !== null && scope.length === 0) { res.json([]); return; }

  const conds: any[] = [];
  if (scope !== null) {
    const allowed = scope.length > 0 ? scope : [0];
    if (q.branchId) {
      const bid = parseInt(q.branchId);
      if (scope.includes(bid)) conds.push(eq(posSessionsTable.branchId, bid));
      else conds.push(sql`false`);
    } else conds.push(inArray(posSessionsTable.branchId, allowed));
  } else if (q.branchId) {
    conds.push(eq(posSessionsTable.branchId, parseInt(q.branchId)));
  }
  if (q.from) conds.push(gte(posSessionsTable.openedAt, new Date(q.from)));
  if (q.to) {
    const d = new Date(q.to); d.setHours(23, 59, 59, 999);
    conds.push(lte(posSessionsTable.openedAt, d));
  }
  if (q.userId) conds.push(eq(posSessionsTable.userId, parseInt(q.userId)));

  const rows = await db
    .select({
      id: posSessionsTable.id,
      branchId: posSessionsTable.branchId,
      userId: posSessionsTable.userId,
      status: posSessionsTable.status,
      openingCash: posSessionsTable.openingCash,
      countedCash: posSessionsTable.countedCash,
      expectedCash: posSessionsTable.expectedCash,
      variance: posSessionsTable.variance,
      totalSales: posSessionsTable.totalSales,
      totalCashSales: posSessionsTable.totalCashSales,
      totalCardSales: posSessionsTable.totalCardSales,
      salesCount: posSessionsTable.salesCount,
      openedAt: posSessionsTable.openedAt,
      closedAt: posSessionsTable.closedAt,
      username: usersTable.username,
      userName: usersTable.name,
      branchName: branchesTable.name,
    })
    .from(posSessionsTable)
    .innerJoin(usersTable, eq(posSessionsTable.userId, usersTable.id))
    .innerJoin(branchesTable, eq(posSessionsTable.branchId, branchesTable.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(posSessionsTable.openedAt))
    .limit(100);

  res.json(rows.map(r => ({
    id: r.id,
    branchId: r.branchId,
    branchName: r.branchName,
    userId: r.userId,
    displayName: r.userName ?? r.username,
    username: r.username,
    status: r.status,
    openingCash: n(r.openingCash),
    countedCash: r.countedCash !== null ? n(r.countedCash) : null,
    expectedCash: r.expectedCash !== null ? n(r.expectedCash) : null,
    variance: r.variance !== null ? n(r.variance) : null,
    totalSales: n(r.totalSales),
    totalCashSales: n(r.totalCashSales),
    totalCardSales: n(r.totalCardSales),
    salesCount: r.salesCount,
    openedAt: r.openedAt,
    closedAt: r.closedAt,
  })));
});

// ─── 7. Branch comparison ─────────────────────────────────────────────────────
router.get("/analytics/pos/branches", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const q = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);

  if (scope !== null && scope.length === 0) { res.json([]); return; }

  const conds = buildConds(salesTable, scope, q);
  conds.push(eq(salesTable.fulfillmentType, "pos"), eq(salesTable.type, "sale"), eq(salesTable.status, "confirmed"));

  const rows = await db
    .select({
      branchId: salesTable.branchId,
      branchName: branchesTable.name,
      revenue: sql<string>`COALESCE(SUM(${salesTable.total}::numeric), 0)`,
      tickets: sql<string>`COUNT(*)`,
      avgTicket: sql<string>`COALESCE(AVG(${salesTable.total}::numeric), 0)`,
    })
    .from(salesTable)
    .innerJoin(branchesTable, eq(salesTable.branchId, branchesTable.id))
    .where(and(...conds))
    .groupBy(salesTable.branchId, branchesTable.name)
    .orderBy(desc(sql`SUM(${salesTable.total}::numeric)`));

  const totalRevenue = rows.reduce((s, r) => s + n(r.revenue), 0);

  res.json(rows.map(r => ({
    branchId: r.branchId,
    branchName: r.branchName,
    revenue: n(r.revenue),
    tickets: n(r.tickets),
    avgTicket: n(r.avgTicket),
    revenuePct: totalRevenue > 0 ? Math.round((n(r.revenue) / totalRevenue) * 100) : 0,
  })));
});

export default router;
