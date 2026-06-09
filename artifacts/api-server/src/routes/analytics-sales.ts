/**
 * Sales Analytics API — Commercial Performance
 * Gross/net revenue · Products · Customers · Sellers · Channels · Conversion
 *
 * GET /analytics/sales/kpis          — Core KPIs
 * GET /analytics/sales/trend         — Daily revenue trend
 * GET /analytics/sales/products      — Top products by revenue & qty
 * GET /analytics/sales/customers     — Top customers by revenue
 * GET /analytics/sales/sellers       — Seller/cashier performance
 * GET /analytics/sales/branches      — Branch comparison
 * GET /analytics/sales/channels      — POS vs invoice breakdown
 * GET /analytics/sales/conversion    — Quotation → Order → Sale funnel
 * GET /analytics/sales/documents     — Recent sales documents table
 */

import { Router, type IRouter } from "express";
import {
  and, eq, gte, lte, inArray, not, sql, desc, isNotNull, or, isNull,
} from "drizzle-orm";
import {
  db,
  salesTable, saleItemsTable, salePaymentsTable, salesReturnsTable,
  contactsTable, branchesTable, productsTable, categoriesTable, usersTable,
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

function parseQ(req: any) {
  const scope = visibleBranchIds(req.user!);
  return {
    scope,
    from: req.query.from as string | undefined,
    to: req.query.to as string | undefined,
    branchId: req.query.branchId as string | undefined,
    customerId: req.query.customerId as string | undefined,
    sellerId: req.query.sellerId as string | undefined,
    channel: req.query.channel as string | undefined,      // "pos" | "delivery"
    docType: req.query.docType as string | undefined,      // "sale" | "order" | "quotation"
    paymentStatus: req.query.paymentStatus as string | undefined,
  };
}

function buildBaseConds(q: ReturnType<typeof parseQ>, {
  includeType = ["sale"],
  includeStatus,
  excludeStatus,
}: { includeType?: string[]; includeStatus?: string[]; excludeStatus?: string[] } = {}) {
  const { scope, from, to, branchId, customerId, sellerId, channel, paymentStatus } = q;
  const c: any[] = [...dateConds(salesTable.createdAt, from, to)];

  // Branch scope
  if (scope !== null) {
    if (scope.length === 0) { c.push(sql`FALSE`); }
    else { c.push(inArray(salesTable.branchId, scope)); }
  }
  if (branchId) c.push(eq(salesTable.branchId, parseInt(branchId, 10)));

  // Type filter
  if (q.docType) {
    c.push(eq(salesTable.type, q.docType));
  } else if (includeType.length > 0) {
    if (includeType.length === 1) c.push(eq(salesTable.type, includeType[0]));
    else c.push(inArray(salesTable.type, includeType));
  }

  if (includeStatus) {
    if (includeStatus.length === 1) c.push(eq(salesTable.status, includeStatus[0]));
    else c.push(inArray(salesTable.status, includeStatus));
  }
  if (excludeStatus) {
    for (const s of excludeStatus) c.push(not(eq(salesTable.status, s)));
  }

  if (customerId) c.push(eq(salesTable.customerId, parseInt(customerId, 10)));
  if (sellerId) c.push(eq(salesTable.createdByUserId, parseInt(sellerId, 10)));
  if (channel) c.push(eq(salesTable.fulfillmentType, channel));
  if (paymentStatus) c.push(eq(salesTable.paymentStatus, paymentStatus));

  return c;
}

// ─── KPI helper — reusable for current & previous period ──────────────────────
async function runSaleKpis(
  scope: number[] | null,
  branchId: string | undefined,
  from: string | undefined,
  to: string | undefined,
  paymentStatus: string | undefined,
) {
  const saleConds: any[] = [
    eq(salesTable.type, "sale"),
    eq(salesTable.status, "confirmed"),
    ...dateConds(salesTable.createdAt, from, to),
  ];
  if (scope !== null) {
    if (scope.length === 0) saleConds.push(sql`FALSE`);
    else saleConds.push(inArray(salesTable.branchId, scope));
  }
  if (branchId) saleConds.push(eq(salesTable.branchId, parseInt(branchId, 10)));
  if (paymentStatus) saleConds.push(eq(salesTable.paymentStatus, paymentStatus));

  const [saleAgg] = await db.select({
    grossRevenue:       sql<string>`COALESCE(SUM(${salesTable.total}::numeric), 0)`,
    totalDiscount:      sql<string>`COALESCE(SUM(${salesTable.discount}::numeric), 0)`,
    totalPaid:          sql<string>`COALESCE(SUM(${salesTable.paid}::numeric), 0)`,
    totalCreditApplied: sql<string>`COALESCE(SUM(${salesTable.creditApplied}::numeric), 0)`,
    saleCount:          sql<string>`COUNT(*)`,
    paidCount:          sql<string>`COUNT(CASE WHEN ${salesTable.paymentStatus}='paid' THEN 1 END)`,
    unpaidCount:        sql<string>`COUNT(CASE WHEN ${salesTable.paymentStatus}='unpaid' THEN 1 END)`,
    partialCount:       sql<string>`COUNT(CASE WHEN ${salesTable.paymentStatus}='partially_paid' THEN 1 END)`,
    customerCount:      sql<string>`COUNT(DISTINCT ${salesTable.customerId})`,
  }).from(salesTable).where(saleConds.length ? and(...saleConds) : undefined);

  const grossRevenue        = parseFloat(saleAgg?.grossRevenue ?? "0");
  const totalPaid           = parseFloat(saleAgg?.totalPaid ?? "0");
  const totalCreditApplied  = parseFloat(saleAgg?.totalCreditApplied ?? "0");
  const saleCount           = parseInt(saleAgg?.saleCount ?? "0", 10);
  const avgBasket           = saleCount > 0 ? grossRevenue / saleCount : 0;
  const unpaidBalance       = grossRevenue - totalPaid - totalCreditApplied;

  // Items sold
  const [itemAgg] = await db.select({
    totalItems: sql<string>`COALESCE(SUM(${saleItemsTable.quantity}::numeric), 0)`,
  }).from(saleItemsTable)
    .innerJoin(salesTable, eq(saleItemsTable.saleId, salesTable.id))
    .where(saleConds.length ? and(...saleConds) : undefined);

  // Returns
  const returnConds: any[] = [
    inArray(salesReturnsTable.status, ["confirmed", "refunded"]),
    ...dateConds(salesReturnsTable.createdAt, from, to),
  ];
  const [retAgg] = await db.select({
    totalRefunded: sql<string>`COALESCE(SUM(${salesReturnsTable.refundedAmount}::numeric), 0)`,
    returnCount:   sql<string>`COUNT(*)`,
  }).from(salesReturnsTable)
    .where(returnConds.length ? and(...returnConds) : undefined);

  const totalRefunded = parseFloat(retAgg?.totalRefunded ?? "0");
  const netRevenue    = grossRevenue - totalRefunded;

  return {
    grossRevenue,
    netRevenue,
    totalRefunded,
    returnImpactPct: grossRevenue > 0 ? Math.round((totalRefunded / grossRevenue) * 100) : 0,
    totalDiscount: parseFloat(saleAgg?.totalDiscount ?? "0"),
    totalPaid,
    totalCreditApplied,
    unpaidBalance: Math.max(0, unpaidBalance),
    saleCount,
    avgBasket,
    totalItemsSold: parseFloat(itemAgg?.totalItems ?? "0"),
    customerCount: parseInt(saleAgg?.customerCount ?? "0", 10),
    paidCount: parseInt(saleAgg?.paidCount ?? "0", 10),
    unpaidCount: parseInt(saleAgg?.unpaidCount ?? "0", 10),
    partialCount: parseInt(saleAgg?.partialCount ?? "0", 10),
    paymentRate: grossRevenue > 0 ? Math.round(((totalPaid + totalCreditApplied) / grossRevenue) * 100) : 0,
    returnCount: parseInt(retAgg?.returnCount ?? "0", 10),
  };
}

// ─── KPIs ─────────────────────────────────────────────────────────────────────
router.get("/kpis", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const q = parseQ(req);
  const compare = req.query.compare === "true";

  // Current period
  const current = await runSaleKpis(q.scope, q.branchId, q.from, q.to, q.paymentStatus);

  // All document count (stays in the handler — not needed in comparison)
  const allDocConds = buildBaseConds(q, {
    includeType: ["sale", "order", "quotation", "draft"],
    excludeStatus: ["cancelled"],
  });
  const [docAgg] = await db.select({
    allDocs: sql<string>`COUNT(*)`,
    quotes:  sql<string>`COUNT(CASE WHEN ${salesTable.type}='quotation' THEN 1 END)`,
    orders:  sql<string>`COUNT(CASE WHEN ${salesTable.type}='order' THEN 1 END)`,
    drafts:  sql<string>`COUNT(CASE WHEN ${salesTable.type}='draft' THEN 1 END)`,
  }).from(salesTable).where(allDocConds.length ? and(...allDocConds) : undefined);

  // Previous period (same duration, shifted back by one period)
  let prev: Awaited<ReturnType<typeof runSaleKpis>> | null = null;
  if (compare && q.from && q.to) {
    const fromDate   = new Date(q.from);
    const toDate     = new Date(q.to);
    const durationMs = toDate.getTime() - fromDate.getTime() + 86_400_000; // inclusive days
    const prevToDate   = new Date(fromDate.getTime() - 86_400_000);
    const prevFromDate = new Date(prevToDate.getTime() - durationMs + 86_400_000);
    const prevFrom = prevFromDate.toISOString().slice(0, 10);
    const prevTo   = prevToDate.toISOString().slice(0, 10);
    prev = await runSaleKpis(q.scope, q.branchId, prevFrom, prevTo, q.paymentStatus);
  }

  res.json({
    ...current,
    allDocCount: parseInt(docAgg?.allDocs ?? "0", 10),
    quoteCount:  parseInt(docAgg?.quotes  ?? "0", 10),
    orderCount:  parseInt(docAgg?.orders  ?? "0", 10),
    draftCount:  parseInt(docAgg?.drafts  ?? "0", 10),
    prev,
  });
});

