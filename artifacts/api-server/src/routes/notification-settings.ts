import { Router } from "express";
import { db } from "@workspace/db";
import { notificationPreferencesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();

// ── GET /notification-settings ────────────────────────────────────────────────
router.get("/notification-settings", requireAuth, async (req, res) => {
  const userId = (req as any).user.id as number;

  const [prefs] = await db
    .select()
    .from(notificationPreferencesTable)
    .where(eq(notificationPreferencesTable.userId, userId))
    .limit(1);

  if (!prefs) {
    // Return defaults (no row yet)
    return res.json({
      pushEnabled: true, inAppEnabled: true,
      prefSales: true, prefRemise: true, prefStockLow: true,
      prefNewProduct: false, prefReceivables: true, prefInvoices: true,
      prefReturns: true, prefExpenses: true, prefCustomers: false,
      prefWorkers: false, prefAbsence: false, prefPrimes: false,
      prefAvertissements: false, prefLeaves: false, prefUpdates: true, prefSecurity: true,
    });
  }

  res.json(prefs);
});

// ── PUT /notification-settings ────────────────────────────────────────────────
router.put("/notification-settings", requireAuth, async (req, res) => {
  const userId = (req as any).user.id as number;
  const {
    pushEnabled, inAppEnabled,
    prefSales, prefRemise, prefStockLow, prefNewProduct, prefReceivables,
    prefInvoices, prefReturns, prefExpenses, prefCustomers, prefWorkers,
    prefAbsence, prefPrimes, prefAvertissements, prefLeaves, prefUpdates, prefSecurity,
  } = req.body;

  const data = {
    pushEnabled: pushEnabled ?? true,
    inAppEnabled: inAppEnabled ?? true,
    prefSales: prefSales ?? true,
    prefRemise: prefRemise ?? true,
    prefStockLow: prefStockLow ?? true,
    prefNewProduct: prefNewProduct ?? false,
    prefReceivables: prefReceivables ?? true,
    prefInvoices: prefInvoices ?? true,
    prefReturns: prefReturns ?? true,
    prefExpenses: prefExpenses ?? true,
    prefCustomers: prefCustomers ?? false,
    prefWorkers: prefWorkers ?? false,
    prefAbsence: prefAbsence ?? false,
    prefPrimes: prefPrimes ?? false,
    prefAvertissements: prefAvertissements ?? false,
    prefLeaves: prefLeaves ?? false,
    prefUpdates: prefUpdates ?? true,
    prefSecurity: prefSecurity ?? true,
  };

  const existing = await db
    .select({ id: notificationPreferencesTable.id })
    .from(notificationPreferencesTable)
    .where(eq(notificationPreferencesTable.userId, userId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(notificationPreferencesTable)
      .set(data)
      .where(eq(notificationPreferencesTable.userId, userId));
  } else {
    await db
      .insert(notificationPreferencesTable)
      .values({ userId, ...data });
  }

  res.json({ ok: true, ...data });
});

export default router;
