import { Router, type IRouter } from "express";
import { db, recipesTable, recipeIngredientsTable, productsTable, unitsTable } from "@workspace/db";
import { eq, and, ilike, or, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, assertBranchAccess, visibleBranchIds } from "../middlewares/permissions";
import { P } from "../lib/permissions";

const router: IRouter = Router();

async function buildRecipeResponse(recipe: typeof recipesTable.$inferSelect) {
  const [unit] = await db.select().from(unitsTable).where(eq(unitsTable.id, recipe.yieldUnitId));
  let productName: string | null = null;
  if (recipe.productId) {
    const [p] = await db.select().from(productsTable).where(eq(productsTable.id, recipe.productId));
    productName = p?.name ?? null;
  }
  const ingredients = await db.select({
    ri: recipeIngredientsTable,
    productName: productsTable.name,
    costPrice: productsTable.costPrice,
    unitName: unitsTable.abbreviation
  }).from(recipeIngredientsTable)
    .leftJoin(productsTable, eq(recipeIngredientsTable.productId, productsTable.id))
    .leftJoin(unitsTable, eq(recipeIngredientsTable.unitId, unitsTable.id))
    .where(eq(recipeIngredientsTable.recipeId, recipe.id));

  let theoreticalCost = 0;
  const mappedIngredients = ingredients.map(i => {
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

  return {
    ...recipe, productName, yieldUnitName: unit?.abbreviation ?? "",
    yield: parseFloat(recipe.yield as string), theoreticalCost, ingredients: mappedIngredients
  };
}

router.get("/recipes", requireAuth, requirePermission(P.recipes.view), async (req, res): Promise<void> => {
  const { type, search } = req.query as Record<string, string>;
  let recipes = await db.select().from(recipesTable).orderBy(recipesTable.name);
  if (type) recipes = recipes.filter(r => r.type === type);
  if (search) recipes = recipes.filter(r => r.name.toLowerCase().includes(search.toLowerCase()));
  const result = await Promise.all(recipes.map(buildRecipeResponse));
  res.json(result);
});

router.post("/recipes", requireAuth, requirePermission(P.recipes.create), async (req, res): Promise<void> => {
  const { name, productId, type, yield: yieldQty, yieldUnitId, steps, notes, ingredients } = req.body;
  if (!name || !type || !yieldQty || !yieldUnitId) { res.status(400).json({ error: "Champs requis manquants" }); return; }
  const [recipe] = await db.insert(recipesTable).values({ name, productId, type, yield: yieldQty.toString(), yieldUnitId, steps, notes }).returning();
  if (ingredients?.length) {
    for (const ing of ingredients) {
      await db.insert(recipeIngredientsTable).values({
        recipeId: recipe.id, productId: ing.productId, quantity: ing.quantity.toString(),
        unitId: ing.unitId, wastageRate: (ing.wastageRate ?? 0).toString()
      });
    }
  }
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
  const { name, yield: yieldQty, steps, notes, ingredients } = req.body;
  const updates: Record<string, unknown> = {};
  if (name != null) updates.name = name;
  if (yieldQty != null) updates.yield = yieldQty.toString();
  if (steps != null) updates.steps = steps;
  if (notes != null) updates.notes = notes;
  const [recipe] = await db.update(recipesTable).set(updates as any).where(eq(recipesTable.id, id)).returning();
  if (!recipe) { res.status(404).json({ error: "Recette introuvable" }); return; }
  if (ingredients) {
    await db.delete(recipeIngredientsTable).where(eq(recipeIngredientsTable.recipeId, id));
    for (const ing of ingredients) {
      await db.insert(recipeIngredientsTable).values({
        recipeId: id, productId: ing.productId, quantity: ing.quantity.toString(),
        unitId: ing.unitId, wastageRate: (ing.wastageRate ?? 0).toString()
      });
    }
  }
  res.json(await buildRecipeResponse(recipe));
});

export default router;