// ─── Trend ────────────────────────────────────────────────────────────────────
router.get("/trend", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const q = parseQ(req);
  const conds = buildBaseConds(q, { includeType: ["sale"], includeStatus: ["confirmed"] });

  const rows = await db.select({
    date: sql<string>`DATE(${salesTable.createdAt})::text`,
    revenue: sql<string>`COALESCE(SUM(${salesTable.total}::numeric), 0)`,
    salesCount: sql<string>`COUNT(*)`,
    paid: sql<string>`COALESCE(SUM(${salesTable.paid}::numeric), 0)`,
    discount: sql<string>`COALESCE(SUM(${salesTable.discount}::numeric), 0)`,
  }).from(salesTable)
    .where(conds.length ? and(...conds) : undefined)
    .groupBy(sql`DATE(${salesTable.createdAt})`)
    .orderBy(sql`DATE(${salesTable.createdAt})`);

  res.json(rows.map(r => ({
    date: r.date,
    revenue: parseFloat(r.revenue),
    salesCount: parseInt(r.salesCount, 10),
    paid: parseFloat(r.paid),
    discount: parseFloat(r.discount),
  })));
});

// ─── Top products ─────────────────────────────────────────────────────────────
router.get("/products", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const q = parseQ(req);
  const conds = buildBaseConds(q, { includeType: ["sale"], includeStatus: ["confirmed"] });

  const search = (req.query.search as string | undefined)?.toLowerCase().trim();
  const limitParam = Math.min(2000, parseInt(req.query.limit as string ?? "500", 10));

  const rows = await db.select({
    productId: saleItemsTable.productId,
    productName: productsTable.name,
    costPrice: productsTable.costPrice,
    revenue: sql<string>`COALESCE(SUM(${saleItemsTable.total}::numeric), 0)`,
    qty: sql<string>`COALESCE(SUM(${saleItemsTable.quantity}::numeric), 0)`,
    orderCount: sql<string>`COUNT(DISTINCT ${saleItemsTable.saleId})`,
    avgUnitPrice: sql<string>`COALESCE(AVG(${saleItemsTable.unitPrice}::numeric), 0)`,
    totalDiscount: sql<string>`COALESCE(SUM(${saleItemsTable.discount}::numeric), 0)`,
  }).from(saleItemsTable)
    .innerJoin(salesTable, eq(saleItemsTable.saleId, salesTable.id))
    .innerJoin(productsTable, eq(saleItemsTable.productId, productsTable.id))
    .where(conds.length ? and(...conds) : undefined)
    .groupBy(saleItemsTable.productId, productsTable.name, productsTable.costPrice)
    .orderBy(sql`SUM(${saleItemsTable.total}::numeric) DESC`)
    .limit(limitParam);

  const allMapped = rows.map(r => {
    const revenue = parseFloat(r.revenue);
    const qty = parseFloat(r.qty);
    const costPrice = parseFloat(r.costPrice as string ?? "0");
    const totalCost = qty * costPrice;
    const margin = revenue - totalCost;
    const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;
    return {
      productId: r.productId,
      productName: r.productName,
      revenue,
      qty,
      orderCount: parseInt(r.orderCount, 10),
      avgUnitPrice: parseFloat(r.avgUnitPrice),
      totalDiscount: parseFloat(r.totalDiscount),
      costPrice,
      totalCost,
      margin,
      marginPct: Math.round(marginPct * 10) / 10,
    };
  });

  const totalRevenue = allMapped.reduce((a, r) => a + r.revenue, 0);
  // ABC classification (Pareto 80/15/5): classify using cumulative BEFORE this product
  // so first product always starts in A (prevPct=0 < 80)
  let cumulative = 0;
  const result = allMapped.map(r => {
    const prevPct = totalRevenue > 0 ? (cumulative / totalRevenue) * 100 : 0;
    cumulative += r.revenue;
    const abc = prevPct < 80 ? "A" : prevPct < 95 ? "B" : "C";
    return { ...r, revenuePct: totalRevenue > 0 ? Math.round((r.revenue / totalRevenue) * 100 * 10) / 10 : 0, abc };
  });

  const filtered = search ? result.filter(r => r.productName.toLowerCase().includes(search)) : result;

  // Server-side pagination via offset (optional — frontend can also paginate client-side)
  const offsetParam = Math.max(0, parseInt(req.query.offset as string ?? "0", 10));
  const paginated = offsetParam > 0 ? filtered.slice(offsetParam) : filtered;
  res.json(paginated);
});

