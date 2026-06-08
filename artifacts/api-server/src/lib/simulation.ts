/**
 * Phase 4 — AI Decision + Simulation + Optimization Engine
 * Read-only. No mutations. All recommendations require user confirmation.
 */

import {
  db, productsTable, stockLevelsTable, stockMovementsTable,
  salesTable, saleItemsTable, productionOrdersTable, recipesTable,
  recipeIngredientsTable, recipeItemsTable, branchesTable, purchaseItemsTable, unitsTable,
} from "@workspace/db";
import { eq, and, gte, lte, sql, desc, inArray, or } from "drizzle-orm";
import { forecastProductDemand, calculateStockRisk } from "./forecasting";
import { calculateRecipeCostBreakdown, getWeightedAverageCost } from "./costing";
import { calculateRecipeExplosion } from "./bom";

// ─── Cache ────────────────────────────────────────────────────────────────────

const simCache = new Map<string, { data: unknown; ts: number }>();
function cGet<T>(k: string, ttl: number): T | null {
  const e = simCache.get(k);
  return e && Date.now() - e.ts < ttl ? (e.data as T) : null;
}
function cPut(k: string, d: unknown) { simCache.set(k, { data: d, ts: Date.now() }); }
export function invalidateSimCache() { simCache.clear(); }

const TTL = 10 * 60 * 1000;  // 10 min

