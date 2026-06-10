import { Router, type IRouter } from "express";
import { db, recipesTable, recipeIngredientsTable, recipeItemsTable, productsTable, unitsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission } from "../middlewares/permissions";
import { P } from "../lib/permissions";
import { calculateRecipeCostBreakdown, invalidateRecipeCostCache } from "../lib/costing";

const router: IRouter = Router();

async function buildRecipeResponse(recipe: typeof recipesTable.$inferSelect) {
  const [unit] = await db.select().from(unitsTable).where(eq(unitsTable.id, recipe.yieldUnitId));
  let productName: string | null = null;
  let sellingPrice: number | null = null;
  if (recipe.productId) {
    const [p] = await db.select().from(productsTable).where(eq(productsTable.id, recipe.productId));
    productName = p?.name ?? null;
    sellingPrice = p?.sellingPrice ? parseFloat(p.sellingPrice as string) : null;
  }

  const recipeItems = await db.select().from(recipeItemsTable).where(eq(recipeItemsTable.recipeId, recipe.id));

  let theoreticalCost = 0;
  let components: object[] = [];

  if (recipeItems.length > 0) {
    for (const item of recipeItems) {
      const qty = parseFloat(item.quantity as string);
      const wastage = parseFloat(item.wastageRate as string) / 100;
      const [u] = await db.select().from(unitsTable).where(eq(unitsTable.id, item.unitId));

      if (item.itemType === "recipe") {
        const [subRecipe] = await db.select().from(recipesTable).where(eq(recipesTable.id, item.itemId));
        components.push({
          id: item.id, itemType: "recipe", itemId: item.itemId,
          itemName: subRecipe?.name ?? `Recette #${item.itemId}`,
          quantity: qty, unitId: item.unitId, unitName: u?.abbreviation ?? "",
          wastageRate: parseFloat(item.wastageRate as string), totalCost: 0,
        });
      } else {
        const [p] = await db.select().from(productsTable).where(eq(productsTable.id, item.itemId));
        const cost = parseFloat(p?.costPrice as string ?? "0");
        const totalCost = qty * (1 + wastage) * cost;
        theoreticalCost += totalCost;
        components.push({
          id: item.id, itemType: "product", itemId: item.itemId,
          itemName: p?.name ?? `Produit #${item.itemId}`,
          productId: item.itemId, productName: p?.name ?? "",
          quantity: qty, unitId: item.unitId, unitName: u?.abbreviation ?? "",
          wastageRate: parseFloat(item.wastageRate as string), unitCost: cost, totalCost,
        });
      }
    }

    const ingredientsCompat = components
      .filter((c: any) => c.itemType === "product")
      .map((c: any) => ({
        id: c.id, productId: c.productId, productName: c.productName,
        quantity: c.quantity, unitId: c.unitId, unitName: c.unitName,
        wastageRate: c.wastageRate, unitCost: c.unitCost, totalCost: c.totalCost,
      }));

    return {
      ...recipe, productName, sellingPrice, yieldUnitName: unit?.abbreviation ?? "",
      yield: parseFloat(recipe.yield as string),
      theoreticalCost,
      cachedTotalCost: recipe.totalCost ? parseFloat(recipe.totalCost as string) : null,
      cachedCostPerUnit: recipe.costPerUnit ? parseFloat(recipe.costPerUnit as string) : null,
      lastCostUpdate: recipe.lastCostUpdate?.toISOString() ?? null,
      components, ingredients: ingredientsCompat,
    };
  }

  const legacyRows = await db.select({
    ri: recipeIngredientsTable, productName: productsTable.name,
    costPrice: productsTable.costPrice, unitName: unitsTable.abbreviation
  }).from(recipeIngredientsTable)
    .leftJoin(productsTable, eq(recipeIngredientsTable.productId, productsTable.id))
    .leftJoin(unitsTable, eq(recipeIngredientsTable.unitId, unitsTable.id))
    .where(eq(recipeIngredientsTable.recipeId, recipe.id));

  const ingredients = legacyRows.map(i => {
    const qty = parseFloat(i.ri.quantity as string);
    const wastage = parseFloat(i.ri.wastageRate as string) / 100;
    const cost = parseFloat(i.costPrice as string ?? "0");
    const totalCost = qty * (1 + wastage) * cost;
    theoreticalCost += totalCost;
    return {
      id: i.ri.id, productId: i.ri.productId, productName: i.productName ?? "",
      quantity: qty, unitId: i.ri.unitId, unitName: i.unitName ?? "",
      wastageRate: parseFloat(i.ri.wastageRate as string), unitCost: cost, totalCost
    };
  });

  components = ingredients.map(i => ({ ...i, itemType: "product", itemId: i.productId, itemName: i.productName }));

  return {
    ...recipe, productName, sellingPrice, yieldUnitName: unit?.abbreviation ?? "",
    yield: parseFloat(recipe.yield as string),
    theoreticalCost,
    cachedTotalCost: recipe.totalCost ? parseFloat(recipe.totalCost as string) : null,
    cachedCostPerUnit: recipe.costPerUnit ? parseFloat(recipe.costPerUnit as string) : null,
    lastCostUpdate: recipe.lastCostUpdate?.toISOString() ?? null,
    components, ingredients,
  };
}

