import { Router, type IRouter } from "express";
import { and, eq, gte, lte, inArray, not, sql, desc } from "drizzle-orm";
import {
  db,
  purchasesTable,
  purchaseItemsTable,
  contactsTable,
  branchesTable,
  productsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, visibleBranchIds } from "../middlewares/permissions";
import { P } from "../lib/permissions";

const router: IRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dateConds(col: any, from?: string, to?: string) {
  const c = [];
  if (from) c.push(gte(col, new Date(from)));
  if (to) {
    const d = new Date(to);
    d.setHours(23, 59, 59, 999);
    c.push(lte(col, d));
  }
  return c;
}

function branchCond(branchIdCol: any, scope: number[] | null, reqBranchId?: string) {
  const conds = [];
  if (scope !== null) {
    if (scope.length === 0) {
      conds.push(sql`FALSE`);
    } else {
      conds.push(inArray(branchIdCol, scope));
    }
  }
  if (reqBranchId) {
    const id = parseInt(reqBranchId, 10);
    if (!isNaN(id)) conds.push(eq(branchIdCol, id));
  }
  return conds;
}

function parseScope(req: any) {
  const scope = visibleBranchIds(req.user!);
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const branchId = req.query.branchId as string | undefined;
  const supplierId = req.query.supplierId as string | undefined;
  const status = req.query.status as string | undefined;
  const paymentStatus = req.query.paymentStatus as string | undefined;
  return { scope, from, to, branchId, supplierId, status, paymentStatus };
}

function buildBaseConds(params: ReturnType<typeof parseScope>) {
  const { scope, from, to, branchId, supplierId, status, paymentStatus } = params;
  const c = [
    ...branchCond(purchasesTable.branchId, scope, branchId),
    ...dateConds(purchasesTable.createdAt, from, to),
  ];
  if (supplierId) c.push(eq(purchasesTable.supplierId, parseInt(supplierId, 10)));
  if (status) c.push(eq(purchasesTable.status, status));
  if (paymentStatus) c.push(eq(purchasesTable.paymentStatus, paymentStatus));
  return c;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/analytics-purchases/kpis
 * Core KPIs: total volume, count, avg, supplier count, received/pending value, overdue
 */
router.get("/kpis", requireAuth, requirePermission(P.purchases.view), async (req, res): Promise<void> => {
  const params = parseScope(req);
  const conds = buildBaseConds(params);
  const activeConds = [...conds, not(eq(purchasesTable.status, "draft"))];

  const [volumeRow] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${purchasesTable.total}::numeric), 0)`,
      cnt: sql<string>`COUNT(*)`,
      paid: sql<string>`COALESCE(SUM(${purchasesTable.paid}::numeric), 0)`,
    })
    .from(purchasesTable)
    .where(activeConds.length ? and(...activeConds) : undefined);

  const totalVolume = parseFloat(volumeRow?.total ?? "0");
  const orderCount = parseInt(volumeRow?.cnt ?? "0", 10);
  const totalPaid = parseFloat(volumeRow?.paid ?? "0");
  const avgOrderValue = orderCount > 0 ? totalVolume / orderCount : 0;

  // Supplier count
  const [suppRow] = await db
    .select({ cnt: sql<string>`COUNT(DISTINCT ${purchasesTable.supplierId})` })
    .from(purchasesTable)
    .where(activeConds.length ? and(...activeConds) : undefined);
  const supplierCount = parseInt(suppRow?.cnt ?? "0", 10);

  // Received value (status = received)
  const receivedConds = [...conds, eq(purchasesTable.status, "received")];
  const [recvRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(${purchasesTable.total}::numeric), 0)` })
    .from(purchasesTable)
    .where(receivedConds.length ? and(...receivedConds) : undefined);
  const receivedValue = parseFloat(recvRow?.total ?? "0");

  // Pending value (confirmed or partial, not yet fully received)
  const pendingConds = [...conds, inArray(purchasesTable.status, ["confirmed", "partial"])];
  const [pendRow] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${purchasesTable.total}::numeric), 0)`,
      cnt: sql<string>`COUNT(*)`,
    })
    .from(purchasesTable)
    .where(pendingConds.length ? and(...pendingConds) : undefined);
  const pendingValue = parseFloat(pendRow?.total ?? "0");
  const pendingCount = parseInt(pendRow?.cnt ?? "0", 10);

  // Unpaid balance
  const unpaidConds = [...conds, not(eq(purchasesTable.paymentStatus, "paid")), inArray(purchasesTable.status, ["confirmed", "received", "partial"])];
  const [unpaidRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(${purchasesTable.total}::numeric - ${purchasesTable.paid}::numeric), 0)` })
    .from(purchasesTable)
    .where(unpaidConds.length ? and(...unpaidConds) : undefined);
  const unpaidBalance = parseFloat(unpaidRow?.total ?? "0");

  res.json({
    totalVolume,
    orderCount,
    avgOrderValue,
    supplierCount,
    receivedValue,
    pendingValue,
    pendingCount,
    unpaidBalance,
    totalPaid,
    paymentRate: totalVolume > 0 ? Math.round((totalPaid / totalVolume) * 100) : 0,
  });
});