// ─── Top customers ────────────────────────────────────────────────────────────
router.get("/customers", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const q = parseQ(req);
  const conds = buildBaseConds(q, { includeType: ["sale"], includeStatus: ["confirmed"] });

  const rows = await db.select({
    customerId: salesTable.customerId,
    customerName: contactsTable.displayName,
    revenue: sql<string>`COALESCE(SUM(${salesTable.total}::numeric), 0)`,
    saleCount: sql<string>`COUNT(*)`,
    paid: sql<string>`COALESCE(SUM(${salesTable.paid}::numeric), 0)`,
    creditApplied: sql<string>`COALESCE(SUM(${salesTable.creditApplied}::numeric), 0)`,
    unpaid: sql<string>`COALESCE(SUM(CASE WHEN ${salesTable.paymentStatus}!='paid' THEN ${salesTable.total}::numeric - ${salesTable.paid}::numeric - ${salesTable.creditApplied}::numeric ELSE 0 END), 0)`,
  }).from(salesTable)
    .innerJoin(contactsTable, eq(salesTable.customerId, contactsTable.id))
    .where(conds.length ? and(...conds) : undefined)
    .groupBy(salesTable.customerId, contactsTable.displayName)
    .orderBy(sql`SUM(${salesTable.total}::numeric) DESC`)
    .limit(20);

  // Walk-in customers total
  const walkinConds = [...conds, isNull(salesTable.customerId)];
  const [walkin] = await db.select({
    revenue: sql<string>`COALESCE(SUM(${salesTable.total}::numeric), 0)`,
    saleCount: sql<string>`COUNT(*)`,
  }).from(salesTable).where(walkinConds.length ? and(...walkinConds) : undefined);

  const result = rows.map(r => ({
    customerId: r.customerId,
    customerName: r.customerName,
    revenue: parseFloat(r.revenue),
    saleCount: parseInt(r.saleCount, 10),
    avgBasket: parseInt(r.saleCount, 10) > 0 ? parseFloat(r.revenue) / parseInt(r.saleCount, 10) : 0,
    paid: parseFloat(r.paid),
    creditApplied: parseFloat(r.creditApplied),
    unpaid: Math.max(0, parseFloat(r.unpaid)),
  }));

  if (parseFloat(walkin?.revenue ?? "0") > 0) {
    result.push({
      customerId: null,
      customerName: "Clients anonymes (caisse)",
      revenue: parseFloat(walkin!.revenue),
      saleCount: parseInt(walkin!.saleCount, 10),
      avgBasket: parseInt(walkin!.saleCount, 10) > 0 ? parseFloat(walkin!.revenue) / parseInt(walkin!.saleCount, 10) : 0,
      paid: 0,
      creditApplied: 0,
      unpaid: 0,
    });
    result.sort((a, b) => b.revenue - a.revenue);
  }

  res.json(result);
});

