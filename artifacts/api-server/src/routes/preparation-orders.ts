import { Router } from "express";
import { db, preparationOrdersTable, preparationOrderItemsTable, branchesTable, workersTable, usersTable, productsTable, unitsTable } from "@workspace/db";
import { eq, and, inArray, desc, sql, gte, lte } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, assertBranchAccess } from "../middlewares/permissions";
import { P } from "../lib/permissions";

const router = Router();

async function generateReference(year: number): Promise<string> {
  const prefix = `OP-${year}-`;
  const last = await db.select({ reference: preparationOrdersTable.reference })
    .from(preparationOrdersTable)
    .where(sql`reference LIKE ${prefix + "%"}`)
    .orderBy(desc(preparationOrdersTable.id))
    .limit(1);
  if (last.length === 0) return `${prefix}0001`;
  const num = parseInt(last[0].reference.split("-").pop() ?? "0", 10);
  return `${prefix}${String(num + 1).padStart(4, "0")}`;
}

function orderWithDetails(order: typeof preparationOrdersTable.$inferSelect & { branchName?: string | null; workerName?: string | null; createdByName?: string | null; itemCount?: number; totalQty?: number }) {
  return order;
}

// GET /preparation-orders — manager list
router.get("/preparation-orders", requireAuth, requirePermission(P.preparationOrders.view), async (req, res): Promise<void> => {
  const user = req.user!;
  const { branchId: branchIdStr, workerId: workerIdStr, status, dateFrom, dateTo } = req.query as Record<string, string>;

  const rows = await db.select({
    id: preparationOrdersTable.id,
    reference: preparationOrdersTable.reference,
    branchId: preparationOrdersTable.branchId,
    branchName: branchesTable.name,
    workerId: preparationOrdersTable.workerId,
    workerName: workersTable.name,
    sourceReplenishmentDate: preparationOrdersTable.sourceReplenishmentDate,
    status: preparationOrdersTable.status,
    notes: preparationOrdersTable.notes,
    createdByUserId: preparationOrdersTable.createdByUserId,
    createdByName: usersTable.name,
    sentAt: preparationOrdersTable.sentAt,
    viewedAt: preparationOrdersTable.viewedAt,
    startedAt: preparationOrdersTable.startedAt,
    completedAt: preparationOrdersTable.completedAt,
    createdAt: preparationOrdersTable.createdAt,
    updatedAt: preparationOrdersTable.updatedAt,
    itemCount: sql<number>`(SELECT COUNT(*) FROM preparation_order_items WHERE order_id = ${preparationOrdersTable.id})`,
    totalQty: sql<number>`(SELECT COALESCE(SUM(quantity_to_prepare::numeric), 0) FROM preparation_order_items WHERE order_id = ${preparationOrdersTable.id})`,
  })
    .from(preparationOrdersTable)
    .leftJoin(branchesTable, eq(preparationOrdersTable.branchId, branchesTable.id))
    .leftJoin(workersTable, eq(preparationOrdersTable.workerId, workersTable.id))
    .leftJoin(usersTable, eq(preparationOrdersTable.createdByUserId, usersTable.id))
    .orderBy(desc(preparationOrdersTable.createdAt));

  let filtered = rows;
  if (!user.adminAccess && user.branchIds.length > 0) {
    filtered = filtered.filter(r => user.branchIds.includes(r.branchId));
  }
  if (branchIdStr) filtered = filtered.filter(r => r.branchId === parseInt(branchIdStr, 10));
  if (workerIdStr) filtered = filtered.filter(r => r.workerId === parseInt(workerIdStr, 10));
  if (status) filtered = filtered.filter(r => r.status === status);
  if (dateFrom) filtered = filtered.filter(r => r.sourceReplenishmentDate >= dateFrom);
  if (dateTo) filtered = filtered.filter(r => r.sourceReplenishmentDate <= dateTo);

  res.json(filtered);
});

// GET /preparation-orders/:id — detail
router.get("/preparation-orders/:id", requireAuth, requirePermission(P.preparationOrders.view), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const user = req.user!;

  const [order] = await db.select({
    id: preparationOrdersTable.id,
    reference: preparationOrdersTable.reference,
    branchId: preparationOrdersTable.branchId,
    branchName: branchesTable.name,
    workerId: preparationOrdersTable.workerId,
    workerName: workersTable.name,
    sourceReplenishmentDate: preparationOrdersTable.sourceReplenishmentDate,
    sourceWeekdayGroup: preparationOrdersTable.sourceWeekdayGroup,
    sourceContext: preparationOrdersTable.sourceContext,
    status: preparationOrdersTable.status,
    notes: preparationOrdersTable.notes,
    createdByUserId: preparationOrdersTable.createdByUserId,
    createdByName: usersTable.name,
    sentAt: preparationOrdersTable.sentAt,
    viewedAt: preparationOrdersTable.viewedAt,
    startedAt: preparationOrdersTable.startedAt,
    completedAt: preparationOrdersTable.completedAt,
    createdAt: preparationOrdersTable.createdAt,
    updatedAt: preparationOrdersTable.updatedAt,
  })
    .from(preparationOrdersTable)
    .leftJoin(branchesTable, eq(preparationOrdersTable.branchId, branchesTable.id))
    .leftJoin(workersTable, eq(preparationOrdersTable.workerId, workersTable.id))
    .leftJoin(usersTable, eq(preparationOrdersTable.createdByUserId, usersTable.id))
    .where(eq(preparationOrdersTable.id, id));

  if (!order) { res.status(404).json({ error: "Ordre introuvable" }); return; }
  if (!user.adminAccess && user.branchIds.length > 0 && !user.branchIds.includes(order.branchId)) {
    res.status(403).json({ error: "Accès refusé" }); return;
  }

  const items = await db.select().from(preparationOrderItemsTable).where(eq(preparationOrderItemsTable.orderId, id)).orderBy(preparationOrderItemsTable.id);

  res.json({ ...order, items });
});

