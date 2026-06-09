import { Router, type IRouter } from "express";
import { db, transfersTable, transferItemsTable, branchesTable, productsTable, unitsTable, usersTable, stockLevelsTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, assertBranchAccess } from "../middlewares/permissions";
import { P } from "../lib/permissions";
import { adjustStock } from "./stock";

const router: IRouter = Router();

function genRef() {
  const d = new Date();
  return `TRF-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
}

async function buildTransferResponse(transfer: typeof transfersTable.$inferSelect, withItems = true) {
  const [src] = await db.select().from(branchesTable).where(eq(branchesTable.id, transfer.sourceBranchId));
  const [dst] = await db.select().from(branchesTable).where(eq(branchesTable.id, transfer.destinationBranchId));
  const [creator] = transfer.createdByUserId
    ? await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, transfer.createdByUserId))
    : [{ name: null }];
  const [receiver] = (transfer as any).receivedByUserId
    ? await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, (transfer as any).receivedByUserId))
    : [{ name: null }];

  const itemCountRes = await db.select({ c: sql<number>`count(*)` }).from(transferItemsTable).where(eq(transferItemsTable.transferId, transfer.id));
  const itemCount = Number(itemCountRes[0]?.c ?? 0);

  if (!withItems) {
    return { ...transfer, sourceBranchName: src?.name ?? "", destinationBranchName: dst?.name ?? "", createdByName: creator?.name ?? null, receivedByName: receiver?.name ?? null, itemCount };
  }

  const items = await db
    .select({ ti: transferItemsTable, productName: productsTable.name, unitName: unitsTable.abbreviation })
    .from(transferItemsTable)
    .leftJoin(productsTable, eq(transferItemsTable.productId, productsTable.id))
    .leftJoin(unitsTable, eq(productsTable.unitId, unitsTable.id))
    .where(eq(transferItemsTable.transferId, transfer.id));

  return {
    ...transfer,
    sourceBranchName: src?.name ?? "",
    destinationBranchName: dst?.name ?? "",
    createdByName: creator?.name ?? null,
    receivedByName: receiver?.name ?? null,
    itemCount,
    items: items.map(i => ({
      id: i.ti.id,
      productId: i.ti.productId,
      productName: i.productName ?? "",
      unitName: i.unitName ?? "",
      quantity: parseFloat(i.ti.quantity as string),
      receivedQuantity: parseFloat(i.ti.receivedQuantity as string),
    })),
  };
}

async function getAvailableStock(productId: number, branchId: number): Promise<number> {
  const [sl] = await db
    .select({ qty: sql<string>`COALESCE(SUM(${stockLevelsTable.quantity}), '0')` })
    .from(stockLevelsTable)
    .where(and(eq(stockLevelsTable.productId, productId), eq(stockLevelsTable.branchId, branchId)));
  return parseFloat(sl?.qty ?? "0");
}

// ── LIST ─────────────────────────────────────────────────────────────────────

router.get("/transfers", requireAuth, requirePermission(P.transfers.view), async (req, res): Promise<void> => {
  const { sourceBranchId, destinationBranchId, status } = req.query as Record<string, string>;
  const user = req.user!;
  const conditions = [];

  if (!user.adminAccess) {
    if (user.branchIds.length === 0) { res.json([]); return; }
    const ids = user.branchIds.join(",");
    conditions.push(sql`(${transfersTable.sourceBranchId} = ANY(ARRAY[${sql.raw(ids)}]::int[]) OR ${transfersTable.destinationBranchId} = ANY(ARRAY[${sql.raw(ids)}]::int[]))`);
  }
  if (sourceBranchId) conditions.push(eq(transfersTable.sourceBranchId, parseInt(sourceBranchId, 10)));
  if (destinationBranchId) conditions.push(eq(transfersTable.destinationBranchId, parseInt(destinationBranchId, 10)));
  if (status) conditions.push(eq(transfersTable.status, status));

  const transfers = conditions.length
    ? await db.select().from(transfersTable).where(and(...conditions)).orderBy(desc(transfersTable.createdAt))
    : await db.select().from(transfersTable).orderBy(desc(transfersTable.createdAt));

  const result = await Promise.all(transfers.map(t => buildTransferResponse(t, false)));
  res.json(result);
});

// ── GET ONE ───────────────────────────────────────────────────────────────────

router.get("/transfers/:id", requireAuth, requirePermission(P.transfers.view), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const [transfer] = await db.select().from(transfersTable).where(eq(transfersTable.id, id));
  if (!transfer) { res.status(404).json({ error: "Transfert introuvable" }); return; }
  const user = req.user!;
  if (!user.adminAccess && !user.branchIds.includes(transfer.sourceBranchId) && !user.branchIds.includes(transfer.destinationBranchId)) {
    res.status(403).json({ error: "Accès refusé", code: "BRANCH_ACCESS_DENIED" }); return;
  }
  res.json(await buildTransferResponse(transfer, true));
});

// ── CREATE DRAFT ──────────────────────────────────────────────────────────────

router.post("/transfers", requireAuth, requirePermission(P.transfers.create), async (req, res): Promise<void> => {
  const { sourceBranchId, destinationBranchId, notes, items } = req.body;
  if (!sourceBranchId || !destinationBranchId || !items?.length) {
    res.status(400).json({ error: "Champs requis manquants" }); return;
  }
  if (parseInt(String(sourceBranchId)) === parseInt(String(destinationBranchId))) {
    res.status(400).json({ error: "La succursale source et destination doivent être différentes" }); return;
  }
  if (!assertBranchAccess(req.user!, parseInt(String(sourceBranchId), 10), res)) return;

  const [transfer] = await db.insert(transfersTable).values({
    reference: genRef(),
    sourceBranchId: parseInt(String(sourceBranchId), 10),
    destinationBranchId: parseInt(String(destinationBranchId), 10),
    status: "draft",
    notes,
    createdByUserId: req.userId,
  }).returning();

  for (const item of items) {
    await db.insert(transferItemsTable).values({
      transferId: transfer.id,
      productId: item.productId,
      quantity: item.quantity.toString(),
      receivedQuantity: "0",
    } as any);
  }

  res.status(201).json(await buildTransferResponse(transfer, true));
});

// ── UPDATE DRAFT ──────────────────────────────────────────────────────────────

router.put("/transfers/:id", requireAuth, requirePermission(P.transfers.create), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const [transfer] = await db.select().from(transfersTable).where(eq(transfersTable.id, id));
  if (!transfer) { res.status(404).json({ error: "Transfert introuvable" }); return; }
  if (transfer.status !== "draft") {
    res.status(409).json({ error: "Seuls les brouillons peuvent être modifiés" }); return;
  }
  if (!assertBranchAccess(req.user!, transfer.sourceBranchId, res)) return;

  const { notes, items } = req.body;
  if (!items?.length) { res.status(400).json({ error: "Au moins un article requis" }); return; }

  await db.update(transfersTable).set({ notes: notes ?? null }).where(eq(transfersTable.id, id));
  await db.delete(transferItemsTable).where(eq(transferItemsTable.transferId, id));
  for (const item of items) {
    await db.insert(transferItemsTable).values({
      transferId: id,
      productId: item.productId,
      quantity: item.quantity.toString(),
      receivedQuantity: "0",
    } as any);
  }

  res.json(await buildTransferResponse(transfer, true));
});

// ── SEND ──────────────────────────────────────────────────────────────────────

router.post("/transfers/:id/send", requireAuth, requirePermission(P.transfers.create), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const [transfer] = await db.select().from(transfersTable).where(eq(transfersTable.id, id));
  if (!transfer) { res.status(404).json({ error: "Transfert introuvable" }); return; }
  if (transfer.status !== "draft") {
    res.status(409).json({ error: `Impossible d'envoyer un transfert au statut "${transfer.status}"` }); return;
  }
  if (!assertBranchAccess(req.user!, transfer.sourceBranchId, res)) return;

  const items = await db.select().from(transferItemsTable).where(eq(transferItemsTable.transferId, id));

  // Stock availability check
  const shortages: Array<{ productId: number; productName: string; required: number; available: number }> = [];
  for (const item of items) {
    const required = parseFloat(item.quantity as string);
    const available = await getAvailableStock(item.productId, transfer.sourceBranchId);
    if (available < required) {
      const [prod] = await db.select({ name: productsTable.name }).from(productsTable).where(eq(productsTable.id, item.productId));
      shortages.push({ productId: item.productId, productName: prod?.name ?? "?", required, available });
    }
  }

  if (shortages.length > 0) {
    res.status(409).json({ error: "stock_insufficient", message: "Stock insuffisant dans la succursale source", shortages });
    return;
  }

  for (const item of items) {
    await adjustStock(item.productId, transfer.sourceBranchId, -parseFloat(item.quantity as string), "transfer_out", transfer.reference, 0, transfer.id);
  }

  const [updated] = await db.update(transfersTable)
    .set({ status: "sent", sentAt: new Date() } as any)
    .where(eq(transfersTable.id, id))
    .returning();

  res.json(await buildTransferResponse(updated, true));
});

