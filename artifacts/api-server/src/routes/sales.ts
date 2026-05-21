import { Router, type IRouter } from "express";
import { db, salesTable, saleItemsTable, salePaymentsTable, contactsTable, branchesTable, productsTable, usersTable, posSessionsTable, stockLevelsTable } from "@workspace/db";
import { eq, and, sql, inArray, or } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, assertBranchAccess, visibleBranchIds } from "../middlewares/permissions";
import { P } from "../lib/permissions";
import { adjustStock } from "./stock";
import { computeCreditStatus, logCreditOverride } from "../lib/credit";
import { hasPermission } from "../lib/permissions";

const router: IRouter = Router();

const counters: Record<string, number> = { FAC: -1, DEV: -1, CMD: -1, BRO: -1 };

async function ensureCounter(prefix: string) {
  if (counters[prefix] >= 0) return;
  const [row] = await db
    .select({ ref: salesTable.reference })
    .from(salesTable)
    .where(sql`${salesTable.reference} LIKE ${prefix + "-%"}`)
    .orderBy(sql`CAST(SPLIT_PART(${salesTable.reference}, '-', 2) AS INTEGER) DESC`)
    .limit(1);
  counters[prefix] = row ? parseInt(row.ref.split("-")[1]) : 1000;
}

async function genRef(type: string): Promise<string> {
  const prefix = type === "quotation" ? "DEV" : type === "order" ? "CMD" : type === "draft" ? "BRO" : "FAC";
  await ensureCounter(prefix);
  return `${prefix}-${++counters[prefix]}`;
}

function defaultStatus(type: string) {
  if (type === "draft") return "active";
  if (type === "quotation") return "pending";
  if (type === "order") return "pending";
  return "confirmed";
}


async function buildSaleResponse(sale: typeof salesTable.$inferSelect) {
  let customerName: string | null = null;
  if (sale.customerId) {
    const [c] = await db.select().from(contactsTable).where(eq(contactsTable.id, sale.customerId));
    customerName = c?.displayName ?? null;
  }
  const [branch] = await db.select().from(branchesTable).where(eq(branchesTable.id, sale.branchId));
  const items = await db.select({ si: saleItemsTable, productName: productsTable.name })
    .from(saleItemsTable).leftJoin(productsTable, eq(saleItemsTable.productId, productsTable.id))
    .where(eq(saleItemsTable.saleId, sale.id));
  const payments = await db.select().from(salePaymentsTable)
    .where(eq(salePaymentsTable.saleId, sale.id))
    .orderBy(sql`${salePaymentsTable.createdAt} ASC`);
  let createdByName: string | null = null;
  if (sale.createdByUserId) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, sale.createdByUserId));
    createdByName = u?.name ?? null;
  }
  return {
    ...sale, customerName, branchName: branch?.name ?? "", branchPhone: branch?.phone ?? null, createdByName,
    subtotal: parseFloat(sale.subtotal as string), discount: parseFloat(sale.discount as string),
    tax: parseFloat(sale.tax as string), shippingFee: parseFloat(sale.shippingFee as string),
    total: parseFloat(sale.total as string), paid: parseFloat(sale.paid as string),
    creditApplied: parseFloat((sale.creditApplied ?? "0") as string),
    due: Math.max(0, parseFloat(sale.total as string) - parseFloat(sale.paid as string) - parseFloat((sale.creditApplied ?? "0") as string)),
    items: items.map(i => ({
      id: i.si.id, productId: i.si.productId, productName: i.productName ?? "",
      quantity: parseFloat(i.si.quantity as string), unitPrice: parseFloat(i.si.unitPrice as string),
      discount: parseFloat(i.si.discount as string), total: parseFloat(i.si.total as string)
    })),
    payments: payments.map(p => ({
      id: p.id, saleId: p.saleId, amount: parseFloat(p.amount as string),
      method: p.method, date: p.date, notes: p.notes, createdAt: p.createdAt
    }))
  };
}

