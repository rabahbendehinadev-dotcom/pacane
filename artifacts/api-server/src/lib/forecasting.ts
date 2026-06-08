/**
 * Phase 3 — Intelligent Forecasting & Decision Engine
 *
 * All functions are READ-ONLY. No DB mutations except alert persistence.
 * All results are in-memory cached per day (or 15 min for risk/suggestions).
 */

import { db, productsTable, stockLevelsTable, stockMovementsTable, salesTable, saleItemsTable, productionOrdersTable, recipesTable, recipeIngredientsTable, branchesTable, purchaseItemsTable, recipeItemsTable } from "@workspace/db";
import { eq, and, gte, lte, lt, desc, sql, inArray, gt, ne } from "drizzle-orm";

// ─── Cache ────────────────────────────────────────────────────────────────────

const cache = new Map<string, { data: unknown; ts: number }>();
function cacheGet<T>(key: string, ttlMs: number): T | null {
  const e = cache.get(key);
  return e && Date.now() - e.ts < ttlMs ? (e.data as T) : null;
}
function cachePut(key: string, data: unknown) { cache.set(key, { data, ts: Date.now() }); }
export function invalidateForecastCache() { cache.clear(); }

const TTL_DAILY = 6 * 60 * 60 * 1000;   // 6 h
const TTL_SHORT = 15 * 60 * 1000;        // 15 min

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DemandForecast {
  productId: number;
  productName: string;
  branchId: number | null;
  avgDailyDemand: number;
  weeklyDemand: number;
  confidenceScore: number;          // 0–100
  trend: "up" | "down" | "stable";
  trendPct: number;
  dayOfWeekPattern: Record<number, number>; // 0=Sun … 6=Sat
  dataPoints: number;
  fallback: boolean;
}

export interface StockRisk {
  productId: number;
  productName: string;
  branchId: number;
  branchName: string;
  currentStock: number;
  avgDailyDemand: number;
  coverageDays: number;
  riskLevel: "safe" | "medium" | "high" | "critical";
  reorderQty: number;
  depletionDate: string | null;     // ISO date
  leadTimeDays: number;
  safetyStock: number;
  reorderPoint: number;
}

export interface PurchaseSuggestion {
  productId: number;
  productName: string;
  category: string;
  currentStock: number;
  requiredQty: number;
  suggestedQty: number;
  urgency: "critical" | "high" | "medium" | "low";
  estimatedCost: number;
  lastPurchasePrice: number;
  unit: string;
  reason: string;
}

export interface ConsumptionAnalysis {
  branchId: number;
  branchName: string;
  topProducts: Array<{
    productId: number; productName: string;
    totalQty: number; avgDaily: number;
    trend: "up" | "down" | "stable"; trendPct: number;
    revenueContribution: number;
  }>;
  dailyAvgRevenue: number;
  totalOrdersAnalyzed: number;
  anomalies: Array<{ productId: number; productName: string; message: string; severity: "low" | "medium" | "high" }>;
}

export interface WasteAlert {
  productId: number;
  productName: string;
  recipeId: number;
  recipeName: string;
  wastePercentage: number;
  producedQty: number;
  soldQty: number;
  unsoldQty: number;
  severity: "low" | "medium" | "high";
  potentialLoss: number;
}

export interface IntelligenceAlert {
  id: string;
  type: "STOCK_OUT_IMMINENT" | "OVERPRODUCTION_RISK" | "PURCHASE_REQUIRED" | "UNUSUAL_CONSUMPTION_SPIKE" | "HIGH_WASTE";
  severity: "low" | "medium" | "high";
  title: string;
  message: string;
  productId?: number;
  productName?: string;
  branchId?: number;
  branchName?: string;
  recommendedAction: string;
  data?: Record<string, unknown>;
}

export interface IntelligenceDashboard {
  generatedAt: string;
  predictedSalesToday: number;
  predictedSalesWeek: number;
  alerts: IntelligenceAlert[];
  stockRisks: StockRisk[];
  purchaseSuggestions: PurchaseSuggestion[];
  wasteAlerts: WasteAlert[];
  topForecasts: DemandForecast[];
  branchSummaries: Array<{ branchId: number; branchName: string; riskCount: number; suggestionsCount: number; estimatedPurchaseCost: number }>;
}