// ── RECEIVE ───────────────────────────────────────────────────────────────────

router.post("/transfers/:id/receive", requireAuth, requirePermission(P.transfers.receive), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const [transfer] = await db.select().from(transfersTable).where(eq(transfersTable.id, id));
  if (!transfer) { res.status(404).json({ error: "Transfert introuvable" }); return; }
  if (transfer.status !== "sent" && transfer.status !== "partially_received") {
    res.status(409).json({ error: `Impossible de réceptionner un transfert au statut "${transfer.status}"` }); return;
  }
  if (!assertBranchAccess(req.user!, transfer.destinationBranchId, res)) return;

  const { items: receivedItems } = req.body as { items?: Array<{ itemId: number; receivedQuantity: number }> };
  const dbItems = await db.select().from(transferItemsTable).where(eq(transferItemsTable.transferId, id));

  let allFullyReceived = true;
  let anyReceived = false;

  for (const dbItem of dbItems) {
    const incoming = receivedItems?.find(r => r.itemId === dbItem.id);
    const receiveQty = incoming !== undefined ? incoming.receivedQuantity : parseFloat(dbItem.quantity as string);
    if (receiveQty <= 0) { allFullyReceived = false; continue; }

    const alreadyReceived = parseFloat(dbItem.receivedQuantity as string);
    const sent = parseFloat(dbItem.quantity as string);
    const newTotal = Math.min(alreadyReceived + receiveQty, sent);
    const actualReceive = newTotal - alreadyReceived;

    await db.update(transferItemsTable)
      .set({ receivedQuantity: newTotal.toString() } as any)
      .where(eq(transferItemsTable.id, dbItem.id));

    await adjustStock(dbItem.productId, transfer.destinationBranchId, actualReceive, "transfer_in", transfer.reference, 0, transfer.id);
    anyReceived = true;
    if (newTotal < sent) allFullyReceived = false;
  }

  if (!anyReceived) { res.status(400).json({ error: "Aucune quantité reçue" }); return; }

  const newStatus = allFullyReceived ? "received" : "partially_received";
  const [updated] = await db.update(transfersTable)
    .set({ status: newStatus, receivedByUserId: req.userId, ...(allFullyReceived ? { receivedAt: new Date() } : {}) } as any)
    .where(eq(transfersTable.id, id))
    .returning();

  res.json(await buildTransferResponse(updated, true));
});