router.get("/sales/counts", requireAuth, requirePermission(P.sales.view), async (req, res): Promise<void> => {
  const { branchId } = req.query as Record<string, string>;
  const user = req.user!;
  const conditions = [];
  const reqBranchId = branchId ? parseInt(branchId, 10) : null;
  if (!user.adminAccess) {
    if (user.branchIds.length === 0) { res.json({ all: 0, draft: 0, quotation: 0, order: 0, sale: 0, comptoir: 0 }); return; }
    if (reqBranchId) {
      if (!user.branchIds.includes(reqBranchId)) { res.status(403).json({ error: "Accès refusé" }); return; }
      conditions.push(eq(salesTable.branchId, reqBranchId));
    } else {
      conditions.push(inArray(salesTable.branchId, user.branchIds));
    }
  } else if (reqBranchId) {
    conditions.push(eq(salesTable.branchId, reqBranchId));
  }
  const where = conditions.length ? and(...conditions) : undefined;
  const rows = where
    ? await db.select().from(salesTable).where(where)
    : await db.select().from(salesTable);
  const all = rows.length;
  const draft = rows.filter(r => r.type === "draft").length;
  const quotation = rows.filter(r => r.type === "quotation").length;
  const order = rows.filter(r => r.type === "order").length;
  const sale = rows.filter(r => r.type === "sale" && r.fulfillmentType !== "pos").length;
  const comptoir = rows.filter(r => r.type === "sale" && r.fulfillmentType === "pos").length;
  res.json({ all, draft, quotation, order, sale, comptoir });
});

