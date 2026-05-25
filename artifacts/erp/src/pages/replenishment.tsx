import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useGetBranches, useGetCategories } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  ShoppingCart, Package, AlertTriangle, CheckCircle2, Calculator,
  Download, Printer, FileText, Loader2, Building2, CalendarDays,
  Users, RefreshCw, HardHat, Send,
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const AUTH_HEADER = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` });

interface WorkerOption { id: number; name: string; isActive: boolean; }
async function fetchWorkers(): Promise<WorkerOption[]> {
  const r = await fetch("/api/workers", { headers: { Authorization: `Bearer ${localStorage.getItem("erp_token")}` } });
  if (!r.ok) return [];
  return r.json();
}

interface ReplenishmentItem {
  productId: number;
  productName: string;
  sku: string | null;
  categoryName: string | null;
  unitName: string;
  workerId: number | null;
  workerName: string | null;
  currentStock: number;
  targetStock: number;
  quantityToOrder: number;
  supplierId: number | null;
  supplierName: string | null;
  status: "ok" | "to_order";
}

interface ReplenishmentResult {
  branchId: number;
  branchName: string;
  date: string;
  weekdayGroup: "sun_wed" | "thu_sat";
  weekdayGroupLabel: string;
  items: ReplenishmentItem[];
  stats: {
    totalProducts: number;
    toOrderCount: number;
    totalQuantityToOrder: number;
    suppliersCount: number;
  };
}

function fmtQty(n: number) {
  return n % 1 === 0 ? n.toString() : n.toFixed(3).replace(/\.?0+$/, "");
}

function fmtNum(n: number) {
  return new Intl.NumberFormat("fr-FR").format(n);
}

export default function ReplenishmentPage() {
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return format(d, "yyyy-MM-dd"); })();
  const [branchId, setBranchId] = useState<string>("");
  const [date, setDate] = useState<string>(tomorrow);
  const [categoryId, setCategoryId] = useState<string>("all");
  const [workerId, setWorkerId] = useState<string>("all");
  const [onlyToOrder, setOnlyToOrder] = useState<boolean>(true);
  const [groupBySupplier, setGroupBySupplier] = useState<boolean>(false);
  const [groupByWorker, setGroupByWorker] = useState<boolean>(false);
  const [triggered, setTriggered] = useState(false);
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const { data: branches = [] } = useGetBranches();
  const { data: categories = [] } = useGetCategories();
  const { data: workers = [] } = useQuery<WorkerOption[]>({ queryKey: ["workers"], queryFn: fetchWorkers });

  const fetchKey = ["replenishment-calculate", branchId, date, categoryId, workerId, triggered];
  const { data: result, isLoading, isFetching, refetch } = useQuery<ReplenishmentResult>({
    queryKey: fetchKey,
    queryFn: async () => {
      const params = new URLSearchParams({ branchId, date });
      if (categoryId && categoryId !== "all") params.set("categoryId", categoryId);
      if (workerId && workerId !== "all") params.set("workerId", workerId);
      const r = await fetch(`/api/replenishment/calculate?${params}`, { headers: AUTH_HEADER() });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: !!branchId && triggered,
  });

  function calculate() {
    if (!branchId) { toast({ title: "Veuillez sélectionner une boutique", variant: "destructive" }); return; }
    setTriggered(true);
    setTimeout(() => refetch(), 50);
  }

  const displayItems = result?.items.filter(i => !onlyToOrder || i.status === "to_order") ?? [];

  const itemsBySupplier = useCallback(() => {
    const map = new Map<string, ReplenishmentItem[]>();
    for (const item of displayItems) {
      const key = item.supplierName ?? "Sans fournisseur";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return map;
  }, [displayItems]);

  const itemsByWorker = useCallback(() => {
    const map = new Map<string, ReplenishmentItem[]>();
    for (const item of displayItems) {
      const key = item.workerName ?? "Non affecté";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return map;
  }, [displayItems]);

  function exportCsv() {
    if (!result) return;
    const rows = [
      ["Produit", "SKU", "Catégorie", "Responsable", "Unité", "Stock actuel", "Stock cible", "Qté à commander", "Fournisseur", "Statut"],
      ...displayItems.map(i => [
        i.productName, i.sku ?? "", i.categoryName ?? "", i.workerName ?? "Non affecté", i.unitName,
        fmtQty(i.currentStock), fmtQty(i.targetStock), fmtQty(i.quantityToOrder),
        i.supplierName ?? "", i.status === "to_order" ? "À commander" : "OK"
      ])
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `BON_COMMANDE_AUTO_${result.branchName.replace(/\s+/g, "-")}_${result.date}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  function exportPdf() {
    if (!result) return;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const branch = result.branchName;
    const dateLabel = format(new Date(result.date), "dd/MM/yyyy");

    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text("BON DE COMMANDE AUTOMATIQUE", 14, 20);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Boutique : ${branch}`, 14, 30);
    doc.text(`Date : ${dateLabel}`, 14, 36);
    doc.text(`Objectif : ${result.weekdayGroupLabel}`, 14, 42);
    doc.text(`Généré le : ${format(new Date(), "dd/MM/yyyy HH:mm")}`, 14, 48);

    let groups: [string, ReplenishmentItem[]][];
    let groupLabel = "";
    if (groupByWorker) {
      groups = Array.from(itemsByWorker().entries());
      groupLabel = "Responsable";
    } else if (groupBySupplier) {
      groups = Array.from(itemsBySupplier().entries());
      groupLabel = "Fournisseur";
    } else {
      groups = [["Tous les produits", displayItems]];
    }
    let startY = 56;

    for (const [groupName, items] of groups) {
      if (groupByWorker || groupBySupplier) {
        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.text(`${groupLabel} : ${groupName}`, 14, startY);
        startY += 6;
      }

      autoTable(doc, {
        startY,
        head: [["Produit", "SKU", groupByWorker ? "Fournisseur" : "Unité", "Stock actuel", "Stock cible", "Qté à commander"]],
        body: items.map(i => [
          i.productName,
          i.sku ?? "—",
          groupByWorker ? (i.supplierName ?? "—") : i.unitName,
          fmtQty(i.currentStock),
          fmtQty(i.targetStock),
          fmtQty(i.quantityToOrder),
        ]),
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [30, 30, 30], textColor: 255, fontStyle: "bold" },
        columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right", fontStyle: "bold" } },
      });
      startY = (doc as any).lastAutoTable.finalY + 10;
    }

    // Footer
    const totalLines = displayItems.length;
    doc.setFontSize(8);
    doc.setFont("helvetica", "italic");
    doc.text(`Total lignes : ${totalLines} produits`, 14, startY + 4);

    const filename = `BON_COMMANDE_AUTO_${branch.replace(/\s+/g, "-")}_${result.date}.pdf`;
    const pdfBlob = doc.output("blob");
    const url = URL.createObjectURL(pdfBlob);
    const popup = window.open(url, "_blank");
    if (!popup) { doc.save(filename); }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  const loading = isLoading || isFetching;

  const itemsToSend = result?.items.filter(i => i.status === "to_order") ?? [];
  const unassignedItems = itemsToSend.filter(i => !i.workerId);

  const workerSummary = (() => {
    const map = new Map<number, { name: string; count: number; qty: number }>();
    for (const item of itemsToSend) {
      if (!item.workerId) continue;
      const k = item.workerId;
      const cur = map.get(k) ?? { name: item.workerName ?? "—", count: 0, qty: 0 };
      map.set(k, { name: cur.name, count: cur.count + 1, qty: cur.qty + item.quantityToOrder });
    }
    return Array.from(map.values());
  })();

  async function doSend(force = false) {
    if (!result) return;
    setSending(true);
    try {
      const r = await fetch("/api/preparation-orders/send", {
        method: "POST",
        headers: AUTH_HEADER(),
        body: JSON.stringify({
          branchId: result.branchId,
          date: result.date,
          force,
          items: itemsToSend.map(i => ({
            productId: i.productId,
            productName: i.productName,
            sku: i.sku,
            unitName: i.unitName,
            workerId: i.workerId,
            workerName: i.workerName,
            quantityToOrder: i.quantityToOrder,
          })),
        }),
      });
      const data = await r.json();
      if (r.status === 409) {
        const names = data.workerNames?.join(", ") ?? "";
        toast({ title: `Doublons détectés pour : ${names}. Renvoi forcé...`, variant: "destructive" });
        setSending(false);
        await doSend(true);
        return;
      }
      if (!r.ok) throw new Error(data.error ?? "Erreur");
      setSendModalOpen(false);
      toast({ title: `✓ ${data.created?.length ?? 0} ordre(s) envoyé(s) aux ouvriers` });
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  return (
    <>
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Bon de commande automatique</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Calcul automatique des besoins par boutique selon le jour de la semaine</p>
          </div>
          <div className="flex gap-2">
            {result && (
              <>
                <Button variant="outline" size="sm" className="gap-2" onClick={exportCsv}>
                  <Download className="h-3.5 w-3.5" />CSV
                </Button>
                <Button variant="outline" size="sm" className="gap-2" onClick={exportPdf}>
                  <FileText className="h-3.5 w-3.5" />PDF
                </Button>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => window.print()}>
                  <Printer className="h-3.5 w-3.5" />Imprimer
                </Button>
                {itemsToSend.length > 0 && (
                  <Button size="sm" className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setSendModalOpen(true)}>
                    <Send className="h-3.5 w-3.5" />
                    Envoyer aux ouvriers
                    <span className="ml-1 bg-white/20 rounded px-1 text-xs">{itemsToSend.length}</span>
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {/* Filters */}
        <div className="px-6 py-4 bg-muted/20 border-b">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex flex-col gap-1.5 min-w-[180px]">
              <Label className="text-xs font-medium">Boutique <span className="text-destructive">*</span></Label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Sélectionner…" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-medium">Date</Label>
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9 w-[160px]" />
            </div>

            <div className="flex flex-col gap-1.5 min-w-[150px]">
              <Label className="text-xs font-medium">Catégorie</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Toutes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes</SelectItem>
                  {categories.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5 min-w-[160px]">
              <Label className="text-xs font-medium">Responsable</Label>
              <Select value={workerId} onValueChange={setWorkerId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Tous" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous</SelectItem>
                  <SelectItem value="none">Non affecté</SelectItem>
                  {workers.map(w => <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <Checkbox checked={onlyToOrder} onCheckedChange={v => setOnlyToOrder(!!v)} />
                Afficher uniquement les produits à commander
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <Checkbox checked={groupBySupplier} onCheckedChange={v => { setGroupBySupplier(!!v); if (v) setGroupByWorker(false); }} />
                Grouper par fournisseur
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <Checkbox checked={groupByWorker} onCheckedChange={v => { setGroupByWorker(!!v); if (v) setGroupBySupplier(false); }} />
                Grouper par responsable
              </label>
            </div>

            <Button onClick={calculate} disabled={loading} className="gap-2 self-end">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
              Calculer
            </Button>

            {triggered && (
              <Button variant="ghost" size="icon" className="h-9 w-9 self-end" onClick={() => refetch()} title="Actualiser">
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            )}
          </div>
        </div>

        <div className="px-6 py-4 space-y-5">
          {/* Weekday info */}
          {result && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarDays className="h-4 w-4" />
              <span>
                {format(new Date(result.date), "EEEE dd/MM/yyyy").charAt(0).toUpperCase() + format(new Date(result.date), "EEEE dd/MM/yyyy").slice(1)}
                {" · "}
                <span className="font-medium text-foreground">Objectif : {result.weekdayGroupLabel}</span>
              </span>
            </div>
          )}

          {/* KPI Cards */}
          {result && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                      <Package className="h-4.5 w-4.5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Produits analysés</p>
                      <p className="text-xl font-bold">{fmtNum(result.stats.totalProducts)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                      <AlertTriangle className="h-4.5 w-4.5 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">À commander</p>
                      <p className="text-xl font-bold text-amber-600">{fmtNum(result.stats.toOrderCount)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                      <ShoppingCart className="h-4.5 w-4.5 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Quantité totale</p>
                      <p className="text-xl font-bold text-emerald-600">{fmtNum(result.stats.totalQuantityToOrder)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-purple-50 flex items-center justify-center shrink-0">
                      <Users className="h-4.5 w-4.5 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Fournisseurs</p>
                      <p className="text-xl font-bold">{fmtNum(result.stats.suppliersCount)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Empty / Loading states */}
          {!triggered && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
                <Calculator className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">Sélectionnez une boutique et cliquez sur Calculer</p>
              <p className="text-xs text-muted-foreground mt-1">Le calcul se base sur le stock actuel de la boutique sélectionnée uniquement</p>
            </div>
          )}

          {triggered && loading && (
            <div className="flex items-center justify-center py-20 gap-3 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Calcul en cours…</span>
            </div>
          )}

          {triggered && !loading && result && displayItems.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="h-16 w-16 rounded-2xl bg-emerald-50 flex items-center justify-center mb-4">
                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              </div>
              <p className="text-sm font-medium text-emerald-700">Aucun besoin de réapprovisionnement pour cette sélection</p>
              <p className="text-xs text-muted-foreground mt-1">Tous les produits sont au-dessus de leur stock cible</p>
            </div>
          )}

          {/* Table */}
          {triggered && !loading && result && displayItems.length > 0 && (
            <>
              {groupByWorker ? (
                Array.from(itemsByWorker().entries()).map(([workerName, items]) => (
                  <div key={workerName} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <HardHat className="h-4 w-4 text-muted-foreground" />
                      <span className="font-semibold text-sm">{workerName}</span>
                      <Badge variant="secondary" className="text-xs">{items.length}</Badge>
                    </div>
                    <ReplenishmentTable items={items} showWorker={false} />
                    <Separator />
                  </div>
                ))
              ) : groupBySupplier ? (
                Array.from(itemsBySupplier().entries()).map(([supplierName, items]) => (
                  <div key={supplierName} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span className="font-semibold text-sm">{supplierName}</span>
                      <Badge variant="secondary" className="text-xs">{items.length}</Badge>
                    </div>
                    <ReplenishmentTable items={items} showWorker={true} />
                    <Separator />
                  </div>
                ))
              ) : (
                <ReplenishmentTable items={displayItems} showWorker={true} />
              )}
            </>
          )}
        </div>
      </div>
    </div>

    {/* Send to workers modal */}
    <Dialog open={sendModalOpen} onOpenChange={setSendModalOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5 text-emerald-600" />
            Envoyer aux ouvriers
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {unassignedItems.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>{unassignedItems.length} produit(s)</strong> n'ont pas d'ouvrier affecté et ne seront pas envoyés :{" "}
                <span className="text-xs">{unassignedItems.slice(0, 5).map(i => i.productName).join(", ")}{unassignedItems.length > 5 ? "…" : ""}</span>
              </AlertDescription>
            </Alert>
          )}
          <div className="rounded-lg bg-muted/40 p-3 space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Récapitulatif par ouvrier :</p>
            {workerSummary.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun produit assigné à envoyer</p>
            ) : (
              workerSummary.map(w => (
                <div key={w.name} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2"><HardHat className="h-3.5 w-3.5 text-muted-foreground/60" />{w.name}</span>
                  <span className="font-medium">{w.count} produit{w.count > 1 ? "s" : ""}</span>
                </div>
              ))
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {workerSummary.length} ordre{workerSummary.length > 1 ? "s" : ""} de préparation sera créé{workerSummary.length > 1 ? "s" : ""}. Les ouvriers pourront les consulter dans "Mes préparations".
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setSendModalOpen(false)}>Annuler</Button>
          <Button
            onClick={() => doSend(false)}
            disabled={sending || workerSummary.length === 0}
            className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Confirmer l'envoi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

function ReplenishmentTable({ items, showWorker = true }: { items: ReplenishmentItem[]; showWorker?: boolean }) {
  return (
    <div className="rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead className="font-semibold">Produit</TableHead>
            <TableHead className="font-semibold">SKU</TableHead>
            <TableHead className="font-semibold">Catégorie</TableHead>
            {showWorker && <TableHead className="font-semibold">Responsable</TableHead>}
            <TableHead className="font-semibold text-right">Stock actuel</TableHead>
            <TableHead className="font-semibold text-right">Stock cible</TableHead>
            <TableHead className="font-semibold text-right">Qté à commander</TableHead>
            <TableHead className="font-semibold">Unité</TableHead>
            <TableHead className="font-semibold">Fournisseur</TableHead>
            <TableHead className="font-semibold">Statut</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map(item => (
            <TableRow key={item.productId} className={item.status === "to_order" ? "hover:bg-amber-50/50" : "hover:bg-muted/20"}>
              <TableCell className="font-medium text-sm">{item.productName}</TableCell>
              <TableCell className="text-xs text-muted-foreground font-mono">{item.sku ?? "—"}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{item.categoryName ?? "—"}</TableCell>
              {showWorker && (
                <TableCell className="text-sm text-muted-foreground">
                  {item.workerName ? (
                    <span className="inline-flex items-center gap-1">
                      <HardHat className="h-3 w-3 text-muted-foreground/60" />{item.workerName}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/40 text-xs">Non affecté</span>
                  )}
                </TableCell>
              )}
              <TableCell className="text-right text-sm font-mono">{fmtQty(item.currentStock)}</TableCell>
              <TableCell className="text-right text-sm font-mono text-muted-foreground">{fmtQty(item.targetStock)}</TableCell>
              <TableCell className="text-right">
                <span className={`font-bold text-sm font-mono ${item.quantityToOrder > 0 ? "text-amber-700" : "text-muted-foreground"}`}>
                  {item.quantityToOrder > 0 ? `+${fmtQty(item.quantityToOrder)}` : "—"}
                </span>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{item.unitName}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{item.supplierName ?? "—"}</TableCell>
              <TableCell>
                {item.status === "to_order" ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                    <AlertTriangle className="h-3 w-3" />À commander
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                    <CheckCircle2 className="h-3 w-3" />OK
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
