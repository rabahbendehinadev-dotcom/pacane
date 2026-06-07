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
  CartesianGrid, PieChart, Pie, Cell, FunnelChart, Funnel, LabelList,
} from "recharts";
import {
  ShoppingBag, TrendingUp, TrendingDown, Users, BarChart2, Download,
  Building2, ArrowRight, Star, Tag, CreditCard, Store,
  FileText, RotateCcw, CheckCircle2, AlertTriangle, Banknote, Receipt,
  ArrowUpDown, ArrowUp, ArrowDown, Percent, PackageX, BadgeDollarSign, ClipboardList, FileSearch, Layers,
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
function fmtDateShort(d: string | Date | null | undefined) {
  if (!d) return "—";
  try { return format(new Date(d), "dd/MM/yyyy", { locale: fr }); } catch { return "—"; }
}

const DOC_TYPE_CFG: Record<string, { label: string; cls: string }> = {
  sale:      { label: "Vente",     cls: "bg-green-100 text-green-700 border-green-200" },
  order:     { label: "Commande",  cls: "bg-amber-100 text-amber-700 border-amber-200" },
  quotation: { label: "Devis",     cls: "bg-blue-100 text-blue-700 border-blue-200" },
  draft:     { label: "Brouillon", cls: "bg-slate-100 text-slate-700 border-slate-200" },
};
const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  confirmed:           { label: "Confirmée",    cls: "bg-green-100 text-green-700 border-green-200" },
  active:              { label: "Active",       cls: "bg-blue-100 text-blue-700 border-blue-200" },
  pending:             { label: "En attente",   cls: "bg-slate-100 text-slate-700 border-slate-200" },
  approved:            { label: "Approuvé",     cls: "bg-indigo-100 text-indigo-700 border-indigo-200" },
  converted:           { label: "Converti",     cls: "bg-violet-100 text-violet-700 border-violet-200" },
  in_preparation:      { label: "Préparation",  cls: "bg-amber-100 text-amber-700 border-amber-200" },
  partially_fulfilled: { label: "Part. livré",  cls: "bg-amber-100 text-amber-700 border-amber-200" },
  ready:               { label: "Prêt",         cls: "bg-cyan-100 text-cyan-700 border-cyan-200" },
  delivered:           { label: "Livré",        cls: "bg-green-100 text-green-700 border-green-200" },
  cancelled:           { label: "Annulé",       cls: "bg-red-100 text-red-700 border-red-200" },
  rejected:            { label: "Rejeté",       cls: "bg-rose-100 text-rose-700 border-rose-200" },
  expired:             { label: "Expiré",       cls: "bg-slate-100 text-slate-600 border-slate-200" },
};
const PAYMENT_CFG: Record<string, { label: string; cls: string }> = {
  paid:           { label: "Payée",         cls: "bg-green-100 text-green-700 border-green-200" },
  partially_paid: { label: "Part. payée",   cls: "bg-amber-100 text-amber-700 border-amber-200" },
  unpaid:         { label: "Impayée",       cls: "bg-red-100 text-red-700 border-red-200" },
};
const CHANNEL_ICONS: Record<string, React.FC<{ className?: string }>> = {
  pos:      Store,
  delivery: ShoppingBag,
  pickup:   Tag,
};

