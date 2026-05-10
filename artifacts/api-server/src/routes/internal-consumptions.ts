import { Router, type IRouter } from "express";
import {
  db, internalConsumptionsTable, internalConsumptionItemsTable,
  branchesTable, productsTable, unitsTable, usersTable, stockLevelsTable,
} from "@workspace/db";
import { eq, and, sql, desc, gte, lte, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, assertBranchAccess } from "../middlewares/permissions";
import { P } from "../lib/permissions";
import { adjustStock } from "./stock";

const router: IRouter = Router();

function genRef() {
  const d = new Date();
  const seq = String(Math.floor(Math.random() * 9000) + 1000);
  return `CI-${d.getFullYear()}-${seq}`;
}

async function getAvailableStock(productId: number, branchId: number): Promise<number> {
  const [sl] = await db
    .select({ qty: sql<string>`COALESCE(SUM(${stockLevelsTable.quantity}), '0')` })
    .from(stockLevelsTable)
    .where(and(eq(stockLevelsTable.productId, productId), eq(stockLevelsTable.branchId, branchId)));
  return parseFloat(sl?.qty ?? "0");
}

async function buildDocResponse(doc: typeof internalConsumptionsTable.$inferSelect, withItems = true) {
  const [src] = await db.select().from(branchesTable).where(eq(branchesTable.id, doc.sourceBranchId));
  const [dst] = await db.select().from(branchesTable).where(eq(branchesTable.id, doc.destinationBranchId));
  const [creator] = doc.createdByUserId
    ? await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, doc.createdByUserId))
    : [{ name: null }];

  const itemCountRes = await db
    .select({ c: sql<number>`count(*)` })
    .from(internalConsumptionItemsTable)
    .where(eq(internalConsumptionItemsTable.documentId, doc.id));
  const itemCount = Number(itemCountRes[0]?.c ?? 0);

  if (!withItems) {
    return {
      ...doc,
      sourceBranchName: src?.name ?? "",
      destinationBranchName: dst?.name ?? "",
      createdByName: creator?.name ?? null,
      itemCount,
      totalCost: parseFloat(doc.totalCost as string),
    };
  }

  const items = await db
    .select({
      item: internalConsumptionItemsTable,
      productName: productsTable.name,
      unitName: unitsTable.abbreviation,
    })
    .from(internalConsumptionItemsTable)
    .leftJoin(productsTable, eq(internalConsumptionItemsTable.productId, productsTable.id))
    .leftJoin(unitsTable, eq(internalConsumptionItemsTable.unitId, unitsTable.id))
    .where(eq(internalConsumptionItemsTable.documentId, doc.id));

  return {
    ...doc,
    sourceBranchName: src?.name ?? "",
    destinationBranchName: dst?.name ?? "",
    createdByName: creator?.name ?? null,
    itemCount,
    totalCost: parseFloat(doc.totalCost as string),
    items: items.map(i => ({
      id: i.item.id,
      productId: i.item.productId,
      productName: i.productName ?? "",
      quantity: parseFloat(i.item.quantity as string),
      unitId: i.item.unitId,
      unitName: i.unitName ?? "",
      unitCost: parseFloat(i.item.unitCost as string),
      totalCost: parseFloat(i.item.totalCost as string),
    })),
  };
}

// ── LIST ─────────────────────────────────────────────────────────────────────
router.get("/internal-consumptions", requireAuth, requirePermission(P.internalConsumptions.view), async (req, res): Promise<void> => {
  const { sourceBranchId, destinationBranchId, status, dateFrom, dateTo } = req.query as Record<string, string>;
  const user = req.user!;
  const conditions: ReturnType<typeof eq>[] = [];

  if (!user.adminAccess) {
    if (user.branchIds.length === 0) { res.json([]); return; }
    const ids = user.branchIds.join(",");
    conditions.push(sql`(${internalConsumptionsTable.sourceBranchId} = ANY(ARRAY[${sql.raw(ids)}]::int[]) OR ${internalConsumptionsTable.destinationBranchId} = ANY(ARRAY[${sql.raw(ids)}]::int[]))` as any);
  }
  if (sourceBranchId) conditions.push(eq(internalConsumptionsTable.sourceBranchId, parseInt(sourceBranchId, 10)) as any);
  if (destinationBranchId) conditions.push(eq(internalConsumptionsTable.destinationBranchId, parseInt(destinationBranchId, 10)) as any);
  if (status) conditions.push(eq(internalConsumptionsTable.status, status) as any);
  if (dateFrom) conditions.push(gte(internalConsumptionsTable.documentDate, new Date(dateFrom)) as any);
  if (dateTo) {
    const end = new Date(dateTo);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(internalConsumptionsTable.documentDate, end) as any);
  }

  const docs = conditions.length
    ? await db.select().from(internalConsumptionsTable).where(and(...conditions)).orderBy(desc(internalConsumptionsTable.createdAt))
    : await db.select().from(internalConsumptionsTable).orderBy(desc(internalConsumptionsTable.createdAt));

  const result = await Promise.all(docs.map(d => buildDocResponse(d, false)));
  res.json(result);
});

