import { Router, type IRouter } from "express";
import { db, productionOrdersTable, productionOverrideLogsTable, productionOrderItemsTable, recipesTable, recipeIngredientsTable, recipeItemsTable, productsTable, branchesTable, usersTable, stockLevelsTable } from "@workspace/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, assertBranchAccess } from "../middlewares/permissions";
import { P } from "../lib/permissions";
import { adjustStock } from "./stock";
import { checkIngredientAvailability } from "../lib/availability";
import { calculateRecipeExplosion } from "../lib/bom";
import { calculateRecipeCostBreakdown, flattenBomForOrderItems, invalidateRecipeCostCache, invalidateWacCache } from "../lib/costing";

const router: IRouter = Router();

function genRef() { return `PROD-${Date.now()}`; }

function hasPermission(permissions: string[], perm: string): boolean {
  return permissions.includes(perm) || permissions.includes("*");
}

async function buildOrderResponse(order: typeof productionOrdersTable.$inferSelect) {
  const [recipe] = await db.select().from(recipesTable).where(eq(recipesTable.id, order.recipeId));
  const [branch] = await db.select().from(branchesTable).where(eq(branchesTable.id, order.branchId));
  let productName: string | null = null;
  let sellingPrice: number | null = null;
  if (order.productId) {
    const [p] = await db.select().from(productsTable).where(eq(productsTable.id, order.productId));
    productName = p?.name ?? null;
    sellingPrice = p?.sellingPrice ? parseFloat(p.sellingPrice as string) : null;
  }
  let createdByName: string | null = null;
  if (order.createdByUserId) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, order.createdByUserId));
    createdByName = u?.name ?? null;
  }
  const recipeYield = recipe?.yield ? parseFloat(recipe.yield as string) : 1;
  const plannedQty = parseFloat(order.plannedQuantity as string);
  const theoreticalCost = parseFloat(order.theoreticalCost as string);
  const actualCost = order.actualCost ? parseFloat(order.actualCost as string) : null;
  const estimatedCost = order.estimatedCost ? parseFloat(order.estimatedCost as string) : null;
  const costVariance = order.costVariance ? parseFloat(order.costVariance as string) : null;

  let profitability: null | { profitPerUnit: number; totalProfit: number; marginPct: number; marginLevel: string } = null;
  const qty = (order.actualQuantity ? parseFloat(order.actualQuantity as string) : plannedQty) || 1;
  const costUsed = actualCost ?? estimatedCost ?? theoreticalCost;
  const costPerUnit = costUsed / qty;
  if (sellingPrice && sellingPrice > 0 && costPerUnit >= 0) {
    const profitPerUnit = sellingPrice - costPerUnit;
    const totalProfit = profitPerUnit * qty;
    const marginPct = Math.round((profitPerUnit / sellingPrice) * 10000) / 100;
    profitability = {
      profitPerUnit: Math.round(profitPerUnit * 100) / 100,
      totalProfit: Math.round(totalProfit * 100) / 100,
      marginPct,
      marginLevel: marginPct >= 30 ? "green" : marginPct >= 10 ? "orange" : "red",
    };
  }

  return {
    ...order,
    recipeName: recipe?.name ?? "",
    recipeYield,
    branchName: branch?.name ?? "",
    productName,
    sellingPrice,
    createdByName,
    plannedQuantity: plannedQty,
    actualQuantity: order.actualQuantity ? parseFloat(order.actualQuantity as string) : null,
    theoreticalCost,
    estimatedCost,
    actualCost,
    costVariance,
    wastePercentage: parseFloat(order.wastePercentage as string),
    profitability,
    startedAt: order.startedAt?.toISOString() ?? null,
    completedAt: order.completedAt?.toISOString() ?? null,
  };
}

router.get("/production/planning", requireAuth, requirePermission(P.production.view), async (req, res): Promise<void> => {
  const products = await db.select({
    p: productsTable,
    totalStock: sql<string>`COALESCE((SELECT SUM(quantity) FROM stock_levels WHERE product_id = ${productsTable.id}), 0)`
  }).from(productsTable).where(eq(productsTable.isFabricated, true));

  const suggestions = products
    .filter(r => {
      const qty = parseFloat(r.totalStock);
      const alert = r.p.alertQuantity ? parseFloat(r.p.alertQuantity as string) : null;
      return alert !== null && qty <= alert;
    })
    .map(r => {
      const qty = parseFloat(r.totalStock);
      const alert = parseFloat(r.p.alertQuantity as string);
      const urgency = qty === 0 ? "critical" : qty <= alert * 0.3 ? "critical" : qty <= alert * 0.6 ? "high" : qty <= alert ? "medium" : "low";
      return {
        productId: r.p.id, productName: r.p.name, currentStock: qty, alertQuantity: alert,
        suggestedQuantity: alert * 2, recipeId: null, recipeName: null, urgency
      };
    });
  res.json(suggestions);
});

