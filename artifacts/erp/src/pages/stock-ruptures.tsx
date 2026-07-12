import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGetBranches, useGetProducts, customFetch } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2, Clock, PackageX, Filter, X, ChevronLeft, ChevronRight, Search, ChevronDown } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

type StockRupture = {
  productId: number;
  productName: string;
  branchId: number;
  branchName: string;
  ruptureAt: string;
  restockedAt: string | null;
  durationHours: number;
  status: string;
};

function fmtDuration(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 24) return `${Math.round(h)} h`;
  const days = Math.floor(h / 24);
  const rem = Math.round(h % 24);
  return rem > 0 ? `${days}j ${rem}h` : `${days}j`;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ongoing") {
    return (
      <Badge className="gap-1 bg-red-100 text-red-700 hover:bg-red-100 border-red-200">
        <AlertCircle className="h-3 w-3" />
        En cours
      </Badge>
    );
  }
  return (
    <Badge className="gap-1 bg-green-100 text-green-700 hover:bg-green-100 border-green-200">
      <CheckCircle2 className="h-3 w-3" />
      Résolu
    </Badge>
  );
}

export default function StockRuptures() {
  const [branchFilters, setBranchFilters] = useState<string[]>([]);
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const branchDropdownRef = useRef<HTMLDivElement>(null);

  const [productSearch, setProductSearch] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);

  // Close branch dropdown on outside click
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (branchDropdownRef.current && !branchDropdownRef.current.contains(e.target as Node)) {
        setBranchDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  function toggleBranch(id: string) {
    setBranchFilters(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    setCurrentPage(1);
  }

  const { data: branches = [] } = useGetBranches();
  const { data: products = [] } = useGetProducts({});

  const params: Record<string, string> = {};
  if (branchFilters.length === 1) params.branchId = branchFilters[0];
  else if (branchFilters.length > 1) params.branchIds = branchFilters.join(",");
  if (selectedProductId !== "all") params.productId = selectedProductId;
  if (dateFrom) params.dateFrom = dateFrom;
  if (dateTo) params.dateTo = dateTo;
  if (statusFilter !== "all") params.status = statusFilter;

  const { data: ruptures = [], isLoading } = useQuery<StockRupture[]>({
    queryKey: ["stock-ruptures", params],
    queryFn: () => {
      const qs = new URLSearchParams(params).toString();
      return customFetch(`/api/stock/ruptures${qs ? `?${qs}` : ""}`);
    },
    staleTime: 30_000,
  });

  const hasFilters = branchFilters.length > 0 || selectedProductId !== "all" || !!dateFrom || !!dateTo || statusFilter !== "all";

  function resetFilters() {
    setBranchFilters([]);
    setSelectedProductId("all");
    setProductSearch("");
    setDateFrom("");
    setDateTo("");
    setStatusFilter("all");
    setCurrentPage(1);
  }

  // KPIs
  const kpis = useMemo(() => {
    const ongoing = ruptures.filter(r => r.status === "ongoing").length;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonth = ruptures.filter(r => new Date(r.ruptureAt) >= startOfMonth).length;
    const resolved = ruptures.filter(r => r.status === "resolved");
    const avgDuration = resolved.length > 0
      ? resolved.reduce((s, r) => s + r.durationHours, 0) / resolved.length
      : 0;
    return { ongoing, thisMonth, avgDuration };
  }, [ruptures]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(ruptures.length / PAGE_SIZE));
  const paginated = ruptures.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Filtered products for the product search dropdown
  const filteredProducts = useMemo(
    () => products.filter(p => !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase())).slice(0, 80),
    [products, productSearch]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-serif font-bold flex items-center gap-2">
          <PackageX className="h-6 w-6 text-red-500" />
          Rapport Rupture de Stock
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Historique des produits tombés à zéro, durée de rupture et date de réapprovisionnement
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-red-200 bg-red-50/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full bg-red-100 p-2">
              <AlertCircle className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Ruptures en cours</p>
              <p className="text-2xl font-bold text-red-600">{kpis.ongoing}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full bg-amber-100 p-2">
              <PackageX className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Ce mois-ci</p>
              <p className="text-2xl font-bold">{kpis.thisMonth}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full bg-blue-100 p-2">
              <Clock className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Durée moy. résolue</p>
              <p className="text-2xl font-bold">{fmtDuration(kpis.avgDuration)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter bar */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          <Filter className="h-3.5 w-3.5" />
          Filtres
          {hasFilters && (
            <button
              onClick={resetFilters}
              className="ml-auto flex items-center gap-1 text-xs font-normal text-muted-foreground hover:text-destructive transition-colors"
            >
              <X className="h-3 w-3" />Réinitialiser
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Boutique — multi-select */}
          <div className="space-y-1 relative" ref={branchDropdownRef}>
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
                    : `${branchFilters.length} boutiques`}
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

          {/* Produit */}
          <Select
            value={selectedProductId}
            onValueChange={v => { setSelectedProductId(v); setProductSearch(""); setCurrentPage(1); }}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="Tous les produits" />
            </SelectTrigger>
            <SelectContent>
              <div className="flex items-center border-b px-2 pb-1 mb-1">
                <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0 mr-1.5" />
                <input
                  className="flex-1 text-sm outline-none bg-transparent py-1"
                  placeholder="Rechercher..."
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                  onKeyDown={e => e.stopPropagation()}
                />
              </div>
              <SelectItem value="all">Tous les produits</SelectItem>
              {filteredProducts.map(p => (
                <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Date from */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground shrink-0">Du</span>
            <Input
              type="date"
              className="h-9 text-sm"
              value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); setCurrentPage(1); }}
            />
          </div>

          {/* Date to */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground shrink-0">Au</span>
            <Input
              type="date"
              className="h-9 text-sm"
              value={dateTo}
              onChange={e => { setDateTo(e.target.value); setCurrentPage(1); }}
            />
          </div>

          {/* Statut */}
          <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setCurrentPage(1); }}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="Tous les statuts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les statuts</SelectItem>
              <SelectItem value="ongoing">En cours</SelectItem>
              <SelectItem value="resolved">Résolu</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produit</TableHead>
                <TableHead>Boutique</TableHead>
                <TableHead>Date rupture</TableHead>
                <TableHead>Heure exacte</TableHead>
                <TableHead>Jour</TableHead>
                <TableHead>Durée</TableHead>
                <TableHead>Date réappro</TableHead>
                <TableHead>Heure réappro</TableHead>
                <TableHead>Statut</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-muted-foreground text-sm">Chargement...</td>
                </tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-muted-foreground text-sm">
                    {hasFilters ? "Aucune rupture ne correspond aux filtres" : "Aucune rupture de stock détectée"}
                  </td>
                </tr>
              ) : paginated.map((r, i) => {
                const ruptureDate = new Date(r.ruptureAt);
                const weekday = format(ruptureDate, "EEEE", { locale: fr });
                const weekdayCapitalized = weekday.charAt(0).toUpperCase() + weekday.slice(1);
                return (
                  <TableRow key={i} className={r.status === "ongoing" ? "bg-red-50/40" : ""}>
                    <TableCell className="font-medium text-sm">{r.productName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.branchName}</TableCell>
                    <TableCell className="text-sm font-mono">
                      {format(ruptureDate, "dd/MM/yyyy")}
                    </TableCell>
                    <TableCell className="text-sm font-mono font-medium text-red-600">
                      {format(ruptureDate, "HH:mm")}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{weekdayCapitalized}</TableCell>
                    <TableCell>
                      <span className={`text-sm font-medium ${r.status === "ongoing" ? "text-red-600" : "text-foreground"}`}>
                        {fmtDuration(r.durationHours)}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm font-mono text-muted-foreground">
                      {r.restockedAt ? format(new Date(r.restockedAt), "dd/MM/yyyy") : <span className="text-red-500">—</span>}
                    </TableCell>
                    <TableCell className="text-sm font-mono text-muted-foreground">
                      {r.restockedAt ? format(new Date(r.restockedAt), "HH:mm") : <span className="text-red-500">—</span>}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Footer: count + pagination */}
      {!isLoading && (
        <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
          <span>
            {ruptures.length} rupture{ruptures.length !== 1 ? "s" : ""} trouvée{ruptures.length !== 1 ? "s" : ""}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <Button
                variant="outline" size="icon" className="h-7 w-7"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(p => p - 1)}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="px-2">Page {currentPage} / {totalPages}</span>
              <Button
                variant="outline" size="icon" className="h-7 w-7"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(p => p + 1)}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
