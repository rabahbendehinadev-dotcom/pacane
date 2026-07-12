import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useGetBranches, useGetContacts, useGetCompanySettings } from "@workspace/api-client-react";
import { generateSaleReturnPdf } from "@/lib/pdf-generator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import {
  RotateCcw, Plus, Search, Building2, User, FileText,
  CheckCircle2, XCircle, Clock, AlertCircle, ChevronRight,
  PackageOpen, Banknote, X, ArrowLeft, Loader2, Wallet, Sparkles, FileDown,
} from "lucide-react";

/* ── Types ─────────────────────────────────────────────────────────────── */
interface ReturnItem {
  id: number; returnId: number; saleItemId: number | null;
  productId: number; productName: string;
  quantity: number; unitPrice: number; total: number;
}
interface SalesReturn {
  id: number; reference: string; saleId: number; saleReference: string;
  customerId: number | null; customerName: string | null;
  branchId: number; branchName: string; status: string;
  reason: string | null; notes: string | null;
  totalAmount: number; refundedAmount: number; creditAmount: number; refundDue: number;
  createdByName: string | null; createdAt: string;
  items: ReturnItem[];
}
interface ReturnableItem {
  saleItemId: number; productId: number; productName: string;
  originalQuantity: number; alreadyReturnedQuantity: number;
  remainingQuantity: number; unitPrice: number; canReturn: boolean;
}
interface ReturnableData {
  sale: { id: number; reference: string; branchId: number; customerId: number | null };
  items: ReturnableItem[];
}
interface SaleSearchResult {
  id: number; reference: string; type: string; status: string;
  customerName: string | null; branchId: number; branchName: string;
  total: number; paid: number; due: number; createdAt: string;
}

/* ── Helpers ────────────────────────────────────────────────────────────── */
function formatDA(n: number) { return new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(n) + " DA"; }
function formatDate(s: string) { return new Date(s).toLocaleDateString("fr-DZ", { day: "numeric", month: "short", year: "numeric" }); }
function authHeaders() { return { Authorization: `Bearer ${localStorage.getItem("erp_token") ?? ""}` }; }
async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...opts, headers: { "Content-Type": "application/json", ...authHeaders(), ...(opts?.headers ?? {}) } });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any).error ?? "Erreur"); }
  return r.json();
}

