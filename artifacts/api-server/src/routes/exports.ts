/**
 * Export routes — reusable CSV download layer.
 * All endpoints mirror the filter logic of the corresponding list routes
 * and enforce the same branch-scope security.
 *
 * GET /export/sales         → ventes-*.csv
 * GET /export/purchases     → achats-*.csv
 * GET /export/expenses      → depenses-*.csv
 * GET /export/stock         → stock-*.csv
 * GET /export/transfers     → transferts-*.csv
 * GET /export/financial     → rapport-financier-*.csv
 * GET /export/returns      → retours-*.csv
 * GET /export/products     → produits-*.csv
 */

import { Router, type IRouter } from "express";
import {
  db, salesTable, saleItemsTable, salePaymentsTable,
  purchasesTable, purchasePaymentsTable, purchaseItemsTable,
  expensesTable, stockLevelsTable, productsTable,
  branchesTable, contactsTable, unitsTable, usersTable,
  transfersTable, transferItemsTable,
  salesReturnsTable, categoriesTable, adjustmentsTable,
} from "@workspace/db";
import { eq, and, gte, lte, sql, inArray, desc, ilike } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, visibleBranchIds } from "../middlewares/permissions";
import { P } from "../lib/permissions";
import { toCsv, sendCsv, buildFilename, fmtDA, fmtDate, fmtDatetime } from "../utils/csv";

const router: IRouter = Router();

function n(v: unknown): number { return parseFloat((v as string) ?? "0") || 0; }

// ── helpers ────────────────────────────────────────────────────────────────

function buildDateConds(table: { createdAt: any }, from?: string, to?: string) {
  const conds: any[] = [];
  if (from) conds.push(gte(table.createdAt, new Date(from)));
  if (to) {
    const d = new Date(to); d.setHours(23, 59, 59, 999);
    conds.push(lte(table.createdAt, d));
  }
  return conds;
}

function buildDateCondsByField(field: any, from?: string, to?: string) {
  const conds: any[] = [];
  if (from) conds.push(gte(field, from));
  if (to) conds.push(lte(field, to));
  return conds;
}

// ── SALES EXPORT ──────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  sale: "Facture", quotation: "Devis", order: "Commande", draft: "Brouillon",
};
const SALE_STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmé", pending: "En attente", cancelled: "Annulé",
  active: "Actif", completed: "Terminé",
};
const PAY_STATUS_LABELS: Record<string, string> = {
  unpaid: "Non payé", partial: "Partiel", paid: "Payé",
};

router.get("/export/sales", requireAuth, requirePermission(P.sales.view), async (req, res): Promise<void> => {
  const { branchId, type, status, customerId, from, to, search } = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);

  if (scope !== null && scope.length === 0) { sendCsv(res, "ventes.csv", ""); return; }

  const conds: any[] = [];
  if (scope !== null) {
    if (branchId) {
      const bid = parseInt(branchId, 10);
      if (!scope.includes(bid)) { res.status(403).json({ error: "Accès refusé à cette succursale" }); return; }
      conds.push(eq(salesTable.branchId, bid));
    } else {
      conds.push(inArray(salesTable.branchId, scope));
    }
  } else if (branchId) {
    conds.push(eq(salesTable.branchId, parseInt(branchId, 10)));
  }

  if (type) conds.push(eq(salesTable.type, type));
  if (status) conds.push(eq(salesTable.status, status));
  if (customerId) conds.push(eq(salesTable.customerId, parseInt(customerId, 10)));
  conds.push(...buildDateConds(salesTable, from, to));

  const sales = await db.select().from(salesTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(salesTable.createdAt));

  const [contacts, branches, users] = await Promise.all([
    db.select({ id: contactsTable.id, name: contactsTable.displayName }).from(contactsTable),
    db.select({ id: branchesTable.id, name: branchesTable.name }).from(branchesTable),
    db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable),
  ]);
  const contactMap = Object.fromEntries(contacts.map(c => [c.id, c.name]));
  const branchMap = Object.fromEntries(branches.map(b => [b.id, b.name]));
  const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));

  type SaleRow = {
    reference: string; type: string; date: string; branchName: string;
    customerName: string; subtotal: number; discount: number; tax: number;
    shippingFee: number; total: number; paid: number; due: number;
    paymentStatus: string; status: string; createdBy: string;
  };

  let rows: SaleRow[] = sales.map(s => {
    const total = n(s.total); const paid = n(s.paid);
    const ps = paid >= total ? "Payé" : paid > 0 ? "Partiel" : "Non payé";
    return {
      reference: s.reference,
      type: TYPE_LABELS[s.type] ?? s.type,
      date: fmtDate(s.createdAt),
      branchName: branchMap[s.branchId] ?? "",
      customerName: s.customerId ? (contactMap[s.customerId] ?? "") : "Vente comptoir",
      subtotal: n(s.subtotal), discount: n(s.discount),
      tax: n(s.tax), shippingFee: n(s.shippingFee),
      total, paid, due: total - paid, paymentStatus: ps,
      status: SALE_STATUS_LABELS[s.status] ?? s.status,
      createdBy: s.createdByUserId ? (userMap[s.createdByUserId] ?? "") : "",
    };
  });

  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(r => r.reference.toLowerCase().includes(q) || r.customerName.toLowerCase().includes(q));
  }

  const branchLabel = branchId ? (branchMap[parseInt(branchId, 10)] ?? undefined) : undefined;
  const filename = buildFilename("ventes", branchLabel, from, to);

  const csv = toCsv<SaleRow>([
    { header: "Référence",    value: r => r.reference },
    { header: "Type",         value: r => r.type },
    { header: "Date",         value: r => r.date },
    { header: "Succursale",   value: r => r.branchName },
    { header: "Client",       value: r => r.customerName },
    { header: "Sous-total (DA)", value: r => r.subtotal },
    { header: "Remise (DA)",  value: r => r.discount },
    { header: "TVA (DA)",     value: r => r.tax },
    { header: "Frais livraison (DA)", value: r => r.shippingFee },
    { header: "Total (DA)",   value: r => r.total },
    { header: "Payé (DA)",    value: r => r.paid },
    { header: "Solde (DA)",   value: r => r.due },
    { header: "Statut paiement", value: r => r.paymentStatus },
    { header: "Statut",       value: r => r.status },
    { header: "Créé par",     value: r => r.createdBy },
  ], rows);

  sendCsv(res, filename, csv);
});

