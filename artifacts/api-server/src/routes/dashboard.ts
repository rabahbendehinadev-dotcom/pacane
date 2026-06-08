import { Router, type IRouter } from "express";
import { db, salesTable, purchasesTable, stockLevelsTable, productsTable, branchesTable, posSessionsTable, productionOrdersTable, saleItemsTable, expensesTable, contactsTable, salesReturnsTable } from "@workspace/db";
import { eq, and, gte, lte, sql, inArray, isNotNull, ne, notInArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { visibleBranchIds } from "../middlewares/permissions";

const router: IRouter = Router();

function parseBranchFilter(q: Record<string, string | undefined>): number[] | null {
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

router.get("/dashboard/summary", requireAuth, async (req, res): Promise<void> => {
  const { date } = req.query as Record<string, string>;
  const filter = parseBranchFilter(req.query as Record<string, string | undefined>);
  const today = date ? new Date(date) : new Date();
  today.setHours(0, 0, 0, 0);

  const scope = visibleBranchIds(req.user!);
  if (scope !== null && scope.length === 0) {
    res.json({ salesToday: 0, ordersToday: 0, paymentsToday: 0, overduePayments: 0, lowStockCount: 0, deliveriesToday: 0, productionPending: 0, purchasesDue: 0, pendingRefundCount: 0 });
    return;
  }

  const buildBranchConds = (table: { branchId: any }) => {
    const conds: any[] = [];
    if (scope !== null) conds.push(inArray(table.branchId, scope));
    if (filter && filter.length > 0) conds.push(inArray(table.branchId, filter));
    return conds;
  };

  const salesBranchConds = buildBranchConds(salesTable);
  const purchBranchConds = buildBranchConds(purchasesTable);
  const stockBranchConds = buildBranchConds(stockLevelsTable);
  const prodBranchConds = buildBranchConds(productionOrdersTable);

  const todayConditions: any[] = [
    gte(salesTable.createdAt, today),
    eq(salesTable.type, "sale"),
    eq(salesTable.status, "confirmed"),
    ...salesBranchConds,
  ];
  const todaySales = await db.select().from(salesTable).where(and(...todayConditions));
  const salesToday = todaySales.reduce((s, sale) => s + parseFloat(sale.total as string), 0);
  const paymentsToday = todaySales.reduce((s, sale) => s + parseFloat(sale.paid as string) + parseFloat(sale.creditApplied as string), 0);

  const overdueConditions: any[] = [
    eq(salesTable.type, "sale"),
    eq(salesTable.status, "confirmed"),
    inArray(salesTable.paymentStatus, ["unpaid", "partially_paid"]),
    ...salesBranchConds,
  ];
  const unpaidSales = await db.select().from(salesTable).where(and(...overdueConditions));
  const overduePayments = unpaidSales.reduce((s, sale) => s + Math.max(0, parseFloat(sale.total as string) - parseFloat(sale.paid as string) - parseFloat(sale.creditApplied as string)), 0);

  const purchDueConditions: any[] = [
    notInArray(purchasesTable.status, ["cancelled"]),
    inArray(purchasesTable.paymentStatus, ["unpaid", "partially_paid"]),
    ...purchBranchConds,
  ];
  const unpaidPurchases = await db.select().from(purchasesTable).where(and(...purchDueConditions));
  const purchasesDue = unpaidPurchases.reduce((s, p) => s + Math.max(0, parseFloat(p.total as string) - parseFloat(p.paid as string)), 0);

  const stockRows = await db.select({ sl: stockLevelsTable, alertQty: productsTable.alertQuantity })
    .from(stockLevelsTable).leftJoin(productsTable, eq(stockLevelsTable.productId, productsTable.id))
    .where(stockBranchConds.length ? and(...stockBranchConds) : undefined);
  const lowStockCount = stockRows.filter(r => {
    const qty = parseFloat(r.sl.quantity as string);
    const alert = r.alertQty ? parseFloat(r.alertQty as string) : null;
    return alert !== null && qty <= alert;
  }).length;

  const prodConditions: any[] = [
    inArray(productionOrdersTable.status, ["planned", "in_progress"]),
    ...prodBranchConds,
  ];
  let pendingOrders: typeof productionOrdersTable.$inferSelect[] = [];
  try {
    pendingOrders = await db.select().from(productionOrdersTable).where(and(...prodConditions));
  } catch { pendingOrders = []; }

  const delivConds: any[] = [
    eq(salesTable.fulfillmentStatus, "ready"),
    gte(salesTable.createdAt, today),
    ...salesBranchConds,
  ];
  const deliveries = await db.select().from(salesTable).where(and(...delivConds));

  const returnBranchConds = buildBranchConds(salesReturnsTable as any);
  const allReturns = await db.select().from(salesReturnsTable).where(
    and(inArray(salesReturnsTable.status, ["confirmed", "partially_refunded"]), ...(returnBranchConds.length ? returnBranchConds : []))
  );
  const pendingRefundCount = allReturns.filter(r => {
    const total = parseFloat(r.totalAmount as string);
    const refunded = parseFloat(r.refundedAmount as string);
    return total > refunded;
  }).length;

  res.json({
    salesToday, ordersToday: todaySales.length, paymentsToday, overduePayments, lowStockCount,
    deliveriesToday: deliveries.length, productionPending: pendingOrders.length, purchasesDue,
    pendingRefundCount
  });
});

router.get("/dashboard/alerts", requireAuth, async (_req, res): Promise<void> => {
  const stockRows = await db.select({ sl: stockLevelsTable, alertQty: productsTable.alertQuantity, productName: productsTable.name, branchName: branchesTable.name })
    .from(stockLevelsTable)
    .leftJoin(productsTable, eq(stockLevelsTable.productId, productsTable.id))
    .leftJoin(branchesTable, eq(stockLevelsTable.branchId, branchesTable.id));

  const { type } = _req.query as { type?: string };
  const allowedBranchIds = visibleBranchIds(_req.user!);

  const stockAlerts: { id: string; type: string; entityId: number; entityType: string; message: string; branchId: number | null; branchName?: string }[] = [];
  const now = new Date();

  for (const r of stockRows) {
    if (allowedBranchIds !== null && !allowedBranchIds.includes(r.sl.branchId)) continue;
    const qty = parseFloat(r.sl.quantity as string);
    const alert = r.alertQty ? parseFloat(r.alertQty as string) : null;
    if (alert !== null && qty <= alert) {
      stockAlerts.push({
        id: `stock-${r.sl.productId}-${r.sl.branchId}`,
        type: "stock",
        entityId: r.sl.productId,
        entityType: "product",
        message: `${r.productName} — stock critique (${qty.toFixed(2)} restants) @ ${r.branchName ?? ""}`,
        branchId: r.sl.branchId,
        branchName: r.branchName ?? undefined,
      });
    }
  }

  const purchAlertConds: any[] = [eq(purchasesTable.paymentStatus, "unpaid")];
  if (allowedBranchIds !== null) purchAlertConds.push(inArray(purchasesTable.branchId, allowedBranchIds.length > 0 ? allowedBranchIds : [0]));
  const overduePayments = await db.select().from(purchasesTable).where(and(...purchAlertConds));
  const paymentAlerts = overduePayments.map((p, i) => ({
    id: `payment-${i}`, type: "payment" as const, entityId: p.id, entityType: "purchase",
    message: `Achat ${p.reference} — solde impayé ${parseFloat(p.total as string).toFixed(2)} DA`,
    branchId: p.branchId,
  }));

  const salesReturnsRows = await db.select({
    id: salesReturnsTable.id,
    branchId: salesReturnsTable.branchId,
    totalAmount: salesReturnsTable.totalAmount,
    refundedAmount: salesReturnsTable.refundedAmount,
    reference: salesReturnsTable.reference,
  })
    .from(salesReturnsTable)
    .where(inArray(salesReturnsTable.status, ["confirmed", "partially_refunded"]));

  const refundAlerts = salesReturnsRows
    .filter(r => allowedBranchIds === null || allowedBranchIds.includes(r.branchId ?? -1))
    .filter(r => parseFloat(r.totalAmount as string) > parseFloat(r.refundedAmount as string))
    .map((r, i) => ({
      id: `refund-${i}`, type: "payment" as const, entityId: r.id, entityType: "return",
      message: `Retour ${r.reference} — remboursement en attente`,
      branchId: r.branchId ?? null,
    }));

  const allAlerts = [...stockAlerts, ...paymentAlerts, ...refundAlerts];

  if (!type) {
    res.json(allAlerts);
    return;
  }
  const filtered = type === "stock" ? stockAlerts : [...paymentAlerts, ...refundAlerts];
  res.json(filtered);
});

router.get("/dashboard/recent-activity", requireAuth, async (req, res): Promise<void> => {
  const filter2 = parseBranchFilter(req.query as Record<string, string | undefined>);
  const scope = visibleBranchIds(req.user!);
  const limitDate = new Date();
  limitDate.setDate(limitDate.getDate() - 7);

  const saleConds: any[] = [gte(salesTable.createdAt, limitDate)];
  if (scope !== null && scope.length > 0) saleConds.push(inArray(salesTable.branchId, scope));
  if (filter2 && filter2.length > 0) saleConds.push(inArray(salesTable.branchId, filter2));
  const recentSales = await db.select().from(salesTable).where(and(...saleConds)).limit(10);

  const purchConds: any[] = [gte(purchasesTable.createdAt, limitDate)];
  if (scope !== null && scope.length > 0) purchConds.push(inArray(purchasesTable.branchId, scope));
  if (filter2 && filter2.length > 0) purchConds.push(inArray(purchasesTable.branchId, filter2));
  const recentPurchases = await db.select().from(purchasesTable).where(and(...purchConds)).limit(10);

  const activity = [
    ...recentSales.map(s => ({
      id: `sale-${s.id}`, type: "sale", description: `Vente ${s.reference} - ${parseFloat(s.total as string).toFixed(2)} DA`,
      date: s.createdAt, branchId: s.branchId,
    })),
    ...recentPurchases.map(p => ({
      id: `purchase-${p.id}`, type: "purchase", description: `Achat ${p.reference} - ${parseFloat(p.total as string).toFixed(2)} DA`,
      date: p.createdAt, branchId: p.branchId,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 15);

  res.json(activity);
});

router.get("/dashboard/branch-performance", requireAuth, async (req, res): Promise<void> => {
  const { days } = req.query as Record<string, string>;
  const filter3 = parseBranchFilter(req.query as Record<string, string | undefined>);
  const since = new Date();
  since.setDate(since.getDate() - (parseInt(days ?? "30", 10)));

  const scope = visibleBranchIds(req.user!);

  const saleConds: any[] = [gte(salesTable.createdAt, since), eq(salesTable.type, "sale"), eq(salesTable.status, "confirmed")];
  if (scope !== null && scope.length > 0) saleConds.push(inArray(salesTable.branchId, scope));
  if (filter3 && filter3.length > 0) saleConds.push(inArray(salesTable.branchId, filter3));
  const sales = await db.select().from(salesTable).where(and(...saleConds));

  const expConds: any[] = [eq(expensesTable.status, "validated"), gte(expensesTable.createdAt, since)];
  if (scope !== null && scope.length > 0) expConds.push(inArray(expensesTable.branchId, scope));
  if (filter3 && filter3.length > 0) expConds.push(inArray(expensesTable.branchId, filter3));
  const expenses = await db.select().from(expensesTable).where(and(...expConds));

  const retConds: any[] = [ne(salesReturnsTable.status, "draft"), gte(salesReturnsTable.createdAt, since)];
  if (scope !== null && scope.length > 0) retConds.push(inArray(salesReturnsTable.branchId, scope));
  const returns = await db.select().from(salesReturnsTable).where(and(...retConds));

  const branchIds = [...new Set([...sales.map(s => s.branchId), ...expenses.map(e => e.branchId)])];
  const branches = await db.select().from(branchesTable).where(branchIds.length > 0 ? inArray(branchesTable.id, branchIds) : undefined);

  const result = branches.map(b => ({
    branchId: b.id, branchName: b.name,
    salesAmount: sales.filter(s => s.branchId === b.id).reduce((sum, s) => sum + parseFloat(s.total as string), 0),
    ordersCount: sales.filter(s => s.branchId === b.id).length,
    expensesAmount: expenses.filter(e => e.branchId === b.id).reduce((sum, e) => sum + parseFloat(e.amount as string), 0),
    returnsAmount: returns.filter(r => r.branchId === b.id).reduce((sum, r) => sum + parseFloat(r.totalAmount as string), 0),
  }));

  res.json(result);
});

router.get("/dashboard/financial-summary", requireAuth, async (req, res): Promise<void> => {
  const filter4 = parseBranchFilter(req.query as Record<string, string | undefined>);
  const scope = visibleBranchIds(req.user!);

  if (filter4 && scope !== null && filter4.some(id => !scope.includes(id))) {
    res.status(403).json({ error: "Accès refusé à cette succursale" });
    return;
  }

  const firstOfMonth = new Date();
  firstOfMonth.setDate(1);
  firstOfMonth.setHours(0, 0, 0, 0);

  const saleConds: any[] = [gte(salesTable.createdAt, firstOfMonth), eq(salesTable.type, "sale"), eq(salesTable.status, "confirmed")];
  if (scope !== null && scope.length > 0) saleConds.push(inArray(salesTable.branchId, scope));
  if (filter4 && filter4.length > 0) saleConds.push(inArray(salesTable.branchId, filter4));
  const allSales = await db.select().from(salesTable).where(and(...saleConds));

  const salesThisMonth = allSales.filter(s => {
    const d = new Date(s.createdAt);
    return d >= firstOfMonth;
  });

  const retMonthConds: any[] = [gte(salesReturnsTable.createdAt, firstOfMonth), ne(salesReturnsTable.status, "draft")];
  if (scope !== null && scope.length > 0) retMonthConds.push(inArray(salesReturnsTable.branchId, scope));
  if (filter4 && filter4.length > 0) retMonthConds.push(inArray(salesReturnsTable.branchId, filter4));
  const allReturnsMonth = await db.select().from(salesReturnsTable).where(and(...retMonthConds));
  const returnsThisMonth = allReturnsMonth.reduce((s, r) => s + parseFloat(r.totalAmount as string), 0);

  const expConds: any[] = [gte(expensesTable.createdAt, firstOfMonth), eq(expensesTable.status, "validated")];
  if (scope !== null && scope.length > 0) expConds.push(inArray(expensesTable.branchId, scope));
  if (filter4 && filter4.length > 0) expConds.push(inArray(expensesTable.branchId, filter4));
  const expensesThisMonth = await db.select().from(expensesTable).where(and(...expConds));

  const totalSales = salesThisMonth.reduce((s, sale) => s + parseFloat(sale.total as string), 0);
  const totalExpenses = expensesThisMonth.reduce((s, e) => s + parseFloat(e.amount as string), 0);
  const netSales = totalSales - returnsThisMonth;
  const operationalResult = netSales - totalExpenses;

  const purchConds: any[] = [inArray(purchasesTable.paymentStatus, ["unpaid", "partially_paid"]), notInArray(purchasesTable.status, ["cancelled"])];
  if (scope !== null && scope.length > 0) purchConds.push(inArray(purchasesTable.branchId, scope));
  if (filter4 && filter4.length > 0) purchConds.push(inArray(purchasesTable.branchId, filter4));
  const unpaidPurchases = await db.select().from(purchasesTable).where(and(...purchConds));
  const suppliersDue = unpaidPurchases.reduce((s, p) => s + Math.max(0, parseFloat(p.total as string) - parseFloat(p.paid as string)), 0);

  const receivConds: any[] = [eq(salesTable.type, "sale"), eq(salesTable.status, "confirmed"), inArray(salesTable.paymentStatus, ["unpaid", "partially_paid"])];
  if (scope !== null && scope.length > 0) receivConds.push(inArray(salesTable.branchId, scope));
  if (filter4 && filter4.length > 0) receivConds.push(inArray(salesTable.branchId, filter4));
  const unpaidSales = await db.select().from(salesTable).where(and(...receivConds));
  const receivables = unpaidSales.reduce((s, sale) => s + Math.max(0, parseFloat(sale.total as string) - parseFloat(sale.paid as string) - parseFloat(sale.creditApplied as string)), 0);

  res.json({ totalSales, returnsThisMonth, netSales, totalExpenses, operationalResult, suppliersDue, receivables });
});

// ─── GET /dashboard/expenses ─── vue financière complète avec dépenses ────────
router.get("/dashboard/expenses", requireAuth, async (req, res): Promise<void> => {
  const filter = parseBranchFilter(req.query as Record<string, string | undefined>);
  const scope = visibleBranchIds(req.user!);

  if (filter && scope !== null && filter.some(id => !scope.includes(id))) {
    res.status(403).json({ error: "Accès refusé à cette succursale" });
    return;
  }

  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

  const buildConds = (table: any) => {
    const conds: any[] = [];
    if (scope !== null && scope.length > 0) conds.push(inArray(table.branchId, scope));
    if (filter && filter.length > 0) conds.push(inArray(table.branchId, filter));
    return conds;
  };

  // This month sales
  const saleConds = [...buildConds(salesTable), gte(salesTable.createdAt, firstOfMonth), eq(salesTable.type, "sale"), eq(salesTable.status, "confirmed")];
  const salesThisMonth = await db.select().from(salesTable).where(and(...saleConds));
  const totalSales = salesThisMonth.reduce((s, r) => s + parseFloat(r.total as string), 0);

  // This month returns
  const retConds = [...buildConds(salesReturnsTable), gte(salesReturnsTable.createdAt, firstOfMonth), ne(salesReturnsTable.status, "draft")];
  const returnsThisMonth = await db.select().from(salesReturnsTable).where(and(...retConds));
  const totalReturns = returnsThisMonth.reduce((s, r) => s + parseFloat(r.totalAmount as string), 0);

  // This month expenses
  const expConds = [...buildConds(expensesTable), gte(expensesTable.createdAt, firstOfMonth), eq(expensesTable.status, "validated")];
  const expThisMonth = await db.select().from(expensesTable).where(and(...expConds));
  const totalExpenses = expThisMonth.reduce((s, e) => s + parseFloat(e.amount as string), 0);

  // Last month expenses
  const expLastConds = [...buildConds(expensesTable), gte(expensesTable.createdAt, firstOfLastMonth), lte(expensesTable.createdAt, lastOfLastMonth), eq(expensesTable.status, "validated")];
  const expLastMonth = await db.select().from(expensesTable).where(and(...expLastConds));
  const totalExpensesLastMonth = expLastMonth.reduce((s, e) => s + parseFloat(e.amount as string), 0);

  // Computed fields
  const netSalesAfterReturns = totalSales - totalReturns;
  const returnRatio = totalSales > 0 ? totalReturns / totalSales : 0;
  const netThisMonth = netSalesAfterReturns - totalExpenses;
  const expensePressureRatio = netSalesAfterReturns > 0 ? totalExpenses / netSalesAfterReturns : null;
  const monthOverMonthChange = totalExpensesLastMonth > 0
    ? ((totalExpenses - totalExpensesLastMonth) / totalExpensesLastMonth) * 100
    : null;

  // By category
  const categoryMap = new Map<string, number>();
  for (const e of expThisMonth) {
    const cat = (e as any).category ?? "Autre";
    categoryMap.set(cat, (categoryMap.get(cat) ?? 0) + parseFloat(e.amount as string));
  }
  const byCategory = [...categoryMap.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  // By branch
  const branchIdSet = [...new Set(expThisMonth.map(e => e.branchId))];
  const branchRows = branchIdSet.length > 0
    ? await db.select().from(branchesTable).where(inArray(branchesTable.id, branchIdSet))
    : [];
  const byBranch = branchRows.map(b => ({
    branchId: b.id,
    branchName: b.name,
    amount: expThisMonth.filter(e => e.branchId === b.id).reduce((s, e) => s + parseFloat(e.amount as string), 0),
  })).sort((a, b) => b.amount - a.amount);

  res.json({
    expensesThisMonth: totalExpenses,
    expensesLastMonth: totalExpensesLastMonth,
    salesThisMonth: totalSales,
    returnsThisMonth: totalReturns,
    netSalesAfterReturns,
    returnRatio,
    netThisMonth,
    expensePressureRatio,
    monthOverMonthChange,
    byCategory,
    byBranch,
  });
});

/**
 * GET /dashboard/sales-trend
 * Returns daily sales totals for the last N days (default 14).
 */
router.get("/dashboard/sales-trend", requireAuth, async (req, res): Promise<void> => {
  const { days = "14" } = req.query as Record<string, string>;
  const filter = parseBranchFilter(req.query as Record<string, string | undefined>);
  const numDays = Math.min(Math.max(parseInt(days, 10) || 14, 1), 90);

  const scope = visibleBranchIds(req.user!);
  if (scope !== null && scope.length === 0) {
    res.json([]);
    return;
  }

  const since = new Date();
  since.setDate(since.getDate() - numDays);
  since.setHours(0, 0, 0, 0);

  const conds: any[] = [
    eq(salesTable.type, "sale"),
    eq(salesTable.status, "confirmed"),
    gte(salesTable.createdAt, since),
  ];
  if (scope !== null) conds.push(inArray(salesTable.branchId, scope));
  if (filter && filter.length > 0) conds.push(inArray(salesTable.branchId, filter));

  const rows = await db.select().from(salesTable).where(and(...conds));

  // Group by date
  const map = new Map<string, { amount: number; orders: number }>();
  for (let i = 0; i < numDays; i++) {
    const d = new Date();
    d.setDate(d.getDate() - (numDays - 1 - i));
    const key = d.toISOString().slice(0, 10);
    map.set(key, { amount: 0, orders: 0 });
  }

  for (const row of rows) {
    const key = (row.createdAt as Date).toISOString().slice(0, 10);
    if (map.has(key)) {
      const entry = map.get(key)!;
      entry.amount += parseFloat(row.total as string);
      entry.orders += 1;
    }
  }

  const result = [...map.entries()].map(([date, v]) => ({ date, ...v }));
  res.json(result);
});

/**
 * GET /dashboard/top-products
 * Returns top 10 products by revenue this month.
 */
router.get("/dashboard/top-products", requireAuth, async (req, res): Promise<void> => {
  const filter = parseBranchFilter(req.query as Record<string, string | undefined>);

  const scope = visibleBranchIds(req.user!);
  if (scope !== null && scope.length === 0) {
    res.json([]);
    return;
  }

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const saleConds: any[] = [
    eq(salesTable.type, "sale"),
    eq(salesTable.status, "confirmed"),
    gte(salesTable.createdAt, monthStart),
  ];
  if (scope !== null) saleConds.push(inArray(salesTable.branchId, scope));
  if (filter && filter.length > 0) saleConds.push(inArray(salesTable.branchId, filter));

  const confirmedSales = await db.select({ id: salesTable.id }).from(salesTable).where(and(...saleConds));
  if (confirmedSales.length === 0) {
    res.json([]);
    return;
  }

  const saleIds = confirmedSales.map(s => s.id);
  const itemRows = await db.select().from(saleItemsTable).where(inArray(saleItemsTable.saleId, saleIds));

  // Aggregate by product
  const productMap = new Map<number, { totalSold: number; totalRevenue: number }>();
  for (const item of itemRows) {
    const prev = productMap.get(item.productId) ?? { totalSold: 0, totalRevenue: 0 };
    const qty = parseFloat(item.quantity as string) || 0;
    const price = parseFloat(item.unitPrice as string) || 0;
    productMap.set(item.productId, {
      totalSold: prev.totalSold + qty,
      totalRevenue: prev.totalRevenue + qty * price,
    });
  }

  if (productMap.size === 0) {
    res.json([]);
    return;
  }

  const productIds = [...productMap.keys()];
  const productRows = await db.select().from(productsTable).where(inArray(productsTable.id, productIds));
  const productNames = new Map(productRows.map(p => [p.id, p.name]));

  const sorted = [...productMap.entries()]
    .sort((a, b) => b[1].totalRevenue - a[1].totalRevenue)
    .slice(0, 10)
    .map(([productId, data], idx) => ({
      productId,
      productName: productNames.get(productId) ?? "Produit inconnu",
      totalSold: data.totalSold,
      totalRevenue: data.totalRevenue,
      rank: idx + 1,
    }));

  res.json(sorted);
});

export default router;
