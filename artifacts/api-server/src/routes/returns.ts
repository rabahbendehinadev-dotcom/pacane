import { Router, type IRouter } from "express";
import { db, salesReturnsTable, salesReturnItemsTable, salesTable, saleItemsTable, contactsTable, branchesTable, productsTable, usersTable, customerWalletMovementsTable } from "@workspace/db";
import { eq, and, sql, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, requireAnyPermission, assertBranchAccess, visibleBranchIds } from "../middlewares/permissions";
import { P } from "../lib/permissions";
import { adjustStock } from "./stock";

const router: IRouter = Router();

let returnCounter = -1;
async function ensureCounter() {
  if (returnCounter >= 0) return;
  const [row] = await db
    .select({ ref: salesReturnsTable.reference })
    .from(salesReturnsTable)
    .where(sql`${salesReturnsTable.reference} LIKE ${"RET-%"}`)
    .orderBy(sql`CAST(SPLIT_PART(${salesReturnsTable.reference}, '-', 2) AS INTEGER) DESC`)
    .limit(1);
  returnCounter = row ? parseInt(row.ref.split("-")[1]) : 1000;
}
async function genRef(): Promise<string> {
  await ensureCounter();
  return `RET-${++returnCounter}`;
}

async function buildReturnResponse(ret: typeof salesReturnsTable.$inferSelect) {
  const [sale] = await db.select({ reference: salesTable.reference })
    .from(salesTable).where(eq(salesTable.id, ret.saleId));
  let customerName: string | null = null;
  if (ret.customerId) {
    const [c] = await db.select().from(contactsTable).where(eq(contactsTable.id, ret.customerId));
    customerName = c?.displayName ?? null;
  }
  const [branch] = await db.select().from(branchesTable).where(eq(branchesTable.id, ret.branchId));
  let createdByName: string | null = null;
  if (ret.createdByUserId) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, ret.createdByUserId));
    createdByName = u?.name ?? null;
  }
  const items = await db.select().from(salesReturnItemsTable)
    .where(eq(salesReturnItemsTable.returnId, ret.id));
  return {
    ...ret,
    saleReference: sale?.reference ?? "",
    customerName,
    branchName: branch?.name ?? "",
    createdByName,
    totalAmount: parseFloat(ret.totalAmount as string),
    refundedAmount: parseFloat(ret.refundedAmount as string),
    creditAmount: parseFloat((ret.creditAmount ?? "0") as string),
    refundDue: Math.max(0, parseFloat(ret.totalAmount as string) - parseFloat(ret.refundedAmount as string) - parseFloat((ret.creditAmount ?? "0") as string)),
    items: items.map(i => ({
      ...i,
      quantity: parseFloat(i.quantity as string),
      unitPrice: parseFloat(i.unitPrice as string),
      total: parseFloat(i.total as string),
    })),
  };
}

/* ── GET /returns ── list ──────────────────────────────────────────────── */
router.get("/returns", requireAuth, requireAnyPermission(P.returns.view, P.pos.refund), async (req, res): Promise<void> => {
  const { branchId, status, customerId } = req.query as Record<string, string>;
  const user = req.user!;
  const allowed = visibleBranchIds(user);

  const rows = await db.select().from(salesReturnsTable)
    .orderBy(sql`${salesReturnsTable.createdAt} DESC`);

  let result = rows;
  if (allowed !== null) result = result.filter(r => allowed.includes(r.branchId));
  if (branchId && branchId !== "all") result = result.filter(r => r.branchId === parseInt(branchId, 10));
  if (status && status !== "all") result = result.filter(r => r.status === status);
  if (customerId) result = result.filter(r => r.customerId === parseInt(customerId, 10));

  const enriched = await Promise.all(result.map(r => buildReturnResponse(r)));
  res.json(enriched);
});

/* ── GET /returns/:id ── detail ────────────────────────────────────────── */
router.get("/returns/:id", requireAuth, requireAnyPermission(P.returns.view, P.pos.refund), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [ret] = await db.select().from(salesReturnsTable).where(eq(salesReturnsTable.id, id));
  if (!ret) { res.status(404).json({ error: "Retour introuvable" }); return; }
  const allowed = visibleBranchIds(req.user!);
  if (allowed !== null && !allowed.includes(ret.branchId)) { res.status(403).json({ error: "Accès refusé" }); return; }
  res.json(await buildReturnResponse(ret));
});

