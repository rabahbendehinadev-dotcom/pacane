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
  CartesianGrid, Cell, PieChart, Pie, Legend,
} from "recharts";
import {
  ShoppingCart, TrendingUp, TrendingDown, Package, Truck, Store, Users,
  CreditCard, AlertTriangle, CheckCircle2, Clock, BarChart3, Download,
  Filter, ArrowUpRight, Building2, Star,
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
function fmtDateFull(d: string | Date) {
  try { return format(new Date(d), "dd/MM/yyyy", { locale: fr }); } catch { return "—"; }
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  draft:     { label: "Brouillon",   cls: "bg-slate-100 text-slate-700" },
  confirmed: { label: "Confirmée",   cls: "bg-blue-100 text-blue-700" },
  partial:   { label: "Partielle",   cls: "bg-amber-100 text-amber-700" },
  received:  { label: "Réceptionnée",cls: "bg-green-100 text-green-700" },
  cancelled: { label: "Annulée",     cls: "bg-red-100 text-red-700" },
};
const PAYMENT_STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  unpaid:  { label: "Impayée",     cls: "bg-red-100 text-red-700" },
  partial: { label: "Part. payée", cls: "bg-amber-100 text-amber-700" },
  paid:    { label: "Soldée",      cls: "bg-green-100 text-green-700" },
};

