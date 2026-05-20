import { Router, type IRouter } from "express";
import {
  db, salesTable, saleItemsTable, salePaymentsTable,
  purchasesTable, purchaseItemsTable,
  stockLevelsTable, stockMovementsTable,
  productsTable, branchesTable, posSessionsTable,
  productionOrdersTable, contactsTable, categoriesTable, unitsTable,
  transfersTable, usersTable, expensesTable,
  salesReturnsTable, salesReturnItemsTable,
} from "@workspace/db";
import { eq, and, gte, lte, sql, inArray, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, visibleBranchIds } from "../middlewares/permissions";
import { P } from "../lib/permissions";

const router: IRouter = Router();

function n(v: unknown) { return parseFloat((v as string) ?? "0") || 0; }

// Returns WHERE clauses for branch + date filtering.
// branchScope: null = admin (no restriction), [] = user with no branches (return nothing), [...] = restrict to these
function buildScopeConds(
  table: { branchId: any; createdAt?: any },
  branchScope: number[] | null,
  branchId?: string,
  from?: string,
  to?: string,
) {
  const conds: any[] = [];
  if (branchScope !== null) {
    const ids = branchId
      ? [parseInt(branchId)].filter(id => branchScope.includes(id))
      : branchScope;
    if (ids.length === 0) return null; // signals caller to return empty
    conds.push(inArray(table.branchId, ids));
  } else if (branchId) {
    conds.push(eq(table.branchId, parseInt(branchId)));
  }
  if (from && table.createdAt) conds.push(gte(table.createdAt, new Date(from)));
  if (to && table.createdAt) {
    const d = new Date(to); d.setHours(23, 59, 59, 999);
    conds.push(lte(table.createdAt, d));
  }
  return conds;
}

// ─── SALES REPORT ────────────────────────────────────────────────────────────

router.get("/reports/sales", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const { branchId, from, to } = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);
  const conds = buildScopeConds(salesTable, scope, branchId, from, to);
  if (conds === null) { res.json(emptySalesReport()); return; }

  const sales = await db.select().from(salesTable).where(conds.length ? and(...conds) : undefined);
  const branches = await db.select().from(branchesTable);
  const contacts = await db.select().from(contactsTable);
  const contactMap = Object.fromEntries(contacts.map(c => [c.id, c.displayName]));
  const branchMap = Object.fromEntries(branches.map(b => [b.id, b.name]));

  const saleIds = sales.map(s => s.id);
  const items = saleIds.length > 0
    ? await db.select({ si: saleItemsTable, productName: productsTable.name })
        .from(saleItemsTable).leftJoin(productsTable, eq(saleItemsTable.productId, productsTable.id))
        .where(inArray(saleItemsTable.saleId, saleIds))
    : [];
  const payments = saleIds.length > 0
    ? await db.select().from(salePaymentsTable).where(inArray(salePaymentsTable.saleId, saleIds))
    : [];

  const actualSales = sales.filter(s => s.type === "sale" && s.status !== "cancelled");

  // By branch (sales only)
  const byBranchMap: Record<number, { branchId: number; branchName: string; salesAmount: number; ordersCount: number; growth: number }> = {};
  for (const s of actualSales) {
    if (!byBranchMap[s.branchId]) byBranchMap[s.branchId] = { branchId: s.branchId, branchName: branchMap[s.branchId] ?? "", salesAmount: 0, ordersCount: 0, growth: 0 };
    byBranchMap[s.branchId].salesAmount += n(s.total);
    byBranchMap[s.branchId].ordersCount++;
  }

  // By customer
  const byCustomerMap: Record<string, { customerName: string; amount: number; count: number; paid: number }> = {};
  for (const s of actualSales) {
    const cname = s.contactId ? (contactMap[s.contactId] ?? "Client inconnu") : "Vente comptoir";
    if (!byCustomerMap[cname]) byCustomerMap[cname] = { customerName: cname, amount: 0, count: 0, paid: 0 };
    byCustomerMap[cname].amount += n(s.total);
    byCustomerMap[cname].count++;
    byCustomerMap[cname].paid += n(s.paid);
  }

  // Top products (sales only)
  const productSales: Record<string, { productName: string; quantity: number; revenue: number }> = {};
  const salesSet = new Set(actualSales.map(s => s.id));
  for (const item of items) {
    if (!salesSet.has(item.si.saleId)) continue;
    const name = item.productName ?? "Inconnu";
    if (!productSales[name]) productSales[name] = { productName: name, quantity: 0, revenue: 0 };
    productSales[name].quantity += n(item.si.quantity);
    productSales[name].revenue += n(item.si.total);
  }

  // Monthly trend
  const monthlyTrend: Record<string, { month: string; amount: number; orders: number; paid: number }> = {};
  for (const s of actualSales) {
    const month = s.createdAt.toISOString().slice(0, 7);
    if (!monthlyTrend[month]) monthlyTrend[month] = { month, amount: 0, orders: 0, paid: 0 };
    monthlyTrend[month].amount += n(s.total);
    monthlyTrend[month].orders++;
    monthlyTrend[month].paid += n(s.paid);
  }

  // Payment by method
  const byMethod: Record<string, number> = {};
  for (const p of payments) { byMethod[p.method] = (byMethod[p.method] ?? 0) + n(p.amount); }

  const totalRevenue = actualSales.reduce((s, r) => s + n(r.total), 0);
  const totalPaid = actualSales.reduce((s, r) => s + n(r.paid), 0);
  const totalCreditApplied = actualSales.reduce((s, r) => s + n(r.creditApplied), 0);
  const totalDue = actualSales.reduce((s, r) => s + Math.max(0, n(r.total) - n(r.paid) - n(r.creditApplied)), 0);

  res.json({
    totalRevenue, totalOrders: actualSales.length, totalPaid, totalDue,
    totalDocRevenue: sales.reduce((s, r) => s + n(r.total), 0),
    unpaidCount: actualSales.filter(s => n(s.paid) + n(s.creditApplied) < n(s.total)).length,
    byBranch: Object.values(byBranchMap).sort((a, b) => b.salesAmount - a.salesAmount),
    byPaymentMethod: Object.entries(byMethod).map(([method, amount]) => ({ method, amount })),
    byCustomer: Object.values(byCustomerMap).sort((a, b) => b.amount - a.amount).slice(0, 15),
    topProducts: Object.values(productSales).sort((a, b) => b.revenue - a.revenue).slice(0, 8),
    monthlyTrend: Object.values(monthlyTrend).sort((a, b) => a.month.localeCompare(b.month)),
    conversionFunnel: {
      drafts: sales.filter(s => s.type === "draft").length,
      quotes: sales.filter(s => s.type === "quotation").length,
      orders: sales.filter(s => s.type === "order").length,
      sales: actualSales.length,
    },
    byType: (() => {
      const t: Record<string, { count: number; total: number }> = {};
      for (const s of sales) {
        if (!t[s.type]) t[s.type] = { count: 0, total: 0 };
        t[s.type].count++; t[s.type].total += n(s.total);
      }
      return t;
    })(),
    dailyTrend: [],
  });
});

