import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useGetContacts, useGetBranches, useGetProducts, useGetUnits, getGetPurchasesQueryKey, useGetCompanySettings } from "@workspace/api-client-react";
import { AttachmentPanel } from "@/components/AttachmentPanel";
import { ExportButton } from "@/components/ExportButton";
import { PdfButton } from "@/components/PdfButton";
import { generatePurchasePdf, generatePurchaseTicketPdf } from "@/lib/pdf-generator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Plus, Truck, Building2, Package, CheckCircle2, XCircle, Clock,
  CreditCard, Banknote, ArrowUpRight, ChevronRight, Search, Filter,
  RotateCcw, AlertCircle, CheckCheck, CalendarDays, User, FileText,
  ShoppingCart, Trash2, Edit3, X
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "@/hooks/use-toast";

/* ─── types ─────────────────────────────────────────────────────────────── */
interface PurchaseItem {
  id: number; purchaseId: number; productId: number; productName: string; productUnit: string;
  quantity: number; receivedQuantity: number; rejectedQuantity: number; remainingQuantity: number;
  unitCost: number; total: number; notes: string | null; fullyReceived: boolean;
}
interface PurchasePayment {
  id: number; amount: number; method: string; date: string; notes: string | null; createdAt: string;
}
interface ReceptionItem {
  id: number; productId: number; productName: string; productUnit: string;
  quantityReceived: number; quantityRejected: number; notes: string | null;
}
interface Reception {
  id: number; purchaseId: number; branchId: number; branchName: string;
  notes: string | null; createdByName: string | null; createdAt: string;
  items: ReceptionItem[];
}
interface PurchaseDetail {
  id: number; reference: string; supplierId: number; supplierName: string; supplierPhone: string | null;
  branchId: number; branchName: string; status: string; paymentStatus: string;
  subtotal: number; discount: number; tax: number; total: number; paid: number; due: number;
  notes: string | null; createdByName: string | null; createdAt: string;
  items: PurchaseItem[];
  payments: PurchasePayment[];
  receptions: Reception[];
  stats: { totalOrdered: number; totalReceived: number; totalRemaining: number; receptionCount: number };
}
type LineItem = { productId: number; productName: string; quantity: string; unitCost: string };

/* ─── helpers ────────────────────────────────────────────────────────────── */
function formatDA(n: number) { return new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(n) + " DA"; }
function formatDate(s: string) { return new Date(s).toLocaleDateString("fr-DZ", { day: "numeric", month: "short", year: "numeric" }); }

const STATUS_META: Record<string, { label: string; cls: string; icon: any }> = {
  draft: { label: "Brouillon", cls: "bg-gray-100 text-gray-700", icon: FileText },
  ordered: { label: "Commandé", cls: "bg-blue-100 text-blue-700", icon: ShoppingCart },
  partially_received: { label: "Partiellement reçu", cls: "bg-amber-100 text-amber-700", icon: Clock },
  received: { label: "Réceptionné", cls: "bg-green-100 text-green-700", icon: CheckCheck },
  cancelled: { label: "Annulé", cls: "bg-red-100 text-red-700", icon: XCircle },
};
const PAY_META: Record<string, { label: string; cls: string }> = {
  unpaid: { label: "Impayé", cls: "bg-red-100 text-red-700" },
  partially_paid: { label: "Partiel", cls: "bg-amber-100 text-amber-700" },
  paid: { label: "Payé", cls: "bg-green-100 text-green-700" },
};
function StatusChip({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, cls: "bg-gray-100 text-gray-600", icon: FileText };
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${m.cls}`}>{m.label}</span>;
}
function PayChip({ status }: { status: string }) {
  const m = PAY_META[status] ?? { label: status, cls: "bg-gray-100 text-gray-600" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${m.cls}`}>{m.label}</span>;
}
function methodLabel(m: string) {
  const ml: Record<string, string> = { cash: "Espèces", card: "Carte", transfer: "Virement", check: "Chèque", other: "Autre" };
  return ml[m] ?? m;
}

