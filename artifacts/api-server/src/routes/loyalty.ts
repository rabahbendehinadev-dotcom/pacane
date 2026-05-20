/**
 * Customer Loyalty & RFM Segmentation API
 *
 * GET  /loyalty/overview          — Summary KPIs + segment distribution
 * GET  /loyalty/segments          — Full customer table with RFM scores
 * GET  /loyalty/opportunities     — Actionable business intelligence
 * GET  /loyalty/dormant           — Dormant/at-risk customers
 * GET  /loyalty/rankings          — Top customers by dimension
 * GET  /loyalty/customer/:id      — Individual customer profile
 * POST /loyalty/recompute         — Persist RFM snapshots to DB
 * GET  /export/loyalty-customers  — CSV export
 */

import { Router, type IRouter } from "express";
import { and, eq, desc, inArray, sql, gte, lte, isNull, not, isNotNull } from "drizzle-orm";
import {
  db,
  salesTable, saleItemsTable,
  salesReturnsTable,
  contactsTable,
  branchesTable,
  categoriesTable, productsTable,
  customerWalletMovementsTable,
  customerRfmSnapshotsTable,
  customerLoyaltyNotesTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, visibleBranchIds } from "../middlewares/permissions";
import { P } from "../lib/permissions";

const router: IRouter = Router();

// ─── Segment config ───────────────────────────────────────────────────────────

const SEGMENT_CFG: Record<string, {
  label: string; color: string; icon: string; description: string; recommendation: string;
}> = {
  vip:            { label: "VIP",              color: "#f59e0b", icon: "crown",       description: "Clients exceptionnels — achat récent, fréquent et à haute valeur",       recommendation: "Offrir des avantages exclusifs, accès prioritaire et service VIP personnalisé" },
  tres_fideles:   { label: "Très fidèles",     color: "#10b981", icon: "star",        description: "Clients très réguliers avec un panier élevé",                           recommendation: "Programme de fidélité premium, invitation aux nouveautés, réductions personnalisées" },
  fideles:        { label: "Fidèles",          color: "#06b6d4", icon: "heart",       description: "Clients réguliers avec bon panier",                                     recommendation: "Entretenir la relation, proposer montée en gamme et fidélisation continue" },
  prometteurs:    { label: "Prometteurs",      color: "#6366f1", icon: "trending-up", description: "Clients récents avec une bonne dynamique d'achat",                      recommendation: "Accélérer l'engagement avec offres de bienvenue et parcours de fidélisation" },
  nouveaux:       { label: "Nouveaux clients", color: "#8b5cf6", icon: "user-plus",   description: "Clients ayant effectué leur premier achat récemment",                   recommendation: "Parcours d'onboarding, offre de retour, présentation gamme complète" },
  fort_potentiel: { label: "À fort potentiel", color: "#0ea5e9", icon: "zap",         description: "Clients à panier élevé mais peu fréquents — à développer",             recommendation: "Relance ciblée, proposer abonnement ou programme de volume pour augmenter la fréquence" },
  a_reactiver:    { label: "À réactiver",      color: "#f97316", icon: "refresh-cw",  description: "Anciens bons clients dont la fréquence ou récence a chuté",            recommendation: "Offre de réactivation personnalisée, rappel des produits favoris, réduction temporaire" },
  en_sommeil:     { label: "En sommeil",       color: "#94a3b8", icon: "moon",        description: "Clients inactifs depuis un moment mais avec historique existant",      recommendation: "Campagne win-back avec offre irrésistible, enquête satisfaction" },
  perdus:         { label: "Perdus",           color: "#ef4444", icon: "x-circle",    description: "Clients inactifs depuis très longtemps ou score très bas",             recommendation: "Tentative de reconquête finale, ou archiver si sans réponse" },
  occasionnels:   { label: "Occasionnels",     color: "#64748b", icon: "calendar",    description: "Achètent rarement, faible panier",                                     recommendation: "Stimuler avec offres saisonnières et événements boutique" },
  prix:           { label: "Sensibles au prix",color: "#ec4899", icon: "tag",         description: "Achètent souvent mais petit panier — sensibles aux promotions",        recommendation: "Programme de fidélité basé sur les points, promotions ciblées, bundle deals" },
  aucun_achat:    { label: "Aucun achat",      color: "#cbd5e1", icon: "user-x",      description: "Clients enregistrés sans aucun achat confirmé",                        recommendation: "Premier contact / réactivation initiale avec offre découverte" },
};

// ─── RFM SQL Engine ──────────────────────────────────────────────────────────