// ─── Seller performance ───────────────────────────────────────────────────────
router.get("/sellers", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const q = parseQ(req);
  const conds = buildBaseConds(q, { includeType: ["sale"], includeStatus: ["confirmed"] });

  const rows = await db.select({
    userId: salesTable.createdByUserId,
    sellerName: usersTable.name,
    revenue: sql<string>`COALESCE(SUM(${salesTable.total}::numeric), 0)`,
    saleCount: sql<string>`COUNT(*)`,
    avgBasket: sql<string>`COALESCE(AVG(${salesTable.total}::numeric), 0)`,
    paidCount: sql<string>`COUNT(CASE WHEN ${salesTable.paymentStatus}='paid' THEN 1 END)`,
    totalPaid: sql<string>`COALESCE(SUM(${salesTable.paid}::numeric), 0)`,
  }).from(salesTable)
    .innerJoin(usersTable, eq(salesTable.createdByUserId, usersTable.id))
    .where(conds.length ? and(...conds) : undefined)
    .groupBy(salesTable.createdByUserId, usersTable.name)
    .orderBy(sql`SUM(${salesTable.total}::numeric) DESC`)
    .limit(20);

  const totalRevenue = rows.reduce((a, r) => a + parseFloat(r.revenue), 0);
  res.json(rows.map(r => {
    const cnt = parseInt(r.saleCount, 10);
    const rev = parseFloat(r.revenue);
    return {
      userId: r.userId,
      sellerName: r.sellerName,
      revenue: rev,
      saleCount: cnt,
      avgBasket: parseFloat(r.avgBasket),
      paidCount: parseInt(r.paidCount, 10),
      paymentRate: cnt > 0 ? Math.round((parseInt(r.paidCount, 10) / cnt) * 100) : 0,
      revenuePct: totalRevenue > 0 ? Math.round((rev / totalRevenue) * 100) : 0,
    };
  }));
});

