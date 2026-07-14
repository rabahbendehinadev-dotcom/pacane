import { Router, type IRouter } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { db, recipesTable, recipeItemsTable, productsTable, unitsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission } from "../middlewares/permissions";
import { P } from "../lib/permissions";
import { invalidateRecipeCostCache } from "../lib/costing";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ── Levenshtein distance ──────────────────────────────────────────────────────
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => Array(n + 1).fill(0).map((__, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[_\s-]+/g, " ").trim();
}

function fuzzyScore(a: string, b: string): number {
  const na = normalize(a), nb = normalize(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

// ── Column aliases ────────────────────────────────────────────────────────────
const FIELD_ALIASES: Record<string, string[]> = {
  nom:           ["nom", "nom recette", "recette", "recipe name", "designation", "designations", "name", "اسم الوصفة", "nom de la recette"],
  type:          ["type", "type recette", "recipe type", "finished", "semi_finished", "type de recette"],
  rendement:     ["rendement", "yield", "مردود", "quantite rendue", "quantite rendement"],
  unite_rendement: ["unite rendement", "unite_rendement", "yield unit", "وحدة المردود", "unite de rendement", "unité rendement", "unite yield"],
  produit_lie:   ["produit lie", "produit_lie", "produit final", "produit", "product", "المنتج", "produit associe", "lié au produit"],
  etapes:        ["etapes", "etape", "steps", "طريقة التحضير", "preparation", "methode", "méthode"],
  notes:         ["notes", "note", "remarques", "observations", "ملاحظات", "commentaire"],
  nom_composant: ["nom composant", "nom_composant", "composant", "ingredient", "component", "مكوّن", "مكون", "matiere", "matiere premiere", "matières premières"],
  quantite:      ["quantite", "qty", "quantity", "كمية", "qte", "qté", "quantité"],
  unite:         ["unite", "unit", "وحدة", "unité", "unite composant"],
  taux_de_perte: ["taux de perte", "taux_de_perte", "wastage", "dechet", "perte", "تضيع", "waste", "taux perte"],
};

const FIELD_LABELS: Record<string, string> = {
  nom: "Nom de la recette",
  type: "Type",
  rendement: "Rendement",
  unite_rendement: "Unité de rendement",
  produit_lie: "Produit lié",
  etapes: "Étapes",
  notes: "Notes",
  nom_composant: "Composant",
  quantite: "Quantité",
  unite: "Unité",
  taux_de_perte: "Taux de perte",
};

const REQUIRED_FIELDS = ["nom", "nom_composant", "quantite", "unite"];

function detectMapping(headers: string[]): Record<string, { column: string | null; status: "auto" | "confirm" | "missing" }> {
  const result: Record<string, { column: string | null; status: "auto" | "confirm" | "missing" }> = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    let bestCol: string | null = null;
    let bestScore = 0;
    for (const header of headers) {
      const normH = normalize(header);
      for (const alias of aliases) {
        const score = fuzzyScore(normH, alias);
        if (score > bestScore) { bestScore = score; bestCol = header; }
      }
    }
    if (bestScore >= 0.95) result[field] = { column: bestCol, status: "auto" };
    else if (bestScore >= 0.7) result[field] = { column: bestCol, status: "confirm" };
    else result[field] = { column: null, status: "missing" };
  }
  return result;
}

// ── CSV Parser ────────────────────────────────────────────────────────────────
function parseCsvBuffer(buf: Buffer): { headers: string[]; rows: string[][] } {
  const text = buf.toString("utf-8").replace(/^\uFEFF/, "");
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const result: string[][] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cur = "", inQ = false;
    for (const ch of line) {
      if (ch === '"' && !inQ) inQ = true;
      else if (ch === '"' && inQ) inQ = false;
      else if (ch === "," && !inQ) { cells.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    cells.push(cur.trim());
    result.push(cells);
  }
  const [headerRow, ...dataRows] = result;
  return { headers: headerRow ?? [], rows: dataRows };
}

// ── XLSX/XLS Parser ───────────────────────────────────────────────────────────
function parseExcelBuffer(buf: Buffer, sheetName?: string): { sheetNames: string[]; headers: string[]; rows: string[][] } {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetNames = wb.SheetNames;
  const targetSheet = sheetName && sheetNames.includes(sheetName) ? sheetName : sheetNames[0];
  const ws = wb.Sheets[targetSheet];
  const raw: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as string[][];
  // Find first non-empty row as header
  let headerIdx = 0;
  for (let i = 0; i < Math.min(10, raw.length); i++) {
    if (raw[i].some(c => typeof c === "string" && c.trim().length > 1)) { headerIdx = i; break; }
  }
  const headers = (raw[headerIdx] ?? []).map(c => String(c ?? "").trim()).filter(Boolean);
  const fullHeaderRow = raw[headerIdx] ?? [];
  const rows = raw.slice(headerIdx + 1)
    .filter(r => r.some(c => String(c ?? "").trim()))
    .map(r => fullHeaderRow.map((_: any, i: number) => String(r[i] ?? "").trim()));
  return { sheetNames, headers, rows };
}

// ── PARSE endpoint ────────────────────────────────────────────────────────────
router.post("/recipes/import/parse", requireAuth, requirePermission(P.MANAGE_RECIPES),
  upload.single("file"),
  async (req, res) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ error: "Aucun fichier fourni" });

      const ext = (file.originalname.split(".").pop() ?? "").toLowerCase();
      const isExcel = ext === "xlsx" || ext === "xls";
      const selectedSheet: string | undefined = req.body.sheet;

      let headers: string[], rows: string[][], sheetNames: string[] = [];

      if (isExcel) {
        const parsed = parseExcelBuffer(file.buffer, selectedSheet);
        headers = parsed.headers;
        rows = parsed.rows;
        sheetNames = parsed.sheetNames;
      } else {
        const parsed = parseCsvBuffer(file.buffer);
        headers = parsed.headers;
        rows = parsed.rows;
      }

      if (!headers.length) return res.status(400).json({ error: "Fichier vide ou format non reconnu" });

      const mapping = detectMapping(headers);
      const sample = rows.slice(0, 5).map(r => {
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => { obj[h] = r[i] ?? ""; });
        return obj;
      });

      return res.json({ headers, sheetNames, currentSheet: sheetNames[0] ?? null, mapping, sample, totalRows: rows.length });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? "Erreur de lecture du fichier" });
    }
  }
);

