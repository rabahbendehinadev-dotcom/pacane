import { Router, type IRouter } from "express";
import { db, branchesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { requirePermission } from "../middlewares/permissions";
import { P } from "../lib/permissions";
import {
  forecastProductDemand,
  calculateStockRisk,
  generatePurchaseSuggestions,
  analyzeBranchConsumption,
  detectWasteAndOverproduction,
  generateIntelligenceAlerts,
  buildIntelligenceDashboard,
  invalidateForecastCache,
} from "../lib/forecasting";

const router: IRouter = Router();

function getBranchIds(user: any): number[] {
  if (user?.adminAccess) return [];
  return (user?.branchIds as number[]) ?? [];
}

router.get("/dashboard/intelligence", requireAuth, requirePermission(P.analytics.view), async (req, res): Promise<void> => {
  const user = req.user!;
  let branchIds: number[];

  if (user.adminAccess) {
    const branches = await db.select({ id: branchesTable.id }).from(branchesTable);
    branchIds = branches.map(b => b.id);
  } else {
    branchIds = getBranchIds(user);
  }

  if (branchIds.length === 0) {
    res.json({
      generatedAt: new Date().toISOString(),
      predictedSalesToday: 0, predictedSalesWeek: 0,
      alerts: [], stockRisks: [], purchaseSuggestions: [],
      wasteAlerts: [], topForecasts: [], branchSummaries: [],
    });
    return;
  }

  try {
    const dashboard = await buildIntelligenceDashboard(branchIds);
    res.json(dashboard);
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Erreur intelligence" });
  }
});

router.get("/dashboard/intelligence/forecast/:productId", requireAuth, requirePermission(P.analytics.view), async (req, res): Promise<void> => {
  const productId = parseInt(req.params.productId as string, 10);
  const branchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : null;
  const period = req.query.period ? parseInt(req.query.period as string, 10) : 30;
  try {
    const forecast = await forecastProductDemand(productId, branchId, period);
    res.json(forecast);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/dashboard/intelligence/risk/:productId", requireAuth, requirePermission(P.analytics.view), async (req, res): Promise<void> => {
  const productId = parseInt(req.params.productId as string, 10);
  const branchId = parseInt(req.query.branchId as string, 10);
  if (!branchId) { res.status(400).json({ error: "branchId requis" }); return; }
  try {
    const risk = await calculateStockRisk(productId, branchId);
    res.json(risk);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/dashboard/intelligence/purchase-suggestions", requireAuth, requirePermission(P.analytics.view), async (req, res): Promise<void> => {
  const user = req.user!;
  const requestedBranchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : null;

  let branchIds: number[];
  if (user.adminAccess) {
    if (requestedBranchId) { branchIds = [requestedBranchId]; }
    else { const branches = await db.select({ id: branchesTable.id }).from(branchesTable); branchIds = branches.map(b => b.id); }
  } else {
    branchIds = requestedBranchId ? [requestedBranchId] : getBranchIds(user);
  }

  try {
    const suggestions = (await Promise.all(branchIds.map(bid => generatePurchaseSuggestions(bid)))).flat();
    res.json(suggestions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/dashboard/intelligence/consumption/:branchId", requireAuth, requirePermission(P.analytics.view), async (req, res): Promise<void> => {
  const branchId = parseInt(req.params.branchId as string, 10);
  try {
    const analysis = await analyzeBranchConsumption(branchId);
    res.json(analysis);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/dashboard/intelligence/waste", requireAuth, requirePermission(P.analytics.view), async (req, res): Promise<void> => {
  try {
    const alerts = await detectWasteAndOverproduction();
    res.json(alerts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/dashboard/intelligence/alerts", requireAuth, requirePermission(P.analytics.view), async (req, res): Promise<void> => {
  const user = req.user!;
  let branchIds: number[];
  if (user.adminAccess) {
    const branches = await db.select({ id: branchesTable.id }).from(branchesTable);
    branchIds = branches.map(b => b.id);
  } else {
    branchIds = getBranchIds(user);
  }
  try {
    const alerts = await generateIntelligenceAlerts(branchIds);
    res.json(alerts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/dashboard/intelligence/invalidate-cache", requireAuth, async (req, res): Promise<void> => {
  invalidateForecastCache();
  res.json({ ok: true });
});

export default router;