// ── PURCHASES EXPORT ──────────────────────────────────────────────────────

const PURCHASE_STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon", ordered: "Commandé", partially_received: "Réception partielle",
  received: "Reçu", cancelled: "Annulé",
};

router.get("/export/purchases", requireAuth, requirePermission(P.purchases.view), async (req, res): Promise<void> => {
  const { branchId, supplierId, status, paymentStatus, from, to } = req.query as Record<string, string>;
  const user = req.user!;
  const scope = visibleBranchIds(user);

  if (scope !== null && scope.length === 0) { sendCsv(res, "achats.csv", ""); return; }

  const conds: any[] = [];
  if (scope !== null) {
    if (branchId) {
      const bid = parseInt(branchId, 10);
      if (!scope.includes(bid)) { res.status(403).json({ error: "Accès refusé à cette succursale" }); return; }
      conds.push(eq(purchasesTable.branchId, bid));
    } else {
      conds.push(inArray(purchasesTable.branchId, scope));
    }
  } else if (branchId) {
    conds.push(eq(purchasesTable.branchId, parseInt(branchId, 10)));
  }

  if (supplierId) conds.push(eq(purchasesTable.supplierId, parseInt(supplierId, 10)));
  if (status) conds.push(eq(purchasesTable.status, status));
  if (paymentStatus) conds.push(eq(purchasesTable.paymentStatus, paymentStatus));
  conds.push(...buildDateConds(purchasesTable, from, to));

  const purchases = await db.select().from(purchasesTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(purchasesTable.createdAt));

  const [contacts, branches, users] = await Promise.all([
    db.select({ id: contactsTable.id, name: contactsTable.displayName }).from(contactsTable),
    db.select({ id: branchesTable.id, name: branchesTable.name }).from(branchesTable),
    db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable),
  ]);
  const contactMap = Object.fromEntries(contacts.map(c => [c.id, c.name]));
  const branchMap = Object.fromEntries(branches.map(b => [b.id, b.name]));
  const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));

  type PurchaseRow = {
    reference: string; status: string; paymentStatus: string;
    date: string; deliveryDate: string; branchName: string; supplierName: string;
    subtotal: number; discount: number; tax: number; total: number; paid: number; due: number;
    createdBy: string;
  };

  const PAY_LABELS: Record<string, string> = { unpaid: "Non payé", partial: "Partiel", paid: "Payé" };

  const rows: PurchaseRow[] = purchases.map(p => {
    const total = n(p.total); const paid = n(p.paid);
    return {
      reference: p.reference,
      status: PURCHASE_STATUS_LABELS[p.status] ?? p.status,
      paymentStatus: PAY_LABELS[p.paymentStatus ?? "unpaid"] ?? (p.paymentStatus ?? ""),
      date: fmtDate(p.createdAt),
      deliveryDate: fmtDate(p.expectedDelivery),
      branchName: branchMap[p.branchId] ?? "",
      supplierName: p.supplierId ? (contactMap[p.supplierId] ?? "") : "",
      subtotal: n(p.subtotal), discount: n(p.discount), tax: n(p.tax),
      total, paid, due: total - paid,
      createdBy: p.createdByUserId ? (userMap[p.createdByUserId] ?? "") : "",
    };
  });

  const branchLabel = branchId ? (branchMap[parseInt(branchId, 10)] ?? undefined) : undefined;
  const filename = buildFilename("achats", branchLabel, from, to);

  const csv = toCsv<PurchaseRow>([
    { header: "Référence",       value: r => r.reference },
    { header: "Statut",          value: r => r.status },
    { header: "Statut paiement", value: r => r.paymentStatus },
    { header: "Date commande",   value: r => r.date },
    { header: "Livraison prévue",value: r => r.deliveryDate },
    { header: "Succursale",      value: r => r.branchName },
    { header: "Fournisseur",     value: r => r.supplierName },
    { header: "Sous-total (DA)", value: r => r.subtotal },
    { header: "Remise (DA)",     value: r => r.discount },
    { header: "TVA (DA)",        value: r => r.tax },
    { header: "Total (DA)",      value: r => r.total },
    { header: "Payé (DA)",       value: r => r.paid },
    { header: "Solde (DA)",      value: r => r.due },
    { header: "Créé par",        value: r => r.createdBy },
  ], rows);

  sendCsv(res, filename, csv);
});

// ── EXPENSES EXPORT ───────────────────────────────────────────────────────

const EXP_STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon", pending: "En attente", validated: "Validé", cancelled: "Annulé",
};

