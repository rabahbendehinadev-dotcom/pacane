/**
 * Treasury & Finance Overview API
 * Management-level cash visibility: NOT full legal bookkeeping.
 * Data sources: sale payments, purchase payments, expenses, returns/refunds, receivables, payables.
 *
 * GET /treasury/overview   — KPIs: inflows, outflows, position, receivables, payables, net result
 * GET /treasury/trend      — Daily cash flow trend (inflow vs outflow)
 * GET /treasury/branches   — Per-branch treasury comparison
 * GET /treasury/aging      — Receivables & payables aging buckets
 * GET /treasury/movements  — Recent major financial movements (all sources)
 * GET /treasury/breakdown  — Inflow/outflow source breakdown
 *
 * Common query params: from, to, branchId
 * All data is real — no mocked values.
 */

import { Router, type IRouter } from "express";
import {
  db,
  salesTable, salePaymentsTable,
  purchasesTable, purchasePaymentsTable,
  expensesTable, salesReturnsTable,
  branchesTable, contactsTable,
} from "@workspace/db";
import { eq, and, gte, lte, sql, inArray, desc, not, isNotNull, or } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, visibleBranchIds } from "../middlewares/permissions";
import { P } from "../lib/permissions";

const router: IRouter = Router();

function n(v: unknown): number { return parseFloat((v as string) ?? "0") || 0; }

// ─── Scope helpers ─────────────────────────────────────────────────────────────
function scopeBranchCond(field: any, scope: number[] | null, q: Record<string, string>) {
  if (scope !== null) {
    const allowed = scope.length > 0 ? scope : [0];
    if (q.branchId) {
      const bid = parseInt(q.branchId);
      return scope.includes(bid) ? eq(field, bid) : sql`false`;
    }
    return inArray(field, allowed);
  }
  if (q.branchId) return eq(field, parseInt(q.branchId));
  return sql`true`;
}

function dateConds(field: any, from?: string, to?: string) {
  const c: any[] = [];
  if (from) c.push(gte(field, new Date(from)));
  if (to) {
    const d = new Date(to); d.setHours(23, 59, 59, 999);
    c.push(lte(field, d));
  }
  return c;
}

function dateCondsStr(field: any, from?: string, to?: string) {
  const c: any[] = [];
  if (from) c.push(gte(field, from));
  if (to) c.push(lte(field, to));
  return c;
}