// ─── Helper: date window ──────────────────────────────────────────────────────

function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(0, 0, 0, 0); return d; }
function r2(n: number) { return Math.round(n * 100) / 100; }
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

// ─── A. Demand Forecast Engine ─────────────────────────────────────────────────

export async function forecastProductDemand(
  productId: number,
  branchId: number | null,
  periodDays = 30
): Promise<DemandForecast> {
  const cacheKey = `forecast:${productId}:${branchId ?? "all"}:${periodDays}`;
  const cached = cacheGet<DemandForecast>(cacheKey, TTL_DAILY);
  if (cached) return cached;

  const [product] = await db.select({ name: productsTable.name }).from(productsTable).where(eq(productsTable.id, productId));
  const productName = product?.name ?? `Product #${productId}`;

  // Pull sale items over last N days
  const since = daysAgo(periodDays);
  const conditions: ReturnType<typeof eq>[] = [
    eq(saleItemsTable.productId, productId),
    gte(salesTable.createdAt, since),
  ];
  if (branchId) conditions.push(eq(salesTable.branchId, branchId));

  const rows = await db
    .select({
      date: salesTable.createdAt,
      qty: saleItemsTable.quantity,
      branchId: salesTable.branchId,
    })
    .from(saleItemsTable)
    .innerJoin(salesTable, and(eq(saleItemsTable.saleId, salesTable.id), eq(salesTable.status, "confirmed")))
    .where(and(...conditions))
    .orderBy(salesTable.createdAt);

  if (rows.length === 0) {
    // Fallback: use global category average or default
    const result: DemandForecast = {
      productId, productName, branchId, avgDailyDemand: 0, weeklyDemand: 0,
      confidenceScore: 0, trend: "stable", trendPct: 0, dayOfWeekPattern: {},
      dataPoints: 0, fallback: true,
    };
    cachePut(cacheKey, result);
    return result;
  }

  // Aggregate by day
  const byDay = new Map<string, { qty: number; dow: number }>();
  for (const row of rows) {
    const d = new Date(row.date as Date);
    const key = d.toISOString().slice(0, 10);
    const qty = parseFloat(row.qty as string);
    if (!byDay.has(key)) byDay.set(key, { qty: 0, dow: d.getDay() });
    byDay.get(key)!.qty += qty;
  }

  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const n = days.length;

  // Weighted moving average — recent weeks get more weight
  const weights: number[] = days.map((_, i) => Math.exp(i / n));
  const totalW = weights.reduce((s, w) => s + w, 0);
  const avgDailyDemand = r2(days.reduce((s, [, v], i) => s + v.qty * (weights[i] / totalW), 0));

  // Trend: compare last 1/3 vs first 1/3
  const third = Math.max(1, Math.floor(n / 3));
  const firstAvg = days.slice(0, third).reduce((s, [, v]) => s + v.qty, 0) / third;
  const lastAvg = days.slice(-third).reduce((s, [, v]) => s + v.qty, 0) / third;
  const trendPct = firstAvg > 0 ? r2(((lastAvg - firstAvg) / firstAvg) * 100) : 0;
  const trend = trendPct > 10 ? "up" : trendPct < -10 ? "down" : "stable";

  // Day-of-week pattern
  const dowTotals: Record<number, { qty: number; count: number }> = {};
  for (const [, { qty, dow }] of days) {
    if (!dowTotals[dow]) dowTotals[dow] = { qty: 0, count: 0 };
    dowTotals[dow].qty += qty;
    dowTotals[dow].count++;
  }
  const dayOfWeekPattern: Record<number, number> = {};
  for (const [dow, { qty, count }] of Object.entries(dowTotals)) {
    dayOfWeekPattern[parseInt(dow)] = r2(qty / count);
  }

  // Confidence score: based on data density and recency
  const expectedDays = Math.min(periodDays, 30);
  const dataDensity = Math.min(100, (n / expectedDays) * 100);
  const confidenceScore = Math.round(dataDensity * 0.7 + (trendPct < 50 ? 30 : 10));

  const result: DemandForecast = {
    productId, productName, branchId, avgDailyDemand,
    weeklyDemand: r2(avgDailyDemand * 7),
    confidenceScore: Math.min(100, confidenceScore),
    trend, trendPct, dayOfWeekPattern,
    dataPoints: n, fallback: false,
  };
  cachePut(cacheKey, result);
  return result;
}