function buildRfmQuery(opts: {
  scope: number[] | null;
  from?: string;
  to?: string;
  branchId?: number;
  segment?: string;
  includeAnonymous?: boolean;
  limit?: number;
  search?: string;
}) {
  const { scope, from, to, branchId, segment, includeAnonymous = false, limit = 200, search } = opts;

  let branchFilter = "TRUE";
  if (scope !== null) {
    if (scope.length === 0) branchFilter = "FALSE";
    else branchFilter = `s.branch_id IN (${scope.join(",")})`;
  }
  if (branchId) branchFilter += ` AND s.branch_id = ${branchId}`;

  const dateFilter = [
    from ? `s.created_at >= '${from}'::timestamptz` : "",
    to   ? `s.created_at <= '${to}'::timestamptz + INTERVAL '1 day - 1 second'` : "",
  ].filter(Boolean).join(" AND ") || "TRUE";

  const segmentFilter = segment && segment !== "all" ? `AND seg = '${segment.replace(/'/g, "''")}'` : "";
  const searchFilter = search ? `AND LOWER(c.display_name) LIKE '%${search.toLowerCase().replace(/'/g, "''")}%'` : "";

  return `
    WITH rfm_base AS (
      SELECT
        s.customer_id,
        COUNT(*)::int                                        AS frequency,
        COALESCE(SUM(s.total::numeric), 0)                  AS gross_monetary,
        COALESCE(SUM(s.paid::numeric + s.credit_applied::numeric), 0) AS collected,
        MAX(s.created_at)                                   AS last_purchase_date,
        MIN(s.created_at)                                   AS first_purchase_date,
        EXTRACT(DAY FROM NOW() - MAX(s.created_at))::int    AS recency_days,
        MAX(s.branch_id)                                    AS main_branch_id,
        COUNT(DISTINCT s.branch_id)::int                    AS branch_count
      FROM sales s
      WHERE s.type = 'sale'
        AND s.status = 'confirmed'
        AND s.customer_id IS NOT NULL
        AND (${branchFilter})
        AND (${dateFilter})
      GROUP BY s.customer_id
    ),
    returns_agg AS (
      SELECT
        sr.customer_id,
        COALESCE(SUM(sr.refunded_amount::numeric + sr.credit_amount::numeric), 0) AS total_returned
      FROM sales_returns sr
      WHERE sr.status IN ('confirmed', 'refunded')
        AND sr.customer_id IS NOT NULL
      GROUP BY sr.customer_id
    ),
    wallet_agg AS (
      SELECT
        cwm.customer_id,
        COALESCE(SUM(CASE WHEN cwm.type = 'credit' THEN cwm.amount::numeric ELSE 0 END), 0) AS wallet_credits,
        COALESCE(SUM(CASE WHEN cwm.type = 'debit'  THEN cwm.amount::numeric ELSE 0 END), 0) AS wallet_used
      FROM customer_wallet_movements cwm
      GROUP BY cwm.customer_id
    ),
    rfm_net AS (
      SELECT
        rb.*,
        COALESCE(ra.total_returned, 0)                       AS total_returned,
        rb.gross_monetary - COALESCE(ra.total_returned, 0)  AS net_monetary,
        COALESCE(wa.wallet_credits, 0)                       AS wallet_credits,
        COALESCE(wa.wallet_used, 0)                          AS wallet_used,
        wa.wallet_credits - COALESCE(wa.wallet_used, 0)      AS wallet_balance
      FROM rfm_base rb
      LEFT JOIN returns_agg ra ON ra.customer_id = rb.customer_id
      LEFT JOIN wallet_agg  wa ON wa.customer_id = rb.customer_id
    ),
    rfm_scored AS (
      SELECT
        rn.*,
        (6 - NTILE(5) OVER (ORDER BY recency_days ASC))::int  AS r_score,
        NTILE(5) OVER (ORDER BY frequency DESC)::int           AS f_score,
        NTILE(5) OVER (ORDER BY net_monetary DESC)::int        AS m_score
      FROM rfm_net rn
    ),
    rfm_segmented AS (
      SELECT
        rs.*,
        (rs.r_score + rs.f_score + rs.m_score)::int           AS total_score,
        CASE
          WHEN rs.r_score >= 4 AND rs.f_score >= 4 AND rs.m_score >= 4 THEN 'vip'
          WHEN rs.f_score >= 4 AND rs.m_score >= 3 THEN 'tres_fideles'
          WHEN rs.r_score >= 3 AND rs.f_score >= 3 AND rs.m_score >= 3 THEN 'fideles'
          WHEN rs.r_score >= 4 AND rs.f_score >= 2 AND rs.m_score >= 2 THEN 'prometteurs'
          WHEN rs.r_score >= 4 AND rs.f_score <= 1 THEN 'nouveaux'
          WHEN rs.m_score >= 4 AND rs.f_score <= 2 THEN 'fort_potentiel'
          WHEN rs.r_score <= 2 AND rs.f_score >= 3 THEN 'a_reactiver'
          WHEN rs.r_score <= 2 AND rs.f_score <= 2 AND (rs.r_score + rs.f_score + rs.m_score) >= 4 THEN 'en_sommeil'
          WHEN rs.r_score = 1 THEN 'perdus'
          WHEN rs.f_score >= 3 AND rs.m_score <= 2 THEN 'prix'
          ELSE 'occasionnels'
        END                                                    AS seg
      FROM rfm_scored rs
    )
    SELECT
      seg.*,
      c.display_name,
      c.phone,
      c.email,
      c.city,
      c.credit_limit,
      c.status AS customer_status,
      c.created_at AS customer_since,
      b.name AS main_branch_name
    FROM rfm_segmented seg
    JOIN contacts c ON c.id = seg.customer_id
    LEFT JOIN branches b ON b.id = seg.main_branch_id
    WHERE c.type = 'customer'
    ${segmentFilter}
    ${searchFilter}
    ORDER BY net_monetary DESC
    LIMIT ${limit}
  `;
}

