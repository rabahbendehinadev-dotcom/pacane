import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch, useGetBranches } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
} from "recharts";
import {
  Layers, TrendingUp, TrendingDown, ShoppingBag, ShoppingCart,
  Wallet, RotateCcw, Building2, AlertTriangle, AlertCircle,
  CheckCircle2, Package, ArrowLeftRight, Factory,
  CreditCard, Banknote, Users, ZapOff, Clock,
  Info, ChevronRight, FlaskConical,
} from "lucide-react";
import { format, subDays, startOfMonth, startOfYear } from "date-fns";
import { fr } from "date-fns/locale";
import { useAuth } from "@/lib/auth";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDA(n: number) {
  return new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(n) + " DA";
}
function fmtDA2(n: number) {
  return new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(n) + " DA";
}
function fmtDate(d: string) {
  try { return format(new Date(d), "dd/MM", { locale: fr }); } catch { return d; }
}

const DATE_PRESETS = [
  { label: "Auj.", from: () => format(new Date(), "yyyy-MM-dd"),        to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "7j",   from: () => format(subDays(new Date(), 6), "yyyy-MM-dd"),  to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "30j",  from: () => format(subDays(new Date(), 29), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "Mois", from: () => format(startOfMonth(new Date()), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "Année",from: () => format(startOfYear(new Date()), "yyyy-MM-dd"),  to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "Tout", from: () => "2023-01-01", to: () => format(new Date(), "yyyy-MM-dd") },
];

const SEVERITY_CFG = {
  critical: { label: "Critique",    cls: "bg-red-100 text-red-700 border-red-200",   dot: "bg-red-500" },
  warning:  { label: "Attention",   cls: "bg-amber-100 text-amber-700 border-amber-200", dot: "bg-amber-500" },
  info:     { label: "Information", cls: "bg-blue-100 text-blue-700 border-blue-200",  dot: "bg-blue-500" },
};
const ALERT_TYPE_CFG: Record<string, { icon: React.FC<{ className?: string }>; color: string }> = {
  stock_low:             { icon: Package,       color: "text-amber-600" },
  receivable_overdue:    { icon: CreditCard,    color: "text-red-600" },
  credit_limit_exceeded: { icon: AlertCircle,   color: "text-orange-600" },
  return_pending:        { icon: RotateCcw,     color: "text-slate-600" },
  refund_pending:        { icon: Banknote,      color: "text-violet-600" },
  production_blocked:    { icon: ZapOff,        color: "text-rose-600" },
};

// ─── Mini stat block ──────────────────────────────────────────────────────────
function Stat({ label, value, sub, color = "green", trend, loading }: {
  label: string; value: string; sub?: string;
  color?: "green" | "red" | "amber" | "blue" | "violet" | "slate" | "indigo" | "emerald";
  trend?: "up" | "down" | "neutral"; loading?: boolean;
}) {
  const valColors: Record<string, string> = {
    green: "text-green-700", red: "text-red-700", amber: "text-amber-700",
    blue: "text-blue-700", violet: "text-violet-700", slate: "text-slate-700",
    indigo: "text-indigo-700", emerald: "text-emerald-700",
  };
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
      {loading ? <div className="h-5 w-24 bg-muted animate-pulse rounded" /> : (
        <div className="flex items-baseline gap-1.5">
          <p className={`text-base font-bold ${valColors[color]}`}>{value}</p>
          {trend === "up"   && <TrendingUp   className="h-3 w-3 text-green-600" />}
          {trend === "down" && <TrendingDown className="h-3 w-3 text-red-600" />}
        </div>
      )}
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────
function SectionTitle({ icon: Icon, title, color = "text-slate-600", badge }: {
  icon: React.FC<{ className?: string }>; title: string; color?: string; badge?: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className={`h-4 w-4 ${color}`} />
      <h2 className="text-sm font-bold text-foreground">{title}</h2>
      {badge && <Badge variant="outline" className="text-[10px] h-4 px-1.5">{badge}</Badge>}
    </div>
  );
}

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background border border-border rounded-lg shadow-lg p-3 text-xs space-y-1">
      <p className="font-semibold text-muted-foreground">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex justify-between gap-4">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="font-bold">{fmtDA(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ExecutiveDashboard() {
  const { user } = useAuth();

  const [from, setFrom] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [branchId, setBranchId] = useState("all");
  const [activePreset, setActivePreset] = useState(3); // "Mois"

  const { data: branches } = useGetBranches();
  const showBranchFilter = user?.adminAccess || (user?.branchIds && user.branchIds.length > 1);

  const qs = useMemo(() => {
    const p: Record<string, string> = {};
    if (from) p.from = from;
    if (to) p.to = to;
    if (branchId !== "all") p.branchId = branchId;
    return new URLSearchParams(p).toString();
  }, [from, to, branchId]);

  const applyPreset = (i: number) => {
    const p = DATE_PRESETS[i];
    setFrom(p.from()); setTo(p.to()); setActivePreset(i);
  };

  const { data: overview, isLoading: ovLoading } = useQuery({
    queryKey: ["ex-overview", qs],
    queryFn: () => customFetch(`/api/dashboard/executive/overview?${qs}`),
  });
  const { data: trend } = useQuery({
    queryKey: ["ex-trend", qs],
    queryFn: () => customFetch(`/api/dashboard/executive/trend?${qs}`),
  });
  const { data: branchData } = useQuery({
    queryKey: ["ex-branches", qs],
    queryFn: () => customFetch(`/api/dashboard/executive/branches?${qs}`),
  });
  const { data: alertsData } = useQuery({
    queryKey: ["ex-alerts", branchId],
    queryFn: () => customFetch(`/api/dashboard/executive/alerts?${branchId !== "all" ? `branchId=${branchId}` : ""}`),
    refetchInterval: 60_000,
  });

  const ov = overview as any;
  const trendRows = (trend as any[]) ?? [];
  const bData = (branchData as any[]) ?? [];
  const alerts = alertsData as any;

  const totalAlertCount = (alerts?.erpAlerts?.length ?? 0) + (alerts?.computed?.lowStock?.count ?? 0)
    + (alerts?.computed?.pendingReturns?.count ?? 0) + (alerts?.computed?.pendingTransfers?.count ?? 0);

  const branchMax = bData.length > 0 ? Math.max(...bData.map((b: any) => b.revenue), 1) : 1;

  return (
    <div className="p-6 space-y-6 max-w-screen-2xl mx-auto">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-50 rounded-xl">
              <Layers className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Tableau de bord gérant</h1>
              <p className="text-xs text-muted-foreground">Vue direction · {DATE_PRESETS[activePreset]?.label ?? "Période personnalisée"}</p>
            </div>
          </div>
        </div>
        {/* Quick health signal */}
        {ov && (
          <div className="flex items-center gap-2 shrink-0">
            {ov.criticalAlerts > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-700 rounded-lg border border-red-200 text-xs font-semibold animate-pulse">
                <AlertTriangle className="h-3.5 w-3.5" />
                {ov.criticalAlerts} alerte(s) critique(s)
              </div>
            )}
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold ${ov.estimatedResult >= 0 ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`}>
              {ov.estimatedResult >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              Résultat estimé: {fmtDA(ov.estimatedResult)}
            </div>
          </div>
        )}
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <Card className="border-0 shadow-sm bg-muted/30">
        <CardContent className="p-3">
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex gap-1">
              {DATE_PRESETS.map((p, i) => (
                <Button key={i} variant={activePreset === i ? "default" : "outline"} size="sm"
                  className={`text-xs h-7 px-2.5 ${activePreset === i ? "bg-indigo-700 hover:bg-indigo-800 border-indigo-700" : ""}`}
                  onClick={() => applyPreset(i)}>{p.label}</Button>
              ))}
            </div>
            <Input type="date" value={from} onChange={e => { setFrom(e.target.value); setActivePreset(-1); }} className="h-7 text-xs w-32" />
            <span className="text-xs text-muted-foreground self-center">→</span>
            <Input type="date" value={to} onChange={e => { setTo(e.target.value); setActivePreset(-1); }} className="h-7 text-xs w-32" />
            {showBranchFilter && (
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger className="h-7 text-xs w-40">
                  <SelectValue placeholder="Toutes les agences" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes les agences</SelectItem>
                  {(branches ?? []).map((b: any) => (
                    <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 1 — Financial executive summary
      ═══════════════════════════════════════════════════════════════════════ */}
      <div>
        <SectionTitle icon={Banknote} title="Résumé financier" color="text-green-600" />
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          <Card className="border-0 shadow-sm col-span-2">
            <CardContent className="p-4 space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">CA Brut</p>
              {ovLoading ? <div className="h-8 w-28 bg-muted animate-pulse rounded" /> : (
                <p className="text-2xl font-black text-green-700">{fmtDA(ov?.grossRevenue ?? 0)}</p>
              )}
              <p className="text-[10px] text-muted-foreground">{ov?.saleCount ?? 0} vente(s) confirmée(s)</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm col-span-2">
            <CardContent className="p-4 space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">CA Net <span className="text-red-600">(après retours)</span></p>
              {ovLoading ? <div className="h-8 w-28 bg-muted animate-pulse rounded" /> : (
                <p className="text-2xl font-black text-emerald-700">{fmtDA(ov?.netRevenue ?? 0)}</p>
              )}
              <p className="text-[10px] text-muted-foreground">−{fmtDA(ov?.totalRefunded ?? 0)} retours</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-1">
              <Stat label="Achats" value={fmtDA(ov?.totalPurchases ?? 0)} sub={`${ov?.purchaseCount ?? 0} commande(s)`} color="amber" loading={ovLoading} />
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-1">
              <Stat label="Dépenses" value={fmtDA(ov?.totalExpenses ?? 0)} sub={`${ov?.expenseCount ?? 0} ligne(s)`} color="red" loading={ovLoading} />
            </CardContent>
          </Card>
          <Card className={`border-0 shadow-sm col-span-2 ${ov?.estimatedResult >= 0 ? "bg-green-50/50" : "bg-red-50/50"}`}>
            <CardContent className="p-4 space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Résultat opérationnel estimé</p>
              {ovLoading ? <div className="h-8 w-28 bg-muted animate-pulse rounded" /> : (
                <p className={`text-2xl font-black ${ov?.estimatedResult >= 0 ? "text-green-700" : "text-red-700"}`}>
                  {ov?.estimatedResult >= 0 ? "+" : ""}{fmtDA(ov?.estimatedResult ?? 0)}
                </p>
              )}
              <p className="text-[10px] text-muted-foreground">
                {ov ? `Marge estimée: ${ov.operatingMargin}% du CA net` : "—"}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 1b — Internal consumption KPIs (operational costs, NOT sales)
      ═══════════════════════════════════════════════════════════════════════ */}
      <div>
        <SectionTitle icon={FlaskConical} title="Coûts internes opérationnels" color="text-orange-600"
          badge="Confirmés uniquement" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="border-0 shadow-sm border-l-4 border-l-orange-400">
            <CardContent className="p-4 space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <FlaskConical className="h-3 w-3 text-orange-500" />
                Consommation interne
              </p>
              {ovLoading ? <div className="h-8 w-28 bg-muted animate-pulse rounded" /> : (
                <p className="text-2xl font-black text-orange-700">{fmtDA(ov?.totalInternalCost ?? 0)}</p>
              )}
              <p className="text-[10px] text-muted-foreground">coût opérationnel sur la période</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-1">
              <Stat label="Documents confirmés" value={String(ov?.internalDocCount ?? 0)}
                sub="bons de consommation" color="amber" loading={ovLoading} />
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-1">
              <Stat label="Boutiques consommatrices" value={String(ov?.internalBranchCount ?? 0)}
                sub="destinations actives" color="blue" loading={ovLoading} />
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-1">
              {ovLoading ? (
                <div className="space-y-1">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Produit le plus utilisé</p>
                  <div className="h-5 w-24 bg-muted animate-pulse rounded" />
                </div>
              ) : ov?.topInternalProduct ? (
                <div className="space-y-0.5">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Produit le plus utilisé</p>
                  <p className="text-sm font-bold text-slate-700 truncate">{ov.topInternalProduct.name}</p>
                  <p className="text-[10px] text-muted-foreground">{fmtDA(ov.topInternalProduct.totalCost)}</p>
                </div>
              ) : (
                <Stat label="Produit le plus utilisé" value="—" sub="aucune donnée" color="slate" />
              )}
            </CardContent>
          </Card>
        </div>
        {/* Insight bar */}
        {!ovLoading && (ov?.topInternalBranch || ov?.totalInternalCost > 0) && (
          <div className="mt-3 p-3 rounded-lg bg-orange-50/70 border border-orange-100 flex flex-wrap items-center gap-4 text-xs">
            <FlaskConical className="h-4 w-4 text-orange-500 shrink-0" />
            {ov?.topInternalBranch && (
              <span className="text-orange-800">
                <span className="font-semibold">Boutique la plus consommatrice :</span> {ov.topInternalBranch.name} — {fmtDA(ov.topInternalBranch.totalCost)}
              </span>
            )}
            {ov?.totalInternalCost === 0 && (
              <span className="text-orange-700 italic">Aucune consommation interne confirmée sur cette période.</span>
            )}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 2 — Commercial + Trend side-by-side
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Commercial performance compact */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-green-600" />
              Performance commerciale
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4 space-y-4">
            {/* Payment rate gauge */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Taux d'encaissement</span>
                <span className={`font-bold ${(ov?.paymentRate ?? 0) >= 80 ? "text-green-700" : (ov?.paymentRate ?? 0) >= 50 ? "text-amber-700" : "text-red-700"}`}>
                  {ov?.paymentRate ?? 0}%
                </span>
              </div>
              <Progress value={ov?.paymentRate ?? 0} className="h-2" />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>Encaissé: {fmtDA(ov?.encaisse ?? 0)}</span>
                <span className="text-red-600">Restant: {fmtDA(ov?.unpaidRevenue ?? 0)}</span>
              </div>
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Ventes impayées" value={String(ov?.unpaidCount ?? 0)} sub={fmtDA(ov?.unpaidRevenue ?? 0)} color="red" loading={ovLoading} />
              <Stat label="Retours" value={String(ov?.returnCount ?? 0)} sub={fmtDA(ov?.totalRefunded ?? 0)} color="amber" loading={ovLoading} />
              <Stat label="Retours en attente" value={String(ov?.pendingReturns ?? 0)} color="violet" loading={ovLoading} />
              <Stat label="Clients actifs" value="—" color="blue" loading={ovLoading} />
            </div>
          </CardContent>
        </Card>

        {/* Trend chart */}
        <Card className="border-0 shadow-sm lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-indigo-600" />
              Évolution : CA · Dépenses · Résultat net
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            {trendRows.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trendRows}>
                  <defs>
                    <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gNet" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 9 }} interval={Math.ceil((trendRows.length || 1) / 8) - 1} />
                  <YAxis tick={{ fontSize: 9 }} tickFormatter={v => fmtDA(v)} width={60} />
                  <Tooltip content={<ChartTip />} />
                  <ReferenceLine y={0} stroke="#cbd5e1" strokeWidth={1} />
                  <Area type="monotone" dataKey="revenue" name="CA" stroke="#10b981" fill="url(#gRev)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="expenses" name="Dépenses" stroke="#ef4444" fill="url(#gExp)" strokeWidth={1.5} dot={false} />
                  <Area type="monotone" dataKey="netResult" name="Résultat" stroke="#6366f1" fill="url(#gNet)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-52 flex items-center justify-center text-xs text-muted-foreground">
                Aucune donnée sur cette période
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 3 — Operations + Alerts side-by-side
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Operations snapshot */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Factory className="h-4 w-4 text-amber-600" />
              Opérations en cours
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4 space-y-3">
            {/* Production */}
            <div className="p-3 rounded-lg bg-amber-50/60 border border-amber-100 space-y-2">
              <p className="text-[10px] font-semibold uppercase text-amber-700">Production</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center">
                  <p className="text-lg font-bold text-amber-700">{ov?.productionInProgress ?? 0}</p>
                  <p className="text-[10px] text-muted-foreground">En cours</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-slate-600">{ov?.productionPlanned ?? 0}</p>
                  <p className="text-[10px] text-muted-foreground">Planifié</p>
                </div>
                <div className="text-center">
                  <p className={`text-lg font-bold ${(ov?.productionBlocked ?? 0) > 0 ? "text-red-700" : "text-muted-foreground"}`}>
                    {ov?.productionBlocked ?? 0}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Bloqué</p>
                </div>
              </div>
            </div>

            {/* Purchases */}
            <div className="p-3 rounded-lg bg-blue-50/60 border border-blue-100">
              <p className="text-[10px] font-semibold uppercase text-blue-700 mb-2">Achats & Réceptions</p>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Achats impayés" value={fmtDA(ov?.unpaidPurchases ?? 0)} color="red" loading={ovLoading} />
                <Stat label="En attente livr." value={String(ov?.pendingReception ?? 0)} color="amber" loading={ovLoading} />
              </div>
            </div>

            {/* Transfers & Stock */}
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2.5 rounded-lg bg-violet-50/60 border border-violet-100 text-center">
                <ArrowLeftRight className="h-4 w-4 text-violet-600 mx-auto mb-1" />
                <p className="text-xl font-bold text-violet-700">{ov?.pendingTransfers ?? 0}</p>
                <p className="text-[10px] text-muted-foreground">Transferts en attente</p>
              </div>
              <div className={`p-2.5 rounded-lg border text-center ${(ov?.lowStockCount ?? 0) > 0 ? "bg-red-50/60 border-red-100" : "bg-green-50/60 border-green-100"}`}>
                <Package className={`h-4 w-4 mx-auto mb-1 ${(ov?.lowStockCount ?? 0) > 0 ? "text-red-600" : "text-green-600"}`} />
                <p className={`text-xl font-bold ${(ov?.lowStockCount ?? 0) > 0 ? "text-red-700" : "text-green-700"}`}>
                  {ov?.lowStockCount ?? 0}
                </p>
                <p className="text-[10px] text-muted-foreground">Articles stock bas</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Alerts panel */}
        <Card className="border-0 shadow-sm lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              Alertes nécessitant attention
              {totalAlertCount > 0 && (
                <Badge className="bg-red-600 text-white border-0 text-[10px] h-4 px-1.5 ml-auto">{totalAlertCount}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-3 space-y-2">
            {/* ERP alerts */}
            {alerts?.erpAlerts?.map((a: any) => {
              const sev = SEVERITY_CFG[a.severity as keyof typeof SEVERITY_CFG] ?? SEVERITY_CFG.info;
              const typeCfg = ALERT_TYPE_CFG[a.type] ?? { icon: Info, color: "text-slate-600" };
              const Icon = typeCfg.icon;
              return (
                <div key={a.id} className={`flex items-start gap-3 p-3 rounded-lg border text-xs ${sev.cls} ${!a.isRead ? "font-medium" : "opacity-75"}`}>
                  <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${typeCfg.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{a.title}</span>
                      <Badge className={`text-[9px] h-3.5 px-1 border ${sev.cls}`}>{sev.label}</Badge>
                      {!a.isRead && <div className={`h-1.5 w-1.5 rounded-full ${sev.dot}`} />}
                    </div>
                    <p className="text-[11px] opacity-90 mt-0.5 truncate">{a.message}</p>
                  </div>
                </div>
              );
            })}

            {/* Computed: low stock */}
            {alerts?.computed?.lowStock?.count > 0 && (
              <div className="p-3 rounded-lg border bg-amber-50 border-amber-200 text-xs">
                <div className="flex items-center gap-2 mb-2">
                  <Package className="h-4 w-4 text-amber-600" />
                  <span className="font-semibold text-amber-800">{alerts.computed.lowStock.count} article(s) en stock insuffisant</span>
                </div>
                <div className="space-y-1">
                  {alerts.computed.lowStock.items.slice(0, 4).map((item: any, i: number) => (
                    <div key={i} className="flex items-center justify-between">
                      <span className="text-amber-800">{item.productName} — {item.branchName}</span>
                      <span className="font-mono font-bold text-red-700">{item.quantity} / {item.threshold}</span>
                    </div>
                  ))}
                  {alerts.computed.lowStock.count > 4 && (
                    <p className="text-amber-700 text-[10px] mt-1">+{alerts.computed.lowStock.count - 4} autre(s)...</p>
                  )}
                </div>
              </div>
            )}

            {/* Computed: pending purchases */}
            {alerts?.computed?.pendingPurchases?.count > 0 && (
              <div className="flex items-start gap-3 p-3 rounded-lg border bg-blue-50 border-blue-200 text-xs">
                <ShoppingCart className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-blue-800">
                    {alerts.computed.pendingPurchases.count} commande(s) achat en attente de réception
                  </p>
                  <p className="text-[11px] text-blue-700">{fmtDA2(alerts.computed.pendingPurchases.amount)} en attente de livraison fournisseur</p>
                </div>
              </div>
            )}

            {/* Computed: pending returns */}
            {alerts?.computed?.pendingReturns?.count > 0 && (
              <div className="flex items-start gap-3 p-3 rounded-lg border bg-violet-50 border-violet-200 text-xs">
                <RotateCcw className="h-4 w-4 text-violet-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-violet-800">
                    {alerts.computed.pendingReturns.count} retour(s) en attente de traitement
                  </p>
                  <p className="text-[11px] text-violet-700">{fmtDA2(alerts.computed.pendingReturns.amount)} à rembourser ou à créditer</p>
                </div>
              </div>
            )}

            {/* Computed: pending transfers */}
            {alerts?.computed?.pendingTransfers?.count > 0 && (
              <div className="flex items-start gap-3 p-3 rounded-lg border bg-slate-50 border-slate-200 text-xs">
                <ArrowLeftRight className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
                <p className="font-semibold text-slate-700">
                  {alerts.computed.pendingTransfers.count} transfert(s) inter-agence en attente de confirmation
                </p>
              </div>
            )}

            {totalAlertCount === 0 && !ovLoading && (
              <div className="flex items-center gap-3 p-4 text-xs text-green-700 bg-green-50 rounded-lg border border-green-200">
                <CheckCircle2 className="h-4 w-4" />
                <span className="font-semibold">Aucune alerte active — toutes les opérations sont sous contrôle.</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 4 — Branch comparison
      ═══════════════════════════════════════════════════════════════════════ */}
      {bData.length > 0 && (
        <div>
          <SectionTitle icon={Building2} title="Comparaison agences" color="text-blue-600" badge={`${bData.length} agences`} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* Bar chart */}
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-1">
                <CardTitle className="text-xs font-semibold text-muted-foreground">CA · Dépenses · Coût interne par agence</CardTitle>
              </CardHeader>
              <CardContent className="pb-3">
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={bData} layout="vertical" margin={{ left: 4, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                    <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={v => fmtDA(v)} width={60} />
                    <YAxis type="category" dataKey="branchName" tick={{ fontSize: 9 }} width={80} />
                    <Tooltip formatter={(v: any) => fmtDA2(v)} />
                    <Bar dataKey="revenue" name="CA" fill="#10b981" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="expenses" name="Dépenses" fill="#ef4444" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="internalCost" name="Coût interne" fill="#f97316" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Detail table */}
            <Card className="border-0 shadow-sm">
              <CardContent className="p-0">
                <div className="divide-y divide-border/50">
                  {/* Header */}
                  <div className="grid grid-cols-7 px-4 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    <span className="col-span-2">Agence</span>
                    <span className="text-right text-green-700">CA</span>
                    <span className="text-right text-red-700">Dépenses</span>
                    <span className="text-right text-orange-600">Coût interne</span>
                    <span className="text-right text-indigo-700">Résultat</span>
                    <span className="text-right">Risques</span>
                  </div>
                  {bData.map((b: any, i: number) => {
                    const hasRisk = b.lowStockCount > 0 || b.productionBlocked > 0;
                    const resPct = Math.round((b.estimatedResult / Math.max(b.revenue, 1)) * 100);
                    return (
                      <div key={b.branchId} className="grid grid-cols-7 px-4 py-2.5 items-center hover:bg-muted/30 transition-colors">
                        <div className="col-span-2 flex items-center gap-2">
                          <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ["#10b981","#6366f1","#f59e0b","#ef4444","#8b5cf6"][i%5] }} />
                          <span className="text-xs font-medium">{b.branchName}</span>
                        </div>
                        <div className="text-right text-xs font-bold text-green-700">{fmtDA(b.revenue)}</div>
                        <div className="text-right text-xs text-red-700">{b.expenses > 0 ? fmtDA(b.expenses) : <span className="text-muted-foreground">—</span>}</div>
                        <div className="text-right text-xs text-orange-600 font-medium">
                          {b.internalCost > 0 ? fmtDA(b.internalCost) : <span className="text-muted-foreground">—</span>}
                        </div>
                        <div className={`text-right text-xs font-semibold ${b.estimatedResult >= 0 ? "text-green-700" : "text-red-700"}`}>
                          {b.estimatedResult !== 0 ? `${b.estimatedResult >= 0 ? "+" : ""}${resPct}%` : "—"}
                        </div>
                        <div className="flex items-center justify-end gap-1 text-[10px]">
                          {b.lowStockCount > 0 && (
                            <span className="flex items-center gap-0.5 text-amber-600 font-semibold">
                              <Package className="h-3 w-3" />{b.lowStockCount}
                            </span>
                          )}
                          {b.productionBlocked > 0 && (
                            <span className="flex items-center gap-0.5 text-red-600 font-semibold">
                              <ZapOff className="h-3 w-3" />{b.productionBlocked}
                            </span>
                          )}
                          {b.unpaidRevenue > 0 && (
                            <span className="flex items-center gap-0.5 text-orange-600 font-semibold">
                              <CreditCard className="h-3 w-3" />
                            </span>
                          )}
                          {!hasRisk && b.unpaidRevenue === 0 && (
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Branch revenue distribution bars */}
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {bData.map((b: any, i: number) => {
              const pct = Math.round((b.revenue / branchMax) * 100);
              const colors = ["#10b981","#6366f1","#f59e0b","#ef4444","#8b5cf6"];
              const col = colors[i % colors.length];
              return (
                <div key={b.branchId} className="p-3 bg-background rounded-lg border shadow-sm space-y-2">
                  <div className="flex justify-between items-start">
                    <p className="text-xs font-semibold">{b.branchName}</p>
                    <div className="text-right">
                      <p className="text-sm font-bold" style={{ color: col }}>{fmtDA(b.revenue)}</p>
                      <p className="text-[10px] text-muted-foreground">{b.saleCount} vente(s)</p>
                    </div>
                  </div>
                  <Progress value={pct} className="h-1.5" style={{ '--tw-ring-color': col } as any} />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>
                      Résultat: <span className={b.estimatedResult >= 0 ? "text-green-700 font-semibold" : "text-red-700 font-semibold"}>
                        {b.estimatedResult >= 0 ? "+" : ""}{fmtDA(b.estimatedResult)}
                      </span>
                    </span>
                    {b.internalCost > 0 && (
                      <span className="text-orange-600 font-medium flex items-center gap-0.5">
                        <FlaskConical className="h-2.5 w-2.5" />{fmtDA(b.internalCost)}
                      </span>
                    )}
                    {b.lowStockCount > 0 && <span className="text-amber-600">{b.lowStockCount} stock bas</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