router.get("/export/expenses", requireAuth, requirePermission(P.expenses.view), async (req, res): Promise<void> => {
  const { branchId, category, paymentMethod, status, from, to, search } = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);

  if (scope !== null && scope.length === 0) { sendCsv(res, "depenses.csv", ""); return; }

  const conds: any[] = [];
  if (scope !== null) {
    if (branchId) {
      const bid = parseInt(branchId, 10);
      if (!scope.includes(bid)) { res.status(403).json({ error: "Accès refusé à cette succursale" }); return; }
      conds.push(eq(expensesTable.branchId, bid));
    } else {
      conds.push(inArray(expensesTable.branchId, scope));
    }
  } else if (branchId) {
    conds.push(eq(expensesTable.branchId, parseInt(branchId, 10)));
  }

  if (category) conds.push(eq(expensesTable.category, category));
  if (paymentMethod) conds.push(eq(expensesTable.paymentMethod, paymentMethod));
  if (status) conds.push(eq(expensesTable.status, status));
  conds.push(...buildDateCondsByField(expensesTable.date, from, to));

  const rows = await db.select({
    exp: expensesTable,
    branchName: branchesTable.name,
    userName: usersTable.name,
  })
    .from(expensesTable)
    .leftJoin(branchesTable, eq(expensesTable.branchId, branchesTable.id))
    .leftJoin(usersTable, eq(expensesTable.createdByUserId, usersTable.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(expensesTable.date), desc(expensesTable.createdAt));

  type ExpRow = {
    reference: string; date: string; category: string; branchName: string;
    amount: number; paymentMethod: string; status: string; notes: string; createdBy: string;
  };

  const CATEGORY_LABELS: Record<string, string> = {
    rent: "Loyer", utilities: "Services", salaries: "Salaires", supplies: "Fournitures",
    maintenance: "Maintenance", marketing: "Marketing", transport: "Transport",
    taxes: "Impôts/Taxes", other: "Autre",
  };
  const METHOD_LABELS: Record<string, string> = {
    cash: "Espèces", transfer: "Virement", check: "Chèque", card: "Carte",
  };

  let expRows: ExpRow[] = rows.map(r => ({
    reference: r.exp.reference,
    date: fmtDate(r.exp.date),
    category: CATEGORY_LABELS[r.exp.category] ?? r.exp.category,
    branchName: r.branchName ?? "",
    amount: n(r.exp.amount),
    paymentMethod: METHOD_LABELS[r.exp.paymentMethod] ?? r.exp.paymentMethod,
    status: EXP_STATUS_LABELS[r.exp.status] ?? r.exp.status,
    notes: r.exp.notes ?? "",
    createdBy: r.userName ?? "",
  }));

  if (search) {
    const q = search.toLowerCase();
    expRows = expRows.filter(r =>
      r.reference.toLowerCase().includes(q) ||
      r.category.toLowerCase().includes(q) ||
      r.branchName.toLowerCase().includes(q) ||
      r.notes.toLowerCase().includes(q)
    );
  }

  const [branches] = await Promise.all([
    db.select({ id: branchesTable.id, name: branchesTable.name }).from(branchesTable),
  ]);
  const branchMap = Object.fromEntries(branches.map(b => [b.id, b.name]));
  const branchLabel = branchId ? (branchMap[parseInt(branchId, 10)] ?? undefined) : undefined;
  const filename = buildFilename("depenses", branchLabel, from, to);

  const csv = toCsv<ExpRow>([
    { header: "Référence",       value: r => r.reference },
    { header: "Date",            value: r => r.date },
    { header: "Catégorie",       value: r => r.category },
    { header: "Succursale",      value: r => r.branchName },
    { header: "Montant (DA)",    value: r => r.amount },
    { header: "Mode paiement",   value: r => r.paymentMethod },
    { header: "Statut",          value: r => r.status },
    { header: "Notes",           value: r => r.notes },
    { header: "Créé par",        value: r => r.createdBy },
  ], expRows);

  sendCsv(res, filename, csv);
});

// ── STOCK EXPORT ──────────────────────────────────────────────────────────