function emptySalesReport() {
  return {
    totalRevenue: 0, totalOrders: 0, totalPaid: 0, totalDue: 0, totalDocRevenue: 0, unpaidCount: 0,
    byBranch: [], byPaymentMethod: [], byCustomer: [], topProducts: [], monthlyTrend: [],
    conversionFunnel: { drafts: 0, quotes: 0, orders: 0, sales: 0 }, byType: {}, dailyTrend: [],
  };
}

// ─── PURCHASES REPORT ───────────────────────────────────────────────────────

router.get("/reports/purchases", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const { branchId, from, to } = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);
  const conds = buildScopeConds(purchasesTable, scope, branchId, from, to);
  if (conds === null) {
    res.json({ totalPurchases: 0, totalPaid: 0, totalDue: 0, count: 0, bySupplier: [], byProduct: [], byBranch: [], byStatus: {}, monthlyTrend: [], pendingReceptions: [] });
    return;
  }

  const purchases = await db.select().from(purchasesTable).where(conds.length ? and(...conds) : undefined);
  const contacts = await db.select().from(contactsTable);
  const branches = await db.select().from(branchesTable);
  const contactMap = Object.fromEntries(contacts.map(c => [c.id, c.displayName]));
  const branchMap = Object.fromEntries(branches.map(b => [b.id, b.name]));

  // By supplier
  const bySupplier: Record<string, { supplierName: string; amount: number; paid: number; count: number }> = {};
  for (const p of purchases) {
    const name = p.supplierId ? (contactMap[p.supplierId] ?? "Fournisseur inconnu") : "Inconnu";
    if (!bySupplier[name]) bySupplier[name] = { supplierName: name, amount: 0, paid: 0, count: 0 };
    bySupplier[name].amount += n(p.total);
    bySupplier[name].paid += n(p.paid);
    bySupplier[name].count++;
  }

  // By branch
  const byBranch: Record<number, { branchId: number; branchName: string; amount: number; count: number }> = {};
  for (const p of purchases) {
    if (!byBranch[p.branchId]) byBranch[p.branchId] = { branchId: p.branchId, branchName: branchMap[p.branchId] ?? "", amount: 0, count: 0 };
    byBranch[p.branchId].amount += n(p.total);
    byBranch[p.branchId].count++;
  }

  // By status
  const byStatus: Record<string, { count: number; amount: number }> = {};
  for (const p of purchases) {
    const st = p.status ?? "pending";
    if (!byStatus[st]) byStatus[st] = { count: 0, amount: 0 };
    byStatus[st].count++; byStatus[st].amount += n(p.total);
  }

  // Purchase items
  const pIds = purchases.map(p => p.id);
  const pItems = pIds.length > 0
    ? await db.select({ pi: purchaseItemsTable, productName: productsTable.name })
        .from(purchaseItemsTable).leftJoin(productsTable, eq(purchaseItemsTable.productId, productsTable.id))
        .where(inArray(purchaseItemsTable.purchaseId, pIds))
    : [];
  const byProduct: Record<string, { productName: string; quantity: number; amount: number }> = {};
  for (const item of pItems) {
    const name = item.productName ?? "Inconnu";
    if (!byProduct[name]) byProduct[name] = { productName: name, quantity: 0, amount: 0 };
    byProduct[name].quantity += n(item.pi.quantity);
    byProduct[name].amount += n(item.pi.total);
  }

  // Monthly trend
  const monthlyTrend: Record<string, { month: string; amount: number; count: number }> = {};
  for (const p of purchases) {
    const month = p.createdAt.toISOString().slice(0, 7);
    if (!monthlyTrend[month]) monthlyTrend[month] = { month, amount: 0, count: 0 };
    monthlyTrend[month].amount += n(p.total); monthlyTrend[month].count++;
  }

  res.json({
    totalPurchases: purchases.reduce((s, p) => s + n(p.total), 0),
    totalPaid: purchases.reduce((s, p) => s + n(p.paid), 0),
    totalDue: purchases.reduce((s, p) => s + n(p.total) - n(p.paid), 0),
    count: purchases.length,
    bySupplier: Object.values(bySupplier).sort((a, b) => b.amount - a.amount),
    byProduct: Object.values(byProduct).sort((a, b) => b.amount - a.amount).slice(0, 10),
    byBranch: Object.values(byBranch).sort((a, b) => b.amount - a.amount),
    byStatus,
    monthlyTrend: Object.values(monthlyTrend).sort((a, b) => a.month.localeCompare(b.month)),
    pendingReceptions: purchases.filter(p => p.status === "pending" || p.status === "partial").map(p => ({
      id: p.id, reference: p.reference,
      supplierName: p.supplierId ? (contactMap[p.supplierId] ?? "Inconnu") : "Inconnu",
      branchName: branchMap[p.branchId] ?? "", status: p.status,
      total: n(p.total), paid: n(p.paid),
    })),
  });
});