// ─── B. Stock Risk Engine ─────────────────────────────────────────────────────

const DEFAULT_LEAD_TIME_DAYS = 3;
const DEFAULT_SAFETY_STOCK_DAYS = 2;

export async function calculateStockRisk(
  productId: number,
  branchId: number
): Promise<StockRisk> {
  const cacheKey = `risk:${productId}:${branchId}`;
  const cached = cacheGet<StockRisk>(cacheKey, TTL_SHORT);
  if (cached) return cached;

  const [product] = await db.select({ name: productsTable.name }).from(productsTable).where(eq(productsTable.id, productId));
  const [branch] = await db.select({ name: branchesTable.name }).from(branchesTable).where(eq(branchesTable.id, branchId));

  const [stockRow] = await db.select({ qty: stockLevelsTable.quantity })
    .from(stockLevelsTable)
    .where(and(eq(stockLevelsTable.productId, productId), eq(stockLevelsTable.branchId, branchId)));
  const currentStock = parseFloat(stockRow?.qty as string ?? "0");

  const forecast = await forecastProductDemand(productId, branchId, 30);
  const avgDailyDemand = forecast.avgDailyDemand;

  const coverageDays = avgDailyDemand > 0 ? r2(currentStock / avgDailyDemand) : 999;
  const riskLevel: StockRisk["riskLevel"] = coverageDays < 1 ? "critical" : coverageDays < 2 ? "high" : coverageDays <= 5 ? "medium" : "safe";

  const safetyStock = r2(avgDailyDemand * DEFAULT_SAFETY_STOCK_DAYS);
  const reorderPoint = r2(avgDailyDemand * DEFAULT_LEAD_TIME_DAYS + safetyStock);
  const reorderQty = r2(Math.max(0, reorderPoint - currentStock + avgDailyDemand * 7));

  const depletionDate = avgDailyDemand > 0 && currentStock > 0
    ? addDays(new Date(), Math.floor(coverageDays)).toISOString().slice(0, 10)
    : null;

  const result: StockRisk = {
    productId, productName: product?.name ?? `Product #${productId}`,
    branchId, branchName: branch?.name ?? `Branch #${branchId}`,
    currentStock, avgDailyDemand, coverageDays,
    riskLevel, reorderQty, depletionDate,
    leadTimeDays: DEFAULT_LEAD_TIME_DAYS, safetyStock, reorderPoint,
  };
  cachePut(cacheKey, result);
  return result;
}

// ─── C. Purchase Suggestion Engine ───────────────────────────────────────────