// ─── Branch comparison ────────────────────────────────────────────────────────
router.get("/branches", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const q = parseQ(req);
  // No branchId filter here — compare all in scope
  const { scope, from, to } = q;
  const conds: any[] = [
    eq(salesTable.type, "sale"),
    eq(salesTable.status, "confirmed"),
    ...dateConds(salesTable.createdAt, from, to),
  ];
  if (scope !== null) {
    if (scope.length === 0) conds.push(sql`FALSE`);
    else conds.push(inArray(salesTable.branchId, scope));
  }

  const rows = await db.select({
    branchId: salesTable.branchId,
    branchName: branchesTable.name,
    revenue: sql<string>`COALESCE(SUM(${salesTable.total}::numeric), 0)`,
    saleCount: sql<string>`COUNT(*)`,
    paid: sql<string>`COALESCE(SUM(${salesTable.paid}::numeric), 0)`,
    avgBasket: sql<string>`COALESCE(AVG(${salesTable.total}::numeric), 0)`,
    unpaidBalance: sql<string>`COALESCE(SUM(CASE WHEN ${salesTable.paymentStatus}!='paid' THEN ${salesTable.total}::numeric - ${salesTable.paid}::numeric ELSE 0 END), 0)`,
  }).from(salesTable)
    .innerJoin(branchesTable, eq(salesTable.branchId, branchesTable.id))
    .where(conds.length ? and(...conds) : undefined)
    .groupBy(salesTable.branchId, branchesTable.name)
    .orderBy(sql`SUM(${salesTable.total}::numeric) DESC`);

  const totalRevenue = rows.reduce((a, r) => a + parseFloat(r.revenue), 0);
  res.json(rows.map(r => ({
    branchId: r.branchId,
    branchName: r.branchName,
    revenue: parseFloat(r.revenue),
    saleCount: parseInt(r.saleCount, 10),
    paid: parseFloat(r.paid),
    avgBasket: parseFloat(r.avgBasket),
    unpaidBalance: Math.max(0, parseFloat(r.unpaidBalance)),
    revenuePct: totalRevenue > 0 ? Math.round((parseFloat(r.revenue) / totalRevenue) * 100) : 0,
  })));
});