// ── GET ONE ───────────────────────────────────────────────────────────────────
router.get("/internal-consumptions/:id", requireAuth, requirePermission(P.internalConsumptions.view), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const [doc] = await db.select().from(internalConsumptionsTable).where(eq(internalConsumptionsTable.id, id));
  if (!doc) { res.status(404).json({ error: "Document introuvable" }); return; }
  const user = req.user!;
  if (!user.adminAccess && !user.branchIds.includes(doc.sourceBranchId) && !user.branchIds.includes(doc.destinationBranchId)) {
    res.status(403).json({ error: "Accès refusé", code: "BRANCH_ACCESS_DENIED" }); return;
  }
  res.json(await buildDocResponse(doc, true));
});

// ── CREATE ────────────────────────────────────────────────────────────────────
router.post("/internal-consumptions", requireAuth, requirePermission(P.internalConsumptions.create), async (req, res): Promise<void> => {
  const { sourceBranchId, destinationBranchId, documentDate, notes, items } = req.body;

  if (!sourceBranchId || !destinationBranchId || !items?.length) {
    res.status(400).json({ error: "Champs requis manquants" }); return;
  }
  const srcId = parseInt(String(sourceBranchId), 10);
  const dstId = parseInt(String(destinationBranchId), 10);
  if (srcId === dstId) {
    res.status(400).json({ error: "La succursale source et destination doivent être différentes" }); return;
  }
  if (!assertBranchAccess(req.user!, srcId, res)) return;

  let totalCost = 0;
  for (const item of items) {
    const qty = parseFloat(String(item.quantity ?? 0));
    const cost = parseFloat(String(item.unitCost ?? 0));
    if (qty <= 0) { res.status(400).json({ error: "La quantité doit être supérieure à 0" }); return; }
    totalCost += qty * cost;
  }

  const [doc] = await db.insert(internalConsumptionsTable).values({
    reference: genRef(),
    sourceBranchId: srcId,
    destinationBranchId: dstId,
    documentDate: documentDate ? new Date(documentDate) : new Date(),
    status: "draft",
    totalCost: totalCost.toFixed(2),
    notes: notes ?? null,
    createdByUserId: req.userId,
  }).returning();

  for (const item of items) {
    const qty = parseFloat(String(item.quantity));
    const cost = parseFloat(String(item.unitCost ?? 0));
    await db.insert(internalConsumptionItemsTable).values({
      documentId: doc.id,
      productId: parseInt(String(item.productId), 10),
      quantity: qty.toString(),
      unitId: item.unitId ? parseInt(String(item.unitId), 10) : null,
      unitCost: cost.toFixed(2),
      totalCost: (qty * cost).toFixed(2),
    } as any);
  }

  res.status(201).json(await buildDocResponse(doc, true));
});