/**
 * GET /api/analytics-purchases/trend
 * Daily trend of purchase volume + order count
 */
router.get("/trend", requireAuth, requirePermission(P.purchases.view), async (req, res): Promise<void> => {
  const params = parseScope(req);
  const conds = buildBaseConds(params);

  const rows = await db
    .select({
      date: sql<string>`DATE(${purchasesTable.createdAt})::text`,
      volume: sql<string>`COALESCE(SUM(${purchasesTable.total}::numeric), 0)`,
      orders: sql<string>`COUNT(*)`,
      received: sql<string>`COALESCE(SUM(CASE WHEN ${purchasesTable.status}='received' THEN ${purchasesTable.total}::numeric ELSE 0 END), 0)`,
    })
    .from(purchasesTable)
    .where(conds.length ? and(...conds) : undefined)
    .groupBy(sql`DATE(${purchasesTable.createdAt})`)
    .orderBy(sql`DATE(${purchasesTable.createdAt})`);

  res.json(rows.map(r => ({
    date: r.date,
    volume: parseFloat(r.volume),
    orders: parseInt(r.orders, 10),
    received: parseFloat(r.received),
  })));
});

/**
 * GET /api/analytics-purchases/suppliers
 * Top suppliers ranked by purchase amount, with pending balance, avg order value, order count
 */
router.get("/suppliers", requireAuth, requirePermission(P.purchases.view), async (req, res): Promise<void> => {
  const params = parseScope(req);
  const conds = buildBaseConds(params);

  const rows = await db
    .select({
      supplierId: purchasesTable.supplierId,
      supplierName: contactsTable.displayName,
      volume: sql<string>`COALESCE(SUM(${purchasesTable.total}::numeric), 0)`,
      orderCount: sql<string>`COUNT(*)`,
      paidTotal: sql<string>`COALESCE(SUM(${purchasesTable.paid}::numeric), 0)`,
      pendingBalance: sql<string>`COALESCE(SUM(CASE WHEN ${purchasesTable.paymentStatus}!='paid' THEN ${purchasesTable.total}::numeric - ${purchasesTable.paid}::numeric ELSE 0 END), 0)`,
      receivedOrders: sql<string>`COUNT(CASE WHEN ${purchasesTable.status}='received' THEN 1 END)`,
    })
    .from(purchasesTable)
    .innerJoin(contactsTable, eq(purchasesTable.supplierId, contactsTable.id))
    .where(conds.length ? and(...conds) : undefined)
    .groupBy(purchasesTable.supplierId, contactsTable.displayName)
    .orderBy(sql`SUM(${purchasesTable.total}::numeric) DESC`)
    .limit(20);

  const mapped = rows.map(r => {
    const vol = parseFloat(r.volume);
    const cnt = parseInt(r.orderCount, 10);
    const recv = parseInt(r.receivedOrders ?? "0", 10);
    return {
      supplierId: r.supplierId,
      supplierName: r.supplierName,
      volume: vol,
      orderCount: cnt,
      avgOrderValue: cnt > 0 ? vol / cnt : 0,
      paidTotal: parseFloat(r.paidTotal),
      pendingBalance: parseFloat(r.pendingBalance),
      deliveryRate: cnt > 0 ? Math.round((recv / cnt) * 100) : 0,
    };
  });

  res.json(mapped);
});

/**
 * GET /api/analytics-purchases/reception
 * Ordered vs received vs pending quantities, by purchase order
 */
