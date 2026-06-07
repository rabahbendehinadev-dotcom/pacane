import { Router, type IRouter } from "express";
import { db, salesTable, saleItemsTable, productsTable } from "@workspace/db";
import { eq, and, sql, inArray, isNotNull } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission } from "../middlewares/permissions";
import { P } from "../lib/permissions";
import { visibleBranchIds } from "../middlewares/permissions";

const router: IRouter = Router();

function emptyResponse() {
  return { summary: { totalRevenue: 0, totalSales: 0, activeSellers: 0, avgBasket: 0 }, sellers: [], trend: [] };
}

router.get("/analytics/sellers", requireAuth, requirePermission(P.analytics.view), async (req, res): Promise<void> => {
  const user = req.user!;
  const { from, to, branchId } = req.query as Record<string, string>;

  const allowed = await visibleBranchIds(user);
  let branchFilter: number[] | null = null;

  if (branchId && branchId !== "all") {
    const bid = parseInt(branchId);
    if (allowed !== null && !allowed.includes(bid)) { res.json(emptyResponse()); return; }
    branchFilter = [bid];
  } else {
    branchFilter = allowed;
  }

  const conditions = [
    isNotNull(salesTable.sellerName),
    sql`${salesTable.sellerName} != ''`,
    sql`${salesTable.type} = 'sale'`,
    sql`${salesTable.status} = 'confirmed'`,
  ];
  if (from) conditions.push(sql`DATE(${salesTable.createdAt} AT TIME ZONE 'Africa/Algiers') >= ${from}`);
  if (to)   conditions.push(sql`DATE(${salesTable.createdAt} AT TIME ZONE 'Africa/Algiers') <= ${to}`);
  if (branchFilter !== null) {
    if (branchFilter.length === 0) { res.json(emptyResponse()); return; }
    conditions.push(inArray(salesTable.branchId, branchFilter));
  }

  const where = and(...conditions);

  // ── 1. Per-seller aggregates ─────────────────────────────────────────────
  const sellerRows = await db
    .select({
      name: salesTable.sellerName,
      revenue: sql<string>`SUM(${salesTable.total}::numeric)`,
      sales: sql<string>`COUNT(*)`,
      cash:   sql<string>`SUM(CASE WHEN ${salesTable.paymentMethod}='cash'   THEN 1 ELSE 0 END)`,
      card:   sql<string>`SUM(CASE WHEN ${salesTable.paymentMethod}='card'   THEN 1 ELSE 0 END)`,
      credit: sql<string>`SUM(CASE WHEN ${salesTable.paymentMethod}='credit' THEN 1 ELSE 0 END)`,
    })
    .from(salesTable)
    .where(where)
    .groupBy(salesTable.sellerName)
    .orderBy(sql`SUM(${salesTable.total}::numeric) DESC`);

  if (sellerRows.length === 0) { res.json(emptyResponse()); return; }

  const sellerNames = sellerRows.map(r => r.name as string);

  // ── 2. Items sold per seller ─────────────────────────────────────────────
  const itemRows = await db
    .select({
      sellerName: salesTable.sellerName,
      items: sql<string>`SUM(${saleItemsTable.quantity}::numeric)`,
    })
    .from(salesTable)
    .innerJoin(saleItemsTable, eq(saleItemsTable.saleId, salesTable.id))
    .where(where)
    .groupBy(salesTable.sellerName);

  const itemsBySeller: Record<string, number> = {};
  for (const r of itemRows) itemsBySeller[r.sellerName as string] = Number(r.items);

  // ── 3. Daily trend per seller ─────────────────────────────────────────────
  const dailyRows = await db
    .select({
      name: salesTable.sellerName,
      date: sql<string>`DATE(${salesTable.createdAt} AT TIME ZONE 'Africa/Algiers')::text`,
      revenue: sql<string>`SUM(${salesTable.total}::numeric)`,
      sales: sql<string>`COUNT(*)`,
    })
    .from(salesTable)
    .where(where)
    .groupBy(salesTable.sellerName, sql`DATE(${salesTable.createdAt} AT TIME ZONE 'Africa/Algiers')`)
    .orderBy(sql`DATE(${salesTable.createdAt} AT TIME ZONE 'Africa/Algiers') ASC`);

  // ── 4. Hourly distribution per seller ────────────────────────────────────
  const hourlyRows = await db
    .select({
      name: salesTable.sellerName,
      hour: sql<string>`EXTRACT(HOUR FROM ${salesTable.createdAt} AT TIME ZONE 'Africa/Algiers')::text`,
      sales: sql<string>`COUNT(*)`,
    })
    .from(salesTable)
    .where(where)
    .groupBy(salesTable.sellerName, sql`EXTRACT(HOUR FROM ${salesTable.createdAt} AT TIME ZONE 'Africa/Algiers')`)
    .orderBy(sql`EXTRACT(HOUR FROM ${salesTable.createdAt} AT TIME ZONE 'Africa/Algiers') ASC`);

  // ── 5. Top products per seller ───────────────────────────────────────────
  const productRows = await db
    .select({
      sellerName: salesTable.sellerName,
      productName: productsTable.name,
      qty: sql<string>`SUM(${saleItemsTable.quantity}::numeric)`,
      revenue: sql<string>`SUM(${saleItemsTable.total}::numeric)`,
    })
    .from(salesTable)
    .innerJoin(saleItemsTable, eq(saleItemsTable.saleId, salesTable.id))
    .innerJoin(productsTable, eq(productsTable.id, saleItemsTable.productId))
    .where(where)
    .groupBy(salesTable.sellerName, productsTable.name)
    .orderBy(sql`SUM(${saleItemsTable.total}::numeric) DESC`);

  // ── 6. Assemble per-seller maps ──────────────────────────────────────────
  const dailyBySeller: Record<string, Record<string, { revenue: number; sales: number }>> = {};
  for (const r of dailyRows) {
    const n = r.name as string;
    if (!dailyBySeller[n]) dailyBySeller[n] = {};
    dailyBySeller[n][r.date] = { revenue: Number(r.revenue), sales: Number(r.sales) };
  }

  const hourlyBySeller: Record<string, number[]> = {};
  for (const r of hourlyRows) {
    const n = r.name as string;
    if (!hourlyBySeller[n]) hourlyBySeller[n] = Array(24).fill(0);
    hourlyBySeller[n][Number(r.hour)] = Number(r.sales);
  }

  const topProductsBySeller: Record<string, { name: string; qty: number; revenue: number }[]> = {};
  for (const r of productRows) {
    const n = r.sellerName as string;
    if (!topProductsBySeller[n]) topProductsBySeller[n] = [];
    if (topProductsBySeller[n].length < 8) {
      topProductsBySeller[n].push({ name: r.productName as string, qty: Number(r.qty), revenue: Number(r.revenue) });
    }
  }

  // ── 7. Build sellers array ───────────────────────────────────────────────
  const sellers = sellerRows.map(r => {
    const name = r.name as string;
    const revenue = Number(r.revenue);
    const sales = Number(r.sales);
    return {
      name,
      revenue,
      sales,
      items: itemsBySeller[name] ?? 0,
      avgBasket: sales > 0 ? revenue / sales : 0,
      paymentMethods: {
        cash: Number(r.cash),
        card: Number(r.card),
        credit: Number(r.credit),
      },
      daily: dailyBySeller[name] ?? {},
      hourly: hourlyBySeller[name] ?? Array(24).fill(0),
      topProducts: topProductsBySeller[name] ?? [],
    };
  });

  // ── 8. Global multi-seller trend ─────────────────────────────────────────
  const allDates = [...new Set(dailyRows.map(r => r.date as string))].sort();
  const trend = allDates.map(date => {
    const point: Record<string, any> = { date };
    for (const name of sellerNames) {
      point[name] = dailyBySeller[name]?.[date]?.revenue ?? 0;
    }
    return point;
  });

  const totalRevenue = sellers.reduce((s, v) => s + v.revenue, 0);
  const totalSales = sellers.reduce((s, v) => s + v.sales, 0);

  res.json({
    summary: {
      totalRevenue,
      totalSales,
      activeSellers: sellers.length,
      avgBasket: totalSales > 0 ? totalRevenue / totalSales : 0,
    },
    sellers,
    trend,
  });
});

export default router;