// ─── Overview ─────────────────────────────────────────────────────────────────
router.get("/overview", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const scope = visibleBranchIds(req.user!);
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const branchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : undefined;

  const rfmQuery = buildRfmQuery({ scope, from, to, branchId, limit: 500 });
  const rfmResult = await db.execute(sql.raw(rfmQuery)) as any;
  const rows: any[] = Array.isArray(rfmResult) ? rfmResult : rfmResult.rows ?? [];

  // Customers with NO purchases
  let noScopeFilter = "c.type = 'customer'";
  if (scope !== null && scope.length > 0) noScopeFilter += ` AND EXISTS (SELECT 1 FROM sales s WHERE s.customer_id = c.id AND s.branch_id IN (${scope.join(",")}))`;

  const allCustomersResult = await db.execute(
    sql.raw(`SELECT id, display_name, created_at FROM contacts c WHERE c.type = 'customer' ORDER BY id`)
  ) as any;
  const allCustomers: any[] = Array.isArray(allCustomersResult) ? allCustomersResult : allCustomersResult.rows ?? [];

  const activeIds = new Set(rows.map(r => r.customer_id));
  const noActivityCustomers = allCustomers.filter(c => !activeIds.has(c.id));

  // Segment distribution
  const segmentCounts: Record<string, number> = { aucun_achat: noActivityCustomers.length };
  for (const r of rows) segmentCounts[r.seg] = (segmentCounts[r.seg] ?? 0) + 1;

  // KPIs
  const totalRevenue = rows.reduce((a, r) => a + parseFloat(r.net_monetary ?? 0), 0);
  const avgBasket = rows.length > 0 ? rows.reduce((a, r) => a + (parseFloat(r.gross_monetary ?? 0) / parseInt(r.frequency, 10)), 0) / rows.length : 0;
  const avgFrequency = rows.length > 0 ? rows.reduce((a, r) => a + parseInt(r.frequency, 10), 0) / rows.length : 0;

  // New customers (first purchase in period)
  const newCustomers = from ? rows.filter(r => {
    const fp = new Date(r.first_purchase_date);
    const f = new Date(from);
    return fp >= f;
  }) : [];

  // Returning
  const returning = rows.filter(r => parseInt(r.frequency, 10) > 1);
  const dormant = rows.filter(r => r.seg === "en_sommeil" || r.seg === "a_reactiver");
  const lost = rows.filter(r => r.seg === "perdus");

  // Top segments
  const segmentList = Object.entries(segmentCounts)
    .map(([key, count]) => ({
      key,
      label: SEGMENT_CFG[key]?.label ?? key,
      color: SEGMENT_CFG[key]?.color ?? "#94a3b8",
      count,
      pct: Math.round((count / (rows.length + noActivityCustomers.length)) * 100),
    }))
    .sort((a, b) => b.count - a.count);

  // Trend: new customers per day (last 30 days)
  const today = new Date();
  const t30from = new Date(today); t30from.setDate(today.getDate() - 29);
  const trendQuery = `
    SELECT DATE(MIN(s.created_at))::text as date, s.customer_id
    FROM sales s
    WHERE s.type='sale' AND s.status='confirmed' AND s.customer_id IS NOT NULL
      AND s.created_at >= '${t30from.toISOString()}'
    GROUP BY s.customer_id
  `;
  const trendResult = await db.execute(sql.raw(trendQuery)) as any;
  const trendRows: any[] = Array.isArray(trendResult) ? trendResult : trendResult.rows ?? [];
  const newByDay: Record<string, number> = {};
  for (const tr of trendRows) newByDay[tr.date] = (newByDay[tr.date] ?? 0) + 1;

  res.json({
    totalCustomers: allCustomers.length,
    activeCustomers: rows.length,
    noActivityCustomers: noActivityCustomers.length,
    newCustomers: newCustomers.length,
    returningCustomers: returning.length,
    dormantCustomers: dormant.length,
    lostCustomers: lost.length,
    totalNetRevenue: totalRevenue,
    avgBasket,
    avgFrequency: parseFloat(avgFrequency.toFixed(1)),
    segmentDistribution: segmentList,
    topOpportunities: [
      rows.filter(r => r.seg === "fort_potentiel").length > 0 ? `${rows.filter(r => r.seg === "fort_potentiel").length} client(s) à fort potentiel sous-exploité` : null,
      rows.filter(r => r.seg === "a_reactiver").length > 0 ? `${rows.filter(r => r.seg === "a_reactiver").length} client(s) à réactiver en urgence` : null,
      noActivityCustomers.length > 0 ? `${noActivityCustomers.length} client(s) enregistrés sans aucun achat` : null,
    ].filter(Boolean),
    newCustomerTrend: Object.entries(newByDay).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
  });
});

