import { Router, type IRouter } from "express";
import {
  db, purchasesTable, purchaseItemsTable,
  purchaseReturnsTable, purchaseReturnItemsTable,
  contactsTable, branchesTable, productsTable, unitsTable, usersTable
} from "@workspace/db";
import { eq, and, inArray, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, assertBranchAccess, visibleBranchIds } from "../middlewares/permissions";
import { P } from "../lib/permissions";
import { adjustStock } from "./stock";

const router: IRouter = Router();

function genRef() {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `RTA${y}${m}${d}-${rand}`;
}

async function buildReturnResponse(ret: typeof purchaseReturnsTable.$inferSelect) {
  const items = await db.select({
    ri: purchaseReturnItemsTable,
    productName: productsTable.name,
    productReference: productsTable.reference,
    unitName: unitsTable.name,
  })
    .from(purchaseReturnItemsTable)
    .leftJoin(productsTable, eq(purchaseReturnItemsTable.productId, productsTable.id))
    .leftJoin(unitsTable, eq(productsTable.unitId, unitsTable.id))
    .where(eq(purchaseReturnItemsTable.returnId, ret.id));

  const [purchase] = ret.purchaseId
    ? await db.select().from(purchasesTable).where(eq(purchasesTable.id, ret.purchaseId))
    : [null];
  const [supplier] = await db.select().from(contactsTable).where(eq(contactsTable.id, ret.supplierId));
  const [branch] = await db.select().from(branchesTable).where(eq(branchesTable.id, ret.branchId));
  const [creator] = ret.createdByUserId
    ? await db.select().from(usersTable).where(eq(usersTable.id, ret.createdByUserId))
    : [null];

  return {
    ...ret,
    supplierName: supplier?.displayName ?? null,
    branchName: branch?.name ?? null,
    createdByName: creator?.name ?? null,
    purchaseReference: purchase?.reference ?? null,
    items: items.map(i => ({
      id: i.ri.id,
      productId: i.ri.productId,
      productName: i.productName,
      productReference: i.productReference,
      unitName: i.unitName,
      purchaseItemId: i.ri.purchaseItemId,
      quantity: parseFloat(i.ri.quantity as string),
      unitCost: parseFloat(i.ri.unitCost as string),
      totalAmount: parseFloat(i.ri.totalAmount as string),
      reason: i.ri.reason,
    })),
  };
}

router.get("/purchase-returns", requireAuth, requirePermission(P.purchaseReturns.view), async (req, res): Promise<void> => {
  const { branchId, status, supplierId } = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);
  if (scope !== null && scope.length === 0) { res.json([]); return; }

  const conds: any[] = [];
  if (scope !== null) conds.push(inArray(purchaseReturnsTable.branchId, scope));
  if (branchId && branchId !== "all") conds.push(eq(purchaseReturnsTable.branchId, parseInt(branchId, 10)));
  if (status) conds.push(eq(purchaseReturnsTable.status, status));
  if (supplierId) conds.push(eq(purchaseReturnsTable.supplierId, parseInt(supplierId, 10)));

  const rows = await db.select().from(purchaseReturnsTable)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(purchaseReturnsTable.createdAt));

  const suppliers = await db.select().from(contactsTable);
  const branches = await db.select().from(branchesTable);

  const enriched = rows.map(r => ({
    ...r,
    supplierName: suppliers.find(s => s.id === r.supplierId)?.displayName ?? null,
    branchName: branches.find(b => b.id === r.branchId)?.name ?? null,
    totalAmount: parseFloat(r.totalAmount as string),
  }));

  res.json(enriched);
});

router.get("/purchase-returns/:id", requireAuth, requirePermission(P.purchaseReturns.view), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const [ret] = await db.select().from(purchaseReturnsTable).where(eq(purchaseReturnsTable.id, id));
  if (!ret) { res.status(404).json({ error: "Retour introuvable" }); return; }
  if (!assertBranchAccess(req.user!, ret.branchId, res)) return;
  res.json(await buildReturnResponse(ret));
});