// ── CANCEL ────────────────────────────────────────────────────────────────────

router.post("/transfers/:id/cancel", requireAuth, requirePermission(P.transfers.create), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const [transfer] = await db.select().from(transfersTable).where(eq(transfersTable.id, id));
  if (!transfer) { res.status(404).json({ error: "Transfert introuvable" }); return; }
  if (!["draft", "sent"].includes(transfer.status)) {
    res.status(409).json({ error: `Impossible d'annuler un transfert au statut "${transfer.status}"` }); return;
  }
  if (!assertBranchAccess(req.user!, transfer.sourceBranchId, res)) return;

  // If sent, restore undelivered stock to source
  if (transfer.status === "sent") {
    const items = await db.select().from(transferItemsTable).where(eq(transferItemsTable.transferId, id));
    for (const item of items) {
      const sent = parseFloat(item.quantity as string);
      const received = parseFloat(item.receivedQuantity as string);
      const toRestore = sent - received;
      if (toRestore > 0) {
        await adjustStock(item.productId, transfer.sourceBranchId, toRestore, "transfer_cancel", transfer.reference, 0, transfer.id);
      }
    }
  }

  const [updated] = await db.update(transfersTable)
    .set({ status: "cancelled" })
    .where(eq(transfersTable.id, id))
    .returning();

  res.json(await buildTransferResponse(updated, true));
});

// ── COMPLETE (send + receive in one step, only source branch required) ────────
// Utilisé par le bouton "Valider" du frontend — évite le problème d'accès à la branche destination
router.post("/transfers/:id/complete", requireAuth, requirePermission(P.transfers.create), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const [transfer] = await db.select().from(transfersTable).where(eq(transfersTable.id, id));
  if (!transfer) { res.status(404).json({ error: "Transfert introuvable" }); return; }
  if (transfer.status !== "draft") {
    res.status(409).json({ error: `Impossible de compléter un transfert au statut "${transfer.status}"` }); return;
  }
  if (!assertBranchAccess(req.user!, transfer.sourceBranchId, res)) return;

  const items = await db.select().from(transferItemsTable).where(eq(transferItemsTable.transferId, id));

  // Vérifier le stock disponible
  const shortages: Array<{ productName: string; required: number; available: number }> = [];
  for (const item of items) {
    const required = parseFloat(item.quantity as string);
    const available = await getAvailableStock(item.productId, transfer.sourceBranchId);
    if (available < required) {
      const [prod] = await db.select({ name: productsTable.name }).from(productsTable).where(eq(productsTable.id, item.productId));
      shortages.push({ productName: prod?.name ?? "?", required, available });
    }
  }
  if (shortages.length > 0) {
    res.status(409).json({ error: "stock_insufficient", message: "Stock insuffisant dans la boutique source", shortages });
    return;
  }

  // Send + Receive atomiquement
  for (const item of items) {
    const qty = parseFloat(item.quantity as string);
    await adjustStock(item.productId, transfer.sourceBranchId, -qty, "transfer_out", transfer.reference, 0, transfer.id);
    await adjustStock(item.productId, transfer.destinationBranchId, qty, "transfer_in", transfer.reference, 0, transfer.id);
    await db.update(transferItemsTable)
      .set({ receivedQuantity: item.quantity } as any)
      .where(eq(transferItemsTable.id, item.id));
  }

  const [updated] = await db.update(transfersTable)
    .set({ status: "received", sentAt: new Date(), receivedAt: new Date(), receivedByUserId: req.userId } as any)
    .where(eq(transfersTable.id, id))
    .returning();

  res.json(await buildTransferResponse(updated, true));
});