// ─── Segments (full customer table) ──────────────────────────────────────────
router.get("/segments", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const scope = visibleBranchIds(req.user!);
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const branchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : undefined;
  const segment = req.query.segment as string | undefined;
  const search = req.query.search as string | undefined;
  const includeNoActivity = req.query.includeNoActivity === "true";

  const rfmQuery = buildRfmQuery({ scope, from, to, branchId, segment, search, limit: 500 });
  const result = await db.execute(sql.raw(rfmQuery)) as any;
  const rows: any[] = Array.isArray(result) ? result : result.rows ?? [];

  // Fetch no-activity customers if requested
  let noActivityRows: any[] = [];
  if (includeNoActivity && (!segment || segment === "all" || segment === "aucun_achat")) {
    const activeIds = rows.map(r => r.customer_id);
    const naResult = await db.execute(
      sql.raw(`SELECT id AS customer_id, display_name, phone, email, city, created_at AS customer_since, 'aucun_achat' AS seg, 0 AS frequency, 0 AS gross_monetary, 0 AS net_monetary, 0 AS r_score, 0 AS f_score, 0 AS m_score, 0 AS total_score, NULL AS last_purchase_date, NULL AS first_purchase_date, 0 AS recency_days, 0 AS wallet_balance FROM contacts WHERE type='customer'${activeIds.length > 0 ? ` AND id NOT IN (${activeIds.join(",")})` : ""} ${search ? `AND LOWER(display_name) LIKE '%${search.toLowerCase().replace(/'/g, "''")}%'` : ""}`)
    ) as any;
    noActivityRows = Array.isArray(naResult) ? naResult : naResult.rows ?? [];
  }

  const allRows = [...rows, ...noActivityRows];

  res.json(allRows.map(r => ({
    customerId: r.customer_id,
    displayName: r.display_name,
    phone: r.phone,
    email: r.email,
    city: r.city,
    segment: r.seg,
    segmentLabel: SEGMENT_CFG[r.seg]?.label ?? r.seg,
    segmentColor: SEGMENT_CFG[r.seg]?.color ?? "#94a3b8",
    segmentRecommendation: SEGMENT_CFG[r.seg]?.recommendation ?? "",
    rScore: parseInt(r.r_score ?? 0, 10),
    fScore: parseInt(r.f_score ?? 0, 10),
    mScore: parseInt(r.m_score ?? 0, 10),
    totalScore: parseInt(r.total_score ?? 0, 10),
    frequency: parseInt(r.frequency ?? 0, 10),
    grossRevenue: parseFloat(r.gross_monetary ?? 0),
    netRevenue: parseFloat(r.net_monetary ?? 0),
    totalReturned: parseFloat(r.total_returned ?? 0),
    avgBasket: parseInt(r.frequency ?? 0, 10) > 0 ? parseFloat(r.gross_monetary ?? 0) / parseInt(r.frequency, 10) : 0,
    lastPurchaseDate: r.last_purchase_date,
    firstPurchaseDate: r.first_purchase_date,
    recencyDays: parseInt(r.recency_days ?? 0, 10),
    mainBranch: r.main_branch_name ?? "—",
    branchCount: parseInt(r.branch_count ?? 1, 10),
    walletBalance: parseFloat(r.wallet_balance ?? 0),
    customerSince: r.customer_since,
    creditLimit: parseFloat(r.credit_limit ?? 0),
    customerStatus: r.customer_status,
  })));
});