// ─── 1. Overview KPIs ─────────────────────────────────────────────────────────
router.get("/treasury/overview", requireAuth, requirePermission(P.treasury.view), async (req, res): Promise<void> => {
  const q = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);
  if (scope !== null && scope.length === 0) { res.json(emptyOverview()); return; }

  const branchCond = scopeBranchCond(salesTable.branchId, scope, q);
  const purchaseBranchCond = scopeBranchCond(purchasesTable.branchId, scope, q);
  const expenseBranchCond = scopeBranchCond(expensesTable.branchId, scope, q);
  const returnBranchCond = scopeBranchCond(salesReturnsTable.branchId, scope, q);

  // ── Inflows: actual payments received from customers (via sale_payments)
  const salePmtConds = [branchCond, ...dateConds(salePaymentsTable.createdAt, q.from, q.to)];
  // Join to sales to apply branch filter
  const [inflowRow] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${salePaymentsTable.amount}::numeric), 0)`,
      cash: sql<string>`COALESCE(SUM(CASE WHEN ${salePaymentsTable.method} = 'cash' THEN ${salePaymentsTable.amount}::numeric ELSE 0 END), 0)`,
      card: sql<string>`COALESCE(SUM(CASE WHEN ${salePaymentsTable.method} = 'card' THEN ${salePaymentsTable.amount}::numeric ELSE 0 END), 0)`,
      credit: sql<string>`COALESCE(SUM(CASE WHEN ${salePaymentsTable.method} = 'credit' THEN ${salePaymentsTable.amount}::numeric ELSE 0 END), 0)`,
      transfer: sql<string>`COALESCE(SUM(CASE WHEN ${salePaymentsTable.method} IN ('transfer','virement') THEN ${salePaymentsTable.amount}::numeric ELSE 0 END), 0)`,
    })
    .from(salePaymentsTable)
    .innerJoin(salesTable, eq(salePaymentsTable.saleId, salesTable.id))
    .where(and(...salePmtConds));

  // ── Outflows: purchase payments
  const purchPmtConds = [purchaseBranchCond, ...dateConds(purchasePaymentsTable.createdAt, q.from, q.to)];
  const [purchOutflow] = await db
    .select({ total: sql<string>`COALESCE(SUM(${purchasePaymentsTable.amount}::numeric), 0)` })
    .from(purchasePaymentsTable)
    .innerJoin(purchasesTable, eq(purchasePaymentsTable.purchaseId, purchasesTable.id))
    .where(and(...purchPmtConds));

  // ── Outflows: expenses (validated only)
  const expConds = [expenseBranchCond, ...dateCondsStr(expensesTable.date, q.from, q.to), eq(expensesTable.status, "validated")];
  const [expOutflow] = await db
    .select({ total: sql<string>`COALESCE(SUM(${expensesTable.amount}::numeric), 0)` })
    .from(expensesTable)
    .where(and(...expConds));

  // ── Outflows: return refunds (cash paid back)
  const retConds = [returnBranchCond, ...dateConds(salesReturnsTable.updatedAt, q.from, q.to), inArray(salesReturnsTable.status, ["partially_refunded", "refunded"])];
  const [retOutflow] = await db
    .select({ total: sql<string>`COALESCE(SUM(${salesReturnsTable.refundedAmount}::numeric), 0)` })
    .from(salesReturnsTable)
    .where(and(...retConds));

  // ── Outstanding receivables (total owed by customers, not date-scoped)
  const recConds = [branchCond, eq(salesTable.type, "sale"), eq(salesTable.status, "confirmed"), not(eq(salesTable.paymentStatus, "paid"))];
  const [recRow] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${salesTable.total}::numeric - ${salesTable.paid}::numeric - COALESCE(${salesTable.creditApplied}::numeric, 0)), 0)`,
      count: sql<string>`COUNT(*)`,
    })
    .from(salesTable)
    .where(and(...recConds));

  // ── Outstanding payables (owed to suppliers, not date-scoped)
  const payConds = [purchaseBranchCond, inArray(purchasesTable.status, ["confirmed", "received", "partial"]), not(eq(purchasesTable.paymentStatus, "paid"))];
  const [payRow] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${purchasesTable.total}::numeric - ${purchasesTable.paid}::numeric), 0)`,
      count: sql<string>`COUNT(*)`,
    })
    .from(purchasesTable)
    .where(and(...payConds));

  // ── Revenue booked (confirmed sales total, date-scoped)
  const revConds = [branchCond, eq(salesTable.type, "sale"), eq(salesTable.status, "confirmed"), ...dateConds(salesTable.createdAt, q.from, q.to)];
  const [revRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(${salesTable.total}::numeric), 0)` })
    .from(salesTable)
    .where(and(...revConds));

  // ── Purchase cost booked (confirmed purchases total, date-scoped)
  const purCostConds = [purchaseBranchCond, inArray(purchasesTable.status, ["confirmed", "received", "partial"]), ...dateConds(purchasesTable.createdAt, q.from, q.to)];
  const [purCostRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(${purchasesTable.total}::numeric), 0)` })
    .from(purchasesTable)
    .where(and(...purCostConds));

  const inflow = n(inflowRow?.total);
  const outflowPurch = n(purchOutflow?.total);
  const outflowExp = n(expOutflow?.total);
  const outflowRefunds = n(retOutflow?.total);
  const outflow = outflowPurch + outflowExp + outflowRefunds;
  const cashPosition = inflow - outflow;
  const revenue = n(revRow?.total);
  const purchCost = n(purCostRow?.total);
  const netResult = revenue - purchCost - n(expOutflow?.total);

  res.json({
    inflow,
    inflowBreakdown: {
      cash: n(inflowRow?.cash),
      card: n(inflowRow?.card),
      credit: n(inflowRow?.credit),
      transfer: n(inflowRow?.transfer),
    },
    outflow,
    outflowBreakdown: {
      purchases: outflowPurch,
      expenses: outflowExp,
      refunds: outflowRefunds,
    },
    cashPosition,
    receivables: n(recRow?.total),
    receivablesCount: n(recRow?.count),
    payables: n(payRow?.total),
    payablesCount: n(payRow?.count),
    revenue,
    purchCost,
    netResult,
  });
});

function emptyOverview() {
  return {
    inflow: 0, inflowBreakdown: { cash: 0, card: 0, credit: 0, transfer: 0 },
    outflow: 0, outflowBreakdown: { purchases: 0, expenses: 0, refunds: 0 },
    cashPosition: 0, receivables: 0, receivablesCount: 0, payables: 0, payablesCount: 0,
    revenue: 0, purchCost: 0, netResult: 0,
  };
}

// ─── 2. Cash flow trend (daily) ────────────────────────────────────────────────
router.get("/treasury/trend", requireAuth, requirePermission(P.treasury.view), async (req, res): Promise<void> => {
  const q = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);
  if (scope !== null && scope.length === 0) { res.json([]); return; }

  const branchCond = scopeBranchCond(salesTable.branchId, scope, q);
  const purchaseBranchCond = scopeBranchCond(purchasesTable.branchId, scope, q);
  const expenseBranchCond = scopeBranchCond(expensesTable.branchId, scope, q);

  // Daily inflows from sale payments
  const inflows = await db
    .select({
      date: sql<string>`DATE(${salePaymentsTable.createdAt} AT TIME ZONE 'Africa/Algiers')`,
      amount: sql<string>`COALESCE(SUM(${salePaymentsTable.amount}::numeric), 0)`,
    })
    .from(salePaymentsTable)
    .innerJoin(salesTable, eq(salePaymentsTable.saleId, salesTable.id))
    .where(and(branchCond, ...dateConds(salePaymentsTable.createdAt, q.from, q.to)))
    .groupBy(sql`DATE(${salePaymentsTable.createdAt} AT TIME ZONE 'Africa/Algiers')`)
    .orderBy(sql`DATE(${salePaymentsTable.createdAt} AT TIME ZONE 'Africa/Algiers')`);

  // Daily outflows from purchase payments
  const purchOutflows = await db
    .select({
      date: sql<string>`DATE(${purchasePaymentsTable.createdAt} AT TIME ZONE 'Africa/Algiers')`,
      amount: sql<string>`COALESCE(SUM(${purchasePaymentsTable.amount}::numeric), 0)`,
    })
    .from(purchasePaymentsTable)
    .innerJoin(purchasesTable, eq(purchasePaymentsTable.purchaseId, purchasesTable.id))
    .where(and(purchaseBranchCond, ...dateConds(purchasePaymentsTable.createdAt, q.from, q.to)))
    .groupBy(sql`DATE(${purchasePaymentsTable.createdAt} AT TIME ZONE 'Africa/Algiers')`)
    .orderBy(sql`DATE(${purchasePaymentsTable.createdAt} AT TIME ZONE 'Africa/Algiers')`);

  // Daily expenses
  const expOutflows = await db
    .select({
      date: sql<string>`${expensesTable.date}`,
      amount: sql<string>`COALESCE(SUM(${expensesTable.amount}::numeric), 0)`,
    })
    .from(expensesTable)
    .where(and(expenseBranchCond, ...dateCondsStr(expensesTable.date, q.from, q.to), eq(expensesTable.status, "validated")))
    .groupBy(expensesTable.date)
    .orderBy(expensesTable.date);

  // Merge by date
  const dateMap: Record<string, { inflow: number; outflow: number }> = {};
  for (const r of inflows) {
    dateMap[r.date] = dateMap[r.date] ?? { inflow: 0, outflow: 0 };
    dateMap[r.date].inflow += n(r.amount);
  }
  for (const r of purchOutflows) {
    dateMap[r.date] = dateMap[r.date] ?? { inflow: 0, outflow: 0 };
    dateMap[r.date].outflow += n(r.amount);
  }
  for (const r of expOutflows) {
    dateMap[r.date] = dateMap[r.date] ?? { inflow: 0, outflow: 0 };
    dateMap[r.date].outflow += n(r.amount);
  }

  const result = Object.entries(dateMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      inflow: v.inflow,
      outflow: v.outflow,
      net: v.inflow - v.outflow,
      cumulative: 0, // filled below
    }));

  let cum = 0;
  for (const r of result) { cum += r.net; r.cumulative = cum; }

  res.json(result);
});

// ─── 3. Branch comparison ─────────────────────────────────────────────────────
router.get("/treasury/branches", requireAuth, requirePermission(P.treasury.view), async (req, res): Promise<void> => {
  const q = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);
  if (scope !== null && scope.length === 0) { res.json([]); return; }

  const branches = await db.select().from(branchesTable);
  const activeBranches = scope !== null ? branches.filter(b => scope.includes(b.id)) : branches;

  const result = await Promise.all(activeBranches.map(async b => {
    const bq = { ...q, branchId: String(b.id) };
    const bscope: number[] | null = null; // We've already filtered

    // Inflows
    const [inflowRow] = await db
      .select({ total: sql<string>`COALESCE(SUM(${salePaymentsTable.amount}::numeric), 0)` })
      .from(salePaymentsTable)
      .innerJoin(salesTable, eq(salePaymentsTable.saleId, salesTable.id))
      .where(and(eq(salesTable.branchId, b.id), ...dateConds(salePaymentsTable.createdAt, q.from, q.to)));

    // Outflows: purchases
    const [purchRow] = await db
      .select({ total: sql<string>`COALESCE(SUM(${purchasePaymentsTable.amount}::numeric), 0)` })
      .from(purchasePaymentsTable)
      .innerJoin(purchasesTable, eq(purchasePaymentsTable.purchaseId, purchasesTable.id))
      .where(and(eq(purchasesTable.branchId, b.id), ...dateConds(purchasePaymentsTable.createdAt, q.from, q.to)));

    // Outflows: expenses
    const [expRow] = await db
      .select({ total: sql<string>`COALESCE(SUM(${expensesTable.amount}::numeric), 0)` })
      .from(expensesTable)
      .where(and(eq(expensesTable.branchId, b.id), ...dateCondsStr(expensesTable.date, q.from, q.to), eq(expensesTable.status, "validated")));

    // Receivables
    const [recRow] = await db
      .select({ total: sql<string>`COALESCE(SUM(${salesTable.total}::numeric - ${salesTable.paid}::numeric - COALESCE(${salesTable.creditApplied}::numeric, 0)), 0)` })
      .from(salesTable)
      .where(and(eq(salesTable.branchId, b.id), eq(salesTable.type, "sale"), eq(salesTable.status, "confirmed"), not(eq(salesTable.paymentStatus, "paid"))));

    // Revenue booked
    const [revRow] = await db
      .select({ total: sql<string>`COALESCE(SUM(${salesTable.total}::numeric), 0)` })
      .from(salesTable)
      .where(and(eq(salesTable.branchId, b.id), eq(salesTable.type, "sale"), eq(salesTable.status, "confirmed"), ...dateConds(salesTable.createdAt, q.from, q.to)));

    const inflow = n(inflowRow?.total);
    const outflow = n(purchRow?.total) + n(expRow?.total);
    return {
      branchId: b.id,
      branchName: b.name,
      inflow,
      outflow,
      net: inflow - outflow,
      receivables: n(recRow?.total),
      revenue: n(revRow?.total),
      expenses: n(expRow?.total),
    };
  }));

  res.json(result.sort((a, b) => b.inflow - a.inflow));
});

// ─── 4. Receivables & payables aging ──────────────────────────────────────────
router.get("/treasury/aging", requireAuth, requirePermission(P.treasury.view), async (req, res): Promise<void> => {
  const q = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);
  if (scope !== null && scope.length === 0) { res.json({ receivables: [], payables: [] }); return; }

  const branchCond = scopeBranchCond(salesTable.branchId, scope, q);
  const purchaseBranchCond = scopeBranchCond(purchasesTable.branchId, scope, q);

  // Receivables aging
  const recRows = await db
    .select({
      bucket: sql<string>`CASE
        WHEN NOW() - ${salesTable.createdAt} <= INTERVAL '30 days' THEN '0-30'
        WHEN NOW() - ${salesTable.createdAt} <= INTERVAL '60 days' THEN '31-60'
        WHEN NOW() - ${salesTable.createdAt} <= INTERVAL '90 days' THEN '61-90'
        ELSE '90+'
      END`,
      amount: sql<string>`SUM(${salesTable.total}::numeric - ${salesTable.paid}::numeric - COALESCE(${salesTable.creditApplied}::numeric, 0))`,
      count: sql<string>`COUNT(*)`,
    })
    .from(salesTable)
    .where(and(branchCond, eq(salesTable.type, "sale"), eq(salesTable.status, "confirmed"), not(eq(salesTable.paymentStatus, "paid"))))
    .groupBy(sql`CASE
      WHEN NOW() - ${salesTable.createdAt} <= INTERVAL '30 days' THEN '0-30'
      WHEN NOW() - ${salesTable.createdAt} <= INTERVAL '60 days' THEN '31-60'
      WHEN NOW() - ${salesTable.createdAt} <= INTERVAL '90 days' THEN '61-90'
      ELSE '90+'
    END`);

  // Payables aging
  const payRows = await db
    .select({
      bucket: sql<string>`CASE
        WHEN NOW() - ${purchasesTable.createdAt} <= INTERVAL '30 days' THEN '0-30'
        WHEN NOW() - ${purchasesTable.createdAt} <= INTERVAL '60 days' THEN '31-60'
        WHEN NOW() - ${purchasesTable.createdAt} <= INTERVAL '90 days' THEN '61-90'
        ELSE '90+'
      END`,
      amount: sql<string>`SUM(${purchasesTable.total}::numeric - ${purchasesTable.paid}::numeric)`,
      count: sql<string>`COUNT(*)`,
    })
    .from(purchasesTable)
    .where(and(purchaseBranchCond, inArray(purchasesTable.status, ["confirmed", "received", "partial"]), not(eq(purchasesTable.paymentStatus, "paid"))))
    .groupBy(sql`CASE
      WHEN NOW() - ${purchasesTable.createdAt} <= INTERVAL '30 days' THEN '0-30'
      WHEN NOW() - ${purchasesTable.createdAt} <= INTERVAL '60 days' THEN '31-60'
      WHEN NOW() - ${purchasesTable.createdAt} <= INTERVAL '90 days' THEN '61-90'
      ELSE '90+'
    END`);

  const ORDER = ["0-30", "31-60", "61-90", "90+"];
  const normalize = (rows: typeof recRows) => {
    const map: Record<string, { amount: number; count: number }> = {};
    for (const r of rows) map[r.bucket] = { amount: n(r.amount), count: n(r.count) };
    return ORDER.map(b => ({
      bucket: b,
      label: b === "0-30" ? "0–30 jours" : b === "31-60" ? "31–60 jours" : b === "61-90" ? "61–90 jours" : "90+ jours",
      amount: map[b]?.amount ?? 0,
      count: map[b]?.count ?? 0,
      risk: b === "90+" ? "critical" : b === "61-90" ? "warning" : "normal",
    }));
  };

  res.json({ receivables: normalize(recRows), payables: normalize(payRows) });
});

// ─── 5. Recent financial movements ────────────────────────────────────────────
router.get("/treasury/movements", requireAuth, requirePermission(P.treasury.view), async (req, res): Promise<void> => {
  const q = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);
  if (scope !== null && scope.length === 0) { res.json([]); return; }

  const limit = parseInt(q.limit ?? "40");
  const branchCond = scopeBranchCond(salesTable.branchId, scope, q);
  const purchaseBranchCond = scopeBranchCond(purchasesTable.branchId, scope, q);
  const expenseBranchCond = scopeBranchCond(expensesTable.branchId, scope, q);

  // Sale payments (inflows)
  const salePayments = await db
    .select({
      id: salePaymentsTable.id,
      type: sql<string>`'inflow'`,
      source: sql<string>`'Règlement client'`,
      method: salePaymentsTable.method,
      amount: salePaymentsTable.amount,
      reference: salesTable.reference,
      branchId: salesTable.branchId,
      createdAt: salePaymentsTable.createdAt,
      customerName: contactsTable.displayName,
    })
    .from(salePaymentsTable)
    .innerJoin(salesTable, eq(salePaymentsTable.saleId, salesTable.id))
    .leftJoin(contactsTable, eq(salesTable.customerId, contactsTable.id))
    .where(and(branchCond, ...dateConds(salePaymentsTable.createdAt, q.from, q.to)))
    .orderBy(desc(salePaymentsTable.createdAt))
    .limit(limit);

  // Purchase payments (outflows)
  const purchPayments = await db
    .select({
      id: purchasePaymentsTable.id,
      type: sql<string>`'outflow'`,
      source: sql<string>`'Paiement fournisseur'`,
      method: purchasePaymentsTable.method,
      amount: purchasePaymentsTable.amount,
      reference: purchasesTable.reference,
      branchId: purchasesTable.branchId,
      createdAt: purchasePaymentsTable.createdAt,
      supplierName: contactsTable.displayName,
    })
    .from(purchasePaymentsTable)
    .innerJoin(purchasesTable, eq(purchasePaymentsTable.purchaseId, purchasesTable.id))
    .leftJoin(contactsTable, eq(purchasesTable.supplierId, contactsTable.id))
    .where(and(purchaseBranchCond, ...dateConds(purchasePaymentsTable.createdAt, q.from, q.to)))
    .orderBy(desc(purchasePaymentsTable.createdAt))
    .limit(limit);

  // Expenses (outflows)
  const expenses = await db
    .select({
      id: expensesTable.id,
      branchId: expensesTable.branchId,
      amount: expensesTable.amount,
      category: expensesTable.category,
      reference: expensesTable.reference,
      paymentMethod: expensesTable.paymentMethod,
      date: expensesTable.date,
      createdAt: expensesTable.createdAt,
    })
    .from(expensesTable)
    .where(and(expenseBranchCond, ...dateCondsStr(expensesTable.date, q.from, q.to), eq(expensesTable.status, "validated")))
    .orderBy(desc(expensesTable.createdAt))
    .limit(limit);

  // Get branch names
  const branches = await db.select({ id: branchesTable.id, name: branchesTable.name }).from(branchesTable);
  const branchMap = Object.fromEntries(branches.map(b => [b.id, b.name]));

  // Merge and sort
  const movements = [
    ...salePayments.map(r => ({
      id: `sp-${r.id}`,
      type: "inflow" as const,
      source: "Règlement client",
      description: r.customerName ? `${r.customerName} · ${r.reference}` : r.reference,
      amount: n(r.amount),
      method: r.method,
      branchName: branchMap[r.branchId] ?? "—",
      date: r.createdAt,
    })),
    ...purchPayments.map(r => ({
      id: `pp-${r.id}`,
      type: "outflow" as const,
      source: "Paiement fournisseur",
      description: r.supplierName ? `${r.supplierName} · ${r.reference}` : r.reference,
      amount: n(r.amount),
      method: r.method,
      branchName: branchMap[r.branchId] ?? "—",
      date: r.createdAt,
    })),
    ...expenses.map(r => ({
      id: `ex-${r.id}`,
      type: "outflow" as const,
      source: "Dépense",
      description: `${r.category} · ${r.reference}`,
      amount: n(r.amount),
      method: r.paymentMethod,
      branchName: branchMap[r.branchId] ?? "—",
      date: new Date(r.date),
    })),
  ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit);

  res.json(movements);
});

// ─── 6. Inflow/outflow source breakdown ────────────────────────────────────────
router.get("/treasury/breakdown", requireAuth, requirePermission(P.treasury.view), async (req, res): Promise<void> => {
  const q = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);
  if (scope !== null && scope.length === 0) {
    res.json({ inflows: [], outflows: [] }); return;
  }

  const branchCond = scopeBranchCond(salesTable.branchId, scope, q);
  const purchaseBranchCond = scopeBranchCond(purchasesTable.branchId, scope, q);
  const expenseBranchCond = scopeBranchCond(expensesTable.branchId, scope, q);
  const returnBranchCond = scopeBranchCond(salesReturnsTable.branchId, scope, q);

  // Inflow by payment method
  const inflowRows = await db
    .select({
      method: salePaymentsTable.method,
      amount: sql<string>`COALESCE(SUM(${salePaymentsTable.amount}::numeric), 0)`,
    })
    .from(salePaymentsTable)
    .innerJoin(salesTable, eq(salePaymentsTable.saleId, salesTable.id))
    .where(and(branchCond, ...dateConds(salePaymentsTable.createdAt, q.from, q.to)))
    .groupBy(salePaymentsTable.method)
    .orderBy(desc(sql`SUM(${salePaymentsTable.amount}::numeric)`));

  // Outflow breakdown
  const [purchTotal] = await db
    .select({ total: sql<string>`COALESCE(SUM(${purchasePaymentsTable.amount}::numeric), 0)` })
    .from(purchasePaymentsTable)
    .innerJoin(purchasesTable, eq(purchasePaymentsTable.purchaseId, purchasesTable.id))
    .where(and(purchaseBranchCond, ...dateConds(purchasePaymentsTable.createdAt, q.from, q.to)));

  const expensesByCategory = await db
    .select({
      category: expensesTable.category,
      amount: sql<string>`COALESCE(SUM(${expensesTable.amount}::numeric), 0)`,
    })
    .from(expensesTable)
    .where(and(expenseBranchCond, ...dateCondsStr(expensesTable.date, q.from, q.to), eq(expensesTable.status, "validated")))
    .groupBy(expensesTable.category)
    .orderBy(desc(sql`SUM(${expensesTable.amount}::numeric)`));

  const [refundTotal] = await db
    .select({ total: sql<string>`COALESCE(SUM(${salesReturnsTable.refundedAmount}::numeric), 0)` })
    .from(salesReturnsTable)
    .where(and(returnBranchCond, ...dateConds(salesReturnsTable.updatedAt, q.from, q.to), inArray(salesReturnsTable.status, ["partially_refunded", "refunded"])));

  const PAYMENT_LABELS: Record<string, string> = {
    cash: "Espèces", card: "Carte", credit: "Crédit",
    transfer: "Virement", virement: "Virement", check: "Chèque", cheque: "Chèque",
  };

  const totalInflow = inflowRows.reduce((s, r) => s + n(r.amount), 0);
  const totalOutflowPurch = n(purchTotal?.total);
  const totalOutflowRef = n(refundTotal?.total);
  const totalOutflowExp = expensesByCategory.reduce((s, r) => s + n(r.amount), 0);
  const totalOutflow = totalOutflowPurch + totalOutflowRef + totalOutflowExp;

  const outflows = [
    { label: "Achats fournisseurs", amount: totalOutflowPurch, pct: totalOutflow > 0 ? Math.round((totalOutflowPurch / totalOutflow) * 100) : 0, color: "#6366f1" },
    ...expensesByCategory.map(r => ({ label: r.category, amount: n(r.amount), pct: totalOutflow > 0 ? Math.round((n(r.amount) / totalOutflow) * 100) : 0, color: "#f59e0b" })),
    { label: "Remboursements", amount: totalOutflowRef, pct: totalOutflow > 0 ? Math.round((totalOutflowRef / totalOutflow) * 100) : 0, color: "#ef4444" },
  ].filter(r => r.amount > 0);

  res.json({
    inflows: inflowRows.map(r => ({
      label: PAYMENT_LABELS[r.method] ?? r.method,
      method: r.method,
      amount: n(r.amount),
      pct: totalInflow > 0 ? Math.round((n(r.amount) / totalInflow) * 100) : 0,
    })),
    outflows,
  });
});

export default router;
