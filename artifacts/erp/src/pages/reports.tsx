import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useGetSalesReport, useGetPurchasesReport, useGetStockValuationReport,
  useGetProductionReport, useGetBranchPerformance, useGetCashSessionsReport,
  useGetBranches,
  getGetSalesReportQueryKey, getGetPurchasesReportQueryKey,
  getGetStockValuationReportQueryKey, getGetProductionReportQueryKey,
  getGetBranchPerformanceQueryKey, getGetCashSessionsReportQueryKey,
  customFetch,
} from "@workspace/api-client-react";
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
  TrendingUp, ShoppingCart, Package, Factory,
  AlertTriangle, CreditCard, Building2,
  CheckCircle2, Clock, XCircle, TrendingDown, BarChart3,
  Boxes, Receipt, ChevronRight, ArrowUpDown, RotateCcw, Scale, Banknote,
  FileDown,
} from "lucide-react";
import { format, subDays, startOfMonth, startOfYear } from "date-fns";
import { ExportButton } from "@/components/ExportButton";
import { fr } from "date-fns/locale";

// ─── helpers ────────────────────────────────────────────────────────────────

function formatDA(n: number) {
  return new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(n) + " DA";
}
function fmtK(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "k";
  return String(Math.round(n));
}
function fmtDate(d: string | Date) {
  try { return format(new Date(d), "dd MMM yyyy", { locale: fr }); } catch { return "—"; }
}
function pct(a: number, b: number) { return b > 0 ? Math.round((a / b) * 100) : 0; }

const COLORS = ["#b45309","#d97706","#f59e0b","#fbbf24","#78716c","#a8a29e","#6366f1","#8b5cf6","#ec4899","#14b8a6"];

