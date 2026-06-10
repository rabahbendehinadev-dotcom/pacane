import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { BranchMultiSelect } from "@/components/ui/branch-multi-select";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  ShoppingCart, Package, AlertTriangle, CheckCircle2, Calculator,
  Ticket, Printer, FileText, Loader2, Building2, CalendarDays,
  Users, RefreshCw, HardHat, Send,
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const AUTH_HEADER = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` });

interface WorkerOption { id: number; name: string; phone: string | null; isActive: boolean; }
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

interface ReplenishmentItemWithBranch extends ReplenishmentItem {
  branchId: number;
  branchName: string;
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
  const [branchIds, setBranchIds] = useState<number[]>([]);
  const [date, setDate] = useState<string>(tomorrow);
  const [categoryId, setCategoryId] = useState<string>("all");
  const [workerId, setWorkerId] = useState<string>("all");
  const [onlyToOrder, setOnlyToOrder] = useState<boolean>(true);
  const [groupBySupplier, setGroupBySupplier] = useState<boolean>(false);
  const [groupByWorker, setGroupByWorker] = useState<boolean>(false);
  const [triggered, setTriggered] = useState(false);
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [waDialogOpen, setWaDialogOpen] = useState(false);
  const [sentWorkers, setSentWorkers] = useState<{ name: string; phone: string | null; count: number }[]>([]);

  const { data: branches = [] } = useGetBranches();
  const { data: categories = [] } = useGetCategories();
  const { data: workers = [] } = useQuery<WorkerOption[]>({ queryKey: ["workers"], queryFn: fetchWorkers });

  const fetchKey = ["replenishment-calculate", branchIds.join(","), date, categoryId, workerId, triggered];
  const { data: results, isLoading, isFetching, refetch } = useQuery<ReplenishmentResult[]>({
    queryKey: fetchKey,
    queryFn: async () => {
      return Promise.all(branchIds.map(async (bid) => {
        const params = new URLSearchParams({ branchId: String(bid), date });
        if (categoryId && categoryId !== "all") params.set("categoryId", categoryId);
        if (workerId && workerId !== "all") params.set("workerId", workerId);
        const r = await fetch(`/api/replenishment/calculate?${params}`, { headers: AUTH_HEADER() });
        if (!r.ok) throw new Error(await r.text());
        return r.json() as Promise<ReplenishmentResult>;
      }));
    },
    enabled: branchIds.length > 0 && triggered,
  });

  function calculate() {
    if (branchIds.length === 0) {
      toast({ title: "Veuillez sélectionner au moins une boutique", variant: "destructive" });
      return;
    }
    setTriggered(true);
    setTimeout(() => refetch(), 50);
  }

  const allItems: ReplenishmentItemWithBranch[] = results
    ? results.flatMap(r => r.items.map(i => ({ ...i, branchId: r.branchId, branchName: r.branchName })))
    : [];

  const firstResult = results?.[0];
  const showBranch = branchIds.length > 1;

  const mergedStats = results ? {
    totalProducts: results.reduce((s, r) => s + r.stats.totalProducts, 0),
    toOrderCount: results.reduce((s, r) => s + r.stats.toOrderCount, 0),
    totalQuantityToOrder: results.reduce((s, r) => s + r.stats.totalQuantityToOrder, 0),
    suppliersCount: results.reduce((s, r) => s + r.stats.suppliersCount, 0),
  } : null;

  const displayItems = allItems.filter(i => !onlyToOrder || i.status === "to_order");

  const itemsBySupplier = useCallback(() => {
    const map = new Map<string, ReplenishmentItemWithBranch[]>();
    for (const item of displayItems) {
      const key = item.supplierName ?? "Sans fournisseur";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return map;
  }, [displayItems]);

  const itemsByWorker = useCallback(() => {
    const map = new Map<string, ReplenishmentItemWithBranch[]>();
    for (const item of displayItems) {
      const key = item.workerName ?? "Non affecté";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return map;
  }, [displayItems]);

  function printTicket() {
    if (!results || results.length === 0) return;
    const toOrder = allItems.filter(i => i.status === "to_order");
    const branchLabel = results.map(r => r.branchName).join(" / ");
    const dateLabel = format(new Date(results[0].date), "dd/MM/yyyy");
    const dayLabel = results[0].weekdayGroupLabel;
    const now = format(new Date(), "dd/MM/yyyy HH:mm");

    const line = (a: string, b: string) =>
      `<tr><td style="padding:1px 2px">${a}</td><td style="padding:1px 2px;text-align:right;font-weight:700">${b}</td></tr>`;

    let body = "";

    if (groupByWorker) {
      const map = new Map<string, ReplenishmentItemWithBranch[]>();
      for (const item of toOrder) {
        const k = item.workerName ?? "Non affecté";
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(item);
      }
      for (const [worker, items] of Array.from(map.entries())) {
        body += `<tr><td colspan="2" style="padding:6px 2px 2px;font-weight:700;border-top:1px dashed #000">${worker}</td></tr>`;
        for (const i of items) {
          body += line(i.productName, `${fmtQty(i.quantityToOrder)} ${i.unitName}`);
        }
      }
    } else if (groupBySupplier) {
      const map = new Map<string, ReplenishmentItemWithBranch[]>();
      for (const item of toOrder) {
        const k = item.supplierName ?? "Sans fournisseur";
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(item);
      }
      for (const [supplier, items] of Array.from(map.entries())) {
        body += `<tr><td colspan="2" style="padding:6px 2px 2px;font-weight:700;border-top:1px dashed #000">${supplier}</td></tr>`;
        for (const i of items) {
          body += line(i.productName, `${fmtQty(i.quantityToOrder)} ${i.unitName}`);
        }
      }
    } else {
      for (const i of toOrder) {
        body += line(i.productName, `${fmtQty(i.quantityToOrder)} ${i.unitName}`);
      }
    }

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Ticket Commande</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Courier New', monospace; font-size: 12px; width: 80mm; margin: 0 auto; padding: 6px 4px; }
  h1 { font-size: 14px; text-align: center; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 2px; }
  .sub { text-align: center; font-size: 11px; margin-bottom: 2px; }
  .sep { border-top: 1px dashed #000; margin: 5px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .total { font-weight: 700; border-top: 1px dashed #000; padding-top: 4px; margin-top: 4px; text-align: center; font-size: 12px; }
  .footer { text-align: center; font-size: 10px; margin-top: 6px; color: #555; }
  @media print { body { width: 80mm; } }
</style>
</head><body>
<h1>BON DE COMMANDE</h1>
<div class="sub">PACANE</div>
<div class="sep"></div>
<div class="sub">${branchLabel}</div>
<div class="sub">Date : ${dateLabel} &mdash; ${dayLabel}</div>
<div class="sep"></div>
<table>${body}</table>
<div class="sep"></div>
<div class="total">${toOrder.length} article(s) à commander</div>
<div class="footer">Imprimé le ${now}</div>
<script>window.onload = () => { window.print(); }<\/script>
</body></html>`;

    const w = window.open("", "_blank", "width=400,height=700");
    if (w) { w.document.write(html); w.document.close(); }
  }

  function exportPdf() {
    if (!results || results.length === 0) return;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const branchLabel = results.map(r => r.branchName).join(", ");
    const dateLabel = format(new Date(results[0].date), "dd/MM/yyyy");

    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text("BON DE COMMANDE AUTOMATIQUE", 14, 20);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Boutique : ${branchLabel}`, 14, 30);
    doc.text(`Date : ${dateLabel}`, 14, 36);
    doc.text(`Objectif : ${results[0].weekdayGroupLabel}`, 14, 42);
    doc.text(`Généré le : ${format(new Date(), "dd/MM/yyyy HH:mm")}`, 14, 48);

    let groups: [string, ReplenishmentItemWithBranch[]][];
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

      const branchHead = showBranch ? ["Boutique"] : [];
      const colOffset = showBranch ? 1 : 0;
      autoTable(doc, {
        startY,
        head: [[...branchHead, "Produit", "SKU", groupByWorker ? "Fournisseur" : "Unité", "Stock actuel", "Stock cible", "Qté à commander"]],
        body: items.map(i => [
          ...(showBranch ? [i.branchName] : []),
          i.productName,
          i.sku ?? "—",
          groupByWorker ? (i.supplierName ?? "—") : i.unitName,
          fmtQty(i.currentStock),
          fmtQty(i.targetStock),
          fmtQty(i.quantityToOrder),
        ]),
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [30, 30, 30], textColor: 255, fontStyle: "bold" },
        columnStyles: {
          [3 + colOffset]: { halign: "right" },
          [4 + colOffset]: { halign: "right" },
          [5 + colOffset]: { halign: "right", fontStyle: "bold" },
        },
      });
      startY = (doc as any).lastAutoTable.finalY + 10;
    }

    doc.setFontSize(8);
    doc.setFont("helvetica", "italic");
    doc.text(`Total lignes : ${displayItems.length} produits`, 14, startY + 4);

    const filename = `BON_COMMANDE_AUTO_${branchLabel.replace(/[\s,]+/g, "-")}_${results[0].date}.pdf`;
    const pdfBlob = doc.output("blob");
    const url = URL.createObjectURL(pdfBlob);
    const popup = window.open(url, "_blank");
    if (!popup) { doc.save(filename); }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  const loading = isLoading || isFetching;

  const itemsToSend = allItems.filter(i => i.status === "to_order");
  const unassignedItems = itemsToSend.filter(i => !i.workerId);

  const workerSummary = (() => {
    const map = new Map<number, { name: string; phone: string | null; count: number; qty: number }>();
    for (const item of itemsToSend) {
      if (!item.workerId) continue;
      const k = item.workerId;
      const workerPhone = workers.find(w => w.id === k)?.phone ?? null;
      const cur = map.get(k) ?? { name: item.workerName ?? "—", phone: workerPhone, count: 0, qty: 0 };
      map.set(k, { name: cur.name, phone: cur.phone, count: cur.count + 1, qty: cur.qty + item.quantityToOrder });
    }
    return Array.from(map.values());
  })();

  async function doSend() {
    if (!results || results.length === 0) return;
    setSending(true);
    try {
      let totalCreated = 0;
      const byBranch = new Map<number, ReplenishmentItemWithBranch[]>();
      for (const item of itemsToSend) {
        if (!byBranch.has(item.branchId)) byBranch.set(item.branchId, []);
        byBranch.get(item.branchId)!.push(item);
      }
      const sharedDate = results[0].date;

      const buildPayload = (bid: number, items: ReplenishmentItemWithBranch[], force: boolean) => ({
        branchId: bid,
        date: sharedDate,
        force,
        items: items.map(i => ({
          productId: i.productId,
          productName: i.productName,
          sku: i.sku,
          unitName: i.unitName,
          workerId: i.workerId,
          workerName: i.workerName,
          quantityToOrder: i.quantityToOrder,
        })),
      });

      const conflictedBranches: number[] = [];

      for (const [bid, items] of Array.from(byBranch.entries())) {
        const r = await fetch("/api/preparation-orders/send", {
          method: "POST",
          headers: AUTH_HEADER(),
          body: JSON.stringify(buildPayload(bid, items, false)),
        });
        const data = await r.json();
        if (r.status === 409) {
          conflictedBranches.push(bid);
          continue;
        }
        if (!r.ok) throw new Error(data.error ?? "Erreur");
        totalCreated += data.created?.length ?? 0;
      }

      if (conflictedBranches.length > 0) {
        const conflictNames = conflictedBranches
          .map(bid => results.find(r => r.branchId === bid)?.branchName ?? String(bid))
          .join(", ");
        toast({ title: `Doublons détectés (${conflictNames}). Renvoi forcé…`, variant: "destructive" });
        for (const bid of conflictedBranches) {
          const items = byBranch.get(bid)!;
          const r = await fetch("/api/preparation-orders/send", {
            method: "POST",
            headers: AUTH_HEADER(),
            body: JSON.stringify(buildPayload(bid, items, true)),
          });
          const data = await r.json();
          if (!r.ok) throw new Error(data.error ?? "Erreur");
          totalCreated += data.created?.length ?? 0;
        }
      }

      setSendModalOpen(false);
      toast({ title: `✓ ${totalCreated} ordre(s) envoyé(s) aux ouvriers` });
      setSentWorkers(workerSummary.map(w => ({ name: w.name, phone: w.phone, count: w.count })));
      setWaDialogOpen(true);
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
            {results && results.length > 0 && (
              <>
                <Button variant="outline" size="sm" className="gap-2" onClick={printTicket}>
                  <Ticket className="h-3.5 w-3.5" />Ticket
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
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-medium">Boutique <span className="text-destructive">*</span></Label>
              <BranchMultiSelect
                branches={branches}
                selectedIds={branchIds}
                onChange={setBranchIds}
                placeholder="Sélectionner…"
              />
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
          {firstResult && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarDays className="h-4 w-4" />
              <span>
                {format(new Date(firstResult.date), "EEEE dd/MM/yyyy").charAt(0).toUpperCase() + format(new Date(firstResult.date), "EEEE dd/MM/yyyy").slice(1)}
                {" · "}
                <span className="font-medium text-foreground">Objectif : {firstResult.weekdayGroupLabel}</span>
              </span>
            </div>
          )}

          {/* KPI Cards */}
          {mergedStats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                      <Package className="h-4.5 w-4.5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Produits analysés</p>
                      <p className="text-xl font-bold">{fmtNum(mergedStats.totalProducts)}</p>
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
                      <p className="text-xl font-bold text-amber-600">{fmtNum(mergedStats.toOrderCount)}</p>
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
                      <p className="text-xl font-bold text-emerald-600">{fmtNum(mergedStats.totalQuantityToOrder)}</p>
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
                      <p className="text-xl font-bold">{fmtNum(mergedStats.suppliersCount)}</p>
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
              <p className="text-sm font-medium">Sélectionnez une ou plusieurs boutiques et cliquez sur Calculer</p>
              <p className="text-xs text-muted-foreground mt-1">Le calcul se base sur le stock actuel des boutiques sélectionnées</p>
            </div>
          )}

          {triggered && loading && (
            <div className="flex items-center justify-center py-20 gap-3 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Calcul en cours…</span>
            </div>
          )}

          {triggered && !loading && results && displayItems.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="h-16 w-16 rounded-2xl bg-emerald-50 flex items-center justify-center mb-4">
                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              </div>
              <p className="text-sm font-medium text-emerald-700">Aucun besoin de réapprovisionnement pour cette sélection</p>
              <p className="text-xs text-muted-foreground mt-1">Tous les produits sont au-dessus de leur stock cible</p>
            </div>
          )}

          {/* Table */}
          {triggered && !loading && results && displayItems.length > 0 && (
            <>
              {groupByWorker ? (
                Array.from(itemsByWorker().entries()).map(([workerName, items]) => (
                  <div key={workerName} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <HardHat className="h-4 w-4 text-muted-foreground" />
                      <span className="font-semibold text-sm">{workerName}</span>
                      <Badge variant="secondary" className="text-xs">{items.length}</Badge>
                    </div>
                    <ReplenishmentTable items={items} showWorker={false} showBranch={showBranch} />
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
                    <ReplenishmentTable items={items} showWorker={true} showBranch={showBranch} />
                    <Separator />
                  </div>
                ))
              ) : (
                <ReplenishmentTable items={displayItems} showWorker={true} showBranch={showBranch} />
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
            onClick={() => doSend()}
            disabled={sending || workerSummary.length === 0}
            className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Confirmer l'envoi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* WhatsApp notification dialog */}
    <Dialog open={waDialogOpen} onOpenChange={setWaDialogOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#25D366]" xmlns="http://www.w3.org/2000/svg"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.87 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            Notifier les ouvriers via WhatsApp
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Les commandes ont été créées avec succès. Envoyez une notification à chaque ouvrier via WhatsApp :
          </p>
          <div className="space-y-2">
            {sentWorkers.map(w => {
              const msg = encodeURIComponent(`Bonjour ${w.name},\n\nVous avez une nouvelle commande de préparation (${w.count} produit${w.count > 1 ? "s" : ""}) en attente.\nVeuillez la consulter dans la section "Mes préparations" sur le site.\n\nMerci 🙏`);
              const href = w.phone
                ? `https://wa.me/${w.phone.replace(/\D/g, "")}?text=${msg}`
                : `https://wa.me/?text=${msg}`;
              return (
                <div key={w.name} className="flex items-center justify-between rounded-lg border px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                      <HardHat className="h-4 w-4 text-emerald-700" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{w.name}</p>
                      <p className="text-xs text-muted-foreground">{w.count} produit{w.count > 1 ? "s" : ""} à préparer</p>
                    </div>
                  </div>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md bg-[#25D366] hover:bg-[#1ebe5d] text-white text-xs font-medium px-3 py-1.5 transition-colors"
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-white" xmlns="http://www.w3.org/2000/svg"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    {w.phone ? "Envoyer" : "Envoyer (sans numéro)"}
                  </a>
                </div>
              );
            })}
          </div>
          {sentWorkers.some(w => !w.phone) && (
            <p className="text-xs text-amber-600 bg-amber-50 rounded px-3 py-2">
              💡 Certains ouvriers n'ont pas de numéro WhatsApp. Ajoutez-le depuis la page <strong>Ouvriers</strong>.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setWaDialogOpen(false)}>Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

function ReplenishmentTable({
  items,
  showWorker = true,
  showBranch = false,
}: {
  items: ReplenishmentItemWithBranch[];
  showWorker?: boolean;
  showBranch?: boolean;
}) {
  return (
    <div className="rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            {showBranch && <TableHead className="font-semibold">Boutique</TableHead>}
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
            <TableRow key={`${item.branchId}-${item.productId}`} className={item.status === "to_order" ? "hover:bg-amber-50/50" : "hover:bg-muted/20"}>
              {showBranch && (
                <TableCell className="text-xs font-medium text-muted-foreground whitespace-nowrap">{item.branchName}</TableCell>
              )}
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