// Cost preview endpoint (before creating order)
router.post("/production/cost-preview", requireAuth, requirePermission(P.production.view), async (req, res): Promise<void> => {
  const { recipeId, quantity, wastePercentage = 0 } = req.body;
  if (!recipeId || !quantity) { res.status(400).json({ error: "recipeId et quantity requis" }); return; }
  try {
    const breakdown = await calculateRecipeCostBreakdown(
      parseInt(String(recipeId), 10),
      parseFloat(String(quantity)),
      parseFloat(String(wastePercentage)),
      false
    );
    res.json(breakdown);
  } catch (err: any) {
    res.status(400).json({ error: err.message ?? "Erreur calcul coût" });
  }
});

router.get("/production", requireAuth, requirePermission(P.production.view), async (req, res): Promise<void> => {
  const { branchId, status } = req.query as Record<string, string>;
  const user = req.user!;
  const conditions = [];
  const reqBranchId = branchId ? parseInt(branchId, 10) : null;
  if (!user.adminAccess) {
    if (user.branchIds.length === 0) { res.json([]); return; }
    if (reqBranchId) {
      if (!user.branchIds.includes(reqBranchId)) { res.status(403).json({ error: "Accès refusé à cette succursale", code: "BRANCH_ACCESS_DENIED" }); return; }
      conditions.push(eq(productionOrdersTable.branchId, reqBranchId));
    } else {
      conditions.push(inArray(productionOrdersTable.branchId, user.branchIds));
    }
  } else if (reqBranchId) {
    conditions.push(eq(productionOrdersTable.branchId, reqBranchId));
  }
  if (status) conditions.push(eq(productionOrdersTable.status, status));
  const orders = conditions.length
    ? await db.select().from(productionOrdersTable).where(and(...conditions)).orderBy(desc(productionOrdersTable.createdAt))
    : await db.select().from(productionOrdersTable).orderBy(desc(productionOrdersTable.createdAt));
  const result = await Promise.all(orders.map(buildOrderResponse));
  res.json(result);
});

router.get("/production/:id", requireAuth, requirePermission(P.production.view), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, id));
  if (!order) { res.status(404).json({ error: "Ordre introuvable" }); return; }
  if (!assertBranchAccess(req.user!, order.branchId, res)) return;
  res.json(await buildOrderResponse(order));
});

router.get("/production/:id/bom", requireAuth, requirePermission(P.production.view), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, id));
  if (!order) { res.status(404).json({ error: "Ordre introuvable" }); return; }
  if (!assertBranchAccess(req.user!, order.branchId, res)) return;
  try {
    const qty = parseFloat(order.plannedQuantity as string);
    const explosion = await calculateRecipeExplosion(order.recipeId, qty);
    res.json(explosion);
  } catch (err: any) {
    res.status(400).json({ error: err.message ?? "Erreur BOM" });
  }
});

router.get("/production/:id/cost", requireAuth, requirePermission(P.production.view), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, id));
  if (!order) { res.status(404).json({ error: "Ordre introuvable" }); return; }
  if (!assertBranchAccess(req.user!, order.branchId, res)) return;

  const qty = req.query.quantity
    ? parseFloat(req.query.quantity as string)
    : parseFloat(order.plannedQuantity as string);
  const wastePercentage = parseFloat(order.wastePercentage as string) || 0;
  const forceRefresh = req.query.refresh === "true";

  try {
    const breakdown = await calculateRecipeCostBreakdown(order.recipeId, qty, wastePercentage, forceRefresh);
    const savedItems = await db
      .select()
      .from(productionOrderItemsTable)
      .where(eq(productionOrderItemsTable.productionOrderId, id));
    res.json({ ...breakdown, savedItems });
  } catch (err: any) {
    res.status(400).json({ error: err.message ?? "Erreur calcul coût" });
  }
});