// ─── STOCK REPORT ────────────────────────────────────────────────────────────

router.get("/reports/stock-valuation", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const { branchId } = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);

  // Stock levels scope
  const slConds: any[] = [];
  if (scope !== null) {
    const ids = branchId ? [parseInt(branchId)].filter(id => scope.includes(id)) : scope;
    if (ids.length === 0) {
      res.json({ totalValue: 0, byBranch: [], byCategory: [], items: [], criticalItems: [], movementsSummary: [], transferActivity: [] });
      return;
    }
    slConds.push(inArray(stockLevelsTable.branchId, ids));
  } else if (branchId) {
    slConds.push(eq(stockLevelsTable.branchId, parseInt(branchId)));
  }

  const rows = await db.select({
    sl: stockLevelsTable, costPrice: productsTable.costPrice,
    productName: productsTable.name, productType: productsTable.type,
    alertQty: productsTable.alertQuantity, branchName: branchesTable.name,
    unitName: unitsTable.abbreviation, catName: categoriesTable.name,
  }).from(stockLevelsTable)
    .leftJoin(productsTable, eq(stockLevelsTable.productId, productsTable.id))
    .leftJoin(branchesTable, eq(stockLevelsTable.branchId, branchesTable.id))
    .leftJoin(unitsTable, eq(productsTable.unitId, unitsTable.id))
    .leftJoin(categoriesTable, eq(productsTable.categoryId, categoriesTable.id))
    .where(slConds.length ? and(...slConds) : undefined);

  const items = rows.map(r => {
    const qty = n(r.sl.quantity);
    const alertQty = r.alertQty ? n(r.alertQty) : null;
    let status: "ok" | "low" | "critical" | "out" = "ok";
    if (qty === 0) status = "out";
    else if (alertQty && qty <= alertQty * 0.5) status = "critical";
    else if (alertQty && qty <= alertQty) status = "low";
    return {
      productId: r.sl.productId, productName: r.productName ?? "",
      branchId: r.sl.branchId, branchName: r.branchName ?? "",
      quantity: qty, alertQuantity: alertQty, unitName: r.unitName ?? "",
      catName: r.catName ?? "Sans catégorie", status,
      valueCost: qty * n(r.costPrice),
    };
  });

  const totalValue = items.reduce((s, i) => s + i.valueCost, 0);
  const byBranch: Record<string, { branchName: string; value: number; products: number }> = {};
  const byCategory: Record<string, { categoryName: string; value: number; quantity: number }> = {};
  for (const item of items) {
    if (!byBranch[item.branchName]) byBranch[item.branchName] = { branchName: item.branchName, value: 0, products: 0 };
    byBranch[item.branchName].value += item.valueCost; byBranch[item.branchName].products++;
    const cat = item.catName;
    if (!byCategory[cat]) byCategory[cat] = { categoryName: cat, value: 0, quantity: 0 };
    byCategory[cat].value += item.valueCost; byCategory[cat].quantity += item.quantity;
  }

  const criticalItems = items.filter(i => i.status !== "ok")
    .sort((a, b) => ({ out: 0, critical: 1, low: 2 } as Record<string, number>)[a.status] - ({ out: 0, critical: 1, low: 2 } as Record<string, number>)[b.status]);

  // Movements summary (last 30 days)
  const since30 = new Date(); since30.setDate(since30.getDate() - 30);
  const movConds: any[] = [gte(stockMovementsTable.createdAt, since30)];
  if (slConds.length > 0) movConds.push(inArray(stockMovementsTable.branchId, slConds.length > 0 ? rows.map(r => r.sl.branchId).filter((v, i, a) => a.indexOf(v) === i) : []));

  const movements = await db.select().from(stockMovementsTable).where(and(...movConds));
  const movByType: Record<string, { type: string; count: number; qty: number }> = {};
  for (const m of movements) {
    if (!movByType[m.type]) movByType[m.type] = { type: m.type, count: 0, qty: 0 };
    movByType[m.type].count++; movByType[m.type].qty += Math.abs(n(m.quantity));
  }

  // Transfer activity
  const allTransfers = await db.select({
    t: transfersTable,
    srcName: sql<string>`(SELECT name FROM branches WHERE id = ${transfersTable.sourceBranchId})`,
    dstName: sql<string>`(SELECT name FROM branches WHERE id = ${transfersTable.destinationBranchId})`,
  }).from(transfersTable).orderBy(desc(transfersTable.createdAt)).limit(8);

  res.json({
    totalValue,
    byBranch: Object.values(byBranch).sort((a, b) => b.value - a.value),
    byCategory: Object.values(byCategory).sort((a, b) => b.value - a.value),
    items: items.sort((a, b) => b.valueCost - a.valueCost),
    criticalItems,
    movementsSummary: Object.values(movByType),
    transferActivity: allTransfers.map(r => ({
      id: r.t.id, reference: r.t.reference, status: r.t.status,
      sourceBranchName: r.srcName, destinationBranchName: r.dstName,
      createdAt: r.t.createdAt,
    })),
  });
});

