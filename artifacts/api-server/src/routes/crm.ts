/**
 * CRM Analytics Routes
 *
 * GET /crm/rfm  — RFM analysis: top 10 customers, frequency distribution, full RFM table
 */

import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, visibleBranchIds } from "../middlewares/permissions";
import { P } from "../lib/permissions";

const router: IRouter = Router();

const SEGMENT_CFG: Record<string, { label: string; color: string; tier: "VIP" | "Régulier" | "Dormant" | "Nouveau" }> = {
  vip:            { label: "VIP",              color: "#f59e0b", tier: "VIP" },
  tres_fideles:   { label: "Très fidèles",     color: "#10b981", tier: "VIP" },
  fideles:        { label: "Fidèles",          color: "#06b6d4", tier: "Régulier" },
  prometteurs:    { label: "Prometteurs",      color: "#6366f1", tier: "Régulier" },
  nouveaux:       { label: "Nouveaux",         color: "#8b5cf6", tier: "Nouveau" },
  fort_potentiel: { label: "Fort potentiel",   color: "#0ea5e9", tier: "Régulier" },
  a_reactiver:    { label: "À réactiver",      color: "#f97316", tier: "Dormant" },
  en_sommeil:     { label: "En sommeil",       color: "#94a3b8", tier: "Dormant" },
  perdus:         { label: "Perdus",           color: "#ef4444", tier: "Dormant" },
  occasionnels:   { label: "Occasionnels",     color: "#64748b", tier: "Régulier" },
  prix:           { label: "Sensibles prix",   color: "#ec4899", tier: "Régulier" },
  aucun_achat:    { label: "Aucun achat",      color: "#cbd5e1", tier: "Dormant" },
};

// Strict ISO-8601 date validator — rejects anything that could carry SQL payload
const ISO_DATE_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

function safeDate(raw: unknown, fallback: string): string {
  if (raw == null || raw === "") return fallback;
  const s = String(raw);
  if (!ISO_DATE_RE.test(s)) throw new Error(`Invalid date: "${s}". Expected YYYY-MM-DD.`);
  return s;
}

