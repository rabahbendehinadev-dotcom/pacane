import { Router, type IRouter } from "express";
import multer from "multer";
import { db, productsTable, unitsTable, categoriesTable, branchesTable, stockLevelsTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission } from "../middlewares/permissions";
import { P } from "../lib/permissions";

const router: IRouter = Router();
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── CSV Parser ────────────────────────────────────────────────────────────────
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (text[i] === "\r") { i++; continue; }
    if (text[i] === '"') {
      i++;
      let field = "";
      while (i < n) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; }
          else { i++; break; }
        } else { field += text[i++]; }
      }
      row.push(field);
      if (text[i] === ",") i++;
      else if (text[i] === "\n") { rows.push(row); row = []; i++; }
      else if (text[i] === "\r" && text[i + 1] === "\n") { rows.push(row); row = []; i += 2; }
    } else if (text[i] === "\n") {
      rows.push(row); row = []; i++;
    } else {
      let field = "";
      while (i < n && text[i] !== "," && text[i] !== "\n" && text[i] !== "\r") field += text[i++];
      row.push(field);
      if (text[i] === ",") i++;
      else if (text[i] === "\n") { rows.push(row); row = []; i++; }
      else if (text[i] === "\r") { i++; if (text[i] === "\n") i++; rows.push(row); row = []; }
    }
  }
  if (row.length > 0 && row.some(f => f.trim())) rows.push(row);
  return rows;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function parsePrice(s: string): number {
  return parseFloat(s.trim().replace(/\s*DA$/i, "").trim().replace(/\s+/g, "")) || 0;
}

function parseStock(s: string): { qty: number; unitLabel: string } {
  const parts = s.trim().split(/\s+/);
  const last = parts[parts.length - 1];
  if (isNaN(parseFloat(last)) && last.length > 0) {
    const qty = parseFloat(parts.slice(0, -1).join("").replace(/[^0-9.]/g, "")) || 0;
    return { qty, unitLabel: last };
  }
  return { qty: parseFloat(parts.join("").replace(/[^0-9.]/g, "")) || 0, unitLabel: "" };
}

function normalizeUnitName(label: string): string {
  const l = label.toLowerCase().trim();
  if (["kgr", "kg", "kilogramme", "kilogrammes"].includes(l)) return "Kilogramme";
  if (["gr", "g", "gramme", "grammes"].includes(l)) return "Gramme";
  if (["l", "litre", "litres", "liter"].includes(l)) return "Litre";
  if (["cl", "centilitre", "centilitres"].includes(l)) return "Centilitre";
  if (["pieces", "pièces", "pièce", "piece", "pcs", "pc", "pc(s)", "pce", "unité", "u"].includes(l)) return "Pièce";
  if (["carton", "ctn"].includes(l)) return "Carton";
  return label.trim() || "Pièce";
}

// ── Column indices for the Pacane CSV export format ───────────────────────────
const COL = { NAME: 3, BRANCHES: 4, COST: 5, PRICE: 6, STOCK: 7, CATEGORY: 9, SKU: 12 };

interface ParsedRow {
  name: string; sku: string; cost: number; price: number;
  qty: number; unitLabel: string; category: string;
  branches: string[];
}

function parseRows(rows: string[][]): ParsedRow[] {
  return rows
    .slice(1)
    .filter(r => r.length > COL.SKU && r[COL.NAME]?.trim() && r[COL.SKU]?.trim())
    .filter(r => /^[0-9]+$/.test(r[COL.SKU]?.trim()))
    .map(r => {
      const { qty, unitLabel } = parseStock(r[COL.STOCK] ?? "");
      return {
        name: r[COL.NAME].trim(),
        sku: r[COL.SKU].trim(),
        cost: parsePrice(r[COL.COST] ?? ""),
        price: parsePrice(r[COL.PRICE] ?? ""),
        qty,
        unitLabel,
        category: r[COL.CATEGORY]?.trim() ?? "",
        branches: r[COL.BRANCHES]?.split(",").map(b => b.trim()).filter(Boolean) ?? [],
      };
    });
}