router.get("/sales", requireAuth, requirePermission(P.sales.view), async (req, res): Promise<void> => {
  const { branchId, type, status, customerId, search, page: pageStr, limit: limitStr } = req.query as Record<string, string>;
  const user = req.user!;
  const page = Math.max(1, parseInt(pageStr || "1", 10));
  const limit = Math.min(200, Math.max(1, parseInt(limitStr || "50", 10)));
  const offset = (page - 1) * limit;

  const conditions = [];
  const reqBranchId = branchId ? parseInt(branchId, 10) : null;
  if (!user.adminAccess) {
    if (user.branchIds.length === 0) { res.json({ data: [], total: 0, page, totalPages: 0 }); return; }
    if (reqBranchId) {
      if (!user.branchIds.includes(reqBranchId)) { res.status(403).json({ error: "Accès refusé à cette succursale", code: "BRANCH_ACCESS_DENIED" }); return; }
      conditions.push(eq(salesTable.branchId, reqBranchId));
    } else {
      conditions.push(inArray(salesTable.branchId, user.branchIds));
    }
  } else if (reqBranchId) {
    conditions.push(eq(salesTable.branchId, reqBranchId));
  }
  // type filter: 'comptoir' means sale + pos
  if (type === "comptoir") {
    conditions.push(eq(salesTable.type, "sale"));
    conditions.push(eq(salesTable.fulfillmentType, "pos"));
  } else if (type === "sale") {
    conditions.push(eq(salesTable.type, "sale"));
    conditions.push(sql`${salesTable.fulfillmentType} != 'pos'`);
  } else if (type && type !== "all") {
    conditions.push(eq(salesTable.type, type));
  }
  if (status && status !== "all") conditions.push(eq(salesTable.status, status));
  if (customerId) conditions.push(eq(salesTable.customerId, parseInt(customerId, 10)));
  if (search) {
    const like = `%${search}%`;
    conditions.push(or(
      sql`${salesTable.reference} ILIKE ${like}`,
      sql`EXISTS (SELECT 1 FROM contacts c WHERE c.id = ${salesTable.customerId} AND c.display_name ILIKE ${like})`
    ));
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [countRow] = await db.select({ total: sql<number>`count(*)::int` }).from(salesTable).where(where);
  const total = countRow?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  const rows = await db.select({
    id: salesTable.id,
    reference: salesTable.reference,
    type: salesTable.type,
    status: salesTable.status,
    fulfillmentType: salesTable.fulfillmentType,
    paymentStatus: salesTable.paymentStatus,
    total: salesTable.total,
    paid: salesTable.paid,
    creditApplied: salesTable.creditApplied,
    subtotal: salesTable.subtotal,
    discount: salesTable.discount,
    tax: salesTable.tax,
    shippingFee: salesTable.shippingFee,
    createdAt: salesTable.createdAt,
    promisedDate: salesTable.promisedDate,
    dueDate: salesTable.dueDate,
    branchId: salesTable.branchId,
    customerId: salesTable.customerId,
    notes: salesTable.notes,
    customerName: contactsTable.displayName,
    branchName: branchesTable.name,
    branchPhone: branchesTable.phone,
    createdByName: usersTable.name,
  }).from(salesTable)
    .leftJoin(contactsTable, eq(salesTable.customerId, contactsTable.id))
    .leftJoin(branchesTable, eq(salesTable.branchId, branchesTable.id))
    .leftJoin(usersTable, eq(salesTable.createdByUserId, usersTable.id))
    .where(where)
    .orderBy(sql`${salesTable.createdAt} DESC`)
    .limit(limit)
    .offset(offset);

  const data = rows.map(r => ({
    ...r,
    total: parseFloat(r.total as string),
    paid: parseFloat(r.paid as string),
    creditApplied: parseFloat((r.creditApplied ?? "0") as string),
    subtotal: parseFloat(r.subtotal as string),
    discount: parseFloat(r.discount as string),
    tax: parseFloat(r.tax as string),
    shippingFee: parseFloat(r.shippingFee as string),
    due: Math.max(0, parseFloat(r.total as string) - parseFloat(r.paid as string) - parseFloat((r.creditApplied ?? "0") as string)),
  }));

  res.json({ data, total, page, totalPages });
});

router.post("/sales", requireAuth, async (req, res): Promise<void> => {
  const { type, customerId, branchId, status, fulfillmentType, promisedDate, dueDate, discount, tax, shippingFee, notes, items, creditOverrideReason } = req.body;
  // POS sales: pos.sell OR sales.create ; regular sales: sales.create only
  const perms = req.userPermissions ?? [];
  const isPOS = fulfillmentType === "pos";
  const allowed = isPOS
    ? hasPermission(perms, P.pos.sell) || hasPermission(perms, P.sales.create)
    : hasPermission(perms, P.sales.create);
  if (!allowed) {
    res.status(403).json({ error: "Accès refusé", code: "PERMISSION_DENIED", required: isPOS ? `${P.pos.sell} | ${P.sales.create}` : P.sales.create });
    return;
  }
  if (!type || !branchId || !items?.length) { res.status(400).json({ error: "Champs requis manquants" }); return; }
  if (!assertBranchAccess(req.user!, parseInt(String(branchId), 10), res)) return;
  const subtotal = items.reduce((s: number, i: any) => s + i.quantity * i.unitPrice - (i.discount ?? 0), 0);
  const d = discount ?? 0; const t = tax ?? 0; const sf = shippingFee ?? 0;
  const total = subtotal - d + t + sf;
  const resolvedStatus = status ?? defaultStatus(type);

  if (type === "sale" && customerId) {
    const credit = await computeCreditStatus(customerId, total);
    if (credit && credit.state === "exceeded") {
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
      const userCanOverride = hasPermission(req.userPermissions ?? [], P.sales.overrideCredit);
      if (!creditOverrideReason) {
        res.status(402).json({
          error: "credit_exceeded",
          message: "La limite de crédit du client est dépassée.",
          credit: { ...credit, canOverride: userCanOverride }
        });
        return;
      }
      if (!userCanOverride) {
        res.status(403).json({
          error: "credit_override_forbidden",
          message: "Vous n'avez pas la permission de dépasser la limite de crédit.",
          credit: { ...credit, canOverride: false }
        });
        return;
      }
    }
  }

  // Stock check uniquement pour les ventes finales confirmées (POS ou comptoir)
  if (type === "sale") {
    const branchIdNum = parseInt(String(branchId), 10);
    for (const item of items) {
      const [prod] = await db.select({ name: productsTable.name, isManaged: productsTable.isManaged })
        .from(productsTable).where(eq(productsTable.id, item.productId));
      if (!prod?.isManaged) continue;
      const [sl] = await db.select({ quantity: stockLevelsTable.quantity })
        .from(stockLevelsTable)
        .where(and(eq(stockLevelsTable.productId, item.productId), eq(stockLevelsTable.branchId, branchIdNum)));
      const available = parseFloat(sl?.quantity as string ?? "0");
      if (item.quantity > available) {
        res.status(409).json({
          error: "stock_insufficient",
          productId: item.productId,
          productName: prod.name,
          available,
          message: `Stock insuffisant pour ${prod.name}. Disponible: ${available}`
        });
        return;
      }
    }
  }
  // draft / quotation / order / proforma → aucun check stock à la création

  const paymentMethod = req.body.paymentMethod ?? "cash";
  const [sale] = await db.insert(salesTable).values({
    reference: await genRef(type), type, customerId, branchId,
    status: resolvedStatus,
    paymentStatus: "unpaid", fulfillmentType: fulfillmentType ?? "pos", fulfillmentStatus: "pending",
    promisedDate, dueDate: dueDate ? new Date(dueDate) : null,
    subtotal: subtotal.toString(), discount: d.toString(), tax: t.toString(),
    shippingFee: sf.toString(), total: total.toString(), paid: "0", notes,
    paymentMethod: type === "sale" ? paymentMethod : null,
    createdByUserId: req.userId
  }).returning();

  if (type === "sale" && customerId && creditOverrideReason) {
    const credit = await computeCreditStatus(customerId, 0);
    await logCreditOverride({
      customerId, saleId: sale.id, userId: req.userId!,
      reason: creditOverrideReason,
      creditLimit: credit?.creditLimit ?? null,
      unpaidBalance: credit?.unpaidBalance ?? 0,
      newAmount: total,
    });
  }

  for (const item of items) {
    await db.insert(saleItemsTable).values({
      saleId: sale.id, productId: item.productId, quantity: item.quantity.toString(),
      unitPrice: item.unitPrice.toString(), discount: (item.discount ?? 0).toString(),
      total: (item.quantity * item.unitPrice - (item.discount ?? 0)).toString()
    });
    if (type === "sale" && resolvedStatus === "confirmed") {
      await adjustStock(item.productId, branchId, -item.quantity, "sale", sale.reference, item.unitPrice, sale.id);
    }
    // draft / quotation / order / proforma → pas de déduction stock
  }
  // Versement initial pour les commandes (order)
  if (type === "order") {
    const depositAmount = parseFloat(req.body.initialDeposit ?? "0");
    if (depositAmount > 0) {
      const today = new Date().toISOString().slice(0, 10);
      await db.insert(salePaymentsTable).values({
        saleId: sale.id, amount: depositAmount.toString(), method: "cash", date: today, notes: "Versement initial"
      });
      const paymentStatus = depositAmount >= total ? "paid" : "partially_paid";
      await db.update(salesTable).set({ paid: depositAmount.toString(), paymentStatus })
        .where(eq(salesTable.id, sale.id));
    }
  }

  if (type === "sale" && fulfillmentType === "pos") {
    // Auto-payment pour POS cash/card : enregistrer le règlement immédiatement
    if (paymentMethod !== "credit") {
      const today = new Date().toISOString().slice(0, 10);
      await db.insert(salePaymentsTable).values({
        saleId: sale.id, amount: total.toString(), method: paymentMethod, date: today
      });
      await db.update(salesTable).set({ paid: total.toString(), paymentStatus: "paid" })
        .where(eq(salesTable.id, sale.id));
    }
    const [openSession] = await db.select().from(posSessionsTable)
      .where(and(eq(posSessionsTable.branchId, branchId), eq(posSessionsTable.status, "open")));
    if (openSession) {
      const newTotal = parseFloat(openSession.totalSales as string) + total;
      const newCashSales = parseFloat(openSession.totalCashSales as string) + (paymentMethod === "cash" ? total : 0);
      const newCardSales = parseFloat(openSession.totalCardSales as string) + (paymentMethod === "card" ? total : 0);
      await db.update(posSessionsTable).set({
        totalSales: newTotal.toString(),
        totalCashSales: newCashSales.toString(),
        totalCardSales: newCardSales.toString()
      }).where(eq(posSessionsTable.id, openSession.id));
    }
  }
  res.status(201).json(await buildSaleResponse(sale));
});

router.get("/sales/:id", requireAuth, requirePermission(P.sales.view), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [sale] = await db.select().from(salesTable).where(eq(salesTable.id, id));
  if (!sale) { res.status(404).json({ error: "Vente introuvable" }); return; }
  if (!assertBranchAccess(req.user!, sale.branchId, res)) return;
  res.json(await buildSaleResponse(sale));
});

