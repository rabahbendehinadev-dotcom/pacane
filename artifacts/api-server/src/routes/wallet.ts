import { Router, type IRouter } from "express";
import {
  db, customerWalletMovementsTable, salesReturnsTable, salesTable,
  contactsTable, branchesTable, usersTable,
} from "@workspace/db";
import { eq, and, sql, inArray, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, requireAnyPermission, assertBranchAccess, visibleBranchIds } from "../middlewares/permissions";
import { P } from "../lib/permissions";

const router: IRouter = Router();

function n(v: unknown): number { return parseFloat((v as string) ?? "0") || 0; }

let walletCounter = -1;
async function ensureCounter() {
  if (walletCounter >= 0) return;
  const [row] = await db
    .select({ ref: customerWalletMovementsTable.reference })
    .from(customerWalletMovementsTable)
    .where(sql`${customerWalletMovementsTable.reference} LIKE ${"CRED-%"}`)
    .orderBy(sql`CAST(SPLIT_PART(${customerWalletMovementsTable.reference}, '-', 2) AS INTEGER) DESC`)
    .limit(1);
  walletCounter = row ? parseInt(row.ref.split("-")[1]) : 1000;
}
async function genRef(): Promise<string> {
  await ensureCounter();
  return `CRED-${++walletCounter}`;
}

async function buildMovementResponse(m: typeof customerWalletMovementsTable.$inferSelect) {
  let customerName = "";
  if (m.customerId) {
    const [c] = await db.select({ name: contactsTable.displayName }).from(contactsTable).where(eq(contactsTable.id, m.customerId));
    customerName = c?.name ?? "";
  }
  const [branch] = await db.select({ name: branchesTable.name }).from(branchesTable).where(eq(branchesTable.id, m.branchId));
  let createdByName = "";
  if (m.createdByUserId) {
    const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, m.createdByUserId));
    createdByName = u?.name ?? "";
  }
  let sourceReturnRef = "";
  if (m.sourceReturnId) {
    const [r] = await db.select({ ref: salesReturnsTable.reference }).from(salesReturnsTable).where(eq(salesReturnsTable.id, m.sourceReturnId));
    sourceReturnRef = r?.ref ?? "";
  }
  let usedOnSaleRef = "";
  if (m.usedOnSaleId) {
    const [s] = await db.select({ ref: salesTable.reference }).from(salesTable).where(eq(salesTable.id, m.usedOnSaleId));
    usedOnSaleRef = s?.ref ?? "";
  }
  return {
    ...m,
    amount: n(m.amount),
    customerName,
    branchName: branch?.name ?? "",
    createdByName,
    sourceReturnRef,
    usedOnSaleRef,
  };
}

// ─── GET /customers/:id/credit ─── wallet balance + movements ────────────────

router.get("/customers/:id/credit", requireAuth, requireAnyPermission(P.returns.view, P.sales.view, P.contacts.view), async (req, res): Promise<void> => {
  const customerId = parseInt(req.params.id, 10);
  const scope = visibleBranchIds(req.user!);

  const [customer] = await db.select().from(contactsTable).where(eq(contactsTable.id, customerId));
  if (!customer) { res.status(404).json({ error: "Client introuvable" }); return; }

  const conds: any[] = [eq(customerWalletMovementsTable.customerId, customerId)];
  if (scope !== null) conds.push(inArray(customerWalletMovementsTable.branchId, scope));

  const movements = await db.select().from(customerWalletMovementsTable)
    .where(and(...conds))
    .orderBy(desc(customerWalletMovementsTable.createdAt));

  const totalCreated = movements
    .filter(m => m.type === "credit_created")
    .reduce((s, m) => s + n(m.amount), 0);
  const totalUsed = movements
    .filter(m => m.type === "credit_used")
    .reduce((s, m) => s + Math.abs(n(m.amount)), 0);
  const totalCancelled = movements
    .filter(m => m.type === "credit_cancelled")
    .reduce((s, m) => s + Math.abs(n(m.amount)), 0);
  const available = Math.max(0, totalCreated - totalUsed - totalCancelled);

  const enriched = await Promise.all(movements.map(buildMovementResponse));

  res.json({
    customerId,
    customerName: customer.displayName ?? "",
    available,
    totalCreated,
    totalUsed,
    totalCancelled,
    movements: enriched,
  });
});

// ─── POST /returns/:id/issue-credit ─── convert avoir to wallet credit ────────

router.post("/returns/:id/issue-credit", requireAuth, requirePermission(P.returns.refund), async (req, res): Promise<void> => {
  const returnId = parseInt(req.params.id, 10);
  const { amount, notes } = req.body as { amount?: number; notes?: string };

  const [ret] = await db.select().from(salesReturnsTable).where(eq(salesReturnsTable.id, returnId));
  if (!ret) { res.status(404).json({ error: "Retour introuvable" }); return; }
  if (!["confirmed", "partially_refunded"].includes(ret.status)) {
    res.status(400).json({ error: "Ce retour ne peut pas émettre de crédit dans son état actuel" }); return;
  }
  if (!ret.customerId) {
    res.status(400).json({ error: "Ce retour n'est pas associé à un client" }); return;
  }
  if (!assertBranchAccess(req.user!, ret.branchId, res)) return;

  const totalAmount = n(ret.totalAmount);
  const alreadyRefunded = n(ret.refundedAmount);
  const alreadyCredit = n(ret.creditAmount);
  const alreadySettled = alreadyRefunded + alreadyCredit;
  const maxCredit = totalAmount - alreadySettled;

  if (maxCredit <= 0) {
    res.status(400).json({ error: "Ce retour est déjà entièrement réglé (remboursé ou crédit émis)" }); return;
  }

  const creditAmt = Math.min(amount ?? maxCredit, maxCredit);
  if (creditAmt <= 0) { res.status(400).json({ error: "Le montant du crédit doit être positif" }); return; }

  const newCredit = alreadyCredit + creditAmt;
  const newSettled = alreadyRefunded + newCredit;
  const newStatus = newSettled >= totalAmount ? "refunded" : "partially_refunded";

  await db.update(salesReturnsTable)
    .set({ creditAmount: newCredit.toString(), status: newStatus })
    .where(eq(salesReturnsTable.id, returnId));

  const reference = await genRef();
  const [movement] = await db.insert(customerWalletMovementsTable).values({
    reference,
    customerId: ret.customerId,
    branchId: ret.branchId,
    type: "credit_created",
    amount: creditAmt.toString(),
    sourceReturnId: returnId,
    usedOnSaleId: null,
    notes: notes ?? `Avoir issu du retour ${ret.reference}`,
    createdByUserId: req.user!.id,
  }).returning();

  res.status(201).json({
    movement: await buildMovementResponse(movement),
    creditAmount: creditAmt,
    returnReference: ret.reference,
  });
});