export async function generatePurchaseSuggestions(branchId: number): Promise<PurchaseSuggestion[]> {
  const cacheKey = `purchase-suggestions:${branchId}`;
  const cached = cacheGet<PurchaseSuggestion[]>(cacheKey, TTL_SHORT);
  if (cached) return cached;

  // All purchasable products (raw materials)
  const products = await db.select().from(productsTable).where(eq(productsTable.isPurchasable, true));
  const suggestions: PurchaseSuggestion[] = [];

  for (const p of products) {
    const risk = await calculateStockRisk(p.id, branchId);
    if (risk.riskLevel === "safe") continue;

    // Last purchase price
    const [lastPurchase] = await db.select({ unitCost: purchaseItemsTable.unitCost })
      .from(purchaseItemsTable)
      .where(eq(purchaseItemsTable.productId, p.id))
      .orderBy(desc(purchaseItemsTable.createdAt))
      .limit(1);
    const price = parseFloat(lastPurchase?.unitCost as string ?? p.costPrice as string ?? "0");

    const urgency: PurchaseSuggestion["urgency"] = risk.riskLevel === "critical" ? "critical" : risk.riskLevel === "high" ? "high" : risk.coverageDays < 4 ? "medium" : "low";
    const suggestedQty = r2(Math.max(risk.reorderQty, risk.avgDailyDemand * 14));

    suggestions.push({
      productId: p.id,
      productName: p.name,
      category: (p as any).categoryName ?? "",
      currentStock: risk.currentStock,
      requiredQty: risk.reorderQty,
      suggestedQty,
      urgency,
      estimatedCost: r2(suggestedQty * price),
      lastPurchasePrice: price,
      unit: "",
      reason: `Couverture: ${risk.coverageDays.toFixed(1)} jours (seuil: ${risk.riskLevel === "critical" ? "<1" : risk.riskLevel === "high" ? "<2" : "≤5"} jours)`,
    });
  }

  suggestions.sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    return order[a.urgency] - order[b.urgency];
  });

  cachePut(cacheKey, suggestions);
  return suggestions;
}

// ─── D. Branch Consumption Analytics ─────────────────────────────────────────

export async function analyzeBranchConsumption(branchId: number): Promise<ConsumptionAnalysis> {
  const cacheKey = `consumption:${branchId}`;
  const cached = cacheGet<ConsumptionAnalysis>(cacheKey, TTL_DAILY);
  if (cached) return cached;

  const [branch] = await db.select({ name: branchesTable.name }).from(branchesTable).where(eq(branchesTable.id, branchId));
  const since = daysAgo(30);

  // Top products by qty sold
  const rows = await db
    .select({
      productId: saleItemsTable.productId,
      productName: productsTable.name,
      sellingPrice: productsTable.sellingPrice,
      totalQty: sql<string>`SUM(${saleItemsTable.quantity}::numeric)`,
      totalRevenue: sql<string>`SUM(${saleItemsTable.total}::numeric)`,
    })
    .from(saleItemsTable)
    .innerJoin(salesTable, and(eq(saleItemsTable.saleId, salesTable.id), eq(salesTable.status, "confirmed"), eq(salesTable.branchId, branchId), gte(salesTable.createdAt, since)))
    .innerJoin(productsTable, eq(saleItemsTable.productId, productsTable.id))
    .groupBy(saleItemsTable.productId, productsTable.name, productsTable.sellingPrice)
    .orderBy(sql`SUM(${saleItemsTable.quantity}::numeric) DESC`)
    .limit(20);

  const totalRevenue30d = rows.reduce((s, r) => s + parseFloat(r.totalRevenue), 0);
  const activeDays = 30;

  const topProducts = await Promise.all(rows.map(async r => {
    const totalQty = parseFloat(r.totalQty);
    const forecast = await forecastProductDemand(r.productId, branchId, 30);
    return {
      productId: r.productId,
      productName: r.productName,
      totalQty: r2(totalQty),
      avgDaily: r2(totalQty / activeDays),
      trend: forecast.trend,
      trendPct: forecast.trendPct,
      revenueContribution: r2((parseFloat(r.totalRevenue) / totalRevenue30d) * 100),
    };
  }));

  // Anomaly detection: products with qty > avg + 2*stddev in last 7 days
  const since7 = daysAgo(7);
  const recentRows = await db
    .select({
      productId: saleItemsTable.productId,
      productName: productsTable.name,
      recentQty: sql<string>`SUM(${saleItemsTable.quantity}::numeric)`,
    })
    .from(saleItemsTable)
    .innerJoin(salesTable, and(eq(saleItemsTable.saleId, salesTable.id), eq(salesTable.status, "confirmed"), eq(salesTable.branchId, branchId), gte(salesTable.createdAt, since7)))
    .innerJoin(productsTable, eq(saleItemsTable.productId, productsTable.id))
    .groupBy(saleItemsTable.productId, productsTable.name)
    .orderBy(sql`SUM(${saleItemsTable.quantity}::numeric) DESC`);

  const anomalies: ConsumptionAnalysis["anomalies"] = [];
  for (const r of recentRows) {
    const recentDaily = parseFloat(r.recentQty) / 7;
    const baseline = topProducts.find(p => p.productId === r.productId);
    if (!baseline) continue;
    if (baseline.avgDaily > 0 && recentDaily > baseline.avgDaily * 2.5) {
      anomalies.push({
        productId: r.productId,
        productName: r.productName,
        message: `Consommation x${(recentDaily / baseline.avgDaily).toFixed(1)} au-dessus de la normale cette semaine`,
        severity: recentDaily > baseline.avgDaily * 4 ? "high" : "medium",
      });
    } else if (baseline.avgDaily > 0 && recentDaily < baseline.avgDaily * 0.2) {
      anomalies.push({
        productId: r.productId,
        productName: r.productName,
        message: `Consommation inhabituellemnt basse (−${(100 - (recentDaily / baseline.avgDaily * 100)).toFixed(0)}%)`,
        severity: "low",
      });
    }
  }

  const result: ConsumptionAnalysis = {
    branchId, branchName: branch?.name ?? `Branch #${branchId}`,
    topProducts,
    dailyAvgRevenue: r2(totalRevenue30d / activeDays),
    totalOrdersAnalyzed: rows.length,
    anomalies,
  };
  cachePut(cacheKey, result);
  return result;
}

