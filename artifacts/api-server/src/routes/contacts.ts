import { Router, type IRouter } from "express";
import { db, contactsTable, salesTable, salePaymentsTable, saleItemsTable, purchasesTable, purchasePaymentsTable, purchaseItemsTable, branchesTable, usersTable } from "@workspace/db";
import { eq, and, ilike, or, inArray, sql, ne } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, assertBranchAccess, visibleBranchIds } from "../middlewares/permissions";
import { P } from "../lib/permissions";
import { computeCreditStatus, canOverrideCredit, getCreditOverrideLogs } from "../lib/credit";

const router: IRouter = Router();

router.get("/contacts", requireAuth, requirePermission(P.contacts.view), async (req, res): Promise<void> => {
  const { type, status, search } = req.query as Record<string, string>;
  const conditions = [];
  if (type) {
    if (type === "supplier") conditions.push(or(eq(contactsTable.type, "supplier"), eq(contactsTable.type, "both"))!);
    else if (type === "customer") conditions.push(or(eq(contactsTable.type, "customer"), eq(contactsTable.type, "both"))!);
    else conditions.push(eq(contactsTable.type, type));
  }
  if (status) conditions.push(eq(contactsTable.status, status));
  if (search) conditions.push(or(
    ilike(contactsTable.displayName, `%${search}%`),
    ilike(contactsTable.companyName, `%${search}%`),
    ilike(contactsTable.phone, `%${search}%`)
  )!);
  const contacts = conditions.length
    ? await db.select().from(contactsTable).where(and(...conditions)).orderBy(sql`LOWER(${contactsTable.displayName})`)
    : await db.select().from(contactsTable).orderBy(sql`LOWER(${contactsTable.displayName})`);

  const withBalance = await Promise.all(contacts.map(async c => {
    let unpaidBalance = 0;
    if (c.type === "customer" || c.type === "both") {
      const [row] = await db.select({ due: sql<string>`COALESCE(SUM(${salesTable.total} - ${salesTable.paid} - ${salesTable.creditApplied}), 0)` })
        .from(salesTable).where(and(eq(salesTable.customerId, c.id), ne(salesTable.status, "cancelled")));
      unpaidBalance += parseFloat(row?.due ?? "0");
    }
    if (c.type === "supplier" || c.type === "both") {
      const [row] = await db.select({ due: sql<string>`COALESCE(SUM(${purchasesTable.total} - ${purchasesTable.paid}), 0)` })
        .from(purchasesTable).where(eq(purchasesTable.supplierId, c.id));
      unpaidBalance += parseFloat(row?.due ?? "0");
    }
    return { ...c, unpaidBalance, groupName: null };
  }));
  res.json(withBalance);
});

router.post("/contacts", requireAuth, requirePermission(P.contacts.create), async (req, res): Promise<void> => {
  const { type, companyName, displayName, firstName, lastName, phone, email, taxId, address, city, country, status, creditLimit, notes, groupId } = req.body;
  if (!displayName || !type || !status) { res.status(400).json({ error: "Champs requis manquants" }); return; }
  const [contact] = await db.insert(contactsTable).values({
    type, companyName, displayName, firstName, lastName, phone, email, taxId, address, city, country, status, creditLimit, notes, groupId
  }).returning();
  res.status(201).json({ ...contact, unpaidBalance: 0, groupName: null });
});

router.get("/contacts/:id", requireAuth, requirePermission(P.contacts.view), async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, id));
  if (!contact) { res.status(404).json({ error: "Contact introuvable" }); return; }
  res.json({ ...contact, unpaidBalance: 0, groupName: null });
});

router.patch("/contacts/:id", requireAuth, requirePermission(P.contacts.edit), async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const allowed = ["type", "companyName", "displayName", "phone", "email", "address", "city", "status", "creditLimit", "notes"];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) { if (req.body[key] != null) updates[key] = req.body[key]; }
  const [contact] = await db.update(contactsTable).set(updates as any).where(eq(contactsTable.id, id)).returning();
  if (!contact) { res.status(404).json({ error: "Contact introuvable" }); return; }
  res.json({ ...contact, unpaidBalance: 0, groupName: null });
});

