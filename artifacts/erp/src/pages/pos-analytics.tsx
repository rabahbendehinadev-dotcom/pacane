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
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
  LineChart, Line, CartesianGrid, Legend,
} from "recharts";
import {
  MonitorSmartphone, ShoppingBag, Receipt, TrendingUp, Clock, Users,
  RotateCcw, CreditCard, Banknote, Smartphone, CheckCircle2, AlertTriangle,
  BarChart3, Building2, Store, Download, RefreshCw, Filter,
} from "lucide-react";
import { format, subDays, startOfMonth, startOfYear, parseISO } from "date-fns";
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

const PAYMENT_COLORS: Record<string, string> = {
  cash: "#d97706",
  card: "#6366f1",
  credit: "#8b5cf6",
  check: "#0ea5e9",
  transfer: "#10b981",
};
const PAYMENT_LABELS: Record<string, string> = {
  cash: "Espèces", card: "Carte", credit: "Crédit", check: "Chèque", transfer: "Virement",
};
const BRANCH_COLORS = ["#b45309","#6366f1","#10b981","#ec4899","#0ea5e9","#f59e0b","#8b5cf6"];

// ─── Custom tooltip for charts ─────────────────────────────────────────────
function RevenueTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background border border-border rounded-lg shadow-lg p-3 text-xs space-y-1">
      <p className="font-semibold text-foreground">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }}>
          {p.name === "revenue" ? "CA: " + formatDA(p.value) : p.name === "tickets" ? `Tickets: ${p.value}` : `Moy: ${formatDA(p.value)}`}
        </p>
      ))}
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ title, value, sub, icon: Icon, color = "amber", loading = false }: {
  title: string; value: string; sub?: string;
  icon: React.FC<{ className?: string }>;
  color?: "amber" | "green" | "blue" | "red" | "violet" | "indigo";
  loading?: boolean;
}) {
  const bg = { amber: "bg-amber-50", green: "bg-green-50", blue: "bg-blue-50", red: "bg-red-50", violet: "bg-violet-50", indigo: "bg-indigo-50" }[color];
  const ic = { amber: "text-amber-600", green: "text-green-600", blue: "text-blue-600", red: "text-red-600", violet: "text-violet-600", indigo: "text-indigo-600" }[color];
  return (
    <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg ${bg} shrink-0`}>
            <Icon className={`h-4 w-4 ${ic}`} />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground font-medium truncate">{title}</p>
            {loading ? (
              <div className="h-6 w-24 bg-muted animate-pulse rounded mt-1" />
            ) : (
              <p className="text-xl font-bold text-foreground leading-tight">{value}</p>
            )}
            {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Date preset helpers ───────────────────────────────────────────────────────
const DATE_PRESETS = [
  { label: "Aujourd'hui", from: () => format(new Date(), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "7 jours", from: () => format(subDays(new Date(), 6), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "30 jours", from: () => format(subDays(new Date(), 29), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "Ce mois", from: () => format(startOfMonth(new Date()), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "Cette année", from: () => format(startOfYear(new Date()), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
];

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function PosAnalytics() {
  const { user } = useAuth();
  const isAdmin = user?.adminAccess;

  // Filters state
  const [from, setFrom] = useState(format(subDays(new Date(), 29), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [branchId, setBranchId] = useState("all");
  const [userId, setUserId] = useState("all");
  const [paymentMethod, setPaymentMethod] = useState("all");
  const [activePreset, setActivePreset] = useState(2); // "30 jours"

  // Build query params
  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (from) p.from = from;
    if (to) p.to = to;
    if (branchId !== "all") p.branchId = branchId;
    if (userId !== "all") p.userId = userId;
    if (paymentMethod !== "all") p.paymentMethod = paymentMethod;
    return p;
  }, [from, to, branchId, userId, paymentMethod]);

  const qs = new URLSearchParams(params).toString();

  // Queries
  const { data: branches } = useGetBranches();

  const { data: users } = useQuery<{ id: number; username: string; displayName: string }[]>({
    queryKey: ["analytics-pos-users"],
    queryFn: () => customFetch("/api/users"),
  });

  const cashiers = useMemo(() => (users ?? []).filter(u => !u.username.startsWith("admin")), [users]);

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ["analytics-pos-kpis", qs],
    queryFn: () => customFetch(`/api/analytics/pos/kpis?${qs}`),
  });

  const { data: hourly, isLoading: hourlyLoading } = useQuery({
    queryKey: ["analytics-pos-hourly", qs],
    queryFn: () => customFetch(`/api/analytics/pos/hourly?${qs}`),
  });

  const { data: daily, isLoading: dailyLoading } = useQuery({
    queryKey: ["analytics-pos-daily", qs],
    queryFn: () => customFetch(`/api/analytics/pos/daily?${qs}`),
  });

  const { data: products, isLoading: productsLoading } = useQuery({
    queryKey: ["analytics-pos-products", qs],
    queryFn: () => customFetch(`/api/analytics/pos/products?${qs}`),
  });

  const { data: cashiersData, isLoading: cashiersLoading } = useQuery({
    queryKey: ["analytics-pos-cashiers", qs],
    queryFn: () => customFetch(`/api/analytics/pos/cashiers?${qs}`),
  });

  const { data: sessionsData, isLoading: sessionsLoading } = useQuery({
    queryKey: ["analytics-pos-sessions", qs],
    queryFn: () => customFetch(`/api/analytics/pos/sessions?${qs}`),
  });

  const { data: branchesData } = useQuery({
    queryKey: ["analytics-pos-branches", qs],
    queryFn: () => customFetch(`/api/analytics/pos/branches?${qs}`),
  });

  // Derived values
  const k = kpis as any;
  const showBranchFilter = isAdmin || (user?.branchIds && user.branchIds.length > 1);

  // Hourly peak detection
  const peakHour = useMemo(() => {
    if (!hourly || !Array.isArray(hourly)) return null;
    return (hourly as any[]).reduce((max: any, h: any) => (!max || h.revenue > max.revenue ? h : max), null);
  }, [hourly]);

  // Apply preset
  const applyPreset = (i: number) => {
    const p = DATE_PRESETS[i];
    setFrom(p.from());
    setTo(p.to());
    setActivePreset(i);
  };

  // CSV export
  const exportCsv = (type: string) => {
    const token = localStorage.getItem("auth_token");
    const url = `/api/analytics/pos/${type}?${qs}`;
    window.open(url, "_blank");
  };

  return (
    <div className="p-6 space-y-6 max-w-screen-2xl mx-auto">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <MonitorSmartphone className="h-6 w-6 text-amber-600" />
            Analytique POS
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Performance caisse · Sessions · Produits · Caissiers
          </p>
        </div>
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-end">
            {/* Date presets */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Période</Label>
              <div className="flex gap-1">
                {DATE_PRESETS.map((p, i) => (
                  <Button
                    key={i}
                    variant={activePreset === i ? "default" : "outline"}
                    size="sm"
                    className={`text-xs h-8 px-2.5 ${activePreset === i ? "bg-amber-600 hover:bg-amber-700 border-amber-600" : ""}`}
                    onClick={() => applyPreset(i)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Date range manual */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Du</Label>
              <Input
                type="date"
                value={from}
                onChange={e => { setFrom(e.target.value); setActivePreset(-1); }}
                className="h-8 text-xs w-36"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Au</Label>
              <Input
                type="date"
                value={to}
                onChange={e => { setTo(e.target.value); setActivePreset(-1); }}
                className="h-8 text-xs w-36"
              />
            </div>

            {/* Branch filter (admin / multi-branch only) */}
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

            {/* Cashier filter */}
            {isAdmin && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Caissier</Label>
                <Select value={userId} onValueChange={setUserId}>
                  <SelectTrigger className="h-8 text-xs w-40">
                    <SelectValue placeholder="Tous" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les caissiers</SelectItem>
                    {cashiers.map(u => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {u.displayName || u.username}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Payment method filter */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Mode de paiement</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger className="h-8 text-xs w-36">
                  <SelectValue placeholder="Tous" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous</SelectItem>
                  <SelectItem value="cash">Espèces</SelectItem>
                  <SelectItem value="card">Carte</SelectItem>
                  <SelectItem value="credit">Crédit</SelectItem>
                  <SelectItem value="check">Chèque</SelectItem>
                  <SelectItem value="transfer">Virement</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── KPI Cards ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          title="CA POS total"
          value={k ? formatDA(k.totalRevenue) : "—"}
          sub={k ? `Encaissé: ${formatDA(k.totalPaid)}` : undefined}
          icon={TrendingUp}
          color="amber"
          loading={kpisLoading}
        />
        <KpiCard
          title="Tickets"
          value={k ? String(k.ticketCount) : "—"}
          sub={k?.totalSessions ? `${k.totalSessions} session(s)` : undefined}
          icon={Receipt}
          color="blue"
          loading={kpisLoading}
        />
        <KpiCard
          title="Panier moyen"
          value={k ? formatDA(k.avgTicket) : "—"}
          sub={k?.totalItems ? `${Math.round(k.totalItems)} articles` : undefined}
          icon={ShoppingBag}
          color="green"
          loading={kpisLoading}
        />
        <KpiCard
          title="Articles vendus"
          value={k ? String(Math.round(k.totalItems)) : "—"}
          sub={k?.ticketCount ? `${(k.totalItems / k.ticketCount).toFixed(1)} art/ticket` : undefined}
          icon={Store}
          color="indigo"
          loading={kpisLoading}
        />
        <KpiCard
          title="Sessions"
          value={k ? String(k.totalSessions) : "—"}
          sub={k ? `${k.openSessions} ouverte(s) · ${k.closedSessions} clôturée(s)` : undefined}
          icon={MonitorSmartphone}
          color="violet"
          loading={kpisLoading}
        />
        <KpiCard
          title="Retours"
          value={k ? String(k.returnCount) : "—"}
          sub={k?.returnAmount ? formatDA(k.returnAmount) : "0 DA"}
          icon={RotateCcw}
          color="red"
          loading={kpisLoading}
        />
      </div>

      {/* ── Charts row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Hourly chart */}
        <Card className="border-0 shadow-sm lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-600" />
                Ventes par heure
              </CardTitle>
              {peakHour && (
                <Badge className="text-[10px] bg-amber-100 text-amber-800 border-amber-200">
                  Pic: {peakHour.label} · {formatDA(peakHour.revenue)}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            {hourlyLoading ? (
              <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">Chargement...</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={hourly ?? []} barSize={14}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={1} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => fmtK(v)} width={45} />
                  <Tooltip content={<RevenueTooltip />} />
                  <Bar dataKey="revenue" name="revenue" fill="#d97706" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="tickets" name="tickets" fill="#6366f1" radius={[2, 2, 0, 0]} yAxisId={0} hide />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Payment method pie */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-indigo-600" />
              Modes de paiement
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            {kpisLoading ? (
              <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">Chargement...</div>
            ) : k?.paymentBreakdown?.length > 0 ? (
              <div className="space-y-2">
                <ResponsiveContainer width="100%" height={140}>
                  <PieChart>
                    <Pie
                      data={k.paymentBreakdown}
                      dataKey="amount"
                      nameKey="method"
                      cx="50%"
                      cy="50%"
                      innerRadius={35}
                      outerRadius={60}
                      paddingAngle={2}
                    >
                      {k.paymentBreakdown.map((entry: any, i: number) => (
                        <Cell key={i} fill={PAYMENT_COLORS[entry.method] ?? "#94a3b8"} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: any) => formatDA(v)} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1.5">
                  {k.paymentBreakdown.map((r: any) => (
                    <div key={r.method} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: PAYMENT_COLORS[r.method] ?? "#94a3b8" }} />
                        <span className="text-muted-foreground">{PAYMENT_LABELS[r.method] ?? r.method}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-medium">{r.pct}%</span>
                        <span className="text-muted-foreground ml-1">({fmtK(r.amount)} DA)</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">Aucun paiement</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Daily trend + Branch comparison ─────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Daily trend */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-600" />
              Tendance journalière
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            {dailyLoading ? (
              <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">Chargement...</div>
            ) : Array.isArray(daily) && daily.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 9 }} interval={Math.ceil((daily.length || 1) / 8) - 1} />
                  <YAxis tick={{ fontSize: 9 }} tickFormatter={v => fmtK(v)} width={42} />
                  <Tooltip content={<RevenueTooltip />} />
                  <Line type="monotone" dataKey="revenue" name="revenue" stroke="#d97706" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="tickets" name="tickets" stroke="#6366f1" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">Aucune donnée</div>
            )}
          </CardContent>
        </Card>

        {/* Branch comparison */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Building2 className="h-4 w-4 text-violet-600" />
              Performance par agence
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            {Array.isArray(branchesData) && branchesData.length > 0 ? (
              <div className="space-y-3">
                {(branchesData as any[]).map((b, i) => (
                  <div key={b.branchId} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: BRANCH_COLORS[i % BRANCH_COLORS.length] }} />
                        <span className="font-medium truncate max-w-[120px]">{b.branchName}</span>
                      </div>
                      <div className="text-right text-muted-foreground">
                        <span className="font-semibold text-foreground">{fmtK(b.revenue)} DA</span>
                        <span className="ml-1">· {b.tickets} tickets</span>
                      </div>
                    </div>
                    <Progress value={b.revenuePct} className="h-1.5" style={{ "--progress-background": BRANCH_COLORS[i % BRANCH_COLORS.length] } as any} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">Aucune donnée</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Tabs: Products / Cashiers / Sessions ────────────────────────────── */}
      <Tabs defaultValue="products">
        <TabsList className="h-8">
          <TabsTrigger value="products" className="text-xs h-7 px-3">
            <ShoppingBag className="h-3.5 w-3.5 mr-1.5" />
            Top produits
          </TabsTrigger>
          <TabsTrigger value="cashiers" className="text-xs h-7 px-3">
            <Users className="h-3.5 w-3.5 mr-1.5" />
            Caissiers
          </TabsTrigger>
          <TabsTrigger value="sessions" className="text-xs h-7 px-3">
            <MonitorSmartphone className="h-3.5 w-3.5 mr-1.5" />
            Sessions
          </TabsTrigger>
        </TabsList>

        {/* ── Top products ───────────────────────────────────────────────────── */}
        <TabsContent value="products">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Produits les plus vendus (POS)</CardTitle>
                <Badge variant="outline" className="text-[10px]">
                  {Array.isArray(products) ? products.length : 0} produits
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {productsLoading ? (
                <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">Chargement...</div>
              ) : Array.isArray(products) && products.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs font-semibold w-8">#</TableHead>
                      <TableHead className="text-xs font-semibold">Produit</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Qté vendue</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Prix moy.</TableHead>
                      <TableHead className="text-xs font-semibold text-right">CA</TableHead>
                      <TableHead className="text-xs font-semibold w-32">Part</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Tickets</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(products as any[]).map((p, i) => (
                      <TableRow key={p.productId}>
                        <TableCell className="text-xs text-muted-foreground font-mono">{i + 1}</TableCell>
                        <TableCell className="text-xs font-medium">{p.productName}</TableCell>
                        <TableCell className="text-xs text-right font-mono">{p.qty.toFixed(0)}</TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground">{formatDA(p.avgPrice)}</TableCell>
                        <TableCell className="text-xs text-right font-semibold text-amber-700">{formatDA(p.revenue)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={p.revenuePct} className="h-1.5 flex-1" />
                            <span className="text-[10px] text-muted-foreground w-8 text-right">{p.revenuePct}%</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground">{p.txCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">Aucun produit vendu</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Cashiers ───────────────────────────────────────────────────────── */}
        <TabsContent value="cashiers">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Performance par caissier</CardTitle>
                <Badge variant="outline" className="text-[10px]">
                  {Array.isArray(cashiersData) ? cashiersData.length : 0} caissier(s)
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {cashiersLoading ? (
                <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">Chargement...</div>
              ) : Array.isArray(cashiersData) && cashiersData.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs font-semibold">Caissier</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Tickets</TableHead>
                      <TableHead className="text-xs font-semibold text-right">CA total</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Panier moy.</TableHead>
                      <TableHead className="text-xs font-semibold w-32">Part du CA</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Sessions</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Écart caisse</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(cashiersData as any[]).map((c, i) => (
                      <TableRow key={c.userId}>
                        <TableCell>
                          <div>
                            <p className="text-xs font-medium">{c.displayName}</p>
                            <p className="text-[10px] text-muted-foreground">{c.username}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono">{c.tickets}</TableCell>
                        <TableCell className="text-xs text-right font-semibold text-amber-700">{formatDA(c.revenue)}</TableCell>
                        <TableCell className="text-xs text-right">{formatDA(c.avgTicket)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={c.revenuePct} className="h-1.5 flex-1" />
                            <span className="text-[10px] text-muted-foreground w-8 text-right">{c.revenuePct}%</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground">{c.sessionCount}</TableCell>
                        <TableCell className="text-xs text-right">
                          <span className={c.totalVariance > 500 ? "text-red-600 font-semibold" : "text-muted-foreground"}>
                            {formatDA(c.totalVariance)}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">Aucun caissier trouvé</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Sessions ───────────────────────────────────────────────────────── */}
        <TabsContent value="sessions">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Détail des sessions POS</CardTitle>
                <Badge variant="outline" className="text-[10px]">
                  {Array.isArray(sessionsData) ? sessionsData.length : 0} session(s)
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {sessionsLoading ? (
                <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">Chargement...</div>
              ) : Array.isArray(sessionsData) && sessionsData.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs font-semibold">Statut</TableHead>
                      <TableHead className="text-xs font-semibold">Agence</TableHead>
                      <TableHead className="text-xs font-semibold">Caissier</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Tickets</TableHead>
                      <TableHead className="text-xs font-semibold text-right">CA total</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Espèces</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Carte</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Écart</TableHead>
                      <TableHead className="text-xs font-semibold">Ouverture</TableHead>
                      <TableHead className="text-xs font-semibold">Clôture</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(sessionsData as any[]).map(s => (
                      <TableRow key={s.id}>
                        <TableCell>
                          {s.status === "open" ? (
                            <Badge className="text-[10px] bg-green-100 text-green-700 border-green-200 h-4 px-1.5">Ouverte</Badge>
                          ) : (
                            <Badge className="text-[10px] bg-gray-100 text-gray-600 border-gray-200 h-4 px-1.5">Clôturée</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs font-medium">{s.branchName}</TableCell>
                        <TableCell>
                          <div>
                            <p className="text-xs">{s.displayName}</p>
                            <p className="text-[10px] text-muted-foreground">{s.username}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono">{s.salesCount}</TableCell>
                        <TableCell className="text-xs text-right font-semibold text-amber-700">{formatDA(s.totalSales)}</TableCell>
                        <TableCell className="text-xs text-right">{formatDA(s.totalCashSales)}</TableCell>
                        <TableCell className="text-xs text-right">{formatDA(s.totalCardSales)}</TableCell>
                        <TableCell className="text-xs text-right">
                          {s.variance !== null ? (
                            <span className={Math.abs(s.variance) > 100 ? "text-red-600 font-semibold" : "text-muted-foreground"}>
                              {s.variance >= 0 ? "+" : ""}{formatDA(s.variance)}
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmtDatetime(s.openedAt)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {s.closedAt ? fmtDatetime(s.closedAt) : <span className="text-green-600">En cours</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">Aucune session trouvée</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
