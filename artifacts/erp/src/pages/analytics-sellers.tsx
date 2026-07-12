import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch, useGetBranches } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  LineChart, Line, Legend, PieChart, Pie, Cell,
} from "recharts";
import {
  TrendingUp, ShoppingBag, Users, Banknote, CreditCard, Receipt,
  Medal, Trophy, Star, Package, Clock, BarChart3, RefreshCw,
  ArrowUpDown, ArrowUp, ArrowDown,
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

const SELLER_COLORS = [
  "#b45309","#6366f1","#10b981","#ec4899","#0ea5e9",
  "#f59e0b","#8b5cf6","#14b8a6","#f97316","#64748b",
];
const PAYMENT_LABELS: Record<string, string> = { cash: "Espèces", card: "Carte", credit: "Crédit" };
const PAYMENT_COLORS: Record<string, string> = { cash: "#d97706", card: "#6366f1", credit: "#8b5cf6" };

const DATE_PRESETS = [
  { label: "Auj.", from: () => format(new Date(), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "7j",   from: () => format(subDays(new Date(), 6), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "30j",  from: () => format(subDays(new Date(), 29), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "Mois", from: () => format(startOfMonth(new Date()), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "Année",from: () => format(startOfYear(new Date()), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
];

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ title, value, sub, icon: Icon, color = "amber" }: {
  title: string; value: string; sub?: string;
  icon: React.FC<{ className?: string }>;
  color?: "amber" | "green" | "blue" | "violet";
}) {
  const cfg = {
    amber:  { bg: "bg-amber-50",  ic: "text-amber-600"  },
    green:  { bg: "bg-green-50",  ic: "text-green-600"  },
    blue:   { bg: "bg-blue-50",   ic: "text-blue-600"   },
    violet: { bg: "bg-violet-50", ic: "text-violet-600" },
  }[color];
  return (
    <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg ${cfg.bg} shrink-0`}>
            <Icon className={`h-4 w-4 ${cfg.ic}`} />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground font-medium">{title}</p>
            <p className="text-xl font-bold leading-tight">{value}</p>
            {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Podium card ─────────────────────────────────────────────────────────────
function PodiumCard({ rank, name, revenue, sales, avgBasket, color }: {
  rank: number; name: string; revenue: number; sales: number; avgBasket: number; color: string;
}) {
  const medals = ["🥇", "🥈", "🥉"];
  const heights = ["h-28", "h-20", "h-16"];
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={`w-full ${heights[rank - 1]} rounded-t-xl flex flex-col items-center justify-center gap-1 text-white font-bold shadow-md`}
        style={{ background: color }}
      >
        <span className="text-2xl">{medals[rank - 1]}</span>
        <span className="text-xs text-white/90">#{rank}</span>
      </div>
      <div className="text-center px-1">
        <p className="text-sm font-bold truncate max-w-[90px]">{name}</p>
        <p className="text-xs font-semibold text-primary">{fmtDA(revenue)}</p>
        <p className="text-[10px] text-muted-foreground">{sales} ventes · {fmtDA(avgBasket)} moy.</p>
      </div>
    </div>
  );
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background border rounded-lg shadow-lg p-3 text-xs space-y-1 min-w-[140px]">
      <p className="font-semibold">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="font-medium">{typeof p.value === "number" && p.value > 100 ? fmtDA(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
interface SellerData {
  name: string;
  revenue: number;
  sales: number;
  items: number;
  avgBasket: number;
  paymentMethods: { cash: number; card: number; credit: number };
  daily: Record<string, { revenue: number; sales: number }>;
  hourly: number[];
  topProducts: { name: string; qty: number; revenue: number }[];
}

interface AnalyticsData {
  summary: { totalRevenue: number; totalSales: number; activeSellers: number; avgBasket: number };
  sellers: SellerData[];
  trend: Record<string, any>[];
}

export default function AnalyticsSellers() {
  const { user } = useAuth();

  const [from, setFrom] = useState(format(subDays(new Date(), 29), "yyyy-MM-dd"));
  const [to,   setTo]   = useState(format(new Date(), "yyyy-MM-dd"));
  const [branchId, setBranchId] = useState("all");
  const [activePreset, setActivePreset] = useState(2);
  const [selectedSeller, setSelectedSeller] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<"revenue"|"sales"|"avgBasket"|"items"|"cash"|"card"|"credit"|"name">("revenue");
  const [sortDir, setSortDir] = useState<"desc"|"asc">("desc");

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const { data: branches = [] } = useGetBranches();

  const qs = useMemo(() => {
    const p: Record<string, string> = { from, to };
    if (branchId !== "all") p.branchId = branchId;
    return new URLSearchParams(p).toString();
  }, [from, to, branchId]);

  const { data, isLoading, refetch } = useQuery<AnalyticsData>({
    queryKey: ["analytics-sellers", qs],
    queryFn: () => customFetch(`/api/analytics/sellers?${qs}`),
    staleTime: 60_000,
  });

  const sellers = data?.sellers ?? [];
  const summary = data?.summary ?? { totalRevenue: 0, totalSales: 0, activeSellers: 0, avgBasket: 0 };
  const trend = data?.trend ?? [];

  const sortedSellers = useMemo(() => {
    const arr = [...sellers];
    arr.sort((a, b) => {
      let va: number | string, vb: number | string;
      if      (sortKey === "name")    { va = a.name;                     vb = b.name; }
      else if (sortKey === "sales")   { va = a.sales;                    vb = b.sales; }
      else if (sortKey === "avgBasket"){ va = a.avgBasket;               vb = b.avgBasket; }
      else if (sortKey === "items")   { va = a.items;                    vb = b.items; }
      else if (sortKey === "cash")    { va = a.paymentMethods.cash;      vb = b.paymentMethods.cash; }
      else if (sortKey === "card")    { va = a.paymentMethods.card;      vb = b.paymentMethods.card; }
      else if (sortKey === "credit")  { va = a.paymentMethods.credit;    vb = b.paymentMethods.credit; }
      else                            { va = a.revenue;                  vb = b.revenue; }
      if (typeof va === "string") return sortDir === "asc" ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return sortDir === "asc" ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
    return arr;
  }, [sellers, sortKey, sortDir]);

  const sellerObj = selectedSeller ? sellers.find(s => s.name === selectedSeller) : null;

  function applyPreset(i: number) {
    setActivePreset(i);
    setFrom(DATE_PRESETS[i].from());
    setTo(DATE_PRESETS[i].to());
  }

  // Bar chart: CA per seller
  const barData = sellers.map((s, i) => ({
    name: s.name,
    "CA (DA)": Math.round(s.revenue),
    "Nb ventes": s.sales,
    fill: SELLER_COLORS[i % SELLER_COLORS.length],
  }));

  // Hourly chart for selected seller
  const hourlyData = sellerObj
    ? sellerObj.hourly.map((count, h) => ({ h: `${h}h`, ventes: count })).filter(d => d.ventes > 0)
    : [];

  // Payment pie for selected seller
  const paymentPie = sellerObj
    ? ["cash", "card", "credit"]
        .map(m => ({ name: PAYMENT_LABELS[m], value: sellerObj.paymentMethods[m as keyof typeof sellerObj.paymentMethods], color: PAYMENT_COLORS[m] }))
        .filter(d => d.value > 0)
    : [];

  // Trend lines colors
  const sellerNames = sellers.map(s => s.name);

  const maxRevenue = sellers[0]?.revenue || 1;

  return (
    <div className="space-y-6">
      {/* ─── Header ─── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-serif font-bold tracking-tight">Analytique Vendeurs</h1>
          <p className="text-muted-foreground text-sm">Performance et statistiques détaillées par vendeur</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
          <RefreshCw className="h-4 w-4" />Actualiser
        </Button>
      </div>

      {/* ─── Filters ─── */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-end">
            {/* Presets */}
            <div className="flex flex-wrap gap-1">
              {DATE_PRESETS.map((p, i) => (
                <Button
                  key={i} size="sm" variant={activePreset === i ? "default" : "outline"}
                  className="h-8 px-3 text-xs"
                  onClick={() => applyPreset(i)}
                >{p.label}</Button>
              ))}
            </div>
            <div className="flex gap-2 items-center">
              <Input type="date" className="h-8 text-xs w-36" value={from}
                onChange={e => { setFrom(e.target.value); setActivePreset(-1); }} />
              <span className="text-muted-foreground text-xs">→</span>
              <Input type="date" className="h-8 text-xs w-36" value={to}
                onChange={e => { setTo(e.target.value); setActivePreset(-1); }} />
            </div>
            {user?.adminAccess && (
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger className="h-8 text-xs w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes les boutiques</SelectItem>
                  {branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ─── KPI Cards ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={Banknote} color="amber" title="CA Total" value={fmtDA(summary.totalRevenue)} sub="toutes périodes filtrées" />
        <KpiCard icon={ShoppingBag} color="green" title="Nb Ventes" value={String(summary.totalSales)} sub="transactions confirmées" />
        <KpiCard icon={Users} color="blue" title="Vendeurs actifs" value={String(summary.activeSellers)} sub="avec au moins 1 vente" />
        <KpiCard icon={TrendingUp} color="violet" title="Panier moyen" value={fmtDA(summary.avgBasket)} sub="valeur moy. par vente" />
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-32 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && sellers.length === 0 && (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-16 text-center text-muted-foreground">
            <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Aucune vente avec vendeur sur cette période</p>
            <p className="text-sm mt-1">Ajoutez des vendeurs aux boutiques et effectuez des ventes depuis le POS.</p>
          </CardContent>
        </Card>
      )}

      {!isLoading && sellers.length > 0 && (
        <>
          {/* ─── Podium Top 3 ─── */}
          {sellers.length >= 2 && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-amber-500" />Podium — Meilleurs vendeurs
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end justify-center gap-4 pt-2 pb-4">
                  {/* Arrange: 2nd, 1st, 3rd */}
                  {[1, 0, 2].filter(i => sellers[i]).map(i => (
                    <div key={i} className="flex-1 max-w-[120px]">
                      <PodiumCard
                        rank={i + 1}
                        name={sellers[i].name}
                        revenue={sellers[i].revenue}
                        sales={sellers[i].sales}
                        avgBasket={sellers[i].avgBasket}
                        color={SELLER_COLORS[i % SELLER_COLORS.length]}
                      />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ─── Main Charts ─── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* CA par vendeur */}
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />CA par vendeur
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={barData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={fmtK} width={44} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="CA (DA)" radius={[4, 4, 0, 0]}>
                      {barData.map((d, i) => (
                        <Cell key={i} fill={SELLER_COLORS[i % SELLER_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Nb ventes par vendeur */}
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <ShoppingBag className="h-4 w-4 text-green-600" />Nombre de ventes par vendeur
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={barData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 10 }} width={32} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="Nb ventes" radius={[4, 4, 0, 0]}>
                      {barData.map((d, i) => (
                        <Cell key={i} fill={SELLER_COLORS[i % SELLER_COLORS.length]} opacity={0.75} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* ─── Trend multi-line ─── */}
          {trend.length > 1 && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-indigo-500" />Évolution du CA par vendeur
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={trend} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }}
                      tickFormatter={d => { try { return format(new Date(d), "dd/MM", { locale: fr }); } catch { return d; } }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={fmtK} width={44} />
                    <Tooltip content={<ChartTooltip />}
                      labelFormatter={l => { try { return format(new Date(l), "dd MMM yyyy", { locale: fr }); } catch { return l; } }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {sellerNames.map((name, i) => (
                      <Line key={name} type="monotone" dataKey={name}
                        stroke={SELLER_COLORS[i % SELLER_COLORS.length]}
                        strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* ─── Ranking table ─── */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Medal className="h-4 w-4 text-amber-500" />Classement complet
                <span className="text-xs font-normal text-muted-foreground ml-2">
                  Cliquez sur un en-tête pour trier · Cliquez sur un vendeur pour ses détails
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="w-10">#</TableHead>
                    {(["name","revenue","sales","avgBasket","items","cash","card","credit"] as const).map(k => {
                      const labels: Record<string, string> = {
                        name: "Vendeur", revenue: "CA", sales: "Ventes",
                        avgBasket: "Panier moy.", items: "Articles",
                        cash: "Espèces", card: "Carte", credit: "Crédit",
                      };
                      const isActive = sortKey === k;
                      const Icon = isActive ? (sortDir === "desc" ? ArrowDown : ArrowUp) : ArrowUpDown;
                      return (
                        <TableHead
                          key={k}
                          className={`${k !== "name" ? "text-right" : ""} cursor-pointer select-none hover:bg-muted/50 transition-colors`}
                          onClick={() => toggleSort(k)}
                        >
                          <div className={`flex items-center gap-1 ${k !== "name" ? "justify-end" : ""}`}>
                            <span>{labels[k]}</span>
                            <Icon className={`h-3 w-3 ${isActive ? "text-primary" : "text-muted-foreground/50"}`} />
                          </div>
                        </TableHead>
                      );
                    })}
                    <TableHead className="text-right w-20">Part CA</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedSellers.map((s, i) => {
                    const origRank = sellers.findIndex(x => x.name === s.name);
                    const pct = summary.totalRevenue > 0 ? (s.revenue / summary.totalRevenue) * 100 : 0;
                    const isSelected = selectedSeller === s.name;
                    return (
                      <TableRow
                        key={s.name}
                        className={`cursor-pointer transition-colors ${isSelected ? "bg-primary/5 border-l-4 border-primary" : "hover:bg-muted/30"}`}
                        onClick={() => setSelectedSeller(isSelected ? null : s.name)}
                      >
                        <TableCell className="font-bold text-muted-foreground text-xs">
                          {origRank === 0 ? "🥇" : origRank === 1 ? "🥈" : origRank === 2 ? "🥉" : origRank + 1}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: SELLER_COLORS[origRank % SELLER_COLORS.length] }} />
                            <span className="font-medium">{s.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-semibold text-primary">{fmtDA(s.revenue)}</TableCell>
                        <TableCell className="text-right">{s.sales}</TableCell>
                        <TableCell className="text-right">{fmtDA(s.avgBasket)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{Math.round(s.items)}</TableCell>
                        <TableCell className="text-right">
                          {s.paymentMethods.cash > 0 && <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">{s.paymentMethods.cash}</Badge>}
                        </TableCell>
                        <TableCell className="text-right">
                          {s.paymentMethods.card > 0 && <Badge variant="outline" className="text-[10px] bg-indigo-50 text-indigo-700 border-indigo-200">{s.paymentMethods.card}</Badge>}
                        </TableCell>
                        <TableCell className="text-right">
                          {s.paymentMethods.credit > 0 && <Badge variant="outline" className="text-[10px] bg-violet-50 text-violet-700 border-violet-200">{s.paymentMethods.credit}</Badge>}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center gap-1.5 justify-end">
                            <Progress value={pct} className="w-12 h-1.5" />
                            <span className="text-[10px] text-muted-foreground w-8 text-right">{pct.toFixed(1)}%</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* ─── Selected seller detail ─── */}
          {sellerObj && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full" style={{ background: SELLER_COLORS[sellers.findIndex(s => s.name === sellerObj.name) % SELLER_COLORS.length] }} />
                <h2 className="text-lg font-bold">{sellerObj.name} — Détails</h2>
                <Button variant="ghost" size="sm" className="text-muted-foreground text-xs" onClick={() => setSelectedSeller(null)}>✕ Fermer</Button>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Card className="border-0 shadow-sm bg-amber-50">
                  <CardContent className="p-4 text-center">
                    <p className="text-xs text-amber-700 font-medium">CA Total</p>
                    <p className="text-xl font-bold text-amber-800">{fmtDA(sellerObj.revenue)}</p>
                  </CardContent>
                </Card>
                <Card className="border-0 shadow-sm bg-green-50">
                  <CardContent className="p-4 text-center">
                    <p className="text-xs text-green-700 font-medium">Ventes</p>
                    <p className="text-xl font-bold text-green-800">{sellerObj.sales}</p>
                  </CardContent>
                </Card>
                <Card className="border-0 shadow-sm bg-blue-50">
                  <CardContent className="p-4 text-center">
                    <p className="text-xs text-blue-700 font-medium">Panier moyen</p>
                    <p className="text-xl font-bold text-blue-800">{fmtDA(sellerObj.avgBasket)}</p>
                  </CardContent>
                </Card>
                <Card className="border-0 shadow-sm bg-violet-50">
                  <CardContent className="p-4 text-center">
                    <p className="text-xs text-violet-700 font-medium">Articles vendus</p>
                    <p className="text-xl font-bold text-violet-800">{Math.round(sellerObj.items)}</p>
                  </CardContent>
                </Card>
              </div>

              <Tabs defaultValue="products">
                <TabsList className="h-9">
                  <TabsTrigger value="products" className="text-xs gap-1"><Package className="h-3.5 w-3.5" />Top Produits</TabsTrigger>
                  <TabsTrigger value="hours" className="text-xs gap-1"><Clock className="h-3.5 w-3.5" />Heures actives</TabsTrigger>
                  <TabsTrigger value="payment" className="text-xs gap-1"><CreditCard className="h-3.5 w-3.5" />Paiements</TabsTrigger>
                  <TabsTrigger value="daily" className="text-xs gap-1"><TrendingUp className="h-3.5 w-3.5" />Évolution</TabsTrigger>
                </TabsList>

                {/* Top Products */}
                <TabsContent value="products">
                  <Card className="border-0 shadow-sm">
                    <CardContent className="p-4">
                      {sellerObj.topProducts.length === 0 ? (
                        <p className="text-center text-muted-foreground text-sm py-8">Aucun produit trouvé</p>
                      ) : (
                        <div className="space-y-3">
                          {sellerObj.topProducts.map((p, i) => {
                            const pct = sellerObj.topProducts[0]?.revenue > 0 ? (p.revenue / sellerObj.topProducts[0].revenue) * 100 : 0;
                            return (
                              <div key={i} className="flex items-center gap-3">
                                <span className="text-xs font-bold text-muted-foreground w-5">#{i + 1}</span>
                                <div className="flex-1 min-w-0">
                                  <div className="flex justify-between text-sm mb-1">
                                    <span className="font-medium truncate">{p.name}</span>
                                    <span className="text-primary font-semibold ml-2 shrink-0">{fmtDA(p.revenue)}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Progress value={pct} className="flex-1 h-1.5" />
                                    <span className="text-[10px] text-muted-foreground shrink-0">{Math.round(p.qty)} unités</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Hours */}
                <TabsContent value="hours">
                  <Card className="border-0 shadow-sm">
                    <CardContent className="p-4">
                      {hourlyData.length === 0 ? (
                        <p className="text-center text-muted-foreground text-sm py-8">Aucune donnée horaire</p>
                      ) : (
                        <ResponsiveContainer width="100%" height={200}>
                          <BarChart data={hourlyData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                            <XAxis dataKey="h" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} width={28} />
                            <Tooltip content={<ChartTooltip />} />
                            <Bar dataKey="ventes" fill="#b45309" radius={[3, 3, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Payment methods */}
                <TabsContent value="payment">
                  <Card className="border-0 shadow-sm">
                    <CardContent className="p-4">
                      {paymentPie.length === 0 ? (
                        <p className="text-center text-muted-foreground text-sm py-8">Aucune donnée</p>
                      ) : (
                        <div className="flex flex-col sm:flex-row items-center gap-8">
                          <ResponsiveContainer width={180} height={180}>
                            <PieChart>
                              <Pie data={paymentPie} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={3}>
                                {paymentPie.map((d, i) => <Cell key={i} fill={d.color} />)}
                              </Pie>
                              <Tooltip formatter={(v: any) => [`${v} vente(s)`, ""]} />
                            </PieChart>
                          </ResponsiveContainer>
                          <div className="space-y-3 flex-1">
                            {paymentPie.map((d, i) => (
                              <div key={i} className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <div className="w-3 h-3 rounded-full" style={{ background: d.color }} />
                                  <span className="text-sm font-medium">{d.name}</span>
                                </div>
                                <div className="text-right">
                                  <span className="font-bold text-sm">{d.value}</span>
                                  <span className="text-xs text-muted-foreground ml-1">
                                    ({sellerObj.sales > 0 ? ((d.value / sellerObj.sales) * 100).toFixed(0) : 0}%)
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Daily evolution */}
                <TabsContent value="daily">
                  <Card className="border-0 shadow-sm">
                    <CardContent className="p-4">
                      {(() => {
                        const dailyArr = Object.entries(sellerObj.daily)
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([date, d]) => ({
                            date,
                            CA: Math.round(d.revenue),
                            ventes: d.sales,
                          }));
                        if (dailyArr.length < 2) return (
                          <p className="text-center text-muted-foreground text-sm py-8">Pas assez de données pour l'évolution</p>
                        );
                        return (
                          <ResponsiveContainer width="100%" height={220}>
                            <LineChart data={dailyArr} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                              <XAxis dataKey="date" tick={{ fontSize: 10 }}
                                tickFormatter={d => { try { return format(new Date(d), "dd/MM"); } catch { return d; } }} />
                              <YAxis yAxisId="ca" tick={{ fontSize: 10 }} tickFormatter={fmtK} width={44} />
                              <YAxis yAxisId="nb" orientation="right" tick={{ fontSize: 10 }} width={28} />
                              <Tooltip content={<ChartTooltip />}
                                labelFormatter={l => { try { return format(new Date(l), "dd MMM yyyy", { locale: fr }); } catch { return l; } }} />
                              <Legend wrapperStyle={{ fontSize: 11 }} />
                              <Line yAxisId="ca" type="monotone" dataKey="CA" stroke="#b45309" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                              <Line yAxisId="nb" type="monotone" dataKey="ventes" stroke="#6366f1" strokeWidth={1.5} strokeDasharray="4 2" dot={false} activeDot={{ r: 3 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        );
                      })()}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </>
      )}
    </div>
  );
}