router.get("/export/stock", requireAuth, requirePermission(P.stock.view), async (req, res): Promise<void> => {
  const { branchId, alert } = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);

  if (scope !== null && scope.length === 0) { sendCsv(res, "stock.csv", ""); return; }

  const [levels, branches] = await Promise.all([
    db.select({
      sl: stockLevelsTable,
      productName: productsTable.name,
      productType: productsTable.type,
      branchName: branchesTable.name,
      unitName: unitsTable.name,
    })
      .from(stockLevelsTable)
      .leftJoin(productsTable, eq(stockLevelsTable.productId, productsTable.id))
      .leftJoin(branchesTable, eq(stockLevelsTable.branchId, branchesTable.id))
      .leftJoin(unitsTable, eq(productsTable.unitId, unitsTable.id)),
    db.select({ id: branchesTable.id, name: branchesTable.name }).from(branchesTable),
  ]);

  const branchMap = Object.fromEntries(branches.map(b => [b.id, b.name]));

  type StockRow = {
    product: string; type: string; branch: string;
    qty: number; alertQty: number | null; unit: string; status: string;
  };

  const STATUS_LABELS: Record<string, string> = {
    ok: "OK", low: "Bas", critical: "Critique", out: "Rupture",
  };
  const TYPE_LABELS_STOCK: Record<string, string> = {
    finished: "Produit fini", raw: "Matière première", packaging: "Emballage", consumable: "Consommable",
  };

  let rows: StockRow[] = levels.map(r => {
    const qty = n(r.sl.quantity);
    const alertQty = r.sl.alertQuantity ? n(r.sl.alertQuantity) : null;
    let status: "ok" | "low" | "critical" | "out" = "ok";
    if (qty === 0) status = "out";
    else if (alertQty && qty <= alertQty * 0.5) status = "critical";
    else if (alertQty && qty <= alertQty) status = "low";
    return {
      product: r.productName ?? "",
      type: TYPE_LABELS_STOCK[r.productType ?? ""] ?? (r.productType ?? ""),
      branch: r.branchName ?? "",
      qty, alertQty, unit: r.unitName ?? "", status,
    };
  });

  if (scope !== null) rows = rows.filter(r => {
    const bid = levels.find(l => (l.productName ?? "") === r.product && (l.branchName ?? "") === r.branch)?.sl.branchId;
    return bid !== undefined && scope.includes(bid);
  });

  if (branchId) {
    const bid = parseInt(branchId, 10);
    if (scope !== null && !scope.includes(bid)) { res.status(403).json({ error: "Accès refusé à cette succursale" }); return; }
    const branchName = branchMap[bid] ?? "";
    rows = rows.filter(r => r.branch === branchName);
  }

  if (alert === "alert") rows = rows.filter(r => r.status !== "ok");
  else if (alert) rows = rows.filter(r => r.status === alert);

  const branchLabel = branchId ? (branchMap[parseInt(branchId, 10)] ?? undefined) : undefined;
  const filename = buildFilename("stock", branchLabel);

  const csv = toCsv<StockRow>([
    { header: "Produit",         value: r => r.product },
    { header: "Type",            value: r => r.type },
    { header: "Succursale",      value: r => r.branch },
    { header: "Quantité",        value: r => r.qty },
    { header: "Seuil alerte",    value: r => r.alertQty ?? "" },
    { header: "Unité",           value: r => r.unit },
    { header: "Statut",          value: r => STATUS_LABELS[r.status] ?? r.status },
  ], rows);

  sendCsv(res, filename, csv);
});

// ── TRANSFERS EXPORT ──────────────────────────────────────────────────────

const TRANSFER_STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon", in_transit: "En transit", received: "Reçu",
  partial: "Partiel", cancelled: "Annulé",
};

router.get("/export/transfers", requireAuth, requirePermission(P.transfers.view), async (req, res): Promise<void> => {
  const { sourceBranchId, destinationBranchId, status, from, to } = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);

  if (scope !== null && scope.length === 0) { sendCsv(res, "transferts.csv", ""); return; }

  const conds: any[] = [];
  if (scope !== null) {
    const ids = scope;
    const idList = ids.join(",");
    conds.push(sql`(${transfersTable.sourceBranchId} = ANY(ARRAY[${sql.raw(idList)}]::int[]) OR ${transfersTable.destinationBranchId} = ANY(ARRAY[${sql.raw(idList)}]::int[]))`);
  }
  if (sourceBranchId) conds.push(eq(transfersTable.sourceBranchId, parseInt(sourceBranchId, 10)));
  if (destinationBranchId) conds.push(eq(transfersTable.destinationBranchId, parseInt(destinationBranchId, 10)));
  if (status) conds.push(eq(transfersTable.status, status));
  conds.push(...buildDateConds(transfersTable, from, to));

  const transfers = await db.select().from(transfersTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(transfersTable.createdAt));

  const [branches, users, itemCounts] = await Promise.all([
    db.select({ id: branchesTable.id, name: branchesTable.name }).from(branchesTable),
    db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable),
    transfers.length > 0
      ? db.select({ transferId: transferItemsTable.transferId, count: sql<number>`count(*)` })
          .from(transferItemsTable)
          .where(inArray(transferItemsTable.transferId, transfers.map(t => t.id)))
          .groupBy(transferItemsTable.transferId)
      : Promise.resolve([]),
  ]);

  const branchMap = Object.fromEntries(branches.map(b => [b.id, b.name]));
  const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));
  const countMap = Object.fromEntries((itemCounts as any[]).map(r => [r.transferId, Number(r.count)]));

  type TransferRow = {
    reference: string; date: string; status: string;
    source: string; destination: string; itemCount: number; createdBy: string; notes: string;
  };

  const rows: TransferRow[] = transfers.map(t => ({
    reference: t.reference,
    date: fmtDate(t.createdAt),
    status: TRANSFER_STATUS_LABELS[t.status] ?? t.status,
    source: branchMap[t.sourceBranchId] ?? "",
    destination: branchMap[t.destinationBranchId] ?? "",
    itemCount: countMap[t.id] ?? 0,
    createdBy: t.createdByUserId ? (userMap[t.createdByUserId] ?? "") : "",
    notes: t.notes ?? "",
  }));

  const filename = buildFilename("transferts", undefined, from, to);

  const csv = toCsv<TransferRow>([
    { header: "Référence",       value: r => r.reference },
    { header: "Date",            value: r => r.date },
    { header: "Statut",          value: r => r.status },
    { header: "Succursale source", value: r => r.source },
    { header: "Succursale destination", value: r => r.destination },
    { header: "Nb articles",     value: r => r.itemCount },
    { header: "Créé par",        value: r => r.createdBy },
    { header: "Notes",           value: r => r.notes },
  ], rows);

  sendCsv(res, filename, csv);
});

// ── FINANCIAL REPORT EXPORT ───────────────────────────────────────────────