// ─── E. Waste / Overproduction Detection ─────────────────────────────────────

export async function detectWasteAndOverproduction(): Promise<WasteAlert[]> {
  const cacheKey = "waste-detection";
  const cached = cacheGet<WasteAlert[]>(cacheKey, TTL_DAILY);
  if (cached) return cached;

  const since = daysAgo(30);
  let completedOrders: Array<{
    id: number; recipeId: number; productId: number | null;
    branchId: number; actualQty: unknown; actualCost: unknown; wastePercentage: unknown;
  }>;
  try {
    completedOrders = await db
      .select({
        id: productionOrdersTable.id,
        recipeId: productionOrdersTable.recipeId,
        productId: productionOrdersTable.productId,
        branchId: productionOrdersTable.branchId,
        actualQty: productionOrdersTable.actualQuantity,
        actualCost: productionOrdersTable.actualCost,
        wastePercentage: productionOrdersTable.wastePercentage,
      })
      .from(productionOrdersTable)
      .where(and(eq(productionOrdersTable.status, "completed"), gte(productionOrdersTable.completedAt, since)));
  } catch {
    return [];
  }

  const alerts: WasteAlert[] = [];

  for (const order of completedOrders) {
    if (!order.productId || !order.actualQty) continue;
    const producedQty = parseFloat(order.actualQty as string);
    if (producedQty <= 0) continue;

    // Sales of this product from this branch in same period
    const [salesRow] = await db
      .select({ totalSold: sql<string>`COALESCE(SUM(${saleItemsTable.quantity}::numeric),0)` })
      .from(saleItemsTable)
      .innerJoin(salesTable, and(eq(saleItemsTable.saleId, salesTable.id), eq(salesTable.branchId, order.branchId), eq(salesTable.status, "confirmed"), gte(salesTable.createdAt, since)))
      .where(eq(saleItemsTable.productId, order.productId!));

    const soldQty = parseFloat(salesRow?.totalSold ?? "0");
    const unsoldQty = Math.max(0, r2(producedQty - soldQty));
    const wastePercentage = producedQty > 0 ? r2((unsoldQty / producedQty) * 100) : 0;

    if (wastePercentage < 15) continue;

    const [recipe] = await db.select({ name: recipesTable.name }).from(recipesTable).where(eq(recipesTable.id, order.recipeId));
    const [product] = await db.select({ name: productsTable.name, sellingPrice: productsTable.sellingPrice }).from(productsTable).where(eq(productsTable.id, order.productId!));
    const sp = parseFloat(product?.sellingPrice as string ?? "0");
    const potentialLoss = r2(unsoldQty * sp);

    alerts.push({
      productId: order.productId,
      productName: product?.name ?? `Product #${order.productId}`,
      recipeId: order.recipeId,
      recipeName: recipe?.name ?? `Recette #${order.recipeId}`,
      wastePercentage,
      producedQty,
      soldQty,
      unsoldQty,
      severity: wastePercentage > 50 ? "high" : wastePercentage > 30 ? "medium" : "low",
      potentialLoss,
    });
  }

  alerts.sort((a, b) => b.wastePercentage - a.wastePercentage);
  cachePut(cacheKey, alerts);
  return alerts;
}