router.patch("/sales/:id", requireAuth, requirePermission(P.sales.edit), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [existing] = await db.select().from(salesTable).where(eq(salesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Vente introuvable" }); return; }
  if (!assertBranchAccess(req.user!, existing.branchId, res)) return;
  const { status, fulfillmentStatus, notes, promisedDate } = req.body;
  const updates: Record<string, unknown> = {};
  if (status != null) updates.status = status;
  if (fulfillmentStatus != null) updates.fulfillmentStatus = fulfillmentStatus;
  if (notes != null) updates.notes = notes;
  if (promisedDate != null) updates.promisedDate = promisedDate;
  const [sale] = await db.update(salesTable).set(updates as any).where(eq(salesTable.id, id)).returning();
  if (!sale) { res.status(404).json({ error: "Vente introuvable" }); return; }
  res.json(await buildSaleResponse(sale));
});

router.post("/sales/:id/payment", requireAuth, requirePermission(P.sales.edit), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [sale] = await db.select().from(salesTable).where(eq(salesTable.id, id));
  if (!sale) { res.status(404).json({ error: "Vente introuvable" }); return; }
  if (!assertBranchAccess(req.user!, sale.branchId, res)) return;
  const { amount, method, date, notes } = req.body;
  const paymentDate = date || new Date().toISOString().slice(0, 10);
  await db.insert(salePaymentsTable).values({ saleId: id, amount: amount.toString(), method, date: paymentDate, notes });
  const newPaid = parseFloat(sale.paid as string) + parseFloat(amount.toString());
  const total = parseFloat(sale.total as string);
  const creditApplied = parseFloat((sale.creditApplied ?? "0") as string);
  const totalSettled = newPaid + creditApplied;
  const paymentStatus = totalSettled >= total ? "paid" : totalSettled > 0 ? "partially_paid" : "unpaid";
  const [updated] = await db.update(salesTable).set({ paid: newPaid.toString(), paymentStatus }).where(eq(salesTable.id, id)).returning();
  res.json(await buildSaleResponse(updated));
});