router.get("/production/:id/availability", requireAuth, requirePermission(P.production.view), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, id));
  if (!order) { res.status(404).json({ error: "Ordre introuvable" }); return; }
  if (!assertBranchAccess(req.user!, order.branchId, res)) return;
  const qty = req.query.plannedQuantity
    ? parseFloat(req.query.plannedQuantity as string)
    : parseFloat(order.plannedQuantity as string);
  const result = await checkIngredientAvailability(order.recipeId, qty, order.branchId);
  res.json(result);
});

router.get("/production/:id/overrides", requireAuth, requirePermission(P.production.view), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const logs = await db
    .select({ log: productionOverrideLogsTable, userName: usersTable.name })
    .from(productionOverrideLogsTable)
    .leftJoin(usersTable, eq(productionOverrideLogsTable.userId, usersTable.id))
    .where(eq(productionOverrideLogsTable.productionOrderId, id))
    .orderBy(desc(productionOverrideLogsTable.createdAt));
  res.json(logs.map(l => ({ ...l.log, userName: l.userName })));
});

router.post("/production", requireAuth, requirePermission(P.production.create), async (req, res): Promise<void> => {
  const { recipeId, plannedQuantity, branchId, status, notes, wastePercentage = 0 } = req.body;
  if (!recipeId || !plannedQuantity || !branchId) {
    res.status(400).json({ error: "Champs requis manquants" }); return;
  }
  if (!assertBranchAccess(req.user!, parseInt(String(branchId), 10), res)) return;

  // ── GUARD: recipe must exist ───────────────────────────────────────────────
  const [recipe] = await db.select().from(recipesTable).where(eq(recipesTable.id, recipeId));
  if (!recipe) {
    res.status(404).json({ error: "Recette introuvable", code: "RECIPE_NOT_FOUND" }); return;
  }

  // ── GUARD: recipe must have at least one ingredient ───────────────────────
  const [hasItems] = await db
    .select({ cnt: sql<number>`COUNT(*)::int` })
    .from(recipeItemsTable)
    .where(eq(recipeItemsTable.recipeId, recipeId));
  const [hasLegacy] = await db
    .select({ cnt: sql<number>`COUNT(*)::int` })
    .from(recipeIngredientsTable)
    .where(eq(recipeIngredientsTable.recipeId, recipeId));
  if ((hasItems?.cnt ?? 0) === 0 && (hasLegacy?.cnt ?? 0) === 0) {
    res.status(400).json({ error: "La recette n'a aucun ingrédient", code: "RECIPE_EMPTY" }); return;
  }

  // ── GUARD: plannedQuantity must be positive ────────────────────────────────
  const plannedQtyNum = parseFloat(String(plannedQuantity));
  if (!isFinite(plannedQtyNum) || plannedQtyNum <= 0) {
    res.status(400).json({ error: "La quantité planifiée doit être positive" }); return;
  }

  let theoreticalCost = 0;
  let estimatedCost = 0;
  let bomSnapshotStr: string | null = null;
  let materialsSnapshotStr: string | null = null;

  try {
    const explosion = await calculateRecipeExplosion(recipeId, plannedQtyNum);
    theoreticalCost = explosion.totalCost;
    bomSnapshotStr = JSON.stringify(explosion.tree);
    materialsSnapshotStr = JSON.stringify(explosion.materials);
  } catch {
    const ingredients = await db.select({ ri: recipeIngredientsTable, costPrice: productsTable.costPrice })
      .from(recipeIngredientsTable).leftJoin(productsTable, eq(recipeIngredientsTable.productId, productsTable.id))
      .where(eq(recipeIngredientsTable.recipeId, recipeId));
    const yield_ = parseFloat(recipe.yield as string ?? "1");
    const ratio = plannedQtyNum / yield_;
    for (const i of ingredients) {
      const qty = parseFloat(i.ri.quantity as string) * ratio;
      const wastage = parseFloat(i.ri.wastageRate as string) / 100;
      theoreticalCost += qty * (1 + wastage) * parseFloat(i.costPrice as string ?? "0");
    }
  }

  try {
    const costBreakdown = await calculateRecipeCostBreakdown(
      recipeId,
      plannedQtyNum,
      parseFloat(String(wastePercentage))
    );
    estimatedCost = costBreakdown.totalCost;
  } catch {
    estimatedCost = theoreticalCost;
  }

  const [order] = await db.insert(productionOrdersTable).values({
    reference: genRef(),
    recipeId,
    productId: recipe.productId ?? null,
    plannedQuantity: plannedQtyNum.toString(),
    status: status ?? "planned",
    branchId,
    theoreticalCost: theoreticalCost.toString(),
    estimatedCost: estimatedCost.toString(),
    wastePercentage: wastePercentage.toString(),
    notes,
    bomSnapshot: bomSnapshotStr,
    explodedMaterialsSnapshot: materialsSnapshotStr,
    createdByUserId: (req as any).user?.id ?? null,
  }).returning();

  // Save order items (non-critical, best-effort)
  try {
    const explosion = await calculateRecipeExplosion(recipeId, plannedQtyNum);
    const items = await flattenBomForOrderItems(explosion.tree);
    for (const item of items) {
      await db.insert(productionOrderItemsTable).values({
        productionOrderId: order.id,
        itemType: item.itemType,
        itemId: item.itemId,
        itemName: item.itemName,
        quantity: item.quantity.toString(),
        unitAbbreviation: item.unitAbbreviation,
        unitCostPrice: item.unitCostPrice.toString(),
        totalCost: item.totalCost.toString(),
        wastageRate: item.wastageRate.toString(),
        nestingLevel: item.nestingLevel,
      });
    }
  } catch { /* non-critical */ }

  res.status(201).json(await buildOrderResponse(order));
});

