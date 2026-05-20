import { Router, type IRouter } from "express";
import { db, productionOrdersTable, productionOverrideLogsTable, recipesTable, recipeIngredientsTable, productsTable, branchesTable, usersTable, stockLevelsTable } from "@workspace/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, assertBranchAccess, visibleBranchIds } from "../middlewares/permissions";
import { P } from "../lib/permissions";
import { adjustStock } from "./stock";
import { checkIngredientAvailability } from "../lib/availability";

const router: IRouter = Router();

function genRef() { return `PROD-${Date.now()}`; }

async function buildOrderResponse(order: typeof productionOrdersTable.$inferSelect) {
  const [recipe] = await db.select().from(recipesTable).where(eq(recipesTable.id, order.recipeId));
  const [branch] = await db.select().from(branchesTable).where(eq(branchesTable.id, order.branchId));
  let productName: string | null = null;
  if (order.productId) {
    const [p] = await db.select().from(productsTable).where(eq(productsTable.id, order.productId));
    productName = p?.name ?? null;
  }
  let createdByName: string | null = null;
  if (order.createdByUserId) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, order.createdByUserId));
    createdByName = u?.name ?? null;
  }
  const recipeYield = recipe?.yield ? parseFloat(recipe.yield as string) : 1;
  const plannedQty = parseFloat(order.plannedQuantity as string);
  return {
    ...order,
    recipeName: recipe?.name ?? "",
    recipeYield,
    branchName: branch?.name ?? "",
    productName,
    createdByName,
    plannedQuantity: plannedQty,
    actualQuantity: order.actualQuantity ? parseFloat(order.actualQuantity as string) : null,
    theoreticalCost: parseFloat(order.theoreticalCost as string),
    actualCost: order.actualCost ? parseFloat(order.actualCost as string) : null,
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
  const { recipeId, plannedQuantity, branchId, status, notes } = req.body;
  if (!recipeId || !plannedQuantity || !branchId) { res.status(400).json({ error: "Champs requis manquants" }); return; }
  if (!assertBranchAccess(req.user!, parseInt(String(branchId), 10), res)) return;
  const [recipe] = await db.select().from(recipesTable).where(eq(recipesTable.id, recipeId));
  const ingredients = await db.select({ ri: recipeIngredientsTable, costPrice: productsTable.costPrice })
    .from(recipeIngredientsTable).leftJoin(productsTable, eq(recipeIngredientsTable.productId, productsTable.id))
    .where(eq(recipeIngredientsTable.recipeId, recipeId));
  const yield_ = parseFloat(recipe?.yield as string ?? "1");
  const ratio = plannedQuantity / yield_;
  let theoreticalCost = 0;
  for (const i of ingredients) {
    const qty = parseFloat(i.ri.quantity as string) * ratio;
    const wastage = parseFloat(i.ri.wastageRate as string) / 100;
    theoreticalCost += qty * (1 + wastage) * parseFloat(i.costPrice as string ?? "0");
  }
  const [order] = await db.insert(productionOrdersTable).values({
    reference: genRef(),
    recipeId,
    productId: recipe?.productId ?? null,
    plannedQuantity: plannedQuantity.toString(),
    status: status ?? "planned",
    branchId,
    theoreticalCost: theoreticalCost.toString(),
    notes,
    createdByUserId: (req as any).user?.id ?? null,
  }).returning();
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
    res.status(409).json({ error: "Cet ordre ne peut pas être lancé dans son état actuel (attendu: planifié)" }); return;
  }

  const availability = await checkIngredientAvailability(
    order.recipeId,
    parseFloat(order.plannedQuantity as string),
    order.branchId
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
      productionOrderId: id,
      userId: user.id,
      reason: overrideReason,
      availabilitySnapshot: JSON.stringify(availability),
    });
  }

  const [updated] = await db.update(productionOrdersTable)
    .set({ status: "in_progress", startedAt: new Date() })
    .where(eq(productionOrdersTable.id, id))
    .returning();

  res.json({ ...await buildOrderResponse(updated), availability });
});

router.patch("/production/:id", requireAuth, requirePermission(P.production.edit), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const [existing] = await db.select().from(productionOrdersTable).where(eq(productionOrdersTable.id, id));
  if (!existing) { res.status(404).json({ error: "Ordre introuvable" }); return; }
  if (!assertBranchAccess(req.user!, existing.branchId, res)) return;
  const { status, plannedQuantity, notes } = req.body;
  const updates: Record<string, unknown> = {};
  if (status != null) updates.status = status;
  if (plannedQuantity != null) updates.plannedQuantity = plannedQuantity.toString();
  if (notes != null) updates.notes = notes;
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
  const [recipe] = await db.select().from(recipesTable).where(eq(recipesTable.id, order.recipeId));
  const yield_ = parseFloat(recipe?.yield as string ?? "1");
  const ratio = actualQuantity / yield_;
  const ingredients = await db.select({ ri: recipeIngredientsTable, costPrice: productsTable.costPrice })
    .from(recipeIngredientsTable).leftJoin(productsTable, eq(recipeIngredientsTable.productId, productsTable.id))
    .where(eq(recipeIngredientsTable.recipeId, order.recipeId));
  let actualCost = 0;
  for (const i of ingredients) {
    const qty = parseFloat(i.ri.quantity as string) * ratio;
    const wastage = parseFloat(i.ri.wastageRate as string) / 100;
    const consumed = qty * (1 + wastage);
    actualCost += consumed * parseFloat(i.costPrice as string ?? "0");
    await adjustStock(i.ri.productId, order.branchId, -consumed, "production_consumption", order.reference, parseFloat(i.costPrice as string ?? "0"), order.id);
  }
  if (order.productId) {
    const costPerUnit = actualCost / actualQuantity;
    await adjustStock(order.productId, order.branchId, actualQuantity, "production_output", order.reference, costPerUnit, order.id);
  }
  const [updated] = await db.update(productionOrdersTable).set({
    status: "completed", actualQuantity: actualQuantity.toString(),
    actualCost: actualCost.toString(), completedAt: new Date()
  }).where(eq(productionOrdersTable.id, id)).returning();
  res.json(await buildOrderResponse(updated));
});

export default router;