function safePositiveInt(raw: unknown): number {
  const n = parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid integer: "${raw}"`);
  return n;
}

/**
 * GET /crm/rfm
 * Returns:
 *   - top10BySpend       — top 10 customers ranked by net revenue
 *   - frequencyBuckets   — distribution of customers by purchase count
 *   - rfmTable           — full RFM table (up to 500 rows) with tier + segment classification
 *   - summary            — aggregate KPIs
 *
 * Query params:
 *   from      YYYY-MM-DD (required, falls back to 2023-01-01)
 *   to        YYYY-MM-DD (optional)
 *   branchId  positive integer (optional, further restricts branch scope)
 */
router.get("/rfm", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const scope = visibleBranchIds(req.user!);

  // ── Validate & sanitize user-supplied params ──────────────────────────────
  let from: string;
  let to: string | null = null;
  let branchId: number | null = null;

  try {
    from = safeDate(req.query.from, "2023-01-01");
    if (req.query.to != null && req.query.to !== "") {
      to = safeDate(req.query.to, "");
    }
    if (req.query.branchId != null && req.query.branchId !== "") {
      branchId = safePositiveInt(req.query.branchId);
    }
  } catch (err: any) {
    res.status(400).json({ error: err.message ?? "Invalid parameters" });
    return;
  }

  // ── Permission-based branch scope (derived from auth, never from user input) ─
  if (scope !== null && scope.length === 0) {
    res.json({ top10BySpend: [], frequencyBuckets: [], rfmTable: [], summary: { totalCustomers: 0, totalRevenue: 0, avgBasket: 0, avgFrequency: 0, tierCounts: { VIP: 0, Régulier: 0, Dormant: 0, Nouveau: 0 } } });
    return;
  }

  // Safe numeric list — scope is server-side auth data, not user input
  const scopeIds = scope !== null ? scope.map(Number).filter(Number.isFinite) : null;

  // Branch filter for sales
  const salesBranchFilter = buildBranchFilter("s.branch_id", scopeIds, branchId);
  // Branch filter for returns (mirrors sales scope exactly)
  const returnsBranchFilter = buildBranchFilter("sr.branch_id", scopeIds, branchId);

  // Date literals are safe: both passed through ISO_DATE_RE validator above
  const salesDateFilter = `s.created_at >= '${from}'::timestamptz`
    + (to ? ` AND s.created_at <= '${to}'::timestamptz + INTERVAL '1 day - 1 second'` : "");

  const returnsDateFilter = `sr.created_at >= '${from}'::timestamptz`
    + (to ? ` AND sr.created_at <= '${to}'::timestamptz + INTERVAL '1 day - 1 second'` : "");

  // ── Main RFM CTE query ────────────────────────────────────────────────────
  const rfmSql = `
    WITH rfm_base AS (
      SELECT
        s.customer_id,
        COUNT(*)::int                                               AS frequency,
        COALESCE(SUM(s.total::numeric), 0)                         AS gross_monetary,
        MAX(s.created_at)                                          AS last_purchase_date,
        MIN(s.created_at)                                          AS first_purchase_date,
        EXTRACT(DAY FROM NOW() - MAX(s.created_at))::int           AS recency_days
      FROM sales s
      WHERE s.type = 'sale'
        AND s.status = 'confirmed'
        AND s.customer_id IS NOT NULL
        AND (${salesBranchFilter})
        AND (${salesDateFilter})
      GROUP BY s.customer_id
    ),
    returns_agg AS (
      /* Scoped to the same branch + date window as rfm_base for net monetary accuracy */
      SELECT
        sr.customer_id,
        COALESCE(SUM(sr.refunded_amount::numeric + sr.credit_amount::numeric), 0) AS total_returned
      FROM sales_returns sr
      WHERE sr.status IN ('confirmed', 'refunded')
        AND sr.customer_id IS NOT NULL
        AND (${returnsBranchFilter})
        AND (${returnsDateFilter})
      GROUP BY sr.customer_id
    ),
    rfm_net AS (
      SELECT
        rb.*,
        rb.gross_monetary - COALESCE(ra.total_returned, 0) AS net_monetary
      FROM rfm_base rb
      LEFT JOIN returns_agg ra ON ra.customer_id = rb.customer_id
    ),
    rfm_scored AS (
      SELECT
        rn.*,
        (6 - NTILE(5) OVER (ORDER BY recency_days ASC))::int AS r_score,
        NTILE(5) OVER (ORDER BY frequency DESC)::int          AS f_score,
        NTILE(5) OVER (ORDER BY net_monetary DESC)::int       AS m_score
      FROM rfm_net rn
    ),
    rfm_segmented AS (
      SELECT
        rs.*,
        (rs.r_score + rs.f_score + rs.m_score)::int AS total_score,
        CASE
          WHEN rs.r_score >= 4 AND rs.f_score >= 4 AND rs.m_score >= 4 THEN 'vip'
          WHEN rs.f_score >= 4 AND rs.m_score >= 3                      THEN 'tres_fideles'
          WHEN rs.r_score >= 3 AND rs.f_score >= 3 AND rs.m_score >= 3  THEN 'fideles'
          WHEN rs.r_score >= 4 AND rs.f_score >= 2 AND rs.m_score >= 2  THEN 'prometteurs'
          WHEN rs.r_score >= 4 AND rs.f_score <= 1                      THEN 'nouveaux'
          WHEN rs.m_score >= 4 AND rs.f_score <= 2                      THEN 'fort_potentiel'
          WHEN rs.r_score <= 2 AND rs.f_score >= 3                      THEN 'a_reactiver'
          WHEN rs.r_score <= 2 AND rs.f_score <= 2
               AND (rs.r_score + rs.f_score + rs.m_score) >= 4          THEN 'en_sommeil'
          WHEN rs.r_score = 1                                            THEN 'perdus'
          WHEN rs.f_score >= 3 AND rs.m_score <= 2                      THEN 'prix'
          ELSE 'occasionnels'
        END AS seg
      FROM rfm_scored rs
    )
    SELECT
      seg.*,
      c.display_name,
      c.phone
    FROM rfm_segmented seg
    JOIN contacts c ON c.id = seg.customer_id
    WHERE c.type = 'customer'
    ORDER BY net_monetary DESC
  `;

  const raw = await db.execute(sql.raw(rfmSql)) as any;
  const rows: any[] = Array.isArray(raw) ? raw : (raw.rows ?? []);

  // ── Top 10 by spending ─────────────────────────────────────────────────────
  const top10BySpend = rows.slice(0, 10).map((r, idx) => ({
    rank:         idx + 1,
    customerId:   r.customer_id,
    displayName:  r.display_name,
    phone:        r.phone ?? null,
    netRevenue:   parseFloat(r.net_monetary ?? 0),
    frequency:    parseInt(r.frequency, 10),
    avgBasket:    parseInt(r.frequency, 10) > 0
                    ? parseFloat(r.gross_monetary ?? 0) / parseInt(r.frequency, 10)
                    : 0,
    segment:      r.seg,
    segmentLabel: SEGMENT_CFG[r.seg]?.label ?? r.seg,
    segmentColor: SEGMENT_CFG[r.seg]?.color ?? "#94a3b8",
    tier:         SEGMENT_CFG[r.seg]?.tier ?? "Régulier",
    recencyDays:  parseInt(r.recency_days ?? 0, 10),
    rScore:       parseInt(r.r_score ?? 0, 10),
    fScore:       parseInt(r.f_score ?? 0, 10),
    mScore:       parseInt(r.m_score ?? 0, 10),
    totalScore:   parseInt(r.total_score ?? 0, 10),
    lastPurchaseDate: r.last_purchase_date ?? null,
  }));

  // ── Frequency distribution buckets ────────────────────────────────────────
  const buckets: Record<string, number> = {
    "1 achat": 0, "2 achats": 0, "3–5": 0, "6–10": 0, "11–20": 0, "21+": 0,
  };
  for (const r of rows) {
    const f = parseInt(r.frequency, 10);
    if (f === 1)       buckets["1 achat"]++;
    else if (f === 2)  buckets["2 achats"]++;
    else if (f <= 5)   buckets["3–5"]++;
    else if (f <= 10)  buckets["6–10"]++;
    else if (f <= 20)  buckets["11–20"]++;
    else               buckets["21+"]++;
  }
  const frequencyBuckets = Object.entries(buckets).map(([label, count]) => ({ label, count }));

  // ── Full RFM table (capped to 500 rows for display; aggregates above use all rows) ──
  const rfmTable = rows.slice(0, 500).map(r => ({
    customerId:   r.customer_id,
    displayName:  r.display_name,
    phone:        r.phone ?? null,
    netRevenue:   parseFloat(r.net_monetary ?? 0),
    frequency:    parseInt(r.frequency, 10),
    avgBasket:    parseInt(r.frequency, 10) > 0
                    ? parseFloat(r.gross_monetary ?? 0) / parseInt(r.frequency, 10)
                    : 0,
    recencyDays:  parseInt(r.recency_days ?? 0, 10),
    rScore:       parseInt(r.r_score ?? 0, 10),
    fScore:       parseInt(r.f_score ?? 0, 10),
    mScore:       parseInt(r.m_score ?? 0, 10),
    totalScore:   parseInt(r.total_score ?? 0, 10),
    segment:      r.seg,
    segmentLabel: SEGMENT_CFG[r.seg]?.label ?? r.seg,
    segmentColor: SEGMENT_CFG[r.seg]?.color ?? "#94a3b8",
    tier:         SEGMENT_CFG[r.seg]?.tier ?? "Régulier",
    lastPurchaseDate: r.last_purchase_date ?? null,
  }));

  // ── Summary KPIs ───────────────────────────────────────────────────────────
  const totalRevenue = rows.reduce((a, r) => a + parseFloat(r.net_monetary ?? 0), 0);
  const tierCounts: Record<string, number> = { VIP: 0, Régulier: 0, Dormant: 0, Nouveau: 0 };
  for (const r of rows) {
    const tier = SEGMENT_CFG[r.seg]?.tier ?? "Régulier";
    tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
  }

  res.json({
    top10BySpend,
    frequencyBuckets,
    rfmTable,
    summary: {
      totalCustomers: rows.length,
      totalRevenue,
      avgBasket: rows.length > 0
        ? rows.reduce((a, r) => a + parseFloat(r.gross_monetary ?? 0) / Math.max(parseInt(r.frequency, 10), 1), 0) / rows.length
        : 0,
      avgFrequency: rows.length > 0
        ? rows.reduce((a, r) => a + parseInt(r.frequency, 10), 0) / rows.length
        : 0,
      tierCounts,
    },
  });
});

// ── Helper: build a safe branch IN(...) filter ─────────────────────────────
// scopeIds: server-provided list from auth (never user input)
// extraId:  optional additional filter, validated as a positive integer above
function buildBranchFilter(col: string, scopeIds: number[] | null, extraId: number | null): string {
  const parts: string[] = [];
  if (scopeIds !== null) {
    parts.push(`${col} IN (${scopeIds.join(",")})`);
  }
  if (extraId !== null) {
    parts.push(`${col} = ${extraId}`);
  }
  return parts.length > 0 ? parts.join(" AND ") : "TRUE";
}

export default router;
