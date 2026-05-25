import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGetBranches, useGetContacts } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Truck, Building2, Package, CheckCircle2, Calendar, User, Search,
  ChevronRight, X, ArrowUpRight, Filter, Hash, ExternalLink
} from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface ReceptionItem {
  id: number; productId: number; productName: string; productUnit: string;
  quantityReceived: number; quantityRejected: number;
  unitCost: number | null; totalCost: number | null; notes: string | null;
}
interface Reception {
  id: number; purchaseId: number; purchaseReference: string;
  supplierId: number | null; supplierName: string;
  branchId: number; branchName: string;
  createdByName: string | null; createdAt: string; notes: string | null;
  items: ReceptionItem[]; itemCount: number;
  totalReceived: number; totalCost: number;
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function formatDA(n: number) {
  return new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(n) + " DA";
}
function formatDate(s: string) {
  return format(new Date(s), "dd MMM yyyy", { locale: fr });
}
function formatDateTime(s: string) {
  return format(new Date(s), "dd/MM/yyyy HH:mm", { locale: fr });
}
function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem("erp_token") ?? ""}` };
}
async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...opts, headers: { "Content-Type": "application/json", ...authHeaders(), ...(opts?.headers ?? {}) } });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any).error ?? "Erreur"); }
  return r.json();
}

/* ─── Detail panel ───────────────────────────────────────────────────────── */
function ReceptionDetailPanel({ reception, onClose }: { reception: Reception; onClose: () => void }) {
  const [, navigate] = useLocation();

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="font-mono text-sm font-bold text-primary">REC-{String(reception.id).padStart(5, "0")}</span>
              <Badge variant="outline" className="text-emerald-700 border-emerald-300 bg-emerald-50 text-xs">
                <CheckCircle2 className="h-3 w-3 mr-1" />Réceptionnée
              </Badge>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 shrink-0" />
                {formatDateTime(reception.createdAt)}
              </span>
              <span className="flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 shrink-0" />
                {reception.supplierName}
              </span>
              <span className="flex items-center gap-1.5">
                <Truck className="h-3.5 w-3.5 shrink-0" />
                {reception.branchName}
              </span>
              {reception.createdByName && (
                <span className="flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 shrink-0" />
                  {reception.createdByName}
                </span>
              )}
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Purchase link */}
        <button
          className="mt-3 flex items-center gap-2 text-sm text-primary hover:underline"
          onClick={() => { onClose(); navigate("/purchases"); }}
        >
          <Hash className="h-3.5 w-3.5" />
          Bon de commande : <span className="font-mono font-semibold">{reception.purchaseReference}</span>
          <ExternalLink className="h-3 w-3 opacity-60" />
        </button>

        {/* KPI row */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2 text-center">
            <p className="text-xs text-emerald-600 font-medium">Articles</p>
            <p className="text-lg font-bold text-emerald-700">{reception.itemCount}</p>
          </div>
          <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-center">
            <p className="text-xs text-blue-600 font-medium">Total reçu</p>
            <p className="text-lg font-bold text-blue-700">{reception.totalReceived.toLocaleString("fr-DZ")}</p>
          </div>
          <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-center">
            <p className="text-xs text-amber-600 font-medium">Coût total</p>
            <p className="text-sm font-bold text-amber-700 truncate">{formatDA(reception.totalCost)}</p>
          </div>
        </div>
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
          Articles réceptionnés
        </h3>
        <div className="rounded-xl border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="text-xs">Article</TableHead>
                <TableHead className="text-xs text-right">Reçu</TableHead>
                <TableHead className="text-xs text-right">Refusé</TableHead>
                <TableHead className="text-xs text-right">Coût unit.</TableHead>
                <TableHead className="text-xs text-right">Sous-total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reception.items.map(item => (
                <TableRow key={item.id}>
                  <TableCell>
                    <p className="text-sm font-medium">{item.productName}</p>
                    <p className="text-xs text-muted-foreground">{item.productUnit}</p>
                    {item.notes && <p className="text-xs text-amber-600 mt-0.5 italic">{item.notes}</p>}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="font-mono text-sm font-semibold text-emerald-600">
                      +{item.quantityReceived}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {item.quantityRejected > 0 ? (
                      <span className="font-mono text-sm text-red-500">-{item.quantityRejected}</span>
                    ) : (
                      <span className="text-muted-foreground/40 text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground font-mono">
                    {item.unitCost != null ? formatDA(item.unitCost) : "—"}
                  </TableCell>
                  <TableCell className="text-right text-sm font-semibold font-mono">
                    {item.totalCost != null ? formatDA(item.totalCost) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Total */}
        <div className="mt-3 rounded-lg bg-muted/40 px-4 py-3 flex items-center justify-between">
          <span className="text-sm font-medium">Total marchandises reçues</span>
          <span className="text-base font-bold text-primary">{formatDA(reception.totalCost)}</span>
        </div>

        {/* Notes */}
        {reception.notes && (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-100 px-4 py-3">
            <p className="text-xs font-semibold text-amber-700 mb-1">Notes de réception</p>
            <p className="text-sm text-amber-800">{reception.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Main page ──────────────────────────────────────────────────────────── */
export default function Receptions() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [branchFilter, setBranchFilter] = useState("all");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");

  const { data: branches = [] } = useGetBranches();
  const { data: suppliersRaw = [] } = useGetContacts({ type: "supplier" });
  const { data: suppliersBoth = [] } = useGetContacts({ type: "both" });
  const allSuppliers = [...suppliersRaw, ...suppliersBoth].filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i);

  const params = new URLSearchParams();
  if (branchFilter && branchFilter !== "all") params.set("branchId", branchFilter);
  if (supplierFilter && supplierFilter !== "all") params.set("supplierId", supplierFilter);
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);

  const { data: receptions = [], isLoading } = useQuery<Reception[]>({
    queryKey: ["receptions-list", branchFilter, supplierFilter, dateFrom, dateTo],
    queryFn: () => apiFetch(`/api/receptions?${params}`),
    staleTime: 15000,
  });

  const selected = receptions.find(r => r.id === selectedId) ?? null;

  const filtered = receptions.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.purchaseReference.toLowerCase().includes(q) ||
      r.supplierName.toLowerCase().includes(q) ||
      r.branchName.toLowerCase().includes(q) ||
      (r.createdByName ?? "").toLowerCase().includes(q)
    );
  });

  const totalCostAll = filtered.reduce((s, r) => s + r.totalCost, 0);
  const totalReceivedAll = filtered.reduce((s, r) => s + r.totalReceived, 0);

  function resetFilters() {
    setBranchFilter("all");
    setSupplierFilter("all");
    setDateFrom("");
    setDateTo("");
    setSearch("");
  }

  const hasFilters = branchFilter !== "all" || supplierFilter !== "all" || dateFrom || dateTo;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold">Réceptions</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Historique de toutes les réceptions fournisseurs</p>
        </div>
      </div>

      {/* KPI summary strip */}
      {!isLoading && filtered.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                <Truck className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Réceptions</p>
                <p className="text-xl font-bold">{filtered.length}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                <Package className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Unités reçues</p>
                <p className="text-xl font-bold">{totalReceivedAll.toLocaleString("fr-DZ")}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                <ArrowUpRight className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Valeur totale reçue</p>
                <p className="text-xl font-bold">{formatDA(totalCostAll)}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap gap-3 items-end">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Référence, fournisseur, agence..."
                className="pl-9"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            {/* Branch */}
            <div className="w-[160px]">
              <Select value={branchFilter} onValueChange={setBranchFilter}>
                <SelectTrigger><SelectValue placeholder="Agence" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes agences</SelectItem>
                  {branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Supplier */}
            <div className="w-[180px]">
              <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                <SelectTrigger><SelectValue placeholder="Fournisseur" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous fournisseurs</SelectItem>
                  {allSuppliers.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.displayName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Date range */}
            <div className="flex items-center gap-2">
              <div>
                <Label className="text-xs text-muted-foreground">Du</Label>
                <Input type="date" className="h-9 w-[135px] text-sm" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Au</Label>
                <Input type="date" className="h-9 w-[135px] text-sm" value={dateTo} onChange={e => setDateTo(e.target.value)} />
              </div>
            </div>

            {hasFilters && (
              <Button variant="ghost" size="sm" className="h-9 text-muted-foreground gap-1.5" onClick={resetFilters}>
                <X className="h-3.5 w-3.5" />Réinitialiser
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">N° Réception</TableHead>
                <TableHead>Bon de commande</TableHead>
                <TableHead>Fournisseur</TableHead>
                <TableHead>Agence destination</TableHead>
                <TableHead>Date & Heure</TableHead>
                <TableHead>Réceptionné par</TableHead>
                <TableHead className="text-right">Unités reçues</TableHead>
                <TableHead className="text-right">Valeur</TableHead>
                <TableHead className="w-8"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                    Chargement...
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-16">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <Truck className="h-10 w-10 opacity-20" />
                      <p className="text-sm">Aucune réception trouvée</p>
                      {hasFilters && (
                        <Button variant="outline" size="sm" onClick={resetFilters}>
                          Effacer les filtres
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : filtered.map(r => (
                <TableRow
                  key={r.id}
                  className={`cursor-pointer hover:bg-muted/40 transition-colors ${selectedId === r.id ? "bg-primary/5 border-l-2 border-l-primary" : ""}`}
                  onClick={() => setSelectedId(r.id)}
                >
                  <TableCell className="pl-4">
                    <span className="font-mono text-xs font-bold text-primary">
                      REC-{String(r.id).padStart(5, "0")}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs font-semibold text-muted-foreground">
                      {r.purchaseReference}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm font-medium">{r.supplierName || "—"}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Building2 className="h-3.5 w-3.5 shrink-0" />
                      {r.branchName}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <div>{formatDate(r.createdAt)}</div>
                    <div className="text-xs text-muted-foreground/60">
                      {format(new Date(r.createdAt), "HH:mm")}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.createdByName ? (
                      <span className="flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5 shrink-0 opacity-50" />
                        {r.createdByName}
                      </span>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="font-mono text-sm font-semibold text-emerald-600">
                      {r.totalReceived.toLocaleString("fr-DZ")}
                    </span>
                    <div className="text-xs text-muted-foreground">
                      {r.itemCount} article{r.itemCount !== 1 ? "s" : ""}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-sm font-semibold">{formatDA(r.totalCost)}</TableCell>
                  <TableCell>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Footer total */}
          {filtered.length > 0 && (
            <div className="border-t px-4 py-3 flex items-center justify-between bg-muted/20">
              <p className="text-xs text-muted-foreground">{filtered.length} réception{filtered.length !== 1 ? "s" : ""}</p>
              <p className="text-sm font-bold">{formatDA(totalCostAll)}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail sheet */}
      <Sheet open={selectedId != null} onOpenChange={open => { if (!open) setSelectedId(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col" onOpenAutoFocus={e => e.preventDefault()}>
          {selected && (
            <ReceptionDetailPanel
              reception={selected}
              onClose={() => setSelectedId(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
