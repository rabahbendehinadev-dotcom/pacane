import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
  ClipboardCheck, Eye, PlayCircle, CheckCircle2, Clock,
  XCircle, Loader2, Building2, Package, RefreshCw, Printer
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useAuth } from "@/lib/auth";

const AUTH = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` });

type OrderStatus = "new" | "viewed" | "in_progress" | "completed" | "cancelled";

interface MyOrder {
  id: number;
  reference: string;
  branchName: string | null;
  sourceReplenishmentDate: string;
  status: OrderStatus;
  sentAt: string | null;
  viewedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  itemCount: number;
  totalQty: number;
}

interface OrderItem {
  id: number;
  productNameSnapshot: string;
  skuSnapshot: string | null;
  unitSnapshot: string;
  quantityToPrepare: string;
  notes: string | null;
}

interface OrderDetail extends MyOrder {
  items: OrderItem[];
  workerName: string | null;
}

function StatusBadge({ status }: { status: OrderStatus }) {
  const cfg: Record<OrderStatus, { label: string; className: string; Icon: any }> = {
    new:        { label: "Nouveau",  className: "bg-blue-100 text-blue-700",     Icon: Clock },
    viewed:     { label: "Vu",       className: "bg-purple-100 text-purple-700", Icon: Eye },
    in_progress:{ label: "En cours", className: "bg-amber-100 text-amber-700",   Icon: PlayCircle },
    completed:  { label: "Terminé",  className: "bg-emerald-100 text-emerald-700", Icon: CheckCircle2 },
    cancelled:  { label: "Annulé",   className: "bg-red-100 text-red-700",       Icon: XCircle },
  };
  const { label, className, Icon } = cfg[status] ?? cfg.new;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${className}`}>
      <Icon className="h-3.5 w-3.5" />{label}
    </span>
  );
}

function fmtQty(n: string | number) {
  const v = parseFloat(String(n));
  return isNaN(v) ? "0" : (v % 1 === 0 ? v.toString() : v.toFixed(3).replace(/\.?0+$/, ""));
}
function fmtDate(d: string | null) {
  if (!d) return "—";
  try { return format(new Date(d), "EEEE dd/MM/yyyy", { locale: fr }); } catch { return d; }
}
function fmtDateTime(d: string | null) {
  if (!d) return "—";
  try { return format(new Date(d), "dd/MM/yyyy HH:mm", { locale: fr }); } catch { return d; }
}

