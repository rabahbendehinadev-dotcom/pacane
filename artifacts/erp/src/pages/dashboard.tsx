import {
  useGetDashboardSummary, useGetDashboardAlerts, useGetRecentActivity,
  useGetSalesTrend, useGetTopProducts, useGetBranchPerformance, useGetBranches,
  useGetAdjustmentsStats,
  customFetch
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NotificationsDrawer } from "@/components/notifications/NotificationsDrawer";
import {
  ShoppingCart, Package, ChefHat, Truck, CreditCard, AlertTriangle,
  TrendingUp, Users, ArrowRightLeft,
  Clock, CheckCircle2, Zap, BarChart3, Star, ArrowRight, Activity,
  Receipt, PackageSearch, Wallet, TrendingDown, Scale, ArrowUp, ArrowDown,
  ShieldAlert, RotateCcw, PackageMinus
} from "lucide-react";
import { ReceivableAlertsPanel } from "@/components/ReceivableAlerts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Area, AreaChart, Bar, BarChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis, CartesianGrid, Cell
} from "recharts";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

function formatDA(n: number) {
  return new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(n) + " DA";
}

function greet() {
  const h = new Date().getHours();
  if (h < 12) return "Bonjour";
  if (h < 18) return "Bon après-midi";
  return "Bonsoir";
}

// ── Quick Action Card ────────────────────────────────
function QuickAction({ icon: Icon, label, to, color, onClick }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  to: string;
  color: string;
  onClick: (to: string) => void;
}) {
  return (
    <button
      onClick={() => onClick(to)}
      className="flex flex-col items-center gap-2 p-3 rounded-2xl border bg-card hover:bg-muted/50 hover:border-primary/30 hover:shadow-md transition-all duration-200 group"
    >
      <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${color}`}>
        <Icon className="h-4.5 w-4.5" />
      </div>
      <span className="text-xs font-medium text-center leading-tight text-muted-foreground group-hover:text-foreground transition-colors">{label}</span>
    </button>
  );
}

// ── KPI Card ─────────────────────────────────────────
function KpiCard({ title, value, icon: Icon, accent, isAlert, sub, trend }: {
  title: string; value: string; icon: React.ComponentType<{ className?: string }>;
  accent: string; isAlert?: boolean; sub?: string; trend?: { value: number; label: string } | null;
}) {
  return (
    <Card className={`relative overflow-hidden transition-all hover:shadow-md ${isAlert ? "border-red-200 bg-red-50/40" : ""}`}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1 min-w-0">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide leading-none">{title}</p>
            <p className={`text-2xl font-bold tracking-tight ${isAlert ? "text-red-600" : "text-foreground"}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
            {trend && (
              <div className={`flex items-center gap-1 text-xs font-medium ${trend.value >= 0 ? "text-red-500" : "text-green-600"}`}>
                {trend.value >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                {Math.abs(trend.value).toFixed(1)}% {trend.label}
              </div>
            )}
          </div>
          <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${accent}`}>
            <Icon className="h-4.5 w-4.5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Financial KPI Card (for monthly bilan row) ──────
function FinancialKpiCard({ title, value, icon: Icon, accent, sub, badge }: {
  title: string; value: string; icon: React.ComponentType<{ className?: string }>;
  accent: string; sub?: string; badge?: { label: string; color: string };
}) {
  return (
    <Card className="relative overflow-hidden transition-all hover:shadow-md border-0 bg-gradient-to-br from-white to-muted/20">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide leading-none">{title}</p>
              {badge && (
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${badge.color}`}>{badge.label}</span>
              )}
            </div>
            <p className="text-2xl font-bold tracking-tight text-foreground">{value}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </div>
          <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${accent}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Alert Item ────────────────────────────────────────
function AlertItem({ severity, message }: { severity: string; message: string }) {
  const isCritical = severity === "critical";
  return (
    <div className={`flex items-start gap-3 rounded-xl p-3 border ${isCritical ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}>
      <AlertTriangle className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${isCritical ? "text-red-500" : "text-amber-500"}`} />
      <p className={`text-xs leading-relaxed ${isCritical ? "text-red-800" : "text-amber-800"}`}>{message}</p>
    </div>
  );
}