const BRANCH_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#0ea5e9"];
const DATE_PRESETS = [
  { label: "7j",   from: () => format(subDays(new Date(), 6),  "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "30j",  from: () => format(subDays(new Date(), 29), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "Ce mois",     from: () => format(startOfMonth(new Date()), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "Cette année", from: () => format(startOfYear(new Date()),  "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "Tout", from: () => "2023-01-01", to: () => format(new Date(), "yyyy-MM-dd") },
];

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ title, value, sub, icon: Icon, color = "blue", loading = false, highlight }: {
  title: string; value: string; sub?: string;
  icon: React.FC<{ className?: string }>;
  color?: "green" | "red" | "amber" | "blue" | "violet" | "indigo" | "emerald";
  loading?: boolean; highlight?: "good" | "bad" | "neutral";
}) {
  const bg: Record<string, string> = { green: "bg-green-50", red: "bg-red-50", amber: "bg-amber-50", blue: "bg-blue-50", violet: "bg-violet-50", indigo: "bg-indigo-50", emerald: "bg-emerald-50" };
  const ic: Record<string, string> = { green: "text-green-600", red: "text-red-600", amber: "text-amber-600", blue: "text-blue-600", violet: "text-violet-600", indigo: "text-indigo-600", emerald: "text-emerald-600" };
  const valCls = highlight === "good" ? "text-green-700" : highlight === "bad" ? "text-red-700" : "";
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

function SortHead({ label, sk, curKey, curDir, onToggle, right = false }: {
  label: string; sk: string; curKey: string; curDir: "desc"|"asc";
  onToggle: (k: string) => void; right?: boolean;
}) {
  const active = sk === curKey;
  const Icon = active ? (curDir === "desc" ? ArrowDown : ArrowUp) : ArrowUpDown;
  return (
    <TableHead
      className={`${right ? "text-right" : ""} cursor-pointer select-none hover:bg-muted/50 transition-colors whitespace-nowrap`}
      onClick={() => onToggle(sk)}
    >
      <div className={`flex items-center gap-1 ${right ? "justify-end" : ""}`}>
        <span className="text-xs font-semibold">{label}</span>
        <Icon className={`h-3 w-3 shrink-0 ${active ? "text-primary" : "text-muted-foreground/40"}`} />
      </div>
    </TableHead>
  );
}

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background border border-border rounded-lg shadow-lg p-3 text-xs space-y-1">
      <p className="font-semibold">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }}>{p.name}: {p.value > 1000 ? fmtDA(p.value) : p.value}</p>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function AnalyticsSales() {
  const { user } = useAuth();

  const [from, setFrom] = useState(format(subDays(new Date(), 29), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [branchId, setBranchId] = useState("all");
  const [docType, setDocType] = useState("all");
  const [paymentStatus, setPaymentStatus] = useState("all");
  const [activePreset, setActivePreset] = useState(1);

  // ─── Sort states ────────────────────────────────────────────────────────────
  const [branchSortKey,   setBranchSortKey]   = useState<"branchName"|"revenue"|"saleCount"|"avgBasket"|"unpaidBalance"|"revenuePct">("revenue");
  const [branchSortDir,   setBranchSortDir]   = useState<"desc"|"asc">("desc");
  const [productSortKey,  setProductSortKey]  = useState<"productName"|"revenue"|"qty"|"orderCount"|"avgUnitPrice"|"totalDiscount"|"revenuePct">("revenue");
  const [productSortDir,  setProductSortDir]  = useState<"desc"|"asc">("desc");
  const [customerSortKey, setCustomerSortKey] = useState<"customerName"|"revenue"|"saleCount"|"avgBasket"|"paid"|"creditApplied"|"unpaid">("revenue");
  const [customerSortDir, setCustomerSortDir] = useState<"desc"|"asc">("desc");
  const [sellerSortKey,   setSellerSortKey]   = useState<"sellerName"|"revenue"|"saleCount"|"avgBasket"|"paymentRate"|"revenuePct">("revenue");
  const [sellerSortDir,   setSellerSortDir]   = useState<"desc"|"asc">("desc");
  const [docSortKey,      setDocSortKey]      = useState<"reference"|"type"|"status"|"customerName"|"branchName"|"fulfillmentType"|"paymentStatus"|"total"|"paid"|"unpaid"|"createdAt">("createdAt");
  const [docSortDir,      setDocSortDir]      = useState<"desc"|"asc">("desc");

  function toggleSort(
    key: string, cur: string, curDir: "desc"|"asc",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setKey: (k: any) => void, setDir: (d: "desc"|"asc") => void,
  ) {
    if (key === cur) setDir(curDir === "desc" ? "asc" : "desc");
    else { setKey(key); setDir("desc"); }
  }

  function sortArr<T>(arr: T[], key: keyof T, dir: "desc"|"asc") {
    return [...arr].sort((a, b) => {
      const va = a[key], vb = b[key];
      if (typeof va === "string" && typeof vb === "string")
        return dir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      const na = Number(va ?? 0), nb = Number(vb ?? 0);
      return dir === "asc" ? na - nb : nb - na;
    });
  }

  const { data: branches } = useGetBranches();
  const showBranchFilter = user?.adminAccess || (user?.branchIds && user.branchIds.length > 1);

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (from) p.from = from;
    if (to) p.to = to;
    if (branchId !== "all") p.branchId = branchId;
    if (docType !== "all") p.docType = docType;
    if (paymentStatus !== "all") p.paymentStatus = paymentStatus;
    return p;
  }, [from, to, branchId, docType, paymentStatus]);
  const qs = new URLSearchParams(params).toString();
  // kpis always on sales (not filtered by docType)
  const kpisQs = useMemo(() => {
    const p: Record<string, string> = {};
    if (from) p.from = from;
    if (to) p.to = to;
    if (branchId !== "all") p.branchId = branchId;
    if (paymentStatus !== "all") p.paymentStatus = paymentStatus;
    return new URLSearchParams(p).toString();
  }, [from, to, branchId, paymentStatus]);

  const applyPreset = (i: number) => {
    const p = DATE_PRESETS[i];
    setFrom(p.from()); setTo(p.to()); setActivePreset(i);
  };

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ["as-kpis", kpisQs],
    queryFn: () => customFetch(`/api/analytics/sales/kpis?${kpisQs}`),
  });
  const { data: trend, isLoading: trendLoading } = useQuery({
    queryKey: ["as-trend", kpisQs],
    queryFn: () => customFetch(`/api/analytics/sales/trend?${kpisQs}`),
  });
  const { data: products } = useQuery({
    queryKey: ["as-products", kpisQs],
    queryFn: () => customFetch(`/api/analytics/sales/products?${kpisQs}`),
  });
  const { data: customers } = useQuery({
    queryKey: ["as-customers", kpisQs],
    queryFn: () => customFetch(`/api/analytics/sales/customers?${kpisQs}`),
  });
  const { data: sellers } = useQuery({
    queryKey: ["as-sellers", kpisQs],
    queryFn: () => customFetch(`/api/analytics/sales/sellers?${kpisQs}`),
  });
  const { data: branchData } = useQuery({
    queryKey: ["as-branches", kpisQs],
    queryFn: () => customFetch(`/api/analytics/sales/branches?${kpisQs}`),
  });
  const { data: channels } = useQuery({
    queryKey: ["as-channels", kpisQs],
    queryFn: () => customFetch(`/api/analytics/sales/channels?${kpisQs}`),
  });
  const { data: conversion } = useQuery({
    queryKey: ["as-conversion", kpisQs],
    queryFn: () => customFetch(`/api/analytics/sales/conversion?${kpisQs}`),
  });
  const { data: documents } = useQuery({
    queryKey: ["as-documents", qs],
    queryFn: () => customFetch(`/api/analytics/sales/documents?${qs}`),
  });

  const k = kpis as any;
  const ch = channels as any;
  const conv = conversion as any;

  // ─── Sorted datasets ────────────────────────────────────────────────────────
  const sortedBranches  = useMemo(() => sortArr((branchData as any[] ?? []),   branchSortKey   as any, branchSortDir),   [branchData,   branchSortKey,   branchSortDir]);
  const sortedProducts  = useMemo(() => sortArr((products   as any[] ?? []),   productSortKey  as any, productSortDir),  [products,     productSortKey,  productSortDir]);
  const sortedCustomers = useMemo(() => sortArr((customers  as any[] ?? []),   customerSortKey as any, customerSortDir), [customers,    customerSortKey, customerSortDir]);
  const sortedSellers   = useMemo(() => sortArr((sellers    as any[] ?? []),   sellerSortKey   as any, sellerSortDir),   [sellers,      sellerSortKey,   sellerSortDir]);
  const sortedDocs      = useMemo(() => sortArr((documents  as any[] ?? []),   docSortKey      as any, docSortDir),      [documents,    docSortKey,      docSortDir]);

  const handleExport = () => {
    window.open(`/api/export/sales?${kpisQs}`, "_blank");
  };

  return (
    <div className="p-6 space-y-6 max-w-screen-2xl mx-auto">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart2 className="h-6 w-6 text-green-600" />
            Analytique Ventes & Performance Commerciale
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Chiffre d'affaires · Produits · Clients · Vendeurs · Conversion
          </p>
        </div>
        <div className="flex items-center gap-3">
          {k && (
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold ${k.netRevenue >= 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
              <TrendingUp className="h-4 w-4" />
              CA net: {fmtDA(k.netRevenue)}
            </div>
          )}
          <Button variant="outline" size="sm" className="h-8 text-xs gap-2" onClick={handleExport}>
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        </div>
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
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Type document</Label>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger className="h-8 text-xs w-36">
                  <SelectValue placeholder="Tous" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous</SelectItem>
                  <SelectItem value="sale">Ventes</SelectItem>
                  <SelectItem value="order">Commandes</SelectItem>
                  <SelectItem value="quotation">Devis</SelectItem>
                  <SelectItem value="draft">Brouillons</SelectItem>
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
                  <SelectItem value="paid">Payée</SelectItem>
                  <SelectItem value="partially_paid">Part. payée</SelectItem>
                  <SelectItem value="unpaid">Impayée</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── KPI Cards — Rangée 1 ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          title="CA brut (ventes)"
          value={k ? fmtDA(k.grossRevenue) : "—"}
          sub={k ? `${k.saleCount} vente(s) confirmée(s)` : "—"}
          icon={ShoppingBag} color="green" loading={kpisLoading}
        />
        <KpiCard
          title="CA net (après retours)"
          value={k ? fmtDA(k.netRevenue) : "—"}
          sub={k ? `−${fmtDA(k.totalRefunded)} retours (${k.returnImpactPct}%)` : "—"}
          icon={TrendingUp} color="emerald" loading={kpisLoading}
        />
        <KpiCard
          title="Panier moyen"
          value={k ? fmtDA(k.avgBasket) : "—"}
          sub={k ? `${k.totalItemsSold.toLocaleString()} articles vendus` : "—"}
          icon={Tag} color="blue" loading={kpisLoading}
        />
        <KpiCard
          title="Encaissé"
          value={k ? fmtDA(k.totalPaid + k.totalCreditApplied) : "—"}
          sub={k ? `${k.paymentRate}% du CA encaissé` : "—"}
          icon={CreditCard} color="indigo" loading={kpisLoading}
          highlight={k?.paymentRate >= 80 ? "good" : k?.paymentRate >= 50 ? "neutral" : "bad"}
        />
        <KpiCard
          title="Créances impayées"
          value={k ? fmtDA(k.unpaidBalance) : "—"}
          sub={k ? `${k.unpaidCount} vente(s) impayée(s)` : "—"}
          icon={AlertTriangle} color="red" loading={kpisLoading}
          highlight={k?.unpaidBalance > 0 ? "bad" : "good"}
        />
        <KpiCard
          title="Clients actifs"
          value={k ? String(k.customerCount) : "—"}
          sub={k ? `+ ${k.saleCount - k.customerCount > 0 ? k.saleCount - k.customerCount : 0} ventes anonymes` : "—"}
          icon={Users} color="violet" loading={kpisLoading}
        />
      </div>

      {/* ── KPI Cards — Rangée 2 ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <KpiCard
          title="Remise totale"
          value={k ? fmtDA(k.totalDiscount) : "—"}
          sub={k && k.grossRevenue > 0 ? `${Math.round((k.totalDiscount / k.grossRevenue) * 100)}% du CA brut` : "—"}
          icon={BadgeDollarSign} color="amber" loading={kpisLoading}
          highlight={k?.totalDiscount > 0 ? "bad" : "neutral"}
        />
        <KpiCard
          title="Nb retours"
          value={k ? String(k.returnCount) : "—"}
          sub={k ? `Impact: −${fmtDA(k.totalRefunded)}` : "—"}
          icon={PackageX} color="red" loading={kpisLoading}
          highlight={k?.returnCount > 0 ? "bad" : "good"}
        />
        <KpiCard
          title="Impact retours"
          value={k ? `${k.returnImpactPct}%` : "—"}
          sub={k ? `${fmtDA(k.totalRefunded)} remboursé` : "—"}
          icon={Percent} color="red" loading={kpisLoading}
          highlight={k?.returnImpactPct > 5 ? "bad" : k?.returnImpactPct > 0 ? "neutral" : "good"}
        />
        <KpiCard
          title="Taux paiement"
          value={k ? `${k.paymentRate}%` : "—"}
          sub={k ? `${k.paidCount} soldées / ${k.partialCount} part. / ${k.unpaidCount} impayées` : "—"}
          icon={CheckCircle2} color="green" loading={kpisLoading}
          highlight={k?.paymentRate >= 80 ? "good" : k?.paymentRate >= 50 ? "neutral" : "bad"}
        />
        <KpiCard
          title="Nb commandes"
          value={k ? String(k.orderCount) : "—"}
          sub="documents de type commande"
          icon={ClipboardList} color="amber" loading={kpisLoading}
        />
        <KpiCard
          title="Nb devis"
          value={k ? String(k.quoteCount) : "—"}
          sub="documents de type devis"
          icon={FileSearch} color="blue" loading={kpisLoading}
        />
        <KpiCard
          title="Ventes part. payées"
          value={k ? String(k.partialCount) : "—"}
          sub={k ? `sur ${k.saleCount} ventes total` : "—"}
          icon={Layers} color="indigo" loading={kpisLoading}
          highlight={k?.partialCount > 0 ? "neutral" : "good"}
        />
      </div>

      {/* ── Trend + Channel breakdown ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Revenue trend */}
        <Card className="border-0 shadow-sm lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-600" />
              Évolution du chiffre d'affaires — Facturé vs Encaissé
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            {trendLoading ? (
              <div className="h-52 flex items-center justify-center text-xs text-muted-foreground">Chargement...</div>
            ) : Array.isArray(trend) && (trend as any[]).length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={trend as any[]}>
                  <defs>
                    <linearGradient id="gradRev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradPaid" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 9 }} interval={Math.ceil(((trend as any[]).length || 1) / 8) - 1} />
                  <YAxis tick={{ fontSize: 9 }} tickFormatter={v => fmtK(v)} width={50} />
                  <Tooltip content={<ChartTip />} />
                  <Area type="monotone" dataKey="revenue" name="CA facturé" stroke="#10b981" fill="url(#gradRev)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="paid" name="Encaissé" stroke="#6366f1" fill="url(#gradPaid)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-52 flex items-center justify-center text-xs text-muted-foreground">Aucune donnée sur cette période</div>
            )}
          </CardContent>
        </Card>

        {/* Channel + payment method breakdown */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Store className="h-4 w-4 text-violet-600" />
              Canal & Mode de paiement
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-3 space-y-4">
            {/* Channels */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-green-700 mb-2">Canal de vente</p>
              {ch?.channels?.length > 0 ? (
                <div className="space-y-2">
                  {ch.channels.map((c: any) => {
                    const Icon = CHANNEL_ICONS[c.channel] ?? Store;
                    return (
                      <div key={c.channel} className="space-y-0.5">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5">
                            <Icon className="h-3 w-3 text-muted-foreground" />
                            <span className="text-muted-foreground">{c.label}</span>
                          </div>
                          <div className="text-right">
                            <span className="font-semibold text-green-700">{c.revenuePct}%</span>
                            <span className="text-muted-foreground ml-1 text-[10px]">({c.saleCount} ventes)</span>
                          </div>
                        </div>
                        <Progress value={c.revenuePct} className="h-1.5" />
                      </div>
                    );
                  })}
                </div>
              ) : <p className="text-xs text-muted-foreground">—</p>}
            </div>

            <div className="border-t border-border/50" />

            {/* Payment methods */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-700 mb-2">Mode d'encaissement</p>
              {ch?.paymentMethods?.length > 0 ? (
                <div className="space-y-1.5">
                  {ch.paymentMethods.map((m: any) => (
                    <div key={m.method} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{m.label}</span>
                      <div className="text-right">
                        <span className="font-semibold text-indigo-700">{m.pct}%</span>
                        <span className="text-muted-foreground ml-1 text-[10px]">({fmtK(m.total)} DA)</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-muted-foreground">Aucun paiement enregistré</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Branch comparison + Conversion funnel ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Branch comparison */}
        {Array.isArray(branchData) && (branchData as any[]).length > 0 && (
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Building2 className="h-4 w-4 text-blue-600" />
                Ventes par agence
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <SortHead label="Agence"  sk="branchName"    curKey={branchSortKey} curDir={branchSortDir} onToggle={k => toggleSort(k, branchSortKey, branchSortDir, setBranchSortKey, setBranchSortDir)} />
                    <SortHead label="CA"      sk="revenue"       curKey={branchSortKey} curDir={branchSortDir} onToggle={k => toggleSort(k, branchSortKey, branchSortDir, setBranchSortKey, setBranchSortDir)} right />
                    <SortHead label="Ventes"  sk="saleCount"     curKey={branchSortKey} curDir={branchSortDir} onToggle={k => toggleSort(k, branchSortKey, branchSortDir, setBranchSortKey, setBranchSortDir)} right />
                    <SortHead label="Panier"  sk="avgBasket"     curKey={branchSortKey} curDir={branchSortDir} onToggle={k => toggleSort(k, branchSortKey, branchSortDir, setBranchSortKey, setBranchSortDir)} right />
                    <SortHead label="Impayé"  sk="unpaidBalance" curKey={branchSortKey} curDir={branchSortDir} onToggle={k => toggleSort(k, branchSortKey, branchSortDir, setBranchSortKey, setBranchSortDir)} right />
                    <SortHead label="Part CA" sk="revenuePct"    curKey={branchSortKey} curDir={branchSortDir} onToggle={k => toggleSort(k, branchSortKey, branchSortDir, setBranchSortKey, setBranchSortDir)} right />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedBranches.map((b: any, i: number) => (
                    <TableRow key={b.branchId}>
                      <TableCell>
                        <div className="flex items-center gap-2 text-xs font-medium">
                          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: BRANCH_COLORS[i % BRANCH_COLORS.length] }} />
                          {b.branchName}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-right font-bold text-green-700">{fmtDA(b.revenue)}</TableCell>
                      <TableCell className="text-xs text-right text-muted-foreground">{b.saleCount}</TableCell>
                      <TableCell className="text-xs text-right text-muted-foreground">{fmtDA(b.avgBasket)}</TableCell>
                      <TableCell className="text-xs text-right text-red-700 font-medium">
                        {b.unpaidBalance > 0 ? fmtDA(b.unpaidBalance) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 min-w-[60px]">
                          <Progress value={b.revenuePct} className="h-1.5 flex-1" />
                          <span className="text-[10px] text-muted-foreground w-7 shrink-0">{b.revenuePct}%</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Conversion funnel */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ArrowRight className="h-4 w-4 text-amber-600" />
              Entonnoir de conversion
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            {conv?.funnel?.length > 0 ? (
              <div className="space-y-2">
                {conv.funnel.filter((s: any) => s.count > 0).map((s: any, i: number) => {
                  const maxCount = Math.max(...conv.funnel.map((x: any) => x.count), 1);
                  const pct = Math.round((s.count / maxCount) * 100);
                  return (
                    <div key={i} className="space-y-0.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">{s.stage}</span>
                        <span className="font-bold" style={{ color: s.color }}>{s.count}</span>
                      </div>
                      <div className="h-5 rounded bg-muted/30 overflow-hidden">
                        <div
                          className="h-full rounded transition-all"
                          style={{ width: `${pct}%`, backgroundColor: s.color, opacity: 0.8 }}
                        />
                      </div>
                    </div>
                  );
                })}
                <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-border">
                  <div className="text-center p-2 rounded-lg bg-muted/30">
                    <p className="text-xs text-muted-foreground">Devis → Commande</p>
                    <p className="text-lg font-bold text-indigo-700">{conv.conversionRates?.quoteToOrder ?? 0}%</p>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-muted/30">
                    <p className="text-xs text-muted-foreground">Commande → Livraison</p>
                    <p className="text-lg font-bold text-amber-700">{conv.conversionRates?.orderToSale ?? 0}%</p>
                  </div>
                </div>
                {(conv.summary?.drafts > 0 || conv.summary?.cancelled > 0) && (
                  <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
                    {conv.summary?.drafts > 0 && <span>{conv.summary.drafts} brouillon(s)</span>}
                    {conv.summary?.cancelled > 0 && <span className="text-red-600">{conv.summary.cancelled} annulé(s)</span>}
                    {conv.summary?.rejected > 0 && <span className="text-rose-600">{conv.summary.rejected} rejeté(s)</span>}
                  </div>
                )}
              </div>
            ) : (
              <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">Aucune donnée de conversion</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Tabs: Products / Customers / Sellers / Documents ────────────────── */}
      <Tabs defaultValue="products">
        <TabsList className="h-8">
          <TabsTrigger value="products" className="text-xs h-7 px-3">
            <Tag className="h-3.5 w-3.5 mr-1.5" />
            Produits
          </TabsTrigger>
          <TabsTrigger value="customers" className="text-xs h-7 px-3">
            <Users className="h-3.5 w-3.5 mr-1.5" />
            Clients
          </TabsTrigger>
          <TabsTrigger value="sellers" className="text-xs h-7 px-3">
            <Star className="h-3.5 w-3.5 mr-1.5" />
            Vendeurs
          </TabsTrigger>
          <TabsTrigger value="documents" className="text-xs h-7 px-3">
            <FileText className="h-3.5 w-3.5 mr-1.5" />
            Documents
          </TabsTrigger>
        </TabsList>

        {/* ── Products ─────────────────────────────────────────────────────────── */}
        <TabsContent value="products">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Tag className="h-4 w-4 text-amber-500" />
                Top produits — par chiffre d'affaires
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {Array.isArray(products) && (products as any[]).length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="w-8 text-xs font-semibold">#</TableHead>
                      <SortHead label="Produit"       sk="productName"   curKey={productSortKey} curDir={productSortDir} onToggle={k => toggleSort(k, productSortKey, productSortDir, setProductSortKey, setProductSortDir)} />
                      <SortHead label="CA total"      sk="revenue"       curKey={productSortKey} curDir={productSortDir} onToggle={k => toggleSort(k, productSortKey, productSortDir, setProductSortKey, setProductSortDir)} right />
                      <SortHead label="Qté vendue"    sk="qty"           curKey={productSortKey} curDir={productSortDir} onToggle={k => toggleSort(k, productSortKey, productSortDir, setProductSortKey, setProductSortDir)} right />
                      <SortHead label="Nb ventes"     sk="orderCount"    curKey={productSortKey} curDir={productSortDir} onToggle={k => toggleSort(k, productSortKey, productSortDir, setProductSortKey, setProductSortDir)} right />
                      <SortHead label="PU moyen"      sk="avgUnitPrice"  curKey={productSortKey} curDir={productSortDir} onToggle={k => toggleSort(k, productSortKey, productSortDir, setProductSortKey, setProductSortDir)} right />
                      <SortHead label="Remise totale" sk="totalDiscount" curKey={productSortKey} curDir={productSortDir} onToggle={k => toggleSort(k, productSortKey, productSortDir, setProductSortKey, setProductSortDir)} right />
                      <SortHead label="Part CA"       sk="revenuePct"    curKey={productSortKey} curDir={productSortDir} onToggle={k => toggleSort(k, productSortKey, productSortDir, setProductSortKey, setProductSortDir)} right />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedProducts.map((p: any, i: number) => (
                      <TableRow key={p.productId}>
                        <TableCell className="text-xs text-muted-foreground font-mono">{i + 1}</TableCell>
                        <TableCell className="text-xs font-semibold">{p.productName}</TableCell>
                        <TableCell className="text-xs text-right font-bold text-green-700">{fmtDA(p.revenue)}</TableCell>
                        <TableCell className="text-xs text-right font-mono">{p.qty.toFixed(0)}</TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground">{p.orderCount}</TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground">{fmtDA(p.avgUnitPrice)}</TableCell>
                        <TableCell className="text-xs text-right text-red-700">
                          {p.totalDiscount > 0 ? fmtDA(p.totalDiscount) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 min-w-[60px]">
                            <Progress value={p.revenuePct} className="h-1.5 flex-1" />
                            <span className="text-[10px] text-muted-foreground w-7 shrink-0">{p.revenuePct}%</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">Aucun produit sur cette période</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Customers ────────────────────────────────────────────────────────── */}
        <TabsContent value="customers">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Users className="h-4 w-4 text-blue-600" />
                Classement clients — par chiffre d'affaires
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {Array.isArray(customers) && (customers as any[]).length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="w-8 text-xs font-semibold">#</TableHead>
                      <SortHead label="Client"        sk="customerName"  curKey={customerSortKey} curDir={customerSortDir} onToggle={k => toggleSort(k, customerSortKey, customerSortDir, setCustomerSortKey, setCustomerSortDir)} />
                      <SortHead label="CA total"      sk="revenue"       curKey={customerSortKey} curDir={customerSortDir} onToggle={k => toggleSort(k, customerSortKey, customerSortDir, setCustomerSortKey, setCustomerSortDir)} right />
                      <SortHead label="Achats"        sk="saleCount"     curKey={customerSortKey} curDir={customerSortDir} onToggle={k => toggleSort(k, customerSortKey, customerSortDir, setCustomerSortKey, setCustomerSortDir)} right />
                      <SortHead label="Panier moy."   sk="avgBasket"     curKey={customerSortKey} curDir={customerSortDir} onToggle={k => toggleSort(k, customerSortKey, customerSortDir, setCustomerSortKey, setCustomerSortDir)} right />
                      <SortHead label="Payé"          sk="paid"          curKey={customerSortKey} curDir={customerSortDir} onToggle={k => toggleSort(k, customerSortKey, customerSortDir, setCustomerSortKey, setCustomerSortDir)} right />
                      <SortHead label="Crédit utilisé" sk="creditApplied" curKey={customerSortKey} curDir={customerSortDir} onToggle={k => toggleSort(k, customerSortKey, customerSortDir, setCustomerSortKey, setCustomerSortDir)} right />
                      <SortHead label="Impayé"        sk="unpaid"        curKey={customerSortKey} curDir={customerSortDir} onToggle={k => toggleSort(k, customerSortKey, customerSortDir, setCustomerSortKey, setCustomerSortDir)} right />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedCustomers.map((c: any, i: number) => (
                      <TableRow key={c.customerId ?? "anon"}>
                        <TableCell className="text-xs text-muted-foreground font-mono">{i + 1}</TableCell>
                        <TableCell className="text-xs font-semibold">
                          {c.customerName}
                          {!c.customerId && <span className="ml-1 text-[10px] text-muted-foreground">(POS)</span>}
                        </TableCell>
                        <TableCell className="text-xs text-right font-bold text-green-700">{fmtDA(c.revenue)}</TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground">{c.saleCount}</TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground">{fmtDA(c.avgBasket)}</TableCell>
                        <TableCell className="text-xs text-right text-green-700">{fmtDA(c.paid)}</TableCell>
                        <TableCell className="text-xs text-right text-indigo-700">
                          {c.creditApplied > 0 ? fmtDA(c.creditApplied) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-xs text-right">
                          {c.unpaid > 0 ? (
                            <span className="text-red-700 font-semibold">{fmtDA(c.unpaid)}</span>
                          ) : <span className="text-green-700 text-[10px]">Soldé</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">Aucun client sur cette période</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Sellers ──────────────────────────────────────────────────────────── */}
        <TabsContent value="sellers">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Star className="h-4 w-4 text-amber-500" />
                Performance vendeurs / caissiers
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {Array.isArray(sellers) && (sellers as any[]).length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="w-8 text-xs font-semibold">#</TableHead>
                      <SortHead label="Vendeur"       sk="sellerName"  curKey={sellerSortKey} curDir={sellerSortDir} onToggle={k => toggleSort(k, sellerSortKey, sellerSortDir, setSellerSortKey, setSellerSortDir)} />
                      <SortHead label="CA généré"     sk="revenue"     curKey={sellerSortKey} curDir={sellerSortDir} onToggle={k => toggleSort(k, sellerSortKey, sellerSortDir, setSellerSortKey, setSellerSortDir)} right />
                      <SortHead label="Ventes"        sk="saleCount"   curKey={sellerSortKey} curDir={sellerSortDir} onToggle={k => toggleSort(k, sellerSortKey, sellerSortDir, setSellerSortKey, setSellerSortDir)} right />
                      <SortHead label="Panier moy."   sk="avgBasket"   curKey={sellerSortKey} curDir={sellerSortDir} onToggle={k => toggleSort(k, sellerSortKey, sellerSortDir, setSellerSortKey, setSellerSortDir)} right />
                      <SortHead label="Taux paiement" sk="paymentRate" curKey={sellerSortKey} curDir={sellerSortDir} onToggle={k => toggleSort(k, sellerSortKey, sellerSortDir, setSellerSortKey, setSellerSortDir)} right />
                      <SortHead label="Part CA"       sk="revenuePct"  curKey={sellerSortKey} curDir={sellerSortDir} onToggle={k => toggleSort(k, sellerSortKey, sellerSortDir, setSellerSortKey, setSellerSortDir)} right />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedSellers.map((s: any, i: number) => (
                      <TableRow key={s.userId}>
                        <TableCell className="text-xs text-muted-foreground font-mono">{i + 1}</TableCell>
                        <TableCell className="text-xs font-semibold">{s.sellerName}</TableCell>
                        <TableCell className="text-xs text-right font-bold text-green-700">{fmtDA(s.revenue)}</TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground">{s.saleCount}</TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground">{fmtDA(s.avgBasket)}</TableCell>
                        <TableCell className="text-xs text-right">
                          <span className={`font-semibold ${s.paymentRate >= 80 ? "text-green-700" : s.paymentRate >= 50 ? "text-amber-700" : "text-red-700"}`}>
                            {s.paymentRate}%
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 min-w-[60px]">
                            <Progress value={s.revenuePct} className="h-1.5 flex-1" />
                            <span className="text-[10px] text-muted-foreground w-7 shrink-0">{s.revenuePct}%</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">Aucun vendeur sur cette période</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Documents ────────────────────────────────────────────────────────── */}
        <TabsContent value="documents">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Tous les documents commerciaux</CardTitle>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {k && (
                    <>
                      <Badge variant="outline" className="text-[10px] h-4">{k.allDocCount} total</Badge>
                      <Badge variant="outline" className="text-[10px] h-4 bg-green-50 text-green-700">{k.saleCount} ventes</Badge>
                      {k.orderCount > 0 && <Badge variant="outline" className="text-[10px] h-4 bg-amber-50 text-amber-700">{k.orderCount} commandes</Badge>}
                      {k.quoteCount > 0 && <Badge variant="outline" className="text-[10px] h-4 bg-blue-50 text-blue-700">{k.quoteCount} devis</Badge>}
                    </>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {Array.isArray(documents) && (documents as any[]).length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <SortHead label="Réf."    sk="reference"    curKey={docSortKey} curDir={docSortDir} onToggle={k => toggleSort(k, docSortKey, docSortDir, setDocSortKey, setDocSortDir)} />
                      <SortHead label="Type"    sk="type"         curKey={docSortKey} curDir={docSortDir} onToggle={k => toggleSort(k, docSortKey, docSortDir, setDocSortKey, setDocSortDir)} />
                      <SortHead label="Statut"  sk="status"       curKey={docSortKey} curDir={docSortDir} onToggle={k => toggleSort(k, docSortKey, docSortDir, setDocSortKey, setDocSortDir)} />
                      <SortHead label="Client"   sk="customerName"    curKey={docSortKey} curDir={docSortDir} onToggle={k => toggleSort(k, docSortKey, docSortDir, setDocSortKey, setDocSortDir)} />
                      <SortHead label="Agence"   sk="branchName"      curKey={docSortKey} curDir={docSortDir} onToggle={k => toggleSort(k, docSortKey, docSortDir, setDocSortKey, setDocSortDir)} />
                      <SortHead label="Canal"    sk="fulfillmentType" curKey={docSortKey} curDir={docSortDir} onToggle={k => toggleSort(k, docSortKey, docSortDir, setDocSortKey, setDocSortDir)} />
                      <SortHead label="Montant"  sk="total"           curKey={docSortKey} curDir={docSortDir} onToggle={k => toggleSort(k, docSortKey, docSortDir, setDocSortKey, setDocSortDir)} right />
                      <SortHead label="Payé"     sk="paid"            curKey={docSortKey} curDir={docSortDir} onToggle={k => toggleSort(k, docSortKey, docSortDir, setDocSortKey, setDocSortDir)} right />
                      <SortHead label="Reste"    sk="unpaid"          curKey={docSortKey} curDir={docSortDir} onToggle={k => toggleSort(k, docSortKey, docSortDir, setDocSortKey, setDocSortDir)} right />
                      <SortHead label="Paiement" sk="paymentStatus"   curKey={docSortKey} curDir={docSortDir} onToggle={k => toggleSort(k, docSortKey, docSortDir, setDocSortKey, setDocSortDir)} />
                      <SortHead label="Date"     sk="createdAt"       curKey={docSortKey} curDir={docSortDir} onToggle={k => toggleSort(k, docSortKey, docSortDir, setDocSortKey, setDocSortDir)} />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedDocs.slice(0, 100).map((d: any) => {
                      const typeCfg = DOC_TYPE_CFG[d.type] ?? { label: d.type, cls: "bg-slate-100 text-slate-700" };
                      const stCfg = STATUS_CFG[d.status] ?? { label: d.status, cls: "bg-slate-100 text-slate-700" };
                      const pmCfg = PAYMENT_CFG[d.paymentStatus] ?? { label: d.paymentStatus, cls: "bg-slate-100 text-slate-700" };
                      const ChanIcon = CHANNEL_ICONS[d.fulfillmentType] ?? Store;
                      return (
                        <TableRow key={d.id}>
                          <TableCell className="text-xs font-mono font-semibold">{d.reference}</TableCell>
                          <TableCell><Badge className={`text-[10px] h-4 px-1.5 border ${typeCfg.cls}`}>{typeCfg.label}</Badge></TableCell>
                          <TableCell><Badge className={`text-[10px] h-4 px-1.5 border ${stCfg.cls}`}>{stCfg.label}</Badge></TableCell>
                          <TableCell className="text-xs max-w-[120px] truncate">{d.customerName}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{d.branchName}</TableCell>
                          <TableCell>
                            <ChanIcon className="h-3 w-3 text-muted-foreground" />
                          </TableCell>
                          <TableCell className="text-xs text-right font-semibold">{fmtDA(d.total)}</TableCell>
                          <TableCell className="text-xs text-right text-green-700">{fmtDA(d.paid + d.creditApplied)}</TableCell>
                          <TableCell className="text-xs text-right text-red-700">
                            {d.unpaid > 0 ? fmtDA(d.unpaid) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell><Badge className={`text-[10px] h-4 px-1.5 border ${pmCfg.cls}`}>{pmCfg.label}</Badge></TableCell>
                          <TableCell className="text-xs text-muted-foreground">{fmtDateShort(d.createdAt)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">Aucun document sur cette période</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
