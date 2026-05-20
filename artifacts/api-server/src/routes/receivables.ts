import { Router, type IRouter } from "express";
import { db, salesTable, contactsTable, branchesTable, salePaymentsTable } from "@workspace/db";
import { eq, and, inArray, isNotNull, sql, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { visibleBranchIds } from "../middlewares/permissions";

const router: IRouter = Router();

// ── Types ────────────────────────────────────────────────────────────────
export interface ReceivableAlert {
  customerId: number;
  contactName: string;
  companyName: string | null;
  city: string | null;
  totalUnpaid: number;
  invoiceCount: number;
  daysOverdue: number;
  oldestInvoiceDate: string;
  creditLimit: number | null;
  creditUsagePct: number | null;
  creditExceeded: boolean;
  lastPaymentDate: string | null;
  branchId: number;
  branchName: string;
  severity: "warning" | "critical";
  alertReasons: string[];
}

// ── Severity thresholds ──────────────────────────────────────────────────
const CRITICAL_DAYS = 60;
const WARNING_DAYS = 30;
const WARNING_CREDIT_PCT = 80;
const CRITICAL_AMOUNT_NO_LIMIT = 800_000; // DA — critical when no credit limit

/**
 * GET /api/receivables/alerts
 *
 * Returns per-customer receivable alerts, severity classified.
 * Branch-scoped based on requesting user's permissions.
 */
router.get("/receivables/alerts", requireAuth, async (req, res): Promise<void> => {
  const { branchId } = req.query as Record<string, string>;
  const allowed = visibleBranchIds(req.user!);
  const targetBranchId = branchId && branchId !== "all" ? parseInt(branchId, 10) : null;

  if (targetBranchId && allowed !== null && !allowed.includes(targetBranchId)) {
    res.status(403).json({ error: "Accès refusé à cette succursale" });
    return;
  }

  // ── Fetch all unpaid/partial confirmed sales with a customer ──────────
  const rows = await db
    .select({
      saleId: salesTable.id,
      total: salesTable.total,
      paid: salesTable.paid,
      customerId: salesTable.customerId,
      branchId: salesTable.branchId,
      createdAt: salesTable.createdAt,
      contactName: contactsTable.displayName,
      companyName: contactsTable.companyName,
      city: contactsTable.city,
      creditLimit: contactsTable.creditLimit,
      branchName: branchesTable.name,
    })
    .from(salesTable)
    .leftJoin(contactsTable, eq(salesTable.customerId, contactsTable.id))
    .leftJoin(branchesTable, eq(salesTable.branchId, branchesTable.id))
    .where(
      and(
        isNotNull(salesTable.customerId),
        eq(salesTable.type, "sale"),
        inArray(salesTable.status, ["confirmed", "active"]),
        inArray(salesTable.paymentStatus, ["unpaid", "partially_paid"]),
      )
    );

  // ── Fetch most recent payments per customer ───────────────────────────
  const recentPayments = await db
    .select({
      customerId: salesTable.customerId,
      payDate: salePaymentsTable.date,
    })
    .from(salePaymentsTable)
    .leftJoin(salesTable, eq(salePaymentsTable.saleId, salesTable.id))
    .where(isNotNull(salesTable.customerId))
    .orderBy(desc(salePaymentsTable.date));

  const lastPaymentByCustomer = new Map<number, string>();
  for (const p of recentPayments) {
    if (p.customerId && !lastPaymentByCustomer.has(p.customerId)) {
      lastPaymentByCustomer.set(p.customerId, p.payDate);
    }
  }

  // ── Aggregate by customer ─────────────────────────────────────────────
  interface CustomerAgg {
    customerId: number;
    contactName: string;
    companyName: string | null;
    city: string | null;
    creditLimit: number | null;
    branchId: number;
    branchName: string;
    totalUnpaid: number;
    invoiceCount: number;
    oldestInvoiceDate: Date;
  }

  const byCustomer = new Map<number, CustomerAgg>();

  for (const row of rows) {
    if (!row.customerId) continue;

    // Apply branch filter
    if (targetBranchId && row.branchId !== targetBranchId) continue;
    if (!targetBranchId && allowed !== null && !allowed.includes(row.branchId)) continue;

    const due = parseFloat(row.total as string) - parseFloat(row.paid as string);
    if (due <= 0) continue;

    const existing = byCustomer.get(row.customerId);
    if (existing) {
      existing.totalUnpaid += due;
      existing.invoiceCount += 1;
      if (row.createdAt < existing.oldestInvoiceDate) {
        existing.oldestInvoiceDate = row.createdAt;
      }
    } else {
      byCustomer.set(row.customerId, {
        customerId: row.customerId,
        contactName: row.contactName ?? "Client inconnu",
        companyName: row.companyName ?? null,
        city: row.city ?? null,
        creditLimit: row.creditLimit != null ? parseFloat(row.creditLimit as string) : null,
        branchId: row.branchId,
        branchName: row.branchName ?? "—",
        totalUnpaid: due,
        invoiceCount: 1,
        oldestInvoiceDate: row.createdAt,
      });
    }
  }

  // ── Classify severity ─────────────────────────────────────────────────
  const now = new Date();
  const alerts: ReceivableAlert[] = [];

  for (const c of byCustomer.values()) {
    const daysOverdue = Math.floor(
      (now.getTime() - c.oldestInvoiceDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    const creditLimit = c.creditLimit;
    const creditUsagePct = creditLimit != null && creditLimit > 0
      ? (c.totalUnpaid / creditLimit) * 100
      : null;
    const creditExceeded = creditLimit != null && c.totalUnpaid > creditLimit;

    // Determine severity
    let severity: "warning" | "critical" | null = null;
    const alertReasons: string[] = [];

    if (creditExceeded) {
      severity = "critical";
      const over = c.totalUnpaid - creditLimit!;
      alertReasons.push(`Limite de crédit dépassée de ${formatDA(over)}`);
    }

    if (daysOverdue >= CRITICAL_DAYS) {
      severity = "critical";
      alertReasons.push(`${daysOverdue} jours sans règlement`);
    } else if (daysOverdue >= WARNING_DAYS && severity !== "critical") {
      severity = "warning";
      alertReasons.push(`${daysOverdue} jours sans règlement`);
    }

    if (creditUsagePct != null && creditUsagePct >= WARNING_CREDIT_PCT && !creditExceeded) {
      if (!severity) severity = "warning";
      alertReasons.push(`${Math.round(creditUsagePct)}% du crédit utilisé`);
    }

    // No credit limit but very large balance
    if (creditLimit == null && c.totalUnpaid >= CRITICAL_AMOUNT_NO_LIMIT) {
      if (severity !== "critical") {
        severity = severity ? severity : "warning";
        if (c.totalUnpaid >= CRITICAL_AMOUNT_NO_LIMIT) severity = "critical";
      }
      if (!alertReasons.some(r => r.includes("jours"))) {
        alertReasons.push(`Solde élevé sans plafond défini`);
      }
    }

    if (!severity) continue; // No alert needed

    alerts.push({
      customerId: c.customerId,
      contactName: c.contactName,
      companyName: c.companyName,
      city: c.city,
      totalUnpaid: Math.round(c.totalUnpaid),
      invoiceCount: c.invoiceCount,
      daysOverdue,
      oldestInvoiceDate: c.oldestInvoiceDate.toISOString(),
      creditLimit: creditLimit ?? null,
      creditUsagePct: creditUsagePct != null ? Math.round(creditUsagePct) : null,
      creditExceeded,
      lastPaymentDate: lastPaymentByCustomer.get(c.customerId) ?? null,
      branchId: c.branchId,
      branchName: c.branchName,
      severity,
      alertReasons,
    });
  }

  // Sort: critical first, then by amount desc
  alerts.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "critical" ? -1 : 1;
    return b.totalUnpaid - a.totalUnpaid;
  });

  res.json(alerts);
});

// ── Helper ────────────────────────────────────────────────────────────────
function formatDA(n: number): string {
  return new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(n) + " DA";
}

export default router;