// ─── Opportunities ────────────────────────────────────────────────────────────
router.get("/opportunities", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const scope = visibleBranchIds(req.user!);
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const branchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : undefined;

  const rfmQuery = buildRfmQuery({ scope, from, to, branchId, limit: 500 });
  const result = await db.execute(sql.raw(rfmQuery)) as any;
  const rows: any[] = Array.isArray(result) ? result : result.rows ?? [];

  const opportunities: any[] = [];

  // 1. Close to VIP (score 10-11)
  const nearVip = rows.filter(r => parseInt(r.total_score ?? 0) >= 10 && r.seg !== "vip");
  for (const c of nearVip.slice(0, 5)) {
    opportunities.push({
      type: "near_vip",
      priority: "high",
      customerId: c.customer_id,
      customerName: c.display_name,
      segment: c.seg,
      reason: `Score RFM ${c.total_score}/15 — à ${15 - parseInt(c.total_score)} points du statut VIP`,
      suggestedAction: "Proposer une offre premium ciblée pour franchir le seuil VIP",
      estimatedImpact: `+${Math.round(parseFloat(c.net_monetary) * 0.2).toLocaleString()} DA potentiel`,
      revenue: parseFloat(c.net_monetary ?? 0),
    });
  }

  // 2. High basket but low frequency (M>=4, F<=2)
  const highBasketLowFreq = rows.filter(r => parseInt(r.m_score ?? 0) >= 4 && parseInt(r.f_score ?? 0) <= 2 && r.seg !== "vip");
  for (const c of highBasketLowFreq.slice(0, 4)) {
    opportunities.push({
      type: "high_basket_low_freq",
      priority: "medium",
      customerId: c.customer_id,
      customerName: c.display_name,
      segment: c.seg,
      reason: `Panier élevé (${Math.round(parseFloat(c.gross_monetary) / Math.max(parseInt(c.frequency), 1)).toLocaleString()} DA moy.) mais seulement ${c.frequency} achat(s)`,
      suggestedAction: "Proposer abonnement ou offre de fidélité pour augmenter la fréquence",
      estimatedImpact: "Doublement de la fréquence = CA x2",
      revenue: parseFloat(c.net_monetary ?? 0),
    });
  }

  // 3. Wallet credit not reused (positive wallet balance, low recency)
  const walletUnused = rows.filter(r => parseFloat(r.wallet_balance ?? 0) > 0 && parseInt(r.recency_days ?? 0) > 15);
  for (const c of walletUnused.slice(0, 3)) {
    opportunities.push({
      type: "wallet_unused",
      priority: "medium",
      customerId: c.customer_id,
      customerName: c.display_name,
      segment: c.seg,
      reason: `${Math.round(parseFloat(c.wallet_balance)).toLocaleString()} DA de crédit disponible non utilisé`,
      suggestedAction: "Rappeler l'avoir disponible pour déclencher un nouvel achat",
      estimatedImpact: `Récupérer ${Math.round(parseFloat(c.wallet_balance)).toLocaleString()} DA de chiffre d'affaires latent`,
      revenue: parseFloat(c.net_monetary ?? 0),
    });
  }

  // 4. Strong customers with declining recency (good F+M but R<=2)
  const declining = rows.filter(r => parseInt(r.r_score ?? 0) <= 2 && parseInt(r.f_score ?? 0) >= 3 && parseInt(r.m_score ?? 0) >= 3);
  for (const c of declining.slice(0, 4)) {
    opportunities.push({
      type: "declining_recency",
      priority: "high",
      customerId: c.customer_id,
      customerName: c.display_name,
      segment: c.seg,
      reason: `Bon historique (${c.frequency} achats, ${Math.round(parseFloat(c.net_monetary)).toLocaleString()} DA) mais inactif depuis ${c.recency_days} jours`,
      suggestedAction: "Campagne de réactivation urgente avec offre personnalisée",
      estimatedImpact: "Risque de perte définitive si inaction > 30 jours",
      revenue: parseFloat(c.net_monetary ?? 0),
    });
  }

  // 5. One-time high spenders
  const oneTimeHighSpenders = rows.filter(r => parseInt(r.frequency, 10) === 1 && parseFloat(r.gross_monetary) > 50000);
  for (const c of oneTimeHighSpenders.slice(0, 3)) {
    opportunities.push({
      type: "one_time_big",
      priority: "medium",
      customerId: c.customer_id,
      customerName: c.display_name,
      segment: c.seg,
      reason: `Un seul achat de ${Math.round(parseFloat(c.gross_monetary)).toLocaleString()} DA — potentiel client régulier à forte valeur`,
      suggestedAction: "Invitation personnelle, offre de retour exclusive",
      estimatedImpact: "Conversion en client fidèle très haute valeur",
      revenue: parseFloat(c.net_monetary ?? 0),
    });
  }

  res.json(opportunities.sort((a, b) => b.revenue - a.revenue));
});