// ─── Channel breakdown (POS vs delivery/invoice) ──────────────────────────────
router.get("/channels", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const q = parseQ(req);
  const conds = buildBaseConds(q, { includeType: ["sale"], includeStatus: ["confirmed"] });

  const rows = await db.select({
    channel: salesTable.fulfillmentType,
    revenue: sql<string>`COALESCE(SUM(${salesTable.total}::numeric), 0)`,
    saleCount: sql<string>`COUNT(*)`,
    paid: sql<string>`COALESCE(SUM(${salesTable.paid}::numeric), 0)`,
  }).from(salesTable)
    .where(conds.length ? and(...conds) : undefined)
    .groupBy(salesTable.fulfillmentType)
    .orderBy(sql`SUM(${salesTable.total}::numeric) DESC`);

  const totalRevenue = rows.reduce((a, r) => a + parseFloat(r.revenue), 0);

  // Payment methods breakdown
  const pmConds = buildBaseConds(q, { includeType: ["sale"], includeStatus: ["confirmed"] });
  const pmRows = await db.select({
    method: salePaymentsTable.method,
    total: sql<string>`COALESCE(SUM(${salePaymentsTable.amount}::numeric), 0)`,
    count: sql<string>`COUNT(*)`,
  }).from(salePaymentsTable)
    .innerJoin(salesTable, eq(salePaymentsTable.saleId, salesTable.id))
    .where(pmConds.length ? and(...pmConds) : undefined)
    .groupBy(salePaymentsTable.method)
    .orderBy(sql`SUM(${salePaymentsTable.amount}::numeric) DESC`);

  const totalPayments = pmRows.reduce((a, r) => a + parseFloat(r.total), 0);

  const CHANNEL_LABELS: Record<string, string> = {
    pos: "Caisse (POS)",
    delivery: "Livraison / Facture",
    pickup: "Retrait boutique",
  };
  const METHOD_LABELS: Record<string, string> = {
    cash: "Espèces", card: "Carte", credit: "Crédit", transfer: "Virement",
    virement: "Virement", check: "Chèque", cheque: "Chèque",
  };

  res.json({
    channels: rows.map(r => ({
      channel: r.channel,
      label: CHANNEL_LABELS[r.channel] ?? r.channel,
      revenue: parseFloat(r.revenue),
      saleCount: parseInt(r.saleCount, 10),
      revenuePct: totalRevenue > 0 ? Math.round((parseFloat(r.revenue) / totalRevenue) * 100) : 0,
    })),
    paymentMethods: pmRows.map(r => ({
      method: r.method,
      label: METHOD_LABELS[r.method] ?? r.method,
      total: parseFloat(r.total),
      count: parseInt(r.count, 10),
      pct: totalPayments > 0 ? Math.round((parseFloat(r.total) / totalPayments) * 100) : 0,
    })),
  });
});