router.post("/purchase-returns", requireAuth, requirePermission(P.purchaseReturns.create), async (req, res): Promise<void> => {
  const { purchaseId, branchId, supplierId, reason, notes, items } = req.body as {
    purchaseId: number;
    branchId: number;
    supplierId: number;
    reason?: string;
    notes?: string;
    items: { productId: number; purchaseItemId?: number; quantity: number; unitCost: number; reason?: string }[];
  };

  if (!branchId || !supplierId || !items?.length) {
    res.status(400).json({ error: "Champs requis: branchId, supplierId, items" }); return;
  }
  if (!assertBranchAccess(req.user!, branchId, res)) return;

  if (purchaseId) {
    const [purchase] = await db.select().from(purchasesTable).where(eq(purchasesTable.id, purchaseId));
    if (!purchase) { res.status(404).json({ error: "Achat introuvable" }); return; }
    if (purchase.status === "cancelled") { res.status(400).json({ error: "Impossible de créer un retour sur un achat annulé" }); return; }

    const purchaseItems = await db.select().from(purchaseItemsTable).where(eq(purchaseItemsTable.purchaseId, purchaseId));

    const existingReturns = await db.select({ ri: purchaseReturnItemsTable })
      .from(purchaseReturnItemsTable)
      .innerJoin(purchaseReturnsTable, eq(purchaseReturnItemsTable.returnId, purchaseReturnsTable.id))
      .where(and(
        eq(purchaseReturnsTable.purchaseId, purchaseId),
        inArray(purchaseReturnsTable.status, ["draft", "confirmed"])
      ));

    for (const item of items) {
      if (!item.purchaseItemId) continue;
      const pi = purchaseItems.find(p => p.id === item.purchaseItemId);
      if (!pi) { res.status(400).json({ error: `Article d'achat introuvable: ${item.purchaseItemId}` }); return; }

      const alreadyReturned = existingReturns
        .filter(r => r.ri.purchaseItemId === item.purchaseItemId)
        .reduce((sum, r) => sum + parseFloat(r.ri.quantity as string), 0);
      const maxReturnable = parseFloat(pi.receivedQuantity as string) - alreadyReturned;

      if (item.quantity > maxReturnable + 0.001) {
        res.status(400).json({ error: `Quantité retournée (${item.quantity}) supérieure au maximum autorisé (${maxReturnable.toFixed(3)}) pour l'article ${pi.id}` }); return;
      }
    }
  }

  const totalAmount = items.reduce((s, i) => s + i.quantity * i.unitCost, 0);

  const [ret] = await db.insert(purchaseReturnsTable).values({
    reference: genRef(),
    purchaseId: purchaseId ?? null,
    branchId,
    supplierId,
    status: "draft",
    reason: reason ?? null,
    notes: notes ?? null,
    totalAmount: totalAmount.toString(),
    createdByUserId: req.user!.id,
  }).returning();

  for (const item of items) {
    const lineTotal = item.quantity * item.unitCost;
    await db.insert(purchaseReturnItemsTable).values({
      returnId: ret.id,
      productId: item.productId,
      purchaseItemId: item.purchaseItemId ?? null,
      quantity: item.quantity.toString(),
      unitCost: item.unitCost.toString(),
      totalAmount: lineTotal.toString(),
      reason: item.reason ?? null,
    });
  }

  res.status(201).json(await buildReturnResponse(ret));
});

router.post("/purchase-returns/:id/confirm", requireAuth, requirePermission(P.purchaseReturns.confirm), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const [ret] = await db.select().from(purchaseReturnsTable).where(eq(purchaseReturnsTable.id, id));
  if (!ret) { res.status(404).json({ error: "Retour introuvable" }); return; }
  if (ret.status !== "draft") { res.status(400).json({ error: "Seuls les retours en brouillon peuvent être confirmés" }); return; }
  if (!assertBranchAccess(req.user!, ret.branchId, res)) return;

  const items = await db.select({
    ri: purchaseReturnItemsTable,
  }).from(purchaseReturnItemsTable).where(eq(purchaseReturnItemsTable.returnId, id));

  for (const item of items) {
    await adjustStock(
      item.ri.productId,
      ret.branchId,
      -parseFloat(item.ri.quantity as string),
      "purchase_return",
      ret.reference,
      parseFloat(item.ri.unitCost as string),
      ret.id
    );
  }

  if (ret.purchaseId) {
    const [purchase] = await db.select().from(purchasesTable).where(eq(purchasesTable.id, ret.purchaseId));
    if (purchase) {
      const returnAmount = parseFloat(ret.totalAmount as string);
      const currentPaid = parseFloat(purchase.paid as string);
      const total = parseFloat(purchase.total as string);
      const newPaid = Math.min(total, currentPaid + returnAmount);
      const newPaymentStatus = newPaid >= total ? "paid" : newPaid > 0 ? "partially_paid" : "unpaid";
      await db.update(purchasesTable).set({ paid: newPaid.toString(), paymentStatus: newPaymentStatus }).where(eq(purchasesTable.id, ret.purchaseId));
    }
  }

  const [updated] = await db.update(purchaseReturnsTable)
    .set({ status: "confirmed", confirmedAt: new Date() })
    .where(eq(purchaseReturnsTable.id, id))
    .returning();

  res.json(await buildReturnResponse(updated));
});

router.post("/purchase-returns/:id/cancel", requireAuth, requirePermission(P.purchaseReturns.cancel), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const [ret] = await db.select().from(purchaseReturnsTable).where(eq(purchaseReturnsTable.id, id));
  if (!ret) { res.status(404).json({ error: "Retour introuvable" }); return; }
  if (ret.status === "confirmed") { res.status(400).json({ error: "Un retour confirmé ne peut pas être annulé" }); return; }
  if (ret.status === "cancelled") { res.status(400).json({ error: "Ce retour est déjà annulé" }); return; }
  if (!assertBranchAccess(req.user!, ret.branchId, res)) return;

  const [updated] = await db.update(purchaseReturnsTable)
    .set({ status: "cancelled" })
    .where(eq(purchaseReturnsTable.id, id))
    .returning();

  res.json(await buildReturnResponse(updated));
});

export default router;