export default function MyPreparationsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [selected, setSelected] = useState<OrderDetail | null>(null);
  const [updating, setUpdating] = useState(false);

  const { data: orders = [], isLoading, refetch } = useQuery<MyOrder[]>({
    queryKey: ["my-preparations"],
    queryFn: async () => {
      const r = await fetch("/api/my-preparations", { headers: AUTH() });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  async function openDetail(order: MyOrder) {
    const r = await fetch(`/api/my-preparations/${order.id}`, { headers: AUTH() });
    if (!r.ok) { toast({ title: "Erreur de chargement", variant: "destructive" }); return; }
    const data = await r.json();
    setSelected(data);
    qc.invalidateQueries({ queryKey: ["my-preparations"] });
  }

  async function updateStatus(id: number, status: string) {
    setUpdating(true);
    try {
      const r = await fetch(`/api/my-preparations/${id}/status`, {
        method: "PATCH",
        headers: AUTH(),
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Erreur");
      const updated = await r.json();
      setSelected(prev => prev ? { ...prev, status: updated.status, startedAt: updated.startedAt, completedAt: updated.completedAt } : null);
      qc.invalidateQueries({ queryKey: ["my-preparations"] });
      toast({ title: status === "completed" ? "Ordre marqué terminé ✓" : "Ordre démarré" });
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally {
      setUpdating(false);
    }
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
    autoTable(doc, {
      startY: 58,
      head: [["Produit", "Quantité", "Unité"]],
      body: order.items.map(i => [i.productNameSnapshot, fmtQty(i.quantityToPrepare), i.unitSnapshot]),
      styles: { fontSize: 10, cellPadding: 4 },
      headStyles: { fillColor: [30, 30, 30], textColor: 255, fontStyle: "bold" },
      columnStyles: { 1: { halign: "right", fontStyle: "bold" } },
    });
    const filename = `ORDRE_${order.reference}.pdf`;
    const url = URL.createObjectURL(doc.output("blob"));
    const popup = window.open(url, "_blank");
    if (!popup) doc.save(filename);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  const hasWorkerId = !!(user as any)?.workerId;

  const grouped = {
    active: orders.filter(o => ["new", "viewed", "in_progress"].includes(o.status)),
    completed: orders.filter(o => o.status === "completed"),
    cancelled: orders.filter(o => o.status === "cancelled"),
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-5 pb-4 border-b shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-muted-foreground" />
              Mes préparations
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">Ordres de préparation qui vous sont assignés</p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => refetch()}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4">
        {!hasWorkerId ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="h-14 w-14 rounded-2xl bg-amber-50 flex items-center justify-center mb-3">
              <ClipboardCheck className="h-7 w-7 text-amber-500" />
            </div>
            <p className="text-sm font-medium">Aucun ouvrier lié à votre compte</p>
            <p className="text-xs text-muted-foreground mt-1">Demandez à un administrateur de lier votre compte à un ouvrier</p>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /><span className="text-sm">Chargement…</span>
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="h-14 w-14 rounded-2xl bg-muted flex items-center justify-center mb-3">
              <ClipboardCheck className="h-7 w-7 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">Aucun ordre de préparation pour vous</p>
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.active.length > 0 && (
              <OrderSection title="En attente / En cours" orders={grouped.active} onOpen={openDetail} />
            )}
            {grouped.completed.length > 0 && (
              <OrderSection title="Terminés" orders={grouped.completed} onOpen={openDetail} />
            )}
            {grouped.cancelled.length > 0 && (
              <OrderSection title="Annulés" orders={grouped.cancelled} onOpen={openDetail} />
            )}
          </div>
        )}
      </div>

      {/* Detail Dialog */}
      {selected && (
        <Dialog open onOpenChange={() => setSelected(null)}>
          <DialogContent className="max-w-xl max-h-[90vh] overflow-auto">
            <DialogHeader>
              <DialogTitle className="font-mono text-base">{selected.reference}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Building2 className="h-3.5 w-3.5" />
                    <span>{selected.branchName}</span>
                  </div>
                  <div className="text-muted-foreground">{fmtDate(selected.sourceReplenishmentDate)}</div>
                </div>
                <StatusBadge status={selected.status} />
              </div>

              <div className="text-xs text-muted-foreground grid grid-cols-2 gap-1">
                {selected.viewedAt && <span>Vu : {fmtDateTime(selected.viewedAt)}</span>}
                {selected.startedAt && <span>Démarré : {fmtDateTime(selected.startedAt)}</span>}
                {selected.completedAt && <span>Terminé : {fmtDateTime(selected.completedAt)}</span>}
              </div>

              <Separator />

              <div>
                <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  À préparer — {selected.items.length} produit{selected.items.length > 1 ? "s" : ""}
                </h4>
                <div className="space-y-2">
                  {selected.items.map(item => (
                    <div key={item.id} className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2.5">
                      <div>
                        <p className="text-sm font-medium">{item.productNameSnapshot}</p>
                        {item.skuSnapshot && <p className="text-xs text-muted-foreground font-mono">{item.skuSnapshot}</p>}
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold text-amber-700">{fmtQty(item.quantityToPrepare)}</p>
                        <p className="text-xs text-muted-foreground">{item.unitSnapshot}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Actions */}
              {!["completed", "cancelled"].includes(selected.status) && (
                <div className="flex gap-2 pt-1">
                  {selected.status !== "in_progress" && (
                    <Button onClick={() => updateStatus(selected.id, "in_progress")} disabled={updating} className="flex-1 gap-2" variant="outline">
                      {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                      Marquer en cours
                    </Button>
                  )}
                  <Button onClick={() => updateStatus(selected.id, "completed")} disabled={updating} className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
                    {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Marquer terminé
                  </Button>
                </div>
              )}

              <div className="flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => printOrder(selected)} className="gap-2 text-muted-foreground">
                  <Printer className="h-3.5 w-3.5" />Imprimer
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function OrderSection({ title, orders, onOpen }: { title: string; orders: MyOrder[]; onOpen: (o: MyOrder) => void }) {
  function fmtDate(d: string | null) {
    if (!d) return "—";
    try { return format(new Date(d), "dd/MM/yyyy", { locale: fr }); } catch { return d; }
  }
  function fmtQty(n: string | number) {
    const v = parseFloat(String(n));
    return isNaN(v) ? "0" : (v % 1 === 0 ? v.toString() : v.toFixed(3).replace(/\.?0+$/, ""));
  }
  const cfg: Record<string, { label: string; className: string; Icon: any }> = {
    new:        { label: "Nouveau",  className: "bg-blue-100 text-blue-700",     Icon: Clock },
    viewed:     { label: "Vu",       className: "bg-purple-100 text-purple-700", Icon: Eye },
    in_progress:{ label: "En cours", className: "bg-amber-100 text-amber-700",   Icon: PlayCircle },
    completed:  { label: "Terminé",  className: "bg-emerald-100 text-emerald-700", Icon: CheckCircle2 },
    cancelled:  { label: "Annulé",   className: "bg-red-100 text-red-700",       Icon: XCircle },
  };

  return (
    <div>
      <h3 className="text-sm font-semibold text-muted-foreground mb-2">{title}</h3>
      <div className="space-y-2">
        {orders.map(o => {
          const { label, className, Icon } = cfg[o.status] ?? cfg.new;
          return (
            <Card key={o.id} className="border shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => onOpen(o)}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold">{o.reference}</span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>
                        <Icon className="h-3 w-3" />{label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{o.branchName}</span>
                      <span>{fmtDate(o.sourceReplenishmentDate)}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-amber-700">{o.itemCount} <span className="text-xs font-normal text-muted-foreground">produits</span></p>
                    <p className="text-xs text-muted-foreground">Qté: {fmtQty(o.totalQty)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