// POST /preparation-orders/send — create from replenishment
router.post("/preparation-orders/send", requireAuth, requirePermission(P.preparationOrders.send), async (req, res): Promise<void> => {
  const user = req.user!;
  const { branchId, date, items, force } = req.body as {
    branchId: number;
    date: string;
    force?: boolean;
    items: Array<{
      productId: number;
      productName: string;
      sku: string | null;
      unitName: string;
      workerId: number;
      workerName: string;
      quantityToOrder: number;
    }>;
  };

  if (!branchId || !date || !Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: "Paramètres manquants" }); return;
  }
  if (!assertBranchAccess(user, branchId, res)) return;

  const toSendItems = items.filter(i => i.quantityToOrder > 0);
  if (toSendItems.length === 0) { res.status(400).json({ error: "Aucun produit à préparer" }); return; }

  const unassigned = toSendItems.filter(i => !i.workerId);
  if (unassigned.length > 0) {
    res.status(422).json({
      error: "Certains produits à préparer ne sont affectés à aucun ouvrier. Veuillez compléter l'affectation avant l'envoi.",
      unassignedProducts: unassigned.map(i => i.productName),
    });
    return;
  }

  const workerMap = new Map<number, typeof toSendItems>();
  for (const item of toSendItems) {
    if (!workerMap.has(item.workerId)) workerMap.set(item.workerId, []);
    workerMap.get(item.workerId)!.push(item);
  }

  if (!force) {
    const workerIds = Array.from(workerMap.keys());
    const duplicates = await db.select({ workerId: preparationOrdersTable.workerId, reference: preparationOrdersTable.reference })
      .from(preparationOrdersTable)
      .where(and(
        eq(preparationOrdersTable.branchId, branchId),
        eq(preparationOrdersTable.sourceReplenishmentDate, date),
        inArray(preparationOrdersTable.workerId, workerIds),
        inArray(preparationOrdersTable.status, ["new", "viewed", "in_progress"]),
      ));
    if (duplicates.length > 0) {
      const workerNames: string[] = [];
      for (const d of duplicates) {
        const items = workerMap.get(d.workerId);
        if (items && items[0]) workerNames.push(items[0].workerName);
      }
      res.status(409).json({
        error: "Un ordre de préparation existe déjà pour certains ouvriers à cette date.",
        duplicateRefs: duplicates.map(d => d.reference),
        workerNames,
      });
      return;
    }
  }

  const year = new Date().getFullYear();
  const created: { workerId: number; workerName: string; reference: string; id: number }[] = [];

  for (const [wId, wItems] of workerMap.entries()) {
    const reference = await generateReference(year);
    const [order] = await db.insert(preparationOrdersTable).values({
      reference,
      branchId,
      workerId: wId,
      sourceReplenishmentDate: date,
      status: "new",
      createdByUserId: user.id,
      sentAt: new Date(),
    }).returning();

    await db.insert(preparationOrderItemsTable).values(
      wItems.map(i => ({
        orderId: order.id,
        productId: i.productId,
        productNameSnapshot: i.productName,
        skuSnapshot: i.sku ?? null,
        unitSnapshot: i.unitName,
        quantityToPrepare: i.quantityToOrder.toString(),
      }))
    );

    created.push({ workerId: wId, workerName: wItems[0].workerName, reference, id: order.id });
  }

  res.status(201).json({ success: true, created });
});

// PATCH /preparation-orders/:id/cancel — manager cancel
router.patch("/preparation-orders/:id/cancel", requireAuth, requirePermission(P.preparationOrders.cancel), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const user = req.user!;

  const [order] = await db.select().from(preparationOrdersTable).where(eq(preparationOrdersTable.id, id));
  if (!order) { res.status(404).json({ error: "Ordre introuvable" }); return; }
  if (!user.adminAccess && user.branchIds.length > 0 && !user.branchIds.includes(order.branchId)) {
    res.status(403).json({ error: "Accès refusé" }); return;
  }
  if (order.status === "completed" || order.status === "cancelled") {
    res.status(400).json({ error: "Impossible d'annuler un ordre déjà terminé ou annulé" }); return;
  }

  const [updated] = await db.update(preparationOrdersTable).set({ status: "cancelled" }).where(eq(preparationOrdersTable.id, id)).returning();
  res.json(updated);
});

