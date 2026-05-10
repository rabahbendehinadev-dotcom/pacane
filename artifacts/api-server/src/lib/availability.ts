import { db, recipesTable, recipeIngredientsTable, productsTable, stockLevelsTable, unitsTable, branchesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export type IngredientAvailabilityRow = {
  ingredientProductId: number;
  ingredientName: string;
  unitAbbreviation: string;
  requiredQty: number;
  availableQty: number;
  shortageQty: number;
  wastageRate: number;
  status: "ok" | "short" | "missing";
};

export type AvailabilityResult = {
  recipeId: number;
  recipeName: string;
  recipeYield: number;
  plannedQuantity: number;
  branchId: number;
  branchName: string;
  scaleFactor: number;
  rows: IngredientAvailabilityRow[];
  overallStatus: "available" | "partial" | "unavailable";
  canLaunch: boolean;
};

export async function checkIngredientAvailability(
  recipeId: number,
  plannedQuantity: number,
  branchId: number
): Promise<AvailabilityResult> {
  const [recipe] = await db.select().from(recipesTable).where(eq(recipesTable.id, recipeId));
  if (!recipe) throw new Error("Recette introuvable");

  const [branch] = await db.select().from(branchesTable).where(eq(branchesTable.id, branchId));

  const recipeYield = parseFloat(recipe.yield as string);
  const scaleFactor = plannedQuantity / recipeYield;

  const ingredients = await db
    .select({
      ri: recipeIngredientsTable,
      product: productsTable,
      unit: unitsTable,
    })
    .from(recipeIngredientsTable)
    .leftJoin(productsTable, eq(recipeIngredientsTable.productId, productsTable.id))
    .leftJoin(unitsTable, eq(recipeIngredientsTable.unitId, unitsTable.id))
    .where(eq(recipeIngredientsTable.recipeId, recipeId));

  const rows: IngredientAvailabilityRow[] = [];

  for (const i of ingredients) {
    const baseQty = parseFloat(i.ri.quantity as string);
    const wastageRate = parseFloat(i.ri.wastageRate as string);
    const requiredQty = baseQty * scaleFactor * (1 + wastageRate / 100);

    const [stockRow] = await db
      .select()
      .from(stockLevelsTable)
      .where(
        and(
          eq(stockLevelsTable.productId, i.ri.productId),
          eq(stockLevelsTable.branchId, branchId)
        )
      );

    const availableQty = stockRow ? parseFloat(stockRow.quantity as string) : 0;
    const shortageQty = Math.max(0, requiredQty - availableQty);
    const status: "ok" | "short" | "missing" =
      availableQty === 0 && requiredQty > 0
        ? "missing"
        : shortageQty > 0
        ? "short"
        : "ok";

    rows.push({
      ingredientProductId: i.ri.productId,
      ingredientName: i.product?.name ?? `Produit #${i.ri.productId}`,
      unitAbbreviation: i.unit?.abbreviation ?? "u",
      requiredQty: Math.round(requiredQty * 1000) / 1000,
      availableQty: Math.round(availableQty * 1000) / 1000,
      shortageQty: Math.round(shortageQty * 1000) / 1000,
      wastageRate,
      status,
    });
  }

  const anyMissing = rows.some(r => r.status === "missing");
  const anyShort = rows.some(r => r.status === "short");
  const overallStatus: "available" | "partial" | "unavailable" =
    anyMissing && rows.every(r => r.status === "missing")
      ? "unavailable"
      : anyMissing || anyShort
      ? "partial"
      : "available";

  return {
    recipeId,
    recipeName: recipe.name,
    recipeYield,
    plannedQuantity,
    branchId,
    branchName: branch?.name ?? `Succursale #${branchId}`,
    scaleFactor: Math.round(scaleFactor * 1000) / 1000,
    rows,
    overallStatus,
    canLaunch: overallStatus === "available",
  };
}

export function canOverrideProduction(roleId: number | undefined | null): boolean {
  return roleId === 1 || roleId === 2;
}