router.post("/production/:id/launch", requireAuth, requirePermission(P.production.launch), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const user = (req as any).user;
  const { overrideReason } = req.body ?? {};

  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, id));
  if (!order) { res.status(404).json({ error: "Ordre introuvable" }); return; }
  if (!assertBranchAccess(req.user!, order.branchId, res)) return;
  if (!["planned", "draft"].includes(order.status)) {
    res.status(409).json({ error: "Cet ordre ne peut pas être lancé dans son état actuel" }); return;
  }

  const availability = await checkIngredientAvailability(
    order.recipeId, parseFloat(order.plannedQuantity as string), order.branchId
  );

  if (!availability.canLaunch) {
    if (!overrideReason) {
      res.status(409).json({ error: "Ingrédients insuffisants", code: "INGREDIENTS_UNAVAILABLE", availability });
      return;
    }
    if (!hasPermission(req.userPermissions ?? [], P.production.overrideShortage)) {
      res.status(403).json({ error: "Vous n'avez pas l'autorisation de lancer avec des ingrédients insuffisants", code: "OVERRIDE_FORBIDDEN", availability });
      return;
    }
    await db.insert(productionOverrideLogsTable).values({
      productionOrderId: id, userId: user.id, reason: overrideReason,
      availabilitySnapshot: JSON.stringify(availability),
    });
  }

  const [updated] = await db.update(productionOrdersTable)
    .set({ status: "in_progress", startedAt: new Date() })
    .where(eq(productionOrdersTable.id, id)).returning();

  res.json({ ...await buildOrderResponse(updated), availability });
});

router.patch("/production/:id", requireAuth, requirePermission(P.production.edit), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const [existing] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, id));
  if (!existing) { res.status(404).json({ error: "Ordre introuvable" }); return; }
  if (!assertBranchAccess(req.user!, existing.branchId, res)) return;
  const { status, plannedQuantity, notes, wastePercentage } = req.body;
  const updates: Record<string, unknown> = {};
  if (status != null) updates.status = status;
  if (plannedQuantity != null) updates.plannedQuantity = plannedQuantity.toString();
  if (notes != null) updates.notes = notes;
  if (wastePercentage != null) updates.wastePercentage = wastePercentage.toString();
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Aucun champ à mettre à jour" }); return;
  }
  const [order] = await db.update(productionOrdersTable).set(updates as any).where(eq(productionOrdersTable.id, id)).returning();
  if (!order) { res.status(404).json({ error: "Ordre introuvable" }); return; }
  res.json(await buildOrderResponse(order));
});