/* ─── custom API hooks ───────────────────────────────────────────────────── */
function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem("erp_token") ?? ""}` };
}
async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...opts, headers: { "Content-Type": "application/json", ...authHeaders(), ...(opts?.headers ?? {}) } });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any).error ?? "Erreur"); }
  return r.json();
}
function usePurchaseDetail(id: number | null) {
  return useQuery<PurchaseDetail>({
    queryKey: ["purchase-detail", id],
    queryFn: () => apiFetch(`/api/purchases/${id}`),
    enabled: id != null,
    staleTime: 10000,
  });
}
function usePurchaseList(filters: Record<string, string>) {
  const params = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, v]) => v && v !== "all")));
  return useQuery<PurchaseDetail[]>({
    queryKey: ["purchases-list", filters],
    queryFn: () => apiFetch(`/api/purchases?${params}`),
    staleTime: 15000,
  });
}

/* ─── ReceptionDialog ────────────────────────────────────────────────────── */
function ReceptionDialog({ purchase, onClose, onSuccess }: { purchase: PurchaseDetail; onClose: () => void; onSuccess: () => void }) {
  const receivableItems = purchase.items.filter(i => i.remainingQuantity > 0);
  const [quantities, setQuantities] = useState<Record<number, { received: string; rejected: string; notes: string }>>(
    Object.fromEntries(receivableItems.map(i => [i.id, { received: String(i.remainingQuantity), rejected: "0", notes: "" }]))
  );
  const [globalNotes, setGlobalNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  function setQty(itemId: number, field: "received" | "rejected" | "notes", val: string) {
    setQuantities(q => ({ ...q, [itemId]: { ...q[itemId], [field]: val } }));
  }
  function fillAll() {
    setQuantities(Object.fromEntries(receivableItems.map(i => [i.id, { received: String(i.remainingQuantity), rejected: "0", notes: "" }])));
  }
  function clearAll() {
    setQuantities(Object.fromEntries(receivableItems.map(i => [i.id, { received: "0", rejected: "0", notes: "" }])));
  }

  const hasAny = Object.values(quantities).some(q => parseFloat(q.received || "0") > 0 || parseFloat(q.rejected || "0") > 0);

  async function submit() {
    const items = receivableItems
      .map(i => ({
        purchaseItemId: i.id,
        quantityReceived: parseFloat(quantities[i.id]?.received || "0"),
        quantityRejected: parseFloat(quantities[i.id]?.rejected || "0"),
        notes: quantities[i.id]?.notes || null,
      }))
      .filter(i => i.quantityReceived > 0 || i.quantityRejected > 0);

    // Validate
    for (const item of items) {
      const orig = purchase.items.find(i => i.id === item.purchaseItemId)!;
      if (item.quantityReceived + item.quantityRejected > orig.remainingQuantity + 0.001) {
        toast({ title: `Sur-réception: ${orig.productName} (max ${orig.remainingQuantity})`, variant: "destructive" }); return;
      }
    }

    if (!items.length) { toast({ title: "Saisissez au moins une quantité", variant: "destructive" }); return; }

    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await apiFetch(`/api/purchases/${purchase.id}/receive`, {
        method: "POST",
        body: JSON.stringify({ items, notes: globalNotes || null }),
      });
      toast({ title: "Réception enregistrée avec succès" });
      onSuccess();
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const totalReceiving = receivableItems.reduce((s, i) => s + parseFloat(quantities[i.id]?.received || "0"), 0);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-primary" />
            Réceptionner des articles
          </DialogTitle>
          <DialogDescription>{purchase.reference} · {purchase.supplierName} → {purchase.branchName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{receivableItems.length} article{receivableItems.length !== 1 ? "s" : ""} en attente</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={fillAll}>Tout sélectionner</Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={clearAll}>Tout vider</Button>
            </div>
          </div>

          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-xs">Article</TableHead>
                  <TableHead className="text-xs text-center">Commandé</TableHead>
                  <TableHead className="text-xs text-center">Déjà reçu</TableHead>
                  <TableHead className="text-xs text-center">Restant</TableHead>
                  <TableHead className="text-xs text-center">À réceptionner</TableHead>
                  <TableHead className="text-xs text-center">Refusé</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receivableItems.map(item => {
                  const q = quantities[item.id] ?? { received: "0", rejected: "0", notes: "" };
                  const recv = parseFloat(q.received || "0");
                  const rej = parseFloat(q.rejected || "0");
                  const over = recv + rej > item.remainingQuantity + 0.001;
                  return (
                    <TableRow key={item.id} className={over ? "bg-red-50" : ""}>
                      <TableCell>
                        <p className="text-sm font-medium">{item.productName}</p>
                        <p className="text-xs text-muted-foreground">{item.productUnit} · {formatDA(item.unitCost)}/u</p>
                      </TableCell>
                      <TableCell className="text-center text-sm font-mono">{item.quantity}</TableCell>
                      <TableCell className="text-center text-sm font-mono text-emerald-600">{item.receivedQuantity}</TableCell>
                      <TableCell className="text-center text-sm font-mono text-amber-600 font-semibold">{item.remainingQuantity}</TableCell>
                      <TableCell className="text-center">
                        <Input
                          type="number" min="0" max={item.remainingQuantity} step="0.001"
                          className={`w-20 h-8 text-center text-sm mx-auto ${over ? "border-red-400" : ""}`}
                          value={q.received}
                          onChange={e => setQty(item.id, "received", e.target.value)}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Input
                          type="number" min="0" max={item.remainingQuantity} step="0.001"
                          className="w-16 h-8 text-center text-sm mx-auto"
                          value={q.rejected}
                          onChange={e => setQty(item.id, "rejected", e.target.value)}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center gap-4 rounded-lg bg-muted/40 px-4 py-3">
            <Package className="h-4 w-4 text-muted-foreground shrink-0" />
            <p className="text-sm">
              Vous réceptionnez <span className="font-bold text-primary">{totalReceiving.toFixed(totalReceiving % 1 === 0 ? 0 : 3)}</span> unité{totalReceiving !== 1 ? "s" : ""} vers <span className="font-semibold">{purchase.branchName}</span>
            </p>
          </div>

          <div>
            <Label>Notes de réception (optionnel)</Label>
            <Input value={globalNotes} onChange={e => setGlobalNotes(e.target.value)} placeholder="Ex: Livraison partielle confirmée, 2 cartons endommagés..." />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={submit} disabled={!hasAny || saving} className="gap-2">
            <CheckCircle2 className="h-4 w-4" />
            {saving ? "Enregistrement..." : "Valider la réception"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── PurchaseDetailPanel ────────────────────────────────────────────────── */
function PurchaseDetailPanel({ purchaseId, onClose, onRefresh }: { purchaseId: number; onClose: () => void; onRefresh: () => void }) {
  const qc = useQueryClient();
  const { data: purchase, isLoading, refetch } = usePurchaseDetail(purchaseId);
  const { data: companySettings } = useGetCompanySettings();
  const [tab, setTab] = useState("details");
  const [showReception, setShowReception] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [payForm, setPayForm] = useState({ amount: "", method: "transfer", date: format(new Date(), "yyyy-MM-dd"), notes: "" });
  const [paying, setPaying] = useState(false);
  const payingRef = useRef(false);
  const [cancelling, setCancelling] = useState(false);

  async function addPayment() {
    if (!payForm.amount || !purchase) return;
    if (payingRef.current) return;
    payingRef.current = true;
    setPaying(true);
    try {
      await apiFetch(`/api/purchases/${purchaseId}/payment`, {
        method: "POST",
        body: JSON.stringify({ amount: parseFloat(payForm.amount), method: payForm.method, date: payForm.date, notes: payForm.notes || null }),
      });
      toast({ title: "Paiement enregistré" });
      setShowPayment(false);
      setPayForm(f => ({ ...f, amount: "" }));
      refetch(); onRefresh();
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
    finally { payingRef.current = false; setPaying(false); }
  }

  async function cancelPurchase() {
    if (!purchase) return;
    setCancelling(true);
    try {
      await apiFetch(`/api/purchases/${purchaseId}/cancel`, { method: "POST" });
      toast({ title: "Bon de commande annulé" });
      refetch(); onRefresh();
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
    finally { setCancelling(false); }
  }

  if (isLoading || !purchase) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-muted-foreground">Chargement...</p>
      </div>
    );
  }

  const canReceive = purchase.status === "ordered" || purchase.status === "partially_received";
  const canPay = purchase.paymentStatus !== "paid" && purchase.status !== "cancelled";
  const canCancel = purchase.status !== "received" && purchase.status !== "cancelled";
  const receivedPct = purchase.stats.totalOrdered > 0 ? (purchase.stats.totalReceived / purchase.stats.totalOrdered) * 100 : 0;
  const paidPct = purchase.total > 0 ? (purchase.paid / purchase.total) * 100 : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-4 pb-4 border-b shrink-0">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-sm font-bold">{purchase.reference}</span>
              <StatusChip status={purchase.status} />
              <PayChip status={purchase.paymentStatus} />
            </div>
            <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" />{purchase.supplierName}</span>
              <span>·</span>
              <span className="flex items-center gap-1"><Truck className="h-3.5 w-3.5" />{purchase.branchName}</span>
              <span>·</span>
              <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{format(new Date(purchase.createdAt), "dd/MM/yyyy HH:mm")}</span>
              {purchase.createdByName && (<><span>·</span><span className="flex items-center gap-1"><User className="h-3.5 w-3.5" />{purchase.createdByName}</span></>)}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <PdfButton
              onGenerate={() => generatePurchaseTicketPdf(purchase as any, companySettings as any)}
              label="Ticket"
              size="sm"
              variant="outline"
            />
            <PdfButton
              onGenerate={() => generatePurchasePdf(purchase as any, companySettings as any)}
              label="A4"
              size="sm"
              variant="outline"
            />
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}><X className="h-4 w-4" /></Button>
          </div>
        </div>

        {/* Progress bars */}
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Réception</span>
              <span className="font-semibold">{Math.round(receivedPct)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className={`h-full rounded-full transition-all ${receivedPct >= 100 ? "bg-emerald-500" : "bg-amber-400"}`} style={{ width: `${Math.min(100, receivedPct)}%` }} />
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{purchase.stats.totalReceived.toFixed(0)} / {purchase.stats.totalOrdered.toFixed(0)} unités</p>
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Paiement</span>
              <span className="font-semibold">{Math.round(paidPct)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className={`h-full rounded-full transition-all ${paidPct >= 100 ? "bg-emerald-500" : "bg-blue-400"}`} style={{ width: `${Math.min(100, paidPct)}%` }} />
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{formatDA(purchase.paid)} / {formatDA(purchase.total)}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 mt-4">
          {canReceive && (
            <Button size="sm" className="gap-1.5" onClick={() => setShowReception(true)}>
              <Truck className="h-3.5 w-3.5" />Réceptionner
            </Button>
          )}
          {canPay && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowPayment(true)}>
              <CreditCard className="h-3.5 w-3.5" />Paiement
            </Button>
          )}
          {canCancel && (
            <Button variant="outline" size="sm" className="gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 ml-auto" onClick={cancelPurchase} disabled={cancelling}>
              <XCircle className="h-3.5 w-3.5" />{cancelling ? "..." : "Annuler"}
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 min-h-0">
        <TabsList className="mx-6 mt-3 w-auto justify-start h-9 bg-muted/60 rounded-lg shrink-0">
          <TabsTrigger value="details" className="text-xs px-3">Articles</TabsTrigger>
          <TabsTrigger value="receptions" className="text-xs px-3">
            Réceptions {purchase.receptions.length > 0 && <span className="ml-1 rounded-full bg-primary/15 text-primary px-1.5 text-[10px] font-semibold">{purchase.receptions.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="payments" className="text-xs px-3">
            Paiements {purchase.payments.length > 0 && <span className="ml-1 rounded-full bg-primary/15 text-primary px-1.5 text-[10px] font-semibold">{purchase.payments.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="documents" className="text-xs px-3">Documents</TabsTrigger>
        </TabsList>

        {/* ARTICLES TAB */}
        <TabsContent value="details" className="flex-1 overflow-y-auto mt-0">
          <div className="px-6 pb-6 space-y-4 pt-3">
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="text-xs">Article</TableHead>
                    <TableHead className="text-xs text-right">Commandé</TableHead>
                    <TableHead className="text-xs text-right">Reçu</TableHead>
                    <TableHead className="text-xs text-right">Restant</TableHead>
                    <TableHead className="text-xs text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchase.items.map(item => (
                    <TableRow key={item.id} className={item.fullyReceived ? "opacity-60" : ""}>
                      <TableCell>
                        <p className="text-sm font-medium">{item.productName}</p>
                        <p className="text-xs text-muted-foreground">{formatDA(item.unitCost)} / {item.productUnit}</p>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">{item.quantity}</TableCell>
                      <TableCell className="text-right">
                        <span className={`font-mono text-sm font-semibold ${item.receivedQuantity > 0 ? "text-emerald-600" : "text-muted-foreground"}`}>
                          {item.receivedQuantity}
                        </span>
                        {item.rejectedQuantity > 0 && <span className="text-xs text-red-500 ml-1">(-{item.rejectedQuantity})</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.remainingQuantity > 0 ? (
                          <span className="font-mono text-sm font-semibold text-amber-600">{item.remainingQuantity}</span>
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-emerald-500 ml-auto" />
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-sm">{formatDA(item.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Sous-total</span><span>{formatDA(purchase.subtotal)}</span></div>
              {purchase.discount > 0 && <div className="flex justify-between text-sm"><span className="text-muted-foreground">Remise</span><span className="text-emerald-600">−{formatDA(purchase.discount)}</span></div>}
              {purchase.tax > 0 && <div className="flex justify-between text-sm"><span className="text-muted-foreground">Taxes</span><span>{formatDA(purchase.tax)}</span></div>}
              <Separator />
              <div className="flex justify-between text-sm font-bold"><span>Total</span><span>{formatDA(purchase.total)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Payé</span><span className="text-emerald-600 font-semibold">{formatDA(purchase.paid)}</span></div>
              {purchase.due > 0 && <div className="flex justify-between text-sm font-semibold"><span className="text-muted-foreground">Reste à payer</span><span className="text-red-600">{formatDA(purchase.due)}</span></div>}
            </div>

            {purchase.notes && (
              <div className="rounded-lg bg-muted/40 px-4 py-3">
                <p className="text-xs font-semibold text-muted-foreground mb-1">Notes</p>
                <p className="text-sm">{purchase.notes}</p>
              </div>
            )}
          </div>
        </TabsContent>

        {/* RECEPTIONS TAB */}
        <TabsContent value="receptions" className="flex-1 overflow-y-auto px-6 pb-6 pt-3 mt-0">
          {purchase.receptions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <Truck className="h-8 w-8 opacity-30" />
              <p className="text-sm">Aucune réception enregistrée</p>
              {canReceive && <Button size="sm" variant="outline" className="mt-2" onClick={() => setShowReception(true)}>Effectuer la première réception</Button>}
            </div>
          ) : (
            <div className="space-y-4">
              {purchase.receptions.map((r, idx) => (
                <div key={r.id} className="rounded-xl border overflow-hidden">
                  <div className="flex items-center justify-between bg-muted/40 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                        {purchase.receptions.length - idx}
                      </div>
                      <div>
                        <p className="text-sm font-semibold">Réception #{purchase.receptions.length - idx}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(r.createdAt)} · {r.branchName}{r.createdByName ? ` · ${r.createdByName}` : ""}</p>
                      </div>
                    </div>
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  </div>
                  <div className="divide-y">
                    {r.items.map(ri => (
                      <div key={ri.id} className="flex items-center justify-between px-4 py-2.5">
                        <div>
                          <p className="text-sm font-medium">{ri.productName}</p>
                          <p className="text-xs text-muted-foreground">{ri.productUnit}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-emerald-600">+{ri.quantityReceived}</p>
                          {ri.quantityRejected > 0 && <p className="text-xs text-red-500">refusé: {ri.quantityRejected}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                  {r.notes && <div className="bg-amber-50/50 px-4 py-2 border-t"><p className="text-xs text-muted-foreground">{r.notes}</p></div>}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* PAYMENTS TAB */}
        <TabsContent value="payments" className="flex-1 overflow-y-auto px-6 pb-6 pt-3 mt-0">
          <div className="space-y-3">
            {purchase.payments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                <CreditCard className="h-8 w-8 opacity-30" />
                <p className="text-sm">Aucun paiement enregistré</p>
                {canPay && <Button size="sm" variant="outline" className="mt-2" onClick={() => setShowPayment(true)}>Ajouter un paiement</Button>}
              </div>
            ) : (
              <>
                {purchase.payments.map(p => (
                  <div key={p.id} className="flex items-center gap-3 rounded-xl border px-4 py-3">
                    <div className="h-9 w-9 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                      <Banknote className="h-4 w-4 text-amber-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold">{methodLabel(p.method)}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <CalendarDays className="h-3 w-3" />{p.createdAt ? format(new Date(p.createdAt), "dd/MM/yyyy HH:mm") : formatDate(p.date)}
                        {p.notes && <><span>·</span><span className="truncate">{p.notes}</span></>}
                      </p>
                    </div>
                    <p className="text-sm font-bold text-amber-700 shrink-0">−{formatDA(p.amount)}</p>
                  </div>
                ))}
                <div className="rounded-lg bg-muted/40 p-3 flex justify-between text-sm">
                  <span className="text-muted-foreground">Total payé</span>
                  <span className="font-bold text-emerald-600">{formatDA(purchase.paid)}</span>
                </div>
                {purchase.due > 0 && (
                  <div className="rounded-lg bg-red-50 p-3 flex justify-between text-sm">
                    <span className="text-red-700 font-medium">Reste à payer</span>
                    <span className="font-bold text-red-700">{formatDA(purchase.due)}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </TabsContent>

        {/* DOCUMENTS TAB */}
        <TabsContent value="documents" className="flex-1 overflow-y-auto px-6 pb-6 pt-3 mt-0">
          <AttachmentPanel
            entityType="purchase"
            entityId={purchase.id}
            branchId={purchase.branchId}
          />
        </TabsContent>
      </Tabs>

      {/* Reception dialog */}
      {showReception && (
        <ReceptionDialog
          purchase={purchase}
          onClose={() => setShowReception(false)}
          onSuccess={() => { setShowReception(false); refetch(); onRefresh(); setTab("receptions"); }}
        />
      )}

      {/* Payment dialog */}
      {showPayment && (
        <Dialog open onOpenChange={() => setShowPayment(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Enregistrer un paiement</DialogTitle>
              <DialogDescription>{purchase.reference} · Reste: {formatDA(purchase.due)}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Montant (DA) *</Label>
                <Input type="number" value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} placeholder={String(purchase.due)} />
              </div>
              <div>
                <Label>Moyen de paiement</Label>
                <Select value={payForm.method} onValueChange={v => setPayForm(f => ({ ...f, method: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Espèces</SelectItem>
                    <SelectItem value="transfer">Virement</SelectItem>
                    <SelectItem value="card">Carte</SelectItem>
                    <SelectItem value="check">Chèque</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Date</Label><Input type="date" value={payForm.date} onChange={e => setPayForm(f => ({ ...f, date: e.target.value }))} /></div>
              <div><Label>Notes</Label><Input value={payForm.notes} onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowPayment(false)}>Annuler</Button>
              <Button onClick={addPayment} disabled={!payForm.amount || paying}>{paying ? "..." : "Enregistrer"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/* ─── Main page ──────────────────────────────────────────────────────────── */
type LineItemWithId = LineItem & { _key: number };

export default function Purchases() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [payFilter, setPayFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ supplierId: "", branchId: "", status: "received", discount: "0", tax: "0", notes: "", isPaid: false });
  const [lineItems, setLineItems] = useState<LineItemWithId[]>([]);
  const [newItem, setNewItem] = useState({ productId: "", quantity: "", unitCost: "", unitName: "" });
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const [nextKey, setNextKey] = useState(0);
  const [supplierComboOpen, setSupplierComboOpen] = useState(false);
  const [quickSupplierOpen, setQuickSupplierOpen] = useState(false);
  const [quickSupplierFirstName, setQuickSupplierFirstName] = useState("");
  const [quickSupplierLastName, setQuickSupplierLastName] = useState("");
  const [quickSupplierPhone, setQuickSupplierPhone] = useState("");
  const [quickSupplierEmail, setQuickSupplierEmail] = useState("");
  const [quickSupplierSaving, setQuickSupplierSaving] = useState(false);

  const { data: purchases = [], isLoading, refetch } = usePurchaseList({ status: statusFilter, paymentStatus: payFilter });
  const { data: suppliers = [] } = useGetContacts({ type: "supplier" });
  const bothContacts = useGetContacts({ type: "both" });
  const allSuppliers = [...suppliers, ...(bothContacts.data ?? [])].filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i);
  const { data: branches = [] } = useGetBranches();
  const { data: products = [] } = useGetProducts({});
  const { data: units = [] } = useGetUnits();
  const unitDecimalsMap = Object.fromEntries(units.map(u => [u.id, u.allowDecimals]));
  const purchasableProducts = products;
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState("");

  const filtered = purchases.filter(p => {
    if (!search) return true;
    return p.reference.toLowerCase().includes(search.toLowerCase()) || p.supplierName.toLowerCase().includes(search.toLowerCase());
  });

  const statusCounts: Record<string, number> = {};
  for (const p of purchases) { statusCounts[p.status] = (statusCounts[p.status] ?? 0) + 1; }
  const totalCount = purchases.length;

  function addLineItem() {
    if (!newItem.productId || !newItem.quantity || !newItem.unitCost) return;
    const product = purchasableProducts.find(p => p.id === parseInt(newItem.productId));
    if (!product) return;
    setLineItems(l => [...l, { _key: nextKey, productId: parseInt(newItem.productId), productName: product.name, quantity: newItem.quantity, unitCost: newItem.unitCost }]);
    setNextKey(k => k + 1);
    setNewItem({ productId: "", quantity: "", unitCost: "", unitName: "" });
  }

  const currentItemTotal = parseFloat(newItem.quantity || "0") * parseFloat(newItem.unitCost || "0");
  const subtotal = lineItems.reduce((s, i) => s + parseFloat(i.quantity || "0") * parseFloat(i.unitCost || "0"), 0) + currentItemTotal;
  const total = subtotal - parseFloat(form.discount || "0") + parseFloat(form.tax || "0");

  async function create() {
    if (!form.supplierId || !form.branchId) return;
    // Auto-add pending item in input row if valid
    let finalItems = [...lineItems];
    if (newItem.productId && newItem.quantity && newItem.unitCost) {
      const product = purchasableProducts.find(p => p.id === parseInt(newItem.productId));
      if (product) {
        finalItems = [...finalItems, { _key: nextKey, productId: parseInt(newItem.productId), productName: product.name, quantity: newItem.quantity, unitCost: newItem.unitCost }];
      }
    }
    if (finalItems.length === 0) {
      toast({ title: "Ajoutez au moins un article", variant: "destructive" }); return;
    }
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    try {
      await apiFetch("/api/purchases", {
        method: "POST",
        body: JSON.stringify({
          supplierId: parseInt(form.supplierId),
          branchId: parseInt(form.branchId),
          status: form.status,
          discount: parseFloat(form.discount || "0"),
          tax: parseFloat(form.tax || "0"),
          notes: form.notes || null,
          isPaid: form.isPaid,
          items: finalItems.map(i => ({ productId: i.productId, quantity: parseFloat(i.quantity), unitCost: parseFloat(i.unitCost) })),
        }),
      });
      toast({ title: "Bon de commande créé" });
      setCreateOpen(false);
      setLineItems([]);
      setForm({ supplierId: "", branchId: "", status: "received", discount: "0", tax: "0", notes: "", isPaid: false });
      refetch();
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
    finally { creatingRef.current = false; setCreating(false); }
  }

  async function createQuickSupplier() {
    const firstName = quickSupplierFirstName.trim();
    const lastName = quickSupplierLastName.trim();
    const phone = quickSupplierPhone.trim();
    const email = quickSupplierEmail.trim();
    if (!firstName || !lastName || !phone) return;
    setQuickSupplierSaving(true);
    try {
      const token = localStorage.getItem("erp_token") ?? "";
      const displayName = `${firstName} ${lastName}`;
      const r = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: "supplier", displayName, phone, email: email || null, status: "active" }),
      });
      const contact = await r.json();
      if (!r.ok) { toast({ title: contact.error ?? "Erreur", variant: "destructive" }); return; }
      qc.invalidateQueries({ queryKey: ["/api/contacts"] });
      setForm(f => ({ ...f, supplierId: String(contact.id) }));
      setQuickSupplierOpen(false);
      setQuickSupplierFirstName(""); setQuickSupplierLastName("");
      setQuickSupplierPhone(""); setQuickSupplierEmail("");
      toast({ title: `Fournisseur "${contact.displayName}" ajouté` });
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
    finally { setQuickSupplierSaving(false); }
  }

  const STATUS_TABS = [
    { key: "all", label: "Tous", count: totalCount },
    { key: "ordered", label: "Commandés", count: statusCounts.ordered ?? 0 },
    { key: "partially_received", label: "Partiellement reçus", count: statusCounts.partially_received ?? 0 },
    { key: "received", label: "Réceptionnés", count: statusCounts.received ?? 0 },
    { key: "draft", label: "Brouillons", count: statusCounts.draft ?? 0 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold">Achats</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Bons de commande fournisseurs</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <ExportButton
            endpoint="export/purchases"
            params={{
              status: statusFilter !== "all" ? statusFilter : undefined,
              paymentStatus: payFilter !== "all" ? payFilter : undefined,
            }}
            label="Exporter"
          />
          <Button onClick={() => { setForm({ supplierId: "", branchId: "", status: "received", discount: "0", tax: "0", notes: "", isPaid: false }); setLineItems([]); setCreateOpen(true); }} className="gap-2">
            <Plus className="h-4 w-4" />Ajouter un achat
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Rechercher par référence ou fournisseur..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <Select value={payFilter} onValueChange={setPayFilter}>
              <SelectTrigger className="w-[150px]"><SelectValue placeholder="Paiement" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tout paiement</SelectItem>
                <SelectItem value="unpaid">Impayé</SelectItem>
                <SelectItem value="partially_paid">Partiel</SelectItem>
                <SelectItem value="paid">Payé</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {/* Status tabs */}
          <div className="flex gap-1.5 flex-wrap">
            {STATUS_TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setStatusFilter(t.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${statusFilter === t.key ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:bg-muted"}`}
              >
                {t.label} {t.count > 0 && <span className={`ml-1 rounded-full px-1.5 text-[10px] font-bold ${statusFilter === t.key ? "bg-white/20" : "bg-muted"}`}>{t.count}</span>}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* List */}
      <div className="flex gap-6">
        <Card className="flex-1">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Référence</TableHead>
                  <TableHead>Fournisseur</TableHead>
                  <TableHead>Agence dest.</TableHead>
                  <TableHead>Date / Par</TableHead>
                  <TableHead>Réception</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Paiement</TableHead>
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-12 text-muted-foreground">Chargement...</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-12 text-muted-foreground">Aucun bon de commande</TableCell></TableRow>
                ) : filtered.map(p => {
                  const recvPct = p.stats?.totalOrdered > 0 ? (p.stats.totalReceived / p.stats.totalOrdered) * 100 : 0;
                  return (
                    <TableRow key={p.id} className={`cursor-pointer hover:bg-muted/40 ${selectedId === p.id ? "bg-primary/5 border-l-2 border-l-primary" : ""}`} onClick={() => setSelectedId(p.id)}>
                      <TableCell className="font-mono text-xs font-semibold">{p.reference}</TableCell>
                      <TableCell className="text-sm font-medium">{p.supplierName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{p.branchName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <div>{format(new Date(p.createdAt), "dd/MM/yy")}</div>
                        {p.createdByName && <div className="text-xs text-muted-foreground/70">{p.createdByName}</div>}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 min-w-[80px]">
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className={`h-full rounded-full ${recvPct >= 100 ? "bg-emerald-500" : recvPct > 0 ? "bg-amber-400" : "bg-muted-foreground/20"}`} style={{ width: `${Math.min(100, recvPct)}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">{Math.round(recvPct)}%</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm font-semibold">{formatDA(p.total)}</TableCell>
                      <TableCell><StatusChip status={p.status} /></TableCell>
                      <TableCell><PayChip status={p.paymentStatus} /></TableCell>
                      <TableCell><ChevronRight className="h-4 w-4 text-muted-foreground" /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Detail Sheet */}
      <Sheet open={selectedId != null} onOpenChange={open => { if (!open) setSelectedId(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col" onOpenAutoFocus={e => e.preventDefault()}>
          {selectedId && (
            <PurchaseDetailPanel
              purchaseId={selectedId}
              onClose={() => setSelectedId(null)}
              onRefresh={() => refetch()}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Ajouter un achat</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Fournisseur *</Label>
                <div className="flex gap-1 mt-1">
                  <Popover open={supplierComboOpen} onOpenChange={setSupplierComboOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" role="combobox" className="flex-1 justify-between font-normal h-9 text-sm">
                        {form.supplierId ? (allSuppliers.find(s => String(s.id) === form.supplierId)?.displayName ?? "Choisir un fournisseur...") : "Choisir un fournisseur..."}
                        <span className="ml-2 opacity-50">▾</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Rechercher un fournisseur..." />
                        <CommandList>
                          <CommandEmpty>Aucun fournisseur trouvé.</CommandEmpty>
                          <CommandGroup>
                            {allSuppliers.map(s => (
                              <CommandItem key={s.id} value={s.displayName} onSelect={() => { setForm(f => ({ ...f, supplierId: String(s.id) })); setSupplierComboOpen(false); }}>
                                {s.displayName}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <Button
                    type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0"
                    onClick={() => { setQuickSupplierFirstName(""); setQuickSupplierLastName(""); setQuickSupplierPhone(""); setQuickSupplierEmail(""); setQuickSupplierOpen(true); }}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div>
                <Label>Agence destinataire *</Label>
                <Select value={form.branchId} onValueChange={v => setForm(f => ({ ...f, branchId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Choisir une agence..." /></SelectTrigger>
                  <SelectContent>{branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-1 flex items-center gap-3 rounded-lg border p-3 bg-green-50/50">
                <input
                  type="checkbox"
                  id="directStock"
                  checked={form.status === "received"}
                  onChange={e => setForm(f => ({ ...f, status: e.target.checked ? "received" : "ordered" }))}
                  className="h-4 w-4 accent-primary"
                />
                <label htmlFor="directStock" className="text-sm cursor-pointer">
                  <span className="font-medium">Entrée directe en stock</span>
                  <span className="text-muted-foreground ml-1 hidden sm:inline">— articles ajoutés immédiatement</span>
                </label>
              </div>
              <div className="flex items-center gap-3 rounded-lg border p-3 bg-blue-50/50 min-w-fit">
                <input
                  type="checkbox"
                  id="isPaid"
                  checked={form.isPaid}
                  onChange={e => setForm(f => ({ ...f, isPaid: e.target.checked }))}
                  className="h-4 w-4 accent-blue-600"
                />
                <label htmlFor="isPaid" className="text-sm cursor-pointer">
                  <span className="font-medium text-blue-700">Payé</span>
                  <span className="text-muted-foreground ml-1 hidden sm:inline">— règlement immédiat</span>
                </label>
              </div>
            </div>

            {/* Line items */}
            <div className="rounded-lg border overflow-hidden">
              <div className="bg-muted/40 px-3 py-2 flex items-center justify-between">
                <p className="text-sm font-semibold">Articles commandés</p>
                {lineItems.length > 0 && <span className="text-xs text-muted-foreground">{lineItems.length} article{lineItems.length !== 1 ? "s" : ""}</span>}
              </div>
              {lineItems.length > 0 && (
                <Table>
                  <TableBody>
                    {lineItems.map(item => (
                      <TableRow key={item._key}>
                        <TableCell className="text-sm py-2">{item.productName}</TableCell>
                        <TableCell className="text-sm py-2 text-center font-mono">{item.quantity}</TableCell>
                        <TableCell className="text-sm py-2 text-right">{formatDA(parseFloat(item.unitCost))}/u</TableCell>
                        <TableCell className="text-sm py-2 text-right font-semibold">{formatDA(parseFloat(item.quantity) * parseFloat(item.unitCost))}</TableCell>
                        <TableCell className="py-2 text-right">
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setLineItems(l => l.filter(i => i._key !== item._key))}>
                            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <div className="p-3 border-t flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1 justify-between font-normal h-8 text-sm truncate"
                  onClick={() => { setProductSearchQuery(""); setProductSearchOpen(true); }}
                >
                  <span className="truncate">
                    {newItem.productId ? (purchasableProducts.find(p => p.id === parseInt(newItem.productId))?.name ?? "Choisir un article...") : "Choisir un article..."}
                  </span>
                  <span className="ml-1 opacity-50 shrink-0">▾</span>
                </Button>
                <div className="relative flex items-center">
                  <Input type="number" step={(() => { const p = purchasableProducts.find(p => p.id === parseInt(newItem.productId)); return (p && unitDecimalsMap[(p as any).unitId] === false) ? "1" : "0.001"; })()} min="0" className={`h-8 text-sm ${newItem.unitName ? "w-28 pr-9" : "w-20"}`} placeholder="Qté" value={newItem.quantity} onChange={e => { const p = purchasableProducts.find(pr => pr.id === parseInt(newItem.productId)); const allows = p ? (unitDecimalsMap[(p as any).unitId] ?? true) : true; const v = e.target.value; setNewItem(n => ({ ...n, quantity: allows ? v : String(Math.round(parseFloat(v) || 0)) })); }} />
                  {newItem.unitName && (
                    <span className="absolute right-2 text-xs font-semibold text-primary pointer-events-none">{newItem.unitName}</span>
                  )}
                </div>
                <Input type="number" step="1" min="0" className="w-28 h-8 text-sm" placeholder="Prix/u (DA)" value={newItem.unitCost} onChange={e => setNewItem(n => ({ ...n, unitCost: e.target.value }))} />
                <Button variant="outline" size="sm" className="h-8 shrink-0" onClick={addLineItem}><Plus className="h-3.5 w-3.5" /></Button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div><Label>Remise (DA)</Label><Input type="number" min="0" value={form.discount} onChange={e => setForm(f => ({ ...f, discount: e.target.value }))} /></div>
              <div><Label>Taxes (DA)</Label><Input type="number" min="0" value={form.tax} onChange={e => setForm(f => ({ ...f, tax: e.target.value }))} /></div>
              <div className="flex flex-col justify-end pb-1">
                <p className="text-right text-sm">Sous-total: <span className="font-semibold">{formatDA(subtotal)}</span></p>
                <p className="text-right text-base font-bold">Total: {formatDA(total)}</p>
              </div>
            </div>
            <div><Label>Notes (optionnel)</Label><Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Conditions, délais..." /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Annuler</Button>
            <Button onClick={create} disabled={!form.supplierId || !form.branchId || (lineItems.length === 0 && !(newItem.productId && newItem.quantity && newItem.unitCost)) || creating}>
              {creating ? "Validation..." : "Valider l'achat"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Quick add fournisseur dialog ── */}
      <Dialog open={quickSupplierOpen} onOpenChange={v => { if (!v) setQuickSupplierOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-primary" />
              Nouveau fournisseur
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Prénom <span className="text-destructive">*</span></Label>
                <Input className="mt-1" placeholder="Ex: Mohamed" value={quickSupplierFirstName} onChange={e => setQuickSupplierFirstName(e.target.value)} autoFocus />
              </div>
              <div>
                <Label>Nom <span className="text-destructive">*</span></Label>
                <Input className="mt-1" placeholder="Ex: Hadj Ali" value={quickSupplierLastName} onChange={e => setQuickSupplierLastName(e.target.value)} />
              </div>
            </div>
            <div>
              <Label>Téléphone <span className="text-destructive">*</span></Label>
              <Input className="mt-1" placeholder="0555 000 000" value={quickSupplierPhone} onChange={e => setQuickSupplierPhone(e.target.value)} />
            </div>
            <div>
              <Label>Email <span className="text-muted-foreground text-xs">(optionnel)</span></Label>
              <Input className="mt-1" type="email" placeholder="exemple@email.com" value={quickSupplierEmail} onChange={e => setQuickSupplierEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && createQuickSupplier()} />
            </div>
            <p className="text-xs text-muted-foreground">Prénom, Nom et Téléphone sont obligatoires.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuickSupplierOpen(false)}>Annuler</Button>
            <Button onClick={createQuickSupplier} disabled={!quickSupplierFirstName.trim() || !quickSupplierLastName.trim() || !quickSupplierPhone.trim() || quickSupplierSaving}>
              {quickSupplierSaving ? "Ajout..." : "Ajouter le fournisseur"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog recherche produit (mobile-friendly) ── */}
      <Dialog open={productSearchOpen} onOpenChange={v => { if (!v) setProductSearchOpen(false); }}>
        <DialogContent className="max-w-md h-[80vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-4 pt-4 pb-2 shrink-0">
            <DialogTitle className="text-base">Choisir un article</DialogTitle>
          </DialogHeader>
          {/* Barre de recherche */}
          <div className="px-4 pb-2 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                autoFocus
                placeholder="Rechercher un article..."
                className="pl-9 h-10"
                value={productSearchQuery}
                onChange={e => setProductSearchQuery(e.target.value)}
              />
            </div>
          </div>
          {/* Liste scrollable */}
          <div className="flex-1 overflow-y-auto px-2 pb-4">
            {(() => {
              const q = productSearchQuery.toLowerCase();
              const filtered = q ? purchasableProducts.filter(p => p.name.toLowerCase().includes(q)) : purchasableProducts;
              if (filtered.length === 0) return (
                <p className="text-center text-sm text-muted-foreground py-8">Aucun article trouvé</p>
              );
              return filtered.map(p => (
                <button
                  key={p.id}
                  className="w-full flex items-center justify-between px-3 py-3 rounded-lg hover:bg-muted active:bg-muted/80 text-left transition-colors"
                  onClick={() => {
                    setNewItem(n => ({ ...n, productId: String(p.id), unitCost: p?.costPrice?.toString() ?? "", unitName: (p as any)?.unitName ?? "" }));
                    setProductSearchOpen(false);
                    setProductSearchQuery("");
                  }}
                >
                  <span className="text-sm font-medium truncate flex-1">{p.name}</span>
                  {(p as any)?.unitName && <span className="ml-3 text-xs text-muted-foreground shrink-0">{(p as any).unitName}</span>}
                </button>
              ));
            })()}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
