import { Router, type IRouter } from "express";
import { db, categoriesTable, unitsTable, productsTable, stockLevelsTable, workersTable } from "@workspace/db";
import { eq, and, ilike, sql, like, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, assertBranchAccess, visibleBranchIds } from "../middlewares/permissions";
import { P } from "../lib/permissions";

const router: IRouter = Router();

// CATEGORIES
router.get("/categories", requireAuth, async (_req, res): Promise<void> => {
  const cats = await db.select().from(categoriesTable).orderBy(categoriesTable.name);
  const products = await db.select({ categoryId: productsTable.categoryId }).from(productsTable);
  const countMap: Record<number, number> = {};
  for (const p of products) { if (p.categoryId) countMap[p.categoryId] = (countMap[p.categoryId] ?? 0) + 1; }
  const withParent = cats.map(c => ({
    ...c,
    parentName: c.parentId ? cats.find(p => p.id === c.parentId)?.name ?? null : null,
    productCount: countMap[c.id] ?? 0
  }));
  res.json(withParent);
});

router.post("/categories", requireAuth, requirePermission(P.products.create), async (req, res): Promise<void> => {
  const { name, parentId } = req.body;
  if (!name) { res.status(400).json({ error: "Nom requis" }); return; }
  const [cat] = await db.insert(categoriesTable).values({ name, parentId }).returning();
  res.status(201).json({ ...cat, parentName: null, productCount: 0 });
});

router.patch("/categories/:id", requireAuth, requirePermission(P.products.edit), async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { name, parentId } = req.body;
  const updates: Record<string, unknown> = {};
  if (name != null) updates.name = name;
  if (parentId !== undefined) updates.parentId = parentId;
  const [cat] = await db.update(categoriesTable).set(updates as any).where(eq(categoriesTable.id, id)).returning();
  if (!cat) { res.status(404).json({ error: "Catégorie introuvable" }); return; }
  res.json({ ...cat, parentName: null, productCount: 0 });
});

router.delete("/categories/:id", requireAuth, requirePermission(P.products.delete), async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [cat] = await db.select().from(categoriesTable).where(eq(categoriesTable.id, id));
  if (!cat) { res.status(404).json({ error: "Catégorie introuvable" }); return; }
  const children = await db.select({ id: categoriesTable.id }).from(categoriesTable).where(eq(categoriesTable.parentId, id));
  if (children.length > 0) { res.status(400).json({ error: "Impossible de supprimer une catégorie parente (elle a des sous-catégories)" }); return; }
  const products = await db.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.categoryId, id));
  if (products.length > 0) { res.status(400).json({ error: `Impossible de supprimer : ${products.length} produit(s) utilisent cette catégorie` }); return; }
  await db.delete(categoriesTable).where(eq(categoriesTable.id, id));
  res.json({ success: true });
});

// UNITS
router.get("/units", requireAuth, async (_req, res): Promise<void> => {
  const units = await db.select().from(unitsTable).orderBy(unitsTable.name);
  res.json(units);
});

router.post("/units", requireAuth, requirePermission(P.products.create), async (req, res): Promise<void> => {
  const { name, abbreviation, allowDecimals } = req.body;
  if (!name || !abbreviation) { res.status(400).json({ error: "Champs requis manquants" }); return; }
  const [unit] = await db.insert(unitsTable).values({ name, abbreviation, allowDecimals: allowDecimals ?? true }).returning();
  res.status(201).json(unit);
});

// PRODUCTS
router.get("/products", requireAuth, async (req, res): Promise<void> => {
  const { type, categoryId, search } = req.query as Record<string, string>;
  const rows = await db.select({
    p: productsTable,
    unitName: unitsTable.abbreviation,
    totalStock: sql<string>`COALESCE((SELECT SUM(sl.quantity) FROM stock_levels sl WHERE sl.product_id = ${productsTable.id}), 0)`,
    catName: categoriesTable.name,
    workerName: workersTable.name,
  }).from(productsTable)
    .leftJoin(unitsTable, eq(productsTable.unitId, unitsTable.id))
    .leftJoin(categoriesTable, eq(productsTable.categoryId, categoriesTable.id))
    .leftJoin(workersTable, eq(productsTable.workerId, workersTable.id))
    .orderBy(productsTable.name);

  let products = rows.map(r => ({
    ...r.p,
    unitName: r.unitName ?? "",
    categoryName: r.catName ?? null,
    workerName: r.workerName ?? null,
    totalStock: parseFloat(r.totalStock),
    costPrice: parseFloat(r.p.costPrice as string),
    sellingPrice: parseFloat(r.p.sellingPrice as string),
    alertQuantity: r.p.alertQuantity ? parseFloat(r.p.alertQuantity as string) : null
  }));
  if (type) products = products.filter(p => p.type === type);
  if (categoryId) products = products.filter(p => p.categoryId === parseInt(categoryId, 10));
  if (search) products = products.filter(p => p.name.toLowerCase().includes(search.toLowerCase()) || (p.sku ?? "").toLowerCase().includes(search.toLowerCase()));
  res.json(products);
});

