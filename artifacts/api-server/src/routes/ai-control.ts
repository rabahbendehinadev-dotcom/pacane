import { Router, type IRouter } from "express";
import { db, branchesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { requirePermission } from "../middlewares/permissions";
import { P } from "../lib/permissions";
import {
  simulateScenario, optimizeProductionPlan, optimizeStockDistribution,
  generateOptimizedPurchasePlan, optimizeCostStructure, buildAiControlCenter,
  invalidateSimCache, type ScenarioParams,
} from "../lib/simulation";

const router: IRouter = Router();

async function getAccessibleBranchIds(user: any): Promise<number[]> {
  if (user?.adminAccess) {
    const branches = await db.select({ id: branchesTable.id }).from(branchesTable);
    return branches.map(b => b.id);
  }
  return (user?.branchIds as number[]) ?? [];
}

router.get("/ai/control-center", requireAuth, requirePermission(P.analytics.view), async (req, res): Promise<void> => {
  const user = req.user!;
  const branchIds = await getAccessibleBranchIds(user);
  if (branchIds.length === 0) { res.json({ decisions: [], overallHealthScore: 100 }); return; }
  try {
    const data = await buildAiControlCenter(branchIds);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Erreur AI Control Center" });
  }
});

router.post("/ai/simulate", requireAuth, requirePermission(P.analytics.view), async (req, res): Promise<void> => {
  const params: ScenarioParams = {
    branchId: req.body.branchId ?? null,
    daysAhead: req.body.daysAhead ?? 14,
    demandMultiplier: req.body.demandMultiplier ?? 1.0,
    productionCapacityFactor: req.body.productionCapacityFactor ?? 1.0,
    stockBuffer: req.body.stockBuffer ?? 2,
  };
  try {
    const result = await simulateScenario(params);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message ?? "Erreur simulation" });
  }
});

router.get("/ai/production-plan", requireAuth, requirePermission(P.analytics.view), async (req, res): Promise<void> => {
  const user = req.user!;
  const branchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : null;
  const daysAhead = req.query.days ? parseInt(req.query.days as string, 10) : 7;

  let branchIds: number[];
  if (branchId) {
    branchIds = [branchId];
  } else {
    branchIds = await getAccessibleBranchIds(user);
  }

  try {
    const plans = await Promise.all(branchIds.slice(0, 5).map(bid => optimizeProductionPlan(bid, daysAhead)));
    res.json(branchId ? plans[0] : plans);
  } catch (err: any) {
    res.status(400).json({ error: err.message ?? "Erreur plan de production" });
  }
});

router.get("/ai/stock-distribution", requireAuth, requirePermission(P.analytics.view), async (req, res): Promise<void> => {
  try {
    const plan = await optimizeStockDistribution();
    res.json(plan);
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Erreur distribution" });
  }
});

router.get("/ai/purchase-plan", requireAuth, requirePermission(P.analytics.view), async (req, res): Promise<void> => {
  try {
    const plan = await generateOptimizedPurchasePlan();
    res.json(plan);
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Erreur plan d'achat" });
  }
});

router.get("/ai/cost-optimization", requireAuth, requirePermission(P.analytics.view), async (req, res): Promise<void> => {
  try {
    const report = await optimizeCostStructure();
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Erreur optimisation coûts" });
  }
});

router.post("/ai/invalidate-cache", requireAuth, async (req, res): Promise<void> => {
  invalidateSimCache();
  res.json({ ok: true });
});

export default router;