// GET /my-preparations — worker view (orders assigned to current user's worker)
router.get("/my-preparations", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  if (!user.workerId) { res.json([]); return; }

  const rows = await db.select({
    id: preparationOrdersTable.id,
    reference: preparationOrdersTable.reference,
    branchId: preparationOrdersTable.branchId,
    branchName: branchesTable.name,
    workerId: preparationOrdersTable.workerId,
    sourceReplenishmentDate: preparationOrdersTable.sourceReplenishmentDate,
    status: preparationOrdersTable.status,
    notes: preparationOrdersTable.notes,
    sentAt: preparationOrdersTable.sentAt,
    viewedAt: preparationOrdersTable.viewedAt,
    startedAt: preparationOrdersTable.startedAt,
    completedAt: preparationOrdersTable.completedAt,
    createdAt: preparationOrdersTable.createdAt,
    itemCount: sql<number>`(SELECT COUNT(*) FROM preparation_order_items WHERE order_id = ${preparationOrdersTable.id})`,
    totalQty: sql<number>`(SELECT COALESCE(SUM(quantity_to_prepare::numeric), 0) FROM preparation_order_items WHERE order_id = ${preparationOrdersTable.id})`,
  })
    .from(preparationOrdersTable)
    .leftJoin(branchesTable, eq(preparationOrdersTable.branchId, branchesTable.id))
    .where(eq(preparationOrdersTable.workerId, user.workerId))
    .orderBy(desc(preparationOrdersTable.createdAt));

  res.json(rows);
});

// GET /my-preparations/:id — worker order detail
router.get("/my-preparations/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const user = req.user!;
  if (!user.workerId) { res.status(403).json({ error: "Aucun ouvrier lié à votre compte" }); return; }

  const [order] = await db.select({
    id: preparationOrdersTable.id,
    reference: preparationOrdersTable.reference,
    branchId: preparationOrdersTable.branchId,
    branchName: branchesTable.name,
    workerId: preparationOrdersTable.workerId,
    workerName: workersTable.name,
    sourceReplenishmentDate: preparationOrdersTable.sourceReplenishmentDate,
    status: preparationOrdersTable.status,
    notes: preparationOrdersTable.notes,
    sentAt: preparationOrdersTable.sentAt,
    viewedAt: preparationOrdersTable.viewedAt,
    startedAt: preparationOrdersTable.startedAt,
    completedAt: preparationOrdersTable.completedAt,
    createdAt: preparationOrdersTable.createdAt,
  })
    .from(preparationOrdersTable)
    .leftJoin(branchesTable, eq(preparationOrdersTable.branchId, branchesTable.id))
    .leftJoin(workersTable, eq(preparationOrdersTable.workerId, workersTable.id))
    .where(and(eq(preparationOrdersTable.id, id), eq(preparationOrdersTable.workerId, user.workerId)));

  if (!order) { res.status(404).json({ error: "Ordre introuvable ou accès refusé" }); return; }

  const items = await db.select().from(preparationOrderItemsTable).where(eq(preparationOrderItemsTable.orderId, id)).orderBy(preparationOrderItemsTable.id);

  if (order.status === "new" && !order.viewedAt) {
    await db.update(preparationOrdersTable).set({ status: "viewed", viewedAt: new Date() }).where(eq(preparationOrdersTable.id, id));
    res.json({ ...order, status: "viewed", viewedAt: new Date().toISOString(), items });
    return;
  }

  res.json({ ...order, items });
});

// PATCH /my-preparations/:id/status — worker updates status
router.patch("/my-preparations/:id/status", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const user = req.user!;
  if (!user.workerId) { res.status(403).json({ error: "Aucun ouvrier lié à votre compte" }); return; }

  const { status } = req.body as { status: string };
  const allowed = ["in_progress", "completed"];
  if (!allowed.includes(status)) { res.status(400).json({ error: "Statut invalide" }); return; }

  const [order] = await db.select().from(preparationOrdersTable).where(
    and(eq(preparationOrdersTable.id, id), eq(preparationOrdersTable.workerId, user.workerId))
  );
  if (!order) { res.status(404).json({ error: "Ordre introuvable ou accès refusé" }); return; }
  if (order.status === "completed" || order.status === "cancelled") {
    res.status(400).json({ error: "Statut non modifiable" }); return;
  }

  const updates: Record<string, unknown> = { status };
  if (status === "in_progress" && !order.startedAt) updates.startedAt = new Date();
  if (status === "completed") updates.completedAt = new Date();

  const [updated] = await db.update(preparationOrdersTable).set(updates as any).where(eq(preparationOrdersTable.id, id)).returning();
  res.json(updated);
});

export default router;