/**
 * Detect if a component (recipe or product chain) would create a circular reference.
 * Returns true if recipeId appears in the ancestor chain being built.
 */
async function wouldCreateCycle(
  recipeId: number,
  components: Array<{ itemType: string; itemId: number }>,
  visited: Set<number> = new Set()
): Promise<boolean> {
  if (visited.has(recipeId)) return true;
  const next = new Set(visited);
  next.add(recipeId);

  for (const c of components) {
    if (c.itemType !== "recipe") continue;
    if (next.has(c.itemId)) return true;
    // Recurse into existing sub-recipe
    const subItems = await db.select().from(recipeItemsTable).where(eq(recipeItemsTable.recipeId, c.itemId));
    const subComponents = subItems.map(i => ({ itemType: i.itemType, itemId: i.itemId }));
    if (await wouldCreateCycle(c.itemId, subComponents, next)) return true;
  }
  return false;
}

router.get("/recipes/assignable-users", requireAuth, requirePermission(P.recipes.view), async (_req, res): Promise<void> => {
  const users = await db
    .select({ id: usersTable.id, name: usersTable.name, username: usersTable.username })
    .from(usersTable)
    .where(eq(usersTable.status, "active"))
    .orderBy(usersTable.name);
  res.json(users);
});

router.get("/recipes", requireAuth, requirePermission(P.recipes.view), async (req, res): Promise<void> => {
  const { type, search } = req.query as Record<string, string>;
  let recipes = await db.select().from(recipesTable).orderBy(recipesTable.name);
  if (type) recipes = recipes.filter(r => r.type === type);
  if (search) recipes = recipes.filter(r => r.name.toLowerCase().includes(search.toLowerCase()));
  const result = await Promise.all(recipes.map(buildRecipeResponse));
  res.json(result);
});

router.get("/recipes/:id/cost", requireAuth, requirePermission(P.recipes.view), async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const quantity = req.query.quantity ? parseFloat(req.query.quantity as string) : null;
  const wastePercentage = req.query.waste ? parseFloat(req.query.waste as string) : 0;
  const forceRefresh = req.query.refresh === "true";

  const [recipe] = await db.select().from(recipesTable).where(eq(recipesTable.id, id));
  if (!recipe) { res.status(404).json({ error: "Recette introuvable" }); return; }

  const qty = quantity ?? parseFloat(recipe.yield as string);
  try {
    const breakdown = await calculateRecipeCostBreakdown(id, qty, wastePercentage, forceRefresh);
    res.json(breakdown);
  } catch (err: any) {
    res.status(400).json({ error: err.message ?? "Erreur calcul coût" });
  }
});