// ── PREVIEW endpoint ──────────────────────────────────────────────────────────
router.post("/recipes/import/preview", requireAuth, requirePermission(P.MANAGE_RECIPES),
  upload.single("file"),
  async (req, res) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ error: "Fichier requis" });

      const mapping: Record<string, string | null> = JSON.parse(req.body.mapping ?? "{}");
      const ext = (file.originalname.split(".").pop() ?? "").toLowerCase();
      const isExcel = ext === "xlsx" || ext === "xls";
      const selectedSheet: string | undefined = req.body.sheet;

      let headers: string[], rows: string[][];
      if (isExcel) {
        const p = parseExcelBuffer(file.buffer, selectedSheet);
        headers = p.headers; rows = p.rows;
      } else {
        const p = parseCsvBuffer(file.buffer);
        headers = p.headers; rows = p.rows;
      }

      // Load products and units from DB
      const [allProducts, allUnits, existingRecipes] = await Promise.all([
        db.select({ id: productsTable.id, name: productsTable.name }).from(productsTable),
        db.select({ id: unitsTable.id, name: unitsTable.name, abbreviation: unitsTable.abbreviation }).from(unitsTable),
        db.select({ id: recipesTable.id, name: recipesTable.name }).from(recipesTable),
      ]);

      function getCell(row: string[], field: string): string {
        const col = mapping[field];
        if (!col) return "";
        const idx = headers.indexOf(col);
        return idx >= 0 ? (row[idx] ?? "").trim() : "";
      }

      function findUnit(name: string) {
        if (!name) return null;
        const n = normalize(name);
        return allUnits.find(u => normalize(u.abbreviation ?? "") === n || normalize(u.name) === n) ?? null;
      }

      function findProduct(name: string): { exact: typeof allProducts[0] | null; fuzzy: typeof allProducts } {
        if (!name) return { exact: null, fuzzy: [] };
        const n = normalize(name);
        const exact = allProducts.find(p => normalize(p.name) === n) ?? null;
        if (exact) return { exact, fuzzy: [] };
        const fuzzy = allProducts
          .map(p => ({ p, score: fuzzyScore(normalize(p.name), n) }))
          .filter(x => x.score >= 0.65)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .map(x => x.p);
        return { exact: null, fuzzy };
      }

      // Group rows by recipe name
      type ParsedComponent = {
        rowIndex: number; compName: string;
        productId: number | null; productFuzzy: typeof allProducts;
        quantity: number; unitId: number | null; unitName: string;
        wastageRate: number; errors: string[];
      };
      type ParsedRecipe = {
        name: string; type: string; yieldVal: number;
        yieldUnitId: number | null; yieldUnitName: string;
        productId: number | null; productName: string;
        productFuzzy: typeof allProducts;
        steps: string | null; notes: string | null;
        components: ParsedComponent[];
        errors: string[]; isDuplicate: boolean; existingId: number | null;
        firstRowIndex: number;
      };

      const recipeMap = new Map<string, ParsedRecipe>();

      rows.forEach((row, rowIndex) => {
        const name = getCell(row, "nom");
        if (!name) return;

        if (!recipeMap.has(name)) {
          const typeRaw = getCell(row, "type") || "finished";
          const type = typeRaw === "semi_finished" || typeRaw === "semi fini" || typeRaw.toLowerCase().includes("semi") ? "semi_finished" : "finished";
          const yieldVal = parseFloat(getCell(row, "rendement") || "0") || 0;
          const yieldUnitName = getCell(row, "unite_rendement");
          const productLineName = getCell(row, "produit_lie");
          const steps = getCell(row, "etapes").replace(/ \| /g, "\n") || null;
          const notes = getCell(row, "notes") || null;

          const errors: string[] = [];
          const yieldUnit = findUnit(yieldUnitName);
          if (!yieldUnitName) errors.push("Unité de rendement manquante");
          else if (!yieldUnit) errors.push(`Unité de rendement introuvable: "${yieldUnitName}"`);

          const { exact: linkedProduct, fuzzy: linkedFuzzy } = productLineName ? findProduct(productLineName) : { exact: null, fuzzy: [] };
          if (productLineName && !linkedProduct) {
            if (linkedFuzzy.length > 0) errors.push(`Produit lié "${productLineName}" — correspondance approximative disponible`);
            else errors.push(`Produit lié introuvable: "${productLineName}"`);
          }

          const existing = existingRecipes.find(r => normalize(r.name) === normalize(name));

          recipeMap.set(name, {
            name, type, yieldVal,
            yieldUnitId: yieldUnit?.id ?? null, yieldUnitName,
            productId: linkedProduct?.id ?? null, productName: productLineName,
            productFuzzy: linkedFuzzy,
            steps, notes,
            components: [], errors,
            isDuplicate: !!existing, existingId: existing?.id ?? null,
            firstRowIndex: rowIndex + 2,
          });
        }

        const compName = getCell(row, "nom_composant");
        if (compName) {
          const recipe = recipeMap.get(name)!;
          const qty = parseFloat(getCell(row, "quantite") || "0");
          const unitName = getCell(row, "unite");
          const wastage = parseFloat(getCell(row, "taux_de_perte") || "0") || 0;
          const { exact: prod, fuzzy: prodFuzzy } = findProduct(compName);
          const unit = findUnit(unitName);

          const compErrors: string[] = [];
          if (!compName) compErrors.push("Nom du composant manquant");
          if (!prod) {
            if (prodFuzzy.length > 0) compErrors.push(`"${compName}" — correspondance approximative disponible`);
            else compErrors.push(`Composant introuvable dans la base: "${compName}"`);
          }
          if (!unitName) compErrors.push("Unité manquante");
          else if (!unit) compErrors.push(`Unité introuvable: "${unitName}"`);
          if (qty <= 0) compErrors.push(`Quantité invalide: ${qty}`);

          recipe.components.push({
            rowIndex: rowIndex + 2, compName,
            productId: prod?.id ?? null, productFuzzy: prodFuzzy,
            quantity: qty, unitId: unit?.id ?? null, unitName,
            wastageRate: wastage, errors: compErrors,
          });
        }
      });

      const recipes = Array.from(recipeMap.values());
      const preview = recipes.slice(0, 20).map(r => ({
        name: r.name, type: r.type, yieldVal: r.yieldVal, yieldUnitName: r.yieldUnitName,
        productName: r.productName, productFuzzy: r.productFuzzy.map(p => ({ id: p.id, name: p.name })),
        componentCount: r.components.length,
        errors: r.errors,
        isDuplicate: r.isDuplicate, existingId: r.existingId,
        firstRowIndex: r.firstRowIndex,
        components: r.components.map(c => ({
          rowIndex: c.rowIndex, compName: c.compName,
          productId: c.productId,
          productFuzzy: c.productFuzzy.map(p => ({ id: p.id, name: p.name })),
          quantity: c.quantity, unitName: c.unitName, unitId: c.unitId,
          wastageRate: c.wastageRate, errors: c.errors,
        })),
      }));

      const totalErrors = recipes.reduce((s, r) => s + r.errors.length + r.components.reduce((cs, c) => cs + c.errors.filter(e => !e.includes("approximative")).length, 0), 0);
      const duplicates = recipes.filter(r => r.isDuplicate).map(r => ({ name: r.name, existingId: r.existingId }));

      return res.json({ preview, totalRecipes: recipes.length, totalErrors, duplicates });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? "Erreur de validation" });
    }
  }
);