// ── Activity dot color ────────────────────────────────
function activityColor(type: string) {
  if (type === "sale") return "bg-green-500";
  if (type === "purchase") return "bg-blue-500";
  if (type === "production") return "bg-purple-500";
  if (type === "transfer") return "bg-indigo-500";
  return "bg-slate-400";
}
function activityIcon(type: string) {
  if (type === "sale") return Receipt;
  if (type === "purchase") return PackageSearch;
  if (type === "production") return ChefHat;
  return Activity;
}

// ── Custom Tooltip ─────────────────────────────────────
function SalesTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover border rounded-xl shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      <p className="text-muted-foreground">Ventes: <span className="font-bold text-amber-700">{formatDA(payload[0]?.value ?? 0)}</span></p>
      {payload[1] && <p className="text-muted-foreground">Commandes: <span className="font-bold text-foreground">{payload[1]?.value}</span></p>}
    </div>
  );
}

// ── Skeleton row ──────────────────────────────────────
function KpiSkeleton() {
  return (
    <Card>
      <CardContent className="p-5 space-y-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-3 w-16" />
      </CardContent>
    </Card>
  );
}

// ── Expense data type ──────────────────────────────────
interface ExpenseDashboard {
  expensesThisMonth: number;
  expensesLastMonth: number;
  salesThisMonth: number;
  returnsThisMonth: number;
  netSalesAfterReturns: number;
  returnRatio: number;
  netThisMonth: number;
  expensePressureRatio: number | null;
  monthOverMonthChange: number | null;
  byCategory: { category: string; amount: number }[];
  byBranch: { branchId: number; branchName: string; amount: number }[];
}

// Category bar colors
const CATEGORY_COLORS = [
  "#b45309", "#d97706", "#f59e0b", "#ef4444", "#8b5cf6", "#3b82f6"
];

// ────────────────────────────────────────────────────────────────────────
interface EAlert { id: number; severity: "critical" | "warning" | "info"; title: string; message: string; module: string; isRead: boolean; createdAt: string; }