const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon", quotation: "Devis", order: "Commande", sale: "Vente",
  pending: "En attente", partial: "Partiel", received: "Reçu", cancelled: "Annulé",
  launched: "Lancé", in_progress: "En cours", completed: "Terminé", blocked: "Bloqué",
};
function StatusBadge({ s }: { s: string }) {
  const colors: Record<string, string> = {
    draft: "bg-gray-100 text-gray-600", quotation: "bg-blue-100 text-blue-700",
    order: "bg-violet-100 text-violet-700", sale: "bg-green-100 text-green-700",
    pending: "bg-yellow-100 text-yellow-700", partial: "bg-orange-100 text-orange-700",
    received: "bg-green-100 text-green-700", cancelled: "bg-red-100 text-red-700",
    launched: "bg-blue-100 text-blue-700", in_progress: "bg-violet-100 text-violet-700",
    completed: "bg-green-100 text-green-700", blocked: "bg-red-100 text-red-700",
  };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[s] ?? "bg-gray-100 text-gray-600"}`}>{STATUS_LABELS[s] ?? s}</span>;
}

// ─── KPI card ────────────────────────────────────────────────────────────────

function KpiCard({ title, value, sub, icon: Icon, color = "amber" }: {
  title: string; value: string; sub?: string;
  icon: React.FC<{ className?: string }>;
  color?: "amber" | "green" | "blue" | "red" | "violet" | "orange";
}) {
  const bg = { amber: "bg-amber-50", green: "bg-green-50", blue: "bg-blue-50", red: "bg-red-50", violet: "bg-violet-50", orange: "bg-orange-50" }[color];
  const ic = { amber: "text-amber-600", green: "text-green-600", blue: "text-blue-600", red: "text-red-600", violet: "text-violet-600", orange: "text-orange-600" }[color];
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">{title}</p>
            <p className="text-xl font-bold text-foreground truncate">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center flex-shrink-0 ml-2`}>
            <Icon className={`w-5 h-5 ${ic}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2 pt-4 px-4"><CardTitle className="text-sm font-semibold">{title}</CardTitle></CardHeader>
      <CardContent className="px-4 pb-4">{children}</CardContent>
    </Card>
  );
}

function EmptyState({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <BarChart3 className="w-7 h-7 text-muted-foreground/30 mb-2" />
      <p className="text-xs text-muted-foreground">{message ?? "Aucune donnée disponible"}</p>
    </div>
  );
}

const DaTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-border rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }}>{p.name}: {formatDA(p.value)}</p>
      ))}
    </div>
  );
};
const DA_TICK = (v: number) => fmtK(v);

// ─── Filters bar ─────────────────────────────────────────────────────────────

type Filters = { from: string; to: string; branchId: string };

const PRESETS = [
  { label: "Ce mois", from: () => format(startOfMonth(new Date()), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "7 jours", from: () => format(subDays(new Date(), 6), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "30 jours", from: () => format(subDays(new Date(), 29), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "Cette année", from: () => format(startOfYear(new Date()), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "Tout", from: () => "2020-01-01", to: () => format(new Date(), "yyyy-MM-dd") },
];

function FiltersBar({ filters, onChange, branches }: { filters: Filters; onChange: (f: Filters) => void; branches: { id: number; name: string }[] }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-3">
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex gap-1 flex-wrap">
            {PRESETS.map(p => (
              <Button key={p.label} variant="outline" size="sm" className="text-xs h-8"
                onClick={() => onChange({ ...filters, from: p.from(), to: p.to() })}>
                {p.label}
              </Button>
            ))}
          </div>
          <div className="flex items-end gap-2 ml-auto flex-wrap">
            <div>
              <Label className="text-xs text-muted-foreground">Du</Label>
              <Input type="date" className="w-36 h-8 text-xs" value={filters.from}
                onChange={e => onChange({ ...filters, from: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Au</Label>
              <Input type="date" className="w-36 h-8 text-xs" value={filters.to}
                onChange={e => onChange({ ...filters, to: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Boutique</Label>
              <Select value={filters.branchId} onValueChange={v => onChange({ ...filters, branchId: v })}>
                <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="Toutes" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes les boutiques</SelectItem>
                  {branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── SALES TAB ───────────────────────────────────────────────────────────────

function SalesTab({ filters }: { filters: Filters }) {
  const params = useMemo(() => ({
    from: filters.from, to: filters.to,
    ...(filters.branchId !== "all" ? { branchId: parseInt(filters.branchId) } : {}),
  }), [filters]);
  const { data: d } = useGetSalesReport(params, { query: { queryKey: getGetSalesReportQueryKey(params) } });

  const analyticsQs = useMemo(() => {
    const qs = new URLSearchParams();
    if (filters.from) qs.set("from", filters.from);
    if (filters.to) qs.set("to", filters.to);
    if (filters.branchId !== "all") qs.set("branchId", filters.branchId);
    return qs.toString();
  }, [filters]);
  const { data: marginProducts = [] } = useQuery<any[]>({
    queryKey: ["analytics-sales-products", analyticsQs],
    queryFn: () => customFetch(`/api/analytics/sales/products${analyticsQs ? "?" + analyticsQs : ""}`),
    staleTime: 60_000,
  });

  const exportMarginPdf = useCallback(() => {
    import("jspdf").then(({ default: jsPDF }) =>
      import("jspdf-autotable").then(({ default: autoTable }) => {
        const doc = new jsPDF({ orientation: "landscape" });
        doc.setFontSize(14);
        doc.text("Rapport Marge par Produit", 14, 16);
        doc.setFontSize(9);
        doc.text(`Période : ${filters.from} → ${filters.to}`, 14, 22);
        autoTable(doc, {
          startY: 28,
          head: [["Produit", "CA (DA)", "Qté", "Coût Total (DA)", "Marge (DA)", "Marge %"]],
          body: marginProducts.map(p => [
            p.productName,
            new Intl.NumberFormat("fr-DZ").format(p.revenue),
            String(Math.round(p.qty)),
            new Intl.NumberFormat("fr-DZ").format(p.totalCost),
            new Intl.NumberFormat("fr-DZ").format(p.margin),
            `${p.marginPct.toFixed(1)}%`,
          ]),
          styles: { fontSize: 8 },
          headStyles: { fillColor: [180, 83, 9] },
        });
        doc.save(`marge-produits-${filters.from}-${filters.to}.pdf`);
      })
    );
  }, [marginProducts, filters]);

  if (!d) return <EmptyState message="Chargement..." />;

  const da = d as any;
  const convFunnel = [
    { name: "Devis", value: da.conversionFunnel?.quotes ?? 0, color: "#6366f1" },
    { name: "Commandes", value: da.conversionFunnel?.orders ?? 0, color: "#d97706" },
    { name: "Ventes", value: da.conversionFunnel?.sales ?? 0, color: "#16a34a" },
  ];
  const totalDocs = convFunnel[0].value || 1;
  const payMethodLabels: Record<string, string> = { cash: "Espèces", card: "Carte", credit: "Crédit", check: "Chèque", transfer: "Virement" };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard title="Chiffre d'affaires" value={formatDA(d.totalRevenue)} sub={`${d.totalOrders} ventes`} icon={TrendingUp} color="amber" />
        <KpiCard title="Encaissé" value={formatDA(d.totalPaid)} sub={`${pct(d.totalPaid, d.totalRevenue)}% du CA`} icon={CreditCard} color="green" />
        <KpiCard title="Restant dû" value={formatDA(d.totalDue)} sub={`${da.unpaidCount ?? 0} factures impayées`} icon={AlertTriangle} color="red" />
        <KpiCard title="Taux d'encaissement" value={`${pct(d.totalPaid, d.totalRevenue)}%`} sub="sur les ventes" icon={Receipt} color="blue" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionCard title="Évolution mensuelle">
          {(da.monthlyTrend ?? []).length === 0 ? <EmptyState /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={da.monthlyTrend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={DA_TICK} tick={{ fontSize: 11 }} width={48} />
                <Tooltip content={<DaTooltip />} />
                <Bar dataKey="amount" name="CA" fill="#b45309" radius={[3,3,0,0]} />
                <Bar dataKey="paid" name="Encaissé" fill="#16a34a" radius={[3,3,0,0]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        <SectionCard title="CA par boutique">
          {(d.byBranch ?? []).length === 0 ? <EmptyState /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={d.byBranch} layout="vertical" margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
                <XAxis type="number" tickFormatter={DA_TICK} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="branchName" width={110} tick={{ fontSize: 11 }} />
                <Tooltip content={<DaTooltip />} />
                <Bar dataKey="salesAmount" name="CA" fill="#b45309" radius={[0,3,3,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        <SectionCard title="Top produits vendus">
          {(da.topProducts ?? []).length === 0 ? <EmptyState /> : (
            <div className="flex gap-4">
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={da.topProducts} dataKey="revenue" nameKey="productName" cx="50%" cy="50%" outerRadius={75} innerRadius={35}>
                    {(da.topProducts ?? []).map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => formatDA(v)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1.5 overflow-hidden py-1">
                {(da.topProducts ?? []).map((p: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 min-w-0">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                    <span className="text-xs truncate flex-1">{p.productName}</span>
                    <span className="text-xs font-semibold text-muted-foreground flex-shrink-0">{fmtK(p.revenue)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>

        <Card className="border-0 shadow-sm md:col-span-2">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Marge par produit (Top 20)</CardTitle>
              {marginProducts.length > 0 && (
                <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={exportMarginPdf}>
                  <FileDown className="h-3.5 w-3.5" /> Exporter PDF
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {marginProducts.length === 0 ? <EmptyState /> : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Produit</TableHead>
                      <TableHead className="text-xs text-right">CA</TableHead>
                      <TableHead className="text-xs text-right">Qté</TableHead>
                      <TableHead className="text-xs text-right">Coût total</TableHead>
                      <TableHead className="text-xs text-right">Marge</TableHead>
                      <TableHead className="text-xs text-right">Marge %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {marginProducts.map((p: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs font-medium py-1.5">{p.productName}</TableCell>
                        <TableCell className="text-xs text-right py-1.5">{formatDA(p.revenue)}</TableCell>
                        <TableCell className="text-xs text-right py-1.5">{Math.round(p.qty)}</TableCell>
                        <TableCell className="text-xs text-right py-1.5">{formatDA(p.totalCost)}</TableCell>
                        <TableCell className={`text-xs text-right py-1.5 font-semibold ${p.margin >= 0 ? "text-green-600" : "text-red-600"}`}>{formatDA(p.margin)}</TableCell>
                        <TableCell className="text-xs text-right py-1.5">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${p.marginPct >= 30 ? "bg-green-100 text-green-700" : p.marginPct >= 10 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                            {p.marginPct.toFixed(1)}%
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <SectionCard title="Entonnoir de conversion">
          <div className="space-y-3 py-2">
            {convFunnel.map((item, i) => (
              <div key={i}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-medium">{item.name}</span>
                  <span className="font-bold">{item.value}</span>
                </div>
                <div className="h-8 rounded-md flex items-center px-3" style={{ background: item.color + "18", width: `${Math.max(8, pct(item.value, totalDocs))}%`, minWidth: "70px" }}>
                  <span className="text-xs font-bold" style={{ color: item.color }}>
                    {i === 0 ? "100%" : `${pct(item.value, totalDocs)}%`}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {(d.byPaymentMethod ?? []).length > 0 && (
            <div className="border-t pt-3 mt-3">
              <p className="text-xs font-semibold mb-2">Modes de paiement</p>
              <div className="flex flex-wrap gap-2">
                {(d.byPaymentMethod ?? []).map((m: any, i: number) => (
                  <div key={i} className="text-xs bg-muted rounded-md px-2.5 py-1.5">
                    <span className="text-muted-foreground">{payMethodLabels[m.method] ?? m.method}: </span>
                    <span className="font-semibold">{formatDA(m.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      {(da.byCustomer ?? []).length > 0 && (
        <SectionCard title="Ventes par client">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Client</TableHead>
                  <TableHead className="text-xs text-right">Ventes</TableHead>
                  <TableHead className="text-xs text-right">CA</TableHead>
                  <TableHead className="text-xs text-right">Encaissé</TableHead>
                  <TableHead className="text-xs text-right">Restant</TableHead>
                  <TableHead className="text-xs">Recouvrement</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(da.byCustomer ?? []).map((c: any, i: number) => (
                  <TableRow key={i} className="hover:bg-muted/30">
                    <TableCell className="text-xs font-medium">{c.customerName}</TableCell>
                    <TableCell className="text-xs text-right">{c.count}</TableCell>
                    <TableCell className="text-xs text-right font-medium">{formatDA(c.amount)}</TableCell>
                    <TableCell className="text-xs text-right text-green-700">{formatDA(c.paid)}</TableCell>
                    <TableCell className="text-xs text-right text-red-600">{formatDA(c.amount - c.paid)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress value={pct(c.paid, c.amount)} className="h-1.5 w-16" />
                        <span className="text-xs text-muted-foreground">{pct(c.paid, c.amount)}%</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

// ─── PURCHASES TAB ───────────────────────────────────────────────────────────

function PurchasesTab({ filters }: { filters: Filters }) {
  const params = useMemo(() => ({
    from: filters.from, to: filters.to,
    ...(filters.branchId !== "all" ? { branchId: parseInt(filters.branchId) } : {}),
  }), [filters]);
  const { data: d } = useGetPurchasesReport(params, { query: { queryKey: getGetPurchasesReportQueryKey(params) } });
  if (!d) return <EmptyState message="Chargement..." />;
  const da = d as any;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard title="Total achats" value={formatDA(d.totalPurchases)} sub={`${da.count ?? 0} bons d'achat`} icon={ShoppingCart} color="amber" />
        <KpiCard title="Payé fournisseurs" value={formatDA(d.totalPaid)} sub={`${pct(d.totalPaid, d.totalPurchases)}% réglé`} icon={CreditCard} color="green" />
        <KpiCard title="Restant à payer" value={formatDA(d.totalDue)} sub="Dettes fournisseurs" icon={AlertTriangle} color="red" />
        <KpiCard title="Réceptions en attente" value={String(da.pendingReceptions?.length ?? 0)} sub="BL à réceptionner" icon={Package} color="blue" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionCard title="Achats par fournisseur">
          {(d.bySupplier ?? []).length === 0 ? <EmptyState /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={(d.bySupplier ?? []).slice(0,6)} layout="vertical" margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
                <XAxis type="number" tickFormatter={DA_TICK} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="supplierName" width={120} tick={{ fontSize: 11 }} />
                <Tooltip content={<DaTooltip />} />
                <Bar dataKey="amount" name="Montant" fill="#d97706" radius={[0,3,3,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        <SectionCard title="Achats par boutique">
          {(da.byBranch ?? []).length === 0 ? <EmptyState /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={da.byBranch} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="branchName" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={DA_TICK} tick={{ fontSize: 11 }} width={48} />
                <Tooltip content={<DaTooltip />} />
                <Bar dataKey="amount" name="Achats" fill="#b45309" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        <SectionCard title="Répartition par statut">
          <div className="space-y-2.5 py-1">
            {Object.entries(da.byStatus ?? {}).map(([status, v]: [string, any]) => (
              <div key={status} className="flex items-center gap-3">
                <div className="w-24 flex-shrink-0"><StatusBadge s={status} /></div>
                <div className="flex-1">
                  <Progress value={pct(v.count, da.count ?? 1)} className="h-2" />
                </div>
                <div className="text-xs text-right w-28 flex-shrink-0">
                  <span className="font-semibold">{v.count}</span>
                  <span className="text-muted-foreground ml-1">— {fmtK(v.amount)} DA</span>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Produits les plus achetés">
          {(d.byProduct ?? []).length === 0 ? <EmptyState /> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Produit</TableHead>
                    <TableHead className="text-xs text-right">Quantité</TableHead>
                    <TableHead className="text-xs text-right">Montant</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(d.byProduct ?? []).slice(0,8).map((p: any, i: number) => (
                    <TableRow key={i} className="hover:bg-muted/30">
                      <TableCell className="text-xs font-medium">{p.productName}</TableCell>
                      <TableCell className="text-xs text-right">{Number(p.quantity).toLocaleString("fr-DZ")}</TableCell>
                      <TableCell className="text-xs text-right font-medium">{formatDA(p.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </SectionCard>
      </div>

      {(da.pendingReceptions ?? []).length > 0 && (
        <SectionCard title="Réceptions en attente">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Référence</TableHead>
                  <TableHead className="text-xs">Fournisseur</TableHead>
                  <TableHead className="text-xs">Boutique</TableHead>
                  <TableHead className="text-xs">Statut</TableHead>
                  <TableHead className="text-xs text-right">Total</TableHead>
                  <TableHead className="text-xs text-right">Payé</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {da.pendingReceptions.map((p: any, i: number) => (
                  <TableRow key={i} className="hover:bg-muted/30">
                    <TableCell className="text-xs font-mono">{p.reference}</TableCell>
                    <TableCell className="text-xs">{p.supplierName}</TableCell>
                    <TableCell className="text-xs">{p.branchName}</TableCell>
                    <TableCell><StatusBadge s={p.status} /></TableCell>
                    <TableCell className="text-xs text-right">{formatDA(p.total)}</TableCell>
                    <TableCell className="text-xs text-right text-green-700">{formatDA(p.paid)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

// ─── STOCK TAB ───────────────────────────────────────────────────────────────

function StockTab({ filters }: { filters: Filters }) {
  const params = useMemo(() => ({
    ...(filters.branchId !== "all" ? { branchId: parseInt(filters.branchId) } : {}),
  }), [filters]);
  const { data: d } = useGetStockValuationReport(params, { query: { queryKey: getGetStockValuationReportQueryKey(params) } });
  if (!d) return <EmptyState message="Chargement..." />;
  const da = d as any;

  const criticalItems = da.criticalItems ?? [];
  const movSummary = da.movementsSummary ?? [];
  const transferActivity = da.transferActivity ?? [];
  const movTypeLabels: Record<string, string> = {
    sale: "Vente", purchase: "Achat", transfer_in: "Transfert entrant", transfer_out: "Transfert sortant",
    production_out: "Production (consommé)", production_in: "Production (produit)",
    adjustment: "Ajustement", transfer_cancel: "Annulation transfert",
  };
  const statusColor = { ok: "text-green-600", low: "text-yellow-600", critical: "text-red-500", out: "text-red-700" };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard title="Valeur totale stock" value={formatDA(d.totalValue)} sub={`${d.items?.length ?? 0} références`} icon={Boxes} color="amber" />
        <KpiCard title="Articles critiques" value={String(criticalItems.filter((i: any) => i.status === "critical").length)} sub="Stock ≤ 50% du seuil" icon={AlertTriangle} color="red" />
        <KpiCard title="Articles en rupture" value={String(criticalItems.filter((i: any) => i.status === "out").length)} sub="Quantité = 0" icon={XCircle} color="red" />
        <KpiCard title="Catégories" value={String(d.byCategory?.length ?? 0)} sub="groupes de produits" icon={Package} color="blue" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionCard title="Valorisation par boutique">
          {(da.byBranch ?? []).length === 0 ? <EmptyState /> : (
            <div className="space-y-3 py-1">
              {(da.byBranch ?? []).map((b: any, i: number) => (
                <div key={i}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium">{b.branchName}</span>
                    <span className="font-bold">{formatDA(b.value)}</span>
                  </div>
                  <Progress value={pct(b.value, d.totalValue)} className="h-2" />
                  <p className="text-xs text-muted-foreground mt-0.5">{b.products ?? 0} produits</p>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Répartition par catégorie">
          {(d.byCategory ?? []).length === 0 ? <EmptyState /> : (
            <div className="flex gap-4">
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={d.byCategory} dataKey="value" nameKey="categoryName" cx="50%" cy="50%" outerRadius={75} innerRadius={35}>
                    {(d.byCategory ?? []).map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => formatDA(v)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1.5 overflow-hidden py-1">
                {(d.byCategory as any[]).map((c: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 min-w-0">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                    <span className="text-xs truncate flex-1">{c.categoryName}</span>
                    <span className="text-xs font-semibold text-muted-foreground">{fmtK(c.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Mouvements de stock (30 jours)">
          {movSummary.length === 0 ? <EmptyState message="Aucun mouvement récent" /> : (
            <div className="space-y-2 py-1">
              {movSummary.map((m: any, i: number) => (
                <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
                  <span className="text-xs font-medium">{movTypeLabels[m.type] ?? m.type}</span>
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span><span className="font-semibold text-foreground">{m.count}</span> mvts</span>
                    <span><span className="font-semibold text-foreground">{Math.round(m.qty).toLocaleString("fr-DZ")}</span> u.</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Transferts inter-boutiques récents">
          {transferActivity.length === 0 ? <EmptyState message="Aucun transfert enregistré" /> : (
            <div className="space-y-2 py-1">
              {transferActivity.map((t: any, i: number) => (
                <div key={i} className="flex items-center gap-2 py-1.5 border-b border-border/40 last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="font-mono text-muted-foreground">{t.reference}</span>
                      <StatusBadge s={t.status} />
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                      <span className="truncate">{t.sourceBranchName}</span>
                      <ChevronRight className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{t.destinationBranchName}</span>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground flex-shrink-0">{fmtDate(t.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {criticalItems.length > 0 && (
        <SectionCard title="Alertes stock — articles critiques & ruptures">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Produit</TableHead>
                  <TableHead className="text-xs">Boutique</TableHead>
                  <TableHead className="text-xs">Statut</TableHead>
                  <TableHead className="text-xs text-right">Quantité</TableHead>
                  <TableHead className="text-xs text-right">Seuil</TableHead>
                  <TableHead className="text-xs text-right">Valeur</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {criticalItems.map((item: any, i: number) => (
                  <TableRow key={i} className="hover:bg-muted/30">
                    <TableCell className="text-xs font-medium">{item.productName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{item.branchName}</TableCell>
                    <TableCell>
                      <span className={`text-xs font-semibold ${statusColor[item.status as keyof typeof statusColor]}`}>
                        {{ ok: "OK", low: "⚠ Faible", critical: "⚠ Critique", out: "✗ Rupture" }[item.status as string] ?? item.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-right font-mono">{item.quantity} {item.unitName}</TableCell>
                    <TableCell className="text-xs text-right text-muted-foreground">{item.alertQuantity ?? "—"} {item.unitName}</TableCell>
                    <TableCell className="text-xs text-right">{formatDA(item.valueCost)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

// ─── PRODUCTION TAB ──────────────────────────────────────────────────────────

function ProductionTab({ filters }: { filters: Filters }) {
  const params = useMemo(() => ({
    from: filters.from, to: filters.to,
    ...(filters.branchId !== "all" ? { branchId: parseInt(filters.branchId) } : {}),
  }), [filters]);
  const { data: d } = useGetProductionReport(params, { query: { queryKey: getGetProductionReportQueryKey(params) } });
  if (!d) return <EmptyState message="Chargement..." />;
  const da = d as any;
  const recentOrders = da.recentOrders ?? [];
  const byBranch = da.byBranch ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard title="Total ordres" value={String(d.totalOrders)} sub="bons de production" icon={Factory} color="amber" />
        <KpiCard title="Terminés" value={String(d.completed)} sub={`${pct(d.completed, d.totalOrders)}% taux de réalisation`} icon={CheckCircle2} color="green" />
        <KpiCard title="En cours" value={String(d.inProgress)} sub="lancés ou en progression" icon={Clock} color="blue" />
        <KpiCard title="Bloqués" value={String(da.blocked ?? 0)} sub="manque d'ingrédients" icon={AlertTriangle} color="red" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionCard title="Production par recette">
          {(d.byProduct ?? []).length === 0 ? <EmptyState /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={d.byProduct} layout="vertical" margin={{ top: 4, right: 32, left: 0, bottom: 0 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="productName" width={130} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="orders" name="Ordres" fill="#b45309" radius={[0,3,3,0]} />
                <Bar dataKey="quantity" name="Qté produite" fill="#d97706" radius={[0,3,3,0]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        <SectionCard title="Production par atelier / laboratoire">
          {byBranch.length === 0 ? <EmptyState /> : (
            <div className="space-y-3 py-1">
              {byBranch.map((b: any, i: number) => (
                <div key={i}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium">{b.branchName}</span>
                    <span className="text-muted-foreground">{b.completed}/{b.count} terminés</span>
                  </div>
                  <Progress value={pct(b.completed, b.count)} className="h-2" />
                  <p className="text-xs text-muted-foreground mt-0.5">Coût théorique: {formatDA(b.cost)}</p>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Analyse des coûts">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground">Coût théorique</p>
                <p className="text-lg font-bold">{formatDA(d.theoreticalCost)}</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground">Coût réel</p>
                <p className="text-lg font-bold">{d.actualCost > 0 ? formatDA(d.actualCost) : <span className="text-muted-foreground text-sm">Non relevé</span>}</p>
              </div>
            </div>
            {d.theoreticalCost > 0 && (
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span>Progression vers objectif</span>
                  <span className="font-bold text-amber-600">{pct(d.completed, d.totalOrders)}%</span>
                </div>
                <Progress value={pct(d.completed, d.totalOrders)} className="h-2" />
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Statuts de production">
          <div className="space-y-2.5 py-1">
            {([
              { label: "Planifié", statuses: ["planned"], icon: Clock, color: "text-blue-600" },
              { label: "Lancé / En cours", statuses: ["launched","in_progress"], icon: ArrowUpDown, color: "text-amber-600" },
              { label: "Terminé", statuses: ["completed"], icon: CheckCircle2, color: "text-green-600" },
              { label: "Bloqué", statuses: ["blocked"], icon: AlertTriangle, color: "text-red-600" },
            ] as const).map((s, i) => {
              const count = recentOrders.filter((o: any) => s.statuses.includes(o.status)).length
                + (s.label === "Terminé" ? d.completed : 0);
              const total = d.totalOrders || 1;
              if (count === 0 && i < 2) return null;
              return (
                <div key={i} className="flex items-center gap-2">
                  <s.icon className={`w-4 h-4 ${s.color} flex-shrink-0`} />
                  <span className="text-xs flex-1">{s.label}</span>
                  <span className="text-xs font-bold w-8 text-right">{i === 2 ? d.completed : i === 3 ? da.blocked ?? 0 : count}</span>
                  <Progress value={pct(i === 2 ? d.completed : i === 3 ? da.blocked ?? 0 : count, total)} className="h-1.5 w-20" />
                </div>
              );
            })}
          </div>
        </SectionCard>
      </div>

      {recentOrders.length > 0 && (
        <SectionCard title="Ordres de production récents">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Référence</TableHead>
                  <TableHead className="text-xs">Produit</TableHead>
                  <TableHead className="text-xs">Atelier</TableHead>
                  <TableHead className="text-xs">Statut</TableHead>
                  <TableHead className="text-xs text-right">Qté prévue</TableHead>
                  <TableHead className="text-xs text-right">Qté réelle</TableHead>
                  <TableHead className="text-xs text-right">Coût théorique</TableHead>
                  <TableHead className="text-xs">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentOrders.map((o: any, i: number) => (
                  <TableRow key={i} className="hover:bg-muted/30">
                    <TableCell className="text-xs font-mono">{o.reference}</TableCell>
                    <TableCell className="text-xs font-medium">{o.productName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{o.branchName}</TableCell>
                    <TableCell><StatusBadge s={o.status} /></TableCell>
                    <TableCell className="text-xs text-right">{o.quantity}</TableCell>
                    <TableCell className="text-xs text-right">{o.actualQuantity ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-xs text-right">{formatDA(o.theoreticalCost)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(o.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

// ─── FINANCIAL TAB ───────────────────────────────────────────────────────────

type FinancialReport = {
  totalRevenue: number; totalCollected: number; totalReceivables: number;
  totalPurchases: number; totalPurchasesPaid: number; totalPayables: number;
  totalExpenses: number; netBalance: number;
  netPosition: number; collectionRate: number;
  receivables: Array<{ customerName: string; due: number; total: number; paid: number; overdueCount: number }>;
  payables: Array<{ supplierName: string; due: number; total: number; paid: number; count: number }>;
  creditExposure: Array<{ customerName: string; creditLimit: number; currentDue: number; utilization: number; status: string }>;
  expensesByCategory: Array<{ category: string; amount: number; count: number }>;
};

type ExpensesReport = {
  totalExpenses: number; totalValidated: number; totalDraft: number; draftCount: number;
  byCategory: Array<{ category: string; amount: number; count: number }>;
  byBranch: Array<{ branchId: number; branchName: string; amount: number; count: number }>;
  byMonth: Array<{ month: string; amount: number; count: number }>;
  byPaymentMethod: Array<{ paymentMethod: string; amount: number; count: number }>;
  recentExpenses: Array<{ id: number; reference: string; date: string; category: string; amount: number; branchName: string; paymentMethod: string; status: string; notes: string | null }>;
};

function FinancialTab() {
  const { data: d } = useQuery<FinancialReport>({
    queryKey: ["/api/reports/financial"],
    queryFn: () => customFetch("/api/reports/financial"),
  });
  if (!d) return <EmptyState message="Chargement..." />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard title="Créances clients" value={formatDA(d.totalReceivables)} sub="montants non encaissés" icon={TrendingUp} color="amber" />
        <KpiCard title="Dettes fournisseurs" value={formatDA(d.totalPayables)} sub="factures non réglées" icon={TrendingDown} color="red" />
        <KpiCard title="Dépenses validées" value={formatDA(d.totalExpenses)} sub="charges d'exploitation" icon={Receipt} color="orange" />
        <KpiCard title="Position nette" value={formatDA(d.netPosition)} sub={d.netPosition >= 0 ? "excédentaire" : "déficitaire"} icon={BarChart3} color={d.netPosition >= 0 ? "green" : "red"} />
        <KpiCard title="Solde opérationnel" value={formatDA(d.netBalance)} sub="encaissé − achats − charges" icon={CreditCard} color={d.netBalance >= 0 ? "green" : "red"} />
        <KpiCard title="Recouvrement" value={`${Math.round(d.collectionRate)}%`} sub="sur le CA total" icon={ChevronRight} color="blue" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionCard title="Créances par client">
          {d.receivables.length === 0 ? <EmptyState message="Aucune créance en cours" /> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Client</TableHead>
                    <TableHead className="text-xs text-right">Factures</TableHead>
                    <TableHead className="text-xs text-right">Restant dû</TableHead>
                    <TableHead className="text-xs">Recouvrement</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.receivables.map((r, i) => (
                    <TableRow key={i} className="hover:bg-muted/30">
                      <TableCell className="text-xs font-medium">{r.customerName}</TableCell>
                      <TableCell className="text-xs text-right">{r.overdueCount}</TableCell>
                      <TableCell className="text-xs text-right font-bold text-red-600">{formatDA(r.due)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={pct(r.paid, r.total)} className="h-1.5 w-16" />
                          <span className="text-xs text-muted-foreground">{pct(r.paid, r.total)}%</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Dettes par fournisseur">
          {d.payables.length === 0 ? <EmptyState message="Aucune dette en cours" /> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Fournisseur</TableHead>
                    <TableHead className="text-xs text-right">BL</TableHead>
                    <TableHead className="text-xs text-right">Restant dû</TableHead>
                    <TableHead className="text-xs">Règlement</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.payables.map((p, i) => (
                    <TableRow key={i} className="hover:bg-muted/30">
                      <TableCell className="text-xs font-medium">{p.supplierName}</TableCell>
                      <TableCell className="text-xs text-right">{p.count}</TableCell>
                      <TableCell className="text-xs text-right font-bold text-red-600">{formatDA(p.due)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={pct(p.paid, p.total)} className="h-1.5 w-16" />
                          <span className="text-xs text-muted-foreground">{pct(p.paid, p.total)}%</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </SectionCard>

        {d.expensesByCategory.length > 0 && (
          <SectionCard title="Charges par catégorie">
            <div className="space-y-2">
              {d.expensesByCategory.map((c, i) => {
                const maxAmt = d.expensesByCategory[0]?.amount ?? 1;
                return (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-28 text-xs text-muted-foreground truncate capitalize">{c.category.replace(/_/g, " ")}</div>
                    <div className="flex-1">
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-orange-400" style={{ width: `${(c.amount / maxAmt) * 100}%` }} />
                      </div>
                    </div>
                    <div className="text-xs font-semibold w-32 text-right">{formatDA(c.amount)}</div>
                    <div className="text-xs text-muted-foreground w-8 text-right">{c.count}</div>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        )}

        {d.creditExposure.length > 0 && (
          <SectionCard title="Exposition crédit clients">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Client</TableHead>
                    <TableHead className="text-xs text-right">Plafond</TableHead>
                    <TableHead className="text-xs text-right">Utilisé</TableHead>
                    <TableHead className="text-xs">Utilisation</TableHead>
                    <TableHead className="text-xs">Statut</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.creditExposure.map((c, i) => (
                    <TableRow key={i} className="hover:bg-muted/30">
                      <TableCell className="text-xs font-medium">{c.customerName}</TableCell>
                      <TableCell className="text-xs text-right">{formatDA(c.creditLimit)}</TableCell>
                      <TableCell className="text-xs text-right font-semibold">{formatDA(c.currentDue)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={Math.min(c.utilization, 100)} className="h-2 w-20" />
                          <span className={`text-xs font-bold ${c.status === "exceeded" ? "text-red-600" : c.status === "warning" ? "text-amber-600" : "text-green-600"}`}>
                            {Math.round(c.utilization)}%
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={`text-xs font-semibold ${c.status === "exceeded" ? "text-red-600" : c.status === "warning" ? "text-amber-600" : "text-green-600"}`}>
                          {c.status === "exceeded" ? "⚠ Dépassé" : c.status === "warning" ? "⚡ Attention" : "✓ OK"}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </SectionCard>
        )}

        <div className="md:col-span-2">
          <SectionCard title="Vue d'ensemble opérationnelle">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { label: "CA facturé", value: d.totalRevenue, color: "bg-amber-50 border-amber-200" },
                { label: "CA encaissé", value: d.totalCollected, color: "bg-green-50 border-green-200" },
                { label: "Achats total", value: d.totalPurchases, color: "bg-blue-50 border-blue-200" },
                { label: "Achats réglés", value: d.totalPurchasesPaid, color: "bg-violet-50 border-violet-200" },
                { label: "Dépenses", value: d.totalExpenses, color: "bg-orange-50 border-orange-200" },
                { label: "Solde net", value: d.netBalance, color: d.netBalance >= 0 ? "bg-emerald-50 border-emerald-300" : "bg-red-50 border-red-200" },
              ].map((item, i) => (
                <div key={i} className={`rounded-lg p-3 border ${item.color}`}>
                  <p className="text-xs text-muted-foreground mb-1">{item.label}</p>
                  <p className="text-base font-bold">{formatDA(item.value)}</p>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

// ─── EXPENSES TAB ────────────────────────────────────────────────────────────

const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  loyer: "Loyer", electricite: "Électricité", eau: "Eau", telephone: "Téléphone",
  internet: "Internet", transport: "Transport", salaires: "Salaires",
  maintenance: "Maintenance", fournitures: "Fournitures", marketing: "Marketing",
  formation: "Formation", impots: "Impôts / taxes", autre: "Autre",
};
const PAYMENT_LABELS: Record<string, string> = {
  cash: "Espèces", virement: "Virement", cheque: "Chèque", carte: "Carte",
};

function ExpensesTab({ filters }: { filters: Filters }) {
  const [localFilters, setLocalFilters] = useState<{ category: string; paymentMethod: string }>({
    category: "all", paymentMethod: "all",
  });

  const params = new URLSearchParams();
  if (filters.branchId !== "all") params.set("branchId", filters.branchId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (localFilters.category !== "all") params.set("category", localFilters.category);
  if (localFilters.paymentMethod !== "all") params.set("paymentMethod", localFilters.paymentMethod);
  const qs = params.toString();

  const { data: d } = useQuery<ExpensesReport>({
    queryKey: ["/api/reports/expenses", qs],
    queryFn: () => customFetch(`/api/reports/expenses${qs ? `?${qs}` : ""}`),
  });

  if (!d) return <EmptyState message="Chargement..." />;

  const monthChartData = d.byMonth.map(m => ({
    month: m.month.substring(5) + "/" + m.month.substring(2, 4),
    Dépenses: Math.round(m.amount),
  }));

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={localFilters.category} onValueChange={v => setLocalFilters(f => ({ ...f, category: v }))}>
          <SelectTrigger className="h-8 text-xs w-44">
            <SelectValue placeholder="Catégorie" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes catégories</SelectItem>
            {Object.entries(EXPENSE_CATEGORY_LABELS).map(([v, l]) => (
              <SelectItem key={v} value={v}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={localFilters.paymentMethod} onValueChange={v => setLocalFilters(f => ({ ...f, paymentMethod: v }))}>
          <SelectTrigger className="h-8 text-xs w-40">
            <SelectValue placeholder="Mode de paiement" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous modes</SelectItem>
            {Object.entries(PAYMENT_LABELS).map(([v, l]) => (
              <SelectItem key={v} value={v}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(localFilters.category !== "all" || localFilters.paymentMethod !== "all") && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setLocalFilters({ category: "all", paymentMethod: "all" })}>
            Réinitialiser
          </Button>
        )}
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard title="Total dépenses" value={formatDA(d.totalExpenses)} sub={`${d.totalValidated} entrées validées`} icon={Receipt} color="orange" />
        <KpiCard title="En attente (brouillon)" value={formatDA(d.totalDraft)} sub={`${d.draftCount} à valider`} icon={Clock} color="amber" />
        <KpiCard title="Boutiques actives" value={String(d.byBranch.length)} sub="avec des dépenses" icon={Building2} color="blue" />
        <KpiCard title="Catégories" value={String(d.byCategory.length)} sub="types de charges" icon={ArrowUpDown} color="violet" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Monthly trend chart */}
        {monthChartData.length > 0 && (
          <SectionCard title="Évolution mensuelle des dépenses">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthChartData} barSize={28}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={v => fmtK(v)} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => formatDA(v)} />
                <Bar dataKey="Dépenses" fill="#f97316" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </SectionCard>
        )}

        {/* By category */}
        <SectionCard title="Répartition par catégorie">
          {d.byCategory.length === 0 ? <EmptyState message="Aucune dépense validée" /> : (
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {d.byCategory.map((c, i) => {
                const maxAmt = d.byCategory[0]?.amount ?? 1;
                const label = EXPENSE_CATEGORY_LABELS[c.category] ?? c.category;
                return (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-24 text-xs text-muted-foreground truncate">{label}</div>
                    <div className="flex-1">
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(c.amount / maxAmt) * 100}%`, backgroundColor: COLORS[i % COLORS.length] }} />
                      </div>
                    </div>
                    <div className="text-xs font-semibold w-28 text-right">{formatDA(c.amount)}</div>
                    <div className="text-xs text-muted-foreground w-6 text-right">{c.count}</div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>

        {/* By branch */}
        {d.byBranch.length > 0 && (
          <SectionCard title="Dépenses par boutique">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Boutique</TableHead>
                    <TableHead className="text-xs text-right">Nb</TableHead>
                    <TableHead className="text-xs text-right">Montant total</TableHead>
                    <TableHead className="text-xs">Part</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.byBranch.map((b, i) => (
                    <TableRow key={i} className="hover:bg-muted/30">
                      <TableCell className="text-xs font-medium">{b.branchName}</TableCell>
                      <TableCell className="text-xs text-right">{b.count}</TableCell>
                      <TableCell className="text-xs text-right font-bold">{formatDA(b.amount)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={pct(b.amount, d.totalExpenses)} className="h-1.5 w-16" />
                          <span className="text-xs text-muted-foreground">{pct(b.amount, d.totalExpenses)}%</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </SectionCard>
        )}

        {/* By payment method */}
        {d.byPaymentMethod.length > 0 && (
          <SectionCard title="Modes de paiement utilisés">
            <div className="space-y-2">
              {d.byPaymentMethod.map((p, i) => {
                const label = PAYMENT_LABELS[p.paymentMethod] ?? p.paymentMethod;
                return (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-24 text-xs font-medium">{label}</div>
                    <div className="flex-1">
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-blue-400" style={{ width: `${pct(p.amount, d.totalExpenses)}%` }} />
                      </div>
                    </div>
                    <div className="text-xs font-semibold w-28 text-right">{formatDA(p.amount)}</div>
                    <div className="text-xs text-muted-foreground w-8 text-right">{p.count} op.</div>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        )}

        {/* Recent expenses table */}
        <div className="md:col-span-2">
          <SectionCard title="Dépenses récentes (validées &amp; brouillons)">
            {d.recentExpenses.length === 0 ? <EmptyState message="Aucune dépense" /> : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Réf.</TableHead>
                      <TableHead className="text-xs">Date</TableHead>
                      <TableHead className="text-xs">Boutique</TableHead>
                      <TableHead className="text-xs">Catégorie</TableHead>
                      <TableHead className="text-xs">Mode</TableHead>
                      <TableHead className="text-xs text-right">Montant</TableHead>
                      <TableHead className="text-xs">Statut</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.recentExpenses.map((e, i) => (
                      <TableRow key={i} className="hover:bg-muted/30">
                        <TableCell className="text-xs font-mono text-muted-foreground">{e.reference}</TableCell>
                        <TableCell className="text-xs">{fmtDate(e.date)}</TableCell>
                        <TableCell className="text-xs">{e.branchName}</TableCell>
                        <TableCell className="text-xs capitalize">{EXPENSE_CATEGORY_LABELS[e.category] ?? e.category}</TableCell>
                        <TableCell className="text-xs">{PAYMENT_LABELS[e.paymentMethod] ?? e.paymentMethod}</TableCell>
                        <TableCell className="text-xs text-right font-semibold">{formatDA(e.amount)}</TableCell>
                        <TableCell>
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${e.status === "validated" ? "bg-green-100 text-green-700" : e.status === "draft" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500"}`}>
                            {e.status === "validated" ? "Validé" : e.status === "draft" ? "Brouillon" : "Annulé"}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

// ─── BRANCH PERFORMANCE TAB ──────────────────────────────────────────────────

function BranchTab() {
  const { data: raw = [] } = useGetBranchPerformance({ query: { queryKey: getGetBranchPerformanceQueryKey() } });
  const branches = (raw as any[]).filter((b: any) => b.branchId !== 5);

  const maxSales = Math.max(...branches.map((b: any) => b.salesAmount), 1);
  const maxStock = Math.max(...branches.map((b: any) => b.stockValue), 1);
  const maxPurch = Math.max(...branches.map((b: any) => b.purchaseAmount), 1);

  return (
    <div className="space-y-4">
      <div className={`grid gap-3`} style={{ gridTemplateColumns: `repeat(${Math.min(branches.length, 4)}, minmax(0, 1fr))` }}>
        {branches.map((b: any, i: number) => (
          <Card key={i} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-9 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                <div>
                  <p className="text-xs font-bold leading-tight">{b.branchName}</p>
                  <p className="text-xs text-muted-foreground capitalize">{b.branchType ?? "boutique"}</p>
                </div>
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">Ventes</span><span className="font-semibold">{fmtK(b.salesAmount)} DA</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Achats</span><span className="font-semibold">{fmtK(b.purchaseAmount)} DA</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Stock</span><span className="font-semibold">{fmtK(b.stockValue)} DA</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Production</span><span className="font-semibold">{b.productionCompleted}/{b.productionCount}</span></div>
                {b.lowStockItems > 0 && (
                  <div className="flex items-center gap-1 text-amber-600 pt-1">
                    <AlertTriangle className="w-3 h-3" />
                    <span>{b.lowStockItems} alerte(s) stock</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { title: "CA par boutique", key: "salesAmount", max: maxSales },
          { title: "Valeur stock", key: "stockValue", max: maxStock },
          { title: "Volume achats", key: "purchaseAmount", max: maxPurch },
        ].map((chart, ci) => (
          <SectionCard key={ci} title={chart.title}>
            <div className="space-y-2 py-1">
              {[...branches].sort((a: any, b: any) => b[chart.key] - a[chart.key]).map((b: any, i: number) => (
                <div key={i}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium truncate">{b.branchName}</span>
                    <span className="font-bold flex-shrink-0 ml-2">{fmtK(b[chart.key])} DA</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct(b[chart.key], chart.max)}%`, background: COLORS[i % COLORS.length] }} />
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        ))}
      </div>

      <SectionCard title="Tableau comparatif complet">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Boutique</TableHead>
                <TableHead className="text-xs text-right">Ventes (DA)</TableHead>
                <TableHead className="text-xs text-right">Nbre ventes</TableHead>
                <TableHead className="text-xs text-right">Encaissé</TableHead>
                <TableHead className="text-xs text-right">Achats (DA)</TableHead>
                <TableHead className="text-xs text-right">Stock (DA)</TableHead>
                <TableHead className="text-xs text-right">Production</TableHead>
                <TableHead className="text-xs text-right">Alertes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {branches.map((b: any, i: number) => (
                <TableRow key={i} className="hover:bg-muted/30">
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="text-xs font-medium">{b.branchName}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-right font-semibold">{formatDA(b.salesAmount)}</TableCell>
                  <TableCell className="text-xs text-right">{b.salesCount}</TableCell>
                  <TableCell className="text-xs text-right text-green-700">{formatDA(b.salesPaid)}</TableCell>
                  <TableCell className="text-xs text-right">{formatDA(b.purchaseAmount)}</TableCell>
                  <TableCell className="text-xs text-right">{formatDA(b.stockValue)}</TableCell>
                  <TableCell className="text-xs text-right">{b.productionCompleted}/{b.productionCount}</TableCell>
                  <TableCell className="text-xs text-right">
                    {b.lowStockItems > 0
                      ? <span className="text-amber-600 font-semibold">{b.lowStockItems}</span>
                      : <span className="text-green-600">—</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </SectionCard>
    </div>
  );
}

// ─── RETURNS / AVOIRS TAB ────────────────────────────────────────────────────

type ReturnDetail = {
  id: number; reference: string; saleRef: string;
  customerName: string; branchName: string; status: string;
  reason: string; totalAmount: number; refundedAmount: number;
  remainingRefund: number; createdByName: string; createdAt: string;
};
type ReturnsReport = {
  totalAmount: number; totalRefunded: number; pendingRefund: number;
  returnCount: number; totalCount: number; returnRate: number;
  avgReturnAmount: number; totalSales: number;
  byStatus: Array<{ status: string; count: number; amount: number }>;
  byBranch: Array<{ branchId: number; branchName: string; count: number; amount: number; refunded: number }>;
  byCustomer: Array<{ customerId: number | null; customerName: string; count: number; amount: number }>;
  byProduct: Array<{ productId: number; productName: string; quantity: number; amount: number }>;
  byMonth: Array<{ month: string; count: number; amount: number; refunded: number }>;
  returns: ReturnDetail[];
};

const RETURN_STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon", confirmed: "Confirmé",
  partially_refunded: "Partiel. remboursé", refunded: "Remboursé", cancelled: "Annulé",
};
const RETURN_STATUS_COLORS: Record<string, string> = {
  draft: "#94a3b8", confirmed: "#3b82f6",
  partially_refunded: "#f97316", refunded: "#22c55e", cancelled: "#ef4444",
};

function ReturnStatusBadge({ s }: { s: string }) {
  const colorMap: Record<string, string> = {
    draft: "bg-slate-100 text-slate-600", confirmed: "bg-blue-100 text-blue-700",
    partially_refunded: "bg-orange-100 text-orange-700", refunded: "bg-green-100 text-green-700",
    cancelled: "bg-red-100 text-red-600",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colorMap[s] ?? "bg-gray-100 text-gray-600"}`}>
      {RETURN_STATUS_LABELS[s] ?? s}
    </span>
  );
}

function ReturnsTab({ filters }: { filters: Filters }) {
  const [localStatus, setLocalStatus] = useState("all");

  const params = new URLSearchParams();
  if (filters.branchId !== "all") params.set("branchId", filters.branchId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (localStatus !== "all") params.set("status", localStatus);
  const qs = params.toString();

  const { data: d } = useQuery<ReturnsReport>({
    queryKey: ["/api/reports/returns", qs],
    queryFn: () => customFetch(`/api/reports/returns${qs ? `?${qs}` : ""}`),
  });

  if (!d) return <EmptyState message="Chargement..." />;

  // Monthly trend chart data
  const monthChartData = d.byMonth.map(m => ({
    month: m.month.substring(5) + "/" + m.month.substring(2, 4),
    "Retours": Math.round(m.amount),
    "Remboursé": Math.round(m.refunded),
  }));

  // Status pie chart
  const statusPieData = d.byStatus
    .filter(s => s.status !== "cancelled" && s.status !== "draft")
    .map(s => ({ name: RETURN_STATUS_LABELS[s.status] ?? s.status, value: s.count, amount: s.amount, fill: RETURN_STATUS_COLORS[s.status] ?? "#94a3b8" }));

  const hasMultiBranch = d.byBranch.length > 1;

  return (
    <div className="space-y-4">
      {/* Status filter */}
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={localStatus} onValueChange={setLocalStatus}>
          <SelectTrigger className="h-8 text-xs w-52">
            <SelectValue placeholder="Tous les statuts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les statuts</SelectItem>
            {Object.entries(RETURN_STATUS_LABELS).map(([v, l]) => (
              <SelectItem key={v} value={v}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {localStatus !== "all" && (
          <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setLocalStatus("all")}>
            Réinitialiser
          </button>
        )}
        <div className="ml-auto">
          <ExportButton
            endpoint="export/returns"
            params={{ from: filters.from || undefined, to: filters.to || undefined, branchId: filters.branchId !== "all" ? filters.branchId : undefined, status: localStatus !== "all" ? localStatus : undefined }}
            label="Exporter retours"
          />
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard title="Montant avoirs" value={formatDA(d.totalAmount)} sub={`${d.returnCount} retours confirmés`} icon={RotateCcw} color="orange" />
        <KpiCard title="Taux de retour" value={`${d.returnRate.toFixed(2)}%`} sub={`sur ${formatDA(d.totalSales)} de ventes`} icon={TrendingDown} color={d.returnRate > 5 ? "red" : d.returnRate > 2 ? "amber" : "green"} />
        <KpiCard title="Remboursé" value={formatDA(d.totalRefunded)} sub={`${d.returnCount > 0 ? Math.round((d.totalRefunded / d.totalAmount) * 100) : 0}% des avoirs`} icon={Banknote} color="green" />
        <KpiCard title="En attente rembours." value={formatDA(d.pendingRefund)} sub={d.pendingRefund > 0 ? "à traiter" : "tout réglé"} icon={Clock} color={d.pendingRefund > 0 ? "amber" : "green"} />
        <KpiCard title="Retours total" value={String(d.totalCount)} sub={`${d.totalCount - d.returnCount} brouillon/annulé`} icon={AlertTriangle} color="blue" />
        <KpiCard title="Moy. par retour" value={formatDA(d.avgReturnAmount)} sub="montant moyen avoir" icon={Scale} color="violet" />
      </div>

      {d.totalCount === 0 ? (
        <EmptyState message="Aucun retour sur cette période" />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Monthly trend */}
            {monthChartData.length > 0 && (
              <SectionCard title="Évolution mensuelle — retours vs remboursements">
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={monthChartData} barSize={18} barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={v => fmtK(v)} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: number, name: string) => [formatDA(v), name]} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Retours" fill="#f97316" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Remboursé" fill="#22c55e" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </SectionCard>
            )}

            {/* Status distribution */}
            {statusPieData.length > 0 && (
              <SectionCard title="Répartition par statut">
                <div className="flex gap-4 items-center">
                  <ResponsiveContainer width="100%" height={140}>
                    <PieChart>
                      <Pie data={statusPieData} dataKey="value" cx="50%" cy="50%" outerRadius={60} innerRadius={30}>
                        {statusPieData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                      </Pie>
                      <Tooltip formatter={(v: number, name: string, props: any) => [`${v} retour(s) — ${formatDA(props.payload.amount)}`, props.payload.name]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-2 flex-1">
                    {statusPieData.map((s, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: s.fill }} />
                        <span className="text-xs text-muted-foreground flex-1">{s.name}</span>
                        <span className="text-xs font-medium">{s.value}</span>
                        <span className="text-xs text-muted-foreground w-24 text-right">{formatDA(s.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </SectionCard>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* By branch */}
            {hasMultiBranch && (
              <SectionCard title="Impact par boutique">
                <div className="space-y-2">
                  {d.byBranch.map((b, i) => {
                    const maxAmt = d.byBranch[0]?.amount ?? 1;
                    const refundPct = b.amount > 0 ? Math.round((b.refunded / b.amount) * 100) : 0;
                    return (
                      <div key={i} className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium truncate w-32">{b.branchName}</span>
                          <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full bg-orange-400" style={{ width: `${(b.amount / maxAmt) * 100}%` }} />
                          </div>
                          <span className="text-xs font-semibold w-28 text-right">{formatDA(b.amount)}</span>
                          <span className="text-xs text-muted-foreground w-8 text-right">{b.count}</span>
                        </div>
                        <div className="pl-34 text-[10px] text-muted-foreground ml-[8.5rem]">
                          Remboursé : {formatDA(b.refunded)} ({refundPct}%)
                        </div>
                      </div>
                    );
                  })}
                </div>
              </SectionCard>
            )}

            {/* By product */}
            {d.byProduct.length > 0 && (
              <SectionCard title="Produits les plus retournés">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Produit</TableHead>
                        <TableHead className="text-xs text-right">Qté retournée</TableHead>
                        <TableHead className="text-xs text-right">Montant avoir</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.byProduct.map((p, i) => (
                        <TableRow key={i} className="hover:bg-muted/30">
                          <TableCell className="text-xs font-medium">{p.productName}</TableCell>
                          <TableCell className="text-xs text-right">{p.quantity}</TableCell>
                          <TableCell className="text-xs text-right font-semibold">{formatDA(p.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </SectionCard>
            )}
          </div>

          {/* By customer */}
          {d.byCustomer.length > 0 && (
            <SectionCard title="Clients avec le plus de retours">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Client</TableHead>
                      <TableHead className="text-xs text-right">Nb retours</TableHead>
                      <TableHead className="text-xs text-right">Montant avoir</TableHead>
                      <TableHead className="text-xs text-right">Part</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.byCustomer.map((c, i) => (
                      <TableRow key={i} className="hover:bg-muted/30">
                        <TableCell className="text-xs font-medium">{c.customerName}</TableCell>
                        <TableCell className="text-xs text-right">{c.count}</TableCell>
                        <TableCell className="text-xs text-right font-semibold">{formatDA(c.amount)}</TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground">
                          {d.totalAmount > 0 ? `${Math.round((c.amount / d.totalAmount) * 100)}%` : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </SectionCard>
          )}

          {/* Detail table */}
          <SectionCard title={`Liste détaillée — ${d.returns.length} entrée${d.returns.length !== 1 ? "s" : ""}`}>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Référence</TableHead>
                    <TableHead className="text-xs">Vente liée</TableHead>
                    <TableHead className="text-xs">Client</TableHead>
                    <TableHead className="text-xs">Boutique</TableHead>
                    <TableHead className="text-xs">Statut</TableHead>
                    <TableHead className="text-xs text-right">Avoir (DA)</TableHead>
                    <TableHead className="text-xs text-right">Remboursé</TableHead>
                    <TableHead className="text-xs text-right">Restant</TableHead>
                    <TableHead className="text-xs">Motif</TableHead>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Créé par</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.returns.map((r, i) => (
                    <TableRow key={i} className="hover:bg-muted/30">
                      <TableCell className="text-xs font-mono font-semibold text-amber-700">{r.reference}</TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">{r.saleRef || "—"}</TableCell>
                      <TableCell className="text-xs">{r.customerName}</TableCell>
                      <TableCell className="text-xs">{r.branchName}</TableCell>
                      <TableCell className="text-xs"><ReturnStatusBadge s={r.status} /></TableCell>
                      <TableCell className="text-xs text-right font-semibold">{formatDA(r.totalAmount)}</TableCell>
                      <TableCell className="text-xs text-right text-green-700">{formatDA(r.refundedAmount)}</TableCell>
                      <TableCell className="text-xs text-right">
                        {r.remainingRefund > 0
                          ? <span className="text-orange-600 font-medium">{formatDA(r.remainingRefund)}</span>
                          : <span className="text-green-600">—</span>
                        }
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate">{r.reason || "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDate(r.createdAt)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.createdByName}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}

// ─── MAIN PAGE ───────────────────────────────────────────────────────────────

export default function Reports() {
  const [tab, setTab] = useState("sales");
  const [filters, setFilters] = useState<Filters>({
    from: format(startOfMonth(new Date()), "yyyy-MM-dd"),
    to: format(new Date(), "yyyy-MM-dd"),
    branchId: "all",
  });
  const { data: branches = [] } = useGetBranches();

  const tabs = [
    { id: "sales", label: "Ventes", icon: TrendingUp },
    { id: "purchases", label: "Achats", icon: ShoppingCart },
    { id: "returns", label: "Retours & Avoirs", icon: RotateCcw },
    { id: "stock", label: "Stock", icon: Boxes },
    { id: "production", label: "Production", icon: Factory },
    { id: "expenses", label: "Dépenses", icon: Receipt },
    { id: "financial", label: "Financier", icon: CreditCard },
    { id: "branches", label: "Boutiques", icon: Building2 },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-serif font-bold">Rapports & Analyses</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Tableau de bord décisionnel — données par période et boutique</p>
      </div>

      <FiltersBar filters={filters} onChange={setFilters} branches={branches} />

      {/* Contextual export button — shown only when export is available for the active tab */}
      {(["sales", "purchases", "expenses", "stock", "financial"].includes(tab)) && (
        <div className="flex justify-end">
          <ExportButton
            endpoint={
              tab === "sales" ? "export/sales" :
              tab === "purchases" ? "export/purchases" :
              tab === "expenses" ? "export/expenses" :
              tab === "stock" ? "export/stock" :
              "export/financial"
            }
            params={{
              from: filters.from || undefined,
              to: filters.to || undefined,
              branchId: filters.branchId !== "all" ? filters.branchId : undefined,
            }}
            label={`Exporter ${tab === "sales" ? "ventes" : tab === "purchases" ? "achats" : tab === "expenses" ? "dépenses" : tab === "stock" ? "stock" : "rapport financier"}`}
          />
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-9 bg-muted/50 gap-0.5">
          {tabs.map(t => (
            <TabsTrigger key={t.id} value={t.id} className="text-xs h-8 gap-1.5 px-3">
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="sales" className="mt-4"><SalesTab filters={filters} /></TabsContent>
        <TabsContent value="purchases" className="mt-4"><PurchasesTab filters={filters} /></TabsContent>
        <TabsContent value="returns" className="mt-4"><ReturnsTab filters={filters} /></TabsContent>
        <TabsContent value="stock" className="mt-4"><StockTab filters={filters} /></TabsContent>
        <TabsContent value="production" className="mt-4"><ProductionTab filters={filters} /></TabsContent>
        <TabsContent value="expenses" className="mt-4"><ExpensesTab filters={filters} /></TabsContent>
        <TabsContent value="financial" className="mt-4"><FinancialTab /></TabsContent>
        <TabsContent value="branches" className="mt-4"><BranchTab /></TabsContent>
      </Tabs>
    </div>
  );
}
