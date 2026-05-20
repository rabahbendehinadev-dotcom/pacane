import { Router, type IRouter } from "express";
import {
  db, purchasesTable, purchaseItemsTable, purchasePaymentsTable,
  purchaseReceptionsTable, purchaseReceptionItemsTable,
  contactsTable, branchesTable, productsTable, unitsTable, usersTable
} from "@workspace/db";
import { eq, and, sql, inArray, or } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, assertBranchAccess, visibleBranchIds } from "../middlewares/permissions";
import { P } from "../lib/permissions";
import { adjustStock } from "./stock";

const router: IRouter = Router();

function genRef() {
  const d = new Date();
  return `BON-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
}

async function buildPurchaseResponse(purchase: typeof purchasesTable.$inferSelect, includeReceptions = false) {
  const [supplier] = await db.select().from(contactsTable).where(eq(contactsTable.id, purchase.supplierId));
  const [branch] = await db.select().from(branchesTable).where(eq(branchesTable.id, purchase.branchId));

  const rawItems = await db.select({
    pi: purchaseItemsTable,
    productName: productsTable.name,
    productUnit: unitsTable.abbreviation,
  })
    .from(purchaseItemsTable)
    .leftJoin(productsTable, eq(purchaseItemsTable.productId, productsTable.id))
    .leftJoin(unitsTable, eq(productsTable.unitId, unitsTable.id))
    .where(eq(purchaseItemsTable.purchaseId, purchase.id));

  let createdByName: string | null = null;
  if (purchase.createdByUserId) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, purchase.createdByUserId));
    createdByName = u?.name ?? null;
  }

  const payments = await db.select().from(purchasePaymentsTable)
    .where(eq(purchasePaymentsTable.purchaseId, purchase.id))
    .orderBy(purchasePaymentsTable.createdAt);

  const items = rawItems.map(i => {
    const ordered = parseFloat(i.pi.quantity as string);
    const received = parseFloat(i.pi.receivedQuantity as string);
    const rejected = parseFloat((i.pi as any).rejectedQuantity as string ?? "0");
    const remaining = Math.max(0, ordered - received - rejected);
    return {
      id: i.pi.id,
      purchaseId: i.pi.purchaseId,
      productId: i.pi.productId,
      productName: i.productName ?? "",
      productUnit: i.productUnit ?? "unité",
      quantity: ordered,
      receivedQuantity: received,
      rejectedQuantity: rejected,
      remainingQuantity: remaining,
      unitCost: parseFloat(i.pi.unitCost as string),
      total: parseFloat(i.pi.total as string),
      notes: i.pi.notes ?? null,
      fullyReceived: remaining === 0,
    };
  });

  let receptions: any[] = [];
  if (includeReceptions) {
    const rawReceptions = await db.select().from(purchaseReceptionsTable)
      .where(eq(purchaseReceptionsTable.purchaseId, purchase.id))
      .orderBy(sql`${purchaseReceptionsTable.createdAt} DESC`);

    receptions = await Promise.all(rawReceptions.map(async r => {
      const [rBranch] = await db.select({ name: branchesTable.name }).from(branchesTable).where(eq(branchesTable.id, r.branchId));
      let rUserName: string | null = null;
      if (r.createdByUserId) {
        const [ru] = await db.select().from(usersTable).where(eq(usersTable.id, r.createdByUserId));
        rUserName = ru?.name ?? null;
      }
      const rItems = await db.select({
        ri: purchaseReceptionItemsTable,
        productName: productsTable.name,
        productUnit: unitsTable.abbreviation,
      })
        .from(purchaseReceptionItemsTable)
        .leftJoin(productsTable, eq(purchaseReceptionItemsTable.productId, productsTable.id))
        .leftJoin(unitsTable, eq(productsTable.unitId, unitsTable.id))
        .where(eq(purchaseReceptionItemsTable.receptionId, r.id));

      return {
        id: r.id,
        purchaseId: r.purchaseId,
        branchId: r.branchId,
        branchName: rBranch?.name ?? "",
        notes: r.notes,
        createdByName: rUserName,
        createdAt: r.createdAt,
        items: rItems.map(ri => ({
          id: ri.ri.id,
          productId: ri.ri.productId,
          productName: ri.productName ?? "",
          productUnit: ri.productUnit ?? "unité",
          quantityReceived: parseFloat(ri.ri.quantityReceived as string),
          quantityRejected: parseFloat(ri.ri.quantityRejected as string),
          notes: ri.ri.notes,
        })),
      };
    }));
  }

  const totalOrdered = items.reduce((s, i) => s + i.quantity, 0);
  const totalReceived = items.reduce((s, i) => s + i.receivedQuantity, 0);
  const totalRemaining = items.reduce((s, i) => s + i.remainingQuantity, 0);

  return {
    ...purchase,
    supplierName: supplier?.displayName ?? "",
    supplierPhone: supplier?.phone ?? null,
    branchName: branch?.name ?? "",
    subtotal: parseFloat(purchase.subtotal as string),
    discount: parseFloat(purchase.discount as string),
    tax: parseFloat(purchase.tax as string),
    total: parseFloat(purchase.total as string),
    paid: parseFloat(purchase.paid as string),
    due: parseFloat(purchase.total as string) - parseFloat(purchase.paid as string),
    notes: purchase.notes,
    createdByName,
    items,
    payments: payments.map(p => ({
      id: p.id,
      amount: parseFloat(p.amount as string),
      method: p.method,
      date: p.date,
      notes: p.notes,
      createdAt: p.createdAt,
    })),
    receptions,
    stats: { totalOrdered, totalReceived, totalRemaining, receptionCount: receptions.length },
  };
}

function deriveReceptionStatus(items: { quantity: number; receivedQuantity: number; remainingQuantity: number }[]): string {
  if (items.length === 0) return "ordered";
  const totalOrdered = items.reduce((s, i) => s + i.quantity, 0);
  const totalReceived = items.reduce((s, i) => s + i.receivedQuantity, 0);
  if (totalReceived === 0) return "ordered";
  if (totalReceived >= totalOrdered) return "received";
  return "partially_received";
}

router.get("/purchases", requireAuth, requirePermission(P.purchases.view), async (req, res): Promise<void> => {
  const { branchId, supplierId, status, paymentStatus } = req.query as Record<string, string>;
  const user = req.user!;
  const conditions = [];
  const reqBranchId = branchId ? parseInt(branchId, 10) : null;
  if (!user.adminAccess) {
    if (user.branchIds.length === 0) { res.json([]); return; }
    if (reqBranchId) {
      if (!user.branchIds.includes(reqBranchId)) { res.status(403).json({ error: "Accès refusé à cette succursale", code: "BRANCH_ACCESS_DENIED" }); return; }
      conditions.push(eq(purchasesTable.branchId, reqBranchId));
    } else {
      conditions.push(inArray(purchasesTable.branchId, user.branchIds));
    }
  } else if (reqBranchId) {
    conditions.push(eq(purchasesTable.branchId, reqBranchId));
  }
  if (supplierId) conditions.push(eq(purchasesTable.supplierId, parseInt(supplierId, 10)));
  if (status) conditions.push(eq(purchasesTable.status, status));
  if (paymentStatus) conditions.push(eq(purchasesTable.paymentStatus, paymentStatus));
  const purchases = conditions.length
    ? await db.select().from(purchasesTable).where(and(...conditions)).orderBy(sql`${purchasesTable.createdAt} DESC`)
    : await db.select().from(purchasesTable).orderBy(sql`${purchasesTable.createdAt} DESC`);
  const result = await Promise.all(purchases.map(p => buildPurchaseResponse(p, false)));
  res.json(result);
});

router.post("/purchases", requireAuth, requirePermission(P.purchases.create), async (req, res): Promise<void> => {
  const { supplierId, branchId, status, discount, tax, notes, items, isPaid } = req.body;
  if (!supplierId || !branchId || !items?.length) { res.status(400).json({ error: "Champs requis manquants" }); return; }
  if (!assertBranchAccess(req.user!, parseInt(String(branchId), 10), res)) return;
  const subtotal = items.reduce((s: number, i: any) => s + i.quantity * i.unitCost, 0);
  const d = discount ?? 0; const t = tax ?? 0;
  const total = subtotal - d + t;
  const finalStatus = status ?? "draft";
  const paidAmount = isPaid ? total : 0;
  const payStatus = isPaid ? "paid" : "unpaid";
  const [purchase] = await db.insert(purchasesTable).values({
    reference: genRef(), supplierId, branchId, status: finalStatus,
    paymentStatus: payStatus, subtotal: subtotal.toString(), discount: d.toString(),
    tax: t.toString(), total: total.toString(), paid: paidAmount.toString(), notes, createdByUserId: req.userId
  }).returning();

  for (const item of items) {
    const received = finalStatus === "received" ? item.quantity.toString() : "0";
    await db.insert(purchaseItemsTable).values({
      purchaseId: purchase.id, productId: item.productId,
      quantity: item.quantity.toString(), receivedQuantity: received, rejectedQuantity: "0",
      unitCost: item.unitCost.toString(), total: (item.quantity * item.unitCost).toString()
    } as any);
  }

  // If created as "received", immediately adjust stock for all items
  if (finalStatus === "received") {
    for (const item of items) {
      await adjustStock(
        item.productId, branchId, item.quantity,
        "purchase_receipt", purchase.reference,
        item.unitCost, purchase.id
      );
    }
  }

  res.status(201).json(await buildPurchaseResponse(purchase, false));
});

router.get("/purchases/:id", requireAuth, requirePermission(P.purchases.view), async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [purchase] = await db.select().from(purchasesTable).where(eq(purchasesTable.id, id));
  if (!purchase) { res.status(404).json({ error: "Achat introuvable" }); return; }
  if (!assertBranchAccess(req.user!, purchase.branchId, res)) return;
  res.json(await buildPurchaseResponse(purchase, true));
});

router.patch("/purchases/:id", requireAuth, requirePermission(P.purchases.edit), async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [existing] = await db.select().from(purchasesTable).where(eq(purchasesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Achat introuvable" }); return; }
  if (!assertBranchAccess(req.user!, existing.branchId, res)) return;
  const { status, notes } = req.body;
  const updates: Record<string, unknown> = {};
  if (status != null) updates.status = status;
  if (notes != null) updates.notes = notes;
  const [purchase] = await db.update(purchasesTable).set(updates as any).where(eq(purchasesTable.id, id)).returning();
  if (!purchase) { res.status(404).json({ error: "Achat introuvable" }); return; }
  res.json(await buildPurchaseResponse(purchase, true));
});

router.post("/purchases/:id/receive", requireAuth, requirePermission(P.purchases.receive), async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [purchase] = await db.select().from(purchasesTable).where(eq(purchasesTable.id, id));
  if (!purchase) { res.status(404).json({ error: "Achat introuvable" }); return; }
  if (!assertBranchAccess(req.user!, purchase.branchId, res)) return;
  if (purchase.status === "cancelled") { res.status(400).json({ error: "Achat annulé" }); return; }
  if (purchase.status === "received") { res.status(400).json({ error: "Achat déjà entièrement reçu" }); return; }

  const { items, notes } = req.body as {
    items: { purchaseItemId: number; quantityReceived: number; quantityRejected?: number; notes?: string }[];
    notes?: string;
  };
  if (!items?.length) { res.status(400).json({ error: "Aucun article à réceptionner" }); return; }

  const purchaseItems = await db.select().from(purchaseItemsTable).where(eq(purchaseItemsTable.purchaseId, id));
  const itemMap = Object.fromEntries(purchaseItems.map(pi => [pi.id, pi]));

  for (const item of items) {
    const pi = itemMap[item.purchaseItemId];
    if (!pi) { res.status(400).json({ error: `Article introuvable: ${item.purchaseItemId}` }); return; }
    const ordered = parseFloat(pi.quantity as string);
    const alreadyReceived = parseFloat(pi.receivedQuantity as string);
    const alreadyRejected = parseFloat((pi as any).rejectedQuantity as string ?? "0");
    const remaining = ordered - alreadyReceived - alreadyRejected;
    const incomingReceived = item.quantityReceived ?? 0;
    const incomingRejected = item.quantityRejected ?? 0;
    if (incomingReceived < 0 || incomingRejected < 0) { res.status(400).json({ error: "Quantités négatives interdites" }); return; }
    if (incomingReceived + incomingRejected > remaining + 0.001) {
      res.status(400).json({ error: `Sur-réception impossible pour ${pi.id}: restant=${remaining.toFixed(3)}` }); return;
    }
  }

  const [reception] = await db.insert(purchaseReceptionsTable).values({
    purchaseId: id,
    branchId: purchase.branchId,
    notes: notes ?? null,
    createdByUserId: req.userId ?? null,
  }).returning();

  for (const item of items) {
    const pi = itemMap[item.purchaseItemId];
    if (!pi) continue;
    const qReceived = item.quantityReceived ?? 0;
    const qRejected = item.quantityRejected ?? 0;
    if (qReceived <= 0 && qRejected <= 0) continue;

    await db.insert(purchaseReceptionItemsTable).values({
      receptionId: reception.id,
      purchaseItemId: pi.id,
      productId: pi.productId,
      quantityReceived: qReceived.toString(),
      quantityRejected: qRejected.toString(),
      notes: item.notes ?? null,
    });

    const newReceived = parseFloat(pi.receivedQuantity as string) + qReceived;
    const newRejected = parseFloat((pi as any).rejectedQuantity as string ?? "0") + qRejected;
    await db.update(purchaseItemsTable).set({
      receivedQuantity: newReceived.toString(),
      rejectedQuantity: newRejected.toString(),
    } as any).where(eq(purchaseItemsTable.id, pi.id));

    if (qReceived > 0) {
      await adjustStock(
        pi.productId,
        purchase.branchId,
        qReceived,
        "purchase_receipt",
        purchase.reference,
        parseFloat(pi.unitCost as string),
        purchase.id
      );
    }
  }

  const updatedItems = await db.select().from(purchaseItemsTable).where(eq(purchaseItemsTable.purchaseId, id));
  const itemsForStatus = updatedItems.map(i => ({
    quantity: parseFloat(i.quantity as string),
    receivedQuantity: parseFloat(i.receivedQuantity as string),
    rejectedQuantity: parseFloat((i as any).rejectedQuantity as string ?? "0"),
    remainingQuantity: Math.max(0, parseFloat(i.quantity as string) - parseFloat(i.receivedQuantity as string) - parseFloat((i as any).rejectedQuantity as string ?? "0")),
  }));
  const newStatus = deriveReceptionStatus(itemsForStatus);

  const [updated] = await db.update(purchasesTable)
    .set({ status: newStatus })
    .where(eq(purchasesTable.id, id))
    .returning();

  res.json(await buildPurchaseResponse(updated, true));
});

router.post("/purchases/:id/payment", requireAuth, requirePermission(P.purchases.pay), async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [purchase] = await db.select().from(purchasesTable).where(eq(purchasesTable.id, id));
  if (!purchase) { res.status(404).json({ error: "Achat introuvable" }); return; }
  if (!assertBranchAccess(req.user!, purchase.branchId, res)) return;
  const { amount, method, date, notes } = req.body;
  if (!amount || !method || !date) { res.status(400).json({ error: "Champs requis manquants" }); return; }
  await db.insert(purchasePaymentsTable).values({ purchaseId: id, amount: amount.toString(), method, date, notes });
  const newPaid = parseFloat(purchase.paid as string) + parseFloat(amount.toString());
  const total = parseFloat(purchase.total as string);
  const paymentStatus = newPaid >= total ? "paid" : newPaid > 0 ? "partially_paid" : "unpaid";
  const [updated] = await db.update(purchasesTable).set({ paid: newPaid.toString(), paymentStatus }).where(eq(purchasesTable.id, id)).returning();
  res.json(await buildPurchaseResponse(updated, true));
});

router.post("/purchases/:id/cancel", requireAuth, requirePermission(P.purchases.cancel), async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [purchase] = await db.select().from(purchasesTable).where(eq(purchasesTable.id, id));
  if (!purchase) { res.status(404).json({ error: "Achat introuvable" }); return; }
  if (!assertBranchAccess(req.user!, purchase.branchId, res)) return;
  if (purchase.status === "received") { res.status(400).json({ error: "Impossible d'annuler un achat entièrement reçu" }); return; }
  const [updated] = await db.update(purchasesTable).set({ status: "cancelled" }).where(eq(purchasesTable.id, id)).returning();
  res.json(await buildPurchaseResponse(updated, true));
});

export default router;