async function resolvePieceUnitId(): Promise<number | null> {
  const allUnits = await db.select().from(unitsTable);
  const pcs = allUnits.find(u => !u.allowDecimals && (u.name.toLowerCase().includes("pièce") || u.abbreviation.toLowerCase() === "pcs"));
  return pcs?.id ?? null;
}

router.post("/products", requireAuth, requirePermission(P.products.create), async (req, res): Promise<void> => {
  let { name, sku, barcode, type, categoryId, unitId, workerId, description, costPrice, sellingPrice, alertQuantity, shelfLifeDays, isManaged, isSellable, isPurchasable, isFabricated, branchIds, imageUrl } = req.body;
  if (!name || !type || !unitId) { res.status(400).json({ error: "Champs requis manquants" }); return; }
  try {
    const [product] = await db.insert(productsTable).values({
      name, sku, barcode, type, categoryId, unitId, workerId: workerId ?? null, description, imageUrl: imageUrl ?? null,
      costPrice: costPrice?.toString() ?? "0", sellingPrice: sellingPrice?.toString() ?? "0",
      alertQuantity: alertQuantity?.toString(), shelfLifeDays, isManaged: isManaged ?? true,
      isSellable: isSellable ?? true, isPurchasable: isPurchasable ?? false, isFabricated: isFabricated ?? false,
      branchIds: Array.isArray(branchIds) ? branchIds : []
    }).returning();
    const [unit] = await db.select().from(unitsTable).where(eq(unitsTable.id, product.unitId));
    let workerName: string | null = null;
    if (product.workerId) {
      const [w] = await db.select().from(workersTable).where(eq(workersTable.id, product.workerId));
      workerName = w?.name ?? null;
    }
    res.status(201).json({ ...product, unitName: unit?.abbreviation ?? "", categoryName: null, workerName, totalStock: 0, costPrice: parseFloat(product.costPrice as string), sellingPrice: parseFloat(product.sellingPrice as string), alertQuantity: product.alertQuantity ? parseFloat(product.alertQuantity as string) : null });
  } catch (err: any) {
    req.log.error({ err }, "Error creating product");
    res.status(500).json({ error: err?.message ?? "Erreur lors de la création du produit" });
  }
});

router.delete("/products/:id", requireAuth, requirePermission(P.products.delete), async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, id));
  if (!product) { res.status(404).json({ error: "Produit introuvable" }); return; }
  // Vérifier le stock — admin peut forcer la suppression même avec stock
  const isAdmin = (req.userPermissions ?? []).includes("*");
  if (!isAdmin) {
    const [stockRow] = await db.select({ total: sql<string>`COALESCE(SUM(quantity), 0)` }).from(stockLevelsTable).where(eq(stockLevelsTable.productId, id));
    const stockTotal = parseFloat(stockRow?.total ?? "0");
    if (stockTotal > 0) {
      res.status(400).json({ error: `Impossible de supprimer : ce produit a encore ${stockTotal} unité(s) en stock` });
      return;
    }
  }
  try {
    if (isAdmin) {
      // Supprimer d'abord les niveaux de stock pour éviter les contraintes FK
      await db.delete(stockLevelsTable).where(eq(stockLevelsTable.productId, id));
    }
    await db.delete(productsTable).where(eq(productsTable.id, id));
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: "Impossible de supprimer : ce produit est utilisé dans des commandes ou mouvements" });
  }
});

router.get("/products/:id", requireAuth, requirePermission(P.products.view), async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [row] = await db.select({ p: productsTable, unitName: unitsTable.abbreviation, catName: categoriesTable.name })
    .from(productsTable)
    .leftJoin(unitsTable, eq(productsTable.unitId, unitsTable.id))
    .leftJoin(categoriesTable, eq(productsTable.categoryId, categoriesTable.id))
    .where(eq(productsTable.id, id));
  if (!row) { res.status(404).json({ error: "Produit introuvable" }); return; }
  const [{ totalStock }] = await db.select({ totalStock: sql<string>`COALESCE(SUM(quantity), 0)` }).from(stockLevelsTable).where(eq(stockLevelsTable.productId, id));
  res.json({ ...row.p, unitName: row.unitName ?? "", categoryName: row.catName ?? null, totalStock: parseFloat(totalStock), costPrice: parseFloat(row.p.costPrice as string), sellingPrice: parseFloat(row.p.sellingPrice as string), alertQuantity: row.p.alertQuantity ? parseFloat(row.p.alertQuantity as string) : null });
});