// ─── PRODUCTION REPORT ──────────────────────────────────────────────────────

router.get("/reports/production", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const { branchId, from, to } = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);
  const conds = buildScopeConds(productionOrdersTable, scope, branchId, from, to);
  if (conds === null) {
    res.json({ totalOrders: 0, completed: 0, inProgress: 0, blocked: 0, theoreticalCost: 0, actualCost: 0, byProduct: [], byBranch: [], recentOrders: [] });
    return;
  }

  const orders = await db.select({
    po: productionOrdersTable, productName: productsTable.name,
    branchName: branchesTable.name, userName: usersTable.name,
  }).from(productionOrdersTable)
    .leftJoin(productsTable, eq(productionOrdersTable.productId, productsTable.id))
    .leftJoin(branchesTable, eq(productionOrdersTable.branchId, branchesTable.id))
    .leftJoin(usersTable, eq(productionOrdersTable.createdByUserId, usersTable.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(productionOrdersTable.createdAt));

  const byProduct: Record<string, { productName: string; quantity: number; orders: number; cost: number }> = {};
  const byBranch: Record<string, { branchName: string; count: number; completed: number; cost: number }> = {};
  for (const o of orders) {
    const pname = o.productName ?? "Inconnu";
    if (!byProduct[pname]) byProduct[pname] = { productName: pname, quantity: 0, orders: 0, cost: 0 };
    byProduct[pname].orders++;
    if (o.po.actualQuantity) byProduct[pname].quantity += n(o.po.actualQuantity);
    byProduct[pname].cost += n(o.po.theoreticalCost);

    const bname = o.branchName ?? "Inconnu";
    if (!byBranch[bname]) byBranch[bname] = { branchName: bname, count: 0, completed: 0, cost: 0 };
    byBranch[bname].count++;
    if (o.po.status === "completed") byBranch[bname].completed++;
    byBranch[bname].cost += n(o.po.theoreticalCost);
  }

  res.json({
    totalOrders: orders.length,
    completed: orders.filter(o => o.po.status === "completed").length,
    inProgress: orders.filter(o => ["launched", "in_progress"].includes(o.po.status)).length,
    blocked: orders.filter(o => o.po.status === "blocked").length,
    theoreticalCost: orders.reduce((s, o) => s + n(o.po.theoreticalCost), 0),
    actualCost: orders.reduce((s, o) => s + n(o.po.actualCost), 0),
    byProduct: Object.values(byProduct).sort((a, b) => b.orders - a.orders),
    byBranch: Object.values(byBranch).sort((a, b) => b.count - a.count),
    recentOrders: orders.slice(0, 15).map(o => ({
      id: o.po.id, reference: o.po.reference, status: o.po.status,
      productName: o.productName, branchName: o.branchName,
      quantity: n(o.po.quantity),
      actualQuantity: o.po.actualQuantity ? n(o.po.actualQuantity) : null,
      theoreticalCost: n(o.po.theoreticalCost), createdAt: o.po.createdAt,
    })),
  });
});

// ─── BRANCH PERFORMANCE ──────────────────────────────────────────────────────