// ── Preview ───────────────────────────────────────────────────────────────────
router.post("/products/csv-preview", requireAuth, requirePermission(P.products.edit), csvUpload.single("csv"), async (req, res): Promise<void> => {
  if (!req.file) { res.status(400).json({ error: "Aucun fichier CSV reçu" }); return; }
  const isAdmin = (req.userPermissions ?? []).includes("*");
  if (!isAdmin) { res.status(403).json({ error: "Accès réservé aux administrateurs" }); return; }
  try {
    const text = req.file.buffer.toString("utf-8");
    const rows = parseCSV(text);
    const parsed = parseRows(rows);
    const unitCounts: Record<string, number> = {};
    const catSet = new Set<string>();
    const skus = new Set<string>();
    const duplicates: string[] = [];
    for (const row of parsed) {
      const unitName = normalizeUnitName(row.unitLabel);
      unitCounts[unitName] = (unitCounts[unitName] ?? 0) + 1;
      if (row.category) catSet.add(row.category);
      if (skus.has(row.sku)) duplicates.push(row.sku);
      skus.add(row.sku);
    }
    const existingProducts = await db.select({ count: sql<string>`COUNT(*)` }).from(productsTable);
    const currentCount = parseInt(existingProducts[0]?.count ?? "0");
    res.json({
      totalRows: parsed.length,
      currentProductCount: currentCount,
      units: Object.entries(unitCounts).map(([name, count]) => ({ name, count })),
      categories: [...catSet],
      duplicateSKUs: duplicates,
      preview: parsed.slice(0, 5).map(r => ({
        name: r.name, sku: r.sku, unit: normalizeUnitName(r.unitLabel), category: r.category,
        cost: r.cost, price: r.price, qty: r.qty,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Erreur de parsing CSV" });
  }
});

// ── Apply Import ──────────────────────────────────────────────────────────────
router.post("/products/csv-reset", requireAuth, requirePermission(P.products.edit), csvUpload.single("csv"), async (req, res): Promise<void> => {
  if (!req.file) { res.status(400).json({ error: "Aucun fichier CSV reçu" }); return; }
  const isAdmin = (req.userPermissions ?? []).includes("*");
  if (!isAdmin) { res.status(403).json({ error: "Accès réservé aux administrateurs" }); return; }
  try {
    const text = req.file.buffer.toString("utf-8");
    const rows = parseCSV(text);
    const parsed = parseRows(rows);
    if (parsed.length === 0) { res.status(400).json({ error: "Aucun produit valide trouvé dans le CSV" }); return; }

    // Load existing units, categories, branches
    const dbUnits = await db.select().from(unitsTable);
    const dbBranches = await db.select().from(branchesTable);

    const unitMap: Record<string, number> = {};
    for (const u of dbUnits) { const k = u.name.toLowerCase(); if (!unitMap[k]) unitMap[k] = u.id; }
    const branchMap: Record<string, number> = {};
    for (const b of dbBranches) { const k = b.name.toLowerCase(); if (!branchMap[k]) branchMap[k] = b.id; }

    // Build catMap fresh — deduplicated: lowest ID wins for duplicate names
    const dbCats = await db.select().from(categoriesTable);
    const catMap: Record<string, number> = {};
    for (const c of dbCats.sort((a, b) => a.id - b.id)) {
      const k = c.name.toLowerCase();
      if (!catMap[k]) catMap[k] = c.id;
    }

    // Collect unique units and categories needed from CSV, create only if missing
    const neededUnits = new Set(parsed.map(r => normalizeUnitName(r.unitLabel)));
    const neededCats = new Set(parsed.map(r => r.category).filter(Boolean));

    const createdUnits: string[] = [];
    for (const uName of neededUnits) {
      const uKey = uName.toLowerCase();
      if (!unitMap[uKey]) {
        const abbr = uName.slice(0, 10);
        const allowDec = !["pièce", "pcs", "carton", "unité"].includes(uKey);
        const [nu] = await db.insert(unitsTable).values({ name: uName, abbreviation: abbr, allowDecimals: allowDec }).returning();
        unitMap[uKey] = nu.id;
        createdUnits.push(uName);
      }
    }

    const createdCats: string[] = [];
    for (const catName of neededCats) {
      const cKey = catName.toLowerCase();
      if (!catMap[cKey]) {
        const [nc] = await db.insert(categoriesTable).values({ name: catName }).returning();
        catMap[cKey] = nc.id;
        createdCats.push(catName);
      }
    }

    // Archive all current products (set isManaged = false)
    await db.update(productsTable).set({ isManaged: false });

    // Get existing products by SKU
    const existingBySku: Record<string, number> = {};
    const allExisting = await db.select({ id: productsTable.id, sku: productsTable.sku }).from(productsTable);
    for (const p of allExisting) { if (p.sku) existingBySku[p.sku] = p.id; }

    let updatedCount = 0;
    let createdCount = 0;
    const skipped: string[] = [];
    const seen = new Set<string>();

    for (const row of parsed) {
      if (seen.has(row.sku)) { skipped.push(row.sku); continue; }
      seen.add(row.sku);
      const unitId = unitMap[normalizeUnitName(row.unitLabel).toLowerCase()] ?? unitMap["pièce"] ?? dbUnits[0]?.id ?? 1;
      const catId = row.category ? (catMap[row.category.toLowerCase()] ?? null) : null;
      const branchIds = row.branches.map(b => branchMap[b.toLowerCase()]).filter(Boolean) as number[];
      const type = branchIds.some(id => {
        const name = dbBranches.find(b => b.id === id)?.name?.toLowerCase() ?? "";
        return name.includes("ecole") || name.includes("labo");
      }) && !branchIds.some(id => {
        const name = dbBranches.find(b => b.id === id)?.name?.toLowerCase() ?? "";
        return !name.includes("ecole") && !name.includes("labo");
      }) ? "ingredient" : "finished";

      const productData = {
        name: row.name, sku: row.sku, unitId, categoryId: catId, type: type as any,
        costPrice: row.cost.toString(), sellingPrice: row.price.toString(),
        isManaged: true, isSellable: type === "finished", isPurchasable: type === "ingredient",
        branchIds,
      };

      if (existingBySku[row.sku]) {
        await db.update(productsTable).set(productData).where(eq(productsTable.id, existingBySku[row.sku]));
        updatedCount++;
      } else {
        const [np] = await db.insert(productsTable).values({ ...productData, isFabricated: false, imageUrl: null, description: null, alertQuantity: null }).returning();
        // Create opening stock if qty > 0
        if (row.qty > 0 && branchIds.length > 0) {
          const qtyPerBranch = row.qty / branchIds.length;
          await db.insert(stockLevelsTable).values(
            branchIds.map(branchId => ({ productId: np.id, branchId, quantity: qtyPerBranch.toString() }))
          );
        }
        createdCount++;
      }
    }

    const archivedCount = allExisting.length - updatedCount;

    res.json({
      success: true,
      archivedCount,
      createdCount,
      updatedCount,
      skippedCount: skipped.length,
      createdUnits,
      createdCategories: createdCats,
    });
  } catch (err: any) {
    req.log?.error({ err }, "Error in CSV reset import");
    res.status(500).json({ error: err?.message ?? "Erreur lors de l'import" });
  }
});

// ── Catalog Purge ─────────────────────────────────────────────────────────────
router.post("/products/catalog-purge", requireAuth, async (req, res): Promise<void> => {
  const isAdmin = (req.userPermissions ?? []).includes("*");
  if (!isAdmin) { res.status(403).json({ error: "Accès réservé aux administrateurs" }); return; }
  try {
    const counts: Record<string, number> = {};

    // Count current products before
    const preProd = await db.execute(sql`SELECT COUNT(*) as cnt FROM products`);
    counts.products_before = parseInt((preProd[0] as any)?.cnt ?? "0");

    // Helper: delete all rows in a table, return count deleted
    const purge = async (q: ReturnType<typeof sql>): Promise<number> => {
      const r = await db.execute(q);
      return parseInt((r[0] as any)?.cnt ?? "0");
    };

    // Respect dependency order — deepest children first
    counts.purchase_reception_items = await purge(sql`WITH d AS (DELETE FROM purchase_reception_items RETURNING id) SELECT COUNT(*) as cnt FROM d`);
    counts.purchase_receptions     = await purge(sql`WITH d AS (DELETE FROM purchase_receptions RETURNING id) SELECT COUNT(*) as cnt FROM d`);
    counts.purchase_return_items   = await purge(sql`WITH d AS (DELETE FROM purchase_return_items RETURNING id) SELECT COUNT(*) as cnt FROM d`);
    counts.purchase_returns        = await purge(sql`WITH d AS (DELETE FROM purchase_returns RETURNING id) SELECT COUNT(*) as cnt FROM d`);
    counts.purchase_payments       = await purge(sql`WITH d AS (DELETE FROM purchase_payments RETURNING id) SELECT COUNT(*) as cnt FROM d`);
    counts.purchase_items          = await purge(sql`WITH d AS (DELETE FROM purchase_items RETURNING id) SELECT COUNT(*) as cnt FROM d`);
    counts.purchases               = await purge(sql`WITH d AS (DELETE FROM purchases RETURNING id) SELECT COUNT(*) as cnt FROM d`);

    counts.sales_return_items = await purge(sql`WITH d AS (DELETE FROM sales_return_items RETURNING id) SELECT COUNT(*) as cnt FROM d`);
    counts.sales_returns      = await purge(sql`WITH d AS (DELETE FROM sales_returns RETURNING id) SELECT COUNT(*) as cnt FROM d`);
    counts.sale_payments      = await purge(sql`WITH d AS (DELETE FROM sale_payments RETURNING id) SELECT COUNT(*) as cnt FROM d`);
    counts.sale_items         = await purge(sql`WITH d AS (DELETE FROM sale_items RETURNING id) SELECT COUNT(*) as cnt FROM d`);
    counts.sales              = await purge(sql`WITH d AS (DELETE FROM sales RETURNING id) SELECT COUNT(*) as cnt FROM d`);
    counts.pos_sessions       = await purge(sql`WITH d AS (DELETE FROM pos_sessions RETURNING id) SELECT COUNT(*) as cnt FROM d`);

    counts.stock_movements = await purge(sql`WITH d AS (DELETE FROM stock_movements RETURNING id) SELECT COUNT(*) as cnt FROM d`);
    counts.stock_levels    = await purge(sql`WITH d AS (DELETE FROM stock_levels RETURNING id) SELECT COUNT(*) as cnt FROM d`);
    counts.adjustments     = await purge(sql`WITH d AS (DELETE FROM adjustments RETURNING id) SELECT COUNT(*) as cnt FROM d`);

    counts.transfer_items = await purge(sql`WITH d AS (DELETE FROM transfer_items RETURNING id) SELECT COUNT(*) as cnt FROM d`);
    counts.transfers      = await purge(sql`WITH d AS (DELETE FROM transfers RETURNING id) SELECT COUNT(*) as cnt FROM d`);

    counts.recipe_ingredients = await purge(sql`WITH d AS (DELETE FROM recipe_ingredients RETURNING id) SELECT COUNT(*) as cnt FROM d`);
    counts.production_orders  = await purge(sql`WITH d AS (DELETE FROM production_orders RETURNING id) SELECT COUNT(*) as cnt FROM d`);
    counts.recipes            = await purge(sql`WITH d AS (DELETE FROM recipes RETURNING id) SELECT COUNT(*) as cnt FROM d`);

    await db.execute(sql`DELETE FROM attachments WHERE entity_type IN ('sale','purchase','transfer','production_order','sales_return','purchase_return','adjustment','stock_movement','recipe')`);

    counts.products_deleted = await purge(sql`WITH d AS (DELETE FROM products RETURNING id) SELECT COUNT(*) as cnt FROM d`);

    // Verify zero
    const postProd = await db.execute(sql`SELECT COUNT(*) as cnt FROM products`);
    counts.products_remaining = parseInt((postProd[0] as any)?.cnt ?? "0");

    res.json({ success: true, counts });
  } catch (err: any) {
    req.log?.error({ err }, "catalog-purge failed");
    res.status(500).json({ error: err?.message ?? "Erreur lors de la suppression" });
  }
});

export default router;