// ─── F. Alert Generator ───────────────────────────────────────────────────────

export async function generateIntelligenceAlerts(branchIds: number[]): Promise<IntelligenceAlert[]> {
  const alerts: IntelligenceAlert[] = [];
  const seen = new Set<string>();

  // Stock-out and purchase alerts
  for (const branchId of branchIds) {
    const [branch] = await db.select({ name: branchesTable.name }).from(branchesTable).where(eq(branchesTable.id, branchId));
    const branchName = branch?.name ?? `Branch #${branchId}`;

    // All sellable products with stock
    const stockRows = await db.select({ productId: stockLevelsTable.productId, qty: stockLevelsTable.quantity })
      .from(stockLevelsTable)
      .where(eq(stockLevelsTable.branchId, branchId));

    for (const row of stockRows) {
      const risk = await calculateStockRisk(row.productId, branchId);
      if (risk.riskLevel === "safe") continue;

      const key = `stock:${row.productId}:${branchId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (risk.riskLevel === "critical" || risk.riskLevel === "high") {
        alerts.push({
          id: key,
          type: "STOCK_OUT_IMMINENT",
          severity: risk.riskLevel === "critical" ? "high" : "medium",
          title: `Rupture imminente — ${risk.productName}`,
          message: `Couverture: ${risk.coverageDays.toFixed(1)} jours à ${branchName}`,
          productId: row.productId,
          productName: risk.productName,
          branchId,
          branchName,
          recommendedAction: `Commander ${risk.reorderQty.toFixed(0)} unités immédiatement`,
          data: { coverageDays: risk.coverageDays, currentStock: risk.currentStock },
        });
      }

      if (risk.currentStock < risk.reorderPoint) {
        const purchaseKey = `purchase:${row.productId}:${branchId}`;
        if (!seen.has(purchaseKey)) {
          seen.add(purchaseKey);
          alerts.push({
            id: purchaseKey,
            type: "PURCHASE_REQUIRED",
            severity: risk.riskLevel === "critical" ? "high" : "medium",
            title: `Réapprovisionner — ${risk.productName}`,
            message: `Stock (${risk.currentStock.toFixed(1)}) < point de réapprovisionnement (${risk.reorderPoint.toFixed(1)})`,
            productId: row.productId,
            productName: risk.productName,
            branchId,
            branchName,
            recommendedAction: `Passer commande de ${risk.reorderQty.toFixed(0)} unités`,
            data: { reorderPoint: risk.reorderPoint, suggestedQty: risk.reorderQty },
          });
        }
      }
    }

    // Consumption spike anomalies
    const consumption = await analyzeBranchConsumption(branchId);
    for (const anomaly of consumption.anomalies.filter(a => a.severity === "high")) {
      const key = `spike:${anomaly.productId}:${branchId}`;
      if (!seen.has(key)) {
        seen.add(key);
        alerts.push({
          id: key,
          type: "UNUSUAL_CONSUMPTION_SPIKE",
          severity: "medium",
          title: `Pic de consommation — ${anomaly.productName}`,
          message: anomaly.message,
          productId: anomaly.productId,
          productName: anomaly.productName,
          branchId,
          branchName,
          recommendedAction: "Vérifier les stocks et augmenter la production",
        });
      }
    }
  }

  // Waste alerts (global)
  const wasteAlerts = await detectWasteAndOverproduction();
  for (const wa of wasteAlerts.filter(a => a.severity !== "low")) {
    const key = `waste:${wa.productId}:${wa.recipeId}`;
    if (!seen.has(key)) {
      seen.add(key);
      alerts.push({
        id: key,
        type: wa.wastePercentage > 50 ? "OVERPRODUCTION_RISK" : "HIGH_WASTE",
        severity: wa.severity,
        title: `Gaspillage élevé — ${wa.productName}`,
        message: `${wa.wastePercentage.toFixed(1)}% non vendu (${wa.unsoldQty.toFixed(1)} unités)`,
        productId: wa.productId,
        productName: wa.productName,
        recommendedAction: "Réduire les quantités de production ou améliorer la commercialisation",
        data: { wastePercentage: wa.wastePercentage, potentialLoss: wa.potentialLoss },
      });
    }
  }

  // Sort: high first
  alerts.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.severity] - order[b.severity];
  });

  return alerts;
}

// ─── G. Intelligence Dashboard (master) ───────────────────────────────────────

export async function buildIntelligenceDashboard(branchIds: number[]): Promise<IntelligenceDashboard> {
  const cacheKey = `intel-dashboard:${branchIds.sort().join(",")}`;
  const cached = cacheGet<IntelligenceDashboard>(cacheKey, TTL_SHORT);
  if (cached) return cached;

  // Predicted sales today (sum of daily forecasts for all sellable products)
  const sellableProducts = await db.select({ id: productsTable.id })
    .from(productsTable)
    .where(sql`${productsTable.sellingPrice}::numeric > 0`);

  let predictedSalesToday = 0;
  let predictedSalesWeek = 0;
  const topForecasts: DemandForecast[] = [];

  // Build forecasts for top 20 products only (perf)
  const topSellers = await db
    .select({ productId: saleItemsTable.productId, total: sql<string>`SUM(${saleItemsTable.quantity}::numeric)` })
    .from(saleItemsTable)
    .innerJoin(salesTable, and(eq(saleItemsTable.saleId, salesTable.id), gte(salesTable.createdAt, daysAgo(30))))
    .groupBy(saleItemsTable.productId)
    .orderBy(sql`SUM(${saleItemsTable.quantity}::numeric) DESC`)
    .limit(20);

  for (const { productId } of topSellers) {
    const forecast = await forecastProductDemand(productId, null, 30);
    predictedSalesToday += forecast.avgDailyDemand;
    predictedSalesWeek += forecast.weeklyDemand;
    if (!forecast.fallback) topForecasts.push(forecast);
  }

  // Parallel: risks, suggestions, waste
  const [allRisks, wasteAlerts, alerts] = await Promise.all([
    Promise.all(branchIds.flatMap(bid =>
      sellableProducts.map(({ id }) => calculateStockRisk(id, bid))
    )).then(rs => rs.filter(r => r.riskLevel !== "safe")),
    detectWasteAndOverproduction(),
    generateIntelligenceAlerts(branchIds),
  ]);

  const purchaseSuggestions = (await Promise.all(branchIds.map(bid => generatePurchaseSuggestions(bid)))).flat();

  const branchSummaries = branchIds.map(branchId => {
    const risks = allRisks.filter(r => r.branchId === branchId);
    const sugg = purchaseSuggestions.filter((s: any) => {
      const risk = allRisks.find(r => r.productId === s.productId && r.branchId === branchId);
      return !!risk;
    });
    return {
      branchId,
      branchName: allRisks.find(r => r.branchId === branchId)?.branchName ?? `Branch #${branchId}`,
      riskCount: risks.length,
      suggestionsCount: sugg.length,
      estimatedPurchaseCost: r2(sugg.reduce((s, sg) => s + sg.estimatedCost, 0)),
    };
  });

  const result: IntelligenceDashboard = {
    generatedAt: new Date().toISOString(),
    predictedSalesToday: r2(predictedSalesToday),
    predictedSalesWeek: r2(predictedSalesWeek),
    alerts,
    stockRisks: allRisks,
    purchaseSuggestions,
    wasteAlerts,
    topForecasts,
    branchSummaries,
  };

  cachePut(cacheKey, result);
  return result;
}