router.post("/sales/:id/convert", requireAuth, requirePermission(P.sales.convert), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [sale] = await db.select().from(salesTable).where(eq(salesTable.id, id));
  if (!sale) { res.status(404).json({ error: "Document introuvable" }); return; }
  if (!assertBranchAccess(req.user!, sale.branchId, res)) return;
  const { targetType, creditOverrideReason } = req.body;
  if (!targetType) { res.status(400).json({ error: "targetType requis" }); return; }
  if (sale.status === "cancelled") { res.status(400).json({ error: "Impossible de convertir un document annulé" }); return; }

  if (targetType === "sale" && sale.customerId) {
    const saleTotal = parseFloat(sale.total as string);
    const credit = await computeCreditStatus(sale.customerId, saleTotal);
    if (credit && credit.state === "exceeded") {
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
      const userCanOverride = hasPermission(req.userPermissions ?? [], P.sales.overrideCredit);
      if (!creditOverrideReason) {
        res.status(402).json({
          error: "credit_exceeded",
          message: "La limite de crédit du client est dépassée.",
          credit: { ...credit, canOverride: userCanOverride }
        });
        return;
      }
      if (!userCanOverride) {
        res.status(403).json({
          error: "credit_override_forbidden",
          message: "Vous n'avez pas la permission de dépasser la limite de crédit.",
          credit: { ...credit, canOverride: false }
        });
        return;
      }
    }
  }

  const sourceItems = await db.select().from(saleItemsTable).where(eq(saleItemsTable.saleId, id));

  // Stock check avant conversion vers vente finale
  if (targetType === "sale") {
    for (const item of sourceItems) {
      const [prod] = await db.select({ name: productsTable.name, isManaged: productsTable.isManaged })
        .from(productsTable).where(eq(productsTable.id, item.productId));
      if (!prod?.isManaged) continue;
      const [sl] = await db.select({ quantity: stockLevelsTable.quantity })
        .from(stockLevelsTable)
        .where(and(eq(stockLevelsTable.productId, item.productId), eq(stockLevelsTable.branchId, sale.branchId)));
      const available = parseFloat(sl?.quantity as string ?? "0");
      if (parseFloat(item.quantity as string) > available) {
        res.status(409).json({
          error: "stock_insufficient",
          productId: item.productId,
          productName: prod.name,
          available,
          message: `Stock insuffisant pour ${prod.name}. Disponible: ${available}`
        });
        return;
      }
    }
  }

  await db.update(salesTable).set({ status: "converted" }).where(eq(salesTable.id, id));

  const [newSale] = await db.insert(salesTable).values({
    reference: await genRef(targetType),
    type: targetType,
    customerId: sale.customerId,
    branchId: sale.branchId,
    status: defaultStatus(targetType),
    paymentStatus: "unpaid",
    fulfillmentType: sale.fulfillmentType,
    fulfillmentStatus: "pending",
    promisedDate: sale.promisedDate,
    subtotal: sale.subtotal,
    discount: sale.discount,
    tax: sale.tax,
    shippingFee: sale.shippingFee,
    total: sale.total,
    paid: "0",
    notes: sale.notes,
    createdByUserId: req.userId
  }).returning();

  if (targetType === "sale" && sale.customerId && creditOverrideReason) {
    const credit = await computeCreditStatus(sale.customerId, 0);
    await logCreditOverride({
      customerId: sale.customerId, saleId: newSale.id, userId: req.userId!,
      reason: creditOverrideReason,
      creditLimit: credit?.creditLimit ?? null,
      unpaidBalance: credit?.unpaidBalance ?? 0,
      newAmount: parseFloat(sale.total as string),
    });
  }

  for (const item of sourceItems) {
    await db.insert(saleItemsTable).values({
      saleId: newSale.id,
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount,
      total: item.total
    });
    if (targetType === "sale") {
      await adjustStock(item.productId, newSale.branchId, -parseFloat(item.quantity as string), "sale", newSale.reference, parseFloat(item.unitPrice as string), newSale.id);
    }
  }

  res.status(201).json(await buildSaleResponse(newSale));
});