router.get("/reports/branch-performance", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const { from, to } = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);

  const allBranches = await db.select().from(branchesTable);
  const visibleBranches = scope === null ? allBranches : allBranches.filter(b => scope.includes(b.id));

  // Build date conds for sales
  const dateConds: any[] = [];
  if (from) dateConds.push(gte(salesTable.createdAt, new Date(from)));
  if (to) { const d = new Date(to); d.setHours(23,59,59,999); dateConds.push(lte(salesTable.createdAt, d)); }

  const branchIds = visibleBranches.map(b => b.id);
  if (branchIds.length === 0) { res.json([]); return; }

  const salesConds: any[] = [inArray(salesTable.branchId, branchIds), ...dateConds];
  const salesData = await db.select().from(salesTable).where(and(...salesConds));
  const actualSales = salesData.filter(s => s.type === "sale");

  const purchData = await db.select().from(purchasesTable).where(inArray(purchasesTable.branchId, branchIds));
  const prodData = await db.select().from(productionOrdersTable).where(inArray(productionOrdersTable.branchId, branchIds));

  const stockData = await db.select({
    branchId: stockLevelsTable.branchId,
    value: sql<string>`COALESCE(SUM(${stockLevelsTable.quantity}::numeric * COALESCE(${productsTable.costPrice}::numeric, 0)), 0)`,
    products: sql<string>`COUNT(DISTINCT ${stockLevelsTable.productId})`,
    lowStock: sql<string>`COUNT(*) FILTER (WHERE ${stockLevelsTable.quantity}::numeric <= COALESCE(${productsTable.alertQuantity}::numeric, 0) AND ${stockLevelsTable.quantity}::numeric > 0)`,
  }).from(stockLevelsTable)
    .leftJoin(productsTable, eq(stockLevelsTable.productId, productsTable.id))
    .where(inArray(stockLevelsTable.branchId, branchIds))
    .groupBy(stockLevelsTable.branchId);

  const stockMap = Object.fromEntries(stockData.map(r => [r.branchId, r]));

  const result = visibleBranches.map(branch => {
    const bSales = actualSales.filter(s => s.branchId === branch.id);
    const bPurch = purchData.filter(p => p.branchId === branch.id);
    const bProd = prodData.filter(o => o.branchId === branch.id);
    const bStock = stockMap[branch.id];
    return {
      branchId: branch.id, branchName: branch.name, branchType: branch.type,
      salesAmount: bSales.reduce((s, r) => s + n(r.total), 0),
      salesCount: bSales.length,
      salesPaid: bSales.reduce((s, r) => s + n(r.paid), 0),
      purchaseAmount: bPurch.reduce((s, p) => s + n(p.total), 0),
      purchaseCount: bPurch.length,
      productionCount: bProd.length,
      productionCompleted: bProd.filter(o => o.status === "completed").length,
      stockValue: bStock ? n(bStock.value) : 0,
      stockProducts: bStock ? Number(bStock.products) : 0,
      lowStockItems: bStock ? Number(bStock.lowStock) : 0,
      growth: 0, ordersCount: bSales.length,
    };
  });

  res.json(result);
});

// ─── FINANCIAL SUMMARY ───────────────────────────────────────────────────────

router.get("/reports/financial", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const scope = visibleBranchIds(req.user!);

  const salesConds: any[] = scope !== null && scope.length > 0 ? [inArray(salesTable.branchId, scope)] : scope !== null ? [] : [];
  const purchConds: any[] = scope !== null && scope.length > 0 ? [inArray(purchasesTable.branchId, scope)] : scope !== null ? [] : [];
  const expConds: any[] = [sql`${expensesTable.status} = 'validated'`, ...(scope !== null && scope.length > 0 ? [inArray(expensesTable.branchId, scope)] : [])];

  if (scope !== null && scope.length === 0) {
    res.json({ totalRevenue: 0, totalCollected: 0, totalReceivables: 0, totalPurchases: 0, totalPurchasesPaid: 0, totalPayables: 0, totalExpenses: 0, netBalance: 0, netPosition: 0, collectionRate: 0, receivables: [], payables: [], creditExposure: [], expensesByCategory: [] });
    return;
  }

  const [sales, purchases, contacts, expRows] = await Promise.all([
    db.select().from(salesTable).where(salesConds.length ? and(...salesConds) : undefined),
    db.select().from(purchasesTable).where(purchConds.length ? and(...purchConds) : undefined),
    db.select().from(contactsTable),
    db.select().from(expensesTable).where(and(...expConds)),
  ]);
  const contactMap = Object.fromEntries(contacts.map(c => [c.id, c]));

  const actualSales = sales.filter(s => s.type === "sale" && s.status !== "cancelled");

  // Customer receivables
  const receivablesMap: Record<string, { customerName: string; total: number; paid: number; due: number; overdueCount: number }> = {};
  for (const s of actualSales) {
    const due = n(s.total) - n(s.paid) - n(s.creditApplied);
    if (due <= 0) continue;
    const cname = s.contactId ? (contactMap[s.contactId]?.displayName ?? "Client inconnu") : "Vente comptoir";
    if (!receivablesMap[cname]) receivablesMap[cname] = { customerName: cname, total: 0, paid: 0, due: 0, overdueCount: 0 };
    receivablesMap[cname].total += n(s.total);
    receivablesMap[cname].paid += n(s.paid) + n(s.creditApplied);
    receivablesMap[cname].due += due;
    receivablesMap[cname].overdueCount++;
  }

  // Supplier payables
  const payablesMap: Record<string, { supplierName: string; total: number; paid: number; due: number; count: number }> = {};
  for (const p of purchases) {
    const due = n(p.total) - n(p.paid);
    if (due <= 0) continue;
    const sname = p.supplierId ? (contactMap[p.supplierId]?.displayName ?? "Fournisseur inconnu") : "Inconnu";
    if (!payablesMap[sname]) payablesMap[sname] = { supplierName: sname, total: 0, paid: 0, due: 0, count: 0 };
    payablesMap[sname].total += n(p.total);
    payablesMap[sname].paid += n(p.paid);
    payablesMap[sname].due += due;
    payablesMap[sname].count++;
  }

  // Credit exposure
  const creditExposure = contacts
    .filter(c => c.type === "customer" && c.creditLimit != null && n(c.creditLimit) > 0)
    .map(c => {
      const custSales = actualSales.filter(s => s.contactId === c.id);
      const totalDue = custSales.reduce((s, r) => s + Math.max(0, n(r.total) - n(r.paid) - n(r.creditApplied)), 0);
      const limit = n(c.creditLimit);
      return {
        customerId: c.id, customerName: c.displayName, creditLimit: limit, currentDue: totalDue,
        utilization: limit > 0 ? (totalDue / limit) * 100 : 0,
        status: totalDue >= limit ? "exceeded" : totalDue >= limit * 0.8 ? "warning" : "ok",
      };
    }).filter(c => c.currentDue > 0).sort((a, b) => b.utilization - a.utilization);

  const totalRevenue = actualSales.reduce((s, r) => s + n(r.total), 0);
  const totalCollected = actualSales.reduce((s, r) => s + n(r.paid) + n(r.creditApplied), 0);
  const totalPurchases = purchases.reduce((s, p) => s + n(p.total), 0);
  const totalPurchasesPaid = purchases.reduce((s, p) => s + n(p.paid), 0);
  const totalReceivables = Object.values(receivablesMap).reduce((s, r) => s + r.due, 0);
  const totalPayables = Object.values(payablesMap).reduce((s, r) => s + r.due, 0);

  // Expenses (validated only)
  const totalExpenses = expRows.reduce((s, r) => s + n(r.amount), 0);
  const expCatMap: Record<string, { category: string; amount: number; count: number }> = {};
  for (const r of expRows) {
    if (!expCatMap[r.category]) expCatMap[r.category] = { category: r.category, amount: 0, count: 0 };
    expCatMap[r.category].amount += n(r.amount);
    expCatMap[r.category].count++;
  }
  const expensesByCategory = Object.values(expCatMap).sort((a, b) => b.amount - a.amount).slice(0, 8);

  // Net operational balance: what's collected minus what's spent (expenses + purchases paid)
  const netBalance = totalCollected - totalPurchasesPaid - totalExpenses;

  res.json({
    totalRevenue, totalCollected, totalReceivables,
    totalPurchases, totalPurchasesPaid, totalPayables,
    totalExpenses, netBalance,
    netPosition: totalReceivables - totalPayables,
    collectionRate: totalRevenue > 0 ? (totalCollected / totalRevenue) * 100 : 0,
    receivables: Object.values(receivablesMap).sort((a, b) => b.due - a.due).slice(0, 12),
    payables: Object.values(payablesMap).sort((a, b) => b.due - a.due).slice(0, 12),
    creditExposure,
    expensesByCategory,
  });
});

