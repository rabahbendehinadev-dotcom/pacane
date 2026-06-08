import { db, recipesTable, recipeIngredientsTable, recipeItemsTable, productsTable, unitsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface BomMaterial {
  productId: number;
  productName: string;
  quantity: number;
  unitId: number;
  unitAbbreviation: string;
  costPrice: number;
  totalCost: number;
}

export interface BomLeaf {
  type: "product";
  productId: number;
  productName: string;
  quantity: number;
  unitAbbreviation: string;
  wastageRate: number;
}

export interface BomNode {
  type: "recipe";
  recipeId: number;
  recipeName: string;
  quantity: number;
  scaleFactor: number;
  children: Array<BomNode | BomLeaf>;
}

export interface BomExplosionResult {
  materials: BomMaterial[];
  tree: BomNode;
  totalCost: number;
}

export async function calculateRecipeExplosion(
  recipeId: number,
  quantity: number,
  visited: Set<number> = new Set()
): Promise<BomExplosionResult> {
  if (visited.has(recipeId)) {
    throw new Error(`Référence circulaire détectée: recette ID ${recipeId}`);
  }

  const [recipe] = await db.select().from(recipesTable).where(eq(recipesTable.id, recipeId));
  if (!recipe) throw new Error(`Recette introuvable: ID ${recipeId}`);

  const recipeYield = parseFloat(recipe.yield as string) || 1;
  const scaleFactor = quantity / recipeYield;
  const newVisited = new Set(visited);
  newVisited.add(recipeId);

  const aggregated = new Map<number, BomMaterial>();
  const treeChildren: Array<BomNode | BomLeaf> = [];

  const items = await db.select().from(recipeItemsTable).where(eq(recipeItemsTable.recipeId, recipeId));

  if (items.length > 0) {
    for (const item of items) {
      const scaledQty = parseFloat(item.quantity as string) * scaleFactor;
      const wastageRate = parseFloat(item.wastageRate as string);
      const wastageMultiplier = 1 + wastageRate / 100;

      if (item.itemType === "recipe") {
        const subResult = await calculateRecipeExplosion(item.itemId, scaledQty, newVisited);
        treeChildren.push(subResult.tree);
        for (const mat of subResult.materials) {
          const existing = aggregated.get(mat.productId);
          if (existing) {
            existing.quantity = round3(existing.quantity + mat.quantity);
            existing.totalCost = round2(existing.totalCost + mat.totalCost);
          } else {
            aggregated.set(mat.productId, { ...mat });
          }
        }
      } else {
        const [product] = await db.select().from(productsTable).where(eq(productsTable.id, item.itemId));
        const [unit] = await db.select().from(unitsTable).where(eq(unitsTable.id, item.unitId));
        const effectiveQty = round3(scaledQty * wastageMultiplier);
        const costPrice = parseFloat(product?.costPrice as string ?? "0");

        treeChildren.push({
          type: "product",
          productId: item.itemId,
          productName: product?.name ?? `Produit #${item.itemId}`,
          quantity: effectiveQty,
          unitAbbreviation: unit?.abbreviation ?? "u",
          wastageRate,
        });

        const existing = aggregated.get(item.itemId);
        if (existing) {
          existing.quantity = round3(existing.quantity + effectiveQty);
          existing.totalCost = round2(existing.totalCost + effectiveQty * costPrice);
        } else {
          aggregated.set(item.itemId, {
            productId: item.itemId,
            productName: product?.name ?? `Produit #${item.itemId}`,
            quantity: effectiveQty,
            unitId: item.unitId,
            unitAbbreviation: unit?.abbreviation ?? "u",
            costPrice,
            totalCost: round2(effectiveQty * costPrice),
          });
        }
      }
    }
  } else {
    const legacyRows = await db
      .select({ ri: recipeIngredientsTable, product: productsTable, unit: unitsTable })
      .from(recipeIngredientsTable)
      .leftJoin(productsTable, eq(recipeIngredientsTable.productId, productsTable.id))
      .leftJoin(unitsTable, eq(recipeIngredientsTable.unitId, unitsTable.id))
      .where(eq(recipeIngredientsTable.recipeId, recipeId));

    for (const row of legacyRows) {
      const baseQty = parseFloat(row.ri.quantity as string);
      const wastageRate = parseFloat(row.ri.wastageRate as string);
      const effectiveQty = round3(baseQty * scaleFactor * (1 + wastageRate / 100));
      const costPrice = parseFloat(row.product?.costPrice as string ?? "0");

      treeChildren.push({
        type: "product",
        productId: row.ri.productId,
        productName: row.product?.name ?? `Produit #${row.ri.productId}`,
        quantity: effectiveQty,
        unitAbbreviation: row.unit?.abbreviation ?? "u",
        wastageRate,
      });

      const existing = aggregated.get(row.ri.productId);
      if (existing) {
        existing.quantity = round3(existing.quantity + effectiveQty);
        existing.totalCost = round2(existing.totalCost + effectiveQty * costPrice);
      } else {
        aggregated.set(row.ri.productId, {
          productId: row.ri.productId,
          productName: row.product?.name ?? `Produit #${row.ri.productId}`,
          quantity: effectiveQty,
          unitId: row.ri.unitId,
          unitAbbreviation: row.unit?.abbreviation ?? "u",
          costPrice,
          totalCost: round2(effectiveQty * costPrice),
        });
      }
    }
  }

  const materials = Array.from(aggregated.values());
  const totalCost = round2(materials.reduce((s, m) => s + m.totalCost, 0));

  return {
    materials,
    tree: {
      type: "recipe",
      recipeId,
      recipeName: recipe.name,
      quantity,
      scaleFactor: round3(scaleFactor),
      children: treeChildren,
    },
    totalCost,
  };
}

function round3(n: number) { return Math.round(n * 1000) / 1000; }
function round2(n: number) { return Math.round(n * 100) / 100; }
