import { useState, useMemo, useCallback } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch, useGetBranches, useGetCategories } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BranchMultiSelect } from "@/components/ui/branch-multi-select";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
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
  Clock, Search, ChevronLeft, ChevronRight, Bell, Package, UserX, TrendingDown as LossIcon,
} from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth, subMonths, startOfYear } from "date-fns";
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
  { label: "Auj.",        from: () => format(new Date(), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "7j",          from: () => format(subDays(new Date(), 6),  "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "30j",         from: () => format(subDays(new Date(), 29), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "Ce mois",     from: () => format(startOfMonth(new Date()), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "Mois préc.",  from: () => format(startOfMonth(subMonths(new Date(), 1)), "yyyy-MM-dd"), to: () => format(endOfMonth(subMonths(new Date(), 1)), "yyyy-MM-dd") },
  { label: "Cette année", from: () => format(startOfYear(new Date()),  "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
  { label: "Tout",        from: () => "2023-01-01", to: () => format(new Date(), "yyyy-MM-dd") },
];

// ─── Delta Badge ──────────────────────────────────────────────────────────────
function DeltaBadge({ change, invert = false }: { change: number | null | undefined; invert?: boolean }) {
  if (change == null || !isFinite(change)) return null;
  const isPos = change > 0.5;
  const isNeg = change < -0.5;
  const isGood = invert ? isNeg : isPos;
  const isBad  = invert ? isPos : isNeg;
  const abs    = Math.round(Math.abs(change));
  const cls = isGood ? "text-green-700 bg-green-50 border-green-200" : isBad ? "text-red-700 bg-red-50 border-red-200" : "text-slate-500 bg-slate-50 border-slate-200";
  const Icon = isPos ? TrendingUp : isNeg ? TrendingDown : ArrowRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1 py-0.5 rounded border leading-none ${cls}`}>
      <Icon className="h-2.5 w-2.5 shrink-0" />
      {isPos ? "+" : ""}{abs}%
    </span>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ title, value, sub, icon: Icon, color = "blue", loading = false, highlight, change, invertDelta = false }: {
  title: string; value: string; sub?: string;
  icon: React.FC<{ className?: string }>;
  color?: "green" | "red" | "amber" | "blue" | "violet" | "indigo" | "emerald";
  loading?: boolean; highlight?: "good" | "bad" | "neutral";
  change?: number | null; invertDelta?: boolean;
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
              <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                <p className={`text-xl font-bold leading-tight ${valCls}`}>{value}</p>
                {change != null && <DeltaBadge change={change} invert={invertDelta} />}
              </div>
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
  const [, navigate] = useLocation();
  const searchStr = useSearch();

  // ── Active main tab — deep-linkable via ?tab=alerts|products|customers etc. ──
  const [activeMainTab, setActiveMainTab] = useState(() => {
    const p = new URLSearchParams(searchStr);
    const t = p.get("tab");
    return (t && ["products","customers","sellers","documents","categories","alerts","discounts"].includes(t)) ? t : "products";
  });

  const [from, setFrom] = useState(format(subDays(new Date(), 29), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [branchIds, setBranchIds] = useState<number[]>([]);
  const [docType, setDocType] = useState("all");
  const [paymentStatus, setPaymentStatus] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [subCategoryFilter, setSubCategoryFilter] = useState("all");
  const [activePreset, setActivePreset] = useState(2);

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

  const [productSearch, setProductSearch] = useState("");
  const [productPage,   setProductPage]   = useState(1);
  const PRODUCT_PAGE_SIZE = 50;

  // ─── Discounts tab state ─────────────────────────────────────────────────
  const [discountSearch, setDiscountSearch] = useState("");
  const [discountRow, setDiscountRow] = useState<any>(null);
  const [discountSortKey, setDiscountSortKey] = useState<string>("discountAmount");
  const [discountSortDir, setDiscountSortDir] = useState<"desc"|"asc">("desc");

  // ─── Alert thresholds (persisted in localStorage) ───────────────────────────
  const [stagnantDays, setStagnantDays] = useState<number>(() => {
    const v = parseInt(localStorage.getItem("alert_stagnantDays") ?? "30", 10);
    return isNaN(v) || v < 1 ? 30 : Math.min(v, 365);
  });
  const [inactiveDays, setInactiveDays] = useState<number>(() => {
    const v = parseInt(localStorage.getItem("alert_inactiveDays") ?? "60", 10);
    return isNaN(v) || v < 1 ? 60 : Math.min(v, 365);
  });
  const [stagnantInput, setStagnantInput] = useState<string>(() =>
    (parseInt(localStorage.getItem("alert_stagnantDays") ?? "30", 10) || 30).toString()
  );
  const [inactiveInput, setInactiveInput] = useState<string>(() =>
    (parseInt(localStorage.getItem("alert_inactiveDays") ?? "60", 10) || 60).toString()
  );

  function applyThresholds() {
    const sd = Math.max(1, Math.min(365, parseInt(stagnantInput, 10) || 30));
    const id = Math.max(1, Math.min(365, parseInt(inactiveInput, 10) || 60));
    setStagnantDays(sd);
    setInactiveDays(id);
    setStagnantInput(sd.toString());
    setInactiveInput(id.toString());
    localStorage.setItem("alert_stagnantDays", sd.toString());
    localStorage.setItem("alert_inactiveDays", id.toString());
  }

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
  const { data: allCategories = [] } = useGetCategories();
  const showBranchFilter = user?.adminAccess || (user?.branchIds && user.branchIds.length > 1);

  const parentCategories = useMemo(
    () => (allCategories as any[]).filter(c => !c.parentId),
    [allCategories],
  );
  const subCategories = useMemo(
    () => categoryFilter !== "all"
      ? (allCategories as any[]).filter(c => String(c.parentId) === categoryFilter)
      : [],
    [allCategories, categoryFilter],
  );

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (from) p.from = from;
    if (to) p.to = to;
    if (branchIds.length > 0) p.branchIds = branchIds.join(",");
    if (docType !== "all") p.docType = docType;
    if (paymentStatus !== "all") p.paymentStatus = paymentStatus;
    if (categoryFilter !== "all") p.categoryId = categoryFilter;
    if (subCategoryFilter !== "all") p.subCategoryId = subCategoryFilter;
    return p;
  }, [from, to, branchIds, docType, paymentStatus, categoryFilter, subCategoryFilter]);
  const qs = new URLSearchParams(params).toString();
  // kpis always on sales (not filtered by docType)
  const kpisQs = useMemo(() => {
    const p: Record<string, string> = {};
    if (from) p.from = from;
    if (to) p.to = to;
    if (branchIds.length > 0) p.branchIds = branchIds.join(",");
    if (paymentStatus !== "all") p.paymentStatus = paymentStatus;
    if (categoryFilter !== "all") p.categoryId = categoryFilter;
    if (subCategoryFilter !== "all") p.subCategoryId = subCategoryFilter;
    return new URLSearchParams(p).toString();
  }, [from, to, branchIds, paymentStatus, categoryFilter, subCategoryFilter]);

  const applyPreset = (i: number) => {
    const p = DATE_PRESETS[i];
    setFrom(p.from()); setTo(p.to()); setActivePreset(i);
  };

  const kpisQsWithCompare = useMemo(() => {
    const p = new URLSearchParams(kpisQs);
    p.set("compare", "true");
    return p.toString();
  }, [kpisQs]);

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ["as-kpis", kpisQsWithCompare],
    queryFn: () => customFetch(`/api/analytics/sales/kpis?${kpisQsWithCompare}`),
  });
  const { data: trend, isLoading: trendLoading } = useQuery({
    queryKey: ["as-trend", kpisQs],
    queryFn: () => customFetch(`/api/analytics/sales/trend?${kpisQs}`),
  });
  const { data: products } = useQuery({
    queryKey: ["as-products", kpisQs],
    queryFn: () => customFetch(`/api/analytics/sales/products?${kpisQs}&limit=2000`),
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
  const { data: timeDistribution } = useQuery({
    queryKey: ["as-timedist", kpisQs],
    queryFn: () => customFetch(`/api/analytics/sales/time-distribution?${kpisQs}`),
  });
  const { data: categories } = useQuery({
    queryKey: ["as-categories", kpisQs],
    queryFn: () => customFetch(`/api/analytics/sales/categories?${kpisQs}`),
  });
  const alertsQs = useMemo(() => {
    const p = new URLSearchParams(kpisQs);
    p.set("stagnantDays", stagnantDays.toString());
    p.set("inactiveDays", inactiveDays.toString());
    return p.toString();
  }, [kpisQs, stagnantDays, inactiveDays]);

  const { data: alerts, isLoading: alertsLoading } = useQuery({
    queryKey: ["as-alerts", alertsQs],
    queryFn: () => customFetch(`/api/analytics/sales/alerts?${alertsQs}`),
  });

  // ─── Discount analytics ───────────────────────────────────────────────────
  const { data: discountsData, isLoading: discountsLoading } = useQuery({
    queryKey: ["as-discounts", kpisQs],
    queryFn: () => customFetch(`/api/analytics/sales/discounts?${kpisQs}`),
    enabled: activeMainTab === "discounts",
  });
  const { data: discountDetail, isLoading: detailLoading } = useQuery({
    queryKey: ["as-discount-detail", discountRow?.saleId],
    queryFn: () => customFetch(`/api/analytics/sales/discount-detail/${discountRow?.saleId}`),
    enabled: !!discountRow?.saleId,
  });
  const disc = discountsData as any;
  const dDetail = discountDetail as any;

  const discountLines = useMemo(() => {
    const lines: any[] = disc?.lines ?? [];
    const q2 = discountSearch.toLowerCase();
    const filtered = q2
      ? lines.filter((r: any) => r.reference?.toLowerCase().includes(q2) || r.customerName?.toLowerCase().includes(q2) || r.productName?.toLowerCase().includes(q2) || r.sellerName?.toLowerCase().includes(q2) || r.branchName?.toLowerCase().includes(q2))
      : lines;
    return [...filtered].sort((a, b) => {
      const va = a[discountSortKey], vb = b[discountSortKey];
      if (typeof va === "string" && typeof vb === "string")
        return discountSortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      return discountSortDir === "asc" ? (Number(va ?? 0) - Number(vb ?? 0)) : (Number(vb ?? 0) - Number(va ?? 0));
    });
  }, [disc, discountSearch, discountSortKey, discountSortDir]);

  const handleDiscountExportCsv = useCallback(async () => {
    const r = await fetch(`/api/export/discounts?${kpisQs}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("erp_token")}` },
    });
    if (!r.ok) return;
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `REMISES_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  }, [kpisQs]);

  const handleDiscountExportExcel = useCallback(async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Remises");
    ws.addRow(["Référence","Date","Heure","Client","Produit","Qté","Prix orig.","Remise DA","Remise %","Prix final","Profit","Vendeur","Boutique","Raison"]);
    (disc?.lines ?? []).forEach((r: any) => {
      ws.addRow([r.reference, r.date, r.time, r.customerName, r.productName, r.qty, r.originalPrice, r.discountAmount, r.discountPct, r.finalPrice, r.profit, r.sellerName, r.branchName, r.reason ?? ""]);
    });
    ws.getRow(1).font = { bold: true };
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `REMISES_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click(); URL.revokeObjectURL(a.href);
  }, [disc]);

  const k = kpis as any;
  const ch = channels as any;
  const conv = conversion as any;
  const al = alerts as any;

  // ─── Alert counts ────────────────────────────────────────────────────────────
  const totalAlerts = useMemo(() => {
    if (!al) return 0;
    return (al.stagnantProducts?.length ?? 0) + (al.inactiveCustomers?.length ?? 0) + (al.negativeMarginProducts?.length ?? 0);
  }, [al]);

  // % change vs previous period — returns null when prev=0 or unavailable
  function pctChange(cur: number, prev: number | undefined): number | null {
    if (prev == null || !isFinite(prev) || prev === 0) return null;
    return ((cur - prev) / Math.abs(prev)) * 100;
  }
  const p = k?.prev; // previous period KPIs (from compare=true)

  // ─── Sorted datasets ────────────────────────────────────────────────────────
  const sortedBranches  = useMemo(() => sortArr((branchData as any[] ?? []),   branchSortKey   as any, branchSortDir),   [branchData,   branchSortKey,   branchSortDir]);
  const sortedProducts  = useMemo(() => sortArr((products   as any[] ?? []),   productSortKey  as any, productSortDir),  [products,     productSortKey,  productSortDir]);
  const sortedCustomers = useMemo(() => sortArr((customers  as any[] ?? []),   customerSortKey as any, customerSortDir), [customers,    customerSortKey, customerSortDir]);
  const sortedSellers   = useMemo(() => sortArr((sellers    as any[] ?? []),   sellerSortKey   as any, sellerSortDir),   [sellers,      sellerSortKey,   sellerSortDir]);
  const sortedDocs      = useMemo(() => sortArr((documents  as any[] ?? []),   docSortKey      as any, docSortDir),      [documents,    docSortKey,      docSortDir]);

  // ─── Products with ABC + search + pagination ─────────────────────────────
  const overallMargin = useMemo(() => {
    const arr = products as any[] ?? [];
    const totalRev  = arr.reduce((a: number, p: any) => a + p.revenue, 0);
    const totalCost = arr.reduce((a: number, p: any) => a + (p.totalCost ?? 0), 0);
    return totalRev > 0 ? Math.round(((totalRev - totalCost) / totalRev) * 100) : null;
  }, [products]);

  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return sortedProducts as any[];
    const q2 = productSearch.toLowerCase();
    return (sortedProducts as any[]).filter((p: any) => p.productName?.toLowerCase().includes(q2));
  }, [sortedProducts, productSearch]);

  const totalProductPages = Math.max(1, Math.ceil(filteredProducts.length / PRODUCT_PAGE_SIZE));
  const paginatedProducts = useMemo(() => {
    const start = (productPage - 1) * PRODUCT_PAGE_SIZE;
    return filteredProducts.slice(start, start + PRODUCT_PAGE_SIZE);
  }, [filteredProducts, productPage, PRODUCT_PAGE_SIZE]);

  // ─── Time distribution typed ─────────────────────────────────────────────
  const td = timeDistribution as any;

  const handleExport = async () => {
    const r = await fetch(`/api/export/sales?${kpisQs}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("erp_token")}` },
    });
    if (!r.ok) return;
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `VENTES_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
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
                <Label className="text-xs text-muted-foreground">Boutiques</Label>
                <BranchMultiSelect
                  branches={(branches ?? []) as { id: number; name: string }[]}
                  selectedIds={branchIds}
                  onChange={setBranchIds}
                  size="sm"
                  placeholder="Toutes les boutiques"
                />
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
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Catégorie</Label>
              <SearchableCombobox
                items={[{ value: "all", label: "Toutes" }, ...parentCategories.map((c: any) => ({ value: String(c.id), label: c.name }))]}
                value={categoryFilter}
                onValueChange={v => { setCategoryFilter(v); setSubCategoryFilter("all"); }}
                placeholder="Toutes"
                searchPlaceholder="Chercher..."
                emptyMessage="Aucune catégorie."
                drawerTitle="Catégorie"
                triggerClassName="h-8 text-xs w-36"
              />
            </div>
            {subCategories.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Sous-catégorie</Label>
                <SearchableCombobox
                  items={[{ value: "all", label: "Toutes" }, ...subCategories.map((c: any) => ({ value: String(c.id), label: c.name }))]}
                  value={subCategoryFilter}
                  onValueChange={setSubCategoryFilter}
                  placeholder="Toutes"
                  searchPlaceholder="Chercher..."
                  emptyMessage="Aucune sous-catégorie."
                  drawerTitle="Sous-catégorie"
                  triggerClassName="h-8 text-xs w-36"
                />
              </div>
            )}
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
          change={k && p ? pctChange(k.grossRevenue, p.grossRevenue) : null}
        />
        <KpiCard
          title="CA net (après retours)"
          value={k ? fmtDA(k.netRevenue) : "—"}
          sub={k ? `−${fmtDA(k.totalRefunded)} retours (${k.returnImpactPct}%)` : "—"}
          icon={TrendingUp} color="emerald" loading={kpisLoading}
          change={k && p ? pctChange(k.netRevenue, p.netRevenue) : null}
        />
        <KpiCard
          title="Panier moyen"
          value={k ? fmtDA(k.avgBasket) : "—"}
          sub={k ? `${k.totalItemsSold.toLocaleString()} articles vendus` : "—"}
          icon={Tag} color="blue" loading={kpisLoading}
          change={k && p ? pctChange(k.avgBasket, p.avgBasket) : null}
        />
        <KpiCard
          title="Encaissé"
          value={k ? fmtDA(k.totalPaid + k.totalCreditApplied) : "—"}
          sub={k ? `${k.paymentRate}% du CA encaissé` : "—"}
          icon={CreditCard} color="indigo" loading={kpisLoading}
          highlight={k?.paymentRate >= 80 ? "good" : k?.paymentRate >= 50 ? "neutral" : "bad"}
          change={k && p ? pctChange(k.totalPaid + k.totalCreditApplied, p.totalPaid + p.totalCreditApplied) : null}
        />
        <KpiCard
          title="Créances impayées"
          value={k ? fmtDA(k.unpaidBalance) : "—"}
          sub={k ? `${k.unpaidCount} vente(s) impayée(s)` : "—"}
          icon={AlertTriangle} color="red" loading={kpisLoading}
          highlight={k?.unpaidBalance > 0 ? "bad" : "good"}
          change={k && p ? pctChange(k.unpaidBalance, p.unpaidBalance) : null}
          invertDelta
        />
        <KpiCard
          title="Clients actifs"
          value={k ? String(k.customerCount) : "—"}
          sub={k ? `+ ${k.saleCount - k.customerCount > 0 ? k.saleCount - k.customerCount : 0} ventes anonymes` : "—"}
          icon={Users} color="violet" loading={kpisLoading}
          change={k && p ? pctChange(k.customerCount, p.customerCount) : null}
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
          change={k && p ? pctChange(k.totalDiscount, p.totalDiscount) : null}
          invertDelta
        />
        <KpiCard
          title="Nb retours"
          value={k ? String(k.returnCount) : "—"}
          sub={k ? `Impact: −${fmtDA(k.totalRefunded)}` : "—"}
          icon={PackageX} color="red" loading={kpisLoading}
          highlight={k?.returnCount > 0 ? "bad" : "good"}
          change={k && p ? pctChange(k.returnCount, p.returnCount) : null}
          invertDelta
        />
        <KpiCard
          title="Impact retours"
          value={k ? `${k.returnImpactPct}%` : "—"}
          sub={k ? `${fmtDA(k.totalRefunded)} remboursé` : "—"}
          icon={Percent} color="red" loading={kpisLoading}
          highlight={k?.returnImpactPct > 5 ? "bad" : k?.returnImpactPct > 0 ? "neutral" : "good"}
          change={k && p ? pctChange(k.returnImpactPct, p.returnImpactPct) : null}
          invertDelta
        />
        <KpiCard
          title="Taux paiement"
          value={k ? `${k.paymentRate}%` : "—"}
          sub={k ? `${k.paidCount} soldées / ${k.partialCount} part. / ${k.unpaidCount} impayées` : "—"}
          icon={CheckCircle2} color="green" loading={kpisLoading}
          highlight={k?.paymentRate >= 80 ? "good" : k?.paymentRate >= 50 ? "neutral" : "bad"}
          change={k && p ? pctChange(k.paymentRate, p.paymentRate) : null}
        />
        <KpiCard
          title="Nb commandes"
          value={k ? String(k.orderCount) : "—"}
          sub="documents de type commande"
          icon={ClipboardList} color="amber" loading={kpisLoading}
          change={k && p ? pctChange(k.orderCount, p.orderCount) : null}
        />
        <KpiCard
          title="Marge brute globale"
          value={overallMargin !== null ? `${overallMargin}%` : (k?.grossMarginPct != null ? `${k.grossMarginPct}%` : "—")}
          sub="sur l'ensemble des produits vendus"
          icon={TrendingUp} color="emerald" loading={kpisLoading}
          highlight={overallMargin !== null ? (overallMargin >= 30 ? "good" : overallMargin >= 10 ? "neutral" : "bad") : "neutral"}
          change={k?.grossMarginPct != null && p?.grossMarginPct != null ? pctChange(k.grossMarginPct, p.grossMarginPct) : null}
        />
        <KpiCard
          title="Nb devis"
          value={k ? String(k.quoteCount) : "—"}
          sub="documents de type devis"
          icon={FileSearch} color="blue" loading={kpisLoading}
          change={k && p ? pctChange(k.quoteCount, p.quoteCount) : null}
        />
        <KpiCard
          title="Ventes part. payées"
          value={k ? String(k.partialCount) : "—"}
          sub={k ? `sur ${k.saleCount} ventes total` : "—"}
          icon={Layers} color="indigo" loading={kpisLoading}
          highlight={k?.partialCount > 0 ? "neutral" : "good"}
          change={k && p ? pctChange(k.partialCount, p.partialCount) : null}
          invertDelta
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

      {/* ── Patterns temporels ──────────────────────────────────────────────── */}
      {td && (Array.isArray(td.byHour) || Array.isArray(td.byDow)) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Hourly distribution */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Clock className="h-4 w-4 text-indigo-600" />
                Ventes par heure de la journée
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              {td.byHour?.some((h: any) => h.saleCount > 0) ? (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={td.byHour} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={2} />
                    <YAxis tick={{ fontSize: 10 }} width={28} />
                    <Tooltip content={<ChartTip />} />
                    <Bar dataKey="saleCount" name="Ventes" fill="#6366f1" radius={[3,3,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">Aucune donnée</div>
              )}
            </CardContent>
          </Card>

          {/* Day-of-week distribution */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-amber-600" />
                Ventes par jour de la semaine
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              {td.byDow?.some((d: any) => d.saleCount > 0) ? (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={td.byDow} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="short" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} width={28} />
                    <Tooltip content={<ChartTip />} />
                    <Bar dataKey="revenue" name="CA (DA)" fill="#f59e0b" radius={[3,3,0,0]} />
                    <Bar dataKey="saleCount" name="Ventes" fill="#10b981" radius={[3,3,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">Aucune donnée</div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Tabs: Products / Customers / Sellers / Documents / Categories ───── */}
      <Tabs value={activeMainTab} onValueChange={setActiveMainTab}>
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
          <TabsTrigger value="categories" className="text-xs h-7 px-3">
            <Layers className="h-3.5 w-3.5 mr-1.5" />
            Catégories
          </TabsTrigger>
          <TabsTrigger value="alerts" className="text-xs h-7 px-3 relative">
            <Bell className="h-3.5 w-3.5 mr-1.5" />
            Alertes
            {totalAlerts > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center h-4 min-w-[1rem] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold leading-none">
                {totalAlerts}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="discounts" className="text-xs h-7 px-3">
            <Percent className="h-3.5 w-3.5 mr-1.5" />
            Remises
          </TabsTrigger>
        </TabsList>

        {/* ── Products ─────────────────────────────────────────────────────────── */}
        <TabsContent value="products">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Tag className="h-4 w-4 text-amber-500" />
                  Tous les produits — par chiffre d'affaires
                  {Array.isArray(products) && (
                    <Badge variant="outline" className="text-[10px] h-4 ml-1">{(products as any[]).length}</Badge>
                  )}
                </CardTitle>
                <div className="relative w-56">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <Input
                    placeholder="Rechercher un produit…"
                    value={productSearch}
                    onChange={e => { setProductSearch(e.target.value); setProductPage(1); }}
                    className="h-7 text-xs pl-6 pr-2"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {Array.isArray(products) && (products as any[]).length > 0 ? (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="w-8 text-xs font-semibold">#</TableHead>
                        <TableHead className="w-8 text-xs font-semibold">ABC</TableHead>
                        <SortHead label="Produit"       sk="productName"   curKey={productSortKey} curDir={productSortDir} onToggle={k => { toggleSort(k, productSortKey, productSortDir, setProductSortKey, setProductSortDir); setProductPage(1); }} />
                        <SortHead label="CA total"      sk="revenue"       curKey={productSortKey} curDir={productSortDir} onToggle={k => { toggleSort(k, productSortKey, productSortDir, setProductSortKey, setProductSortDir); setProductPage(1); }} right />
                        <SortHead label="Marge%"        sk="marginPct"     curKey={productSortKey} curDir={productSortDir} onToggle={k => { toggleSort(k, productSortKey, productSortDir, setProductSortKey, setProductSortDir); setProductPage(1); }} right />
                        <SortHead label="Qté"           sk="qty"           curKey={productSortKey} curDir={productSortDir} onToggle={k => { toggleSort(k, productSortKey, productSortDir, setProductSortKey, setProductSortDir); setProductPage(1); }} right />
                        <SortHead label="Ventes"        sk="orderCount"    curKey={productSortKey} curDir={productSortDir} onToggle={k => { toggleSort(k, productSortKey, productSortDir, setProductSortKey, setProductSortDir); setProductPage(1); }} right />
                        <SortHead label="PU moyen"      sk="avgUnitPrice"  curKey={productSortKey} curDir={productSortDir} onToggle={k => { toggleSort(k, productSortKey, productSortDir, setProductSortKey, setProductSortDir); setProductPage(1); }} right />
                        <SortHead label="Part CA"       sk="revenuePct"    curKey={productSortKey} curDir={productSortDir} onToggle={k => { toggleSort(k, productSortKey, productSortDir, setProductSortKey, setProductSortDir); setProductPage(1); }} right />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedProducts.length > 0 ? paginatedProducts.map((p: any, i: number) => {
                        const globalIdx = (productPage - 1) * PRODUCT_PAGE_SIZE + i + 1;
                        const abcCls = p.abc === "A" ? "bg-green-100 text-green-800 border-green-200" : p.abc === "B" ? "bg-amber-100 text-amber-800 border-amber-200" : "bg-slate-100 text-slate-600 border-slate-200";
                        const marginCls = (p.marginPct ?? 0) >= 30 ? "text-green-700" : (p.marginPct ?? 0) >= 0 ? "text-amber-700" : "text-red-700";
                        return (
                          <TableRow key={p.productId}>
                            <TableCell className="text-xs text-muted-foreground font-mono">{globalIdx}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={`text-[10px] px-1 h-4 font-bold ${abcCls}`}>{p.abc}</Badge>
                            </TableCell>
                            <TableCell className="text-xs font-semibold">{p.productName}</TableCell>
                            <TableCell className="text-xs text-right font-bold text-green-700">{fmtDA(p.revenue)}</TableCell>
                            <TableCell className={`text-xs text-right font-semibold ${marginCls}`}>{p.marginPct ?? 0}%</TableCell>
                            <TableCell className="text-xs text-right font-mono">{(p.qty ?? 0).toFixed(0)}</TableCell>
                            <TableCell className="text-xs text-right text-muted-foreground">{p.orderCount}</TableCell>
                            <TableCell className="text-xs text-right text-muted-foreground">{fmtDA(p.avgUnitPrice)}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5 min-w-[60px]">
                                <Progress value={p.revenuePct} className="h-1.5 flex-1" />
                                <span className="text-[10px] text-muted-foreground w-8 shrink-0">{p.revenuePct}%</span>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      }) : (
                        <TableRow>
                          <TableCell colSpan={9} className="text-center text-xs text-muted-foreground py-8">
                            Aucun produit ne correspond à la recherche
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                  {/* Pagination */}
                  {totalProductPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-2 border-t border-border/50">
                      <span className="text-[11px] text-muted-foreground">
                        {filteredProducts.length} produit(s) · page {productPage}/{totalProductPages}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="sm" className="h-6 w-6 p-0" disabled={productPage <= 1} onClick={() => setProductPage(p => Math.max(1, p - 1))}>
                          <ChevronLeft className="h-3 w-3" />
                        </Button>
                        {Array.from({ length: Math.min(5, totalProductPages) }, (_, i) => {
                          const pg = productPage <= 3 ? i + 1 : productPage >= totalProductPages - 2 ? totalProductPages - 4 + i : productPage - 2 + i;
                          if (pg < 1 || pg > totalProductPages) return null;
                          return (
                            <Button key={pg} variant={pg === productPage ? "default" : "outline"} size="sm" className={`h-6 w-6 p-0 text-xs ${pg === productPage ? "bg-green-700 hover:bg-green-800" : ""}`} onClick={() => setProductPage(pg)}>
                              {pg}
                            </Button>
                          );
                        })}
                        <Button variant="outline" size="sm" className="h-6 w-6 p-0" disabled={productPage >= totalProductPages} onClick={() => setProductPage(p => Math.min(totalProductPages, p + 1))}>
                          <ChevronRight className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
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

        {/* ── Categories ────────────────────────────────────────────────────────── */}
        <TabsContent value="categories">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Layers className="h-4 w-4 text-indigo-600" />
                CA par catégorie de produit
              </CardTitle>
            </CardHeader>
            <CardContent>
              {Array.isArray(categories) && (categories as any[]).length > 0 ? (
                <div className="space-y-4">
                  {/* Horizontal bar chart */}
                  <ResponsiveContainer width="100%" height={Math.max(160, (categories as any[]).length * 36)}>
                    <BarChart
                      data={[...(categories as any[])].reverse()}
                      layout="vertical"
                      margin={{ top: 4, right: 60, left: 10, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={v => fmtK(v)} />
                      <YAxis type="category" dataKey="categoryName" tick={{ fontSize: 10 }} width={110} />
                      <Tooltip content={<ChartTip />} />
                      <Bar dataKey="revenue" name="CA (DA)" fill="#6366f1" radius={[0,3,3,0]} />
                    </BarChart>
                  </ResponsiveContainer>

                  {/* Table */}
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="text-xs font-semibold">#</TableHead>
                        <TableHead className="text-xs font-semibold">Catégorie</TableHead>
                        <TableHead className="text-xs font-semibold text-right">CA</TableHead>
                        <TableHead className="text-xs font-semibold text-right">Marge%</TableHead>
                        <TableHead className="text-xs font-semibold text-right">Qté</TableHead>
                        <TableHead className="text-xs font-semibold text-right">Produits</TableHead>
                        <TableHead className="text-xs font-semibold text-right">Ventes</TableHead>
                        <TableHead className="text-xs font-semibold text-right">Part CA</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(categories as any[]).map((c: any, i: number) => {
                        const marginCls = c.marginPct >= 30 ? "text-green-700" : c.marginPct >= 0 ? "text-amber-700" : "text-red-700";
                        return (
                          <TableRow key={c.categoryId ?? i}>
                            <TableCell className="text-xs text-muted-foreground font-mono">{i + 1}</TableCell>
                            <TableCell className="text-xs font-semibold">{c.categoryName}</TableCell>
                            <TableCell className="text-xs text-right font-bold text-green-700">{fmtDA(c.revenue)}</TableCell>
                            <TableCell className={`text-xs text-right font-semibold ${marginCls}`}>{c.marginPct}%</TableCell>
                            <TableCell className="text-xs text-right font-mono">{(c.qty ?? 0).toFixed(0)}</TableCell>
                            <TableCell className="text-xs text-right text-muted-foreground">{c.productCount}</TableCell>
                            <TableCell className="text-xs text-right text-muted-foreground">{c.saleCount}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5 min-w-[60px]">
                                <Progress value={c.revenuePct} className="h-1.5 flex-1" />
                                <span className="text-[10px] text-muted-foreground w-8 shrink-0">{c.revenuePct}%</span>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">Aucune catégorie sur cette période</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Alertes ───────────────────────────────────────────────────────────── */}
        <TabsContent value="alerts">
          {/* — Paramètres des seuils — */}
          <Card className="border-0 shadow-sm mb-4">
            <CardContent className="p-4">
              <div className="flex flex-wrap items-end gap-4">
                <div className="flex items-center gap-2 shrink-0">
                  <div className="p-1.5 rounded-md bg-amber-50">
                    <Package className="h-4 w-4 text-amber-600" />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">Produits stagnants</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">Pas vendu depuis</Label>
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={stagnantInput}
                    onChange={e => setStagnantInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && applyThresholds()}
                    className="h-7 w-16 text-xs text-center"
                  />
                  <span className="text-xs text-muted-foreground">jours</span>
                </div>
                <div className="w-px h-6 bg-border hidden sm:block" />
                <div className="flex items-center gap-2 shrink-0">
                  <div className="p-1.5 rounded-md bg-blue-50">
                    <UserX className="h-4 w-4 text-blue-600" />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">Clients inactifs</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">Aucun achat depuis</Label>
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={inactiveInput}
                    onChange={e => setInactiveInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && applyThresholds()}
                    className="h-7 w-16 text-xs text-center"
                  />
                  <span className="text-xs text-muted-foreground">jours</span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs ml-auto"
                  onClick={applyThresholds}
                >
                  Appliquer
                </Button>
              </div>
            </CardContent>
          </Card>

          {alertsLoading ? (
            <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">
              Analyse en cours…
            </div>
          ) : totalAlerts === 0 ? (
            <Card className="border-0 shadow-sm">
              <CardContent className="p-8 flex flex-col items-center gap-3 text-center">
                <CheckCircle2 className="h-10 w-10 text-green-500" />
                <p className="font-semibold text-green-700">Aucune alerte détectée</p>
                <p className="text-xs text-muted-foreground">Tous les produits se vendent bien et les clients sont actifs.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">

              {/* — Produits stagnants (stock > 0, pas vendu depuis 30j) — */}
              {al?.stagnantProducts?.length > 0 && (
                <Card className="border-0 shadow-sm border-l-4 border-l-amber-400">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <div className="p-1.5 rounded-md bg-amber-50">
                        <Package className="h-4 w-4 text-amber-600" />
                      </div>
                      <span>Produits stagnants — stock non vendu depuis {stagnantDays}+ jours</span>
                      <Badge className="ml-auto bg-amber-100 text-amber-700 border-amber-200 text-[10px]">
                        {al.stagnantProducts.length} produit(s)
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="divide-y divide-border/60">
                      {al.stagnantProducts.map((p: any) => (
                        <div
                          key={p.productId}
                          className="flex items-center gap-3 px-4 py-2.5 hover:bg-amber-50/60 cursor-pointer transition-colors"
                          onClick={() => navigate(`/products?q=${encodeURIComponent(p.productName)}`)}
                        >
                          <Package className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                          <span className="flex-1 text-sm font-medium truncate">{p.productName}</span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            Stock: <span className="font-semibold text-amber-700">{p.totalStock.toFixed(2)}</span>
                          </span>
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* — Clients inactifs (pas d'achat depuis 60j) — */}
              {al?.inactiveCustomers?.length > 0 && (
                <Card className="border-0 shadow-sm border-l-4 border-l-blue-400">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <div className="p-1.5 rounded-md bg-blue-50">
                        <UserX className="h-4 w-4 text-blue-600" />
                      </div>
                      <span>Clients inactifs — aucun achat depuis {inactiveDays}+ jours</span>
                      <Badge className="ml-auto bg-blue-100 text-blue-700 border-blue-200 text-[10px]">
                        {al.inactiveCustomers.length} client(s)
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="divide-y divide-border/60">
                      {al.inactiveCustomers.map((c: any) => (
                        <div
                          key={c.customerId}
                          className="flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50/60 cursor-pointer transition-colors"
                          onClick={() => navigate(`/contacts?q=${encodeURIComponent(c.customerName)}`)}
                        >
                          <Users className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                          <span className="flex-1 text-sm font-medium truncate">{c.customerName}</span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            Dernier achat: <span className="font-semibold text-blue-700">
                              {c.daysSince !== null ? `il y a ${c.daysSince} j` : "—"}
                            </span>
                          </span>
                          <span className="text-xs text-muted-foreground shrink-0 hidden sm:block">
                            CA total: <span className="font-semibold">{fmtDA(c.totalRevenue)}</span>
                          </span>
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* — Produits à marge négative — */}
              {al?.negativeMarginProducts?.length > 0 && (
                <Card className="border-0 shadow-sm border-l-4 border-l-red-400">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <div className="p-1.5 rounded-md bg-red-50">
                        <LossIcon className="h-4 w-4 text-red-600" />
                      </div>
                      <span>Produits à marge négative — vendus à perte</span>
                      <Badge className="ml-auto bg-red-100 text-red-700 border-red-200 text-[10px]">
                        {al.negativeMarginProducts.length} produit(s)
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="divide-y divide-border/60">
                      {al.negativeMarginProducts.map((p: any) => (
                        <div
                          key={p.productId}
                          className="flex items-center gap-3 px-4 py-2.5 hover:bg-red-50/60 cursor-pointer transition-colors"
                          onClick={() => navigate(`/products?q=${encodeURIComponent(p.productName)}`)}
                        >
                          <LossIcon className="h-3.5 w-3.5 text-red-500 shrink-0" />
                          <span className="flex-1 text-sm font-medium truncate">{p.productName}</span>
                          <span className="text-xs shrink-0">
                            Prix moyen: <span className="font-semibold text-slate-700">{fmtDA(p.avgUnitPrice)}</span>
                          </span>
                          <span className="text-xs shrink-0">
                            Coût: <span className="font-semibold text-slate-700">{fmtDA(p.costPrice)}</span>
                          </span>
                          <span className="text-xs font-bold text-red-600 shrink-0">
                            {p.marginPct}%
                          </span>
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

            </div>
          )}
        </TabsContent>

        {/* ── Ventes avec remise ──────────────────────────────────────────────── */}
        <TabsContent value="discounts" className="space-y-5 mt-4">
          {discountsLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <Card key={i} className="border-0 shadow-sm"><CardContent className="p-4"><div className="h-14 bg-muted animate-pulse rounded" /></CardContent></Card>
              ))}
            </div>
          ) : disc ? (
            <>
              {/* ── KPI Cards Row 1 ─────────────────────────────────────────────── */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <KpiCard title="Ventes avec remise" value={String(disc.summary.saleCount)} icon={Receipt} color="violet" sub={`sur ${disc.summary.saleCount > 0 ? "toutes les ventes" : "—"}`} />
                <KpiCard title="Valeur totale remises" value={fmtDA(disc.summary.totalDiscount)} icon={BadgeDollarSign} color="red" highlight="bad" />
                <KpiCard title="CA après remise" value={fmtDA(disc.summary.totalAfterDiscount)} icon={TrendingUp} color="green" highlight="good" />
                <KpiCard title="Remise moyenne" value={fmtDA(disc.summary.avgDiscount)} icon={Percent} color="amber" />
                <KpiCard title="% ventes remisées" value={`${disc.summary.pctOfSales}%`} icon={BarChart2} color="blue" sub="des ventes confirmées" />
              </div>

              {/* ── KPI Cards Row 2 — Top performers ─────────────────────────────── */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {disc.summary.topSeller && (
                  <Card className="border-0 shadow-sm bg-violet-50/50">
                    <CardContent className="p-3">
                      <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1"><Star className="h-3 w-3 text-violet-500" />Top vendeur remises</p>
                      <p className="font-bold text-sm mt-0.5 truncate">{disc.summary.topSeller.name}</p>
                      <p className="text-[11px] text-red-600 font-semibold">{fmtDA(disc.summary.topSeller.amount)} · {disc.summary.topSeller.count} vente(s)</p>
                    </CardContent>
                  </Card>
                )}
                {disc.summary.topBranch && (
                  <Card className="border-0 shadow-sm bg-blue-50/50">
                    <CardContent className="p-3">
                      <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1"><Building2 className="h-3 w-3 text-blue-500" />Top boutique remises</p>
                      <p className="font-bold text-sm mt-0.5 truncate">{disc.summary.topBranch.name}</p>
                      <p className="text-[11px] text-red-600 font-semibold">{fmtDA(disc.summary.topBranch.amount)} · {disc.summary.topBranch.count} vente(s)</p>
                    </CardContent>
                  </Card>
                )}
                {disc.summary.topProduct && (
                  <Card className="border-0 shadow-sm bg-amber-50/50">
                    <CardContent className="p-3">
                      <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1"><Package className="h-3 w-3 text-amber-500" />Top produit remisé</p>
                      <p className="font-bold text-sm mt-0.5 truncate">{disc.summary.topProduct.name}</p>
                      <p className="text-[11px] text-red-600 font-semibold">{fmtDA(disc.summary.topProduct.amount)}</p>
                    </CardContent>
                  </Card>
                )}
                {disc.summary.topCustomer && (
                  <Card className="border-0 shadow-sm bg-green-50/50">
                    <CardContent className="p-3">
                      <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3 text-green-500" />Top client remises</p>
                      <p className="font-bold text-sm mt-0.5 truncate">{disc.summary.topCustomer.name}</p>
                      <p className="text-[11px] text-red-600 font-semibold">{fmtDA(disc.summary.topCustomer.amount)} · {disc.summary.topCustomer.count} achat(s)</p>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* ── Charts ──────────────────────────────────────────────────────── */}
              <div className="grid lg:grid-cols-2 gap-4">
                {/* By day */}
                <Card className="border-0 shadow-sm">
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><TrendingDown className="h-4 w-4 text-red-500" />Remises par jour</CardTitle></CardHeader>
                  <CardContent className="pt-0">
                    {disc.charts.byDay.length > 0 ? (
                      <ResponsiveContainer width="100%" height={180}>
                        <AreaChart data={disc.charts.byDay} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="discGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={d => { try { return format(new Date(d), "dd/MM"); } catch { return d; } }} />
                          <YAxis tick={{ fontSize: 9 }} width={48} tickFormatter={v => fmtK(v)} />
                          <Tooltip content={<ChartTip />} />
                          <Area type="monotone" dataKey="discountAmount" name="Remise (DA)" stroke="#ef4444" fill="url(#discGrad)" strokeWidth={2} dot={false} />
                          <Area type="monotone" dataKey="saleAmount" name="CA (DA)" stroke="#10b981" fill="none" strokeDasharray="4 2" strokeWidth={1.5} dot={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : <div className="h-44 flex items-center justify-center text-xs text-muted-foreground">Aucune donnée</div>}
                  </CardContent>
                </Card>

                {/* Comparison stacked: CA vs remises */}
                <Card className="border-0 shadow-sm">
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><BarChart2 className="h-4 w-4 text-indigo-500" />CA vs Remises (par boutique)</CardTitle></CardHeader>
                  <CardContent className="pt-0">
                    {disc.charts.byBranch.length > 0 ? (
                      <ResponsiveContainer width="100%" height={180}>
                        <BarChart data={disc.charts.byBranch} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                          <YAxis tick={{ fontSize: 9 }} width={48} tickFormatter={v => fmtK(v)} />
                          <Tooltip content={<ChartTip />} />
                          <Bar dataKey="totalDiscount" name="Remise (DA)" fill="#ef4444" radius={[3,3,0,0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : <div className="h-44 flex items-center justify-center text-xs text-muted-foreground">Aucune donnée</div>}
                  </CardContent>
                </Card>

                {/* By seller */}
                <Card className="border-0 shadow-sm">
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Star className="h-4 w-4 text-violet-500" />Remises par vendeur</CardTitle></CardHeader>
                  <CardContent className="pt-0">
                    {disc.charts.bySeller.length > 0 ? (
                      <ResponsiveContainer width="100%" height={160}>
                        <BarChart data={disc.charts.bySeller} layout="vertical" margin={{ top: 0, right: 8, left: 80, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={v => fmtK(v)} />
                          <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={78} />
                          <Tooltip content={<ChartTip />} />
                          <Bar dataKey="totalDiscount" name="Remise (DA)" fill="#8b5cf6" radius={[0,3,3,0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">Aucune donnée</div>}
                  </CardContent>
                </Card>

                {/* By product */}
                <Card className="border-0 shadow-sm">
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Package className="h-4 w-4 text-amber-500" />Top produits remisés</CardTitle></CardHeader>
                  <CardContent className="pt-0">
                    {disc.charts.byProduct.length > 0 ? (
                      <ResponsiveContainer width="100%" height={160}>
                        <BarChart data={disc.charts.byProduct} layout="vertical" margin={{ top: 0, right: 8, left: 90, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={v => fmtK(v)} />
                          <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={88} />
                          <Tooltip content={<ChartTip />} />
                          <Bar dataKey="totalDiscount" name="Remise (DA)" fill="#f59e0b" radius={[0,3,3,0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">Aucune donnée</div>}
                  </CardContent>
                </Card>
              </div>

              {/* ── Detail Table ─────────────────────────────────────────────────── */}
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Percent className="h-4 w-4 text-violet-500" />
                      Lignes remisées
                      <Badge variant="outline" className="text-[10px] h-4 ml-1">{discountLines.length}</Badge>
                    </CardTitle>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={handleDiscountExportCsv}>
                        <Download className="h-3.5 w-3.5" />CSV
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={handleDiscountExportExcel}>
                        <Download className="h-3.5 w-3.5" />Excel
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => window.print()}>
                        <FileText className="h-3.5 w-3.5" />PDF
                      </Button>
                    </div>
                  </div>
                  <div className="relative mt-2">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Rechercher facture, client, produit, vendeur…"
                      value={discountSearch}
                      onChange={e => setDiscountSearch(e.target.value)}
                      className="pl-8 h-8 text-xs"
                    />
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/30">
                          {[
                            { label: "Facture", sk: "reference" },
                            { label: "Date", sk: "date" },
                            { label: "Heure", sk: "time" },
                            { label: "Client", sk: "customerName" },
                            { label: "Produit", sk: "productName" },
                            { label: "Qté", sk: "qty", right: true },
                            { label: "Prix orig.", sk: "originalPrice", right: true },
                            { label: "Remise DA", sk: "discountAmount", right: true },
                            { label: "Remise %", sk: "discountPct", right: true },
                            { label: "Prix final", sk: "finalPrice", right: true },
                            { label: "Profit", sk: "profit", right: true },
                            { label: "Vendeur", sk: "sellerName" },
                            { label: "Boutique", sk: "branchName" },
                            { label: "Raison", sk: "reason" },
                          ].map(col => (
                            <SortHead key={col.sk} label={col.label} sk={col.sk} curKey={discountSortKey} curDir={discountSortDir} right={col.right}
                              onToggle={k => {
                                if (k === discountSortKey) setDiscountSortDir(d => d === "desc" ? "asc" : "desc");
                                else { setDiscountSortKey(k); setDiscountSortDir("desc"); }
                              }}
                            />
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {discountLines.length === 0 ? (
                          <TableRow><TableCell colSpan={14} className="text-center text-xs text-muted-foreground py-10">Aucune vente avec remise sur cette période</TableCell></TableRow>
                        ) : discountLines.map((row: any, i: number) => (
                          <TableRow
                            key={`${row.saleId}-${i}`}
                            className="cursor-pointer hover:bg-muted/40 transition-colors text-xs"
                            onClick={() => setDiscountRow(row)}
                          >
                            <TableCell className="font-mono font-medium text-indigo-700 whitespace-nowrap">{row.reference}</TableCell>
                            <TableCell className="whitespace-nowrap">{fmtDateShort(row.date)}</TableCell>
                            <TableCell className="text-muted-foreground">{row.time}</TableCell>
                            <TableCell className="max-w-[120px] truncate">{row.customerName}</TableCell>
                            <TableCell className="max-w-[140px] truncate font-medium">{row.productName}</TableCell>
                            <TableCell className="text-right">{row.qty}</TableCell>
                            <TableCell className="text-right">{fmtDA(row.originalPrice)}</TableCell>
                            <TableCell className="text-right text-red-600 font-semibold">−{fmtDA(row.discountAmount)}</TableCell>
                            <TableCell className="text-right">
                              <Badge variant="outline" className="text-[10px] text-red-600 border-red-200 bg-red-50">{row.discountPct}%</Badge>
                            </TableCell>
                            <TableCell className="text-right font-semibold text-green-700">{fmtDA(row.finalPrice)}</TableCell>
                            <TableCell className={`text-right font-semibold ${row.profit < 0 ? "text-red-600" : "text-green-700"}`}>{fmtDA(row.profit)}</TableCell>
                            <TableCell className="max-w-[100px] truncate">{row.sellerName}</TableCell>
                            <TableCell className="max-w-[100px] truncate text-muted-foreground">{row.branchName}</TableCell>
                            <TableCell className="max-w-[120px] truncate text-muted-foreground italic">{row.reason ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
              <Percent className="h-8 w-8 mr-2 opacity-20" />
              Aucune donnée · Activez l'onglet pour charger
            </div>
          )}

          {/* ── Drawer Détails Vente ───────────────────────────────────────────── */}
          <Sheet open={!!discountRow} onOpenChange={open => { if (!open) setDiscountRow(null); }}>
            <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
              <SheetHeader className="pb-3">
                <SheetTitle className="flex items-center gap-2 text-base">
                  <Receipt className="h-4 w-4 text-violet-500" />
                  {discountRow?.reference ?? "Détails vente"}
                </SheetTitle>
                <SheetClose />
              </SheetHeader>

              {detailLoading ? (
                <div className="space-y-3 mt-4">
                  {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted animate-pulse rounded" />)}
                </div>
              ) : dDetail ? (
                <div className="space-y-4 pb-8">
                  {/* Meta */}
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div><p className="text-muted-foreground">Client</p><p className="font-semibold">{dDetail.customerName ?? "Anonyme"}</p></div>
                    <div><p className="text-muted-foreground">Vendeur</p><p className="font-semibold">{dDetail.sellerName ?? "—"}</p></div>
                    <div><p className="text-muted-foreground">Boutique</p><p className="font-semibold">{dDetail.branchName}</p></div>
                    <div><p className="text-muted-foreground">Paiement</p>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${(PAYMENT_CFG[dDetail.paymentStatus ?? ""] ?? PAYMENT_CFG.unpaid).cls}`}>
                        {(PAYMENT_CFG[dDetail.paymentStatus ?? ""] ?? { label: dDetail.paymentStatus ?? "—" }).label}
                      </span>
                    </div>
                    <div><p className="text-muted-foreground">Créé le</p><p className="font-medium">{dDetail.createdAt ? format(new Date(dDetail.createdAt), "dd/MM/yyyy HH:mm", { locale: fr }) : "—"}</p></div>
                    <div><p className="text-muted-foreground">Modifié le</p><p className="font-medium">{dDetail.updatedAt ? format(new Date(dDetail.updatedAt), "dd/MM/yyyy HH:mm", { locale: fr }) : "—"}</p></div>
                  </div>

                  {dDetail.notes && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs">
                      <p className="font-semibold text-amber-700 mb-0.5">Raison / Notes</p>
                      <p className="text-amber-800">{dDetail.notes}</p>
                    </div>
                  )}

                  <Separator />

                  {/* Items table */}
                  <div>
                    <p className="text-xs font-semibold mb-2 flex items-center gap-1"><Package className="h-3.5 w-3.5" />Produits ({dDetail.items?.length ?? 0})</p>
                    <div className="space-y-2">
                      {(dDetail.items ?? []).map((item: any) => (
                        <div key={item.id} className="bg-muted/30 rounded-lg p-3 text-xs">
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-semibold leading-tight">{item.productName}</p>
                            {item.discount > 0 && (
                              <Badge variant="outline" className="text-[10px] text-red-600 border-red-200 bg-red-50 shrink-0">−{item.discount} DA</Badge>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 mt-1.5 text-muted-foreground">
                            <span>Qté: <span className="text-foreground font-medium">{item.qty}</span></span>
                            <span>Prix unit.: <span className="text-foreground font-medium">{fmtDA(item.unitPrice)}</span></span>
                            <span>Original: <span className="text-foreground">{fmtDA(item.originalPrice)}</span></span>
                            {item.discount > 0 && <>
                              <span>Remise: <span className="text-red-600 font-semibold">−{fmtDA(item.discount)} ({item.discountPct}%)</span></span>
                            </>}
                            <span>Final: <span className="text-green-700 font-bold">{fmtDA(item.total)}</span></span>
                            <span>Profit: <span className={`font-semibold ${item.profit < 0 ? "text-red-600" : "text-green-700"}`}>{fmtDA(item.profit)}</span></span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <Separator />

                  {/* Totals */}
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between"><span className="text-muted-foreground">Sous-total</span><span className="font-medium">{fmtDA(dDetail.subtotal)}</span></div>
                    {dDetail.discount > 0 && (
                      <div className="flex justify-between text-red-600 font-semibold"><span>Remise globale</span><span>−{fmtDA(dDetail.discount)}</span></div>
                    )}
                    {dDetail.tax > 0 && (
                      <div className="flex justify-between"><span className="text-muted-foreground">TVA</span><span>{fmtDA(dDetail.tax)}</span></div>
                    )}
                    <Separator />
                    <div className="flex justify-between font-bold text-sm"><span>Total</span><span className="text-green-700">{fmtDA(dDetail.total)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Payé</span><span className="text-green-600 font-semibold">{fmtDA(dDetail.paid)}</span></div>
                    {(dDetail.total - dDetail.paid) > 0 && (
                      <div className="flex justify-between text-red-600 font-semibold"><span>Reste dû</span><span>{fmtDA(dDetail.total - dDetail.paid)}</span></div>
                    )}
                  </div>
                </div>
              ) : discountRow ? (
                <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">Chargement…</div>
              ) : null}
            </SheetContent>
          </Sheet>
        </TabsContent>
      </Tabs>
    </div>
  );
}