const BRANCH_COLORS = ["#10b981", "#6366f1", "#f59e0b", "#ef4444", "#8b5cf6", "#0ea5e9"];
const DATE_PRESETS = [
  { label: "7j",   from: () => format(subDays(new Date(), 6), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "30j",  from: () => format(subDays(new Date(), 29), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "Ce mois", from: () => format(startOfMonth(new Date()), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "Cette année", from: () => format(startOfYear(new Date()), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "Tout", from: () => "2023-01-01", to: () => format(new Date(), "yyyy-MM-dd") },
];

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ title, value, sub, icon: Icon, color = "blue", loading = false }: {
  title: string; value: string; sub?: string;
  icon: React.FC<{ className?: string }>;
  color?: "green" | "red" | "amber" | "blue" | "violet" | "indigo";
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
              <p className="text-xl font-bold leading-tight">{value}</p>
            )}
            {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background border border-border rounded-lg shadow-lg p-3 text-xs space-y-1">
      <p className="font-semibold">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }}>{p.name}: {typeof p.value === "number" && p.value > 1000 ? fmtDA(p.value) : p.value}</p>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function AnalyticsPurchases() {
  const { user } = useAuth();
  const isAdmin = user?.adminAccess;

  const [from, setFrom] = useState(format(subDays(new Date(), 29), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [branchId, setBranchId] = useState("all");
  const [supplierId, setSupplierId] = useState("all");
  const [status, setStatus] = useState("all");
  const [paymentStatus, setPaymentStatus] = useState("all");
  const [activePreset, setActivePreset] = useState(1);
  const [receptionFilter, setReceptionFilter] = useState("all");

  const { data: branches } = useGetBranches();

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (from) p.from = from;
    if (to) p.to = to;
    if (branchId !== "all") p.branchId = branchId;
    if (supplierId !== "all") p.supplierId = supplierId;
    if (status !== "all") p.status = status;
    if (paymentStatus !== "all") p.paymentStatus = paymentStatus;
    return p;
  }, [from, to, branchId, supplierId, status, paymentStatus]);

  const qs = new URLSearchParams(params).toString();

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ["ap-kpis", qs],
    queryFn: () => customFetch(`/api/analytics/purchases/kpis?${qs}`),
  });

  const { data: trend, isLoading: trendLoading } = useQuery({
    queryKey: ["ap-trend", qs],
    queryFn: () => customFetch(`/api/analytics/purchases/trend?${qs}`),
  });

  const { data: suppliers } = useQuery({
    queryKey: ["ap-suppliers", qs],
    queryFn: () => customFetch(`/api/analytics/purchases/suppliers?${qs}`),
  });

  const { data: receptionData } = useQuery({
    queryKey: ["ap-reception", qs],
    queryFn: () => customFetch(`/api/analytics/purchases/reception?${qs}`),
  });

  const { data: branchData } = useQuery({
    queryKey: ["ap-branches", qs],
    queryFn: () => customFetch(`/api/analytics/purchases/branches?${qs}`),
  });

  const { data: orders } = useQuery({
    queryKey: ["ap-orders", qs],
    queryFn: () => customFetch(`/api/analytics/purchases/orders?${qs}`),
  });

  const { data: products } = useQuery({
    queryKey: ["ap-products", qs],
    queryFn: () => customFetch(`/api/analytics/purchases/products?${qs}`),
  });

  const k = kpis as any;
  const rd = receptionData as any;
  const showBranchFilter = isAdmin || (user?.branchIds && user.branchIds.length > 1);

  const applyPreset = (i: number) => {
    const p = DATE_PRESETS[i];
    setFrom(p.from());
    setTo(p.to());
    setActivePreset(i);
  };

  // Unique suppliers for filter dropdown
  const supplierOptions = useMemo(() => {
    const s = suppliers as any[];
    if (!Array.isArray(s)) return [];
    return s.map((x: any) => ({ id: x.supplierId, name: x.supplierName }));
  }, [suppliers]);

  const filteredOrders = useMemo(() => {
    if (!Array.isArray(orders)) return [];
    if (receptionFilter === "all") return orders as any[];
    return (orders as any[]).filter((o: any) => {
      if (receptionFilter === "pending") return ["confirmed", "partial"].includes(o.status);
      if (receptionFilter === "received") return o.status === "received";
      if (receptionFilter === "draft") return o.status === "draft";
      return true;
    });
  }, [orders, receptionFilter]);

  const filteredReceptions = useMemo(() => {
    if (!rd?.orders) return [];
    if (receptionFilter === "all") return rd.orders;
    return rd.orders.filter((o: any) => {
      if (receptionFilter === "complete") return o.completionStatus === "complete";
      if (receptionFilter === "partial") return o.completionStatus === "partial";
      if (receptionFilter === "pending") return o.completionStatus === "pending";
      return true;
    });
  }, [rd, receptionFilter]);

  const handleCsvExport = () => {
    const qsExport = new URLSearchParams({ ...params, _t: Date.now().toString() }).toString();
    window.open(`/api/export/purchases?${qsExport}`, "_blank");
  };

  return (
    <div className="p-6 space-y-6 max-w-screen-2xl mx-auto">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShoppingCart className="h-6 w-6 text-violet-600" />
            Analytique Achats & Approvisionnement
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Performance fournisseurs · Réception · Flux d'achats
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-2" onClick={handleCsvExport}>
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </Button>
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-end">
            {/* Presets */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Période</Label>
              <div className="flex gap-1">
                {DATE_PRESETS.map((p, i) => (
                  <Button
                    key={i}
                    variant={activePreset === i ? "default" : "outline"}
                    size="sm"
                    className={`text-xs h-8 px-2.5 ${activePreset === i ? "bg-violet-700 hover:bg-violet-800 border-violet-700" : ""}`}
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
            {supplierOptions.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Fournisseur</Label>
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger className="h-8 text-xs w-44">
                    <SelectValue placeholder="Tous" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les fournisseurs</SelectItem>
                    {supplierOptions.map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
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
                  <SelectItem value="all">Tous les statuts</SelectItem>
                  <SelectItem value="draft">Brouillon</SelectItem>
                  <SelectItem value="confirmed">Confirmée</SelectItem>
                  <SelectItem value="partial">Partielle</SelectItem>
                  <SelectItem value="received">Réceptionnée</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Paiement</Label>
              <Select value={paymentStatus} onValueChange={setPaymentStatus}>
                <SelectTrigger className="h-8 text-xs w-36">
                  <SelectValue placeholder="Tous" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous</SelectItem>
                  <SelectItem value="unpaid">Impayée</SelectItem>
                  <SelectItem value="partial">Part. payée</SelectItem>
                  <SelectItem value="paid">Soldée</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── KPI Cards ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          title="Volume total achats"
          value={k ? fmtDA(k.totalVolume) : "—"}
          sub={k ? `${k.orderCount} commande(s)` : "—"}
          icon={ShoppingCart} color="violet" loading={kpisLoading}
        />
        <KpiCard
          title="Valeur réceptionnée"
          value={k ? fmtDA(k.receivedValue) : "—"}
          sub="Commandes réceptionnées"
          icon={CheckCircle2} color="green" loading={kpisLoading}
        />
        <KpiCard
          title="En attente de réception"
          value={k ? fmtDA(k.pendingValue) : "—"}
          sub={k ? `${k.pendingCount} commande(s) active(s)` : "—"}
          icon={Truck} color="amber" loading={kpisLoading}
        />
        <KpiCard
          title="Solde impayé fournisseurs"
          value={k ? fmtDA(k.unpaidBalance) : "—"}
          sub={k ? `${k.paymentRate}% réglé` : "—"}
          icon={CreditCard} color="red" loading={kpisLoading}
        />
        <KpiCard
          title="Valeur moy. commande"
          value={k ? fmtDA(k.avgOrderValue) : "—"}
          sub="Hors brouillons"
          icon={BarChart3} color="blue" loading={kpisLoading}
        />
        <KpiCard
          title="Fournisseurs actifs"
          value={k ? String(k.supplierCount) : "—"}
          sub="Sur la période"
          icon={Users} color="indigo" loading={kpisLoading}
        />
      </div>

      {/* ── Trend chart + Reception summary ─────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Trend area chart */}
        <Card className="border-0 shadow-sm lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-violet-600" />
              Évolution des achats — Volume commandé vs Réceptionné
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            {trendLoading ? (
              <div className="h-52 flex items-center justify-center text-xs text-muted-foreground">Chargement...</div>
            ) : Array.isArray(trend) && trend.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={trend as any[]}>
                  <defs>
                    <linearGradient id="gradVolume" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradReceived" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={fmtDate}
                    tick={{ fontSize: 9 }}
                    interval={Math.ceil(((trend as any[]).length || 1) / 8) - 1}
                  />
                  <YAxis tick={{ fontSize: 9 }} tickFormatter={v => fmtK(v)} width={50} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="volume" name="Commandé" stroke="#8b5cf6" fill="url(#gradVolume)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="received" name="Réceptionné" stroke="#10b981" fill="url(#gradReceived)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-52 flex items-center justify-center text-xs text-muted-foreground">Aucune donnée sur cette période</div>
            )}
          </CardContent>
        </Card>

        {/* Reception donut + summary */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Truck className="h-4 w-4 text-amber-600" />
              Statut de réception
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            {rd?.summary ? (
              <>
                <ResponsiveContainer width="100%" height={120}>
                  <PieChart>
                    <Pie
                      data={rd.summary}
                      cx="50%" cy="50%"
                      innerRadius={35} outerRadius={52}
                      dataKey="count"
                      nameKey="label"
                    >
                      {rd.summary.map((s: any, i: number) => (
                        <Cell key={i} fill={s.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: any, n: any) => [v + " cmd", n]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2 mt-2">
                  {rd.summary.map((s: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                        <span className="text-muted-foreground">{s.label}</span>
                      </div>
                      <span className="font-semibold">{s.count} <span className="text-muted-foreground font-normal">cmd</span></span>
                    </div>
                  ))}
                  <div className="border-t border-border pt-1.5 mt-1.5 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground font-medium">Total analysé</span>
                    <span className="font-bold">{rd.total}</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">Aucune donnée</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Branch comparison bar chart ─────────────────────────────────────── */}
      {Array.isArray(branchData) && (branchData as any[]).length > 1 && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Building2 className="h-4 w-4 text-blue-600" />
              Achats par agence
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={branchData as any[]}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="branchName" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 9 }} tickFormatter={v => fmtK(v)} width={50} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="volume" name="Volume" radius={[3, 3, 0, 0]}>
                    {(branchData as any[]).map((_, i) => (
                      <Cell key={i} fill={BRANCH_COLORS[i % BRANCH_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>

              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs font-semibold">Agence</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Volume</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Commandes</TableHead>
                    <TableHead className="text-xs font-semibold text-right text-red-700">Impayé</TableHead>
                    <TableHead className="text-xs font-semibold text-right text-amber-700">En attente</TableHead>
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
                      <TableCell className="text-xs text-right font-semibold">{fmtDA(b.volume)}</TableCell>
                      <TableCell className="text-xs text-right text-muted-foreground">{b.orderCount}</TableCell>
                      <TableCell className="text-xs text-right text-red-700 font-medium">{fmtDA(b.pendingBalance)}</TableCell>
                      <TableCell className="text-xs text-right">
                        {b.pendingReception > 0 ? (
                          <Badge className="text-[10px] h-4 px-1.5 bg-amber-100 text-amber-700 border-amber-200">{b.pendingReception} cmd</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Tabs: Suppliers / Reception / Products / Orders ─────────────────── */}
      <Tabs defaultValue="suppliers">
        <TabsList className="h-8">
          <TabsTrigger value="suppliers" className="text-xs h-7 px-3">
            <Users className="h-3.5 w-3.5 mr-1.5" />
            Fournisseurs
          </TabsTrigger>
          <TabsTrigger value="reception" className="text-xs h-7 px-3">
            <Truck className="h-3.5 w-3.5 mr-1.5" />
            Réception
          </TabsTrigger>
          <TabsTrigger value="products" className="text-xs h-7 px-3">
            <Package className="h-3.5 w-3.5 mr-1.5" />
            Produits achetés
          </TabsTrigger>
          <TabsTrigger value="orders" className="text-xs h-7 px-3">
            <ShoppingCart className="h-3.5 w-3.5 mr-1.5" />
            Commandes
          </TabsTrigger>
        </TabsList>

        {/* ── Suppliers ───────────────────────────────────────────────────────── */}
        <TabsContent value="suppliers">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Star className="h-4 w-4 text-amber-500" />
                Classement fournisseurs
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {Array.isArray(suppliers) && (suppliers as any[]).length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs font-semibold w-8">#</TableHead>
                      <TableHead className="text-xs font-semibold">Fournisseur</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Volume total</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Commandes</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Valeur moy.</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Taux livraison</TableHead>
                      <TableHead className="text-xs font-semibold text-right text-red-700">Solde dû</TableHead>
                      <TableHead className="text-xs font-semibold">Part</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(suppliers as any[]).map((s, i) => {
                      const totalVol = (suppliers as any[]).reduce((a, x) => a + x.volume, 0);
                      const pct = totalVol > 0 ? Math.round((s.volume / totalVol) * 100) : 0;
                      return (
                        <TableRow key={s.supplierId}>
                          <TableCell className="text-xs text-muted-foreground font-mono">{i + 1}</TableCell>
                          <TableCell className="text-xs font-semibold">{s.supplierName}</TableCell>
                          <TableCell className="text-xs text-right font-bold text-violet-700">{fmtDA(s.volume)}</TableCell>
                          <TableCell className="text-xs text-right text-muted-foreground">{s.orderCount}</TableCell>
                          <TableCell className="text-xs text-right text-muted-foreground">{fmtDA(s.avgOrderValue)}</TableCell>
                          <TableCell className="text-xs text-right">
                            <span className={`font-semibold ${s.deliveryRate >= 80 ? "text-green-700" : s.deliveryRate >= 50 ? "text-amber-700" : "text-red-700"}`}>
                              {s.deliveryRate}%
                            </span>
                          </TableCell>
                          <TableCell className="text-xs text-right">
                            {s.pendingBalance > 0 ? (
                              <span className="text-red-700 font-semibold">{fmtDA(s.pendingBalance)}</span>
                            ) : (
                              <span className="text-green-700 text-[10px]">Soldé</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5 min-w-[60px]">
                              <Progress value={pct} className="h-1.5 flex-1" />
                              <span className="text-[10px] text-muted-foreground w-7 shrink-0">{pct}%</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">Aucun fournisseur sur cette période</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Reception ───────────────────────────────────────────────────────── */}
        <TabsContent value="reception">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Suivi des réceptions — Commandé vs Reçu</CardTitle>
                <Select value={receptionFilter} onValueChange={setReceptionFilter}>
                  <SelectTrigger className="h-7 text-xs w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toutes</SelectItem>
                    <SelectItem value="complete">Complètes</SelectItem>
                    <SelectItem value="partial">Partielles</SelectItem>
                    <SelectItem value="pending">En attente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {filteredReceptions.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs font-semibold">Référence</TableHead>
                      <TableHead className="text-xs font-semibold">Fournisseur</TableHead>
                      <TableHead className="text-xs font-semibold">Agence</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Commandé</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Reçu</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Restant</TableHead>
                      <TableHead className="text-xs font-semibold">Complétion</TableHead>
                      <TableHead className="text-xs font-semibold">Réception</TableHead>
                      <TableHead className="text-xs font-semibold">Paiement</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredReceptions.slice(0, 50).map((o: any) => {
                      const rcSt = STATUS_LABELS[o.status] ?? { label: o.status, cls: "bg-slate-100 text-slate-700" };
                      const pmSt = PAYMENT_STATUS_LABELS[o.paymentStatus] ?? { label: o.paymentStatus, cls: "bg-slate-100 text-slate-700" };
                      return (
                        <TableRow key={o.purchaseId}>
                          <TableCell className="text-xs font-mono font-semibold">{o.reference}</TableCell>
                          <TableCell className="text-xs">{o.supplierName}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{o.branchName}</TableCell>
                          <TableCell className="text-xs text-right font-mono">{o.orderedQty.toFixed(0)}</TableCell>
                          <TableCell className="text-xs text-right font-mono text-green-700">{o.receivedQty.toFixed(0)}</TableCell>
                          <TableCell className="text-xs text-right font-mono text-amber-700">{o.remainingQty.toFixed(0)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5 min-w-[70px]">
                              <Progress
                                value={o.receptionPct}
                                className={`h-1.5 flex-1 ${o.receptionPct >= 100 ? "[&>div]:bg-green-500" : o.receptionPct > 0 ? "[&>div]:bg-amber-400" : "[&>div]:bg-slate-300"}`}
                              />
                              <span className="text-[10px] text-muted-foreground w-7 shrink-0">{o.receptionPct}%</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge className={`text-[10px] h-4 px-1.5 border ${rcSt.cls}`}>{rcSt.label}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge className={`text-[10px] h-4 px-1.5 border ${pmSt.cls}`}>{pmSt.label}</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">Aucune commande sur cette période</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Top products ────────────────────────────────────────────────────── */}
        <TabsContent value="products">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Package className="h-4 w-4 text-blue-600" />
                Top produits achetés — par coût total
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {Array.isArray(products) && (products as any[]).length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs font-semibold w-8">#</TableHead>
                      <TableHead className="text-xs font-semibold">Produit</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Coût total</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Qté commandée</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Qté reçue</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Coût moy. unitaire</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Commandes</TableHead>
                      <TableHead className="text-xs font-semibold">Réception</TableHead>
                      <TableHead className="text-xs font-semibold">Part</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(products as any[]).map((p, i) => {
                      const totalCost = (products as any[]).reduce((a, x) => a + x.totalCost, 0);
                      const pct = totalCost > 0 ? Math.round((p.totalCost / totalCost) * 100) : 0;
                      return (
                        <TableRow key={p.productId}>
                          <TableCell className="text-xs text-muted-foreground font-mono">{i + 1}</TableCell>
                          <TableCell className="text-xs font-semibold">{p.productName}</TableCell>
                          <TableCell className="text-xs text-right font-bold text-violet-700">{fmtDA(p.totalCost)}</TableCell>
                          <TableCell className="text-xs text-right font-mono">{p.totalQty.toFixed(0)}</TableCell>
                          <TableCell className="text-xs text-right font-mono text-green-700">{p.receivedQty.toFixed(0)}</TableCell>
                          <TableCell className="text-xs text-right text-muted-foreground">{fmtDA(p.avgUnitCost)}</TableCell>
                          <TableCell className="text-xs text-right text-muted-foreground">{p.orderCount}</TableCell>
                          <TableCell>
                            <span className={`text-xs font-semibold ${p.receptionRate >= 80 ? "text-green-700" : p.receptionRate >= 40 ? "text-amber-700" : "text-red-700"}`}>
                              {p.receptionRate}%
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5 min-w-[60px]">
                              <Progress value={pct} className="h-1.5 flex-1" />
                              <span className="text-[10px] text-muted-foreground w-7 shrink-0">{pct}%</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">Aucun produit sur cette période</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── All orders ──────────────────────────────────────────────────────── */}
        <TabsContent value="orders">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Commandes d'achats récentes</CardTitle>
                <Select value={receptionFilter} onValueChange={setReceptionFilter}>
                  <SelectTrigger className="h-7 text-xs w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toutes</SelectItem>
                    <SelectItem value="pending">En attente réception</SelectItem>
                    <SelectItem value="received">Réceptionnées</SelectItem>
                    <SelectItem value="draft">Brouillons</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {filteredOrders.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs font-semibold">Référence</TableHead>
                      <TableHead className="text-xs font-semibold">Fournisseur</TableHead>
                      <TableHead className="text-xs font-semibold">Agence</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Montant</TableHead>
                      <TableHead className="text-xs font-semibold text-right text-green-700">Payé</TableHead>
                      <TableHead className="text-xs font-semibold text-right text-red-700">Reste</TableHead>
                      <TableHead className="text-xs font-semibold">Statut</TableHead>
                      <TableHead className="text-xs font-semibold">Paiement</TableHead>
                      <TableHead className="text-xs font-semibold">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOrders.slice(0, 100).map((o: any) => {
                      const rcSt = STATUS_LABELS[o.status] ?? { label: o.status, cls: "bg-slate-100 text-slate-700" };
                      const pmSt = PAYMENT_STATUS_LABELS[o.paymentStatus] ?? { label: o.paymentStatus, cls: "bg-slate-100 text-slate-700" };
                      return (
                        <TableRow key={o.id}>
                          <TableCell className="text-xs font-mono font-semibold">{o.reference}</TableCell>
                          <TableCell className="text-xs">{o.supplierName}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{o.branchName}</TableCell>
                          <TableCell className="text-xs text-right font-semibold">{fmtDA(o.total)}</TableCell>
                          <TableCell className="text-xs text-right text-green-700">{fmtDA(o.paid)}</TableCell>
                          <TableCell className="text-xs text-right text-red-700">
                            {o.unpaid > 0 ? fmtDA(o.unpaid) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell>
                            <Badge className={`text-[10px] h-4 px-1.5 border ${rcSt.cls}`}>{rcSt.label}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge className={`text-[10px] h-4 px-1.5 border ${pmSt.cls}`}>{pmSt.label}</Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{fmtDateFull(o.createdAt)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">Aucune commande sur cette période</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