/* ── GET /sales/:id/returnable-items ─────────────────────────────────── */
router.get("/sales/:id/returnable-items", requireAuth, requireAnyPermission(P.returns.view, P.sales.view), async (req, res): Promise<void> => {
  const saleId = parseInt(req.params.id, 10);
  const [sale] = await db.select().from(salesTable).where(eq(salesTable.id, saleId));
  if (!sale) { res.status(404).json({ error: "Vente introuvable" }); return; }
  if (!assertBranchAccess(req.user!, sale.branchId, res)) return;

  const items = await db.select({ si: saleItemsTable, productName: productsTable.name })
    .from(saleItemsTable)
    .leftJoin(productsTable, eq(saleItemsTable.productId, productsTable.id))
    .where(eq(saleItemsTable.saleId, saleId));

  const confirmedReturns = await db.select().from(salesReturnsTable)
    .where(and(
      eq(salesReturnsTable.saleId, saleId),
      sql`${salesReturnsTable.status} IN ('confirmed', 'refunded', 'partially_refunded')`
    ));

  const returnItems = confirmedReturns.length > 0
    ? await db.select().from(salesReturnItemsTable)
      .where(inArray(salesReturnItemsTable.returnId, confirmedReturns.map(r => r.id)))
    : [];

  const returnedQtyBySaleItem: Record<number, number> = {};
  for (const ri of returnItems) {
    if (ri.saleItemId) {
      returnedQtyBySaleItem[ri.saleItemId] = (returnedQtyBySaleItem[ri.saleItemId] ?? 0) + parseFloat(ri.quantity as string);
    }
  }

  const result = items.map(i => {
    const original = parseFloat(i.si.quantity as string);
    const alreadyReturned = returnedQtyBySaleItem[i.si.id] ?? 0;
    const remaining = original - alreadyReturned;
    return {
      saleItemId: i.si.id,
      productId: i.si.productId,
      productName: i.productName ?? "",
      originalQuantity: original,
      alreadyReturnedQuantity: alreadyReturned,
      remainingQuantity: remaining,
      unitPrice: parseFloat(i.si.unitPrice as string),
      canReturn: remaining > 0,
    };
  });

  res.json({ sale: { id: sale.id, reference: sale.reference, branchId: sale.branchId, customerId: sale.customerId }, items: result });
});

/* ── POST /returns ── create draft ────────────────────────────────────── */
router.post("/returns", requireAuth, requireAnyPermission(P.returns.create, P.pos.refund), async (req, res): Promise<void> => {
  const { saleId, reason, notes, items } = req.body as {
    saleId: number;
    reason?: string;
    notes?: string;
    items: { saleItemId?: number; productId: number; productName: string; quantity: number; unitPrice: number }[];
  };

  if (!saleId || !items?.length) { res.status(400).json({ error: "Champs requis manquants" }); return; }

  const [sale] = await db.select().from(salesTable).where(eq(salesTable.id, saleId));
  if (!sale) { res.status(404).json({ error: "Vente introuvable" }); return; }
  if (sale.type !== "sale") { res.status(400).json({ error: "Seules les ventes confirmées peuvent faire l'objet d'un retour" }); return; }
  if (sale.status === "cancelled") { res.status(400).json({ error: "Impossible de retourner une vente annulée" }); return; }

  if (!assertBranchAccess(req.user!, sale.branchId, res)) return;

  const reference = await genRef();
  const totalAmount = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);

  // Look up product names for any item that doesn't provide one
  const missingNameIds = [...new Set(items.filter(i => !i.productName).map(i => i.productId))];
  const productNameMap: Record<number, string> = {};
  if (missingNameIds.length > 0) {
    const prods = await db.select({ id: productsTable.id, name: productsTable.name }).from(productsTable).where(inArray(productsTable.id, missingNameIds));
    for (const p of prods) productNameMap[p.id] = p.name;
  }

  const [ret] = await db.insert(salesReturnsTable).values({
    reference,
    saleId,
    customerId: sale.customerId,
    branchId: sale.branchId,
    status: "draft",
    reason: reason ?? null,
    notes: notes ?? null,
    totalAmount: totalAmount.toString(),
    refundedAmount: "0",
    createdByUserId: req.user!.id,
  }).returning();

  await db.insert(salesReturnItemsTable).values(items.map(i => ({
    returnId: ret.id,
    saleItemId: i.saleItemId ?? null,
    productId: i.productId,
    productName: i.productName || productNameMap[i.productId] || "",
    quantity: i.quantity.toString(),
    unitPrice: i.unitPrice.toString(),
    total: (i.quantity * i.unitPrice).toString(),
  })));

  res.status(201).json(await buildReturnResponse(ret));
});