const STATUS_META: Record<string, { label: string; icon: any; cls: string }> = {
  draft: { label: "Brouillon", icon: Clock, cls: "bg-gray-100 text-gray-700" },
  confirmed: { label: "Confirmé", icon: CheckCircle2, cls: "bg-green-100 text-green-700" },
  partially_refunded: { label: "Partiel. remb.", icon: Banknote, cls: "bg-amber-100 text-amber-700" },
  refunded: { label: "Remboursé", icon: CheckCircle2, cls: "bg-emerald-100 text-emerald-700" },
  cancelled: { label: "Annulé", icon: XCircle, cls: "bg-red-100 text-red-700" },
};
function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, icon: AlertCircle, cls: "bg-gray-100 text-gray-600" };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${m.cls}`}>
      <m.icon className="h-3 w-3" />{m.label}
    </span>
  );
}

/* ── Hooks ──────────────────────────────────────────────────────────────── */
function useReturns(filters: Record<string, string>) {
  const params = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, v]) => v && v !== "all")));
  return useQuery<SalesReturn[]>({
    queryKey: ["returns", filters],
    queryFn: () => apiFetch(`/api/returns?${params}`),
    staleTime: 15000,
  });
}
function useReturnDetail(id: number | null) {
  return useQuery<SalesReturn>({
    queryKey: ["return-detail", id],
    queryFn: () => apiFetch(`/api/returns/${id}`),
    enabled: id != null,
    staleTime: 10000,
  });
}
function useReturnableItems(saleId: number | null) {
  return useQuery<ReturnableData>({
    queryKey: ["returnable-items", saleId],
    queryFn: () => apiFetch(`/api/sales/${saleId}/returnable-items`),
    enabled: saleId != null,
    staleTime: 5000,
  });
}
function useSaleSearch(search: string) {
  const params = new URLSearchParams({ type: "sale", status: "all" });
  if (search) params.set("search", search);
  return useQuery<SaleSearchResult[]>({
    queryKey: ["sale-search-for-return", search],
    queryFn: () => apiFetch<{ data: SaleSearchResult[] }>(`/api/sales?${params}`).then(r => r.data ?? []),
    staleTime: 10000,
  });
}

/* ── ReturnDetailPanel ──────────────────────────────────────────────────── */
function ReturnDetailPanel({ returnId, onClose, onRefresh }: { returnId: number; onClose: () => void; onRefresh: () => void }) {
  const qc = useQueryClient();
  const { data: ret, isLoading, refetch } = useReturnDetail(returnId);
  const { data: companySettings } = useGetCompanySettings();
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [refundAmount, setRefundAmount] = useState("");
  const [issuingCredit, setIssuingCredit] = useState(false);
  const [creditAmount, setCreditAmount] = useState("");

  async function doConfirm() {
    if (!ret) return;
    setConfirming(true);
    try {
      await apiFetch(`/api/returns/${ret.id}/confirm`, { method: "POST" });
      toast({ title: "Retour confirmé", description: "Le stock a été réajusté et la créance mise à jour." });
      refetch(); onRefresh();
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
    finally { setConfirming(false); }
  }

  async function doCancel() {
    if (!ret) return;
    setCancelling(true);
    try {
      await apiFetch(`/api/returns/${ret.id}/cancel`, { method: "POST" });
      toast({ title: "Retour annulé" });
      refetch(); onRefresh();
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
    finally { setCancelling(false); }
  }

  async function doRefund() {
    if (!ret) return;
    setRefunding(true);
    const amt = refundAmount ? parseFloat(refundAmount) : undefined;
    try {
      await apiFetch(`/api/returns/${ret.id}/refund`, { method: "POST", body: JSON.stringify({ amount: amt }) });
      toast({ title: "Remboursement enregistré" });
      setRefundAmount("");
      refetch(); onRefresh();
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
    finally { setRefunding(false); }
  }

  async function doIssueCredit() {
    if (!ret) return;
    setIssuingCredit(true);
    const amt = creditAmount ? parseFloat(creditAmount) : undefined;
    try {
      await apiFetch(`/api/returns/${ret.id}/issue-credit`, { method: "POST", body: JSON.stringify({ amount: amt }) });
      toast({ title: "Crédit client émis", description: "Le portefeuille client a été crédité." });
      setCreditAmount("");
      refetch(); onRefresh();
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
    finally { setIssuingCredit(false); }
  }

  if (isLoading || !ret) return (
    <div className="flex items-center justify-center h-full py-20">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );

  const canConfirm = ret.status === "draft";
  const canCancel = ret.status === "draft";
  const canRefund = ["confirmed", "partially_refunded"].includes(ret.status) && ret.refundDue > 0;
  const canIssueCredit = ["confirmed", "partially_refunded"].includes(ret.status) && ret.refundDue > 0 && !!ret.customerId;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-base font-bold tracking-wide">{ret.reference}</span>
              <StatusBadge status={ret.status} />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <FileText className="h-3.5 w-3.5" />
                <a className="text-primary underline-offset-2 hover:underline cursor-pointer">{ret.saleReference}</a>
              </span>
              {ret.customerName && <><span>·</span><span className="flex items-center gap-1"><User className="h-3.5 w-3.5" />{ret.customerName}</span></>}
              <span>·</span>
              <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" />{ret.branchName}</span>
              <span>·</span>
              <span>{formatDate(ret.createdAt)}</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline" size="sm" className="gap-1.5 h-8 text-xs"
              onClick={() => {
                if (!ret || !companySettings) return;
                generateSaleReturnPdf({
                  reference: ret.reference, saleReference: ret.saleReference,
                  status: ret.status, reason: ret.reason, notes: ret.notes,
                  createdAt: ret.createdAt, branchName: ret.branchName,
                  customerName: ret.customerName, totalAmount: ret.totalAmount,
                  refundedAmount: ret.refundedAmount, creditAmount: ret.creditAmount,
                  items: ret.items.map(i => ({ productName: i.productName, quantity: i.quantity, unitPrice: i.unitPrice, total: i.total })),
                }, companySettings as any);
              }}
            >
              <FileDown className="h-3.5 w-3.5" />PDF
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose}><X className="h-4 w-4" /></Button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* Info cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border bg-muted/30 p-3 text-center">
            <div className="text-xs text-muted-foreground mb-1">Montant avoir</div>
            <div className="font-bold text-lg">{formatDA(ret.totalAmount)}</div>
          </div>
          <div className="rounded-xl border bg-muted/30 p-3 text-center">
            <div className="text-xs text-muted-foreground mb-1">Remboursé</div>
            <div className="font-bold text-lg text-emerald-700">{formatDA(ret.refundedAmount)}</div>
          </div>
          <div className="rounded-xl border bg-violet-50 p-3 text-center">
            <div className="text-xs text-violet-600 mb-1 flex items-center justify-center gap-1"><Wallet className="h-3 w-3" />Crédit portefeuille</div>
            <div className={`font-bold text-lg ${ret.creditAmount > 0 ? "text-violet-700" : "text-muted-foreground"}`}>{formatDA(ret.creditAmount)}</div>
          </div>
          <div className="rounded-xl border bg-muted/30 p-3 text-center">
            <div className="text-xs text-muted-foreground mb-1">Solde restant</div>
            <div className={`font-bold text-lg ${ret.refundDue > 0 ? "text-amber-700" : "text-muted-foreground"}`}>{formatDA(ret.refundDue)}</div>
          </div>
        </div>

        {/* Reason */}
        {ret.reason && (
          <div className="rounded-xl border bg-amber-50 p-4">
            <div className="text-xs font-semibold text-amber-800 uppercase tracking-wide mb-1">Motif du retour</div>
            <p className="text-sm text-amber-900">{ret.reason}</p>
          </div>
        )}
        {ret.notes && (
          <div className="rounded-xl border bg-muted/20 p-4">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Notes internes</div>
            <p className="text-sm">{ret.notes}</p>
          </div>
        )}

        {/* Items */}
        <div>
          <h3 className="text-sm font-semibold mb-3">Articles retournés</h3>
          <div className="rounded-xl border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead>Produit</TableHead>
                  <TableHead className="text-right w-20">Qté</TableHead>
                  <TableHead className="text-right w-28">P.U.</TableHead>
                  <TableHead className="text-right w-28">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ret.items.map(item => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.productName}</TableCell>
                    <TableCell className="text-right">{item.quantity}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{formatDA(item.unitPrice)}</TableCell>
                    <TableCell className="text-right font-semibold">{formatDA(item.total)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/20 font-semibold">
                  <TableCell colSpan={3}>Total avoir</TableCell>
                  <TableCell className="text-right">{formatDA(ret.totalAmount)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Refund & credit options */}
        {(canRefund || canIssueCredit) && (
          <div className="space-y-3">
            {canRefund && (
              <div className="rounded-xl border p-4 space-y-3">
                <h3 className="text-sm font-semibold flex items-center gap-2"><Banknote className="h-4 w-4 text-emerald-600" />Remboursement en espèces/virement</h3>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder={`Montant (max ${formatDA(ret.refundDue)})`}
                    value={refundAmount}
                    onChange={e => setRefundAmount(e.target.value)}
                    className="flex-1"
                  />
                  <Button onClick={doRefund} disabled={refunding} variant="outline" className="shrink-0 border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                    {refunding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4 mr-1" />}
                    Rembourser
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Laissez vide pour rembourser la totalité du solde restant.</p>
              </div>
            )}
            {canIssueCredit && (
              <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-4 space-y-3">
                <h3 className="text-sm font-semibold flex items-center gap-2 text-violet-800"><Wallet className="h-4 w-4" />Émettre en crédit portefeuille</h3>
                <p className="text-xs text-violet-600">Le client pourra utiliser ce crédit lors de futurs achats, au lieu d'un remboursement immédiat.</p>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder={`Montant (max ${formatDA(ret.refundDue)})`}
                    value={creditAmount}
                    onChange={e => setCreditAmount(e.target.value)}
                    className="flex-1 border-violet-200 focus-visible:ring-violet-400"
                  />
                  <Button onClick={doIssueCredit} disabled={issuingCredit} className="shrink-0 bg-violet-600 hover:bg-violet-700 text-white">
                    {issuingCredit ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
                    Créditer
                  </Button>
                </div>
                <p className="text-xs text-violet-500">Laissez vide pour créditer la totalité du solde restant.</p>
              </div>
            )}
          </div>
        )}

        {/* Meta */}
        <div className="text-xs text-muted-foreground space-y-1">
          {ret.createdByName && <div>Créé par : <span className="font-medium">{ret.createdByName}</span></div>}
          <div>Date de création : <span className="font-medium">{formatDate(ret.createdAt)}</span></div>
        </div>
      </div>

      {/* Action footer */}
      {(canConfirm || canCancel) && (
        <div className="px-6 py-4 border-t shrink-0 flex gap-2 justify-end">
          {canCancel && (
            <Button variant="outline" onClick={doCancel} disabled={cancelling}>
              {cancelling ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <XCircle className="h-4 w-4 mr-1" />}
              Annuler
            </Button>
          )}
          {canConfirm && (
            <Button onClick={doConfirm} disabled={confirming} className="bg-green-600 hover:bg-green-700 text-white">
              {confirming ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
              Confirmer le retour
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/* ── CreateReturnDialog ─────────────────────────────────────────────────── */
function CreateReturnDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [step, setStep] = useState<"select-sale" | "items">("select-sale");
  const [saleSearch, setSaleSearch] = useState("");
  const [selectedSale, setSelectedSale] = useState<SaleSearchResult | null>(null);
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: sales = [], isLoading: salesLoading } = useSaleSearch(saleSearch);
  const { data: returnableData, isLoading: itemsLoading } = useReturnableItems(selectedSale?.id ?? null);

  const returnableItems = returnableData?.items.filter(i => i.canReturn) ?? [];

  function reset() {
    setStep("select-sale");
    setSaleSearch("");
    setSelectedSale(null);
    setQuantities({});
    setReason("");
    setNotes("");
  }

  function handleClose() { reset(); onClose(); }

  function selectSale(sale: SaleSearchResult) {
    setSelectedSale(sale);
    setQuantities({});
    setStep("items");
  }

  const totalAmount = useMemo(() => {
    return returnableItems.reduce((s, item) => {
      const qty = parseFloat(quantities[item.saleItemId] ?? "0") || 0;
      return s + qty * item.unitPrice;
    }, 0);
  }, [quantities, returnableItems]);

  async function handleSubmit() {
    if (!selectedSale || !returnableData) return;
    const items = returnableItems
      .map(item => ({
        saleItemId: item.saleItemId,
        productId: item.productId,
        productName: item.productName,
        quantity: parseFloat(quantities[item.saleItemId] ?? "0") || 0,
        unitPrice: item.unitPrice,
      }))
      .filter(i => i.quantity > 0);
    if (!items.length) { toast({ title: "Sélectionnez au moins un article à retourner", variant: "destructive" }); return; }
    setSubmitting(true);
    try {
      await apiFetch("/api/returns", {
        method: "POST",
        body: JSON.stringify({ saleId: selectedSale.id, reason: reason || null, notes: notes || null, items }),
      });
      toast({ title: "Retour créé", description: "Le brouillon de retour a été enregistré." });
      onCreated();
      handleClose();
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
    finally { setSubmitting(false); }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-muted-foreground" />
            Nouveau retour / avoir
          </DialogTitle>
          {step === "items" && selectedSale && (
            <DialogDescription>
              Retour sur {selectedSale.reference} · {selectedSale.customerName ?? "Comptoir"} · {selectedSale.branchName}
            </DialogDescription>
          )}
        </DialogHeader>

        {step === "select-sale" && (
          <div className="space-y-4">
            <div>
              <Label>Rechercher la facture de vente</Label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Référence (FAC-...) ou nom client..."
                  value={saleSearch}
                  onChange={e => setSaleSearch(e.target.value)}
                  className="pl-9"
                  autoFocus
                />
              </div>
            </div>
            {salesLoading && <div className="text-sm text-center text-muted-foreground py-4"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Chargement...</div>}
            <div className="rounded-xl border overflow-hidden max-h-[40vh] overflow-y-auto">
              {sales.length === 0 && !salesLoading && (
                <div className="p-6 text-center text-sm text-muted-foreground">Aucune vente trouvée</div>
              )}
              {sales.filter(s => s.status !== "cancelled").map(sale => (
                <button
                  key={sale.id}
                  onClick={() => selectSale(sale)}
                  className="w-full flex items-center justify-between p-3 hover:bg-muted/50 text-left border-b last:border-0 transition-colors"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{sale.reference}</span>
                      {sale.customerName && <span className="text-sm text-muted-foreground">{sale.customerName}</span>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{sale.branchName} · {formatDate(sale.createdAt)}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-sm">{formatDA(sale.total)}</div>
                    <div className="text-xs text-muted-foreground">Reste: {formatDA(sale.due)}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === "items" && selectedSale && (
          <div className="space-y-5">
            <Button variant="ghost" size="sm" onClick={() => setStep("select-sale")} className="gap-1 -ml-2 text-muted-foreground">
              <ArrowLeft className="h-3.5 w-3.5" />Changer de vente
            </Button>

            {itemsLoading && <div className="text-sm text-center text-muted-foreground py-6"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Chargement des articles...</div>}

            {!itemsLoading && returnableItems.length === 0 && (
              <div className="text-center py-6 text-sm text-muted-foreground">
                <PackageOpen className="h-8 w-8 mx-auto mb-2 opacity-40" />
                Tous les articles de cette vente ont déjà été retournés.
              </div>
            )}

            {returnableItems.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Articles retournables</h3>
                <div className="rounded-xl border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead>Produit</TableHead>
                        <TableHead className="text-center w-24">Disponible</TableHead>
                        <TableHead className="text-right w-28">P.U.</TableHead>
                        <TableHead className="text-center w-28">Qté à retourner</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {returnableItems.map(item => (
                        <TableRow key={item.saleItemId}>
                          <TableCell className="font-medium">{item.productName}</TableCell>
                          <TableCell className="text-center text-sm">
                            <span className="text-muted-foreground">{item.remainingQuantity}</span>
                            {item.alreadyReturnedQuantity > 0 && (
                              <div className="text-xs text-muted-foreground">({item.alreadyReturnedQuantity} déjà ret.)</div>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">{formatDA(item.unitPrice)}</TableCell>
                          <TableCell className="text-center">
                            <Input
                              type="number"
                              min="0"
                              max={item.remainingQuantity}
                              step="1"
                              className="w-20 text-center mx-auto"
                              value={quantities[item.saleItemId] ?? ""}
                              onChange={e => setQuantities(q => ({ ...q, [item.saleItemId]: e.target.value }))}
                              placeholder="0"
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {totalAmount > 0 && (
                  <div className="flex justify-between items-center px-1">
                    <span className="text-sm text-muted-foreground">Montant total de l'avoir :</span>
                    <span className="font-bold text-lg">{formatDA(totalAmount)}</span>
                  </div>
                )}
              </div>
            )}

            <Separator />

            <div className="space-y-3">
              <div>
                <Label>Motif du retour <span className="text-muted-foreground text-xs">(recommandé)</span></Label>
                <Input
                  className="mt-1"
                  placeholder="Ex: produit endommagé, erreur de commande..."
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                />
              </div>
              <div>
                <Label>Notes internes <span className="text-muted-foreground text-xs">(optionnel)</span></Label>
                <Input
                  className="mt-1"
                  placeholder="Notes pour l'équipe..."
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={handleClose}>Annuler</Button>
              <Button onClick={handleSubmit} disabled={submitting || totalAmount === 0}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RotateCcw className="h-4 w-4 mr-1" />}
                Créer le retour
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Main Page ──────────────────────────────────────────────────────────── */
export default function Returns() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: branches = [] } = useGetBranches();
  const { data: allReturns = [], isLoading, refetch } = useReturns({
    status: statusFilter,
    branchId: branchFilter,
  });

  const displayed = useMemo(() => {
    if (!search) return allReturns;
    const q = search.toLowerCase();
    return allReturns.filter(r =>
      r.reference.toLowerCase().includes(q) ||
      r.saleReference.toLowerCase().includes(q) ||
      (r.customerName ?? "").toLowerCase().includes(q) ||
      (r.reason ?? "").toLowerCase().includes(q)
    );
  }, [allReturns, search]);

  const stats = useMemo(() => ({
    total: allReturns.length,
    draft: allReturns.filter(r => r.status === "draft").length,
    confirmed: allReturns.filter(r => r.status === "confirmed").length,
    refunded: allReturns.filter(r => ["refunded", "partially_refunded"].includes(r.status)).length,
    totalAmount: allReturns.filter(r => r.status !== "cancelled").reduce((s, r) => s + r.totalAmount, 0),
  }), [allReturns]);

  return (
    <div className="h-full flex flex-col">
      {/* Page header */}
      <div className="px-6 py-5 border-b">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-muted-foreground" />
              Retours &amp; Avoirs
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">Gestion des retours de ventes et notes de crédit clients</p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />Nouveau retour
          </Button>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[
            { label: "Total", value: stats.total, cls: "text-foreground" },
            { label: "Brouillons", value: stats.draft, cls: "text-gray-600" },
            { label: "Confirmés", value: stats.confirmed, cls: "text-green-700" },
            { label: "Remboursés", value: stats.refunded, cls: "text-emerald-700" },
          ].map(s => (
            <div key={s.label} className="rounded-xl border bg-muted/20 p-3 text-center">
              <div className={`text-2xl font-bold ${s.cls}`}>{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex gap-3 items-center">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Référence, vente, client..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Statut" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les statuts</SelectItem>
              <SelectItem value="draft">Brouillons</SelectItem>
              <SelectItem value="confirmed">Confirmés</SelectItem>
              <SelectItem value="partially_refunded">Partiellement remb.</SelectItem>
              <SelectItem value="refunded">Remboursés</SelectItem>
              <SelectItem value="cancelled">Annulés</SelectItem>
            </SelectContent>
          </Select>
          {branches.length > 1 && (
            <Select value={branchFilter} onValueChange={setBranchFilter}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Boutique" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes les boutiques</SelectItem>
                {branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />Chargement...
          </div>
        )}
        {!isLoading && displayed.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <PackageOpen className="h-12 w-12 mb-3 opacity-30" />
            <p className="font-medium">Aucun retour trouvé</p>
            <p className="text-sm mt-1">Créez un retour à partir d'une facture de vente existante.</p>
            <Button className="mt-4" variant="outline" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />Nouveau retour
            </Button>
          </div>
        )}
        {!isLoading && displayed.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="w-28">Référence</TableHead>
                <TableHead>Vente d'origine</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Boutique</TableHead>
                <TableHead>Motif</TableHead>
                <TableHead className="text-right">Montant</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayed.map(ret => (
                <TableRow
                  key={ret.id}
                  className={`cursor-pointer hover:bg-muted/40 transition-colors ${selectedId === ret.id ? "bg-primary/5 border-l-2 border-l-primary" : ""}`}
                  onClick={() => setSelectedId(ret.id)}
                >
                  <TableCell className="font-mono text-xs font-bold tracking-wide">{ret.reference}</TableCell>
                  <TableCell className="font-mono text-xs text-primary">{ret.saleReference}</TableCell>
                  <TableCell className="text-sm">{ret.customerName ?? <span className="text-muted-foreground italic">Comptoir</span>}</TableCell>
                  <TableCell className="text-sm">{ret.branchName}</TableCell>
                  <TableCell className="text-sm max-w-[180px] truncate text-muted-foreground" title={ret.reason ?? ""}>
                    {ret.reason ?? <span className="italic">—</span>}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatDA(ret.totalAmount)}</TableCell>
                  <TableCell><StatusBadge status={ret.status} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(ret.createdAt)}</TableCell>
                  <TableCell><ChevronRight className="h-4 w-4 text-muted-foreground" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Detail Sheet */}
      <Sheet open={selectedId != null} onOpenChange={open => { if (!open) setSelectedId(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col" onOpenAutoFocus={e => e.preventDefault()}>
          {selectedId && (
            <ReturnDetailPanel
              returnId={selectedId}
              onClose={() => setSelectedId(null)}
              onRefresh={() => refetch()}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Create Dialog */}
      <CreateReturnDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => { refetch(); qc.invalidateQueries({ queryKey: ["returns"] }); }}
      />
    </div>
  );
}