// ── EXECUTE endpoint ──────────────────────────────────────────────────────────
router.post("/recipes/import/execute", requireAuth, requirePermission(P.MANAGE_RECIPES),
  upload.single("file"),
  async (req, res) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ error: "Fichier requis" });

      const mapping: Record<string, string | null> = JSON.parse(req.body.mapping ?? "{}");
      const duplicateStrategies: Record<string, "ignore" | "update" | "copy" | "update_components"> = JSON.parse(req.body.duplicateStrategies ?? "{}");
      const resolvedProducts: Record<string, number> = JSON.parse(req.body.resolvedProducts ?? "{}");
      const ext = (file.originalname.split(".").pop() ?? "").toLowerCase();
      const isExcel = ext === "xlsx" || ext === "xls";
      const selectedSheet: string | undefined = req.body.sheet;

      let headers: string[], rows: string[][];
      if (isExcel) {
        const p = parseExcelBuffer(file.buffer, selectedSheet);
        headers = p.headers; rows = p.rows;
      } else {
        const p = parseCsvBuffer(file.buffer);
        headers = p.headers; rows = p.rows;
      }

      const [allProducts, allUnits, existingRecipes] = await Promise.all([
        db.select({ id: productsTable.id, name: productsTable.name }).from(productsTable),
        db.select({ id: unitsTable.id, name: unitsTable.name, abbreviation: unitsTable.abbreviation }).from(unitsTable),
        db.select({ id: recipesTable.id, name: recipesTable.name }).from(recipesTable),
      ]);

      function getCell(row: string[], field: string): string {
        const col = mapping[field];
        if (!col) return "";
        const idx = headers.indexOf(col);
        return idx >= 0 ? (row[idx] ?? "").trim() : "";
      }

      function findUnit(name: string) {
        const n = normalize(name);
        return allUnits.find(u => normalize(u.abbreviation ?? "") === n || normalize(u.name) === n) ?? null;
      }

      function resolveProduct(name: string): number | null {
        if (!name) return null;
        if (resolvedProducts[name]) return resolvedProducts[name];
        const n = normalize(name);
        return allProducts.find(p => normalize(p.name) === n)?.id ?? null;
      }

      // Build recipe map
      type RecipeToBuild = {
        name: string; type: string; yieldVal: number; yieldUnitId: number | null;
        productId: number | null; steps: string | null; notes: string | null;
        components: { itemId: number; quantity: number; unitId: number; wastageRate: number }[];
        isDuplicate: boolean; existingId: number | null;
      };

      const recipeMap = new Map<string, RecipeToBuild>();
      rows.forEach(row => {
        const name = getCell(row, "nom");
        if (!name) return;

        if (!recipeMap.has(name)) {
          const typeRaw = getCell(row, "type") || "finished";
          const type = typeRaw.toLowerCase().includes("semi") ? "semi_finished" : "finished";
          const yieldVal = parseFloat(getCell(row, "rendement") || "1") || 1;
          const yieldUnit = findUnit(getCell(row, "unite_rendement"));
          const productLineName = getCell(row, "produit_lie");
          const steps = getCell(row, "etapes").replace(/ \| /g, "\n") || null;
          const notes = getCell(row, "notes") || null;
          const existing = existingRecipes.find(r => normalize(r.name) === normalize(name));

          recipeMap.set(name, {
            name, type, yieldVal, yieldUnitId: yieldUnit?.id ?? null,
            productId: resolveProduct(productLineName), steps, notes, components: [],
            isDuplicate: !!existing, existingId: existing?.id ?? null,
          });
        }

        const compName = getCell(row, "nom_composant");
        if (compName) {
          const recipe = recipeMap.get(name)!;
          const qty = parseFloat(getCell(row, "quantite") || "0");
          const unit = findUnit(getCell(row, "unite"));
          const wastage = parseFloat(getCell(row, "taux_de_perte") || "0") || 0;
          const productId = resolveProduct(compName);
          if (productId && unit && qty > 0) {
            recipe.components.push({ itemId: productId, quantity: qty, unitId: unit.id, wastageRate: wastage });
          }
        }
      });

      let created = 0, updated = 0, skipped = 0, failed = 0;
      const errors: string[] = [];
      const report: { name: string; status: "created" | "updated" | "skipped" | "failed"; message?: string }[] = [];

      for (const recipe of recipeMap.values()) {
        try {
          if (!recipe.yieldUnitId) { skipped++; report.push({ name: recipe.name, status: "skipped", message: "Unité de rendement manquante" }); continue; }
          if (recipe.components.length === 0) { skipped++; report.push({ name: recipe.name, status: "skipped", message: "Aucun composant valide" }); continue; }

          if (recipe.isDuplicate && recipe.existingId) {
            const strategy = duplicateStrategies[recipe.name] ?? "ignore";
            if (strategy === "ignore") {
              skipped++;
              report.push({ name: recipe.name, status: "skipped", message: "Recette existante — ignorée" });
              continue;
            } else if (strategy === "update") {
              await db.update(recipesTable).set({
                type: recipe.type, yield: String(recipe.yieldVal), yieldUnitId: recipe.yieldUnitId,
                productId: recipe.productId, steps: recipe.steps, notes: recipe.notes,
              }).where(eq(recipesTable.id, recipe.existingId));
              await db.delete(recipeItemsTable).where(eq(recipeItemsTable.recipeId, recipe.existingId));
              await db.insert(recipeItemsTable).values(recipe.components.map(c => ({
                recipeId: recipe.existingId!, itemType: "product" as const,
                itemId: c.itemId, quantity: String(c.quantity), unitId: c.unitId, wastageRate: String(c.wastageRate),
              })));
              await invalidateRecipeCostCache(recipe.existingId);
              updated++;
              report.push({ name: recipe.name, status: "updated" });
              continue;
            } else if (strategy === "update_components") {
              await db.delete(recipeItemsTable).where(eq(recipeItemsTable.recipeId, recipe.existingId));
              await db.insert(recipeItemsTable).values(recipe.components.map(c => ({
                recipeId: recipe.existingId!, itemType: "product" as const,
                itemId: c.itemId, quantity: String(c.quantity), unitId: c.unitId, wastageRate: String(c.wastageRate),
              })));
              await invalidateRecipeCostCache(recipe.existingId);
              updated++;
              report.push({ name: recipe.name, status: "updated", message: "Composants mis à jour" });
              continue;
            } else if (strategy === "copy") {
              recipe.name = `${recipe.name} (copie)`;
            }
          }

          // Create new recipe
          const [created_recipe] = await db.insert(recipesTable).values({
            name: recipe.name, type: recipe.type, yield: String(recipe.yieldVal),
            yieldUnitId: recipe.yieldUnitId, productId: recipe.productId,
            steps: recipe.steps, notes: recipe.notes,
          }).returning();

          if (recipe.components.length > 0) {
            await db.insert(recipeItemsTable).values(recipe.components.map(c => ({
              recipeId: created_recipe.id, itemType: "product" as const,
              itemId: c.itemId, quantity: String(c.quantity), unitId: c.unitId, wastageRate: String(c.wastageRate),
            })));
          }
          await invalidateRecipeCostCache(created_recipe.id);
          created++;
          report.push({ name: recipe.name, status: "created" });
        } catch (err: any) {
          failed++;
          errors.push(`${recipe.name}: ${err.message}`);
          report.push({ name: recipe.name, status: "failed", message: err.message });
        }
      }

      return res.json({ created, updated, skipped, failed, errors, report });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? "Erreur lors de l'importation" });
    }
  }
);

