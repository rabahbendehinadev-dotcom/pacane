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
  PieChart, Pie, Cell, CartesianGrid, Legend, ReferenceLine, Line,
} from "recharts";
import {
  Wallet, TrendingUp, TrendingDown, ArrowDownCircle, ArrowUpCircle,
  Building2, Clock, AlertTriangle, CheckCircle2, DollarSign,
  ShoppingCart, Receipt, RotateCcw, Banknote, CreditCard,
  BarChart3, FileText, Store,
} from "lucide-react";
import { format, subDays, startOfMonth, startOfYear, startOfWeek } from "date-fns";
import { fr } from "date-fns/locale";
import { useAuth } from "@/lib/auth";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDA(n: number) {
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
function fmtDatetime(d: string | Date) {
  try { return format(new Date(d), "dd MMM HH:mm", { locale: fr }); } catch { return "—"; }
}

const COLORS = {
  inflow: "#10b981",
  outflow: "#ef4444",
  net: "#6366f1",
  cumulative: "#d97706",
  cash: "#d97706", card: "#6366f1", credit: "#8b5cf6",
  transfer: "#0ea5e9", check: "#0ea5e9",
  purchases: "#6366f1", expenses: "#f59e0b", refunds: "#ef4444",
};
const BRANCH_COLORS = ["#10b981", "#6366f1", "#f59e0b", "#ef4444", "#8b5cf6", "#0ea5e9"];
const PAYMENT_LABELS: Record<string, string> = {
  cash: "Espèces", card: "Carte", credit: "Crédit",
  transfer: "Virement", virement: "Virement", check: "Chèque", cheque: "Chèque",
};

// ─── Custom tooltip ───────────────────────────────────────────────────────────
function CashflowTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background border border-border rounded-lg shadow-lg p-3 text-xs space-y-1">
      <p className="font-semibold">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }}>
          {p.name}: {formatDA(p.value)}
        </p>
      ))}
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ title, value, sub, icon: Icon, color = "green", trend, loading = false }: {
  title: string; value: string; sub?: string;
  icon: React.FC<{ className?: string }>;
  color?: "green" | "red" | "amber" | "blue" | "violet" | "indigo";
  trend?: "up" | "down" | "neutral";
  loading?: boolean;
}) {
  const bg = { green: "bg-green-50", red: "bg-red-50", amber: "bg-amber-50", blue: "bg-blue-50", violet: "bg-violet-50", indigo: "bg-indigo-50" }[color];
  const ic = { green: "text-green-600", red: "text-red-600", amber: "text-amber-600", blue: "text-blue-600", violet: "text-violet-600", indigo: "text-indigo-600" }[color];
  return (
    <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg ${bg} shrink-0`}>
            <Icon className={`h-4 w-4 ${ic}`} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground font-medium truncate">{title}</p>
            {loading ? (
              <div className="h-6 w-28 bg-muted animate-pulse rounded mt-1" />
            ) : (
              <p className={`text-xl font-bold leading-tight ${color === "red" ? "text-red-700" : color === "green" ? "text-green-700" : "text-foreground"}`}>
                {value}
              </p>
            )}
            {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          {trend && (
            <div className={`mt-1 ${trend === "up" ? "text-green-500" : trend === "down" ? "text-red-500" : "text-muted-foreground"}`}>
              {trend === "up" ? <TrendingUp className="h-4 w-4" /> : trend === "down" ? <TrendingDown className="h-4 w-4" /> : null}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Date presets ─────────────────────────────────────────────────────────────
const DATE_PRESETS = [
  { label: "7j", from: () => format(subDays(new Date(), 6), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "30j", from: () => format(subDays(new Date(), 29), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "Ce mois", from: () => format(startOfMonth(new Date()), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "Cette année", from: () => format(startOfYear(new Date()), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "Tout", from: () => "2023-01-01", to: () => format(new Date(), "yyyy-MM-dd") },
];

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Treasury() {
  const { user } = useAuth();
  const isAdmin = user?.adminAccess;

  const [from, setFrom] = useState(format(subDays(new Date(), 29), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [branchId, setBranchId] = useState("all");
  const [activePreset, setActivePreset] = useState(1);
  const [movementType, setMovementType] = useState("all");

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (from) p.from = from;
    if (to) p.to = to;
    if (branchId !== "all") p.branchId = branchId;
    return p;
  }, [from, to, branchId]);

  const qs = new URLSearchParams(params).toString();
  const { data: branches } = useGetBranches();

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ["treasury-overview", qs],
    queryFn: () => customFetch(`/api/treasury/overview?${qs}`),
  });

  const { data: trend, isLoading: trendLoading } = useQuery({
    queryKey: ["treasury-trend", qs],
    queryFn: () => customFetch(`/api/treasury/trend?${qs}`),
  });

  const { data: branchData } = useQuery({
    queryKey: ["treasury-branches", qs],
    queryFn: () => customFetch(`/api/treasury/branches?${qs}`),
  });

  const { data: aging } = useQuery({
    queryKey: ["treasury-aging", qs],
    queryFn: () => customFetch(`/api/treasury/aging?${qs}`),
  });

  const { data: movements } = useQuery({
    queryKey: ["treasury-movements", qs],
    queryFn: () => customFetch(`/api/treasury/movements?${qs}`),
  });

  const { data: breakdown } = useQuery({
    queryKey: ["treasury-breakdown", qs],
    queryFn: () => customFetch(`/api/treasury/breakdown?${qs}`),
  });

  const o = overview as any;
  const showBranchFilter = isAdmin || (user?.branchIds && user.branchIds.length > 1);

  const applyPreset = (i: number) => {
    const p = DATE_PRESETS[i];
    setFrom(p.from());
    setTo(p.to());
    setActivePreset(i);
  };

  const filteredMovements = useMemo(() => {
    if (!Array.isArray(movements)) return [];
    if (movementType === "all") return movements as any[];
    return (movements as any[]).filter(m => m.type === movementType);
  }, [movements, movementType]);

  const agingData = aging as any;
  const bd = breakdown as any;

  return (
    <div className="p-6 space-y-6 max-w-screen-2xl mx-auto">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Wallet className="h-6 w-6 text-green-600" />
            Trésorerie & Finance
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Vue de gestion · Flux de trésorerie · Créances & Dettes
          </p>
        </div>
        {o && (
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold ${o.cashPosition >= 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
            {o.cashPosition >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            Position: {formatDA(Math.abs(o.cashPosition))} {o.cashPosition >= 0 ? "excédent" : "déficit"}
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
                    className={`text-xs h-8 px-2.5 ${activePreset === i ? "bg-green-700 hover:bg-green-800 border-green-700" : ""}`}
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
                <Label className="text-xs text-muted-foreground">Agence</Label>
                <Select value={branchId} onValueChange={setBranchId}>
                  <SelectTrigger className="h-8 text-xs w-40">
                    <SelectValue placeholder="Toutes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toutes les agences</SelectItem>
                    {(branches ?? []).map((b: any) => (
                      <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── KPI Cards ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          title="Entrées de trésorerie"
          value={o ? formatDA(o.inflow) : "—"}
          sub="Paiements reçus"
          icon={ArrowDownCircle}
          color="green"
          trend="up"
          loading={overviewLoading}
        />
        <KpiCard
          title="Sorties de trésorerie"
          value={o ? formatDA(o.outflow) : "—"}
          sub="Achats + Dépenses + Remb."
          icon={ArrowUpCircle}
          color="red"
          trend="down"
          loading={overviewLoading}
        />
        <KpiCard
          title="Position nette"
          value={o ? formatDA(Math.abs(o.cashPosition)) : "—"}
          sub={o ? (o.cashPosition >= 0 ? "Excédent" : "Déficit") : "—"}
          icon={Wallet}
          color={o?.cashPosition >= 0 ? "green" : "red"}
          loading={overviewLoading}
        />
        <KpiCard
          title="Créances clients"
          value={o ? formatDA(o.receivables) : "—"}
          sub={o ? `${o.receivablesCount} facture(s) en attente` : "—"}
          icon={FileText}
          color="amber"
          loading={overviewLoading}
        />
        <KpiCard
          title="Dettes fournisseurs"
          value={o ? formatDA(o.payables) : "—"}
          sub={o ? `${o.payablesCount} commande(s)` : "—"}
          icon={ShoppingCart}
          color="violet"
          loading={overviewLoading}
        />
        <KpiCard
          title="Résultat opérationnel"
          value={o ? formatDA(Math.abs(o.netResult)) : "—"}
          sub={o ? (o.netResult >= 0 ? "Bénéfice" : "Perte") : "—"}
          icon={o?.netResult >= 0 ? TrendingUp : TrendingDown}
          color={o?.netResult >= 0 ? "green" : "red"}
          loading={overviewLoading}
        />
      </div>

      {/* ── Cash flow trend + breakdown ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Trend chart */}
        <Card className="border-0 shadow-sm lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-green-600" />
              Flux de trésorerie — Entrées vs Sorties
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            {trendLoading ? (
              <div className="h-52 flex items-center justify-center text-xs text-muted-foreground">Chargement...</div>
            ) : Array.isArray(trend) && trend.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={trend as any[]}>
                  <defs>
                    <linearGradient id="colorIn" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorOut" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 9 }} interval={Math.ceil(((trend as any[]).length || 1) / 8) - 1} />
                  <YAxis tick={{ fontSize: 9 }} tickFormatter={v => fmtK(v)} width={45} />
                  <Tooltip content={<CashflowTooltip />} />
                  <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
                  <Area type="monotone" dataKey="inflow" name="Entrées" stroke="#10b981" fill="url(#colorIn)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="outflow" name="Sorties" stroke="#ef4444" fill="url(#colorOut)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="cumulative" name="Position cumulée" stroke="#d97706" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-52 flex items-center justify-center text-xs text-muted-foreground">Aucune donnée sur cette période</div>
            )}
          </CardContent>
        </Card>

        {/* Inflow/outflow breakdown pies */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-amber-600" />
              Décomposition des flux
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-3 space-y-4">
            {/* Inflows by method */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-green-700 mb-2">Entrées par mode</p>
              {bd?.inflows?.length > 0 ? (
                <div className="space-y-1.5">
                  {(bd.inflows as any[]).map((r: any) => (
                    <div key={r.method} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full" style={{ backgroundColor: (COLORS as any)[r.method] ?? "#94a3b8" }} />
                        <span className="text-muted-foreground">{r.label}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-medium text-green-700">{r.pct}%</span>
                        <span className="text-muted-foreground ml-1 text-[10px]">({fmtK(r.amount)})</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-muted-foreground">Aucune entrée</p>}
            </div>

            <div className="border-t border-border/50" />

            {/* Outflows by source */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-red-700 mb-2">Sorties par source</p>
              {bd?.outflows?.length > 0 ? (
                <div className="space-y-1.5">
                  {(bd.outflows as any[]).slice(0, 8).map((r: any, i: number) => (
                    <div key={i} className="space-y-0.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground truncate max-w-[120px]">{r.label}</span>
                        <div className="text-right">
                          <span className="font-medium text-red-700">{r.pct}%</span>
                          <span className="text-muted-foreground ml-1 text-[10px]">({fmtK(r.amount)})</span>
                        </div>
                      </div>
                      <Progress value={r.pct} className="h-1" />
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-muted-foreground">Aucune sortie</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Branch comparison ────────────────────────────────────────────────── */}
      {Array.isArray(branchData) && branchData.length > 1 && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Building2 className="h-4 w-4 text-violet-600" />
              Comparaison des agences
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs font-semibold">Agence</TableHead>
                  <TableHead className="text-xs font-semibold text-right text-green-700">Entrées</TableHead>
                  <TableHead className="text-xs font-semibold text-right text-red-700">Sorties</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Solde net</TableHead>
                  <TableHead className="text-xs font-semibold text-right text-amber-700">Créances</TableHead>
                  <TableHead className="text-xs font-semibold text-right">CA Facturé</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Dépenses</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(branchData as any[]).map((b, i) => (
                  <TableRow key={b.branchId}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: BRANCH_COLORS[i % BRANCH_COLORS.length] }} />
                        <span className="text-xs font-medium">{b.branchName}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-right font-semibold text-green-700">{formatDA(b.inflow)}</TableCell>
                    <TableCell className="text-xs text-right font-semibold text-red-700">{formatDA(b.outflow)}</TableCell>
                    <TableCell className="text-xs text-right">
                      <span className={b.net >= 0 ? "text-green-700 font-semibold" : "text-red-700 font-semibold"}>
                        {b.net >= 0 ? "+" : ""}{formatDA(b.net)}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-right text-amber-700">{formatDA(b.receivables)}</TableCell>
                    <TableCell className="text-xs text-right text-muted-foreground">{formatDA(b.revenue)}</TableCell>
                    <TableCell className="text-xs text-right text-muted-foreground">{formatDA(b.expenses)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ── Tabs: Aging / Movements ──────────────────────────────────────────── */}
      <Tabs defaultValue="aging">
        <TabsList className="h-8">
          <TabsTrigger value="aging" className="text-xs h-7 px-3">
            <Clock className="h-3.5 w-3.5 mr-1.5" />
            Échéances (Aging)
          </TabsTrigger>
          <TabsTrigger value="movements" className="text-xs h-7 px-3">
            <Banknote className="h-3.5 w-3.5 mr-1.5" />
            Mouvements récents
          </TabsTrigger>
          <TabsTrigger value="result" className="text-xs h-7 px-3">
            <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
            Compte de résultat
          </TabsTrigger>
        </TabsList>

        {/* ── Aging ───────────────────────────────────────────────────────────── */}
        <TabsContent value="aging">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Receivables aging */}
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <FileText className="h-4 w-4 text-amber-600" />
                  Créances clients — Ancienneté
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs font-semibold">Tranche</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Docs</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Montant</TableHead>
                      <TableHead className="text-xs font-semibold">Risque</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agingData?.receivables?.map((r: any) => (
                      <TableRow key={r.bucket}>
                        <TableCell className="text-xs font-medium">{r.label}</TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground">{r.count}</TableCell>
                        <TableCell className="text-xs text-right font-semibold text-amber-700">{formatDA(r.amount)}</TableCell>
                        <TableCell>
                          {r.risk === "critical" ? (
                            <Badge className="text-[10px] h-4 px-1.5 bg-red-100 text-red-700 border-red-200">Critique</Badge>
                          ) : r.risk === "warning" ? (
                            <Badge className="text-[10px] h-4 px-1.5 bg-amber-100 text-amber-700 border-amber-200">Risqué</Badge>
                          ) : (
                            <Badge className="text-[10px] h-4 px-1.5 bg-green-100 text-green-700 border-green-200">Normal</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    )) ?? (
                      <TableRow><TableCell colSpan={4} className="text-xs text-center text-muted-foreground py-4">Aucune créance</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Payables aging */}
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4 text-violet-600" />
                  Dettes fournisseurs — Ancienneté
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs font-semibold">Tranche</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Docs</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Montant</TableHead>
                      <TableHead className="text-xs font-semibold">Urgence</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agingData?.payables?.map((r: any) => (
                      <TableRow key={r.bucket}>
                        <TableCell className="text-xs font-medium">{r.label}</TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground">{r.count}</TableCell>
                        <TableCell className="text-xs text-right font-semibold text-violet-700">{formatDA(r.amount)}</TableCell>
                        <TableCell>
                          {r.risk === "critical" ? (
                            <Badge className="text-[10px] h-4 px-1.5 bg-red-100 text-red-700 border-red-200">Urgent</Badge>
                          ) : r.risk === "warning" ? (
                            <Badge className="text-[10px] h-4 px-1.5 bg-amber-100 text-amber-700 border-amber-200">À planifier</Badge>
                          ) : (
                            <Badge className="text-[10px] h-4 px-1.5 bg-green-100 text-green-700 border-green-200">OK</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    )) ?? (
                      <TableRow><TableCell colSpan={4} className="text-xs text-center text-muted-foreground py-4">Aucune dette</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Recent movements ────────────────────────────────────────────────── */}
        <TabsContent value="movements">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Mouvements de trésorerie récents</CardTitle>
                <Select value={movementType} onValueChange={setMovementType}>
                  <SelectTrigger className="h-7 text-xs w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les flux</SelectItem>
                    <SelectItem value="inflow">Entrées seulement</SelectItem>
                    <SelectItem value="outflow">Sorties seulement</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {filteredMovements.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs font-semibold w-20">Type</TableHead>
                      <TableHead className="text-xs font-semibold">Source</TableHead>
                      <TableHead className="text-xs font-semibold">Description</TableHead>
                      <TableHead className="text-xs font-semibold">Agence</TableHead>
                      <TableHead className="text-xs font-semibold">Mode</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Montant</TableHead>
                      <TableHead className="text-xs font-semibold">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredMovements.slice(0, 50).map((m: any) => (
                      <TableRow key={m.id}>
                        <TableCell>
                          {m.type === "inflow" ? (
                            <Badge className="text-[10px] h-4 px-1.5 bg-green-100 text-green-700 border-green-200">Entrée</Badge>
                          ) : (
                            <Badge className="text-[10px] h-4 px-1.5 bg-red-100 text-red-700 border-red-200">Sortie</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{m.source}</TableCell>
                        <TableCell className="text-xs font-medium max-w-[200px] truncate">{m.description}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{m.branchName}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{PAYMENT_LABELS[m.method] ?? m.method}</TableCell>
                        <TableCell className="text-xs text-right font-semibold">
                          <span className={m.type === "inflow" ? "text-green-700" : "text-red-700"}>
                            {m.type === "inflow" ? "+" : "−"}{formatDA(m.amount)}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmtDatetime(m.date)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">Aucun mouvement sur cette période</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── P&L summary ────────────────────────────────────────────────────── */}
        <TabsContent value="result">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Résultat opérationnel estimé</CardTitle>
              <p className="text-[11px] text-muted-foreground">Vue managériale simplifiée — non conforme aux normes comptables légales</p>
            </CardHeader>
            <CardContent>
              {o ? (
                <div className="max-w-sm space-y-1">
                  {[
                    { label: "Chiffre d'affaires facturé", amount: o.revenue, color: "text-green-700", bold: false },
                    { label: "− Coût des achats", amount: -o.purchCost, color: "text-red-700", bold: false },
                    { label: "= Marge brute", amount: o.revenue - o.purchCost, color: o.revenue - o.purchCost >= 0 ? "text-green-700" : "text-red-700", bold: true, border: true },
                    { label: "− Dépenses opérationnelles", amount: -o.outflowBreakdown?.expenses, color: "text-red-700", bold: false },
                    { label: "= Résultat opérationnel", amount: o.netResult, color: o.netResult >= 0 ? "text-green-700" : "text-red-700", bold: true, border: true },
                  ].map((row, i) => (
                    <div key={i} className={`flex justify-between py-1.5 text-sm ${row.border ? "border-t border-border mt-1 pt-2" : ""}`}>
                      <span className={`${row.bold ? "font-semibold" : "text-muted-foreground"}`}>{row.label}</span>
                      <span className={`font-mono ${row.color} ${row.bold ? "font-bold" : ""}`}>
                        {row.amount >= 0 ? "" : ""}
                        {formatDA(Math.abs(row.amount))}
                        {row.amount < 0 && row.label.startsWith("−") ? "" : ""}
                      </span>
                    </div>
                  ))}

                  <div className="mt-4 p-3 rounded-lg bg-muted/40 text-xs text-muted-foreground space-y-1">
                    <p className="font-semibold text-foreground">Flux réels de trésorerie (encaissement)</p>
                    <div className="flex justify-between">
                      <span>Entrées reçues</span>
                      <span className="text-green-700 font-semibold">+{formatDA(o.inflow)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Sorties payées</span>
                      <span className="text-red-700 font-semibold">−{formatDA(o.outflow)}</span>
                    </div>
                    <div className="flex justify-between border-t border-border pt-1 mt-1">
                      <span className="font-semibold">Position nette</span>
                      <span className={`font-bold ${o.cashPosition >= 0 ? "text-green-700" : "text-red-700"}`}>
                        {o.cashPosition >= 0 ? "+" : "−"}{formatDA(Math.abs(o.cashPosition))}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-800 space-y-1">
                    <p className="font-semibold flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Note importante</p>
                    <p>Ce résultat est une estimation managériale basée sur les ventes facturées et les achats/dépenses enregistrés. Il ne tient pas compte de l'amortissement, des provisions, ou des écritures comptables réglementaires.</p>
                  </div>
                </div>
              ) : (
                <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">Chargement...</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