router.get("/reception", requireAuth, requirePermission(P.purchases.view), async (req, res): Promise<void> => {
  const params = parseScope(req);
  const conds = buildBaseConds(params);
  const activeConds = [...conds, not(eq(purchasesTable.status, "draft"))];

  // Aggregated item-level stats per purchase
  const rows = await db
    .select({
      purchaseId: purchasesTable.id,
      reference: purchasesTable.reference,
      supplierName: contactsTable.displayName,
      branchName: branchesTable.name,
      status: purchasesTable.status,
      paymentStatus: purchasesTable.paymentStatus,
      total: purchasesTable.total,
      createdAt: purchasesTable.createdAt,
      orderedQty: sql<string>`COALESCE(SUM(${purchaseItemsTable.quantity}::numeric), 0)`,
      receivedQty: sql<string>`COALESCE(SUM(${purchaseItemsTable.receivedQuantity}::numeric), 0)`,
      rejectedQty: sql<string>`COALESCE(SUM(${purchaseItemsTable.rejectedQuantity}::numeric), 0)`,
    })
    .from(purchasesTable)
    .innerJoin(contactsTable, eq(purchasesTable.supplierId, contactsTable.id))
    .innerJoin(branchesTable, eq(purchasesTable.branchId, branchesTable.id))
    .leftJoin(purchaseItemsTable, eq(purchaseItemsTable.purchaseId, purchasesTable.id))
    .where(activeConds.length ? and(...activeConds) : undefined)
    .groupBy(
      purchasesTable.id, purchasesTable.reference, contactsTable.displayName,
      branchesTable.name, purchasesTable.status, purchasesTable.paymentStatus,
      purchasesTable.total, purchasesTable.createdAt,
    )
    .orderBy(desc(purchasesTable.createdAt))
    .limit(100);

  // Reception completion summary
  const total = rows.length;
  let fullyReceived = 0, partiallyReceived = 0, notReceived = 0;
  const mapped = rows.map(r => {
    const ordered = parseFloat(r.orderedQty);
    const received = parseFloat(r.receivedQty);
    const rejected = parseFloat(r.rejectedQty);
    const remaining = Math.max(0, ordered - received - rejected);
    const pct = ordered > 0 ? Math.round((received / ordered) * 100) : 0;
    const completionStatus = pct >= 100 ? "complete" : pct > 0 ? "partial" : "pending";
    if (completionStatus === "complete") fullyReceived++;
    else if (completionStatus === "partial") partiallyReceived++;
    else notReceived++;
    return {
      purchaseId: r.purchaseId,
      reference: r.reference,
      supplierName: r.supplierName,
      branchName: r.branchName,
      status: r.status,
      paymentStatus: r.paymentStatus,
      total: parseFloat(r.total),
      orderedQty: ordered,
      receivedQty: received,
      rejectedQty: rejected,
      remainingQty: remaining,
      receptionPct: pct,
      completionStatus,
      createdAt: r.createdAt,
    };
  });

  // Also produce summary bucket data for chart
  const summary = [
    { label: "Réceptionné", count: fullyReceived, color: "#10b981" },
    { label: "Partiel", count: partiallyReceived, color: "#f59e0b" },
    { label: "En attente", count: notReceived, color: "#ef4444" },
  ];

  res.json({ orders: mapped, summary, total });
});

/**
 * GET /api/analytics-purchases/branches
 * Procurement by branch: volume, order count, pending, paid
 */
router.get("/branches", requireAuth, requirePermission(P.purchases.view), async (req, res): Promise<void> => {
  const params = parseScope(req);
  const conds = buildBaseConds({ ...params, branchId: undefined }); // never filter by branchId here

  const rows = await db
    .select({
      branchId: purchasesTable.branchId,
      branchName: branchesTable.name,
      volume: sql<string>`COALESCE(SUM(${purchasesTable.total}::numeric), 0)`,
      orderCount: sql<string>`COUNT(*)`,
      paid: sql<string>`COALESCE(SUM(${purchasesTable.paid}::numeric), 0)`,
      pendingBalance: sql<string>`COALESCE(SUM(CASE WHEN ${purchasesTable.paymentStatus}!='paid' THEN ${purchasesTable.total}::numeric - ${purchasesTable.paid}::numeric ELSE 0 END), 0)`,
      receivedOrders: sql<string>`COUNT(CASE WHEN ${purchasesTable.status}='received' THEN 1 END)`,
      pendingReception: sql<string>`COUNT(CASE WHEN ${purchasesTable.status} IN ('confirmed','partial') THEN 1 END)`,
    })
    .from(purchasesTable)
    .innerJoin(branchesTable, eq(purchasesTable.branchId, branchesTable.id))
    .where(conds.length ? and(...conds) : undefined)
    .groupBy(purchasesTable.branchId, branchesTable.name)
    .orderBy(sql`SUM(${purchasesTable.total}::numeric) DESC`);

  res.json(rows.map(r => ({
    branchId: r.branchId,
    branchName: r.branchName,
    volume: parseFloat(r.volume),
    orderCount: parseInt(r.orderCount, 10),
    paid: parseFloat(r.paid),
    pendingBalance: parseFloat(r.pendingBalance),
    receivedOrders: parseInt(r.receivedOrders ?? "0", 10),
    pendingReception: parseInt(r.pendingReception ?? "0", 10),
  })));
});