// ── DELETE (draft or cancelled only) ─────────────────────────────────────────
router.delete("/transfers/:id", requireAuth, requirePermission(P.transfers.create), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const [transfer] = await db.select().from(transfersTable).where(eq(transfersTable.id, id));
  if (!transfer) { res.status(404).json({ error: "Transfert introuvable" }); return; }
  if (!["draft", "cancelled"].includes(transfer.status)) {
    res.status(409).json({ error: `Impossible de supprimer un transfert au statut "${transfer.status}"` }); return;
  }
  if (!req.user!.adminAccess && !assertBranchAccess(req.user!, transfer.sourceBranchId, res)) return;

  await db.delete(transferItemsTable).where(eq(transferItemsTable.transferId, id));
  await db.delete(transfersTable).where(eq(transfersTable.id, id));
  res.json({ ok: true });
});

// ── BULK DELETE CANCELLED ─────────────────────────────────────────────────────
router.delete("/transfers", requireAuth, requirePermission(P.transfers.create), async (req, res): Promise<void> => {
  if (!req.user!.adminAccess) { res.status(403).json({ error: "Réservé aux administrateurs" }); return; }
  const cancelled = await db.select({ id: transfersTable.id }).from(transfersTable).where(eq(transfersTable.status, "cancelled"));
  const ids = cancelled.map(t => t.id);
  if (ids.length === 0) { res.json({ deleted: 0 }); return; }
  for (const id of ids) {
    await db.delete(transferItemsTable).where(eq(transferItemsTable.transferId, id));
  }
  await db.delete(transfersTable).where(eq(transfersTable.status, "cancelled"));
  res.json({ deleted: ids.length });
});

// ── QUICK TRANSFER (create + send + receive in one step) ─────────────────────
router.post("/transfers/quick", requireAuth, requirePermission(P.transfers.create), async (req, res): Promise<void> => {
  const { sourceBranchId, destinationBranchId, productId, quantity, notes } = req.body;

  if (!sourceBranchId || !destinationBranchId || !productId || !quantity) {
    res.status(400).json({ error: "Champs requis manquants" }); return;
  }
  const src = parseInt(String(sourceBranchId), 10);
  const dst = parseInt(String(destinationBranchId), 10);
  const prodId = parseInt(String(productId), 10);
  const qty = parseFloat(String(quantity));

  if (src === dst) {
    res.status(400).json({ error: "Source et destination doivent être différentes" }); return;
  }
  if (qty <= 0) {
    res.status(400).json({ error: "La quantité doit être supérieure à 0" }); return;
  }
  if (!assertBranchAccess(req.user!, src, res)) return;

  // Check available stock
  const available = await getAvailableStock(prodId, src);
  if (available < qty) {
    res.status(409).json({ error: `Stock insuffisant : disponible ${available}, demandé ${qty}` }); return;
  }

  const ref = genRef();

  // Create transfer
  const [transfer] = await db.insert(transfersTable).values({
    reference: ref,
    sourceBranchId: src,
    destinationBranchId: dst,
    status: "draft",
    notes: notes ?? null,
    createdByUserId: req.userId,
  }).returning();

  const [item] = await db.insert(transferItemsTable).values({
    transferId: transfer.id,
    productId: prodId,
    quantity: qty.toString(),
    receivedQuantity: "0",
  } as any).returning();

  // Send: deduct from source
  await adjustStock(prodId, src, -qty, "transfer_out", ref, 0, transfer.id);
  await db.update(transfersTable).set({ status: "sent", sentAt: new Date() } as any).where(eq(transfersTable.id, transfer.id));

  // Receive: add to destination
  await adjustStock(prodId, dst, qty, "transfer_in", ref, 0, transfer.id);
  await db.update(transferItemsTable).set({ receivedQuantity: qty.toString() } as any).where(eq(transferItemsTable.id, item.id));

  const [final] = await db.update(transfersTable)
    .set({ status: "received", receivedAt: new Date() } as any)
    .where(eq(transfersTable.id, transfer.id))
    .returning();

  res.status(201).json(await buildTransferResponse(final, true));
});

export default router;