export default function Dashboard() {
  const { user, activeBranchId, setActiveBranchId } = useAuth();
  const [, navigate] = useLocation();
  const [notifOpen, setNotifOpen] = useState(false);
  const { data: branches = [] } = useGetBranches();
  const branchParam = activeBranchId ? { branchId: activeBranchId } : {};

  const REFRESH = { query: { staleTime: 0, refetchInterval: 30_000, refetchOnWindowFocus: true } };

  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary(branchParam, REFRESH);
  const { data: _alerts } = useGetDashboardAlerts(REFRESH);
  const { data: _activity } = useGetRecentActivity(REFRESH);
  const { data: _trend } = useGetSalesTrend({ ...branchParam, days: 14 }, REFRESH);
  const { data: _topProducts } = useGetTopProducts(REFRESH);
  const { data: _branchPerf } = useGetBranchPerformance(REFRESH);
  const { data: lossStats } = useGetAdjustmentsStats(
    activeBranchId ? { branchId: activeBranchId } : {},
    REFRESH
  );

  const alerts = Array.isArray(_alerts) ? _alerts : [];
  const activity = Array.isArray(_activity) ? _activity : [];
  const trend = Array.isArray(_trend) ? _trend : [];
  const topProducts = Array.isArray(_topProducts) ? _topProducts : [];
  const branchPerf = Array.isArray(_branchPerf) ? _branchPerf : [];

  // Real-time operational alerts from notification system
  const token = () => localStorage.getItem("erp_token") ?? "";
  const { data: erpAlerts = [] } = useQuery<EAlert[]>({
    queryKey: ["notifications", "all", "all", false],
    queryFn: async () => {
      const r = await fetch("/api/notifications", { headers: { Authorization: `Bearer ${token()}` } });
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    },
    staleTime: 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  // Expense-aware financial data (custom fetch)
  const [expenseData, setExpenseData] = useState<ExpenseDashboard | null>(null);
  const [loadingExpenses, setLoadingExpenses] = useState(true);

  useEffect(() => {
    setLoadingExpenses(true);
    const params = activeBranchId ? `?branchId=${activeBranchId}` : "";
    customFetch<ExpenseDashboard>(`/api/dashboard/expenses${params}`)
      .then(setExpenseData)
      .catch(() => setExpenseData(null))
      .finally(() => setLoadingExpenses(false));
  }, [activeBranchId]);

  const trendFormatted = trend.map(d => ({
    ...d,
    label: format(new Date(d.date), "dd MMM", { locale: fr }),
  }));

  const maxRevenue = topProducts[0]?.totalRevenue ?? 1;
  const activeBranch = branches.find(b => b.id === activeBranchId);
  const criticalAlerts = alerts.filter(a => a.severity === "critical").length;

  // Expense pressure alert
  const pressureHigh = expenseData?.expensePressureRatio != null && expenseData.expensePressureRatio > 0.8;

  // Branch perf with expenses (filter only branches with activity)
  const branchPerfEnriched = branchPerf.filter(b => b.salesAmount > 0 || (b as any).expensesAmount > 0);

  const currentMonthLabel = format(new Date(), "MMMM yyyy", { locale: fr });

  return (
    <div className="space-y-7 pb-8">

      {/* ── Top Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold tracking-tight">
            {greet()}{user?.name ? `, ${user.name.split(" ")[0]}` : ""} 👋
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5 capitalize">
            {format(new Date(), "EEEE d MMMM yyyy", { locale: fr })}
            {criticalAlerts > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-red-600 font-medium">
                <AlertTriangle className="h-3 w-3" />{criticalAlerts} alerte{criticalAlerts > 1 ? "s" : ""} critique{criticalAlerts > 1 ? "s" : ""}
              </span>
            )}
          </p>
        </div>
        {branches.length > 1 && (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground">Boutique :</span>
            <Select
              value={activeBranchId ? String(activeBranchId) : "all"}
              onValueChange={v => setActiveBranchId(v === "all" ? null : parseInt(v))}
            >
              <SelectTrigger className="h-8 w-44 text-sm">
                <SelectValue placeholder="Toutes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes les boutiques</SelectItem>
                {branches.map(b => (
                  <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* ── Quick Actions ── */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Actions rapides</p>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          <QuickAction icon={ShoppingCart}    label="Nouvelle vente"      to="/sales"       color="bg-green-100 text-green-700"   onClick={navigate} />
          <QuickAction icon={ChefHat}         label="Lancer production"   to="/production"  color="bg-purple-100 text-purple-700" onClick={navigate} />
          <QuickAction icon={Users}           label="Nouveau contact"     to="/contacts"    color="bg-blue-100 text-blue-700"     onClick={navigate} />
          <QuickAction icon={ArrowRightLeft}  label="Transfert stock"     to="/transfers"   color="bg-indigo-100 text-indigo-700" onClick={navigate} />
          <QuickAction icon={Receipt}         label="Créer facture"       to="/sales"       color="bg-amber-100 text-amber-700"   onClick={navigate} />
          <QuickAction icon={Package}         label="Ajustement stock"    to="/adjustments" color="bg-rose-100 text-rose-700"     onClick={navigate} />
        </div>
      </div>

      {/* ── KPI Row: Operational ── */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Opérationnel — aujourd'hui</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {loadingSummary ? (
            Array.from({ length: 6 }).map((_, i) => <KpiSkeleton key={i} />)
          ) : summary ? (
            <>
              <KpiCard
                title="Ventes aujourd'hui"
                value={formatDA(summary.salesToday)}
                icon={TrendingUp}
                accent="bg-amber-100 text-amber-700"
                sub={`${summary.ordersToday} document${summary.ordersToday !== 1 ? "s" : ""}`}
              />
              <KpiCard
                title="Encaissé"
                value={formatDA(summary.paymentsToday)}
                icon={CreditCard}
                accent="bg-green-100 text-green-700"
                sub="paiements du jour"
              />
              <KpiCard
                title="Prêts / Livraisons"
                value={String(summary.deliveriesToday)}
                icon={Truck}
                accent="bg-teal-100 text-teal-700"
                sub="à traiter"
              />
              <KpiCard
                title="Stock faible"
                value={String(summary.lowStockCount)}
                icon={Package}
                accent={summary.lowStockCount > 0 ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}
                isAlert={summary.lowStockCount > 0}
                sub={summary.lowStockCount > 0 ? "produits concernés" : "tout est OK"}
              />
              <KpiCard
                title="Production en att."
                value={String(summary.productionPending)}
                icon={ChefHat}
                accent="bg-purple-100 text-purple-700"
                sub="ordres planifiés"
              />
              <KpiCard
                title="Créances clients"
                value={formatDA(summary.overduePayments)}
                icon={AlertTriangle}
                accent={summary.overduePayments > 0 ? "bg-orange-100 text-orange-700" : "bg-green-100 text-green-700"}
                isAlert={summary.overduePayments > 500000}
                sub="solde non réglé"
              />
            </>
          ) : null}
        </div>
      </div>

      {/* ── Low Stock Panel ── */}
      {(() => {
        const stockAlerts = alerts.filter((a: any) => a.type === "stock");
        if (stockAlerts.length === 0) return null;
        const criticalStock = stockAlerts.filter((a: any) => a.severity === "critical");
        const warningStock = stockAlerts.filter((a: any) => a.severity !== "critical");
        return (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
              Stock faible — {stockAlerts.length} produit{stockAlerts.length > 1 ? "s" : ""} concerné{stockAlerts.length > 1 ? "s" : ""}
            </p>
            <Card className="border border-red-200 bg-red-50/40">
              <CardContent className="p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {stockAlerts.map((a: any) => {
                    const isCritical = a.severity === "critical";
                    const msgParts = a.message.replace("Stock faible: ", "").split(" - ");
                    const nameBranch = msgParts[0] ?? a.message;
                    const qty = msgParts[1] ?? "";
                    return (
                      <div key={a.id} className={`flex items-center gap-2.5 rounded-lg px-3 py-2 border ${isCritical ? "bg-red-100 border-red-200" : "bg-amber-50 border-amber-200"}`}>
                        <Package className={`h-3.5 w-3.5 flex-shrink-0 ${isCritical ? "text-red-600" : "text-amber-600"}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium truncate">{nameBranch}</p>
                          <p className={`text-[10px] ${isCritical ? "text-red-600 font-semibold" : "text-amber-700"}`}>{qty}</p>
                        </div>
                        {isCritical && <span className="text-[9px] bg-red-600 text-white rounded-full px-1.5 py-0.5 font-bold flex-shrink-0">RUPTURE</span>}
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-3 mt-3 pt-3 border-t border-red-200">
                  <span className="text-xs text-red-700 font-medium">{criticalStock.length} en rupture · {warningStock.length} faible</span>
                  <button className="text-xs text-amber-700 hover:underline ml-auto" onClick={() => navigate("/products")}>
                    Gérer les produits →
                  </button>
                </div>
              </CardContent>
            </Card>
          </div>
        );
      })()}

      {/* ── Financial Bilan Row (monthly, expense-aware) ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest capitalize">
            Bilan financier — {currentMonthLabel}
          </p>
          {activeBranch && (
            <span className="text-xs text-muted-foreground bg-muted/60 rounded-lg px-2.5 py-1">
              {activeBranch.name}
            </span>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {loadingExpenses ? (
            Array.from({ length: 5 }).map((_, i) => <KpiSkeleton key={i} />)
          ) : expenseData ? (
            <>
              <FinancialKpiCard
                title="Ventes brutes"
                value={formatDA(expenseData.salesThisMonth)}
                icon={TrendingUp}
                accent="bg-green-100 text-green-700"
                sub={expenseData.returnsThisMonth > 0
                  ? `dont −${formatDA(expenseData.returnsThisMonth)} retours`
                  : "chiffre d'affaires mensuel"
                }
              />
              <FinancialKpiCard
                title="Retours & Avoirs"
                value={formatDA(expenseData.returnsThisMonth)}
                icon={RotateCcw}
                accent={expenseData.returnsThisMonth > 0 ? "bg-orange-100 text-orange-700" : "bg-green-100 text-green-700"}
                sub={expenseData.returnsThisMonth > 0
                  ? `${(expenseData.returnRatio * 100).toFixed(1)}% du CA — avoirs confirmés`
                  : "aucun retour ce mois"
                }
                badge={expenseData.returnRatio > 0.05
                  ? { label: "Ratio élevé", color: "bg-orange-100 text-orange-700" }
                  : expenseData.returnsThisMonth > 0
                  ? { label: "Normal", color: "bg-green-100 text-green-700" }
                  : undefined
                }
              />
              <FinancialKpiCard
                title="Ventes nettes"
                value={formatDA(expenseData.netSalesAfterReturns)}
                icon={Scale}
                accent="bg-sky-100 text-sky-700"
                sub="CA après déduction des retours"
              />
              <FinancialKpiCard
                title="Dépenses du mois"
                value={formatDA(expenseData.expensesThisMonth)}
                icon={Wallet}
                accent="bg-red-100 text-red-700"
                sub={expenseData.expensesLastMonth > 0
                  ? `vs ${formatDA(expenseData.expensesLastMonth)} le mois dernier`
                  : "charges validées"
                }
                badge={expenseData.monthOverMonthChange != null ? {
                  label: `${expenseData.monthOverMonthChange >= 0 ? "+" : ""}${expenseData.monthOverMonthChange.toFixed(0)}%`,
                  color: expenseData.monthOverMonthChange > 10
                    ? "bg-red-100 text-red-700"
                    : expenseData.monthOverMonthChange < -5
                    ? "bg-green-100 text-green-700"
                    : "bg-muted text-muted-foreground"
                } : undefined}
              />
              <FinancialKpiCard
                title="Solde opérationnel"
                value={formatDA(expenseData.netThisMonth)}
                icon={expenseData.netThisMonth >= 0 ? TrendingUp : TrendingDown}
                accent={expenseData.netThisMonth >= 0 ? "bg-violet-100 text-violet-700" : "bg-red-100 text-red-700"}
                sub={expenseData.netThisMonth >= 0 ? "ventes nettes − dépenses" : "charges supérieures aux ventes nettes"}
                badge={expenseData.netThisMonth < 0 ? { label: "Déficit", color: "bg-red-100 text-red-700" }
                  : pressureHigh ? { label: "Pression haute", color: "bg-orange-100 text-orange-700" }
                  : expenseData.expensePressureRatio != null && expenseData.expensePressureRatio < 0.5
                  ? { label: "Sain", color: "bg-green-100 text-green-700" }
                  : undefined
                }
              />
            </>
          ) : null}
        </div>
      </div>

      {/* ── Pertes & Ajustements négatifs ── */}
      {lossStats && (
        <div>
          <Card className="border-red-200 bg-red-50/40">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold flex items-center gap-2 text-red-700">
                  <TrendingDown className="h-4 w-4" />
                  Pertes &amp; ajustements négatifs
                  {activeBranch && (
                    <span className="ml-1 text-xs font-normal text-red-500/80">— {activeBranch.name}</span>
                  )}
                </CardTitle>
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground gap-1 hover:text-foreground" onClick={() => navigate("/adjustments")}>
                  Voir tout <ArrowRight className="h-3 w-3" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-white border border-red-100 p-3 text-center">
                  <div className="text-xs text-muted-foreground mb-1 flex items-center justify-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-red-400" />Valeur perdue
                  </div>
                  <div className="text-xl font-bold text-red-600">
                    {new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(lossStats.totalPerteValeur ?? 0)}
                  </div>
                  <div className="text-xs text-muted-foreground">DA</div>
                </div>
                <div className="rounded-lg bg-white border border-red-100 p-3 text-center">
                  <div className="text-xs text-muted-foreground mb-1 flex items-center justify-center gap-1">
                    <PackageMinus className="h-3 w-3 text-orange-400" />Unités perdues
                  </div>
                  <div className="text-xl font-bold text-orange-600">
                    {new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 2 }).format(lossStats.totalPerteQuantite ?? 0)}
                  </div>
                  <div className="text-xs text-muted-foreground">unités</div>
                </div>
                <div className="rounded-lg bg-white border border-red-100 p-3 text-center">
                  <div className="text-xs text-muted-foreground mb-1 flex items-center justify-center gap-1">
                    <BarChart3 className="h-3 w-3 text-slate-400" />Opérations
                  </div>
                  <div className="text-xl font-bold text-slate-700">{lossStats.countPertes ?? 0}</div>
                  <div className="text-xs text-muted-foreground">ajustements négatifs</div>
                </div>
              </div>

              {lossStats.byReason.length > 0 ? (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Détail par motif</div>
                  <div className="rounded-md border border-red-100 bg-white overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-red-100 bg-red-50/50">
                          <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Motif</th>
                          <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Opérations</th>
                          <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Quantité</th>
                          <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Valeur (DA)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lossStats.byReason.map((row, i) => (
                          <tr key={row.reason} className={`border-b border-red-50 last:border-0 ${i % 2 === 1 ? "bg-red-50/20" : ""}`}>
                            <td className="px-3 py-2 font-medium">{row.reason}</td>
                            <td className="px-3 py-2 text-right text-muted-foreground">{row.count}</td>
                            <td className="px-3 py-2 text-right text-muted-foreground">
                              {new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 2 }).format(row.quantite)}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-red-600">
                              {new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(row.valeur)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-center text-muted-foreground py-2">Aucune perte enregistrée</div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Main Content: Chart + Alerts + Expense breakdown ── */}
      <div className="grid gap-5 lg:grid-cols-3">

        {/* Sales Trend */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <div>
              <CardTitle className="text-base font-semibold">Tendance des ventes</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">14 derniers jours</p>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/60 rounded-lg px-2.5 py-1">
              <BarChart3 className="h-3.5 w-3.5" />
              {activeBranch?.name ?? "Toutes boutiques"}
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            {trend.length === 0 ? (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
                Aucune donnée disponible
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trendFormatted} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#b45309" stopOpacity={0.18} />
                      <stop offset="95%" stopColor="#b45309" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={v => new Intl.NumberFormat('fr-DZ', { maximumFractionDigits: 0 }).format(v)}
                    width={36}
                  />
                  <Tooltip content={<SalesTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="amount"
                    stroke="#b45309"
                    strokeWidth={2.5}
                    fill="url(#salesGrad)"
                    dot={false}
                    activeDot={{ r: 4, fill: "#b45309", strokeWidth: 0 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Alerts + Customer Risks */}
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-500" />
                  Alertes opérationnelles
                </CardTitle>
                <div className="flex items-center gap-2">
                  {erpAlerts.filter(a => !a.isRead).length > 0 && (
                    <Badge className={`text-xs ${erpAlerts.some(a => a.severity === "critical" && !a.isRead) ? "bg-red-500" : "bg-amber-500"}`}>
                      {erpAlerts.filter(a => !a.isRead).length}
                    </Badge>
                  )}
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground gap-1 hover:text-foreground" onClick={() => setNotifOpen(true)}>
                    Voir tout <ArrowRight className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto max-h-[200px]">
              {pressureHigh && (
                <AlertItem
                  severity="warning"
                  message={`Taux de charge élevé ce mois (${((expenseData?.expensePressureRatio ?? 0) * 100).toFixed(0)}%) — les dépenses représentent plus de 80% des ventes.`}
                />
              )}
              {erpAlerts.length === 0 && !pressureHigh ? (
                <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                  <CheckCircle2 className="h-8 w-8 text-green-400" />
                  <p className="text-sm text-muted-foreground">Tout est en ordre</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {pressureHigh && <div className="mt-1" />}
                  {erpAlerts.slice(0, 6).map(a => (
                    <AlertItem key={a.id} severity={a.severity} message={a.title} />
                  ))}
                  {erpAlerts.length > 6 && (
                    <button
                      className="w-full text-xs text-center text-muted-foreground hover:text-foreground py-1.5 border border-dashed rounded-lg transition-colors"
                      onClick={() => setNotifOpen(true)}
                    >
                      + {erpAlerts.length - 6} autres alertes
                    </button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Risques clients */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-red-500" />
                  Risques clients
                </CardTitle>
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground gap-1 hover:text-foreground" onClick={() => navigate("/contacts")}>
                  Contacts <ArrowRight className="h-3 w-3" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <ReceivableAlertsPanel
                branchId={activeBranchId}
                maxItems={3}
                onOpenContact={() => navigate("/contacts")}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Expense Breakdown + Branch Performance ── */}
      <div className="grid gap-5 lg:grid-cols-3">

        {/* Expense by category (this month) */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Wallet className="h-4 w-4 text-red-500" />
                Charges par catégorie
              </CardTitle>
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground gap-1 hover:text-foreground" onClick={() => navigate("/reports")}>
                Voir tout <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground capitalize">{currentMonthLabel}</p>
          </CardHeader>
          <CardContent>
            {!expenseData || expenseData.byCategory.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Aucune dépense ce mois</p>
            ) : (
              <div className="space-y-3">
                {expenseData.byCategory.map((cat, i) => {
                  const pct = expenseData.expensesThisMonth > 0
                    ? (cat.amount / expenseData.expensesThisMonth) * 100
                    : 0;
                  return (
                    <div key={cat.category}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">{cat.category}</span>
                        <span className="text-xs text-muted-foreground">{formatDA(cat.amount)}</span>
                      </div>
                      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.max(3, pct)}%`,
                            backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length]
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top products */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Star className="h-4 w-4 text-amber-500" />
                Meilleurs produits
              </CardTitle>
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground gap-1 hover:text-foreground" onClick={() => navigate("/reports")}>
                Voir tout <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {topProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Aucune donnée de vente</p>
            ) : topProducts.slice(0, 5).map((p) => (
              <div key={p.productId} className="flex items-center gap-3">
                <div className="h-6 w-6 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-bold text-amber-700">#{p.rank}</span>
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium truncate">{p.productName}</p>
                    <span className="text-xs text-muted-foreground shrink-0">{formatDA(p.totalRevenue)}</span>
                  </div>
                  <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all bg-gradient-to-r from-amber-400 to-amber-600"
                      style={{ width: `${Math.max(4, (p.totalRevenue / maxRevenue) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Recent activity */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              Activité récente
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activity.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-center text-muted-foreground">
                <Clock className="h-7 w-7 opacity-30" />
                <p className="text-sm">Aucune activité récente</p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {activity.slice(0, 6).map((item, idx) => {
                  const Icon = activityIcon(item.type);
                  return (
                    <div key={item.id} className={`flex items-start gap-3 py-2 ${idx !== 0 ? "border-t border-muted/60" : ""}`}>
                      <div className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${
                        item.type === "sale" ? "bg-green-100" :
                        item.type === "purchase" ? "bg-blue-100" :
                        item.type === "production" ? "bg-purple-100" : "bg-slate-100"
                      }`}>
                        <Icon className={`h-3.5 w-3.5 ${
                          item.type === "sale" ? "text-green-700" :
                          item.type === "purchase" ? "text-blue-700" :
                          item.type === "production" ? "text-purple-700" : "text-slate-600"
                        }`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm leading-snug">{item.description}</p>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0 pt-0.5">
                        {item.date ? format(new Date(item.date), "HH:mm") : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Branch Performance (enriched with expenses) ── */}
      {branchPerfEnriched.length > 1 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Performance par boutique</CardTitle>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-500 inline-block" />Ventes</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-orange-400 inline-block" />Retours</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-red-400 inline-block" />Dépenses</span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={branchPerfEnriched} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barSize={18} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis
                  dataKey="branchName"
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={v => new Intl.NumberFormat('fr-DZ', { maximumFractionDigits: 0 }).format(v)}
                  width={36}
                />
                <Tooltip
                  formatter={(v: number, name: string) => [formatDA(v), name === "salesAmount" ? "Ventes" : name === "returnsAmount" ? "Retours" : "Dépenses"]}
                  contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }}
                />
                <Bar dataKey="salesAmount" name="salesAmount" fill="#b45309" radius={[4, 4, 0, 0]} />
                <Bar dataKey="returnsAmount" name="returnsAmount" fill="#fb923c" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expensesAmount" name="expensesAmount" fill="#f87171" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <NotificationsDrawer open={notifOpen} onClose={() => setNotifOpen(false)} />
    </div>
  );
}