// ─── Dormant customers ────────────────────────────────────────────────────────
router.get("/dormant", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const scope = visibleBranchIds(req.user!);
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const branchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : undefined;
  const minDays = parseInt(req.query.minDays as string ?? "30", 10);

  const rfmQuery = buildRfmQuery({ scope, from, to, branchId, limit: 500 });
  const result = await db.execute(sql.raw(rfmQuery)) as any;
  const rows: any[] = Array.isArray(result) ? result : result.rows ?? [];

  // Get no-activity customers (truly dormant — registered but never bought)
  const activeIds = rows.map(r => r.customer_id);
  const naResult = await db.execute(
    sql.raw(`SELECT id, display_name, phone, created_at FROM contacts WHERE type='customer'${activeIds.length > 0 ? ` AND id NOT IN (${activeIds.join(",")})` : ""}`)
  ) as any;
  const noActivity: any[] = (Array.isArray(naResult) ? naResult : naResult.rows ?? []).map(c => ({
    customerId: c.id,
    displayName: c.display_name,
    phone: c.phone,
    segment: "aucun_achat",
    segmentLabel: "Aucun achat",
    segmentColor: "#cbd5e1",
    recencyDays: Math.floor((Date.now() - new Date(c.created_at).getTime()) / 86400000),
    lastPurchaseDate: null,
    frequency: 0,
    netRevenue: 0,
    avgBasket: 0,
    mainBranch: "—",
    reactivationPriority: "low" as const,
    suggestedOffer: "Invitation découverte — offre de premier achat",
  }));

  // Active but dormant/sleeping
  const dormant = rows
    .filter(r => parseInt(r.recency_days ?? 0, 10) >= minDays)
    .map(r => {
      const recency = parseInt(r.recency_days ?? 0, 10);
      const freq = parseInt(r.frequency, 10);
      const net = parseFloat(r.net_monetary ?? 0);
      let priority: "critical" | "high" | "medium" | "low";
      let suggestedOffer: string;
      if (net > 500000 && recency > 60) { priority = "critical"; suggestedOffer = "Contact téléphonique direct + remise exclusive 15%"; }
      else if (net > 100000 && recency > 45) { priority = "high"; suggestedOffer = "Email personnalisé + bon de réduction 10%"; }
      else if (freq >= 3 && recency > 30) { priority = "medium"; suggestedOffer = "SMS de rappel + invitation événement boutique"; }
      else { priority = "low"; suggestedOffer = "Newsletter standard avec offres saisonnières"; }
      return {
        customerId: r.customer_id,
        displayName: r.display_name,
        phone: r.phone,
        segment: r.seg,
        segmentLabel: SEGMENT_CFG[r.seg]?.label ?? r.seg,
        segmentColor: SEGMENT_CFG[r.seg]?.color ?? "#94a3b8",
        recencyDays: recency,
        lastPurchaseDate: r.last_purchase_date,
        frequency: freq,
        netRevenue: net,
        avgBasket: freq > 0 ? parseFloat(r.gross_monetary ?? 0) / freq : 0,
        mainBranch: r.main_branch_name ?? "—",
        walletBalance: parseFloat(r.wallet_balance ?? 0),
        reactivationPriority: priority,
        suggestedOffer,
      };
    })
    .sort((a, b) => b.netRevenue - a.netRevenue);

  res.json({
    dormant,
    noActivity,
    summary: {
      total: dormant.length + noActivity.length,
      critical: dormant.filter(d => d.reactivationPriority === "critical").length,
      high: dormant.filter(d => d.reactivationPriority === "high").length,
      medium: dormant.filter(d => d.reactivationPriority === "medium").length,
      totalLostRevenuePotential: dormant.reduce((a, d) => a + d.netRevenue, 0),
    },
  });
});

// ─── Rankings ─────────────────────────────────────────────────────────────────
router.get("/rankings", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const scope = visibleBranchIds(req.user!);
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const branchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : undefined;

  const rfmQuery = buildRfmQuery({ scope, from, to, branchId, limit: 500 });
  const result = await db.execute(sql.raw(rfmQuery)) as any;
  const rows: any[] = (Array.isArray(result) ? result : result.rows ?? []).map(r => ({
    customerId: r.customer_id,
    displayName: r.display_name,
    segment: r.seg,
    segmentLabel: SEGMENT_CFG[r.seg]?.label ?? r.seg,
    segmentColor: SEGMENT_CFG[r.seg]?.color ?? "#94a3b8",
    frequency: parseInt(r.frequency, 10),
    grossRevenue: parseFloat(r.gross_monetary ?? 0),
    netRevenue: parseFloat(r.net_monetary ?? 0),
    avgBasket: parseInt(r.frequency, 10) > 0 ? parseFloat(r.gross_monetary ?? 0) / parseInt(r.frequency, 10) : 0,
    rScore: parseInt(r.r_score ?? 0, 10),
    fScore: parseInt(r.f_score ?? 0, 10),
    mScore: parseInt(r.m_score ?? 0, 10),
    totalScore: parseInt(r.total_score ?? 0, 10),
    recencyDays: parseInt(r.recency_days ?? 0, 10),
    mainBranch: r.main_branch_name ?? "—",
    branchCount: parseInt(r.branch_count ?? 1, 10),
  }));

  res.json({
    byRevenue: [...rows].sort((a, b) => b.netRevenue - a.netRevenue).slice(0, 10),
    byFrequency: [...rows].sort((a, b) => b.frequency - a.frequency).slice(0, 10),
    byBasket: [...rows].sort((a, b) => b.avgBasket - a.avgBasket).slice(0, 10),
    byScore: [...rows].sort((a, b) => b.totalScore - a.totalScore).slice(0, 10),
    byLoyalty: [...rows].sort((a, b) => (b.fScore + b.mScore) - (a.fScore + a.mScore)).slice(0, 10),
  });
});