router.get("/export/financial", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const { branchId, from, to } = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);

  if (scope !== null && scope.length === 0) { sendCsv(res, "rapport-financier.csv", ""); return; }

  const saleConds: any[] = [];
  const purchConds: any[] = [];
  const expConds: any[] = [sql`${expensesTable.status} = 'validated'`];

  if (scope !== null) {
    if (branchId) {
      const bid = parseInt(branchId, 10);
      if (!scope.includes(bid)) { res.status(403).json({ error: "Accès refusé" }); return; }
      saleConds.push(eq(salesTable.branchId, bid));
      purchConds.push(eq(purchasesTable.branchId, bid));
      expConds.push(eq(expensesTable.branchId, bid));
    } else {
      saleConds.push(inArray(salesTable.branchId, scope));
      purchConds.push(inArray(purchasesTable.branchId, scope));
      expConds.push(inArray(expensesTable.branchId, scope));
    }
  } else if (branchId) {
    const bid = parseInt(branchId, 10);
    saleConds.push(eq(salesTable.branchId, bid));
    purchConds.push(eq(purchasesTable.branchId, bid));
    expConds.push(eq(expensesTable.branchId, bid));
  }

  saleConds.push(...buildDateConds(salesTable, from, to));
  purchConds.push(...buildDateConds(purchasesTable, from, to));
  expConds.push(...buildDateCondsByField(expensesTable.date, from, to));

  const [sales, purchases, expenses, contacts, branches] = await Promise.all([
    db.select().from(salesTable).where(saleConds.length ? and(...saleConds) : undefined),
    db.select().from(purchasesTable).where(purchConds.length ? and(...purchConds) : undefined),
    db.select().from(expensesTable).where(and(...expConds)),
    db.select({ id: contactsTable.id, name: contactsTable.displayName }).from(contactsTable),
    db.select({ id: branchesTable.id, name: branchesTable.name }).from(branchesTable),
  ]);

  const contactMap = Object.fromEntries(contacts.map(c => [c.id, c.name]));
  const branchMap = Object.fromEntries(branches.map(b => [b.id, b.name]));

  const actualSales = sales.filter(s => s.type === "sale");

  // Build customer receivable rows
  const receivablesMap: Record<string, { customerName: string; branchName: string; total: number; paid: number; due: number; count: number }> = {};
  for (const s of actualSales) {
    const cname = s.customerId ? (contactMap[s.customerId] ?? "Client inconnu") : "Vente comptoir";
    const bname = branchMap[s.branchId] ?? "";
    const key = `${cname}__${bname}`;
    if (!receivablesMap[key]) receivablesMap[key] = { customerName: cname, branchName: bname, total: 0, paid: 0, due: 0, count: 0 };
    receivablesMap[key].total += n(s.total);
    receivablesMap[key].paid += n(s.paid);
    receivablesMap[key].due += Math.max(0, n(s.total) - n(s.paid));
    receivablesMap[key].count++;
  }

  // Build supplier payable rows
  const payablesMap: Record<string, { supplierName: string; branchName: string; total: number; paid: number; due: number; count: number }> = {};
  for (const p of purchases) {
    const sname = p.supplierId ? (contactMap[p.supplierId] ?? "Fournisseur inconnu") : "Inconnu";
    const bname = branchMap[p.branchId] ?? "";
    const key = `${sname}__${bname}`;
    if (!payablesMap[key]) payablesMap[key] = { supplierName: sname, branchName: bname, total: 0, paid: 0, due: 0, count: 0 };
    payablesMap[key].total += n(p.total);
    payablesMap[key].paid += n(p.paid);
    payablesMap[key].due += Math.max(0, n(p.total) - n(p.paid));
    payablesMap[key].count++;
  }

  // Build expense category rows
  const expMap: Record<string, { category: string; branchName: string; total: number; count: number }> = {};
  const CAT_LABELS: Record<string, string> = {
    rent: "Loyer", utilities: "Services", salaries: "Salaires", supplies: "Fournitures",
    maintenance: "Maintenance", marketing: "Marketing", transport: "Transport",
    taxes: "Impôts/Taxes", other: "Autre",
  };
  for (const e of expenses) {
    const bname = branchMap[e.branchId] ?? "";
    const key = `${e.category}__${bname}`;
    if (!expMap[key]) expMap[key] = { category: CAT_LABELS[e.category] ?? e.category, branchName: bname, total: 0, count: 0 };
    expMap[key].total += n(e.amount);
    expMap[key].count++;
  }

  // Summary totals
  const totalRevenue = actualSales.reduce((s, r) => s + n(r.total), 0);
  const totalCollected = actualSales.reduce((s, r) => s + n(r.paid), 0);
  const totalPurchases = purchases.reduce((s, r) => s + n(r.total), 0);
  const totalExpenses = expenses.reduce((s, r) => s + n(r.amount), 0);
  const netBalance = totalCollected - totalExpenses;

  type FinRow = { section: string; label: string; detail: string; montant: number; quantite: number };

  const rows: FinRow[] = [
    { section: "RÉSUMÉ", label: "Chiffre d'affaires total", detail: "Toutes ventes facturées", montant: totalRevenue, quantite: actualSales.length },
    { section: "RÉSUMÉ", label: "Montant encaissé", detail: "Paiements reçus", montant: totalCollected, quantite: 0 },
    { section: "RÉSUMÉ", label: "Créances clients", detail: "Montant non encore encaissé", montant: totalRevenue - totalCollected, quantite: 0 },
    { section: "RÉSUMÉ", label: "Total achats fournisseurs", detail: "Montant commandé", montant: totalPurchases, quantite: purchases.length },
    { section: "RÉSUMÉ", label: "Total charges validées", detail: "Dépenses validées uniquement", montant: totalExpenses, quantite: expenses.length },
    { section: "RÉSUMÉ", label: "Solde net (encaissé - charges)", detail: "", montant: netBalance, quantite: 0 },
    ...Object.values(receivablesMap).map(r => ({
      section: "CRÉANCES CLIENTS", label: r.customerName, detail: r.branchName,
      montant: r.due, quantite: r.count,
    })),
    ...Object.values(payablesMap).map(r => ({
      section: "DETTES FOURNISSEURS", label: r.supplierName, detail: r.branchName,
      montant: r.due, quantite: r.count,
    })),
    ...Object.values(expMap).map(r => ({
      section: "CHARGES PAR CATÉGORIE", label: r.category, detail: r.branchName,
      montant: r.total, quantite: r.count,
    })),
  ];

  const branchLabel = branchId ? (branchMap[parseInt(branchId, 10)] ?? undefined) : undefined;
  const filename = buildFilename("rapport-financier", branchLabel, from, to);

  const csv = toCsv<FinRow>([
    { header: "Section",         value: r => r.section },
    { header: "Libellé",         value: r => r.label },
    { header: "Détail",          value: r => r.detail },
    { header: "Montant (DA)",    value: r => r.montant },
    { header: "Quantité/Nb",     value: r => r.quantite || "" },
  ], rows);

  sendCsv(res, filename, csv);
});