/**
 * GET /api/analytics-purchases/orders
 * Recent purchase orders table with full detail
 */
router.get("/orders", requireAuth, requirePermission(P.purchases.view), async (req, res): Promise<void> => {
  const params = parseScope(req);
  const conds = buildBaseConds(params);
  const limit = Math.min(200, parseInt(req.query.limit as string ?? "50", 10));

  const rows = await db
    .select({
      id: purchasesTable.id,
      reference: purchasesTable.reference,
      supplierName: contactsTable.displayName,
      supplierId: purchasesTable.supplierId,
      branchName: branchesTable.name,
      branchId: purchasesTable.branchId,
      status: purchasesTable.status,
      paymentStatus: purchasesTable.paymentStatus,
      total: purchasesTable.total,
      paid: purchasesTable.paid,
      notes: purchasesTable.notes,
      createdAt: purchasesTable.createdAt,
    })
    .from(purchasesTable)
    .innerJoin(contactsTable, eq(purchasesTable.supplierId, contactsTable.id))
    .innerJoin(branchesTable, eq(purchasesTable.branchId, branchesTable.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(purchasesTable.createdAt))
    .limit(limit);

  res.json(rows.map(r => ({
    ...r,
    total: parseFloat(r.total),
    paid: parseFloat(r.paid),
    unpaid: Math.max(0, parseFloat(r.total) - parseFloat(r.paid)),
  })));
});

/**
 * GET /api/analytics-purchases/products
 * Top purchased products by total cost
 */
router.get("/products", requireAuth, requirePermission(P.purchases.view), async (req, res): Promise<void> => {
  const params = parseScope(req);
  const conds = buildBaseConds(params);

  const rows = await db
    .select({
      productId: purchaseItemsTable.productId,
      productName: productsTable.name,
      totalCost: sql<string>`COALESCE(SUM(${purchaseItemsTable.total}::numeric), 0)`,
      totalQty: sql<string>`COALESCE(SUM(${purchaseItemsTable.quantity}::numeric), 0)`,
      receivedQty: sql<string>`COALESCE(SUM(${purchaseItemsTable.receivedQuantity}::numeric), 0)`,
      orderCount: sql<string>`COUNT(DISTINCT ${purchaseItemsTable.purchaseId})`,
      avgUnitCost: sql<string>`COALESCE(AVG(${purchaseItemsTable.unitCost}::numeric), 0)`,
    })
    .from(purchaseItemsTable)
    .innerJoin(purchasesTable, eq(purchaseItemsTable.purchaseId, purchasesTable.id))
    .innerJoin(productsTable, eq(purchaseItemsTable.productId, productsTable.id))
    .where(conds.length ? and(...conds) : undefined)
    .groupBy(purchaseItemsTable.productId, productsTable.name)
    .orderBy(sql`SUM(${purchaseItemsTable.total}::numeric) DESC`)
    .limit(20);

  res.json(rows.map(r => ({
    productId: r.productId,
    productName: r.productName,
    totalCost: parseFloat(r.totalCost),
    totalQty: parseFloat(r.totalQty),
    receivedQty: parseFloat(r.receivedQty),
    orderCount: parseInt(r.orderCount, 10),
    avgUnitCost: parseFloat(r.avgUnitCost),
    receptionRate: parseFloat(r.totalQty) > 0
      ? Math.round((parseFloat(r.receivedQty) / parseFloat(r.totalQty)) * 100)
      : 0,
  })));
});

export default router;