router.post("/production/:id/complete", requireAuth, requirePermission(P.production.complete), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const [order] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, id));
  if (!order) { res.status(404).json({ error: "Ordre introuvable" }); return; }
  if (!assertBranchAccess(req.user!, order.branchId, res)) return;
  if (!["in_progress", "launched"].includes(order.status)) {
    res.status(409).json({ error: "L'ordre doit être en cours d'exécution pour être complété" }); return;
  }

  const { actualQuantity } = req.body;
  if (!actualQuantity || parseFloat(String(actualQuantity)) <= 0) {
    res.status(400).json({ error: "La quantité réelle doit être positive" }); return;
  }

  const wastePercentage = parseFloat(order.wastePercentage as string) || 0;

  let updatedOrder: typeof productionOrdersTable.$inferSelect;

  try {
    // ── ATOMIC TRANSACTION: all stock movements + order update ────────────────
    await db.transaction(async (tx) => {
      let actualCost = 0;
      let bomSnapshotStr = order.bomSnapshot;
      let materialsSnapshotStr = order.explodedMaterialsSnapshot;

      try {
        const explosion = await calculateRecipeExplosion(order.recipeId, parseFloat(String(actualQuantity)));
        actualCost = explosion.totalCost;
        bomSnapshotStr = JSON.stringify(explosion.tree);
        materialsSnapshotStr = JSON.stringify(explosion.materials);

        for (const mat of explosion.materials) {
          await adjustStock(mat.productId, order.branchId, -mat.quantity, "production_consumption", order.reference, mat.costPrice, order.id, tx);
        }
      } catch (err: any) {
        // If BOM explosion fails (cyclic, missing recipe), fall back to legacy ingredients
        if (err.message?.startsWith("Référence circulaire") || err.message?.startsWith("Recette introuvable")) {
          throw err; // Re-throw: don't complete a broken production
        }
        const [rec] = await tx.select().from(recipesTable).where(eq(recipesTable.id, order.recipeId));
        const yield_ = parseFloat(rec?.yield as string ?? "1");
        const ratio = parseFloat(String(actualQuantity)) / yield_;
        const ingredients = await tx.select({ ri: recipeIngredientsTable, costPrice: productsTable.costPrice })
          .from(recipeIngredientsTable)
          .leftJoin(productsTable, eq(recipeIngredientsTable.productId, productsTable.id))
          .where(eq(recipeIngredientsTable.recipeId, order.recipeId));
        for (const i of ingredients) {
          const qty = parseFloat(i.ri.quantity as string) * ratio;
          const wastage = parseFloat(i.ri.wastageRate as string) / 100;
          const consumed = qty * (1 + wastage);
          const cost = parseFloat(i.costPrice as string ?? "0");
          actualCost += consumed * cost;
          await adjustStock(i.ri.productId, order.branchId, -consumed, "production_consumption", order.reference, cost, order.id, tx);
        }
      }

      // Apply waste factor to cost
      const wasteCostAdded = actualCost * (wastePercentage / 100);
      const finalActualCost = Math.round((actualCost + wasteCostAdded) * 100) / 100;
      const theoreticalCost = parseFloat(order.theoreticalCost as string);
      const costVariance = Math.round((finalActualCost - theoreticalCost) * 100) / 100;

      // Add finished product to stock
      if (order.productId) {
        const costPerUnit = parseFloat(String(actualQuantity)) > 0 ? finalActualCost / parseFloat(String(actualQuantity)) : 0;
        await adjustStock(order.productId, order.branchId, parseFloat(String(actualQuantity)), "production_output", order.reference, costPerUnit, order.id, tx);
      }

      // Update order to completed inside transaction
      const [updated] = await tx.update(productionOrdersTable).set({
        status: "completed",
        actualQuantity: actualQuantity.toString(),
        actualCost: finalActualCost.toString(),
        costVariance: costVariance.toString(),
        completedAt: new Date(),
        bomSnapshot: bomSnapshotStr,
        explodedMaterialsSnapshot: materialsSnapshotStr,
      }).where(eq(productionOrdersTable.id, id)).returning();

      updatedOrder = updated;
    });

    // Invalidate caches after transaction commits
    invalidateRecipeCostCache(order.recipeId);
    if (order.productId) invalidateWacCache(order.productId);

    // Invalidate WAC for all consumed products (best-effort, outside tx)
    try {
      const explosion = await calculateRecipeExplosion(order.recipeId, parseFloat(String(actualQuantity)));
      for (const mat of explosion.materials) invalidateWacCache(mat.productId);
    } catch { /* cache invalidation is non-critical */ }

  } catch (err: any) {
    if (err.message?.startsWith("Référence circulaire")) {
      res.status(400).json({ error: err.message, code: "CIRCULAR_BOM" }); return;
    }
    if (err.message?.startsWith("Recette introuvable")) {
      res.status(404).json({ error: err.message, code: "RECIPE_NOT_FOUND" }); return;
    }
    res.status(500).json({ error: "Erreur lors de la complétion de l'ordre", detail: err.message });
    return;
  }

  res.json(await buildOrderResponse(updatedOrder!));
});

export default router;
