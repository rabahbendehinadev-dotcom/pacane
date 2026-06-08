import { db, recipesTable, recipeIngredientsTable, recipeItemsTable, productsTable, unitsTable, stockMovementsTable, purchaseItemsTable } from "@workspace/db";
import { eq, and, gt, desc, sql } from "drizzle-orm";
import type { BomNode, BomLeaf } from "./bom";
import { calculateRecipeExplosion } from "./bom";

export interface CostLine {
  itemType: "product" | "recipe";
  itemId: number;
  itemName: string;
  quantity: number;
  unitAbbreviation: string;
  unitCostPrice: number;
  totalCost: number;
  wastageRate: number;
  nestingLevel: number;
  hasMissingCost: boolean;
}

export interface RecipeCostBreakdown {
  recipeId: number;
  recipeName: string;
  quantity: number;
  lines: CostLine[];
  totalCost: number;
  costPerUnit: number;
  sellingPrice: number | null;
  profitPerUnit: number | null;
  marginPct: number | null;
  marginLevel: "green" | "orange" | "red" | null;
  warnings: string[];
  wasteAdjustedCost: number;
  wasteCost: number;
}

const wacCache = new Map<number, { cost: number; ts: number }>();
const WAC_TTL_MS = 5 * 60 * 1000;

export async function getWeightedAverageCost(productId: number): Promise<{ cost: number; source: "wac" | "purchase" | "product" | "none"; warn: boolean }> {
  const cached = wacCache.get(productId);
  if (cached && Date.now() - cached.ts < WAC_TTL_MS) {
    return { cost: cached.cost, source: "wac", warn: false };
  }

  // Try WAC from stock movements (purchase type)
  const [wacRow] = await db
    .select({
      wac: sql<string>`CASE WHEN SUM(CASE WHEN quantity > 0 THEN quantity ELSE 0 END) > 0
        THEN SUM(CASE WHEN quantity > 0 THEN quantity * unit_cost ELSE 0 END) / SUM(CASE WHEN quantity > 0 THEN quantity ELSE 0 END)
        ELSE 0 END`
    })
    .from(stockMovementsTable)
    .where(and(eq(stockMovementsTable.productId, productId), eq(stockMovementsTable.type, "purchase"), gt(stockMovementsTable.unitCost, "0")));

  const wacVal = wacRow ? parseFloat(wacRow.wac as string) : 0;
  if (wacVal > 0) {
    wacCache.set(productId, { cost: wacVal, ts: Date.now() });
    return { cost: wacVal, source: "wac", warn: false };
  }

  // Try last purchase price
  const [lastPurchase] = await db
    .select({ unitCost: purchaseItemsTable.unitCost })
    .from(purchaseItemsTable)
    .where(eq(purchaseItemsTable.productId, productId))
    .orderBy(desc(purchaseItemsTable.createdAt))
    .limit(1);

  if (lastPurchase && parseFloat(lastPurchase.unitCost as string) > 0) {
    const cost = parseFloat(lastPurchase.unitCost as string);
    wacCache.set(productId, { cost, ts: Date.now() });
    return { cost, source: "purchase", warn: false };
  }

  // Fall back to product costPrice
  const [product] = await db.select({ costPrice: productsTable.costPrice }).from(productsTable).where(eq(productsTable.id, productId));
  const fallback = parseFloat(product?.costPrice as string ?? "0");
  if (fallback > 0) {
    return { cost: fallback, source: "product", warn: false };
  }

  return { cost: 0, source: "none", warn: true };
}

export function invalidateWacCache(productId?: number) {
  if (productId) wacCache.delete(productId);
  else wacCache.clear();
}

const recipeCostCache = new Map<string, { result: RecipeCostBreakdown; ts: number }>();
const RECIPE_COST_TTL_MS = 2 * 60 * 1000;