// ─── Individual customer profile ──────────────────────────────────────────────
router.get("/customer/:id", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const customerId = parseInt(req.params.id, 10);
  const scope = visibleBranchIds(req.user!);

  const rfmQuery = buildRfmQuery({ scope, limit: 500 });
  const result = await db.execute(sql.raw(rfmQuery)) as any;
  const allRows: any[] = Array.isArray(result) ? result : result.rows ?? [];
  const row = allRows.find(r => r.customer_id === customerId);

  // Recent sales for this customer
  const conds: any[] = [
    eq(salesTable.customerId, customerId),
    eq(salesTable.type, "sale"),
    eq(salesTable.status, "confirmed"),
  ];
  if (scope !== null && scope.length > 0) conds.push(inArray(salesTable.branchId, scope));

  const recentSales = await db.select({
    id: salesTable.id,
    reference: salesTable.reference,
    total: salesTable.total,
    paymentStatus: salesTable.paymentStatus,
    branchId: salesTable.branchId,
    branchName: branchesTable.name,
    createdAt: salesTable.createdAt,
  }).from(salesTable)
    .innerJoin(branchesTable, eq(salesTable.branchId, branchesTable.id))
    .where(and(...conds))
    .orderBy(desc(salesTable.createdAt))
    .limit(10);

  // Favorite product
  const favProduct = await db.execute(sql.raw(`
    SELECT p.name, SUM(si.quantity::numeric) as qty, SUM(si.total::numeric) as rev
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    JOIN products p ON p.id = si.product_id
    WHERE s.customer_id = ${customerId} AND s.type='sale' AND s.status='confirmed'
    GROUP BY p.name ORDER BY rev DESC LIMIT 1
  `)) as any;
  const favProductRows: any[] = Array.isArray(favProduct) ? favProduct : favProduct.rows ?? [];

  // Notes
  const notesResult = await db.execute(sql.raw(`
    SELECT n.id, n.note, n.created_at FROM customer_loyalty_notes n WHERE n.customer_id = ${customerId} ORDER BY n.created_at DESC LIMIT 5
  `)) as any;
  const notes: any[] = Array.isArray(notesResult) ? notesResult : notesResult.rows ?? [];

  if (!row) {
    // Customer exists but no purchases
    const [cust] = await db.select().from(contactsTable).where(eq(contactsTable.id, customerId));
    if (!cust) { res.status(404).json({ error: "Client introuvable" }); return; }
    res.json({
      customerId, displayName: cust.displayName, phone: cust.phone, email: cust.email,
      segment: "aucun_achat", segmentLabel: "Aucun achat", segmentColor: "#cbd5e1",
      recommendation: SEGMENT_CFG.aucun_achat.recommendation,
      rScore: 0, fScore: 0, mScore: 0, totalScore: 0,
      frequency: 0, grossRevenue: 0, netRevenue: 0, avgBasket: 0,
      recencyDays: null, lastPurchaseDate: null,
      mainBranch: "—", walletBalance: 0, creditLimit: parseFloat(cust.creditLimit ?? "0"),
      recentSales: [], favProduct: null, notes,
    });
    return;
  }

  res.json({
    customerId: row.customer_id,
    displayName: row.display_name,
    phone: row.phone,
    email: row.email,
    city: row.city,
    segment: row.seg,
    segmentLabel: SEGMENT_CFG[row.seg]?.label ?? row.seg,
    segmentColor: SEGMENT_CFG[row.seg]?.color ?? "#94a3b8",
    segmentDescription: SEGMENT_CFG[row.seg]?.description ?? "",
    recommendation: SEGMENT_CFG[row.seg]?.recommendation ?? "",
    rScore: parseInt(row.r_score ?? 0, 10),
    fScore: parseInt(row.f_score ?? 0, 10),
    mScore: parseInt(row.m_score ?? 0, 10),
    totalScore: parseInt(row.total_score ?? 0, 10),
    frequency: parseInt(row.frequency, 10),
    grossRevenue: parseFloat(row.gross_monetary ?? 0),
    netRevenue: parseFloat(row.net_monetary ?? 0),
    totalReturned: parseFloat(row.total_returned ?? 0),
    avgBasket: parseInt(row.frequency, 10) > 0 ? parseFloat(row.gross_monetary ?? 0) / parseInt(row.frequency, 10) : 0,
    recencyDays: parseInt(row.recency_days ?? 0, 10),
    lastPurchaseDate: row.last_purchase_date,
    firstPurchaseDate: row.first_purchase_date,
    mainBranch: row.main_branch_name ?? "—",
    branchCount: parseInt(row.branch_count ?? 1, 10),
    walletBalance: parseFloat(row.wallet_balance ?? 0),
    walletCredits: parseFloat(row.wallet_credits ?? 0),
    walletUsed: parseFloat(row.wallet_used ?? 0),
    creditLimit: parseFloat(row.credit_limit ?? 0),
    customerSince: row.customer_since,
    recentSales: recentSales.map(s => ({ ...s, total: parseFloat(s.total) })),
    favProduct: favProductRows[0] ? { name: favProductRows[0].name, qty: parseFloat(favProductRows[0].qty), revenue: parseFloat(favProductRows[0].rev) } : null,
    notes,
  });
});

