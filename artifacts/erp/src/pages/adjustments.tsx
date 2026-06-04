import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useGetAdjustments, useCreateAdjustment, useGetBranches, useGetProducts, useGetStockLevels, useGetAdjustmentsStats, getGetAdjustmentsQueryKey, getGetStockLevelsQueryKey, useGetCompanySettings } from "@workspace/api-client-react";
import { generateAdjustmentPdf } from "@/lib/pdf-generator";
import { ExportButton } from "@/components/ExportButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, FileDown, Check, Search, X, TrendingDown, PackageMinus, AlertTriangle, BarChart3, CalendarRange, Filter, Trash2, ArrowUp, ArrowDown, ArrowUpDown, ChevronDown } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const REASONS = ["Inventaire physique", "DLC", "Labo perte", "Péremption", "Don", "Erreur de saisie", "Autre"];

function fmt(n: number) {
  return new Intl.NumberFormat("fr-DZ", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
}

export default function Adjustments() {
  const qc = useQueryClient();

  const [branchFilters, setBranchFilters] = useState<string[]>([]); // empty = all
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const branchDropdownRef = useRef<HTMLDivElement>(null);
  const [reasonFilters, setReasonFilters] = useState<string[]>([]);
  const [reasonDropdownOpen, setReasonDropdownOpen] = useState(false);
  const reasonDropdownRef = useRef<HTMLDivElement>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [productFilters, setProductFilters] = useState<string[]>([]); // array of product IDs
  const [productInputText, setProductInputText] = useState(""); // search inside dropdown
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);
  const productDropdownRef = useRef<HTMLDivElement>(null);
  const [quantityTypeFilter, setQuantityTypeFilter] = useState("all"); // "all" | "positive" | "negative"
  const [sortBy, setSortBy]   = useState<string>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (branchDropdownRef.current && !branchDropdownRef.current.contains(e.target as Node)) {
        setBranchDropdownOpen(false);
      }
      if (reasonDropdownRef.current && !reasonDropdownRef.current.contains(e.target as Node)) {
        setReasonDropdownOpen(false);
      }
      if (productDropdownRef.current && !productDropdownRef.current.contains(e.target as Node)) {
        setProductDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [form, setForm] = useState({ branchId: "", productId: "", quantityChange: "", reason: "", notes: "" });
  const [quantitySign, setQuantitySign] = useState<1 | -1>(-1);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const queryParams = {
    // pass single branchId to server only when exactly one branch is selected (for stats accuracy)
    ...(branchFilters.length === 1 ? { branchId: parseInt(branchFilters[0]) } : {}),
    ...(reasonFilters.length === 1 ? { reason: reasonFilters[0] } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  };

  const { data: adjustments = [], isLoading } = useGetAdjustments(queryParams);
  const { data: stats } = useGetAdjustmentsStats(queryParams);
  const { data: branches = [] } = useGetBranches();
  const { data: products = [] } = useGetProducts({});
  const { data: companySettings } = useGetCompanySettings();

  const { data: branchStockLevels = [] } = useGetStockLevels(
    form.branchId ? { branchId: parseInt(form.branchId) } : undefined,
    { query: { enabled: !!form.branchId } }
  );

  const branchProductIds = form.branchId
    ? new Set(branchStockLevels.map(s => s.productId))
    : null;

  const filteredProducts = products.filter(p => {
    const inBranch = !branchProductIds || branchProductIds.has(p.id);
    const matchSearch = !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase());
    return inBranch && matchSearch;
  });

  const selectedProduct = products.find(p => String(p.id) === form.productId);

  // ── Sales context for loss comparison (shown when ≥1 product selected)
  const selectedFilterProduct = useMemo(
    () => productFilters.length === 1 ? products.find(p => String(p.id) === productFilters[0]) : undefined,
    [products, productFilters]
  );
  const salesContextParams = useMemo(() => {
    if (productFilters.length === 0) return null;
    const p: Record<string, string> = { productIds: productFilters.join(",") };
    if (branchFilters.length === 1) p.branchId = branchFilters[0];
    else if (branchFilters.length > 1) p.branchIds = branchFilters.join(",");
    if (dateFrom) p.dateFrom = dateFrom;
    if (dateTo) p.dateTo = dateTo;
    return p;
  }, [productFilters, branchFilters, dateFrom, dateTo]);

  const hasActiveFilters = branchFilters.length > 0 || reasonFilters.length > 0 || !!dateFrom || !!dateTo || productFilters.length > 0 || quantityTypeFilter !== "all";

  function resetFilters() {
    setBranchFilters([]);
    setReasonFilters([]);
    setDateFrom("");
    setDateTo("");
    setProductFilters([]);
    setProductInputText("");
    setQuantityTypeFilter("all");
    setSortBy("date");
    setSortDir("desc");
  }

  function toggleBranch(id: string) {
    setBranchFilters(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function toggleReason(r: string) {
    setReasonFilters(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]);
  }

  function toggleProduct(id: string) {
    setProductFilters(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  // ── Client-side filtering + sorting
  const displayedAdjustments = useMemo(() => {
    let list = [...adjustments];
    // Multi-branch filter (client-side when 2+ selected)
    if (branchFilters.length > 1) {
      list = list.filter(a => branchFilters.includes(String(a.branchId)));
    }
    if (reasonFilters.length > 0) {
      list = list.filter(a => reasonFilters.includes(a.reason));
    }
    if (productFilters.length > 0) {
      list = list.filter(a => productFilters.includes(String(a.productId)));
    }
    if (quantityTypeFilter === "positive") list = list.filter(a => a.quantityChange > 0);
    if (quantityTypeFilter === "negative") list = list.filter(a => a.quantityChange < 0);
    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      switch (sortBy) {
        case "reference":   return dir * a.reference.localeCompare(b.reference);
        case "date":        return dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        case "product":     return dir * (a.productName ?? "").localeCompare(b.productName ?? "");
        case "branch":      return dir * (a.branchName  ?? "").localeCompare(b.branchName  ?? "");
        case "qty":         return dir * (a.quantityChange - b.quantityChange);
        case "value": {
          const va = a.quantityChange < 0 ? Math.abs(a.quantityChange) * (a.costPrice ?? 0) : 0;
          const vb = b.quantityChange < 0 ? Math.abs(b.quantityChange) * (b.costPrice ?? 0) : 0;
          return dir * (va - vb);
        }
        case "reason":  return dir * (a.reason  ?? "").localeCompare(b.reason  ?? "");
        case "createdBy":return dir * (a.createdByName ?? "").localeCompare(b.createdByName ?? "");
        default:        return 0;
      }
    });
    return list;
  }, [adjustments, reasonFilters, productFilters, quantityTypeFilter, sortBy, sortDir]);

  // ── Batch sold quantities per product for table rows (must come after displayedAdjustments)
  const uniqueProductIds = useMemo(
    () => [...new Set(displayedAdjustments.map(a => a.productId))],
    [displayedAdjustments]
  );
  const soldQtyParams = useMemo(() => {
    if (uniqueProductIds.length === 0) return null;
    const uniqueDates = [...new Set(displayedAdjustments.map(a => format(new Date(a.createdAt), "yyyy-MM-dd")))];
    const p: Record<string, string> = {
      productIds: uniqueProductIds.join(","),
      dates: uniqueDates.join(","),
    };
    if (branchFilters.length === 1) p.branchId = branchFilters[0];
    else if (branchFilters.length > 1) p.branchIds = branchFilters.join(",");
    return p;
  }, [uniqueProductIds, displayedAdjustments, branchFilters]);

  const { data: soldQtyMap = {} } = useQuery<Record<string, number>>({
    queryKey: ["adjustments-sold-qty", soldQtyParams],
    queryFn: async () => {
      if (!soldQtyParams) return {};
      const qs = new URLSearchParams(soldQtyParams).toString();
      return customFetch(`/api/adjustments/sold-quantities?${qs}`);
    },
    enabled: !!soldQtyParams,
    staleTime: 60_000,
  });

  const { data: salesCtx } = useQuery<{ soldQty: number; soldValue: number }>({
    queryKey: ["adjustments-sales-ctx", salesContextParams],
    queryFn: async () => {
      if (!salesContextParams) return { soldQty: 0, soldValue: 0 };
      const qs = new URLSearchParams(salesContextParams).toString();
      return customFetch(`/api/adjustments/sales-context?${qs}`);
    },
    enabled: !!salesContextParams,
    staleTime: 60_000,
  });

  // ── Stats computed from the currently displayed (filtered) rows
  const computedStats = useMemo(() => {
    const negatives = displayedAdjustments.filter(a => a.quantityChange < 0);
    let totalPerteQuantite = 0;
    let totalPerteValeur = 0;
    const byReasonMap = new Map<string, { count: number; quantite: number; valeur: number }>();
    for (const a of negatives) {
      const qty = Math.abs(a.quantityChange);
      const cost = a.costPrice ?? 0;
      const valeur = qty * cost;
      totalPerteQuantite += qty;
      totalPerteValeur += valeur;
      const existing = byReasonMap.get(a.reason) ?? { count: 0, quantite: 0, valeur: 0 };
      byReasonMap.set(a.reason, { count: existing.count + 1, quantite: existing.quantite + qty, valeur: existing.valeur + valeur });
    }
    const byReason = Array.from(byReasonMap.entries())
      .map(([reason, v]) => ({ reason, ...v }))
      .sort((a, b) => b.valeur - a.valeur);
    return {
      totalPerteQuantite: Math.round(totalPerteQuantite * 100) / 100,
      totalPerteValeur: Math.round(totalPerteValeur * 100) / 100,
      countPertes: negatives.length,
      byReason,
    };
  }, [displayedAdjustments]);

  function handleSort(col: string) {
    if (sortBy === col) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortBy(col);
      setSortDir("asc");
    }
  }

  function SortIcon({ col }: { col: string }) {
    if (sortBy !== col) return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/50" />;
    return sortDir === "asc"
      ? <ArrowUp   className="h-3.5 w-3.5 text-primary" />
      : <ArrowDown className="h-3.5 w-3.5 text-primary" />;
  }

  async function confirmDelete() {
    if (!deleteId) return;
    setDeleteLoading(true);
    try {
      await customFetch(`/api/adjustments/${deleteId}`, { method: "DELETE" });
      qc.invalidateQueries({ queryKey: getGetAdjustmentsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetStockLevelsQueryKey() });
      toast({ title: "Ajustement supprimé", description: "Le stock a été corrigé en conséquence." });
    } catch (err: any) {
      toast({ title: "Erreur", description: err?.data?.error ?? "Erreur lors de la suppression", variant: "destructive" });
    } finally {
      setDeleteLoading(false);
      setDeleteId(null);
    }
  }

  const createMutation = useCreateAdjustment({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetAdjustmentsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetStockLevelsQueryKey() });
        setDialogOpen(false);
        toast({ title: "Ajustement créé" });
      }
    }
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold">Ajustements de stock</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Corrections et régularisations</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton
            endpoint="export/adjustments"
            label="Exporter"
            variant="outline"
            params={{
              ...(branchFilters.length === 1 ? { branchId: branchFilters[0] } : {}),
              ...(branchFilters.length > 1  ? { branchIds: branchFilters.join(",") } : {}),
              ...(reasonFilters.length === 1 ? { reason: reasonFilters[0] } : {}),
              ...(dateFrom                  ? { dateFrom } : {}),
              ...(dateTo                    ? { dateTo } : {}),
              ...(productFilters.length > 0  ? { productIds: productFilters.join(",") } : {}),
            }}
          />
          <Button
            onClick={() => {
              setForm({ branchId: "", productId: "", quantityChange: "", reason: "", notes: "" });
              setQuantitySign(-1);
              setProductSearch("");
              setDialogOpen(true);
            }}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />Nouvel ajustement
          </Button>
        </div>
      </div>

      {/* ── Filtres ── */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          <Filter className="h-3.5 w-3.5" />
          Filtres
          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              className="ml-auto flex items-center gap-1 text-xs font-normal text-muted-foreground hover:text-destructive transition-colors"
            >
              <X className="h-3 w-3" />Réinitialiser
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* Boutique — multi-select */}
          <div className="space-y-1 relative" ref={branchDropdownRef}>
            <label className="text-xs font-medium text-muted-foreground">Boutique</label>
            <button
              type="button"
              onClick={() => setBranchDropdownOpen(o => !o)}
              className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 text-sm shadow-sm hover:bg-accent transition-colors"
            >
              <span className={branchFilters.length === 0 ? "text-muted-foreground" : "font-medium"}>
                {branchFilters.length === 0
                  ? "Toutes les boutiques"
                  : branchFilters.length === 1
                    ? branches.find(b => String(b.id) === branchFilters[0])?.name
                    : `${branchFilters.length} boutiques sélectionnées`}
              </span>
              <ChevronDown className={cn("h-4 w-4 opacity-50 transition-transform", branchDropdownOpen && "rotate-180")} />
            </button>
            {branchDropdownOpen && (
              <div className="absolute z-50 top-full mt-1 w-full rounded-md border bg-popover shadow-lg overflow-hidden">
                <div className="max-h-56 overflow-y-auto p-1">
                  <label className="flex items-center gap-2 rounded px-2 py-1.5 text-sm cursor-pointer hover:bg-accent select-none">
                    <input
                      type="checkbox"
                      checked={branchFilters.length === 0}
                      onChange={() => setBranchFilters([])}
                      className="h-4 w-4 rounded"
                    />
                    <span className="font-medium">Toutes les boutiques</span>
                  </label>
                  <div className="my-1 border-t" />
                  {branches.map(b => (
                    <label key={b.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm cursor-pointer hover:bg-accent select-none">
                      <input
                        type="checkbox"
                        checked={branchFilters.includes(String(b.id))}
                        onChange={() => toggleBranch(String(b.id))}
                        className="h-4 w-4 rounded"
                      />
                      {b.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Motif — multi-select */}
          <div className="space-y-1 relative" ref={reasonDropdownRef}>
            <label className="text-xs font-medium text-muted-foreground">Motif</label>
            <button
              type="button"
              onClick={() => setReasonDropdownOpen(o => !o)}
              className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 text-sm shadow-sm hover:bg-accent transition-colors"
            >
              <span className={reasonFilters.length === 0 ? "text-muted-foreground" : "font-medium"}>
                {reasonFilters.length === 0
                  ? "Tous les motifs"
                  : reasonFilters.length === 1
                    ? reasonFilters[0]
                    : `${reasonFilters.length} motifs sélectionnés`}
              </span>
              <ChevronDown className={cn("h-4 w-4 opacity-50 transition-transform", reasonDropdownOpen && "rotate-180")} />
            </button>
            {reasonDropdownOpen && (
              <div className="absolute z-50 top-full mt-1 w-full rounded-md border bg-popover shadow-lg overflow-hidden">
                <div className="max-h-56 overflow-y-auto p-1">
                  <label className="flex items-center gap-2 rounded px-2 py-1.5 text-sm cursor-pointer hover:bg-accent select-none">
                    <input
                      type="checkbox"
                      checked={reasonFilters.length === 0}
                      onChange={() => setReasonFilters([])}
                      className="h-4 w-4 rounded"
                    />
                    <span className="font-medium">Tous les motifs</span>
                  </label>
                  <div className="my-1 border-t" />
                  {REASONS.map(r => (
                    <label key={r} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm cursor-pointer hover:bg-accent select-none">
                      <input
                        type="checkbox"
                        checked={reasonFilters.includes(r)}
                        onChange={() => toggleReason(r)}
                        className="h-4 w-4 rounded"
                      />
                      {r}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Produit – multi-select avec recherche */}
          <div className="space-y-1 relative" ref={productDropdownRef}>
            <label className="text-xs font-medium text-muted-foreground">Produit</label>
            <button
              type="button"
              onClick={() => setProductDropdownOpen(o => !o)}
              className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 text-sm shadow-sm hover:bg-accent transition-colors"
            >
              <span className={productFilters.length === 0 ? "text-muted-foreground" : "font-medium"}>
                {productFilters.length === 0
                  ? "Tous les produits"
                  : productFilters.length === 1
                    ? products.find(p => String(p.id) === productFilters[0])?.name ?? "1 produit"
                    : `${productFilters.length} produits sélectionnés`}
              </span>
              <ChevronDown className={cn("h-4 w-4 opacity-50 transition-transform", productDropdownOpen && "rotate-180")} />
            </button>
            {productDropdownOpen && (
              <div className="absolute z-50 top-full mt-1 w-full rounded-md border bg-popover shadow-lg overflow-hidden">
                {/* Search inside dropdown */}
                <div className="p-2 border-b">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <Input
                      className="h-8 pl-8 text-sm"
                      placeholder="Rechercher..."
                      value={productInputText}
                      onChange={e => setProductInputText(e.target.value)}
                      onMouseDown={e => e.stopPropagation()}
                      autoFocus
                    />
                  </div>
                </div>
                <div className="max-h-56 overflow-y-auto p-1">
                  <label className="flex items-center gap-2 rounded px-2 py-1.5 text-sm cursor-pointer hover:bg-accent select-none">
                    <input
                      type="checkbox"
                      checked={productFilters.length === 0}
                      onChange={() => { setProductFilters([]); setProductInputText(""); }}
                      className="h-4 w-4 rounded"
                    />
                    <span className="font-medium">Tous les produits</span>
                  </label>
                  <div className="my-1 border-t" />
                  {products
                    .filter(p => !productInputText || p.name.toLowerCase().includes(productInputText.toLowerCase()))
                    .slice(0, 40)
                    .map(p => (
                      <label key={p.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm cursor-pointer hover:bg-accent select-none">
                        <input
                          type="checkbox"
                          checked={productFilters.includes(String(p.id))}
                          onChange={() => toggleProduct(String(p.id))}
                          className="h-4 w-4 rounded"
                        />
                        <span className="flex-1 truncate">{p.name}</span>
                        {p.sku && <span className="text-xs text-muted-foreground shrink-0">{p.sku}</span>}
                      </label>
                    ))}
                  {products.filter(p => !productInputText || p.name.toLowerCase().includes(productInputText.toLowerCase())).length === 0 && (
                    <p className="px-3 py-2 text-sm text-muted-foreground">Aucun produit trouvé</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Date de */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <CalendarRange className="h-3 w-3" />Du
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          {/* Date à */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <CalendarRange className="h-3 w-3" />Au
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              min={dateFrom || undefined}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          {/* Type de quantité */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Quantité</label>
            <Select value={quantityTypeFilter} onValueChange={setQuantityTypeFilter}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Tous" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les mouvements</SelectItem>
                <SelectItem value="positive">✚ Entrées (positif)</SelectItem>
                <SelectItem value="negative">✖ Sorties (négatif)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {hasActiveFilters && (
          <div className="flex flex-wrap gap-2 pt-1">
            {branchFilters.map(bid => (
              <span key={bid} className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-medium">
                {branches.find(b => String(b.id) === bid)?.name}
                <button onClick={() => setBranchFilters(prev => prev.filter(x => x !== bid))}><X className="h-3 w-3" /></button>
              </span>
            ))}
            {reasonFilters.map(r => (
              <span key={r} className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-2.5 py-0.5 text-xs font-medium">
                {r}
                <button onClick={() => toggleReason(r)}><X className="h-3 w-3" /></button>
              </span>
            ))}
            {dateFrom && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 text-blue-800 px-2.5 py-0.5 text-xs font-medium">
                Du {dateFrom}
                <button onClick={() => setDateFrom("")}><X className="h-3 w-3" /></button>
              </span>
            )}
            {dateTo && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 text-blue-800 px-2.5 py-0.5 text-xs font-medium">
                Au {dateTo}
                <button onClick={() => setDateTo("")}><X className="h-3 w-3" /></button>
              </span>
            )}
            {productFilters.map(pid => {
              const p = products.find(pr => String(pr.id) === pid);
              return p ? (
                <span key={pid} className="inline-flex items-center gap-1 rounded-full bg-violet-100 text-violet-800 px-2.5 py-0.5 text-xs font-medium">
                  {p.name}
                  <button onClick={() => toggleProduct(pid)}><X className="h-3 w-3" /></button>
                </span>
              ) : null;
            })}
            {quantityTypeFilter !== "all" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-0.5 text-xs font-medium">
                {quantityTypeFilter === "positive" ? "Entrées +" : "Sorties −"}
                <button onClick={() => setQuantityTypeFilter("all")}><X className="h-3 w-3" /></button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Bloc Pertes */}
      <Card className="border-red-200 bg-red-50/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2 text-red-700">
            <TrendingDown className="h-4 w-4" />
            Pertes & ajustements négatifs
            {branchFilters.length > 0 && (
              <span className="ml-1 text-xs font-normal text-red-500/80">
                — {branchFilters.length === 1
                  ? branches.find(b => String(b.id) === branchFilters[0])?.name
                  : `${branchFilters.length} boutiques`}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          {/* KPI row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-white border border-red-100 p-3 text-center">
              <div className="text-xs text-muted-foreground mb-1 flex items-center justify-center gap-1">
                <AlertTriangle className="h-3 w-3 text-red-400" />Valeur perdue
              </div>
              <div className="text-xl font-bold text-red-600">{fmt(computedStats.totalPerteValeur)}</div>
              <div className="text-xs text-muted-foreground">DA</div>
            </div>
            <div className="rounded-lg bg-white border border-red-100 p-3 text-center">
              <div className="text-xs text-muted-foreground mb-1 flex items-center justify-center gap-1">
                <PackageMinus className="h-3 w-3 text-orange-400" />Unités perdues
              </div>
              <div className="text-xl font-bold text-orange-600">{fmt(computedStats.totalPerteQuantite)}</div>
              <div className="text-xs text-muted-foreground">unités</div>
            </div>
            <div className="rounded-lg bg-white border border-red-100 p-3 text-center">
              <div className="text-xs text-muted-foreground mb-1 flex items-center justify-center gap-1">
                <BarChart3 className="h-3 w-3 text-slate-400" />Opérations
              </div>
              <div className="text-xl font-bold text-slate-700">{computedStats.countPertes}</div>
              <div className="text-xs text-muted-foreground">ajustements négatifs</div>
            </div>
          </div>

          {/* ── Loss vs Sales comparison (shown when ≥1 product selected) */}
          {salesCtx && productFilters.length > 0 && (
            <div className="rounded-lg border border-orange-200 bg-orange-50/60 px-4 py-3">
              <div className="text-xs font-semibold text-orange-700 uppercase tracking-wide mb-2">
                {productFilters.length === 1 && selectedFilterProduct
                  ? `Comparaison ventes / pertes — ${selectedFilterProduct.name}`
                  : `Comparaison ventes / pertes — ${productFilters.length} produits sélectionnés`}
              </div>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-400" />
                  <span className="text-muted-foreground">Vendu :</span>
                  <span className="font-bold text-blue-700">{fmt(salesCtx.soldQty)} unités</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-400" />
                  <span className="text-muted-foreground">Perdu :</span>
                  <span className="font-bold text-red-600">{fmt(computedStats.totalPerteQuantite)} unités</span>
                </div>
                {salesCtx.soldQty > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400" />
                    <span className="text-muted-foreground">Taux de perte :</span>
                    <span className={`font-bold ${
                      (computedStats.totalPerteQuantite / salesCtx.soldQty) > 0.05
                        ? "text-red-600"
                        : "text-amber-600"
                    }`}>
                      {((computedStats.totalPerteQuantite / salesCtx.soldQty) * 100).toFixed(1)} %
                    </span>
                  </div>
                )}
                {salesCtx.soldQty === 0 && (
                  <span className="text-xs text-muted-foreground italic">Aucune vente enregistrée sur la période</span>
                )}
              </div>
              {/* Mini progress bar */}
              {salesCtx.soldQty > 0 && (
                <div className="mt-2 h-2 w-full rounded-full bg-blue-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-red-400 transition-all"
                    style={{ width: `${Math.min(100, (computedStats.totalPerteQuantite / (salesCtx.soldQty + computedStats.totalPerteQuantite)) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Breakdown by reason */}
          {computedStats.byReason.length > 0 && (
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
                    {computedStats.byReason.map((row, i) => (
                      <tr key={row.reason} className={cn("border-b border-red-50 last:border-0", i % 2 === 1 && "bg-red-50/20")}>
                        <td className="px-3 py-2 font-medium">{row.reason}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">{row.count}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">{fmt(row.quantite)}</td>
                        <td className="px-3 py-2 text-right font-semibold text-red-600">{fmt(row.valeur)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!isLoading && computedStats.countPertes === 0 && (
            <div className="text-sm text-center text-muted-foreground py-2">Aucune perte enregistrée</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                {(["reference","date","product","branch","qty"] as const).map(col => {
                  const labels: Record<string,string> = {
                    reference: "Référence", date: "Date", product: "Produit",
                    branch: "Boutique", qty: "Variation",
                  };
                  return (
                    <TableHead key={col}>
                      <button
                        onClick={() => handleSort(col)}
                        className="flex items-center gap-1 font-medium hover:text-foreground transition-colors"
                      >
                        {labels[col]}
                        <SortIcon col={col} />
                      </button>
                    </TableHead>
                  );
                })}
                <TableHead className="text-xs text-right text-blue-600 font-semibold">Vendu</TableHead>
                {(["value","reason","createdBy"] as const).map(col => {
                  const labels: Record<string,string> = {
                    value: "Valeur (DA)", reason: "Motif", createdBy: "Par",
                  };
                  return (
                    <TableHead key={col}>
                      <button
                        onClick={() => handleSort(col)}
                        className="flex items-center gap-1 font-medium hover:text-foreground transition-colors"
                      >
                        {labels[col]}
                        <SortIcon col={col} />
                      </button>
                    </TableHead>
                  );
                })}
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={10} className="text-center py-12 text-muted-foreground">Chargement...</TableCell></TableRow>
              ) : displayedAdjustments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-12 text-muted-foreground">
                    {hasActiveFilters ? "Aucun ajustement pour ces filtres" : "Aucun ajustement"}
                  </TableCell>
                </TableRow>
              ) : displayedAdjustments.map(a => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-xs">{a.reference}</TableCell>
                  <TableCell className="text-sm">
                    <div>{format(new Date(a.createdAt), "dd/MM/yyyy")}</div>
                    <div className="text-xs text-muted-foreground capitalize">{format(new Date(a.createdAt), "EEEE", { locale: fr })}</div>
                  </TableCell>
                  <TableCell className="font-medium text-sm">{a.productName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{a.branchName}</TableCell>
                  <TableCell className="text-sm">
                    <div className={`font-mono font-medium ${a.quantityChange > 0 ? "text-green-600" : "text-red-600"}`}>
                      {a.quantityChange > 0 ? "+" : ""}{a.quantityChange}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-right">
                    {(() => {
                      const dateKey = format(new Date(a.createdAt), "yyyy-MM-dd");
                      const qty = soldQtyMap[`${a.productId}_${dateKey}`];
                      return qty != null
                        ? <span className="font-mono text-blue-600">{fmt(qty)}</span>
                        : <span className="text-muted-foreground/40">—</span>;
                    })()}
                  </TableCell>
                  <TableCell className="text-sm font-mono">
                    {a.quantityChange < 0 && a.costPrice != null
                      ? <span className="text-red-600 font-semibold">{fmt(Math.abs(a.quantityChange) * a.costPrice)}</span>
                      : <span className="text-muted-foreground/40">—</span>}
                  </TableCell>
                  <TableCell className="text-sm">{a.reason}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {a.createdByName ?? <span className="text-muted-foreground/40 italic text-xs">—</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        title="Télécharger PDF"
                        onClick={() => {
                          if (!companySettings) return;
                          generateAdjustmentPdf({
                            reference: a.reference, branchName: a.branchName,
                            productName: a.productName, quantityChange: a.quantityChange,
                            reason: a.reason, notes: (a as any).notes ?? null,
                            createdByName: (a as any).createdByName ?? null, createdAt: a.createdAt,
                          }, companySettings as any);
                        }}
                      >
                        <FileDown className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive hover:bg-destructive/10"
                        title="Supprimer"
                        onClick={() => setDeleteId(a.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0"><DialogTitle>Nouvel ajustement de stock</DialogTitle></DialogHeader>
          <div className="flex-1 overflow-y-auto overscroll-contain space-y-4 pr-1">
            <div>
              <Label>Boutique *</Label>
              <Select
                value={form.branchId}
                onValueChange={v => setForm(f => ({ ...f, branchId: v, productId: "" }))}
              >
                <SelectTrigger><SelectValue placeholder="Choisir..." /></SelectTrigger>
                <SelectContent>
                  {branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Produit *</Label>
              {!form.branchId ? (
                <div className="flex h-9 w-full items-center rounded-md border border-input bg-muted/30 px-3 text-sm text-muted-foreground">
                  Choisir une boutique d'abord
                </div>
              ) : (
                <div className="rounded-md border border-input bg-background">
                  <div className="flex items-center border-b px-3">
                    <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Rechercher un produit..."
                      value={productSearch}
                      onChange={e => setProductSearch(e.target.value)}
                      className="flex h-9 w-full bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
                    />
                    {productSearch && (
                      <button onClick={() => setProductSearch("")} className="ml-1 text-muted-foreground hover:text-foreground">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="max-h-[180px] overflow-y-auto overscroll-contain">
                    {filteredProducts.length === 0 ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">Aucun produit trouvé</p>
                    ) : (
                      filteredProducts.map(p => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => { setForm(f => ({ ...f, productId: String(p.id) })); setProductSearch(""); }}
                          className={cn(
                            "w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-accent transition-colors",
                            form.productId === String(p.id) && "bg-accent font-medium"
                          )}
                        >
                          <Check className={cn("h-3.5 w-3.5 shrink-0 text-primary", form.productId === String(p.id) ? "opacity-100" : "opacity-0")} />
                          {p.name}
                        </button>
                      ))
                    )}
                  </div>
                  {selectedProduct && (
                    <div className="border-t px-3 py-1.5 flex items-center justify-between bg-primary/5">
                      <span className="text-xs font-medium text-primary truncate">{selectedProduct.name}</span>
                      <button onClick={() => setForm(f => ({ ...f, productId: "" }))} className="text-muted-foreground hover:text-destructive ml-2 shrink-0">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              )}
              {form.branchId && branchProductIds && branchProductIds.size === 0 && (
                <p className="text-xs text-muted-foreground mt-1">Aucun produit en stock dans cette boutique</p>
              )}
            </div>

            <div>
              <Label>Variation de quantité *</Label>
              <div className="flex gap-2 mt-1.5">
                <button
                  type="button"
                  onClick={() => setQuantitySign(s => s === -1 ? 1 : -1)}
                  className={`flex items-center justify-center h-9 w-12 shrink-0 rounded-md border text-lg font-bold transition-colors ${
                    quantitySign === -1
                      ? "border-red-300 bg-red-50 text-red-600 hover:bg-red-100"
                      : "border-green-300 bg-green-50 text-green-600 hover:bg-green-100"
                  }`}
                  title="Cliquer pour inverser le signe"
                >
                  {quantitySign === -1 ? "−" : "+"}
                </button>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={form.quantityChange}
                  onChange={e => {
                    const val = e.target.value.replace(",", ".").replace(/^-/, "");
                    if (/^\d*\.?\d*$/.test(val)) setForm(f => ({ ...f, quantityChange: val }));
                  }}
                  placeholder="Ex : 5 ou 1.250"
                  className="flex-1"
                />
              </div>
              {form.quantityChange && (
                <p className={`text-xs mt-1 font-medium ${quantitySign === -1 ? "text-red-600" : "text-green-600"}`}>
                  Valeur enregistrée : {quantitySign === -1 ? "−" : "+"}{form.quantityChange || "0"}
                </p>
              )}
            </div>
            <div>
              <Label>Motif *</Label>
              <Select value={form.reason} onValueChange={v => setForm(f => ({ ...f, reason: v }))}>
                <SelectTrigger><SelectValue placeholder="Choisir un motif" /></SelectTrigger>
                <SelectContent>{REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter className="shrink-0 pt-2 border-t">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
            <Button
              onClick={() => createMutation.mutate({
                data: {
                  branchId: parseInt(form.branchId),
                  productId: parseInt(form.productId),
                  quantityChange: quantitySign * parseFloat(form.quantityChange),
                  reason: form.reason,
                  notes: form.notes || null
                }
              })}
              disabled={!form.branchId || !form.productId || !form.quantityChange || isNaN(parseFloat(form.quantityChange)) || !form.reason || createMutation.isPending}
            >
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteId !== null} onOpenChange={open => { if (!open) setDeleteId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-4 w-4" />
              Supprimer l'ajustement
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Cette action est <strong>irréversible</strong>. Le stock sera corrigé automatiquement pour annuler l'effet de cet ajustement.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)} disabled={deleteLoading}>Annuler</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleteLoading}>
              {deleteLoading ? "Suppression..." : "Supprimer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