// ── TEMPLATE endpoint ─────────────────────────────────────────────────────────
router.get("/recipes/import/template", requireAuth, async (_req, res) => {
  const wb = XLSX.utils.book_new();

  // Instructions sheet
  const instrData = [
    ["GUIDE D'IMPORTATION DES RECETTES — Pacane ERP"],
    [],
    ["COLONNES OBLIGATOIRES (*)"],
    ["Colonne", "Description", "Exemple"],
    ["nom *", "Nom de la recette (répéter pour chaque composant)", "Croissant au beurre"],
    ["nom_composant *", "Nom du composant/ingrédient (doit exister dans la base)", "Farine T45"],
    ["quantite *", "Quantité du composant (nombre positif)", "500"],
    ["unite *", "Unité du composant (abr. ou nom complet)", "g"],
    [],
    ["COLONNES OPTIONNELLES"],
    ["Colonne", "Description", "Valeurs acceptées"],
    ["type", "Type de recette", "finished (défaut) | semi_finished"],
    ["rendement", "Quantité produite", "12"],
    ["unite_rendement", "Unité du rendement", "pcs"],
    ["produit_lie", "Produit final associé (doit exister dans la base)", "Croissant"],
    ["taux_de_perte", "Taux de perte en % (0 à 100)", "5"],
    ["etapes", "Étapes de préparation (séparer par ' | ')", "Mélanger | Pétrir"],
    ["notes", "Notes libres", "Recette de base"],
    [],
    ["RÈGLES IMPORTANTES"],
    ["Règle", "Détail"],
    ["1 ligne = 1 composant", "Si une recette a 3 composants, elle occupe 3 lignes"],
    ["Noms exacts", "Le composant et le produit lié doivent exister dans le catalogue"],
    ["Unités", "Utiliser l'abréviation (g, kg, L, pcs) ou le nom complet"],
    ["Encodage", "Sauvegarder en UTF-8 pour les accents"],
    [],
    ["UNITÉS COMMUNES"],
    ["Abréviation", "Nom"],
    ["g", "Gramme"], ["kg", "Kilogramme"], ["L", "Litre"], ["mL", "Millilitre"],
    ["pcs", "Pièce"], ["cs", "Cuillère à soupe"], ["cc", "Cuillère à café"],
  ];

  const instrWs = XLSX.utils.aoa_to_sheet(instrData);
  instrWs["!cols"] = [{ wch: 30 }, { wch: 50 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, instrWs, "Instructions");

  // Recettes sheet
  const recetteData = [
    ["nom", "type", "rendement", "unite_rendement", "produit_lie", "nom_composant", "quantite", "unite", "taux_de_perte", "etapes", "notes"],
    ["Croissant au beurre", "finished", "12", "pcs", "Croissant", "Farine T45", "500", "g", "0", "Mélanger | Pétrir | Façonner | Cuire", "Recette classique"],
    ["Croissant au beurre", "finished", "12", "pcs", "Croissant", "Beurre AOP", "300", "g", "2", "", ""],
    ["Croissant au beurre", "finished", "12", "pcs", "Croissant", "Lait entier", "150", "mL", "0", "", ""],
    ["Croissant au beurre", "finished", "12", "pcs", "Croissant", "Levure fraîche", "20", "g", "0", "", ""],
    [],
    ["Pâte feuilletée", "semi_finished", "1", "kg", "", "Farine T45", "500", "g", "0", "Mélanger | Tourer 6 fois | Reposer", "Base feuilletée"],
    ["Pâte feuilletée", "semi_finished", "1", "kg", "", "Beurre AOP", "350", "g", "0", "", ""],
    ["Pâte feuilletée", "semi_finished", "1", "kg", "", "Eau froide", "200", "mL", "0", "", ""],
    ["Pâte feuilletée", "semi_finished", "1", "kg", "", "Sel", "10", "g", "0", "", ""],
  ];

  const recetteWs = XLSX.utils.aoa_to_sheet(recetteData);
  recetteWs["!cols"] = [{ wch: 25 }, { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 20 }, { wch: 25 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 35 }, { wch: 25 }];
  XLSX.utils.book_append_sheet(wb, recetteWs, "Recettes");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="modele_recettes.xlsx"`);
  return res.send(buf);
});

export default router;