// ── RETURNS / AVOIRS EXPORT ────────────────────────────────────────────────

const RETURN_STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon", confirmed: "Confirmé",
  partially_refunded: "Partiellement remboursé", refunded: "Remboursé", cancelled: "Annulé",
};

router.get("/export/returns", requireAuth, requirePermission(P.returns.view), async (req, res): Promise<void> => {
  const { branchId, status, from, to } = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);

  if (scope !== null && scope.length === 0) { sendCsv(res, "retours.csv", ""); return; }

  const conds: any[] = [];
  if (scope !== null) conds.push(inArray(salesReturnsTable.branchId, scope));
  if (branchId) conds.push(eq(salesReturnsTable.branchId, parseInt(branchId, 10)));
  if (status) conds.push(eq(salesReturnsTable.status, status));
  if (from) conds.push(gte(salesReturnsTable.createdAt, new Date(from)));
  if (to) {
    const d = new Date(to); d.setHours(23, 59, 59, 999);
    conds.push(lte(salesReturnsTable.createdAt, d));
  }

  const rows = await db.select({
    ret: salesReturnsTable,
    customerName: contactsTable.displayName,
    branchName: branchesTable.name,
    saleRef: salesTable.reference,
    createdByName: usersTable.name,
  })
    .from(salesReturnsTable)
    .leftJoin(contactsTable, eq(salesReturnsTable.customerId, contactsTable.id))
    .leftJoin(branchesTable, eq(salesReturnsTable.branchId, branchesTable.id))
    .leftJoin(salesTable, eq(salesReturnsTable.saleId, salesTable.id))
    .leftJoin(usersTable, eq(salesReturnsTable.createdByUserId, usersTable.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(salesReturnsTable.createdAt));

  type RetRow = {
    reference: string; saleRef: string; customer: string; branch: string;
    status: string; reason: string; totalAmount: number; refundedAmount: number;
    remaining: number; createdBy: string; createdAt: string;
  };

  const exportRows: RetRow[] = rows.map(r => ({
    reference: r.ret.reference,
    saleRef: r.saleRef ?? "",
    customer: r.customerName ?? "—",
    branch: r.branchName ?? "—",
    status: RETURN_STATUS_LABELS[r.ret.status] ?? r.ret.status,
    reason: r.ret.reason ?? "",
    totalAmount: n(r.ret.totalAmount),
    refundedAmount: n(r.ret.refundedAmount),
    remaining: Math.max(0, n(r.ret.totalAmount) - n(r.ret.refundedAmount)),
    createdBy: r.createdByName ?? "—",
    createdAt: fmtDatetime(r.ret.createdAt),
  }));

  const branchMap = await db.select({ id: branchesTable.id, name: branchesTable.name }).from(branchesTable);
  const branchLabel = branchId ? (branchMap.find(b => b.id === parseInt(branchId, 10))?.name ?? undefined) : undefined;
  const filename = buildFilename("retours-avoirs", branchLabel, from, to);

  const csv = toCsv<RetRow>([
    { header: "Référence",              value: r => r.reference },
    { header: "Vente liée",             value: r => r.saleRef },
    { header: "Client",                 value: r => r.customer },
    { header: "Succursale",             value: r => r.branch },
    { header: "Statut",                 value: r => r.status },
    { header: "Motif",                  value: r => r.reason },
    { header: "Montant avoir (DA)",     value: r => fmtDA(r.totalAmount) },
    { header: "Remboursé (DA)",         value: r => fmtDA(r.refundedAmount) },
    { header: "Restant à rembourser",   value: r => fmtDA(r.remaining) },
    { header: "Créé par",               value: r => r.createdBy },
    { header: "Date",                   value: r => r.createdAt },
  ], exportRows);

  sendCsv(res, filename, csv);
});

// ─── helpers locaux pour le format CSV produits ──────────────────────────────
function fmtPriceExact(n: number): string {
  const [int, dec] = n.toFixed(2).split(".");
  const intFormatted = int.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
  return `${intFormatted}.${dec} DA`;
}

function fmtQtyExact(qty: number, unit: string): string {
  const [int, dec] = qty.toFixed(2).split(".");
  const intFormatted = int.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
  return `${intFormatted}.${dec} ${unit}`;
}

