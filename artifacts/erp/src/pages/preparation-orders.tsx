import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
  ClipboardList, Eye, Ban, Printer, RefreshCw, Loader2,
  HardHat, Building2, Calendar, User, Package, Hash,
  CheckCircle2, Clock, PlayCircle, XCircle, AlertTriangle
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useGetBranches } from "@workspace/api-client-react";

const AUTH = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` });

type OrderStatus = "new" | "viewed" | "in_progress" | "completed" | "cancelled";

interface WorkerOption { id: number; name: string; isActive: boolean; }
interface PreparationOrder {
  id: number;
  reference: string;
  branchId: number;
  branchName: string | null;
  workerId: number;
  workerName: string | null;
  sourceReplenishmentDate: string;
  status: OrderStatus;
  notes: string | null;
  createdByName: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  itemCount: number;
  totalQty: number;
}
interface OrderItem {
  id: number;
  productId: number;
  productNameSnapshot: string;
  skuSnapshot: string | null;
  unitSnapshot: string;
  quantityToPrepare: string;
  notes: string | null;
}
interface OrderDetail extends PreparationOrder { items: OrderItem[]; }

function StatusBadge({ status }: { status: OrderStatus }) {
  const cfg: Record<OrderStatus, { label: string; className: string; Icon: any }> = {
    new:       { label: "Nouveau",   className: "bg-blue-100 text-blue-700",   Icon: Clock },
    viewed:    { label: "Vu",        className: "bg-purple-100 text-purple-700", Icon: Eye },
    in_progress:{ label: "En cours", className: "bg-amber-100 text-amber-700",  Icon: PlayCircle },
    completed: { label: "Terminé",  className: "bg-emerald-100 text-emerald-700", Icon: CheckCircle2 },
    cancelled: { label: "Annulé",   className: "bg-red-100 text-red-700",       Icon: XCircle },
  };
  const { label, className, Icon } = cfg[status] ?? cfg.new;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>
      <Icon className="h-3 w-3" />{label}
    </span>
  );
}

function fmtQty(n: string | number) {
  const v = parseFloat(String(n));
  return isNaN(v) ? "0" : (v % 1 === 0 ? v.toString() : v.toFixed(3).replace(/\.?0+$/, ""));
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  try { return format(new Date(d), "dd/MM/yyyy", { locale: fr }); } catch { return d; }
}
function fmtDateTime(d: string | null) {
  if (!d) return "—";
  try { return format(new Date(d), "dd/MM/yyyy HH:mm", { locale: fr }); } catch { return d; }
}

export default function PreparationOrdersPage() {
  const qc = useQueryClient();
  const { data: branches = [] } = useGetBranches();
  const [filterBranch, setFilterBranch] = useState("all");
  const [filterWorker, setFilterWorker] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [selected, setSelected] = useState<OrderDetail | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PreparationOrder | null>(null);

  const { data: workers = [] } = useQuery<WorkerOption[]>({
    queryKey: ["workers"],
    queryFn: async () => { const r = await fetch("/api/workers", { headers: AUTH() }); return r.ok ? r.json() : []; },
  });

  const params = new URLSearchParams();
  if (filterBranch !== "all") params.set("branchId", filterBranch);
  if (filterWorker !== "all") params.set("workerId", filterWorker);
  if (filterStatus !== "all") params.set("status", filterStatus);
  if (filterFrom) params.set("dateFrom", filterFrom);
  if (filterTo) params.set("dateTo", filterTo);

  const { data: orders = [], isLoading, refetch } = useQuery<PreparationOrder[]>({
    queryKey: ["preparation-orders", filterBranch, filterWorker, filterStatus, filterFrom, filterTo],
    queryFn: async () => {
      const r = await fetch(`/api/preparation-orders?${params}`, { headers: AUTH() });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/preparation-orders/${id}/cancel`, { method: "PATCH", headers: AUTH() });
      if (!r.ok) throw new Error((await r.json()).error ?? "Erreur");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["preparation-orders"] }); setCancelTarget(null); toast({ title: "Ordre annulé" }); },
    onError: (e: any) => { toast({ title: e.message, variant: "destructive" }); },
  });

  async function openDetail(order: PreparationOrder) {
    const r = await fetch(`/api/preparation-orders/${order.id}`, { headers: AUTH() });
    if (!r.ok) { toast({ title: "Erreur de chargement", variant: "destructive" }); return; }
    setSelected(await r.json());
  }

  function printOrder(order: OrderDetail) {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    doc.setFontSize(14); doc.setFont("helvetica", "bold");
    doc.text("ORDRE DE PRÉPARATION", 14, 20);
    doc.setFontSize(9); doc.setFont("helvetica", "normal");
    doc.text(`Référence : ${order.reference}`, 14, 30);
    doc.text(`Boutique : ${order.branchName ?? "—"}`, 14, 36);
    doc.text(`Ouvrier : ${order.workerName ?? "—"}`, 14, 42);
    doc.text(`Date : ${fmtDate(order.sourceReplenishmentDate)}`, 14, 48);
    doc.text(`Statut : ${order.status}`, 14, 54);
    doc.text(`Envoyé le : ${fmtDateTime(order.sentAt)}`, 14, 60);
    doc.text(`Créé par : ${order.createdByName ?? "—"}`, 14, 66);
    if (order.notes) doc.text(`Notes : ${order.notes}`, 14, 72);

    autoTable(doc, {
      startY: order.notes ? 80 : 74,
      head: [["Produit", "SKU", "Quantité", "Unité"]],
      body: order.items.map(i => [i.productNameSnapshot, i.skuSnapshot ?? "—", fmtQty(i.quantityToPrepare), i.unitSnapshot]),
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [30, 30, 30], textColor: 255, fontStyle: "bold" },
      columnStyles: { 2: { halign: "right", fontStyle: "bold" } },
    });

    const filename = `ORDRE_PREPARATION_${(order.workerName ?? "").replace(/\s+/g, "_")}_${order.reference}.pdf`;
    const url = URL.createObjectURL(doc.output("blob"));
    const popup = window.open(url, "_blank");
    if (!popup) doc.save(filename);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-5 pb-4 border-b shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-muted-foreground" />
              Ordres de préparation
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">Gestion des ordres envoyés aux ouvriers</p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => refetch()} title="Actualiser">
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="px-6 py-3 bg-muted/20 border-b">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1 min-w-[150px]">
            <Label className="text-xs">Boutique</Label>
            <Select value={filterBranch} onValueChange={setFilterBranch}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Toutes" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes</SelectItem>
                {branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 min-w-[140px]">
            <Label className="text-xs">Ouvrier</Label>
            <Select value={filterWorker} onValueChange={setFilterWorker}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Tous" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                {workers.filter(w => w.isActive).map(w => <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 min-w-[130px]">
            <Label className="text-xs">Statut</Label>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Tous" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                <SelectItem value="new">Nouveau</SelectItem>
                <SelectItem value="viewed">Vu</SelectItem>
                <SelectItem value="in_progress">En cours</SelectItem>
                <SelectItem value="completed">Terminé</SelectItem>
                <SelectItem value="cancelled">Annulé</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Du</Label>
            <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="h-8 text-xs w-[140px]" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Au</Label>
            <Input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="h-8 text-xs w-[140px]" />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /><span className="text-sm">Chargement…</span>
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="h-14 w-14 rounded-2xl bg-muted flex items-center justify-center mb-3">
              <ClipboardList className="h-7 w-7 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">Aucun ordre de préparation</p>
            <p className="text-xs text-muted-foreground mt-1">Utilisez "Envoyer aux ouvriers" depuis la page Commande automatique</p>
          </div>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="font-semibold">Référence</TableHead>
                  <TableHead className="font-semibold">Date</TableHead>
                  <TableHead className="font-semibold">Boutique</TableHead>
                  <TableHead className="font-semibold">Ouvrier</TableHead>
                  <TableHead className="font-semibold text-right">Lignes</TableHead>
                  <TableHead className="font-semibold text-right">Quantité</TableHead>
                  <TableHead className="font-semibold">Statut</TableHead>
                  <TableHead className="font-semibold">Créé par</TableHead>
                  <TableHead className="font-semibold">Envoyé le</TableHead>
                  <TableHead className="font-semibold text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map(o => (
                  <TableRow key={o.id} className="hover:bg-muted/20">
                    <TableCell className="font-mono text-sm font-medium">{o.reference}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{fmtDate(o.sourceReplenishmentDate)}</TableCell>
                    <TableCell className="text-sm">{o.branchName ?? "—"}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1 text-sm">
                        <HardHat className="h-3 w-3 text-muted-foreground/60" />{o.workerName ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-sm font-mono">{o.itemCount}</TableCell>
                    <TableCell className="text-right text-sm font-mono font-medium">{fmtQty(o.totalQty)}</TableCell>
                    <TableCell><StatusBadge status={o.status} /></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{o.createdByName ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDateTime(o.sentAt)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openDetail(o)} title="Voir">
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {!["completed", "cancelled"].includes(o.status) && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setCancelTarget(o)} title="Annuler">
                            <Ban className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Detail Dialog */}
      {selected && (
        <Dialog open onOpenChange={() => setSelected(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 font-mono">
                <ClipboardList className="h-5 w-5" />{selected.reference}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex items-center gap-2"><Building2 className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Boutique :</span> <span className="font-medium">{selected.branchName}</span></div>
                <div className="flex items-center gap-2"><HardHat className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Ouvrier :</span> <span className="font-medium">{selected.workerName}</span></div>
                <div className="flex items-center gap-2"><Calendar className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Date :</span> <span className="font-medium">{fmtDate(selected.sourceReplenishmentDate)}</span></div>
                <div className="flex items-center gap-2"><span className="text-muted-foreground">Statut :</span> <StatusBadge status={selected.status} /></div>
                <div className="flex items-center gap-2"><User className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Créé par :</span> <span>{selected.createdByName}</span></div>
                <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Envoyé :</span> <span>{fmtDateTime(selected.sentAt)}</span></div>
                {selected.viewedAt && <div className="flex items-center gap-2"><Eye className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Vu :</span> <span>{fmtDateTime(selected.viewedAt)}</span></div>}
                {selected.startedAt && <div className="flex items-center gap-2"><PlayCircle className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Démarré :</span> <span>{fmtDateTime(selected.startedAt)}</span></div>}
                {selected.completedAt && <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Terminé :</span> <span>{fmtDateTime(selected.completedAt)}</span></div>}
              </div>
              {selected.notes && <p className="text-sm text-muted-foreground bg-muted/30 rounded p-2">{selected.notes}</p>}
              <Separator />
              <div>
                <h4 className="font-semibold text-sm mb-2 flex items-center gap-2"><Package className="h-4 w-4" />Produits à préparer ({selected.items.length})</h4>
                <div className="rounded border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="text-xs font-semibold">Produit</TableHead>
                        <TableHead className="text-xs font-semibold">SKU</TableHead>
                        <TableHead className="text-xs font-semibold text-right">Quantité</TableHead>
                        <TableHead className="text-xs font-semibold">Unité</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selected.items.map(item => (
                        <TableRow key={item.id}>
                          <TableCell className="text-sm font-medium">{item.productNameSnapshot}</TableCell>
                          <TableCell className="text-xs text-muted-foreground font-mono">{item.skuSnapshot ?? "—"}</TableCell>
                          <TableCell className="text-right font-bold text-sm font-mono text-amber-700">{fmtQty(item.quantityToPrepare)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{item.unitSnapshot}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => printOrder(selected)} className="gap-2">
                  <Printer className="h-3.5 w-3.5" />Imprimer
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Cancel confirmation */}
      <AlertDialog open={!!cancelTarget} onOpenChange={() => setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Annuler l'ordre {cancelTarget?.reference} ?</AlertDialogTitle>
            <AlertDialogDescription>Cette action est irréversible. L'ouvrier ne pourra plus modifier cet ordre.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => cancelTarget && cancelMutation.mutate(cancelTarget.id)}>
              Confirmer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
