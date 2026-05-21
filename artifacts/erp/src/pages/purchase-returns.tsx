import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useGetBranches, useGetContacts, useGetProducts } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import {
  Clock, CheckCircle2, XCircle, AlertCircle, Plus, Search,
  Undo2, ChevronRight, FileDown, Trash2, X
} from "lucide-react";

/* ── Types ───────────────────────────────────────────────────────────────── */
interface PurchaseReturn {
  id: number; reference: string; purchaseId: number | null; purchaseReference: string | null;
  branchId: number; branchName: string | null; supplierId: number; supplierName: string | null;
  status: string; reason: string | null; notes: string | null;
  totalAmount: number; createdByName: string | null;
  confirmedAt: string | null; createdAt: string; updatedAt: string;
  items: PurchaseReturnItem[];
}
interface PurchaseReturnItem {
  id: number; productId: number; productName: string | null; productReference: string | null;
  unitName: string | null; purchaseItemId: number | null;
  quantity: number; unitCost: number; totalAmount: number; reason: string | null;
}
interface PurchaseListItem {
  id: number; reference: string; supplierId: number; supplierName: string | null;
  branchId: number; branchName: string | null; status: string; total: number;
  createdAt: string;
}
interface PurchaseItemDetail {
  id: number; productId: number; productName: string | null; unitName: string | null;
  quantity: number; receivedQuantity: number; rejectedQuantity: number; unitCost: number;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function formatDA(n: number) { return new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(n) + " DA"; }
function formatDate(s: string | null | undefined) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("fr-DZ", { day: "numeric", month: "short", year: "numeric" });
}
function authHeaders() { return { Authorization: `Bearer ${localStorage.getItem("erp_token") ?? ""}` }; }
async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...opts, headers: { "Content-Type": "application/json", ...authHeaders(), ...(opts?.headers ?? {}) } });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any).error ?? "Erreur"); }
  return r.json();
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  draft:     { label: "Brouillon",  cls: "bg-gray-100 text-gray-700" },
  confirmed: { label: "Confirmé",   cls: "bg-green-100 text-green-700" },
  cancelled: { label: "Annulé",     cls: "bg-red-100 text-red-700" },
};
function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, cls: "bg-gray-100 text-gray-600" };
  return <Badge className={`${m.cls} border-0 text-xs font-medium`}>{m.label}</Badge>;
}

/* ── Hooks ───────────────────────────────────────────────────────────────── */
function usePurchaseReturns(filters: Record<string, string>) {
  const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v && v !== "all"));
  return useQuery<PurchaseReturn[]>({ queryKey: ["purchase-returns", filters], queryFn: () => apiFetch(`/api/purchase-returns?${params}`) });
}
function usePurchaseReturnDetail(id: number | null) {
  return useQuery<PurchaseReturn>({ queryKey: ["purchase-returns", id], queryFn: () => apiFetch(`/api/purchase-returns/${id}`), enabled: !!id });
}
function usePurchaseList(params: Record<string, string>) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v && v !== "all"));
  return useQuery<PurchaseListItem[]>({ queryKey: ["purchases-for-returns", params], queryFn: () => apiFetch(`/api/purchases?${qs}`) });
}
function usePurchaseItems(purchaseId: number | null) {
  return useQuery<{ items: PurchaseItemDetail[] }>({
    queryKey: ["purchase-items-detail", purchaseId],
    queryFn: () => apiFetch(`/api/purchases/${purchaseId}`),
    enabled: !!purchaseId,
    select: (data: any) => data,
  });
}