/* ── POST /returns/:id/confirm ─────────────────────────────────────────── */
router.post("/returns/:id/confirm", requireAuth, requirePermission(P.returns.confirm), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [ret] = await db.select().from(salesReturnsTable).where(eq(salesReturnsTable.id, id));
  if (!ret) { res.status(404).json({ error: "Retour introuvable" }); return; }
  if (ret.status !== "draft") { res.status(400).json({ error: "Ce retour ne peut plus être confirmé" }); return; }
  if (!assertBranchAccess(req.user!, ret.branchId, res)) return;

  const items = await db.select().from(salesReturnItemsTable)
    .where(eq(salesReturnItemsTable.returnId, id));

  for (const item of items) {
    await adjustStock(
      item.productId, ret.branchId,
      parseFloat(item.quantity as string),
      "return",
      ret.reference,
      parseFloat(item.unitPrice as string),
      ret.id
    );
  }

  const [sale] = await db.select().from(salesTable).where(eq(salesTable.id, ret.saleId));
  if (sale) {
    const returnTotal = parseFloat(ret.totalAmount as string);
    const saleTotal = parseFloat(sale.total as string);
    const salePaid = parseFloat(sale.paid as string);
    const newTotal = Math.max(0, saleTotal - returnTotal);
    const newDue = newTotal - salePaid;
    const newPayStatus = newDue <= 0 ? "paid" : salePaid > 0 ? "partially_paid" : "unpaid";
    await db.update(salesTable).set({
      total: newTotal.toString(),
      paymentStatus: newPayStatus,
    }).where(eq(salesTable.id, sale.id));
  }

  const [updated] = await db.update(salesReturnsTable)
    .set({ status: "confirmed" })
    .where(eq(salesReturnsTable.id, id))
    .returning();

  res.json(await buildReturnResponse(updated));
});

/* ── POST /returns/:id/refund ──────────────────────────────────────────── */
router.post("/returns/:id/refund", requireAuth, requirePermission(P.returns.refund), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { amount } = req.body as { amount?: number };
  const [ret] = await db.select().from(salesReturnsTable).where(eq(salesReturnsTable.id, id));
  if (!ret) { res.status(404).json({ error: "Retour introuvable" }); return; }
  if (!["confirmed", "partially_refunded"].includes(ret.status)) {
    res.status(400).json({ error: "Ce retour ne peut pas être remboursé dans son état actuel" }); return;
  }
  if (!assertBranchAccess(req.user!, ret.branchId, res)) return;

  const totalAmount = parseFloat(ret.totalAmount as string);
  const alreadyRefunded = parseFloat(ret.refundedAmount as string);
  const refundAmount = amount ?? (totalAmount - alreadyRefunded);
  const newRefunded = Math.min(totalAmount, alreadyRefunded + refundAmount);
  const newStatus = newRefunded >= totalAmount ? "refunded" : "partially_refunded";

  const [updated] = await db.update(salesReturnsTable)
    .set({ refundedAmount: newRefunded.toString(), status: newStatus })
    .where(eq(salesReturnsTable.id, id))
    .returning();

  res.json(await buildReturnResponse(updated));
});

/* ── POST /returns/:id/cancel ──────────────────────────────────────────── */
router.post("/returns/:id/cancel", requireAuth, requirePermission(P.returns.cancel), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [ret] = await db.select().from(salesReturnsTable).where(eq(salesReturnsTable.id, id));
  if (!ret) { res.status(404).json({ error: "Retour introuvable" }); return; }
  if (!["draft"].includes(ret.status)) {
    res.status(400).json({ error: "Seuls les retours en brouillon peuvent être annulés" }); return;
  }
  if (!assertBranchAccess(req.user!, ret.branchId, res)) return;

  const [updated] = await db.update(salesReturnsTable)
    .set({ status: "cancelled" })
    .where(eq(salesReturnsTable.id, id))
    .returning();

  res.json(await buildReturnResponse(updated));
});

export default router;