// ── UPDATE DRAFT ──────────────────────────────────────────────────────────────
router.put("/internal-consumptions/:id", requireAuth, requirePermission(P.internalConsumptions.create), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const [doc] = await db.select().from(internalConsumptionsTable).where(eq(internalConsumptionsTable.id, id));
  if (!doc) { res.status(404).json({ error: "Document introuvable" }); return; }
  if (doc.status !== "draft") {
    res.status(409).json({ error: "Seuls les brouillons peuvent être modifiés" }); return;
  }
  if (!assertBranchAccess(req.user!, doc.sourceBranchId, res)) return;

  const { documentDate, notes, items } = req.body;
  if (!items?.length) { res.status(400).json({ error: "Au moins un article requis" }); return; }

  let totalCost = 0;
  for (const item of items) {
    const qty = parseFloat(String(item.quantity ?? 0));
    const cost = parseFloat(String(item.unitCost ?? 0));
    totalCost += qty * cost;
  }

  await db.update(internalConsumptionsTable)
    .set({ notes: notes ?? null, documentDate: documentDate ? new Date(documentDate) : doc.documentDate, totalCost: totalCost.toFixed(2) })
    .where(eq(internalConsumptionsTable.id, id));

  await db.delete(internalConsumptionItemsTable).where(eq(internalConsumptionItemsTable.documentId, id));
  for (const item of items) {
    const qty = parseFloat(String(item.quantity));
    const cost = parseFloat(String(item.unitCost ?? 0));
    await db.insert(internalConsumptionItemsTable).values({
      documentId: id,
      productId: parseInt(String(item.productId), 10),
      quantity: qty.toString(),
      unitId: item.unitId ? parseInt(String(item.unitId), 10) : null,
      unitCost: cost.toFixed(2),
      totalCost: (qty * cost).toFixed(2),
    } as any);
  }

  const [updated] = await db.select().from(internalConsumptionsTable).where(eq(internalConsumptionsTable.id, id));
  res.json(await buildDocResponse(updated, true));
});

// ── CONFIRM ───────────────────────────────────────────────────────────────────
router.post("/internal-consumptions/:id/confirm", requireAuth, requirePermission(P.internalConsumptions.confirm), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const [doc] = await db.select().from(internalConsumptionsTable).where(eq(internalConsumptionsTable.id, id));
  if (!doc) { res.status(404).json({ error: "Document introuvable" }); return; }
  if (doc.status !== "draft") {
    res.status(409).json({ error: `Impossible de confirmer un document au statut "${doc.status}"` }); return;
  }
  if (!assertBranchAccess(req.user!, doc.sourceBranchId, res)) return;

  const items = await db.select().from(internalConsumptionItemsTable).where(eq(internalConsumptionItemsTable.documentId, id));

  // Stock availability check
  const shortages: Array<{ productName: string; required: number; available: number }> = [];
  for (const item of items) {
    const required = parseFloat(item.quantity as string);
    const available = await getAvailableStock(item.productId, doc.sourceBranchId);
    if (available < required) {
      const [prod] = await db.select({ name: productsTable.name }).from(productsTable).where(eq(productsTable.id, item.productId));
      shortages.push({ productName: prod?.name ?? "?", required, available });
    }
  }
  if (shortages.length > 0) {
    res.status(409).json({ error: "stock_insufficient", message: "Stock insuffisant dans la succursale source", shortages });
    return;
  }

  // Apply stock movements
  for (const item of items) {
    const qty = parseFloat(item.quantity as string);
    const cost = parseFloat(item.unitCost as string);
    await adjustStock(item.productId, doc.sourceBranchId, -qty, "internal_consumption_out", doc.reference, cost, doc.id);
    await adjustStock(item.productId, doc.destinationBranchId, qty, "internal_consumption_in", doc.reference, cost, doc.id);
  }

  const [updated] = await db.update(internalConsumptionsTable)
    .set({ status: "confirmed" })
    .where(eq(internalConsumptionsTable.id, id))
    .returning();

  res.json(await buildDocResponse(updated, true));
});

// ── CANCEL ────────────────────────────────────────────────────────────────────
router.post("/internal-consumptions/:id/cancel", requireAuth, requirePermission(P.internalConsumptions.cancel), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const [doc] = await db.select().from(internalConsumptionsTable).where(eq(internalConsumptionsTable.id, id));
  if (!doc) { res.status(404).json({ error: "Document introuvable" }); return; }
  if (doc.status === "cancelled") {
    res.status(409).json({ error: "Document déjà annulé" }); return;
  }
  if (doc.status === "confirmed") {
    res.status(409).json({ error: "Impossible d'annuler un document confirmé. Veuillez créer un ajustement de correction." }); return;
  }
  if (!assertBranchAccess(req.user!, doc.sourceBranchId, res)) return;

  const [updated] = await db.update(internalConsumptionsTable)
    .set({ status: "cancelled" })
    .where(eq(internalConsumptionsTable.id, id))
    .returning();

  res.json(await buildDocResponse(updated, true));
});

