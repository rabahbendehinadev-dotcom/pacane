import { Router, type IRouter } from "express";
import { db, companySettingsTable, paymentMethodsTable, discountReasonsTable } from "@workspace/db";
import { eq, asc, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission } from "../middlewares/permissions";
import { P } from "../lib/permissions";

const router: IRouter = Router();

const ALLOWED_COMPANY_FIELDS = [
  "name", "email", "phone", "address", "city", "website", "taxId",
  "currency", "currencySymbol", "defaultLanguage",
  "taxRate", "taxEnabled",
  "invoicePrefix", "quotePrefix", "orderPrefix", "purchasePrefix",
  "transferPrefix", "productionPrefix", "expensePrefix",
  "logoUrl", "footerNote",
];

router.get("/settings/company", requireAuth, async (_req, res): Promise<void> => {
  let [settings] = await db.select().from(companySettingsTable);
  if (!settings) {
    [settings] = await db.insert(companySettingsTable).values({ name: "Ma Pâtisserie" }).returning();
  }
  res.json({ ...settings, taxRate: parseFloat(settings.taxRate as string) });
});

router.patch("/settings/company", requireAuth, requirePermission(P.settings.edit), async (req, res): Promise<void> => {
  const [existing] = await db.select().from(companySettingsTable);
  const updates: Record<string, unknown> = {};
  for (const key of ALLOWED_COMPANY_FIELDS) {
    if (req.body[key] != null) {
      if (key === "taxRate") updates[key] = req.body[key].toString();
      else updates[key] = req.body[key];
    }
  }
  let settings;
  if (existing) {
    [settings] = await db.update(companySettingsTable).set(updates as any).where(eq(companySettingsTable.id, existing.id)).returning();
  } else {
    [settings] = await db.insert(companySettingsTable).values({ name: "Ma Pâtisserie", ...updates } as any).returning();
  }
  res.json({ ...settings, taxRate: parseFloat(settings.taxRate as string) });
});

router.get("/settings/payment-methods", requireAuth, requirePermission(P.settings.view), async (_req, res): Promise<void> => {
  const methods = await db.select().from(paymentMethodsTable).orderBy(asc(paymentMethodsTable.sortOrder), asc(paymentMethodsTable.name));
  res.json(methods);
});

router.post("/settings/payment-methods", requireAuth, requirePermission(P.settings.edit), async (req, res): Promise<void> => {
  const { name, type, isActive, sortOrder } = req.body;
  if (!name || !type) { res.status(400).json({ error: "Nom et type requis" }); return; }
  const existing = await db.select().from(paymentMethodsTable);
  const maxOrder = existing.length > 0 ? Math.max(...existing.map(m => m.sortOrder)) : 0;
  const [method] = await db.insert(paymentMethodsTable)
    .values({ name, type, isActive: isActive ?? true, sortOrder: sortOrder ?? maxOrder + 1 })
    .returning();
  res.status(201).json(method);
});

router.patch("/settings/payment-methods/:id", requireAuth, requirePermission(P.settings.edit), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [existing] = await db.select().from(paymentMethodsTable).where(eq(paymentMethodsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Méthode introuvable" }); return; }
  const updates: Record<string, unknown> = {};
  if (req.body.name != null) updates.name = req.body.name;
  if (req.body.type != null) updates.type = req.body.type;
  if (req.body.isActive != null) updates.isActive = req.body.isActive;
  if (req.body.sortOrder != null) updates.sortOrder = req.body.sortOrder;
  const [method] = await db.update(paymentMethodsTable).set(updates as any).where(eq(paymentMethodsTable.id, id)).returning();
  res.json(method);
});

router.delete("/settings/payment-methods/:id", requireAuth, requirePermission(P.settings.edit), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [existing] = await db.select().from(paymentMethodsTable).where(eq(paymentMethodsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Méthode introuvable" }); return; }
  await db.delete(paymentMethodsTable).where(eq(paymentMethodsTable.id, id));
  res.json({ success: true });
});

// ── Discount Reasons CRUD ──────────────────────────────────────────────────────

router.get("/settings/discount-reasons", requireAuth, requirePermission(P.settings.view), async (_req, res): Promise<void> => {
  const reasons = await db.select().from(discountReasonsTable).orderBy(asc(discountReasonsTable.sortOrder), asc(discountReasonsTable.label));
  res.json(reasons);
});

router.post("/settings/discount-reasons", requireAuth, requirePermission(P.settings.edit), async (req, res): Promise<void> => {
  const { label, requiresNote, isActive, sortOrder } = req.body;
  if (!label) { res.status(400).json({ error: "Libellé requis" }); return; }
  const existing = await db.select().from(discountReasonsTable);
  const maxOrder = existing.length > 0 ? Math.max(...existing.map(r => r.sortOrder)) : 0;
  const [reason] = await db.insert(discountReasonsTable)
    .values({ label, requiresNote: requiresNote ?? false, isActive: isActive ?? true, sortOrder: sortOrder ?? maxOrder + 1 })
    .returning();
  res.status(201).json(reason);
});

router.patch("/settings/discount-reasons/:id", requireAuth, requirePermission(P.settings.edit), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [existing] = await db.select().from(discountReasonsTable).where(eq(discountReasonsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Motif introuvable" }); return; }
  const updates: Record<string, unknown> = {};
  if (req.body.label != null) updates.label = req.body.label;
  if (req.body.requiresNote != null) updates.requiresNote = req.body.requiresNote;
  if (req.body.isActive != null) updates.isActive = req.body.isActive;
  if (req.body.sortOrder != null) updates.sortOrder = req.body.sortOrder;
  const [reason] = await db.update(discountReasonsTable).set(updates as any).where(eq(discountReasonsTable.id, id)).returning();
  res.json(reason);
});

router.delete("/settings/discount-reasons/:id", requireAuth, requirePermission(P.settings.edit), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [existing] = await db.select().from(discountReasonsTable).where(eq(discountReasonsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Motif introuvable" }); return; }
  await db.delete(discountReasonsTable).where(eq(discountReasonsTable.id, id));
  res.json({ success: true });
});

router.post("/settings/reset", requireAuth, requirePermission(P.settings.edit), async (req, res): Promise<void> => {
  if (!req.user!.adminAccess) {
    res.status(403).json({ error: "Accès admin requis pour cette opération" });
    return;
  }
  if (req.body.confirm !== "RESET") {
    res.status(400).json({ error: "Confirmation invalide" });
    return;
  }
  try {
    await db.execute(sql`
      TRUNCATE TABLE
        sale_items, sale_payments, sales,
        purchase_return_items, purchase_returns,
        purchase_reception_items, purchase_receptions,
        purchase_items, purchase_payments, purchases,
        transfer_items, transfers,
        expenses,
        production_orders,
        pos_sessions,
        sales_return_items, sales_returns,
        adjustments,
        stock_movements, stock_levels,
        customer_wallet_movements,
        customer_loyalty_notes,
        customer_rfm_snapshots,
        saved_customer_audiences,
        erp_alerts,
        credit_override_logs,
        production_override_logs,
        attachments
      RESTART IDENTITY CASCADE
    `);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Erreur lors du reset" });
  }
});

export default router;