// ─── POST /sales/:id/apply-credit ─── apply wallet credit to sale ────────────

router.post("/sales/:id/apply-credit", requireAuth, requirePermission(P.sales.edit), async (req, res): Promise<void> => {
  const saleId = parseInt(req.params.id, 10);
  const { customerId: bodyCustomerId, amount, notes } = req.body as { customerId?: number; amount: number; notes?: string };

  const [sale] = await db.select().from(salesTable).where(eq(salesTable.id, saleId));
  if (!sale) { res.status(404).json({ error: "Vente introuvable" }); return; }
  if (!["confirmed", "active"].includes(sale.status)) {
    res.status(400).json({ error: "Cette vente ne peut pas recevoir du crédit client dans son état actuel" }); return;
  }

  const effectiveCustomerId = bodyCustomerId ?? sale.customerId;
  if (!effectiveCustomerId) {
    res.status(400).json({ error: "Aucun client associé à cette vente" }); return;
  }
  if (!assertBranchAccess(req.user!, sale.branchId, res)) return;

  // Check available credit
  const scope = visibleBranchIds(req.user!);
  const conds: any[] = [eq(customerWalletMovementsTable.customerId, effectiveCustomerId)];
  if (scope !== null) conds.push(inArray(customerWalletMovementsTable.branchId, scope));
  const movements = await db.select().from(customerWalletMovementsTable).where(and(...conds));
  const totalCreated = movements.filter(m => m.type === "credit_created").reduce((s, m) => s + n(m.amount), 0);
  const totalUsed = movements.filter(m => m.type === "credit_used").reduce((s, m) => s + Math.abs(n(m.amount)), 0);
  const totalCancelled = movements.filter(m => m.type === "credit_cancelled").reduce((s, m) => s + Math.abs(n(m.amount)), 0);
  const available = Math.max(0, totalCreated - totalUsed - totalCancelled);

  if (available <= 0) { res.status(400).json({ error: "Ce client n'a pas de crédit disponible" }); return; }

  const applyAmt = Math.min(amount, available);
  if (applyAmt <= 0) { res.status(400).json({ error: "Le montant à appliquer doit être positif" }); return; }

  const saleTotal = n(sale.total);
  const salePaid = n(sale.paid);
  const existingCredit = n(sale.creditApplied);
  const due = saleTotal - salePaid - existingCredit;
  const actualApply = Math.min(applyAmt, due);

  if (actualApply <= 0) { res.status(400).json({ error: "Cette vente est déjà entièrement réglée" }); return; }

  const newCreditApplied = existingCredit + actualApply;
  const newDue = saleTotal - salePaid - newCreditApplied;
  const newPayStatus = newDue <= 0 ? "paid" : salePaid + newCreditApplied > 0 ? "partially_paid" : "unpaid";

  await db.update(salesTable).set({
    creditApplied: newCreditApplied.toString(),
    paymentStatus: newPayStatus,
  }).where(eq(salesTable.id, saleId));

  const reference = await genRef();
  const [movement] = await db.insert(customerWalletMovementsTable).values({
    reference,
    customerId: effectiveCustomerId,
    branchId: sale.branchId,
    type: "credit_used",
    amount: (-actualApply).toString(),
    sourceReturnId: null,
    usedOnSaleId: saleId,
    notes: notes ?? `Crédit appliqué sur la vente ${sale.reference}`,
    createdByUserId: req.user!.id,
  }).returning();

  res.status(201).json({
    movement: await buildMovementResponse(movement),
    appliedAmount: actualApply,
    newCreditApplied,
    newDue: Math.max(0, newDue),
    saleReference: sale.reference,
  });
});

// ─── GET /wallet ─── all movements (admin overview) ──────────────────────────

router.get("/wallet", requireAuth, requirePermission(P.wallet.view), async (req, res): Promise<void> => {
  const { customerId, type } = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);

  const conds: any[] = [];
  if (scope !== null && scope.length > 0) conds.push(inArray(customerWalletMovementsTable.branchId, scope));
  if (scope !== null && scope.length === 0) { res.json([]); return; }
  if (customerId) conds.push(eq(customerWalletMovementsTable.customerId, parseInt(customerId, 10)));
  if (type) conds.push(eq(customerWalletMovementsTable.type, type));

  const movements = await db.select().from(customerWalletMovementsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(customerWalletMovementsTable.createdAt));

  const enriched = await Promise.all(movements.map(buildMovementResponse));
  res.json(enriched);
});

export default router;