// ─── EXPENSES REPORT ─────────────────────────────────────────────────────────

router.get("/reports/expenses", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const { branchId, category, paymentMethod, from, to } = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);

  if (scope !== null && scope.length === 0) {
    res.json({ totalExpenses: 0, totalValidated: 0, totalDraft: 0, byCategory: [], byBranch: [], byMonth: [], byPaymentMethod: [], recentExpenses: [] });
    return;
  }

  const conds: any[] = [sql`${expensesTable.status} != 'cancelled'`];
  if (scope !== null && scope.length > 0) conds.push(inArray(expensesTable.branchId, scope));
  if (branchId) conds.push(sql`${expensesTable.branchId} = ${parseInt(branchId, 10)}`);
  if (category) conds.push(sql`${expensesTable.category} = ${category}`);
  if (paymentMethod) conds.push(sql`${expensesTable.paymentMethod} = ${paymentMethod}`);
  if (from) conds.push(gte(expensesTable.date, from));
  if (to) conds.push(lte(expensesTable.date, to));

  const expenses = await db.select({
    exp: expensesTable,
    branchName: branchesTable.name,
    userName: usersTable.name,
  })
    .from(expensesTable)
    .leftJoin(branchesTable, eq(expensesTable.branchId, branchesTable.id))
    .leftJoin(usersTable, eq(expensesTable.createdByUserId, usersTable.id))
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(expensesTable.date));

  const rows = expenses.map(r => ({
    ...r.exp,
    branchName: r.branchName ?? "",
    createdByName: r.userName ?? null,
    amount: n(r.exp.amount),
  }));

  const validated = rows.filter(r => r.status === "validated");
  const draft = rows.filter(r => r.status === "draft");

  // By category
  const catMap: Record<string, { category: string; amount: number; count: number }> = {};
  for (const r of validated) {
    if (!catMap[r.category]) catMap[r.category] = { category: r.category, amount: 0, count: 0 };
    catMap[r.category].amount += r.amount;
    catMap[r.category].count++;
  }
  const byCategory = Object.values(catMap).sort((a, b) => b.amount - a.amount);

  // By branch
  const branchMap2: Record<string, { branchId: number; branchName: string; amount: number; count: number }> = {};
  for (const r of validated) {
    const key = String(r.branchId);
    if (!branchMap2[key]) branchMap2[key] = { branchId: r.branchId, branchName: r.branchName, amount: 0, count: 0 };
    branchMap2[key].amount += r.amount;
    branchMap2[key].count++;
  }
  const byBranch = Object.values(branchMap2).sort((a, b) => b.amount - a.amount);

  // By month
  const monthMap: Record<string, { month: string; amount: number; count: number }> = {};
  for (const r of validated) {
    const month = r.date.substring(0, 7); // "2026-01"
    if (!monthMap[month]) monthMap[month] = { month, amount: 0, count: 0 };
    monthMap[month].amount += r.amount;
    monthMap[month].count++;
  }
  const byMonth = Object.entries(monthMap).sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);

  // By payment method
  const pmMap: Record<string, { paymentMethod: string; amount: number; count: number }> = {};
  for (const r of validated) {
    if (!pmMap[r.paymentMethod]) pmMap[r.paymentMethod] = { paymentMethod: r.paymentMethod, amount: 0, count: 0 };
    pmMap[r.paymentMethod].amount += r.amount;
    pmMap[r.paymentMethod].count++;
  }
  const byPaymentMethod = Object.values(pmMap).sort((a, b) => b.amount - a.amount);

  res.json({
    totalExpenses: validated.reduce((s, r) => s + r.amount, 0),
    totalValidated: validated.length,
    totalDraft: draft.reduce((s, r) => s + r.amount, 0),
    draftCount: draft.length,
    byCategory,
    byBranch,
    byMonth,
    byPaymentMethod,
    recentExpenses: rows.slice(0, 15),
  });
});

