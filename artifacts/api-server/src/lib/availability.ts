import { db, recipesTable, productsTable, stockLevelsTable, unitsTable, branchesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { calculateRecipeExplosion } from "./bom";

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

  const explosion = await calculateRecipeExplosion(recipeId, plannedQuantity);
  const rows: IngredientAvailabilityRow[] = [];

  for (const mat of explosion.materials) {
    const [stockRow] = await db
      .select()
      .from(stockLevelsTable)
      .where(and(eq(stockLevelsTable.productId, mat.productId), eq(stockLevelsTable.branchId, branchId)));

    const availableQty = stockRow ? parseFloat(stockRow.quantity as string) : 0;
    const shortageQty = Math.max(0, mat.quantity - availableQty);
    const status: "ok" | "short" | "missing" =
      availableQty === 0 && mat.quantity > 0 ? "missing" : shortageQty > 0 ? "short" : "ok";

    rows.push({
      ingredientProductId: mat.productId,
      ingredientName: mat.productName,
      unitAbbreviation: mat.unitAbbreviation,
      requiredQty: mat.quantity,
      availableQty: Math.round(availableQty * 1000) / 1000,
      shortageQty: Math.round(shortageQty * 1000) / 1000,
      wastageRate: 0,
      status,
    });
  }

  const anyMissing = rows.some(r => r.status === "missing");
  const anyShort = rows.some(r => r.status === "short");
  const overallStatus: "available" | "partial" | "unavailable" =
    rows.length === 0
      ? "unavailable"
      : anyMissing && rows.every(r => r.status === "missing")
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