// ─── Conversion funnel (quote → order → sale) ─────────────────────────────────
router.get("/conversion", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const q = parseQ(req);
  const { scope, from, to } = q;
  const conds: any[] = dateConds(salesTable.createdAt, from, to);
  if (scope !== null) {
    if (scope.length === 0) conds.push(sql`FALSE`);
    else conds.push(inArray(salesTable.branchId, scope));
  }
  if (q.branchId) conds.push(eq(salesTable.branchId, parseInt(q.branchId, 10)));

  const [agg] = await db.select({
    quotes: sql<string>`COUNT(CASE WHEN ${salesTable.type}='quotation' THEN 1 END)`,
    quotesApproved: sql<string>`COUNT(CASE WHEN ${salesTable.type}='quotation' AND ${salesTable.status} IN ('approved','converted') THEN 1 END)`,
    quotesConverted: sql<string>`COUNT(CASE WHEN ${salesTable.type}='quotation' AND ${salesTable.status}='converted' THEN 1 END)`,
    quotesRejected: sql<string>`COUNT(CASE WHEN ${salesTable.type}='quotation' AND ${salesTable.status} IN ('rejected','expired') THEN 1 END)`,
    orders: sql<string>`COUNT(CASE WHEN ${salesTable.type}='order' THEN 1 END)`,
    ordersDelivered: sql<string>`COUNT(CASE WHEN ${salesTable.type}='order' AND ${salesTable.status} IN ('delivered','ready') THEN 1 END)`,
    ordersCancelled: sql<string>`COUNT(CASE WHEN ${salesTable.type}='order' AND ${salesTable.status}='cancelled' THEN 1 END)`,
    sales: sql<string>`COUNT(CASE WHEN ${salesTable.type}='sale' AND ${salesTable.status}='confirmed' THEN 1 END)`,
    drafts: sql<string>`COUNT(CASE WHEN ${salesTable.type}='draft' THEN 1 END)`,
    cancelled: sql<string>`COUNT(CASE WHEN ${salesTable.status}='cancelled' THEN 1 END)`,
  }).from(salesTable).where(conds.length ? and(...conds) : undefined);

  const quotes = parseInt(agg?.quotes ?? "0", 10);
  const orders = parseInt(agg?.orders ?? "0", 10);
  const sales = parseInt(agg?.sales ?? "0", 10);
  const quotesConverted = parseInt(agg?.quotesConverted ?? "0", 10);

  res.json({
    funnel: [
      { stage: "Devis créés", count: quotes, type: "quotation", color: "#94a3b8" },
      { stage: "Devis approuvés", count: parseInt(agg?.quotesApproved ?? "0", 10), type: "quotation_approved", color: "#6366f1" },
      { stage: "Commandes", count: orders, type: "order", color: "#f59e0b" },
      { stage: "Commandes livrées", count: parseInt(agg?.ordersDelivered ?? "0", 10), type: "order_delivered", color: "#10b981" },
      { stage: "Ventes confirmées", count: sales, type: "sale", color: "#10b981" },
    ],
    conversionRates: {
      quoteToOrder: quotes > 0 ? Math.round((quotesConverted / quotes) * 100) : 0,
      orderToSale: orders > 0 ? Math.round((parseInt(agg?.ordersDelivered ?? "0", 10) / orders) * 100) : 0,
    },
    summary: {
      drafts: parseInt(agg?.drafts ?? "0", 10),
      cancelled: parseInt(agg?.cancelled ?? "0", 10),
      rejected: parseInt(agg?.quotesRejected ?? "0", 10),
    },
  });
});

// ─── Recent documents table ───────────────────────────────────────────────────
router.get("/documents", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const q = parseQ(req);
  const conds = buildBaseConds(q, {
    includeType: q.docType ? [q.docType] : ["sale", "order", "quotation", "draft"],
  });
  const limit = Math.min(200, parseInt(req.query.limit as string ?? "100", 10));

  const rows = await db.select({
    id: salesTable.id,
    reference: salesTable.reference,
    type: salesTable.type,
    status: salesTable.status,
    paymentStatus: salesTable.paymentStatus,
    fulfillmentType: salesTable.fulfillmentType,
    customerName: contactsTable.displayName,
    branchName: branchesTable.name,
    sellerName: usersTable.name,
    total: salesTable.total,
    paid: salesTable.paid,
    creditApplied: salesTable.creditApplied,
    discount: salesTable.discount,
    createdAt: salesTable.createdAt,
  }).from(salesTable)
    .leftJoin(contactsTable, eq(salesTable.customerId, contactsTable.id))
    .innerJoin(branchesTable, eq(salesTable.branchId, branchesTable.id))
    .leftJoin(usersTable, eq(salesTable.createdByUserId, usersTable.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(salesTable.createdAt))
    .limit(limit);

  res.json(rows.map(r => ({
    ...r,
    total: parseFloat(r.total),
    paid: parseFloat(r.paid),
    creditApplied: parseFloat(r.creditApplied ?? "0"),
    discount: parseFloat(r.discount),
    unpaid: Math.max(0, parseFloat(r.total) - parseFloat(r.paid) - parseFloat(r.creditApplied ?? "0")),
    customerName: r.customerName ?? "Anonyme",
    sellerName: r.sellerName ?? "—",
  })));
});