router.post("/recipes", requireAuth, requirePermission(P.recipes.create), async (req, res): Promise<void> => {
  const { name, productId, type, yield: yieldQty, yieldUnitId, steps, notes, assignedUserId, ingredients, components } = req.body;
  if (!name || !type || !yieldQty || !yieldUnitId) {
    res.status(400).json({ error: "Champs requis manquants" }); return;
  }

  // ── GUARD: yield must be positive ─────────────────────────────────────────
  const yieldNum = parseFloat(String(yieldQty));
  if (!isFinite(yieldNum) || yieldNum <= 0) {
    res.status(400).json({ error: "Le rendement doit être un nombre positif" }); return;
  }

  const [recipe] = await db.insert(recipesTable).values({
    name, productId, type, yield: yieldNum.toString(), yieldUnitId, steps, notes,
    assignedUserId: assignedUserId ?? null,
  }).returning();

  if (components?.length) {
    // ── GUARD: cycle detection on creation ──────────────────────────────────
    const hasCycle = await wouldCreateCycle(recipe.id, components);
    if (hasCycle) {
      await db.delete(recipesTable).where(eq(recipesTable.id, recipe.id));
      res.status(400).json({ error: "Référence circulaire détectée dans les composants", code: "CIRCULAR_REFERENCE" }); return;
    }
    for (const c of components) {
      await db.insert(recipeItemsTable).values({
        recipeId: recipe.id, itemType: c.itemType ?? "product",
        itemId: c.itemId ?? c.productId,
        quantity: c.quantity.toString(), unitId: c.unitId,
        wastageRate: (c.wastageRate ?? 0).toString()
      });
    }
  } else if (ingredients?.length) {
    for (const ing of ingredients) {
      await db.insert(recipeIngredientsTable).values({
        recipeId: recipe.id, productId: ing.productId,
        quantity: ing.quantity.toString(), unitId: ing.unitId,
        wastageRate: (ing.wastageRate ?? 0).toString()
      });
    }
  }

  invalidateRecipeCostCache(recipe.id);
  res.status(201).json(await buildRecipeResponse(recipe));
});

router.get("/recipes/:id", requireAuth, requirePermission(P.recipes.view), async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [recipe] = await db.select().from(recipesTable).where(eq(recipesTable.id, id));
  if (!recipe) { res.status(404).json({ error: "Recette introuvable" }); return; }
  res.json(await buildRecipeResponse(recipe));
});

router.patch("/recipes/:id", requireAuth, requirePermission(P.recipes.edit), async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);

  const [existing] = await db.select().from(recipesTable).where(eq(recipesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Recette introuvable" }); return; }

  const { name, yield: yieldQty, steps, notes, assignedUserId, ingredients, components } = req.body;

  const updates: Record<string, unknown> = {};
  if (name != null) updates.name = name;
  if (yieldQty != null) {
    const yieldNum = parseFloat(String(yieldQty));
    if (!isFinite(yieldNum) || yieldNum <= 0) {
      res.status(400).json({ error: "Le rendement doit être un nombre positif" }); return;
    }
    updates.yield = yieldNum.toString();
  }
  if (steps != null) updates.steps = steps;
  if (notes != null) updates.notes = notes;
  if ("assignedUserId" in req.body) updates.assignedUserId = assignedUserId ?? null;

  // ── FIX: always set updatedAt so db.update() has at least one field ───────
  updates.updatedAt = new Date();

  const [recipe] = await db.update(recipesTable).set(updates as any).where(eq(recipesTable.id, id)).returning();
  if (!recipe) { res.status(404).json({ error: "Recette introuvable" }); return; }

  if (components != null) {
    // ── GUARD: cycle detection ───────────────────────────────────────────────
    const hasCycle = await wouldCreateCycle(id, components);
    if (hasCycle) {
      res.status(400).json({ error: "Référence circulaire détectée dans les composants", code: "CIRCULAR_REFERENCE" }); return;
    }

    await db.delete(recipeItemsTable).where(eq(recipeItemsTable.recipeId, id));
    for (const c of components) {
      if (!c.itemId && !c.productId) continue; // skip malformed entries
      await db.insert(recipeItemsTable).values({
        recipeId: id, itemType: c.itemType ?? "product",
        itemId: c.itemId ?? c.productId,
        quantity: String(c.quantity ?? 0), unitId: c.unitId,
        wastageRate: String(c.wastageRate ?? 0)
      });
    }
  } else if (ingredients != null) {
    await db.delete(recipeIngredientsTable).where(eq(recipeIngredientsTable.recipeId, id));
    for (const ing of ingredients) {
      if (!ing.productId) continue;
      await db.insert(recipeIngredientsTable).values({
        recipeId: id, productId: ing.productId,
        quantity: String(ing.quantity ?? 0), unitId: ing.unitId,
        wastageRate: String(ing.wastageRate ?? 0)
      });
    }
  }

  invalidateRecipeCostCache(id);
  res.json(await buildRecipeResponse(recipe));
});

export default router;