router.patch("/products/:id", requireAuth, requirePermission(P.products.edit), async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const allowed = ["name", "sku", "barcode", "type", "categoryId", "unitId", "workerId", "description", "costPrice", "sellingPrice", "alertQuantity", "isManaged", "isSellable", "isPurchasable", "isFabricated", "branchIds", "imageUrl"];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      if (req.body[key] === null) { updates[key] = null; }
      else if (["costPrice", "sellingPrice", "alertQuantity"].includes(key)) updates[key] = req.body[key].toString();
      else if (key === "branchIds") updates[key] = Array.isArray(req.body[key]) ? req.body[key] : [];
      else updates[key] = req.body[key];
    }
  }
  try {
    const [product] = await db.update(productsTable).set(updates as any).where(eq(productsTable.id, id)).returning();
    if (!product) { res.status(404).json({ error: "Produit introuvable" }); return; }
    const [unit] = await db.select().from(unitsTable).where(eq(unitsTable.id, product.unitId));
    const [{ totalStock }] = await db.select({ totalStock: sql<string>`COALESCE(SUM(quantity), 0)` }).from(stockLevelsTable).where(eq(stockLevelsTable.productId, id));
    let workerName: string | null = null;
    if (product.workerId) {
      const [w] = await db.select().from(workersTable).where(eq(workersTable.id, product.workerId));
      workerName = w?.name ?? null;
    }
    res.json({ ...product, unitName: unit?.abbreviation ?? "", categoryName: null, workerName, totalStock: parseFloat(totalStock), costPrice: parseFloat(product.costPrice as string), sellingPrice: parseFloat(product.sellingPrice as string), alertQuantity: product.alertQuantity ? parseFloat(product.alertQuantity as string) : null });
  } catch (err: any) {
    req.log.error({ err }, "Error updating product");
    res.status(500).json({ error: err?.message ?? "Erreur lors de la mise à jour du produit" });
  }
});

router.get("/products/:id/stock", requireAuth, requirePermission(P.products.view), async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [product] = await db.select({ p: productsTable, unitName: unitsTable.abbreviation })
    .from(productsTable).leftJoin(unitsTable, eq(productsTable.unitId, unitsTable.id))
    .where(eq(productsTable.id, id));
  if (!product) { res.status(404).json({ error: "Produit introuvable" }); return; }
  const { db: dbImport, branchesTable } = await import("@workspace/db");
  const stockRows = await db.select({ sl: stockLevelsTable, branchName: branchesTable.name })
    .from(stockLevelsTable)
    .leftJoin(branchesTable, eq(stockLevelsTable.branchId, branchesTable.id))
    .where(eq(stockLevelsTable.productId, id));
  const alertQty = product.p.alertQuantity ? parseFloat(product.p.alertQuantity as string) : null;
  const result = stockRows.map(r => {
    const qty = parseFloat(r.sl.quantity as string);
    let status: "ok" | "low" | "critical" | "out" = "ok";
    if (qty === 0) status = "out";
    else if (alertQty && qty <= alertQty * 0.5) status = "critical";
    else if (alertQty && qty <= alertQty) status = "low";
    return {
      productId: id, productName: product.p.name, productType: product.p.type,
      branchId: r.sl.branchId, branchName: r.branchName ?? "",
      quantity: qty, alertQuantity: alertQty, unitName: product.unitName ?? "",
      status, valueCost: qty * parseFloat(product.p.costPrice as string)
    };
  });
  res.json(result);
});

router.patch("/products/bulk-unit", requireAuth, requirePermission(P.products.edit), async (req, res): Promise<void> => {
  const { productIds, unitId } = req.body;
  if (!Array.isArray(productIds) || productIds.length === 0) { res.status(400).json({ error: "Aucun produit sélectionné" }); return; }
  if (!unitId) { res.status(400).json({ error: "Unité requise" }); return; }
  const [unit] = await db.select().from(unitsTable).where(eq(unitsTable.id, parseInt(unitId)));
  if (!unit) { res.status(400).json({ error: "Unité introuvable" }); return; }
  try {
    const updated = await db.update(productsTable).set({ unitId: parseInt(unitId) }).where(inArray(productsTable.id, productIds.map(Number))).returning({ id: productsTable.id });
    res.json({ updatedCount: updated.length, unitName: unit.name });
  } catch (err: any) {
    req.log.error({ err }, "Error bulk updating product units");
    res.status(500).json({ error: err?.message ?? "Erreur lors de la mise à jour" });
  }
});

export default router;