router.post("/sales/:id/cancel", requireAuth, requirePermission(P.sales.cancel), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [sale] = await db.select().from(salesTable).where(eq(salesTable.id, id));
  if (!sale) { res.status(404).json({ error: "Document introuvable" }); return; }
  if (!assertBranchAccess(req.user!, sale.branchId, res)) return;
  if (sale.status === "cancelled") { res.status(400).json({ error: "Document déjà annulé" }); return; }
  // orders ne déduisent plus le stock à la création → pas de restauration à l'annulation
  const [updated] = await db.update(salesTable).set({ status: "cancelled" }).where(eq(salesTable.id, id)).returning();
  res.json(await buildSaleResponse(updated));
});

router.post("/sales/:id/duplicate", requireAuth, requirePermission(P.sales.create), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [sale] = await db.select().from(salesTable).where(eq(salesTable.id, id));
  if (!sale) { res.status(404).json({ error: "Document introuvable" }); return; }
  if (!assertBranchAccess(req.user!, sale.branchId, res)) return;
  const sourceItems = await db.select().from(saleItemsTable).where(eq(saleItemsTable.saleId, id));

  const [newSale] = await db.insert(salesTable).values({
    reference: await genRef("draft"),
    type: "draft",
    customerId: sale.customerId,
    branchId: sale.branchId,
    status: "active",
    paymentStatus: "unpaid",
    fulfillmentType: sale.fulfillmentType,
    fulfillmentStatus: "pending",
    subtotal: sale.subtotal,
    discount: sale.discount,
    tax: sale.tax,
    shippingFee: sale.shippingFee,
    total: sale.total,
    paid: "0",
    notes: sale.notes ? `Copie de ${sale.reference}` : `Copie de ${sale.reference}`,
    createdByUserId: req.userId
  }).returning();

  for (const item of sourceItems) {
    await db.insert(saleItemsTable).values({
      saleId: newSale.id,
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount,
      total: item.total
    });
  }

  res.status(201).json(await buildSaleResponse(newSale));
});

export default router;