router.get("/export/products", requireAuth, requirePermission(P.products.view), async (req, res): Promise<void> => {
  const { type, categoryId, branchId, search } = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);

  if (scope !== null && scope.length === 0) { sendCsv(res, "produits.csv", ""); return; }

  const [products, branches, stockSums] = await Promise.all([
    db.select({
      p: productsTable,
      categoryName: categoriesTable.name,
      unitName: unitsTable.name,
    })
      .from(productsTable)
      .leftJoin(categoriesTable, eq(productsTable.categoryId, categoriesTable.id))
      .leftJoin(unitsTable, eq(productsTable.unitId, unitsTable.id)),
    db.select({ id: branchesTable.id, name: branchesTable.name }).from(branchesTable),
    db.select({
      productId: stockLevelsTable.productId,
      totalQty: sql<number>`COALESCE(SUM(${stockLevelsTable.quantity}::numeric), 0)`,
    }).from(stockLevelsTable).groupBy(stockLevelsTable.productId),
  ]);

  const branchMap = Object.fromEntries(branches.map(b => [b.id, b.name]));
  const stockMap = Object.fromEntries(stockSums.map(s => [s.productId, Number(s.totalQty)]));

  type ProdRow = {
    name: string;
    lieuAffaires: string;
    prixAchat: string;
    prixVente: string;
    stockActuel: string;
    typeProduit: string;
    categorie: string;
    sku: string;
  };

  const TYPE_LABELS: Record<string, string> = {
    finished: "Produit fini", raw: "Matière première", ingredient: "Ingrédient",
    semi_finished: "Semi-fini", packaging: "Emballage", consumable: "Consommable", service: "Service",
  };

  if (branchId && branchId !== "all") {
    const bid = parseInt(branchId, 10);
    if (scope !== null && !scope.includes(bid)) { res.status(403).json({ error: "Accès refusé à cette succursale" }); return; }
  }

  let filtered = products.filter(r => {
    const bIds: number[] = (r.p.branchIds as number[]) ?? [];

    if (scope !== null && !bIds.some(id => scope.includes(id))) return false;

    if (type && r.p.type !== type) return false;

    if (categoryId) {
      const catId = parseInt(categoryId, 10);
      if (r.p.categoryId !== catId) return false;
    }

    if (branchId && branchId !== "all") {
      const bid = parseInt(branchId, 10);
      if (!bIds.includes(bid)) return false;
    }

    if (search) {
      const q = search.toLowerCase();
      if (!r.p.name.toLowerCase().includes(q) && !(r.p.sku ?? "").toLowerCase().includes(q)) return false;
    }

    return true;
  });

  const rows: ProdRow[] = filtered.map(r => {
    const bIds: number[] = (r.p.branchIds as number[]) ?? [];
    const lieuAffaires = bIds.map(id => branchMap[id] ?? "").filter(Boolean).join(", ");
    const totalQty = stockMap[r.p.id] ?? 0;
    const unitName = r.unitName ?? "";
    return {
      name: r.p.name,
      lieuAffaires,
      prixAchat: fmtPriceExact(parseFloat(r.p.costPrice as string) || 0),
      prixVente: fmtPriceExact(parseFloat(r.p.sellingPrice as string) || 0),
      stockActuel: fmtQtyExact(totalQty, unitName),
      typeProduit: TYPE_LABELS[r.p.type] ?? r.p.type,
      categorie: r.categoryName ?? "",
      sku: r.p.sku ?? "",
    };
  });

  const branchLabel = (branchId && branchId !== "all") ? (branchMap[parseInt(branchId, 10)] ?? undefined) : undefined;
  const filename = buildFilename("produits", branchLabel);

  const csv = toCsv<ProdRow>([
    { header: "Produit",              value: r => r.name },
    { header: "Lieu d'affaires",      value: r => r.lieuAffaires },
    { header: "Prix d'achat unitaire",value: r => r.prixAchat },
    { header: "Prix de vente",        value: r => r.prixVente },
    { header: "Stock actuel",         value: r => r.stockActuel },
    { header: "Type de produit",      value: r => r.typeProduit },
    { header: "Catégorie",            value: r => r.categorie },
    { header: "SKU",                  value: r => r.sku },
  ], rows);

  sendCsv(res, filename, csv);
});

// ── ADJUSTMENTS EXPORT ────────────────────────────────────────────────────

