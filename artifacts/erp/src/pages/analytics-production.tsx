import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch, useGetBranches } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  ChefHat, TrendingUp, TrendingDown, Package, AlertTriangle, CheckCircle2,
  Clock, BarChart3, Building2, Leaf, FlaskConical, Star, Factory,
  Layers, Gauge, Zap,
} from "lucide-react";
import { format, subDays, startOfMonth, startOfYear } from "date-fns";
import { fr } from "date-fns/locale";
import { useAuth } from "@/lib/auth";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDA(n: number) {
  return new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(n) + " DA";
}
function fmtK(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "k";
  return String(Math.round(n));
}
function fmtDate(d: string | Date) {
  try { return format(new Date(d), "dd MMM", { locale: fr }); } catch { return "—"; }
}
function fmtDateTime(d: string | Date | null | undefined) {
  if (!d) return "—";
  try { return format(new Date(d), "dd/MM/yy HH:mm", { locale: fr }); } catch { return "—"; }
}
function fmtDateShort(d: string | Date | null | undefined) {
  if (!d) return "—";
  try { return format(new Date(d), "dd/MM/yyyy", { locale: fr }); } catch { return "—"; }
}

const STATUS_CFG: Record<string, { label: string; cls: string; dot: string }> = {
  draft:       { label: "Brouillon",    cls: "bg-slate-100 text-slate-700",   dot: "bg-slate-400" },
  planned:     { label: "Planifiée",    cls: "bg-blue-100 text-blue-700",     dot: "bg-blue-500" },
  in_progress: { label: "En cours",     cls: "bg-amber-100 text-amber-700",   dot: "bg-amber-400" },
  completed:   { label: "Terminée",     cls: "bg-green-100 text-green-700",   dot: "bg-green-500" },
  blocked:     { label: "Bloquée",      cls: "bg-red-100 text-red-700",       dot: "bg-red-500" },
  cancelled:   { label: "Annulée",      cls: "bg-rose-100 text-rose-700",     dot: "bg-rose-400" },
};

const BRANCH_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#0ea5e9"];