router.get("/contacts/:id/transactions", requireAuth, requirePermission(P.contacts.view), async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { docType, status, branchId, paymentStatus, dateFrom, dateTo } = req.query as Record<string, string>;

  const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, id));
  if (!contact) { res.status(404).json({ error: "Contact introuvable" }); return; }

  const branches = await db.select({ id: branchesTable.id, name: branchesTable.name }).from(branchesTable);
  const users = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable);
  const branchMap = Object.fromEntries(branches.map(b => [b.id, b.name]));
  const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));

  const isCustomer = contact.type === "customer" || contact.type === "both";
  const isSupplier = contact.type === "supplier" || contact.type === "both";

  const scope = visibleBranchIds(req.user!);

  let rawSales: any[] = [];
  let rawPurchases: any[] = [];
  let salePayments: any[] = [];
  let purchasePayments: any[] = [];

  if (isCustomer) {
    const saleConds: any[] = [eq(salesTable.customerId, id)];
    if (scope !== null) saleConds.push(scope.length > 0 ? inArray(salesTable.branchId, scope) : sql`FALSE`);
    rawSales = await db.select().from(salesTable).where(and(...saleConds)).orderBy(salesTable.createdAt);

    if (rawSales.length > 0) {
      const saleIds = rawSales.map(s => s.id);
      salePayments = await db.select().from(salePaymentsTable).where(inArray(salePaymentsTable.saleId, saleIds)).orderBy(salePaymentsTable.createdAt);
    }
  }

  if (isSupplier) {
    const purchConds: any[] = [eq(purchasesTable.supplierId, id)];
    if (scope !== null) purchConds.push(scope.length > 0 ? inArray(purchasesTable.branchId, scope) : sql`FALSE`);
    rawPurchases = await db.select().from(purchasesTable).where(and(...purchConds)).orderBy(purchasesTable.createdAt);

    if (rawPurchases.length > 0) {
      const purchaseIds = rawPurchases.map(p => p.id);
      purchasePayments = await db.select().from(purchasePaymentsTable).where(inArray(purchasePaymentsTable.purchaseId, purchaseIds)).orderBy(purchasePaymentsTable.createdAt);
    }
  }

  const docTypeLabel: Record<string, string> = {
    draft: "Brouillon", quotation: "Devis", order: "Commande", sale: "Facture/Vente", purchase: "Bon de commande"
  };

  let documents: any[] = [
    ...rawSales.map(s => ({
      id: s.id,
      category: "sale",
      docType: s.type,
      docTypeLabel: docTypeLabel[s.type] ?? s.type,
      reference: s.reference,
      date: s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
      branchId: s.branchId,
      branchName: branchMap[s.branchId] ?? `Agence ${s.branchId}`,
      status: s.status,
      paymentStatus: s.paymentStatus,
      fulfillmentStatus: s.fulfillmentStatus,
      subtotal: parseFloat(s.subtotal as string),
      discount: parseFloat(s.discount as string),
      tax: parseFloat(s.tax as string),
      total: parseFloat(s.total as string),
      paid: parseFloat(s.paid as string),
      due: s.status === "cancelled" ? 0 : parseFloat(s.total as string) - parseFloat(s.paid as string) - parseFloat((s.creditApplied as string) ?? "0"),
      createdByName: s.createdByUserId ? userMap[s.createdByUserId] ?? "—" : "—",
    })),
    ...rawPurchases.map(p => ({
      id: p.id,
      category: "purchase",
      docType: "purchase",
      docTypeLabel: "Bon de commande",
      reference: p.reference,
      date: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
      branchId: p.branchId,
      branchName: branchMap[p.branchId] ?? `Agence ${p.branchId}`,
      status: p.status,
      paymentStatus: p.paymentStatus,
      fulfillmentStatus: null,
      subtotal: parseFloat(p.subtotal as string),
      discount: parseFloat(p.discount as string),
      tax: parseFloat(p.tax as string),
      total: parseFloat(p.total as string),
      paid: parseFloat(p.paid as string),
      due: parseFloat(p.total as string) - parseFloat(p.paid as string),
      createdByName: p.createdByUserId ? userMap[p.createdByUserId] ?? "—" : "—",
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (docType && docType !== "all") {
    if (docType === "purchase") documents = documents.filter(d => d.category === "purchase");
    else documents = documents.filter(d => d.docType === docType);
  }
  if (status && status !== "all") documents = documents.filter(d => d.status === status);
  if (branchId && branchId !== "all") documents = documents.filter(d => d.branchId === parseInt(branchId, 10));
  if (paymentStatus && paymentStatus !== "all") documents = documents.filter(d => d.paymentStatus === paymentStatus);
  if (dateFrom) documents = documents.filter(d => d.date >= dateFrom);
  if (dateTo) documents = documents.filter(d => d.date <= dateTo + "T23:59:59Z");

  const salesForSummary = rawSales.filter(s => s.type === "sale" || s.type === "quotation" || s.type === "order" || s.type === "draft");
  const invoices = rawSales.filter(s => s.type === "sale");
  const orders = rawSales.filter(s => s.type === "order");
  const quotes = rawSales.filter(s => s.type === "quotation");
  const drafts = rawSales.filter(s => s.type === "draft");

  const totalSales = invoices.reduce((s, d) => s + parseFloat(d.total as string), 0);
  const unpaidSales = invoices.reduce((s, d) => s + (parseFloat(d.total as string) - parseFloat(d.paid as string)), 0);
  const totalPurchases = rawPurchases.filter(p => p.status !== "draft").reduce((s, p) => s + parseFloat(p.total as string), 0);
  const unpaidPurchases = rawPurchases.reduce((s, p) => s + (parseFloat(p.total as string) - parseFloat(p.paid as string)), 0);

  const allDates = [...rawSales, ...rawPurchases].map(d => (d.createdAt instanceof Date ? d.createdAt : new Date(d.createdAt)).getTime()).filter(Boolean);
  const lastTransactionDate = allDates.length ? new Date(Math.max(...allDates)).toISOString() : null;

  const allPayments: any[] = [
    ...salePayments.map(p => ({
      id: `sp-${p.id}`,
      category: "sale",
      docReference: rawSales.find(s => s.id === p.saleId)?.reference ?? "—",
      docId: p.saleId,
      date: p.date,
      amount: parseFloat(p.amount as string),
      method: p.method,
      notes: p.notes ?? null,
      createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
    })),
    ...purchasePayments.map(p => ({
      id: `pp-${p.id}`,
      category: "purchase",
      docReference: rawPurchases.find(pu => pu.id === p.purchaseId)?.reference ?? "—",
      docId: p.purchaseId,
      date: p.date,
      amount: parseFloat(p.amount as string),
      method: p.method,
      notes: p.notes ?? null,
      createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  res.json({
    contact: { ...contact, unpaidBalance: unpaidSales + unpaidPurchases, groupName: null },
    summary: {
      customer: isCustomer ? {
        totalSales,
        unpaidSales,
        invoiceCount: invoices.length,
        orderCount: orders.length,
        quoteCount: quotes.length,
        draftCount: drafts.length,
        lastDate: rawSales.length ? new Date(Math.max(...rawSales.map(s => (s.createdAt instanceof Date ? s.createdAt : new Date(s.createdAt)).getTime()))).toISOString() : null,
      } : null,
      supplier: isSupplier ? {
        totalPurchases,
        unpaidPurchases,
        purchaseCount: rawPurchases.filter(p => p.status !== "draft").length,
        draftCount: rawPurchases.filter(p => p.status === "draft").length,
        lastDate: rawPurchases.length ? new Date(Math.max(...rawPurchases.map(p => (p.createdAt instanceof Date ? p.createdAt : new Date(p.createdAt)).getTime()))).toISOString() : null,
      } : null,
      lastTransactionDate,
    },
    documents,
    payments: allPayments,
  });
});

router.get("/contacts/:id/credit-status", requireAuth, requirePermission(P.contacts.view), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const amount = parseFloat((req.query.amount as string) ?? "0") || 0;
  const credit = await computeCreditStatus(id, amount);
  if (!credit) { res.status(404).json({ error: "Contact introuvable" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
  res.json({ ...credit, canOverride: canOverrideCredit(user?.roleId) });
});

router.get("/contacts/:id/credit-overrides", requireAuth, requirePermission(P.contacts.view), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const logs = await getCreditOverrideLogs(id);
  res.json(logs);
});

export default router;