function r2(n: number) { return Math.round(n * 100) / 100; }
function r0(n: number) { return Math.round(n); }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(0, 0, 0, 0); return d; }
function addDays(d: Date, n: number): Date { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function isoDate(d: Date) { return d.toISOString().slice(0, 10); }

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ScenarioParams {
  branchId?: number | null;
  daysAhead?: number;          // default 14
  demandMultiplier?: number;   // default 1.0
  productionCapacityFactor?: number; // 0-2, default 1.0
  stockBuffer?: number;        // safety days, default 2
}

export interface ScenarioDay {
  date: string;
  openingStock: number;
  forecastDemand: number;
  plannedProduction: number;
  closingStock: number;
  shortage: number;
  overstock: number;
}

export interface ScenarioProduct {
  productId: number;
  productName: string;
  recipeId?: number;
  daysTimeline: ScenarioDay[];
  totalShortage: number;
  totalOverstock: number;
  totalWasteRisk: number;
  extraProductionNeeded: number;
  extraPurchasingNeeded: number;
  status: "critical" | "at_risk" | "stable" | "overstocked";
  financialImpact: number;
}

export interface SimulationResult {
  params: ScenarioParams;
  generatedAt: string;
  products: ScenarioProduct[];
  summary: {
    totalShortageUnits: number;
    totalOverstockUnits: number;
    estimatedRevenueLoss: number;
    estimatedWasteCost: number;
    criticalCount: number;
    atRiskCount: number;
    stableCount: number;
    overstockedCount: number;
    recommendations: string[];
  };
}

export interface ProductionPlanItem {
  recipeId: number;
  recipeName: string;
  productId: number;
  productName: string;
  date: string;
  requiredQty: number;
  estimatedCost: number;
  priority: "urgent" | "normal" | "optional";
  reason: string;
  ingredientAvailability: "ok" | "partial" | "blocked";
  bottleneck?: string;
}

export interface ProductionPlan {
  branchId: number;
  branchName: string;
  dateFrom: string;
  dateTo: string;
  items: ProductionPlanItem[];
  totalEstimatedCost: number;
  bottlenecks: Array<{ ingredient: string; shortage: number; affectedRecipes: string[] }>;
  workerloadByDay: Record<string, number>;
  efficiency: number; // 0-100
}

export interface TransferSuggestion {
  productId: number;
  productName: string;
  fromBranchId: number;
  fromBranchName: string;
  toBranchId: number;
  toBranchName: string;
  quantity: number;
  unit: string;
  urgency: "critical" | "high" | "medium";
  overstockAtSource: number;
  shortageAtDest: number;
  riskReductionScore: number;
}

export interface StockDistributionPlan {
  generatedAt: string;
  transfers: TransferSuggestion[];
  totalTransfers: number;
  riskReductionPct: number;
  estimatedRevenueSaved: number;
  branches: Array<{ branchId: number; branchName: string; beforeScore: number; afterScore: number; status: string }>;
}

export interface OptimizedPurchaseLine {
  productId: number;
  productName: string;
  currentStock: number;
  forecastConsumption7d: number;
  forecastConsumption14d: number;
  suggestedQty: number;
  bulkQty: number;     // rounded to nearest pallet/case
  lastPrice: number;
  estimatedCost: number;
  urgency: "critical" | "high" | "medium" | "low";
  orderBy: string;     // latest date to order
  reason: string;
}

export interface OptimizedPurchasePlan {
  generatedAt: string;
  lines: OptimizedPurchaseLine[];
  totalCost: number;
  urgentCost: number;
  groupedByUrgency: Record<string, OptimizedPurchaseLine[]>;
}

export interface CostAlert {
  productId: number;
  productName: string;
  currentWac: number;
  previousWac: number;
  changePct: number;
  affectedRecipes: Array<{ recipeId: number; recipeName: string; costImpact: number }>;
  severity: "low" | "medium" | "high";
  recommendation: string;
}

export interface CostOptimizationReport {
  generatedAt: string;
  totalSavingsPotential: number;
  alerts: CostAlert[];
  expensiveRecipes: Array<{
    recipeId: number; recipeName: string;
    totalCost: number; costPerUnit: number; sellingPrice: number; margin: number;
    topIngredients: Array<{ name: string; costShare: number }>;
    recommendation: string;
  }>;
  globalRecommendations: string[];
}

export interface AiDecision {
  id: string;
  priority: number;      // 1 = highest
  type: "produce" | "purchase" | "transfer" | "reformulate" | "alert";
  title: string;
  description: string;
  estimatedImpact: string;
  financialImpact: number;
  urgency: "critical" | "high" | "medium" | "low";
  actionable: boolean;
  params?: Record<string, unknown>;
}

export interface AiControlCenter {
  generatedAt: string;
  scenario14d: SimulationResult;
  productionPlan: ProductionPlan[];
  distributionPlan: StockDistributionPlan;
  purchasePlan: OptimizedPurchasePlan;
  costReport: CostOptimizationReport;
  decisions: AiDecision[];
  overallHealthScore: number;  // 0-100
  riskMatrix: Array<{ branchId: number; branchName: string; shortageRisk: number; overstockRisk: number; status: string }>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// A. WHAT-IF SIMULATION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

export async function simulateScenario(params: ScenarioParams = {}): Promise<SimulationResult> {
  const {
    branchId = null,
    daysAhead = 14,
    demandMultiplier = 1.0,
    productionCapacityFactor = 1.0,
    stockBuffer = 2,
  } = params;

  const cKey = `sim:${branchId}:${daysAhead}:${demandMultiplier}:${productionCapacityFactor}`;
  const cached = cGet<SimulationResult>(cKey, TTL);
  if (cached) return cached;

  // Get all relevant products
  const branchConditions = branchId
    ? [eq(stockLevelsTable.branchId, branchId)]
    : [];
  const stockRows = branchConditions.length
    ? await db.select().from(stockLevelsTable).where(and(...branchConditions))
    : await db.select().from(stockLevelsTable);

  // Deduplicate products
  const productIds = [...new Set(stockRows.map(r => r.productId))];
  if (productIds.length === 0) {
    const empty: SimulationResult = {
      params, generatedAt: new Date().toISOString(),
      products: [],
      summary: { totalShortageUnits: 0, totalOverstockUnits: 0, estimatedRevenueLoss: 0, estimatedWasteCost: 0, criticalCount: 0, atRiskCount: 0, stableCount: 0, overstockedCount: 0, recommendations: ["Aucun stock trouvé"] },
    };
    return empty;
  }

  const products = await db.select().from(productsTable).where(inArray(productsTable.id, productIds.slice(0, 50)));
  const results: ScenarioProduct[] = [];

  for (const p of products) {
    const sp = parseFloat(p.sellingPrice as string ?? "0");
    const costPrice = parseFloat(p.costPrice as string ?? "0");

    // Get current stock (sum across branches or specific branch)
    const stockRows2 = branchId
      ? await db.select({ qty: stockLevelsTable.quantity }).from(stockLevelsTable).where(and(eq(stockLevelsTable.productId, p.id), eq(stockLevelsTable.branchId, branchId)))
      : await db.select({ qty: stockLevelsTable.quantity }).from(stockLevelsTable).where(eq(stockLevelsTable.productId, p.id));
    const currentStock = stockRows2.reduce((s, r) => s + parseFloat(r.qty as string), 0);

    const forecast = await forecastProductDemand(p.id, branchId, 30);
    const baseDailyDemand = forecast.avgDailyDemand * demandMultiplier;

    if (baseDailyDemand <= 0 && currentStock <= 0) continue;

    const timeline: ScenarioDay[] = [];
    let stock = currentStock;
    let totalShortage = 0;
    let totalOverstock = 0;

    // Find recipe for this product
    const [recipe] = await db.select({ id: recipesTable.id, yield: recipesTable.yield })
      .from(recipesTable).where(eq(recipesTable.productId, p.id)).limit(1);

    const today = new Date();
    for (let day = 0; day < daysAhead; day++) {
      const date = addDays(today, day);
      const dow = date.getDay();
      const dowFactor = forecast.dayOfWeekPattern[dow]
        ? (forecast.dayOfWeekPattern[dow] / Math.max(0.001, forecast.avgDailyDemand))
        : 1.0;
      const demand = r2(baseDailyDemand * Math.min(2, Math.max(0.1, dowFactor)));

      // Production: if recipe exists, simulate that production matches demand deficit
      const targetStock = r2(demand * (stockBuffer + 1));
      const productionNeeded = Math.max(0, targetStock - stock);
      const plannedProd = recipe
        ? r2(Math.ceil(productionNeeded / parseFloat(recipe.yield as string)) * parseFloat(recipe.yield as string) * productionCapacityFactor)
        : 0;

      const openingStock = r2(stock);
      const closingStock = r2(Math.max(0, openingStock + plannedProd - demand));
      const shortage = r2(Math.max(0, demand - (openingStock + plannedProd)));
      const overstock = closingStock > demand * 5 ? r2(closingStock - demand * 3) : 0;

      totalShortage = r2(totalShortage + shortage);
      totalOverstock = r2(totalOverstock + overstock);

      timeline.push({ date: isoDate(date), openingStock, forecastDemand: demand, plannedProduction: plannedProd, closingStock, shortage, overstock });
      stock = closingStock;
    }

    const extraProductionNeeded = recipe ? r2(Math.max(0, totalShortage / parseFloat(recipe.yield as string)) * parseFloat(recipe.yield as string)) : 0;
    const extraPurchasingNeeded = !recipe ? totalShortage : 0;
    const financialImpact = r2(totalShortage * sp - totalOverstock * costPrice * 0.3);
    const status: ScenarioProduct["status"] =
      totalShortage > baseDailyDemand * 3 ? "critical" :
      totalShortage > 0 ? "at_risk" :
      totalOverstock > baseDailyDemand * 7 ? "overstocked" : "stable";

    results.push({
      productId: p.id, productName: p.name, recipeId: recipe?.id,
      daysTimeline: timeline, totalShortage, totalOverstock,
      totalWasteRisk: totalOverstock, extraProductionNeeded, extraPurchasingNeeded,
      status, financialImpact,
    });
  }

  const criticalCount = results.filter(r => r.status === "critical").length;
  const atRiskCount = results.filter(r => r.status === "at_risk").length;
  const stableCount = results.filter(r => r.status === "stable").length;
  const overstockedCount = results.filter(r => r.status === "overstocked").length;
  const totalShortageUnits = r2(results.reduce((s, r) => s + r.totalShortage, 0));
  const totalOverstockUnits = r2(results.reduce((s, r) => s + r.totalOverstock, 0));
  const estimatedRevenueLoss = r2(results.reduce((s, r) => s + Math.max(0, r.financialImpact), 0));
  const estimatedWasteCost = r2(results.reduce((s, r) => s + r.totalWasteRisk * 50, 0));

  const recommendations: string[] = [];
  if (criticalCount > 0) recommendations.push(`${criticalCount} produit(s) en rupture critique — augmenter production immédiatement`);
  if (overstockedCount > 2) recommendations.push(`${overstockedCount} produits en surstock — réduire les lots de production`);
  if (demandMultiplier > 1.2) recommendations.push(`Demande simulée +${((demandMultiplier - 1) * 100).toFixed(0)}% — prévoir achats supplémentaires`);
  if (totalShortageUnits > 0) recommendations.push(`Déficit total: ${totalShortageUnits.toFixed(0)} unités sur ${daysAhead} jours`);

  const result: SimulationResult = {
    params, generatedAt: new Date().toISOString(),
    products: results.sort((a, b) => (b.totalShortage - a.totalShortage)),
    summary: { totalShortageUnits, totalOverstockUnits, estimatedRevenueLoss, estimatedWasteCost, criticalCount, atRiskCount, stableCount, overstockedCount, recommendations },
  };
  cPut(cKey, result);
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// B. PRODUCTION OPTIMIZER
// ═══════════════════════════════════════════════════════════════════════════════

export async function optimizeProductionPlan(branchId: number, daysAhead = 7): Promise<ProductionPlan> {
  const cKey = `prod-plan:${branchId}:${daysAhead}`;
  const cached = cGet<ProductionPlan>(cKey, TTL);
  if (cached) return cached;

  const [branch] = await db.select({ name: branchesTable.name }).from(branchesTable).where(eq(branchesTable.id, branchId));
  const fabricatedProducts = await db.select().from(productsTable).where(eq(productsTable.isFabricated, true));

  const items: ProductionPlanItem[] = [];
  const bottleneckMap = new Map<string, { shortage: number; recipes: string[] }>();
  const workerloadByDay: Record<string, number> = {};
  const today = new Date();

  for (let day = 0; day < daysAhead; day++) {
    const date = addDays(today, day);
    const dateStr = isoDate(date);
    workerloadByDay[dateStr] = 0;

    for (const p of fabricatedProducts) {
      const forecast = await forecastProductDemand(p.id, branchId, 30);
      const dow = date.getDay();
      const dowFactor = forecast.dayOfWeekPattern[dow]
        ? (forecast.dayOfWeekPattern[dow] / Math.max(0.001, forecast.avgDailyDemand))
        : 1.0;
      const dailyDemand = r2(forecast.avgDailyDemand * Math.min(2, Math.max(0.3, dowFactor)));
      if (dailyDemand <= 0) continue;

      const [recipe] = await db.select().from(recipesTable).where(eq(recipesTable.productId, p.id)).limit(1);
      if (!recipe) continue;

      // Stock at start of day (approx)
      const [stockRow] = await db.select({ qty: stockLevelsTable.quantity })
        .from(stockLevelsTable).where(and(eq(stockLevelsTable.productId, p.id), eq(stockLevelsTable.branchId, branchId)));
      const currentStock = parseFloat(stockRow?.qty as string ?? "0") - (day * dailyDemand);
      const stockNeeded = Math.max(0, dailyDemand * 2 - Math.max(0, currentStock));
      if (stockNeeded <= 0) continue;

      const batchSize = parseFloat(recipe.yield as string) || 1;
      const batchesNeeded = Math.ceil(stockNeeded / batchSize);
      const requiredQty = r2(batchesNeeded * batchSize);

      // Cost estimation
      let estimatedCost = 0;
      let availability: ProductionPlanItem["ingredientAvailability"] = "ok";
      let bottleneck: string | undefined;

      try {
        const costBreakdown = await calculateRecipeCostBreakdown(recipe.id, requiredQty);
        estimatedCost = costBreakdown.totalCost;

        // Check ingredient availability
        const explosion = await calculateRecipeExplosion(recipe.id, requiredQty);
        for (const mat of explosion.materials) {
          const [stockMat] = await db.select({ qty: stockLevelsTable.quantity })
            .from(stockLevelsTable).where(and(eq(stockLevelsTable.productId, mat.productId), eq(stockLevelsTable.branchId, branchId)));
          const avail = parseFloat(stockMat?.qty as string ?? "0");
          if (avail < mat.quantity * 0.5) {
            availability = "blocked";
            bottleneck = mat.productName;
            const key = mat.productName;
            const existing = bottleneckMap.get(key) ?? { shortage: 0, recipes: [] };
            existing.shortage = r2(existing.shortage + (mat.quantity - avail));
            if (!existing.recipes.includes(recipe.name)) existing.recipes.push(recipe.name);
            bottleneckMap.set(key, existing);
          } else if (avail < mat.quantity) {
            if (availability !== "blocked") availability = "partial";
          }
        }
      } catch { estimatedCost = parseFloat(p.costPrice as string ?? "0") * requiredQty; }

      const priority: ProductionPlanItem["priority"] =
        currentStock <= 0 ? "urgent" : currentStock < dailyDemand ? "normal" : "optional";

      items.push({
        recipeId: recipe.id, recipeName: recipe.name,
        productId: p.id, productName: p.name,
        date: dateStr, requiredQty, estimatedCost, priority,
        reason: `Demande prévue: ${dailyDemand.toFixed(1)} u/jour · Stock actuel: ${Math.max(0, currentStock).toFixed(1)}`,
        ingredientAvailability: availability, bottleneck,
      });

      workerloadByDay[dateStr] = (workerloadByDay[dateStr] || 0) + Math.ceil(requiredQty / 50);
    }
  }

  const bottlenecks = [...bottleneckMap.entries()].map(([ingredient, { shortage, affectedRecipes }]) => ({ ingredient, shortage, affectedRecipes }));
  const totalCost = r2(items.reduce((s, i) => s + i.estimatedCost, 0));
  const blockedItems = items.filter(i => i.ingredientAvailability === "blocked").length;
  const efficiency = items.length > 0 ? Math.round(((items.length - blockedItems) / items.length) * 100) : 100;

  const result: ProductionPlan = {
    branchId, branchName: branch?.name ?? `Branch #${branchId}`,
    dateFrom: isoDate(today), dateTo: isoDate(addDays(today, daysAhead)),
    items: items.sort((a, b) => {
      const p = { urgent: 0, normal: 1, optional: 2 };
      return p[a.priority] - p[b.priority] || a.date.localeCompare(b.date);
    }),
    totalEstimatedCost: totalCost, bottlenecks, workerloadByDay, efficiency,
  };
  cPut(cKey, result);
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// C. MULTI-BRANCH STOCK DISTRIBUTION OPTIMIZER
// ═══════════════════════════════════════════════════════════════════════════════

export async function optimizeStockDistribution(): Promise<StockDistributionPlan> {
  const cKey = "stock-dist";
  const cached = cGet<StockDistributionPlan>(cKey, TTL);
  if (cached) return cached;

  const branches = await db.select().from(branchesTable);
  const transfers: TransferSuggestion[] = [];

  interface BranchStockSnapshot {
    branchId: number;
    branchName: string;
    stocks: Map<number, { qty: number; productName: string; dailyDemand: number; sellingPrice: number; unit: string }>;
  }

  // Build snapshot for each branch
  const snapshots: BranchStockSnapshot[] = await Promise.all(
    branches.map(async b => {
      const rows = await db.select({
        productId: stockLevelsTable.productId, qty: stockLevelsTable.quantity,
      }).from(stockLevelsTable).where(eq(stockLevelsTable.branchId, b.id));

      const stocks = new Map<number, { qty: number; productName: string; dailyDemand: number; sellingPrice: number; unit: string }>();
      for (const row of rows) {
        const [p] = await db.select({ name: productsTable.name, sellingPrice: productsTable.sellingPrice })
          .from(productsTable).where(eq(productsTable.id, row.productId));
        const forecast = await forecastProductDemand(row.productId, b.id, 14);
        stocks.set(row.productId, {
          qty: parseFloat(row.qty as string),
          productName: p?.name ?? `Product #${row.productId}`,
          dailyDemand: forecast.avgDailyDemand,
          sellingPrice: parseFloat(p?.sellingPrice as string ?? "0"),
          unit: "",
        });
      }
      return { branchId: b.id, branchName: b.name, stocks };
    })
  );

  // Risk scoring before transfers
  const beforeScores = snapshots.map(s => {
    let score = 100;
    for (const [, v] of s.stocks) {
      if (v.dailyDemand > 0) {
        const coverage = v.qty / v.dailyDemand;
        if (coverage < 1) score -= 20;
        else if (coverage < 2) score -= 10;
        else if (coverage > 10) score -= 5;
      }
    }
    return { branchId: s.branchId, branchName: s.branchName, score: Math.max(0, score) };
  });

  // Find surplus/deficit pairs
  for (const sourceBranch of snapshots) {
    for (const [productId, sourceData] of sourceBranch.stocks) {
      if (sourceData.dailyDemand <= 0) continue;
      const sourceCoverage = sourceData.qty / sourceData.dailyDemand;
      if (sourceCoverage < 5) continue; // not enough surplus

      // Find branches with shortage
      for (const destBranch of snapshots) {
        if (destBranch.branchId === sourceBranch.branchId) continue;
        const destData = destBranch.stocks.get(productId);
        if (!destData || destData.dailyDemand <= 0) continue;
        const destCoverage = destData.qty / destData.dailyDemand;
        if (destCoverage >= 3) continue; // destination doesn't need it

        const excessAtSource = r2((sourceCoverage - 3) * sourceData.dailyDemand);
        const deficitAtDest = r2((3 - destCoverage) * destData.dailyDemand);
        const transferQty = r2(Math.min(excessAtSource, deficitAtDest));
        if (transferQty < 1) continue;

        const urgency: TransferSuggestion["urgency"] =
          destCoverage < 1 ? "critical" : destCoverage < 2 ? "high" : "medium";
        const riskReductionScore = Math.round((destCoverage < 1 ? 30 : destCoverage < 2 ? 20 : 10) + (sourceCoverage > 10 ? 10 : 5));

        transfers.push({
          productId, productName: sourceData.productName,
          fromBranchId: sourceBranch.branchId, fromBranchName: sourceBranch.branchName,
          toBranchId: destBranch.branchId, toBranchName: destBranch.branchName,
          quantity: transferQty, unit: sourceData.unit,
          urgency, overstockAtSource: excessAtSource,
          shortageAtDest: deficitAtDest, riskReductionScore,
        });
      }
    }
  }

  // Risk scoring after (simulated)
  const branchesResult = beforeScores.map(b => {
    const transfersHelping = transfers.filter(t => t.toBranchId === b.branchId).length;
    const afterScore = Math.min(100, b.score + transfersHelping * 8);
    return {
      branchId: b.branchId, branchName: b.branchName,
      beforeScore: b.score, afterScore,
      status: afterScore >= 80 ? "sûr" : afterScore >= 60 ? "acceptable" : "à risque",
    };
  });

  const avgBefore = r2(beforeScores.reduce((s, b) => s + b.score, 0) / Math.max(1, beforeScores.length));
  const avgAfter = r2(branchesResult.reduce((s, b) => s + b.afterScore, 0) / Math.max(1, branchesResult.length));
  const riskReductionPct = r2(((avgAfter - avgBefore) / Math.max(1, avgBefore)) * 100);

  const estimatedRevenueSaved = r2(
    transfers.filter(t => t.urgency === "critical" || t.urgency === "high")
      .reduce((s, t) => {
        const snap = snapshots.find(sn => sn.branchId === t.fromBranchId);
        const data = snap?.stocks.get(t.productId);
        return s + (data?.sellingPrice ?? 0) * t.quantity;
      }, 0)
  );

  const result: StockDistributionPlan = {
    generatedAt: new Date().toISOString(),
    transfers: transfers.sort((a, b) => {
      const u = { critical: 0, high: 1, medium: 2 };
      return u[a.urgency] - u[b.urgency];
    }).slice(0, 30),
    totalTransfers: transfers.length, riskReductionPct, estimatedRevenueSaved, branches: branchesResult,
  };
  cPut(cKey, result);
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// D. OPTIMIZED PURCHASE PLAN
// ═══════════════════════════════════════════════════════════════════════════════

export async function generateOptimizedPurchasePlan(): Promise<OptimizedPurchasePlan> {
  const cKey = "opt-purchase";
  const cached = cGet<OptimizedPurchasePlan>(cKey, TTL);
  if (cached) return cached;

  const purchasableProducts = await db.select().from(productsTable).where(eq(productsTable.isPurchasable, true));
  const lines: OptimizedPurchaseLine[] = [];

  const LEAD_TIME = 3;
  const today = new Date();

  for (const p of purchasableProducts) {
    const forecast7d = await forecastProductDemand(p.id, null, 7);
    const forecast14d = await forecastProductDemand(p.id, null, 14);
    if (forecast7d.avgDailyDemand <= 0 && forecast14d.avgDailyDemand <= 0) continue;

    // Total current stock across all branches
    const [stockRow] = await db.select({ total: sql<string>`COALESCE(SUM(quantity::numeric), 0)` })
      .from(stockLevelsTable).where(eq(stockLevelsTable.productId, p.id));
    const currentStock = parseFloat(stockRow?.total ?? "0");

    const daily7 = forecast7d.avgDailyDemand;
    const daily14 = forecast14d.avgDailyDemand;
    const consumption7d = r2(daily7 * 7);
    const consumption14d = r2(daily14 * 14);

    const safetyStock = r2(daily14 * 3);
    const reorderPoint = r2(daily14 * LEAD_TIME + safetyStock);
    if (currentStock > reorderPoint * 1.5) continue;

    const rawQty = r2(Math.max(0, consumption14d + safetyStock - currentStock));
    if (rawQty <= 0) continue;

    // Round to sensible bulk units (multiples of 5 or 10)
    const bulkUnit = rawQty >= 100 ? 50 : rawQty >= 20 ? 10 : rawQty >= 5 ? 5 : 1;
    const bulkQty = r2(Math.ceil(rawQty / bulkUnit) * bulkUnit);

    const [lastPurchase] = await db.select({ unitCost: purchaseItemsTable.unitCost })
      .from(purchaseItemsTable).where(eq(purchaseItemsTable.productId, p.id))
      .orderBy(desc(purchaseItemsTable.createdAt)).limit(1);
    const lastPrice = parseFloat(lastPurchase?.unitCost as string ?? p.costPrice as string ?? "0");

    const coverageDays = daily14 > 0 ? currentStock / daily14 : 999;
    const urgency: OptimizedPurchaseLine["urgency"] =
      coverageDays < 2 ? "critical" : coverageDays < 4 ? "high" : coverageDays < 7 ? "medium" : "low";

    const orderBy = isoDate(addDays(today, Math.max(0, Math.floor(coverageDays) - LEAD_TIME - 1)));

    lines.push({
      productId: p.id, productName: p.name,
      currentStock, forecastConsumption7d: consumption7d, forecastConsumption14d: consumption14d,
      suggestedQty: rawQty, bulkQty,
      lastPrice, estimatedCost: r2(bulkQty * lastPrice),
      urgency, orderBy,
      reason: `Couverture: ${coverageDays.toFixed(1)}j · Point réapprovisionnement: ${reorderPoint.toFixed(1)}`,
    });
  }

  lines.sort((a, b) => {
    const u = { critical: 0, high: 1, medium: 2, low: 3 };
    return u[a.urgency] - u[b.urgency];
  });

  const totalCost = r2(lines.reduce((s, l) => s + l.estimatedCost, 0));
  const urgentCost = r2(lines.filter(l => l.urgency === "critical" || l.urgency === "high").reduce((s, l) => s + l.estimatedCost, 0));
  const groupedByUrgency: Record<string, OptimizedPurchaseLine[]> = {};
  for (const l of lines) {
    if (!groupedByUrgency[l.urgency]) groupedByUrgency[l.urgency] = [];
    groupedByUrgency[l.urgency].push(l);
  }

  const result: OptimizedPurchasePlan = {
    generatedAt: new Date().toISOString(),
    lines, totalCost, urgentCost, groupedByUrgency,
  };
  cPut(cKey, result);
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// E. COST OPTIMIZATION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

export async function optimizeCostStructure(): Promise<CostOptimizationReport> {
  const cKey = "cost-opt";
  const cached = cGet<CostOptimizationReport>(cKey, TTL);
  if (cached) return cached;

  const allRecipes = await db.select().from(recipesTable);
  const costAlerts: CostAlert[] = [];
  const expensiveRecipes: CostOptimizationReport["expensiveRecipes"] = [];
  let totalSavings = 0;

  // Detect price fluctuations per ingredient
  const purchasableProducts = await db.select({ id: productsTable.id, name: productsTable.name })
    .from(productsTable).where(eq(productsTable.isPurchasable, true));

  for (const p of purchasableProducts) {
    const recentPurchases = await db.select({ unitCost: purchaseItemsTable.unitCost, createdAt: purchaseItemsTable.createdAt })
      .from(purchaseItemsTable).where(eq(purchaseItemsTable.productId, p.id))
      .orderBy(desc(purchaseItemsTable.createdAt)).limit(10);

    if (recentPurchases.length < 2) continue;

    const recent = parseFloat(recentPurchases[0].unitCost as string);
    const old = parseFloat(recentPurchases[recentPurchases.length - 1].unitCost as string);
    if (old <= 0) continue;

    const changePct = r2(((recent - old) / old) * 100);
    if (Math.abs(changePct) < 15) continue;

    // Find recipes using this ingredient
    const affectedItems = await db.select({ recipeId: recipeIngredientsTable.recipeId })
      .from(recipeIngredientsTable).where(eq(recipeIngredientsTable.productId, p.id));
    const affectedItemsV2 = await db.select({ recipeId: recipeItemsTable.recipeId })
      .from(recipeItemsTable).where(and(eq(recipeItemsTable.itemId, p.id), eq(recipeItemsTable.itemType, "product")));

    const recipeIds = [...new Set([...affectedItems.map(i => i.recipeId), ...affectedItemsV2.map(i => i.recipeId)])];
    const affectedRecipes: CostAlert["affectedRecipes"] = [];

    for (const recipeId of recipeIds.slice(0, 5)) {
      const [rec] = await db.select({ name: recipesTable.name }).from(recipesTable).where(eq(recipesTable.id, recipeId));
      try {
        const cb = await calculateRecipeCostBreakdown(recipeId, 1, 0, true);
        const line = cb.lines.find(l => l.itemId === p.id);
        if (line) {
          const impact = r2(line.totalCost * (changePct / 100));
          affectedRecipes.push({ recipeId, recipeName: rec?.name ?? `Recette #${recipeId}`, costImpact: impact });
          totalSavings += Math.abs(impact);
        }
      } catch { /**/ }
    }

    costAlerts.push({
      productId: p.id, productName: p.name,
      currentWac: recent, previousWac: old, changePct,
      affectedRecipes,
      severity: Math.abs(changePct) > 50 ? "high" : Math.abs(changePct) > 25 ? "medium" : "low",
      recommendation: changePct > 0
        ? `Chercher des fournisseurs alternatifs ou reformuler les recettes utilisant ${p.name}`
        : `Opportunité d'achat en gros — prix en baisse de ${Math.abs(changePct).toFixed(0)}%`,
    });
  }

  // Find expensive/low-margin recipes
  for (const recipe of allRecipes.slice(0, 20)) {
    try {
      const cb = await calculateRecipeCostBreakdown(recipe.id, parseFloat(recipe.yield as string));
      if (!cb.sellingPrice || cb.sellingPrice <= 0) continue;

      const margin = cb.marginPct ?? 0;
      const topIngredients = cb.lines
        .sort((a, b) => b.totalCost - a.totalCost)
        .slice(0, 3)
        .map(l => ({ name: l.itemName, costShare: r2((l.totalCost / Math.max(1, cb.totalCost)) * 100) }));

      let recommendation = "";
      if (margin < 10) {
        recommendation = `Marge critique (${margin.toFixed(1)}%) — augmenter le prix ou réduire les coûts d'au moins ${(10 - margin).toFixed(1)} pts`;
        totalSavings += cb.totalCost * 0.05;
      } else if (margin < 20) {
        recommendation = `Marge faible — examiner l'ingrédient principal (${topIngredients[0]?.name ?? "—"}) qui représente ${topIngredients[0]?.costShare ?? 0}% des coûts`;
      } else {
        continue;
      }

      expensiveRecipes.push({
        recipeId: recipe.id, recipeName: recipe.name,
        totalCost: cb.totalCost, costPerUnit: cb.costPerUnit,
        sellingPrice: cb.sellingPrice, margin,
        topIngredients, recommendation,
      });
    } catch { /**/ }
  }

  const globalRecommendations: string[] = [];
  const risingAlerts = costAlerts.filter(a => a.changePct > 0 && a.severity !== "low");
  if (risingAlerts.length > 0) globalRecommendations.push(`${risingAlerts.length} ingrédient(s) avec hausse de prix significative — réviser les recettes`);
  const lowMarginRecipes = expensiveRecipes.filter(r => r.margin < 10);
  if (lowMarginRecipes.length > 0) globalRecommendations.push(`${lowMarginRecipes.length} recette(s) avec marge < 10% — action correctrice requise`);
  if (totalSavings > 0) globalRecommendations.push(`Économies potentielles identifiées: ${totalSavings.toFixed(0)} DA`);

  const result: CostOptimizationReport = {
    generatedAt: new Date().toISOString(),
    totalSavingsPotential: r2(totalSavings),
    alerts: costAlerts.sort((a, b) => {
      const s = { high: 0, medium: 1, low: 2 };
      return s[a.severity] - s[b.severity];
    }),
    expensiveRecipes: expensiveRecipes.sort((a, b) => a.margin - b.margin),
    globalRecommendations,
  };
  cPut(cKey, result);
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// F. AI CONTROL CENTER (MASTER)
// ═══════════════════════════════════════════════════════════════════════════════

export async function buildAiControlCenter(branchIds: number[]): Promise<AiControlCenter> {
  const cKey = `ai-center:${branchIds.sort().join(",")}`;
  const cached = cGet<AiControlCenter>(cKey, TTL);
  if (cached) return cached;

  // Run all engines in parallel for performance
  const [scenario14d, purchasePlan, distributionPlan, costReport] = await Promise.all([
    simulateScenario({ daysAhead: 14, demandMultiplier: 1.0 }),
    generateOptimizedPurchasePlan(),
    optimizeStockDistribution(),
    optimizeCostStructure(),
  ]);

  // Production plans per branch
  const productionPlans = await Promise.all(branchIds.map(bid => optimizeProductionPlan(bid, 7)));

  // Build consolidated AI decisions
  const decisions: AiDecision[] = [];
  let priority = 1;

  // Critical shortages → produce decisions
  for (const p of scenario14d.products.filter(pr => pr.status === "critical").slice(0, 5)) {
    decisions.push({
      id: `produce-${p.productId}`,
      priority: priority++,
      type: "produce",
      title: `Produire immédiatement — ${p.productName}`,
      description: `Rupture dans < 2 jours. Besoin estimé: ${p.extraProductionNeeded.toFixed(0)} unités sur 14 jours`,
      estimatedImpact: `Éviter ${p.totalShortage.toFixed(0)} unités en rupture`,
      financialImpact: p.financialImpact,
      urgency: "critical",
      actionable: !!p.recipeId,
      params: { productId: p.productId, recipeId: p.recipeId, quantity: p.extraProductionNeeded },
    });
  }

  // Urgent purchases
  const urgentPurchases = purchasePlan.lines.filter(l => l.urgency === "critical").slice(0, 5);
  for (const pu of urgentPurchases) {
    decisions.push({
      id: `purchase-${pu.productId}`,
      priority: priority++,
      type: "purchase",
      title: `Commander d'urgence — ${pu.productName}`,
      description: pu.reason + `. Quantité optimale: ${pu.bulkQty} unités`,
      estimatedImpact: `Coût estimé: ${pu.estimatedCost.toFixed(0)} DA · Commander avant le ${pu.orderBy}`,
      financialImpact: -pu.estimatedCost,
      urgency: "critical",
      actionable: true,
      params: { productId: pu.productId, quantity: pu.bulkQty, cost: pu.estimatedCost },
    });
  }

  // Transfers
  for (const t of distributionPlan.transfers.filter(tr => tr.urgency === "critical").slice(0, 3)) {
    decisions.push({
      id: `transfer-${t.productId}-${t.fromBranchId}-${t.toBranchId}`,
      priority: priority++,
      type: "transfer",
      title: `Transfert recommandé — ${t.productName}`,
      description: `De ${t.fromBranchName} (surplus: ${t.overstockAtSource.toFixed(0)}) vers ${t.toBranchName} (manque: ${t.shortageAtDest.toFixed(0)})`,
      estimatedImpact: `Réduction risque: +${t.riskReductionScore} pts · Revenu sauvegardé estimé`,
      financialImpact: 0,
      urgency: t.urgency,
      actionable: true,
      params: { productId: t.productId, fromBranch: t.fromBranchId, toBranch: t.toBranchId, quantity: t.quantity },
    });
  }

  // Cost reformulation
  for (const r of costReport.expensiveRecipes.filter(re => re.margin < 10).slice(0, 3)) {
    decisions.push({
      id: `reformulate-${r.recipeId}`,
      priority: priority++,
      type: "reformulate",
      title: `Reformuler — ${r.recipeName}`,
      description: r.recommendation,
      estimatedImpact: `Marge actuelle: ${r.margin.toFixed(1)}% → cible: > 20%`,
      financialImpact: r2(r.sellingPrice * 0.1),
      urgency: "medium",
      actionable: false,
      params: { recipeId: r.recipeId },
    });
  }

  // Health score
  const criticalDecisions = decisions.filter(d => d.urgency === "critical").length;
  const highDecisions = decisions.filter(d => d.urgency === "high").length;
  const overallHealthScore = Math.max(0, 100 - (criticalDecisions * 15) - (highDecisions * 8) - (scenario14d.summary.criticalCount * 5));

  // Risk matrix
  const riskMatrix = await Promise.all(
    branchIds.map(async bid => {
      const [branch] = await db.select({ name: branchesTable.name }).from(branchesTable).where(eq(branchesTable.id, bid));
      const sim = await simulateScenario({ branchId: bid, daysAhead: 7 });
      const shortageRisk = Math.min(100, sim.summary.criticalCount * 20 + sim.summary.atRiskCount * 10);
      const overstockRisk = Math.min(100, sim.summary.overstockedCount * 15);
      return {
        branchId: bid, branchName: branch?.name ?? `Branch #${bid}`,
        shortageRisk, overstockRisk,
        status: shortageRisk > 50 ? "danger" : shortageRisk > 25 ? "warning" : "sûr",
      };
    })
  );

  const result: AiControlCenter = {
    generatedAt: new Date().toISOString(),
    scenario14d, productionPlan: productionPlans,
    distributionPlan, purchasePlan, costReport,
    decisions: decisions.slice(0, 20),
    overallHealthScore, riskMatrix,
  };
  cPut(cKey, result);
  return result;
}