const DATE_PRESETS = [
  { label: "7j",   from: () => format(subDays(new Date(), 6), "yyyy-MM-dd"),  to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "30j",  from: () => format(subDays(new Date(), 29), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "Ce mois",     from: () => format(startOfMonth(new Date()), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "Cette année", from: () => format(startOfYear(new Date()), "yyyy-MM-dd"),  to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "Tout", from: () => "2023-01-01", to: () => format(new Date(), "yyyy-MM-dd") },
];

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ title, value, sub, icon: Icon, color = "blue", loading = false, highlight }: {
  title: string; value: string; sub?: string;
  icon: React.FC<{ className?: string }>;
  color?: "green" | "red" | "amber" | "blue" | "violet" | "indigo" | "emerald";
  loading?: boolean;
  highlight?: "good" | "bad" | "neutral";
}) {
  const bg: Record<string, string> = { green: "bg-green-50", red: "bg-red-50", amber: "bg-amber-50", blue: "bg-blue-50", violet: "bg-violet-50", indigo: "bg-indigo-50", emerald: "bg-emerald-50" };
  const ic: Record<string, string> = { green: "text-green-600", red: "text-red-600", amber: "text-amber-600", blue: "text-blue-600", violet: "text-violet-600", indigo: "text-indigo-600", emerald: "text-emerald-600" };
  const valCls = highlight === "good" ? "text-green-700" : highlight === "bad" ? "text-red-700" : "text-foreground";
  return (
    <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg ${bg[color]} shrink-0`}>
            <Icon className={`h-4 w-4 ${ic[color]}`} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground font-medium truncate">{title}</p>
            {loading ? <div className="h-6 w-28 bg-muted animate-pulse rounded mt-1" /> : (
              <p className={`text-xl font-bold leading-tight ${valCls}`}>{value}</p>
            )}
            {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Gauge donut ──────────────────────────────────────────────────────────────
function GaugeRing({ value, label, color }: { value: number; label: string; color: string }) {
  const data = [{ value }, { value: 100 - value }];
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-20 h-20">
        <PieChart width={80} height={80}>
          <Pie data={data} cx={35} cy={35} innerRadius={26} outerRadius={35} startAngle={90} endAngle={-270} dataKey="value">
            <Cell fill={color} />
            <Cell fill="#f1f5f9" />
          </Pie>
        </PieChart>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold" style={{ color }}>{value}%</span>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground text-center mt-0.5 leading-tight">{label}</p>
    </div>
  );
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────
function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background border border-border rounded-lg shadow-lg p-3 text-xs space-y-1">
      <p className="font-semibold">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }}>{p.name}: {p.value}</p>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function AnalyticsProduction() {
  const { user } = useAuth();

  const [from, setFrom] = useState(format(subDays(new Date(), 29), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [branchId, setBranchId] = useState("all");
  const [status, setStatus] = useState("all");
  const [activePreset, setActivePreset] = useState(1);

  const { data: branches } = useGetBranches();

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (from) p.from = from;
    if (to) p.to = to;
    if (branchId !== "all") p.branchId = branchId;
    if (status !== "all") p.status = status;
    return p;
  }, [from, to, branchId, status]);
  const qs = new URLSearchParams(params).toString();

  const showBranchFilter = user?.adminAccess || (user?.branchIds && user.branchIds.length > 1);

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ["apo-kpis", qs],
    queryFn: () => customFetch(`/api/analytics/production/kpis?${qs}`),
  });
  const { data: trend, isLoading: trendLoading } = useQuery({
    queryKey: ["apo-trend", qs],
    queryFn: () => customFetch(`/api/analytics/production/trend?${qs}`),
  });
  const { data: recipes } = useQuery({
    queryKey: ["apo-recipes", qs],
    queryFn: () => customFetch(`/api/analytics/production/recipes?${qs}`),
  });
  const { data: yieldData } = useQuery({
    queryKey: ["apo-yield", qs],
    queryFn: () => customFetch(`/api/analytics/production/yield?${qs}`),
  });
  const { data: branchData } = useQuery({
    queryKey: ["apo-branches", qs],
    queryFn: () => customFetch(`/api/analytics/production/branches?${qs}`),
  });
  const { data: ingredients } = useQuery({
    queryKey: ["apo-ingredients", qs],
    queryFn: () => customFetch(`/api/analytics/production/ingredients?${qs}`),
  });
  const { data: orders } = useQuery({
    queryKey: ["apo-orders", qs],
    queryFn: () => customFetch(`/api/analytics/production/orders?${qs}`),
  });

  const k = kpis as any;

  const applyPreset = (i: number) => {
    const p = DATE_PRESETS[i];
    setFrom(p.from()); setTo(p.to()); setActivePreset(i);
  };

  // Status distribution for mini-chart
  const statusData = k ? [
    { name: "Terminées",  value: k.completed,  color: "#10b981" },
    { name: "En cours",   value: k.planned,     color: "#f59e0b" },
    { name: "Bloquées",   value: k.blocked,     color: "#ef4444" },
    { name: "Brouillons", value: k.draft,       color: "#94a3b8" },
  ].filter(d => d.value > 0) : [];

  return (
    <div className="p-6 space-y-6 max-w-screen-2xl mx-auto">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Factory className="h-6 w-6 text-indigo-600" />
            Analytique Production & Atelier
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Performance atelier · Rendement recettes · Coûts de production
          </p>
        </div>
        {k && (
          <div className="flex items-center gap-4">
            <GaugeRing value={k.completionRate} label="Taux d'achèvement" color="#10b981" />
            <GaugeRing value={k.yieldRate}      label="Rendement moyen"  color="#6366f1" />
          </div>
        )}
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Période</Label>
              <div className="flex gap-1">
                {DATE_PRESETS.map((p, i) => (
                  <Button
                    key={i}
                    variant={activePreset === i ? "default" : "outline"}
                    size="sm"
                    className={`text-xs h-8 px-2.5 ${activePreset === i ? "bg-indigo-700 hover:bg-indigo-800 border-indigo-700" : ""}`}
                    onClick={() => applyPreset(i)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Du</Label>
              <Input type="date" value={from} onChange={e => { setFrom(e.target.value); setActivePreset(-1); }} className="h-8 text-xs w-36" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Au</Label>
              <Input type="date" value={to} onChange={e => { setTo(e.target.value); setActivePreset(-1); }} className="h-8 text-xs w-36" />
            </div>
            {showBranchFilter && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Agence / Labo</Label>
                <Select value={branchId} onValueChange={setBranchId}>
                  <SelectTrigger className="h-8 text-xs w-44">
                    <SelectValue placeholder="Toutes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous</SelectItem>
                    {(branches ?? []).map((b: any) => (
                      <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Statut</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-8 text-xs w-36">
                  <SelectValue placeholder="Tous" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous</SelectItem>
                  <SelectItem value="draft">Brouillon</SelectItem>
                  <SelectItem value="planned">Planifiée</SelectItem>
                  <SelectItem value="in_progress">En cours</SelectItem>
                  <SelectItem value="completed">Terminée</SelectItem>
                  <SelectItem value="blocked">Bloquée</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── KPI Cards ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          title="Ordres de production"
          value={k ? String(k.total) : "—"}
          sub={k ? `${k.completed} terminés · ${k.planned} actifs` : "—"}
          icon={Factory} color="indigo" loading={kpisLoading}
        />
        <KpiCard
          title="Quantité produite"
          value={k ? `${k.totalActualQty.toLocaleString("fr-DZ", { maximumFractionDigits: 0 })} u.` : "—"}
          sub={k ? `sur ${k.totalPlannedQty.toLocaleString("fr-DZ", { maximumFractionDigits: 0 })} planifiées` : "—"}
          icon={Package} color="green" loading={kpisLoading}
        />
        <KpiCard
          title="Coût théorique total"
          value={k ? fmtDA(k.totalTheoreticalCost) : "—"}
          sub="Estimé depuis les recettes"
          icon={Layers} color="blue" loading={kpisLoading}
        />
        <KpiCard
          title="Coût moyen / ordre"
          value={k ? fmtDA(k.avgTheoreticalCost) : "—"}
          sub="Coût théorique moyen"
          icon={BarChart3} color="violet" loading={kpisLoading}
        />
        <KpiCard
          title="Ordres bloqués"
          value={k ? String(k.blocked) : "—"}
          sub="Rupture d'ingrédients"
          icon={AlertTriangle} color="red" loading={kpisLoading}
          highlight={k?.blocked > 0 ? "bad" : "neutral"}
        />
        <KpiCard
          title="Variance de coût"
          value={k ? (k.costVariancePct === 0 ? "±0%" : `${k.costVariancePct > 0 ? "+" : ""}${k.costVariancePct}%`) : "—"}
          sub={k ? (k.costVariance > 0 ? `+${fmtDA(k.costVariance)} surcoût` : k.costVariance < 0 ? `${fmtDA(Math.abs(k.costVariance))} économisé` : "Dans le budget") : "—"}
          icon={k?.costVariance >= 0 ? TrendingUp : TrendingDown}
          color={k?.costVariance > 0 ? "red" : "emerald"} loading={kpisLoading}
          highlight={k?.costVariance > 0 ? "bad" : k?.costVariance < 0 ? "good" : "neutral"}
        />
      </div>

      {/* ── Trend + Status distribution ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Production trend area chart */}
        <Card className="border-0 shadow-sm lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-indigo-600" />
              Évolution des ordres — Planifiés vs Terminés vs Bloqués
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            {trendLoading ? (
              <div className="h-52 flex items-center justify-center text-xs text-muted-foreground">Chargement...</div>
            ) : Array.isArray(trend) && (trend as any[]).length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={trend as any[]}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={fmtDate}
                    tick={{ fontSize: 9 }}
                    interval={Math.ceil(((trend as any[]).length || 1) / 8) - 1}
                  />
                  <YAxis tick={{ fontSize: 9 }} width={30} />
                  <Tooltip content={<ChartTip />} />
                  <Bar dataKey="completed" name="Terminés" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="blocked" name="Bloqués" stackId="a" fill="#ef4444" />
                  <Bar dataKey="orders" name="Total" fill="transparent" legendType="none" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-52 flex items-center justify-center text-xs text-muted-foreground">Aucune donnée sur cette période</div>
            )}
          </CardContent>
        </Card>

        {/* Status breakdown donut */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Gauge className="h-4 w-4 text-amber-600" />
              Répartition par statut
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            {statusData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={120}>
                  <PieChart>
                    <Pie data={statusData} cx="50%" cy="50%" innerRadius={30} outerRadius={50} dataKey="value" nameKey="name">
                      {statusData.map((s, i) => <Cell key={i} fill={s.color} />)}
                    </Pie>
                    <Tooltip formatter={(v: any, n: any) => [v + " ordres", n]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1.5 mt-2">
                  {statusData.map((s, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                        <span className="text-muted-foreground">{s.name}</span>
                      </div>
                      <span className="font-semibold">{s.value}</span>
                    </div>
                  ))}
                </div>
                {k && (
                  <div className="mt-3 pt-3 border-t border-border space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Taux d'achèvement</span>
                      <span className={`font-bold ${k.completionRate >= 70 ? "text-green-700" : "text-amber-700"}`}>{k.completionRate}%</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Rendement moyen</span>
                      <span className={`font-bold ${k.yieldRate >= 90 ? "text-green-700" : k.yieldRate >= 70 ? "text-amber-700" : "text-red-700"}`}>{k.yieldRate}%</span>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">Aucune donnée</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Branch comparison ────────────────────────────────────────────────── */}
      {Array.isArray(branchData) && (branchData as any[]).length > 1 && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Building2 className="h-4 w-4 text-blue-600" />
              Production par agence / laboratoire
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={branchData as any[]}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="branchName" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 9 }} width={30} />
                  <Tooltip content={<ChartTip />} />
                  <Bar dataKey="completed" name="Terminés" fill="#10b981" stackId="a" />
                  <Bar dataKey="blocked" name="Bloqués" fill="#ef4444" stackId="a" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs font-semibold">Agence</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Total</TableHead>
                    <TableHead className="text-xs font-semibold text-right text-green-700">Terminés</TableHead>
                    <TableHead className="text-xs font-semibold text-right text-red-700">Bloqués</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Achèvement</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Coût théo.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(branchData as any[]).map((b, i) => (
                    <TableRow key={b.branchId}>
                      <TableCell>
                        <div className="flex items-center gap-2 text-xs font-medium">
                          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: BRANCH_COLORS[i % BRANCH_COLORS.length] }} />
                          {b.branchName}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-right">{b.total}</TableCell>
                      <TableCell className="text-xs text-right text-green-700 font-semibold">{b.completed}</TableCell>
                      <TableCell className="text-xs text-right text-red-700 font-semibold">{b.blocked}</TableCell>
                      <TableCell className="text-xs text-right">
                        <span className={`font-semibold ${b.completionRate >= 70 ? "text-green-700" : "text-amber-700"}`}>
                          {b.completionRate}%
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-right text-muted-foreground">{fmtDA(b.totalCost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <Tabs defaultValue="recipes">
        <TabsList className="h-8">
          <TabsTrigger value="recipes" className="text-xs h-7 px-3">
            <ChefHat className="h-3.5 w-3.5 mr-1.5" />
            Recettes
          </TabsTrigger>
          <TabsTrigger value="yield" className="text-xs h-7 px-3">
            <Gauge className="h-3.5 w-3.5 mr-1.5" />
            Rendement
          </TabsTrigger>
          <TabsTrigger value="ingredients" className="text-xs h-7 px-3">
            <Leaf className="h-3.5 w-3.5 mr-1.5" />
            Ingrédients consommés
          </TabsTrigger>
          <TabsTrigger value="orders" className="text-xs h-7 px-3">
            <Factory className="h-3.5 w-3.5 mr-1.5" />
            Ordres de production
          </TabsTrigger>
        </TabsList>

        {/* ── Recipes ranking ─────────────────────────────────────────────────── */}
        <TabsContent value="recipes">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Star className="h-4 w-4 text-amber-500" />
                Classement recettes — Production et performance
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {Array.isArray(recipes) && (recipes as any[]).length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs font-semibold w-8">#</TableHead>
                      <TableHead className="text-xs font-semibold">Recette</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Ordres</TableHead>
                      <TableHead className="text-xs font-semibold text-right text-green-700">Terminés</TableHead>
                      <TableHead className="text-xs font-semibold text-right text-red-700">Bloqués</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Achèvement</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Qté planifiée</TableHead>
                      <TableHead className="text-xs font-semibold text-right text-green-700">Qté produite</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Rendement</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Coût théo.</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Variance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(recipes as any[]).map((r, i) => (
                      <TableRow key={r.recipeId}>
                        <TableCell className="text-xs text-muted-foreground font-mono">{i + 1}</TableCell>
                        <TableCell className="text-xs font-semibold">{r.recipeName}</TableCell>
                        <TableCell className="text-xs text-right">{r.orderCount}</TableCell>
                        <TableCell className="text-xs text-right text-green-700 font-semibold">{r.completedCount}</TableCell>
                        <TableCell className="text-xs text-right text-red-700 font-semibold">{r.blockedCount}</TableCell>
                        <TableCell className="text-xs text-right">
                          <div className="flex items-center gap-1.5 justify-end">
                            <Progress value={r.completionRate} className="h-1.5 w-12" />
                            <span className={`text-xs font-semibold ${r.completionRate >= 70 ? "text-green-700" : r.completionRate >= 40 ? "text-amber-700" : "text-red-700"}`}>
                              {r.completionRate}%
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono">{r.totalPlannedQty.toFixed(0)}</TableCell>
                        <TableCell className="text-xs text-right font-mono text-green-700 font-semibold">{r.totalActualQty.toFixed(0)}</TableCell>
                        <TableCell className="text-xs text-right">
                          <span className={`font-semibold ${r.yieldRate >= 90 ? "text-green-700" : r.yieldRate >= 70 ? "text-amber-700" : r.yieldRate > 0 ? "text-red-700" : "text-muted-foreground"}`}>
                            {r.yieldRate > 0 ? `${r.yieldRate}%` : "—"}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-right">{fmtDA(r.totalTheoreticalCost)}</TableCell>
                        <TableCell className="text-xs text-right">
                          {r.totalActualCost > 0 ? (
                            <span className={r.costVariance > 0 ? "text-red-700 font-semibold" : r.costVariance < 0 ? "text-green-700 font-semibold" : "text-muted-foreground"}>
                              {r.costVariance > 0 ? "+" : ""}{fmtDA(r.costVariance)}
                            </span>
                          ) : <span className="text-muted-foreground text-[10px]">—</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">Aucune recette sur cette période</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Yield analysis ──────────────────────────────────────────────────── */}
        <TabsContent value="yield">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Gauge className="h-4 w-4 text-indigo-600" />
                Analyse de rendement — Ordres terminés
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {Array.isArray(yieldData) && (yieldData as any[]).length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs font-semibold">Référence</TableHead>
                      <TableHead className="text-xs font-semibold">Recette</TableHead>
                      <TableHead className="text-xs font-semibold">Agence</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Planifié</TableHead>
                      <TableHead className="text-xs font-semibold text-right text-green-700">Réel</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Rendement</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Coût théo.</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Coût réel</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Variance</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Durée</TableHead>
                      <TableHead className="text-xs font-semibold">Terminé le</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(yieldData as any[]).map((r: any) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs font-mono font-semibold">{r.reference}</TableCell>
                        <TableCell className="text-xs">{r.recipeName}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.branchName}</TableCell>
                        <TableCell className="text-xs text-right font-mono">{r.plannedQuantity.toFixed(0)}</TableCell>
                        <TableCell className="text-xs text-right font-mono text-green-700 font-semibold">{r.actualQuantity.toFixed(0)}</TableCell>
                        <TableCell className="text-xs text-right">
                          <span className={`font-semibold ${r.yieldRate >= 90 ? "text-green-700" : r.yieldRate >= 70 ? "text-amber-700" : "text-red-700"}`}>
                            {r.yieldRate}%
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-right">{fmtDA(r.theoreticalCost)}</TableCell>
                        <TableCell className="text-xs text-right">
                          {r.actualCost != null ? fmtDA(r.actualCost) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-xs text-right">
                          {r.costVariance != null ? (
                            <span className={r.costVariance > 0 ? "text-red-700 font-semibold" : r.costVariance < 0 ? "text-green-700 font-semibold" : "text-muted-foreground"}>
                              {r.costVariance > 0 ? "+" : ""}{fmtDA(r.costVariance)}
                              {r.costVariancePct != null && <span className="text-[10px] ml-1">({r.costVariancePct}%)</span>}
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-xs text-right">
                          {r.cycleTimeHours != null ? <span className="text-muted-foreground">{r.cycleTimeHours}h</span> : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmtDateTime(r.completedAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">Aucun ordre terminé sur cette période</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Ingredient consumption ──────────────────────────────────────────── */}
        <TabsContent value="ingredients">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Leaf className="h-4 w-4 text-green-600" />
                Consommation d'ingrédients — Estimée depuis les ordres terminés
              </CardTitle>
              <p className="text-[11px] text-muted-foreground">
                Consommation calculée à partir des fiches recettes × quantités réellement produites (avec pertes incluses)
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {Array.isArray(ingredients) && (ingredients as any[]).length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs font-semibold w-8">#</TableHead>
                      <TableHead className="text-xs font-semibold">Ingrédient</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Qté consommée estimée</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Ordres concernés</TableHead>
                      <TableHead className="text-xs font-semibold">Part relative</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(ingredients as any[]).map((ing: any, i: number) => {
                      const totalQty = (ingredients as any[]).reduce((a, x) => a + x.totalQty, 0);
                      const pct = totalQty > 0 ? Math.round((ing.totalQty / totalQty) * 100) : 0;
                      return (
                        <TableRow key={ing.productId}>
                          <TableCell className="text-xs text-muted-foreground font-mono">{i + 1}</TableCell>
                          <TableCell className="text-xs font-semibold">{ing.productName}</TableCell>
                          <TableCell className="text-xs text-right font-mono font-bold text-green-700">
                            {ing.totalQty.toLocaleString("fr-DZ", { maximumFractionDigits: 1 })}
                          </TableCell>
                          <TableCell className="text-xs text-right text-muted-foreground">{ing.orderCount}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <Progress value={pct} className="h-1.5 flex-1 max-w-[120px]" />
                              <span className="text-[10px] text-muted-foreground">{pct}%</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">
                  Aucun ordre terminé — la consommation d'ingrédients n'est calculée que sur les ordres complétés
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── All orders ──────────────────────────────────────────────────────── */}
        <TabsContent value="orders">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Tous les ordres de production</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {Array.isArray(orders) && (orders as any[]).length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs font-semibold">Référence</TableHead>
                      <TableHead className="text-xs font-semibold">Recette</TableHead>
                      <TableHead className="text-xs font-semibold">Agence</TableHead>
                      <TableHead className="text-xs font-semibold">Statut</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Planifié</TableHead>
                      <TableHead className="text-xs font-semibold text-right text-green-700">Produit</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Rendement</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Coût théo.</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Coût réel</TableHead>
                      <TableHead className="text-xs font-semibold">Terminé le</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(orders as any[]).map((o: any) => {
                      const stCfg = STATUS_CFG[o.status] ?? { label: o.status, cls: "bg-slate-100 text-slate-700", dot: "bg-slate-400" };
                      return (
                        <TableRow key={o.id}>
                          <TableCell className="text-xs font-mono font-semibold">{o.reference}</TableCell>
                          <TableCell className="text-xs">{o.recipeName}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{o.branchName}</TableCell>
                          <TableCell>
                            <Badge className={`text-[10px] h-4 px-1.5 border ${stCfg.cls}`}>{stCfg.label}</Badge>
                          </TableCell>
                          <TableCell className="text-xs text-right font-mono">{o.plannedQuantity.toFixed(0)}</TableCell>
                          <TableCell className="text-xs text-right font-mono text-green-700">
                            {o.actualQuantity > 0 ? o.actualQuantity.toFixed(0) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-xs text-right">
                            {o.yieldRate != null ? (
                              <span className={`font-semibold ${o.yieldRate >= 90 ? "text-green-700" : o.yieldRate >= 70 ? "text-amber-700" : "text-red-700"}`}>
                                {o.yieldRate}%
                              </span>
                            ) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-xs text-right text-muted-foreground">{fmtDA(o.theoreticalCost)}</TableCell>
                          <TableCell className="text-xs text-right">
                            {o.actualCost != null ? (
                              <span className={o.costVariance != null && o.costVariance > 0 ? "text-red-700" : "text-green-700"}>
                                {fmtDA(o.actualCost)}
                              </span>
                            ) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{fmtDateTime(o.completedAt)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">Aucun ordre sur cette période</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