// ─── RETURNS / AVOIRS REPORT ─────────────────────────────────────────────────

router.get("/reports/returns", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const { branchId, status, customerId, from, to } = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);

  if (scope !== null && scope.length === 0) {
    res.json(emptyReturnsReport());
    return;
  }

  // Build conditions
  const conds: any[] = [];
  if (scope !== null) conds.push(inArray(salesReturnsTable.branchId, scope));
  if (branchId) conds.push(eq(salesReturnsTable.branchId, parseInt(branchId, 10)));
  if (status) conds.push(eq(salesReturnsTable.status, status));
  if (customerId) conds.push(eq(salesReturnsTable.customerId, parseInt(customerId, 10)));
  if (from) conds.push(gte(salesReturnsTable.createdAt, new Date(from)));
  if (to) {
    const d = new Date(to); d.setHours(23, 59, 59, 999);
    conds.push(lte(salesReturnsTable.createdAt, d));
  }

  // Fetch returns with joins
  const rows = await db.select({
    ret: salesReturnsTable,
    customerName: contactsTable.displayName,
    branchName: branchesTable.name,
    saleRef: salesTable.reference,
    createdByName: usersTable.name,
  })
    .from(salesReturnsTable)
    .leftJoin(contactsTable, eq(salesReturnsTable.customerId, contactsTable.id))
    .leftJoin(branchesTable, eq(salesReturnsTable.branchId, branchesTable.id))
    .leftJoin(salesTable, eq(salesReturnsTable.saleId, salesTable.id))
    .leftJoin(usersTable, eq(salesReturnsTable.createdByUserId, usersTable.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(salesReturnsTable.createdAt));

  const returns = rows.map(r => ({
    id: r.ret.id,
    reference: r.ret.reference,
    saleId: r.ret.saleId,
    saleRef: r.saleRef ?? "",
    customerId: r.ret.customerId,
    customerName: r.customerName ?? "—",
    branchId: r.ret.branchId,
    branchName: r.branchName ?? "—",
    status: r.ret.status,
    reason: r.ret.reason ?? "",
    totalAmount: n(r.ret.totalAmount),
    refundedAmount: n(r.ret.refundedAmount),
    remainingRefund: Math.max(0, n(r.ret.totalAmount) - n(r.ret.refundedAmount)),
    notes: r.ret.notes ?? "",
    createdByName: r.createdByName ?? "—",
    createdAt: r.ret.createdAt.toISOString(),
  }));

  // Fetch return items for product breakdown
  const returnIds = returns.map(r => r.id);
  let returnItems: Array<{ productId: number; productName: string; quantity: number; total: number }> = [];
  if (returnIds.length > 0) {
    const items = await db.select().from(salesReturnItemsTable)
      .where(inArray(salesReturnItemsTable.returnId, returnIds));
    returnItems = items.map(i => ({
      productId: i.productId,
      productName: i.productName,
      quantity: n(i.quantity),
      total: n(i.total),
    }));
  }

  // Sales total for the same period (for return rate)
  const saleConds: any[] = [];
  if (scope !== null) saleConds.push(inArray(salesTable.branchId, scope));
  if (branchId) saleConds.push(eq(salesTable.branchId, parseInt(branchId, 10)));
  if (from) saleConds.push(gte(salesTable.createdAt, new Date(from)));
  if (to) {
    const d = new Date(to); d.setHours(23, 59, 59, 999);
    saleConds.push(lte(salesTable.createdAt, d));
  }
  saleConds.push(inArray(salesTable.status, ["confirmed", "active", "completed"]));
  const salesRows = await db.select({ total: salesTable.total }).from(salesTable)
    .where(saleConds.length ? and(...saleConds) : undefined);
  const totalSales = salesRows.reduce((s, r) => s + n(r.total), 0);

  // KPIs
  const confirmed = returns.filter(r => r.status !== "draft" && r.status !== "cancelled");
  const totalAmount = confirmed.reduce((s, r) => s + r.totalAmount, 0);
  const totalRefunded = confirmed.reduce((s, r) => s + r.refundedAmount, 0);
  const pendingRefund = confirmed.reduce((s, r) => s + r.remainingRefund, 0);
  const returnRate = totalSales > 0 ? (totalAmount / totalSales) * 100 : 0;
  const avgReturnAmount = confirmed.length > 0 ? totalAmount / confirmed.length : 0;

  // By status
  const statusMap: Record<string, { status: string; count: number; amount: number }> = {};
  for (const r of returns) {
    if (!statusMap[r.status]) statusMap[r.status] = { status: r.status, count: 0, amount: 0 };
    statusMap[r.status].count++;
    statusMap[r.status].amount += r.totalAmount;
  }
  const byStatus = Object.values(statusMap).sort((a, b) => b.amount - a.amount);

  // By branch
  const branchMap: Record<string, { branchId: number; branchName: string; count: number; amount: number; refunded: number }> = {};
  for (const r of confirmed) {
    const key = String(r.branchId);
    if (!branchMap[key]) branchMap[key] = { branchId: r.branchId, branchName: r.branchName, count: 0, amount: 0, refunded: 0 };
    branchMap[key].count++;
    branchMap[key].amount += r.totalAmount;
    branchMap[key].refunded += r.refundedAmount;
  }
  const byBranch = Object.values(branchMap).sort((a, b) => b.amount - a.amount);

  // By customer (top 10)
  const customerMap: Record<string, { customerId: number | null; customerName: string; count: number; amount: number }> = {};
  for (const r of confirmed) {
    const key = String(r.customerId ?? "anon");
    if (!customerMap[key]) customerMap[key] = { customerId: r.customerId, customerName: r.customerName, count: 0, amount: 0 };
    customerMap[key].count++;
    customerMap[key].amount += r.totalAmount;
  }
  const byCustomer = Object.values(customerMap).sort((a, b) => b.amount - a.amount).slice(0, 10);

  // By product (top 10)
  const productMap: Record<string, { productId: number; productName: string; quantity: number; amount: number }> = {};
  for (const item of returnItems) {
    const key = String(item.productId);
    if (!productMap[key]) productMap[key] = { productId: item.productId, productName: item.productName, quantity: 0, amount: 0 };
    productMap[key].quantity += item.quantity;
    productMap[key].amount += item.total;
  }
  const byProduct = Object.values(productMap).sort((a, b) => b.amount - a.amount).slice(0, 10);

  // By month
  const monthMap: Record<string, { month: string; count: number; amount: number; refunded: number }> = {};
  for (const r of returns) {
    const month = r.createdAt.substring(0, 7);
    if (!monthMap[month]) monthMap[month] = { month, count: 0, amount: 0, refunded: 0 };
    monthMap[month].count++;
    monthMap[month].amount += r.totalAmount;
    monthMap[month].refunded += r.refundedAmount;
  }
  const byMonth = Object.entries(monthMap).sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);

  res.json({
    totalAmount, totalRefunded, pendingRefund,
    returnCount: confirmed.length, totalCount: returns.length,
    returnRate, avgReturnAmount, totalSales,
    byStatus, byBranch, byCustomer, byProduct, byMonth,
    returns: returns.slice(0, 50),
  });
});