router.get("/export/adjustments", requireAuth, requirePermission(P.adjustments.view), async (req, res): Promise<void> => {
  const { branchId, branchIds, reason, dateFrom, dateTo, productSearch } = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);
  if (scope !== null && scope.length === 0) { sendCsv(res, "ajustements.csv", ""); return; }

  const conds: any[] = [];

  // Branch scope
  if (scope !== null) {
    conds.push(inArray(adjustmentsTable.branchId, scope));
  }

  // Branch filter: multi (branchIds=1,2,3) or single (branchId=1)
  if (branchIds) {
    const ids = branchIds.split(",").map(x => parseInt(x.trim(), 10)).filter(Boolean);
    if (ids.length > 0) {
      const allowed = scope !== null ? ids.filter(id => scope.includes(id)) : ids;
      if (allowed.length > 0) conds.push(inArray(adjustmentsTable.branchId, allowed));
    }
  } else if (branchId) {
    conds.push(eq(adjustmentsTable.branchId, parseInt(branchId, 10)));
  }

  if (reason) conds.push(eq(adjustmentsTable.reason, reason));
  if (dateFrom) conds.push(gte(adjustmentsTable.createdAt, new Date(dateFrom)));
  if (dateTo) {
    const d = new Date(dateTo); d.setHours(23, 59, 59, 999);
    conds.push(lte(adjustmentsTable.createdAt, d));
  }
  if (productSearch) conds.push(ilike(productsTable.name, `%${productSearch}%`));

  const rows = await db.select({
    adj: adjustmentsTable,
    branchName: branchesTable.name,
    productName: productsTable.name,
    costPrice: productsTable.costPrice,
    createdByName: usersTable.name,
  }).from(adjustmentsTable)
    .leftJoin(branchesTable, eq(adjustmentsTable.branchId, branchesTable.id))
    .leftJoin(productsTable, eq(adjustmentsTable.productId, productsTable.id))
    .leftJoin(usersTable, eq(adjustmentsTable.createdByUserId, usersTable.id))
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(adjustmentsTable.createdAt));

  type Row = typeof rows[number];

  const branchLabel = branchId && !branchIds
    ? rows[0]?.branchName ?? undefined
    : undefined;
  const filename = buildFilename("ajustements", branchLabel, dateFrom, dateTo);

  const csv = toCsv<Row>([
    { header: "Référence",      value: r => r.adj.reference },
    { header: "Date",           value: r => fmtDate(r.adj.createdAt) },
    { header: "Produit",        value: r => r.productName ?? "" },
    { header: "Boutique",       value: r => r.branchName ?? "" },
    { header: "Variation",      value: r => n(r.adj.quantityChange) },
    { header: "Valeur (DA)",    value: r => {
      const qty = n(r.adj.quantityChange);
      const cost = n(r.costPrice);
      return qty < 0 && cost > 0 ? Math.abs(qty) * cost : "";
    }},
    { header: "Motif",          value: r => r.adj.reason },
    { header: "Par",            value: r => r.createdByName ?? "" },
    { header: "Notes",          value: r => r.adj.notes ?? "" },
  ], rows);

  sendCsv(res, filename, csv);
});

// ── DISCOUNTS EXPORT ──────────────────────────────────────────────────────
router.get("/export/discounts", requireAuth, requirePermission(P.sales.view), async (req, res): Promise<void> => {
  const { from, to, branchIds: branchIdsRaw } = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);
  const branchIds = branchIdsRaw ? branchIdsRaw.split(",").map(s => parseInt(s.trim(), 10)).filter(x => !isNaN(x)) : undefined;

  const conds: any[] = [
    sql`${saleItemsTable.discount}::numeric > 0`,
    eq(salesTable.type, "sale"), eq(salesTable.status, "confirmed"),
  ];
  if (scope !== null) {
    if (scope.length === 0) { res.json([]); return; }
    conds.push(inArray(salesTable.branchId, scope));
  }
  if (branchIds && branchIds.length > 0) conds.push(inArray(salesTable.branchId, branchIds));
  if (from) conds.push(gte(salesTable.createdAt, new Date(from)));
  if (to) { const d = new Date(to); d.setHours(23, 59, 59, 999); conds.push(lte(salesTable.createdAt, d)); }

  const rows = await db.select({
    reference: salesTable.reference, createdAt: salesTable.createdAt,
    paymentStatus: salesTable.paymentStatus, notes: salesTable.notes,
    customerName: contactsTable.displayName, branchName: branchesTable.name, sellerName: usersTable.name,
    productName: productsTable.name, qty: saleItemsTable.quantity,
    unitPrice: saleItemsTable.unitPrice, discount: saleItemsTable.discount,
    total: saleItemsTable.total, costPrice: productsTable.costPrice,
  }).from(saleItemsTable)
    .innerJoin(salesTable, eq(saleItemsTable.saleId, salesTable.id))
    .leftJoin(contactsTable, eq(salesTable.customerId, contactsTable.id))
    .innerJoin(branchesTable, eq(salesTable.branchId, branchesTable.id))
    .leftJoin(usersTable, eq(salesTable.createdByUserId, usersTable.id))
    .innerJoin(productsTable, eq(saleItemsTable.productId, productsTable.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(salesTable.createdAt));

  const filename = buildFilename("remises-ventes", undefined, from, to);
  type Row = typeof rows[number];
  const csv = toCsv<Row>([
    { header: "Référence",          value: r => r.reference },
    { header: "Date",               value: r => fmtDate(r.createdAt!) },
    { header: "Heure",              value: r => r.createdAt ? new Date(r.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "" },
    { header: "Client",             value: r => r.customerName ?? "Anonyme" },
    { header: "Produit",            value: r => r.productName },
    { header: "Quantité",           value: r => n(r.qty) },
    { header: "Prix unitaire (DA)", value: r => n(r.unitPrice) },
    { header: "Prix original (DA)", value: r => Math.round(n(r.qty) * n(r.unitPrice)) },
    { header: "Remise (DA)",        value: r => n(r.discount) },
    { header: "% Remise",           value: r => { const orig = n(r.qty) * n(r.unitPrice); return orig > 0 ? Math.round((n(r.discount) / orig) * 1000) / 10 : 0; } },
    { header: "Prix final (DA)",    value: r => n(r.total) },
    { header: "Profit (DA)",        value: r => Math.round(n(r.total) - n(r.qty) * n(r.costPrice)) },
    { header: "Vendeur",            value: r => r.sellerName ?? "—" },
    { header: "Boutique",           value: r => r.branchName },
    { header: "Paiement",           value: r => r.paymentStatus ?? "" },
    { header: "Raison",             value: r => r.notes ?? "" },
  ], rows);
  sendCsv(res, filename, csv);
});

export default router;