// ─── Time distribution (hourly + day-of-week) ─────────────────────────────────
router.get("/time-distribution", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const q = parseQ(req);
  const conds = buildBaseConds(q, { includeType: ["sale"], includeStatus: ["confirmed"] });

  const hourRows = await db.select({
    hour: sql<number>`EXTRACT(HOUR FROM ${salesTable.createdAt} AT TIME ZONE 'Africa/Algiers')::integer`,
    revenue: sql<string>`COALESCE(SUM(${salesTable.total}::numeric), 0)`,
    saleCount: sql<string>`COUNT(*)`,
  }).from(salesTable)
    .where(conds.length ? and(...conds) : undefined)
    .groupBy(sql`EXTRACT(HOUR FROM ${salesTable.createdAt} AT TIME ZONE 'Africa/Algiers')::integer`)
    .orderBy(sql`EXTRACT(HOUR FROM ${salesTable.createdAt} AT TIME ZONE 'Africa/Algiers')::integer`);

  const dowRows = await db.select({
    dow: sql<number>`EXTRACT(DOW FROM ${salesTable.createdAt} AT TIME ZONE 'Africa/Algiers')::integer`,
    revenue: sql<string>`COALESCE(SUM(${salesTable.total}::numeric), 0)`,
    saleCount: sql<string>`COUNT(*)`,
  }).from(salesTable)
    .where(conds.length ? and(...conds) : undefined)
    .groupBy(sql`EXTRACT(DOW FROM ${salesTable.createdAt} AT TIME ZONE 'Africa/Algiers')::integer`)
    .orderBy(sql`EXTRACT(DOW FROM ${salesTable.createdAt} AT TIME ZONE 'Africa/Algiers')::integer`);

  // DOW indexed by Postgres DOW (0=Sun, 1=Mon, ..., 6=Sat)
  const DOW_LABELS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
  const DOW_SHORT  = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

  const hourMap = new Map(hourRows.map(r => [Number(r.hour), r]));
  const byHour = Array.from({ length: 24 }, (_, h) => {
    const r = hourMap.get(h);
    return { hour: h, label: `${String(h).padStart(2, "0")}h`, revenue: r ? parseFloat(r.revenue) : 0, saleCount: r ? parseInt(r.saleCount, 10) : 0 };
  });

  // Arabic week starts Saturday (6) → Friday (5): order is Sat, Sun, Mon, Tue, Wed, Thu, Fri
  const ARAB_WEEK = [6, 0, 1, 2, 3, 4, 5];
  const dowMap = new Map(dowRows.map(r => [Number(r.dow), r]));
  const byDow = ARAB_WEEK.map(d => {
    const r = dowMap.get(d);
    return { dow: d, label: DOW_LABELS[d], short: DOW_SHORT[d], revenue: r ? parseFloat(r.revenue) : 0, saleCount: r ? parseInt(r.saleCount, 10) : 0 };
  });

  res.json({ byHour, byDow });
});

// ─── Categories breakdown ─────────────────────────────────────────────────────
router.get("/categories", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const q = parseQ(req);
  const conds = buildBaseConds(q, { includeType: ["sale"], includeStatus: ["confirmed"] });

  const rows = await db.select({
    categoryId: productsTable.categoryId,
    categoryName: categoriesTable.name,
    revenue: sql<string>`COALESCE(SUM(${saleItemsTable.total}::numeric), 0)`,
    qty: sql<string>`COALESCE(SUM(${saleItemsTable.quantity}::numeric), 0)`,
    saleCount: sql<string>`COUNT(DISTINCT ${saleItemsTable.saleId})`,
    totalCost: sql<string>`COALESCE(SUM(${saleItemsTable.quantity}::numeric * ${productsTable.costPrice}::numeric), 0)`,
    productCount: sql<string>`COUNT(DISTINCT ${saleItemsTable.productId})`,
  }).from(saleItemsTable)
    .innerJoin(salesTable, eq(saleItemsTable.saleId, salesTable.id))
    .innerJoin(productsTable, eq(saleItemsTable.productId, productsTable.id))
    .leftJoin(categoriesTable, eq(productsTable.categoryId, categoriesTable.id))
    .where(conds.length ? and(...conds) : undefined)
    .groupBy(productsTable.categoryId, categoriesTable.name)
    .orderBy(sql`SUM(${saleItemsTable.total}::numeric) DESC`);

  const totalRevenue = rows.reduce((a, r) => a + parseFloat(r.revenue), 0);
  res.json(rows.map(r => {
    const revenue = parseFloat(r.revenue);
    const totalCost = parseFloat(r.totalCost);
    const margin = revenue - totalCost;
    return {
      categoryId: r.categoryId,
      categoryName: r.categoryName ?? "Sans catégorie",
      revenue,
      qty: parseFloat(r.qty),
      saleCount: parseInt(r.saleCount, 10),
      productCount: parseInt(r.productCount, 10),
      totalCost,
      margin,
      marginPct: revenue > 0 ? Math.round((margin / revenue) * 100 * 10) / 10 : 0,
      revenuePct: totalRevenue > 0 ? Math.round((revenue / totalRevenue) * 100 * 10) / 10 : 0,
    };
  }));
});

export default router;