// ─── Recompute (persist snapshots) ───────────────────────────────────────────
router.post("/recompute", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const scope = visibleBranchIds(req.user!);
  const period = (req.body?.period as string) ?? "365d";

  let from: string;
  const now = new Date();
  switch (period) {
    case "30d":  from = new Date(now.setDate(now.getDate() - 30)).toISOString(); break;
    case "90d":  from = new Date(now.setDate(now.getDate() - 90)).toISOString(); break;
    case "180d": from = new Date(now.setDate(now.getDate() - 180)).toISOString(); break;
    default:     from = new Date(now.setFullYear(now.getFullYear() - 1)).toISOString();
  }

  const rfmQuery = buildRfmQuery({ scope, from, limit: 1000 });
  const result = await db.execute(sql.raw(rfmQuery)) as any;
  const rows: any[] = Array.isArray(result) ? result : result.rows ?? [];

  // Upsert snapshots
  for (const r of rows) {
    await db.execute(sql.raw(`
      INSERT INTO customer_rfm_snapshots (customer_id, branch_scope, period, recency_days, frequency, monetary, recency_score, frequency_score, monetary_score, total_score, segment, last_purchase_date, computed_at)
      VALUES (${r.customer_id}, '${scope === null ? "global" : scope.join(",")}', '${period}', ${r.recency_days}, ${r.frequency}, ${r.net_monetary}, ${r.r_score}, ${r.f_score}, ${r.m_score}, ${r.total_score}, '${r.seg}', ${r.last_purchase_date ? `'${r.last_purchase_date}'` : "NULL"}, NOW())
      ON CONFLICT DO NOTHING
    `));
  }

  res.json({ recomputed: rows.length, period });
});

// ─── CSV Export ───────────────────────────────────────────────────────────────
router.get("/export/loyalty-customers", requireAuth, requirePermission(P.reports.view), async (req, res): Promise<void> => {
  const scope = visibleBranchIds(req.user!);
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const branchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : undefined;
  const segment = req.query.segment as string | undefined;

  const rfmQuery = buildRfmQuery({ scope, from, to, branchId, segment, limit: 2000 });
  const result = await db.execute(sql.raw(rfmQuery)) as any;
  const rows: any[] = Array.isArray(result) ? result : result.rows ?? [];

  const header = "Nom,Téléphone,Segment,Score R,Score F,Score M,Score Total,Dernier achat,Jours inactif,Nb achats,CA net,Panier moyen,Agence principale";
  const csvRows = rows.map(r => {
    const freq = parseInt(r.frequency, 10);
    const basket = freq > 0 ? Math.round(parseFloat(r.gross_monetary ?? 0) / freq) : 0;
    return [
      r.display_name, r.phone ?? "", SEGMENT_CFG[r.seg]?.label ?? r.seg,
      r.r_score, r.f_score, r.m_score, r.total_score,
      r.last_purchase_date ? new Date(r.last_purchase_date).toLocaleDateString("fr-DZ") : "—",
      r.recency_days ?? 0, freq,
      Math.round(parseFloat(r.net_monetary ?? 0)), basket,
      r.main_branch_name ?? "—",
    ].map(v => `"${v}"`).join(",");
  });

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="loyalty_clients.csv"`);
  res.send("\uFEFF" + [header, ...csvRows].join("\n"));
});

export default router;