/* ── Detail Sheet ────────────────────────────────────────────────────────── */
function ReturnDetailSheet({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: ret, isLoading } = usePurchaseReturnDetail(id);

  const confirmMutation = useMutation({
    mutationFn: () => apiFetch(`/api/purchase-returns/${id}/confirm`, { method: "POST" }),
    onSuccess: () => { toast({ title: "Retour confirmé", description: "Stock mis à jour." }); qc.invalidateQueries({ queryKey: ["purchase-returns"] }); },
    onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });
  const cancelMutation = useMutation({
    mutationFn: () => apiFetch(`/api/purchase-returns/${id}/cancel`, { method: "POST" }),
    onSuccess: () => { toast({ title: "Retour annulé" }); qc.invalidateQueries({ queryKey: ["purchase-returns"] }); },
    onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  return (
    <Sheet open onOpenChange={() => onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <Undo2 className="h-4 w-4 text-indigo-500" />
            <span className="font-semibold">{ret?.reference ?? "..."}</span>
            {ret && <StatusBadge status={ret.status} />}
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Chargement…</div>
        ) : !ret ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Retour introuvable</div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-muted-foreground mb-0.5">Fournisseur</p><p className="font-medium">{ret.supplierName ?? "—"}</p></div>
              <div><p className="text-xs text-muted-foreground mb-0.5">Succursale</p><p className="font-medium">{ret.branchName ?? "—"}</p></div>
              <div><p className="text-xs text-muted-foreground mb-0.5">Achat lié</p><p className="font-medium">{ret.purchaseReference ?? "—"}</p></div>
              <div><p className="text-xs text-muted-foreground mb-0.5">Date</p><p className="font-medium">{formatDate(ret.createdAt)}</p></div>
              {ret.reason && <div className="col-span-2"><p className="text-xs text-muted-foreground mb-0.5">Motif</p><p>{ret.reason}</p></div>}
              {ret.notes && <div className="col-span-2"><p className="text-xs text-muted-foreground mb-0.5">Notes</p><p className="text-muted-foreground">{ret.notes}</p></div>}
            </div>

            <Separator />

            <div>
              <p className="text-sm font-medium mb-3">Articles retournés</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produit</TableHead>
                    <TableHead className="text-right">Qté</TableHead>
                    <TableHead className="text-right">P.U. Achat</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ret.items.map(item => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <p className="text-sm font-medium">{item.productName}</p>
                        {item.reason && <p className="text-xs text-muted-foreground">{item.reason}</p>}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">{item.quantity.toFixed(3)}</TableCell>
                      <TableCell className="text-right text-sm">{formatDA(item.unitCost)}</TableCell>
                      <TableCell className="text-right font-medium">{formatDA(item.totalAmount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-3 text-right">
                <span className="text-sm text-muted-foreground">Total retourné : </span>
                <span className="font-bold text-lg">{formatDA(ret.totalAmount)}</span>
              </div>
            </div>
          </div>
        )}

        {ret && ret.status === "draft" && (
          <div className="border-t p-4 flex gap-2 justify-end">
            <Button variant="outline" className="text-red-600 border-red-200" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
              Annuler le retour
            </Button>
            <Button onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending} className="bg-green-600 hover:bg-green-700">
              <CheckCircle2 className="h-4 w-4 mr-1" />
              Confirmer (ajuste le stock)
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ── Create Return Dialog ─────────────────────────────────────────────────── */
interface CreateLineItem {
  productId: number; productName: string; unitName: string; purchaseItemId: number | null;
  quantity: number; maxQuantity: number; unitCost: number; reason: string;
}

function CreateReturnDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: contacts = [] } = useGetContacts({ type: "supplier" });
  const { data: branches = [] } = useGetBranches();
  const { data: products = [] } = useGetProducts();

  const [step, setStep] = useState<"select" | "items">("select");
  const [branchId, setBranchId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [purchaseSearch, setPurchaseSearch] = useState("");
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<CreateLineItem[]>([]);
  const [freeProductId, setFreeProductId] = useState("");
  const [freeQty, setFreeQty] = useState("");
  const [freeUnitCost, setFreeUnitCost] = useState("");

  const { data: purchasesData = [] } = usePurchaseList({ status: "received,partial", supplierId });
  const { data: purchaseDetail } = usePurchaseItems(selectedPurchaseId);

  const filteredPurchases = purchasesData.filter(p =>
    (!purchaseSearch || p.reference.toLowerCase().includes(purchaseSearch.toLowerCase()))
  );

  function loadPurchaseItems() {
    if (!purchaseDetail || !selectedPurchaseId) return;
    const purchase = purchasesData.find(p => p.id === selectedPurchaseId);
    const items = (purchaseDetail as any).items ?? [];
    const newLines: CreateLineItem[] = items
      .filter((i: any) => parseFloat(i.receivedQuantity ?? "0") > 0)
      .map((i: any) => ({
        productId: i.productId,
        productName: i.productName ?? `Produit #${i.productId}`,
        unitName: i.unitName ?? "",
        purchaseItemId: i.id,
        quantity: 0,
        maxQuantity: parseFloat(i.receivedQuantity ?? "0"),
        unitCost: parseFloat(i.unitCost ?? "0"),
        reason: "",
      }));
    if (purchase) setSupplierId(String(purchase.supplierId));
    if (purchase) setBranchId(String(purchase.branchId));
    setLines(newLines);
    setStep("items");
  }

  function addFreeLine() {
    const pid = parseInt(freeProductId, 10);
    const product = (products as any[]).find(p => p.id === pid);
    if (!pid || !freeQty || !freeUnitCost) return;
    setLines(prev => [...prev, {
      productId: pid, productName: product?.name ?? `Produit #${pid}`,
      unitName: product?.unitName ?? "", purchaseItemId: null,
      quantity: parseFloat(freeQty), maxQuantity: 999999,
      unitCost: parseFloat(freeUnitCost), reason: "",
    }]);
    setFreeProductId(""); setFreeQty(""); setFreeUnitCost("");
  }

  const createMutation = useMutation({
    mutationFn: () => {
      const validLines = lines.filter(l => l.quantity > 0);
      if (!validLines.length) throw new Error("Aucune quantité saisie");
      if (!branchId || !supplierId) throw new Error("Succursale et fournisseur requis");
      return apiFetch("/api/purchase-returns", {
        method: "POST",
        body: JSON.stringify({
          purchaseId: selectedPurchaseId,
          branchId: parseInt(branchId, 10),
          supplierId: parseInt(supplierId, 10),
          reason: reason || undefined,
          notes: notes || undefined,
          items: validLines.map(l => ({
            productId: l.productId,
            purchaseItemId: l.purchaseItemId,
            quantity: l.quantity,
            unitCost: l.unitCost,
            reason: l.reason || undefined,
          })),
        }),
      });
    },
    onSuccess: () => {
      toast({ title: "Retour créé", description: "Le retour fournisseur a été enregistré." });
      qc.invalidateQueries({ queryKey: ["purchase-returns"] });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const totalAmount = lines.reduce((s, l) => s + l.quantity * l.unitCost, 0);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="h-5 w-5 text-indigo-500" />
            Nouveau retour fournisseur
          </DialogTitle>
        </DialogHeader>

        {step === "select" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Cherchez un bon de commande reçu ou créez un retour libre.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Succursale</Label>
                <Select value={branchId} onValueChange={setBranchId}>
                  <SelectTrigger><SelectValue placeholder="Choisir..." /></SelectTrigger>
                  <SelectContent>{(branches as any[]).map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Fournisseur</Label>
                <Select value={supplierId} onValueChange={v => { setSupplierId(v); setSelectedPurchaseId(null); }}>
                  <SelectTrigger><SelectValue placeholder="Choisir..." /></SelectTrigger>
                  <SelectContent>{(contacts as any[]).filter(c => c.type === "supplier" || c.type === "both").map(c => <SelectItem key={c.id} value={String(c.id)}>{c.displayName}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            {supplierId && (
              <div>
                <Label className="mb-1 block">Lier à un bon de commande (optionnel)</Label>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-9" placeholder="Chercher par référence..." value={purchaseSearch} onChange={e => setPurchaseSearch(e.target.value)} />
                </div>
                <div className="border rounded-lg divide-y max-h-48 overflow-y-auto">
                  {filteredPurchases.length === 0 ? (
                    <p className="text-sm text-center text-muted-foreground py-4">Aucune commande reçue trouvée</p>
                  ) : filteredPurchases.map(p => (
                    <button
                      key={p.id}
                      onClick={() => setSelectedPurchaseId(prev => prev === p.id ? null : p.id)}
                      className={`w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-muted/40 transition-colors ${selectedPurchaseId === p.id ? "bg-indigo-50" : ""}`}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${selectedPurchaseId === p.id ? "bg-indigo-500" : "bg-gray-300"}`} />
                        <span className="font-mono font-medium">{p.reference}</span>
                        <span className="text-muted-foreground">{formatDate(p.createdAt)}</span>
                      </div>
                      <span className="font-medium">{formatDA(p.total)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>Annuler</Button>
              <Button
                onClick={() => {
                  if (selectedPurchaseId) { loadPurchaseItems(); }
                  else if (branchId && supplierId) { setStep("items"); }
                  else { toast({ title: "Sélection requise", description: "Veuillez choisir une succursale et un fournisseur.", variant: "destructive" }); }
                }}
              >
                {selectedPurchaseId ? "Charger les articles" : "Continuer sans achat"} <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {step === "items" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Indiquez les quantités à retourner pour chaque article.</p>
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => setStep("select")}>← Retour</Button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Motif général</Label>
                <Input placeholder="Ex: Produits défectueux" value={reason} onChange={e => setReason(e.target.value)} />
              </div>
              <div>
                <Label>Notes internes</Label>
                <Input placeholder="Remarques..." value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
            </div>

            <Separator />

            {lines.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Articles de la commande</p>
                {lines.map((line, idx) => (
                  <div key={idx} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{line.productName}</p>
                        <p className="text-xs text-muted-foreground">Max retournable : {line.maxQuantity.toFixed(3)} {line.unitName}</p>
                      </div>
                      <p className="text-sm font-medium">{formatDA(line.unitCost)}/u</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">Quantité à retourner</Label>
                        <Input
                          type="number" min={0} max={line.maxQuantity} step="0.001"
                          value={line.quantity || ""}
                          onChange={e => {
                            const v = Math.min(parseFloat(e.target.value) || 0, line.maxQuantity);
                            setLines(prev => prev.map((l, i) => i === idx ? { ...l, quantity: v } : l));
                          }}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Motif (optionnel)</Label>
                        <Input
                          placeholder="Ex: Abîmé"
                          value={line.reason}
                          onChange={e => setLines(prev => prev.map((l, i) => i === idx ? { ...l, reason: e.target.value } : l))}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="border rounded-lg p-3 space-y-3">
              <p className="text-sm font-medium text-muted-foreground">Ajouter un article libre</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-1">
                  <Select value={freeProductId} onValueChange={setFreeProductId}>
                    <SelectTrigger><SelectValue placeholder="Produit..." /></SelectTrigger>
                    <SelectContent>{(products as any[]).map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <Input type="number" placeholder="Qté" min={0} step="0.001" value={freeQty} onChange={e => setFreeQty(e.target.value)} />
                <Input type="number" placeholder="P.U. Achat" min={0} step="0.01" value={freeUnitCost} onChange={e => setFreeUnitCost(e.target.value)} />
              </div>
              <Button variant="outline" size="sm" onClick={addFreeLine} disabled={!freeProductId || !freeQty || !freeUnitCost}>
                <Plus className="h-4 w-4 mr-1" /> Ajouter
              </Button>
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="text-sm">
                <span className="text-muted-foreground">Total retour : </span>
                <span className="font-bold text-lg">{formatDA(totalAmount)}</span>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose}>Annuler</Button>
                <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
                  Enregistrer le retour
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Main Page ───────────────────────────────────────────────────────────── */
export default function PurchaseReturnsPage() {
  const { data: branches = [] } = useGetBranches();
  const { data: contacts = [] } = useGetContacts({ type: "supplier" });

  const [branchFilter, setBranchFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: returns = [], isLoading } = usePurchaseReturns({
    branchId: branchFilter, status: statusFilter, supplierId: supplierFilter,
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <div className="flex items-center gap-2">
          <Undo2 className="h-5 w-5 text-indigo-500" />
          <h1 className="text-lg font-semibold">Retours fournisseurs</h1>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Nouveau retour
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 px-6 py-3 border-b bg-muted/30 flex-wrap">
        <Select value={branchFilter} onValueChange={setBranchFilter}>
          <SelectTrigger className="h-8 text-xs w-36"><SelectValue placeholder="Succursale" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes les succursales</SelectItem>
            {(branches as any[]).map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={supplierFilter} onValueChange={setSupplierFilter}>
          <SelectTrigger className="h-8 text-xs w-40"><SelectValue placeholder="Fournisseur" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les fournisseurs</SelectItem>
            {(contacts as any[]).filter(c => c.type === "supplier" || c.type === "both").map(c => <SelectItem key={c.id} value={String(c.id)}>{c.displayName}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 text-xs w-32"><SelectValue placeholder="Statut" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les statuts</SelectItem>
            <SelectItem value="draft">Brouillon</SelectItem>
            <SelectItem value="confirmed">Confirmé</SelectItem>
            <SelectItem value="cancelled">Annulé</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">Chargement…</div>
        ) : returns.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
            <Undo2 className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm">Aucun retour fournisseur trouvé</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setCreateOpen(true)}>Créer le premier retour</Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Référence</TableHead>
                <TableHead>Fournisseur</TableHead>
                <TableHead>Succursale</TableHead>
                <TableHead>Achat lié</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Montant</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {returns.map(r => (
                <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setSelectedId(r.id)}>
                  <TableCell className="font-mono text-sm font-medium">{r.reference}</TableCell>
                  <TableCell>{r.supplierName ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.branchName ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{(r as any).purchaseReference ?? "—"}</TableCell>
                  <TableCell><StatusBadge status={r.status} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(r.createdAt)}</TableCell>
                  <TableCell className="text-right font-medium">{formatDA(typeof r.totalAmount === "number" ? r.totalAmount : parseFloat(r.totalAmount as string))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {selectedId && <ReturnDetailSheet id={selectedId} onClose={() => setSelectedId(null)} />}
      {createOpen && <CreateReturnDialog onClose={() => setCreateOpen(false)} />}
    </div>
  );
}
