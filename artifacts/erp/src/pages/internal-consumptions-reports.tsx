import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGetBranches } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { BarChart3, Package, Building2, TrendingDown, Filter, X } from "lucide-react";
import { format, startOfMonth } from "date-fns";
function formatDA(n: number) {
  return new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(n) + " DA";
}

type Summary = {
  totalCost: number;
  totalQty: number;
  docCount: number;
  byBranch: Array<{ branchId: number; branchName: string; totalCost: number; totalQty: number; docCount: number }>;
  byProduct: Array<{ productId: number; productName: string; totalCost: number; totalQty: number }>;
};

async function apiCall(path: string) {
  const r = await fetch(`/api${path}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem("erp_token")}` },
  });
  if (!r.ok) throw new Error("Erreur lors du chargement");
  return r.json();
}

function fmt(n: number) {
  return new Intl.NumberFormat("fr-DZ", { minimumFractionDigits: 0, maximumFractionDigits: 3 }).format(n);
}

export default function InternalConsumptionReports() {
  const { data: branches = [] } = useGetBranches();

  const [dateFrom, setDateFrom] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [dateTo, setDateTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [destBranchId, setDestBranchId] = useState("all");
  const [srcBranchId, setSrcBranchId] = useState("all");
  const [activeTab, setActiveTab] = useState<"branch" | "product">("branch");

  const params: Record<string, string> = {};
  if (dateFrom) params.dateFrom = dateFrom;
  if (dateTo) params.dateTo = dateTo;
  if (destBranchId !== "all") params.destinationBranchId = destBranchId;
  if (srcBranchId !== "all") params.sourceBranchId = srcBranchId;

  const qs = new URLSearchParams(params).toString();

  const { data: summary, isLoading } = useQuery<Summary>({
    queryKey: ["internal-consumptions-summary", params],
    queryFn: () => apiCall(`/internal-consumptions/reports/summary${qs ? `?${qs}` : ""}`),
  });

  function resetFilters() {
    setDateFrom(format(startOfMonth(new Date()), "yyyy-MM-dd"));
    setDateTo(format(new Date(), "yyyy-MM-dd"));
    setDestBranchId("all");
    setSrcBranchId("all");
  }

  const hasActiveFilters = destBranchId !== "all" || srcBranchId !== "all";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Rapport — Consommation interne</h1>
          <p className="text-muted-foreground text-sm">Synthèse des consommations internes confirmées par période</p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <Label className="text-xs mb-1 block">Du</Label>
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-8 text-sm w-40" />
            </div>
            <div>
              <Label className="text-xs mb-1 block">Au</Label>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-8 text-sm w-40" />
            </div>
            <div>
              <Label className="text-xs mb-1 block">Source</Label>
              <Select value={srcBranchId} onValueChange={setSrcBranchId}>
                <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="Toutes sources" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes sources</SelectItem>
                  {branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Destination</Label>
              <Select value={destBranchId} onValueChange={setDestBranchId}>
                <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="Toutes destinations" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes destinations</SelectItem>
                  {branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={resetFilters} className="h-8 text-xs">
                <X className="h-3.5 w-3.5 mr-1" />
                Réinitialiser
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <TrendingDown className="h-3.5 w-3.5" />
              Coût total consommé
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4 px-4">
            <p className="text-2xl font-bold">{isLoading ? "…" : formatDA(summary?.totalCost ?? 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Package className="h-3.5 w-3.5" />
              Quantité totale
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4 px-4">
            <p className="text-2xl font-bold">{isLoading ? "…" : fmt(summary?.totalQty ?? 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <BarChart3 className="h-3.5 w-3.5" />
              Documents confirmés
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4 px-4">
            <p className="text-2xl font-bold">{isLoading ? "…" : (summary?.docCount ?? 0)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-1">
        <button
          onClick={() => setActiveTab("branch")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === "branch" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`}
        >
          <Building2 className="h-3.5 w-3.5" />
          Par boutique
        </button>
        <button
          onClick={() => setActiveTab("product")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === "product" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`}
        >
          <Package className="h-3.5 w-3.5" />
          Par produit
        </button>
      </div>

      {/* Data Table */}
      <Card>
        <CardContent className="p-0">
          {activeTab === "branch" ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Boutique destination</TableHead>
                  <TableHead className="text-center">Documents</TableHead>
                  <TableHead className="text-right">Quantité totale</TableHead>
                  <TableHead className="text-right">Coût total</TableHead>
                  <TableHead className="text-right">% du total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Chargement...</TableCell></TableRow>
                ) : !summary?.byBranch?.length ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    <Building2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    Aucune donnée pour cette période
                  </TableCell></TableRow>
                ) : summary.byBranch.map(row => (
                  <TableRow key={row.branchId}>
                    <TableCell className="font-medium">{row.branchName}</TableCell>
                    <TableCell className="text-center">{row.docCount}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmt(row.totalQty)}</TableCell>
                    <TableCell className="text-right font-semibold">{formatDA(row.totalCost)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {summary.totalCost > 0 ? `${((row.totalCost / summary.totalCost) * 100).toFixed(1)}%` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produit</TableHead>
                  <TableHead className="text-right">Quantité totale</TableHead>
                  <TableHead className="text-right">Coût total</TableHead>
                  <TableHead className="text-right">% du total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Chargement...</TableCell></TableRow>
                ) : !summary?.byProduct?.length ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                    <Package className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    Aucune donnée pour cette période
                  </TableCell></TableRow>
                ) : summary.byProduct.map(row => (
                  <TableRow key={row.productId}>
                    <TableCell className="font-medium">{row.productName}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmt(row.totalQty)}</TableCell>
                    <TableCell className="text-right font-semibold">{formatDA(row.totalCost)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {summary.totalCost > 0 ? `${((row.totalCost / summary.totalCost) * 100).toFixed(1)}%` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