export async function calculateRecipeCostBreakdown(
  recipeId: number,
  quantity: number,
  wastePercentage = 0,
  forceRefresh = false
): Promise<RecipeCostBreakdown> {
  const cacheKey = `${recipeId}:${quantity}:${wastePercentage}`;
  if (!forceRefresh) {
    const cached = recipeCostCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < RECIPE_COST_TTL_MS) return cached.result;
  }

  const explosion = await calculateRecipeExplosion(recipeId, quantity);
  const warnings: string[] = [];
  const lines: CostLine[] = [];

  for (const mat of explosion.materials) {
    const { cost: wac, source, warn } = await getWeightedAverageCost(mat.productId);
    if (warn) warnings.push(`Pas de prix d'achat pour: ${mat.productName}`);
    const totalCost = r2(mat.quantity * wac);
    lines.push({
      itemType: "product",
      itemId: mat.productId,
      itemName: mat.productName,
      quantity: mat.quantity,
      unitAbbreviation: mat.unitAbbreviation,
      unitCostPrice: wac,
      totalCost,
      wastageRate: 0,
      nestingLevel: 0,
      hasMissingCost: warn || source === "none",
    });
  }

  const baseCost = r2(lines.reduce((s, l) => s + l.totalCost, 0));
  const wasteCost = r2(baseCost * (wastePercentage / 100));
  const totalCost = r2(baseCost + wasteCost);
  const recipeYield = parseFloat((explosion.tree as BomNode).quantity?.toString() ?? "1") || 1;
  const costPerUnit = r4(totalCost / recipeYield);

  // Profitability
  const [recipe] = await db
    .select({ name: recipesTable.name, productId: recipesTable.productId, yield: recipesTable.yield })
    .from(recipesTable).where(eq(recipesTable.id, recipeId));

  let sellingPrice: number | null = null;
  let profitPerUnit: number | null = null;
  let marginPct: number | null = null;
  let marginLevel: "green" | "orange" | "red" | null = null;

  if (recipe?.productId) {
    const [product] = await db.select({ sellingPrice: productsTable.sellingPrice }).from(productsTable).where(eq(productsTable.id, recipe.productId));
    const sp = parseFloat(product?.sellingPrice as string ?? "0");
    if (sp > 0) {
      sellingPrice = sp;
      profitPerUnit = r2(sp - costPerUnit);
      marginPct = r2((profitPerUnit / sp) * 100);
      marginLevel = marginPct >= 30 ? "green" : marginPct >= 10 ? "orange" : "red";
    }
  }

  const result: RecipeCostBreakdown = {
    recipeId,
    recipeName: recipe?.name ?? `Recette #${recipeId}`,
    quantity,
    lines,
    totalCost,
    costPerUnit,
    sellingPrice,
    profitPerUnit,
    marginPct,
    marginLevel,
    warnings,
    wasteAdjustedCost: totalCost,
    wasteCost,
  };

  recipeCostCache.set(cacheKey, { result, ts: Date.now() });

  // Persist cached cost into recipes table
  db.update(recipesTable).set({
    totalCost: totalCost.toString(),
    costPerUnit: costPerUnit.toString(),
    lastCostUpdate: new Date(),
  }).where(eq(recipesTable.id, recipeId)).execute().catch(() => {});

  return result;
}

export function invalidateRecipeCostCache(recipeId?: number) {
  if (recipeId) {
    for (const key of recipeCostCache.keys()) {
      if (key.startsWith(`${recipeId}:`)) recipeCostCache.delete(key);
    }
  } else {
    recipeCostCache.clear();
  }
}

function r2(n: number) { return Math.round(n * 100) / 100; }
function r4(n: number) { return Math.round(n * 10000) / 10000; }

export async function flattenBomForOrderItems(
  tree: BomNode | BomLeaf,
  level = 0
): Promise<Array<{ itemType: string; itemId: number; itemName: string; quantity: number; unitAbbreviation: string; unitCostPrice: number; totalCost: number; wastageRate: number; nestingLevel: number }>> {
  const rows: Array<{ itemType: string; itemId: number; itemName: string; quantity: number; unitAbbreviation: string; unitCostPrice: number; totalCost: number; wastageRate: number; nestingLevel: number }> = [];

  if (tree.type === "product") {
    const { cost: wac } = await getWeightedAverageCost(tree.productId);
    rows.push({
      itemType: "product",
      itemId: tree.productId,
      itemName: tree.productName,
      quantity: tree.quantity,
      unitAbbreviation: tree.unitAbbreviation,
      unitCostPrice: wac,
      totalCost: r2(tree.quantity * wac),
      wastageRate: tree.wastageRate,
      nestingLevel: level,
    });
    return rows;
  }

  rows.push({
    itemType: "recipe",
    itemId: tree.recipeId,
    itemName: tree.recipeName,
    quantity: tree.quantity,
    unitAbbreviation: "batch",
    unitCostPrice: 0,
    totalCost: 0,
    wastageRate: 0,
    nestingLevel: level,
  });

  for (const child of tree.children) {
    const childRows = await flattenBomForOrderItems(child, level + 1);
    rows.push(...childRows);
  }

  return rows;
}