function emptyReturnsReport() {
  return {
    totalAmount: 0, totalRefunded: 0, pendingRefund: 0,
    returnCount: 0, totalCount: 0, returnRate: 0, avgReturnAmount: 0, totalSales: 0,
    byStatus: [], byBranch: [], byCustomer: [], byProduct: [], byMonth: [], returns: [],
  };
}

// ─── CASH SESSIONS ───────────────────────────────────────────────────────────

router.get("/reports/cash-sessions", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const scope = visibleBranchIds(req.user!);
  const conds: any[] = [];
  if (scope !== null && scope.length > 0) conds.push(inArray(posSessionsTable.branchId, scope));
  else if (scope !== null && scope.length === 0) { res.json({ totalSessions: 0, totalSales: 0, totalCash: 0, totalCard: 0, totalVariance: 0, sessions: [] }); return; }

  const sessions = await db.select().from(posSessionsTable).where(conds.length ? and(...conds) : undefined).orderBy(desc(posSessionsTable.openedAt));
  const branches = await db.select().from(branchesTable);
  const branchMap = Object.fromEntries(branches.map(b => [b.id, b.name]));
  const result = sessions.map(s => ({
    ...s, branchName: branchMap[s.branchId] ?? "", userName: "",
    openingCash: n(s.openingCash), countedCash: s.countedCash ? n(s.countedCash) : null,
    expectedCash: s.expectedCash ? n(s.expectedCash) : null, variance: s.variance ? n(s.variance) : null,
    totalSales: n(s.totalSales), totalCashSales: n(s.totalCashSales), totalCardSales: n(s.totalCardSales),
    openedAt: s.openedAt.toISOString(), closedAt: s.closedAt?.toISOString() ?? null,
  }));
  res.json({
    totalSessions: result.length,
    totalSales: result.reduce((s, r) => s + r.totalSales, 0),
    totalCash: result.reduce((s, r) => s + r.totalCashSales, 0),
    totalCard: result.reduce((s, r) => s + r.totalCardSales, 0),
    totalVariance: result.reduce((s, r) => s + (r.variance ?? 0), 0),
    sessions: result,
  });
});

export default router;