// ── REPORTS ───────────────────────────────────────────────────────────────────
router.get("/internal-consumptions/reports/summary", requireAuth, requirePermission(P.internalConsumptions.view), async (req, res): Promise<void> => {
  const { dateFrom, dateTo, destinationBranchId, sourceBranchId } = req.query as Record<string, string>;
  const user = req.user!;

  const baseConditions: any[] = [eq(internalConsumptionsTable.status, "confirmed")];
  if (!user.adminAccess) {
    if (user.branchIds.length === 0) {
      res.json({ totalCost: 0, totalQty: 0, docCount: 0, byBranch: [], byProduct: [] }); return;
    }
    const ids = user.branchIds.join(",");
    baseConditions.push(sql`(${internalConsumptionsTable.sourceBranchId} = ANY(ARRAY[${sql.raw(ids)}]::int[]) OR ${internalConsumptionsTable.destinationBranchId} = ANY(ARRAY[${sql.raw(ids)}]::int[]))`);
  }
  if (sourceBranchId) baseConditions.push(eq(internalConsumptionsTable.sourceBranchId, parseInt(sourceBranchId, 10)));
  if (destinationBranchId) baseConditions.push(eq(internalConsumptionsTable.destinationBranchId, parseInt(destinationBranchId, 10)));
  if (dateFrom) baseConditions.push(gte(internalConsumptionsTable.documentDate, new Date(dateFrom)));
  if (dateTo) {
    const end = new Date(dateTo); end.setHours(23, 59, 59, 999);
    baseConditions.push(lte(internalConsumptionsTable.documentDate, end));
  }

  const docs = await db.select().from(internalConsumptionsTable).where(and(...baseConditions));
  const docIds = docs.map(d => d.id);

  const totalCost = docs.reduce((s, d) => s + parseFloat(d.totalCost as string), 0);
  const docCount = docs.length;

  if (docIds.length === 0) {
    res.json({ totalCost: 0, totalQty: 0, docCount: 0, byBranch: [], byProduct: [] });
    return;
  }

  const items = await db
    .select({
      item: internalConsumptionItemsTable,
      destinationBranchId: internalConsumptionsTable.destinationBranchId,
      productName: productsTable.name,
    })
    .from(internalConsumptionItemsTable)
    .innerJoin(internalConsumptionsTable, eq(internalConsumptionItemsTable.documentId, internalConsumptionsTable.id))
    .leftJoin(productsTable, eq(internalConsumptionItemsTable.productId, productsTable.id))
    .where(inArray(internalConsumptionItemsTable.documentId, docIds));

  const totalQty = items.reduce((s, i) => s + parseFloat(i.item.quantity as string), 0);

  // By destination branch
  const byBranchMap: Record<number, { branchId: number; totalCost: number; totalQty: number; docCount: number }> = {};
  for (const doc of docs) {
    const b = byBranchMap[doc.destinationBranchId] ?? { branchId: doc.destinationBranchId, totalCost: 0, totalQty: 0, docCount: 0 };
    b.totalCost += parseFloat(doc.totalCost as string);
    b.docCount += 1;
    byBranchMap[doc.destinationBranchId] = b;
  }
  for (const item of items) {
    const b = byBranchMap[item.destinationBranchId];
    if (b) b.totalQty += parseFloat(item.item.quantity as string);
  }

  const branches = await db.select({ id: branchesTable.id, name: branchesTable.name }).from(branchesTable);
  const branchNames: Record<number, string> = Object.fromEntries(branches.map(b => [b.id, b.name]));

  const byBranch = Object.values(byBranchMap).map(b => ({
    ...b,
    branchName: branchNames[b.branchId] ?? String(b.branchId),
  })).sort((a, b) => b.totalCost - a.totalCost);

  // By product
  const byProductMap: Record<number, { productId: number; productName: string; totalCost: number; totalQty: number }> = {};
  for (const item of items) {
    const pid = item.item.productId;
    const p = byProductMap[pid] ?? { productId: pid, productName: item.productName ?? "?", totalCost: 0, totalQty: 0 };
    p.totalCost += parseFloat(item.item.totalCost as string);
    p.totalQty += parseFloat(item.item.quantity as string);
    byProductMap[pid] = p;
  }
  const byProduct = Object.values(byProductMap).sort((a, b) => b.totalCost - a.totalCost);

  res.json({ totalCost, totalQty, docCount, byBranch, byProduct });
});

export default router;
