import { Router, type IRouter } from "express";
import {
  db, purchaseReceptionsTable, purchaseReceptionItemsTable,
  purchasesTable, purchaseItemsTable, contactsTable,
  branchesTable, productsTable, unitsTable, usersTable,
} from "@workspace/db";
import { eq, and, inArray, gte, lte, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, visibleBranchIds } from "../middlewares/permissions";
import { P } from "../lib/permissions";

const router: IRouter = Router();

async function buildReceptionDetail(r: typeof purchaseReceptionsTable.$inferSelect) {
  const [purchase] = await db.select({
    reference: purchasesTable.reference,
    supplierId: purchasesTable.supplierId,
  }).from(purchasesTable).where(eq(purchasesTable.id, r.purchaseId));

  const [branch] = await db.select({ name: branchesTable.name })
    .from(branchesTable).where(eq(branchesTable.id, r.branchId));

  let supplierName = "";
  if (purchase?.supplierId) {
    const [supplier] = await db.select({ displayName: contactsTable.displayName })
      .from(contactsTable).where(eq(contactsTable.id, purchase.supplierId));
    supplierName = supplier?.displayName ?? "";
  }

  let createdByName: string | null = null;
  if (r.createdByUserId) {
    const [u] = await db.select({ name: usersTable.name })
      .from(usersTable).where(eq(usersTable.id, r.createdByUserId));
    createdByName = u?.name ?? null;
  }

  const rawItems = await db.select({
    ri: purchaseReceptionItemsTable,
    productName: productsTable.name,
    productUnit: unitsTable.abbreviation,
    unitCost: purchaseItemsTable.unitCost,
  })
    .from(purchaseReceptionItemsTable)
    .leftJoin(productsTable, eq(purchaseReceptionItemsTable.productId, productsTable.id))
    .leftJoin(unitsTable, eq(productsTable.unitId, unitsTable.id))
    .leftJoin(purchaseItemsTable, eq(purchaseReceptionItemsTable.purchaseItemId, purchaseItemsTable.id))
    .where(eq(purchaseReceptionItemsTable.receptionId, r.id));

  const items = rawItems.map(i => ({
    id: i.ri.id,
    productId: i.ri.productId,
    productName: i.productName ?? "",
    productUnit: i.productUnit ?? "unité",
    quantityReceived: parseFloat(i.ri.quantityReceived as string),
    quantityRejected: parseFloat(i.ri.quantityRejected as string),
    unitCost: i.unitCost ? parseFloat(i.unitCost as string) : null,
    totalCost: i.unitCost ? parseFloat(i.ri.quantityReceived as string) * parseFloat(i.unitCost as string) : null,
    notes: i.ri.notes ?? null,
  }));

  const totalReceived = items.reduce((s, i) => s + i.quantityReceived, 0);
  const totalCost = items.reduce((s, i) => s + (i.totalCost ?? 0), 0);

  return {
    id: r.id,
    purchaseId: r.purchaseId,
    purchaseReference: purchase?.reference ?? "",
    supplierId: purchase?.supplierId ?? null,
    supplierName,
    branchId: r.branchId,
    branchName: branch?.name ?? "",
    createdByName,
    createdAt: r.createdAt,
    notes: r.notes ?? null,
    items,
    itemCount: items.length,
    totalReceived,
    totalCost,
  };
}

/* ── GET /receptions ──────────────────────────────────────────────────────── */
router.get("/receptions", requireAuth, requirePermission(P.purchases.view), async (req, res): Promise<void> => {
  const { branchId, dateFrom, dateTo, supplierId } = req.query as Record<string, string>;
  const user = req.user!;
  const branchScope = visibleBranchIds(user);

  const conditions: ReturnType<typeof eq>[] = [];

  if (branchScope !== null) {
    if (branchScope.length === 0) { res.json([]); return; }
    if (branchId) {
      const bid = parseInt(branchId, 10);
      if (!branchScope.includes(bid)) { res.status(403).json({ error: "Accès refusé à cette succursale" }); return; }
      conditions.push(eq(purchaseReceptionsTable.branchId, bid) as any);
    } else {
      conditions.push(inArray(purchaseReceptionsTable.branchId, branchScope) as any);
    }
  } else if (branchId) {
    conditions.push(eq(purchaseReceptionsTable.branchId, parseInt(branchId, 10)) as any);
  }

  if (dateFrom) conditions.push(gte(purchaseReceptionsTable.createdAt, new Date(dateFrom)) as any);
  if (dateTo) {
    const end = new Date(dateTo);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(purchaseReceptionsTable.createdAt, end) as any);
  }

  const receptions = conditions.length
    ? await db.select().from(purchaseReceptionsTable).where(and(...(conditions as any))).orderBy(sql`${purchaseReceptionsTable.createdAt} DESC`)
    : await db.select().from(purchaseReceptionsTable).orderBy(sql`${purchaseReceptionsTable.createdAt} DESC`);

  let result = await Promise.all(receptions.map(r => buildReceptionDetail(r)));

  if (supplierId) {
    const sid = parseInt(supplierId, 10);
    result = result.filter(r => r.supplierId === sid);
  }

  res.json(result);
});

/* ── GET /receptions/:id ──────────────────────────────────────────────────── */
router.get("/receptions/:id", requireAuth, requirePermission(P.purchases.view), async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [r] = await db.select().from(purchaseReceptionsTable).where(eq(purchaseReceptionsTable.id, id));
  if (!r) { res.status(404).json({ error: "Réception introuvable" }); return; }

  const user = req.user!;
  const branchScope = visibleBranchIds(user);
  if (branchScope !== null && !branchScope.includes(r.branchId)) {
    res.status(403).json({ error: "Accès refusé" }); return;
  }

  res.json(await buildReceptionDetail(r));
});

export default router;
