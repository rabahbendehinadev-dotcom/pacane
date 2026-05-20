import { useState } from "react";
import { ExportButton } from "@/components/ExportButton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useGetBranches, useGetProducts, getGetTransfersQueryKey, getGetStockLevelsQueryKey, useGetCompanySettings } from "@workspace/api-client-react";
import { generateTransferPdf } from "@/lib/pdf-generator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ChevronsUpDown, Check } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Plus, ArrowRight, CheckCircle, Trash2, Send, X, Package,
  Building2, Calendar, User, FileText, AlertTriangle, ArrowRightLeft,
  ClipboardCheck, Clock, ChevronRight, Loader2, FileDown, Pencil,
} from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";

// ── Types ─────────────────────────────────────────────────────────────────────

type TransferItem = { productId: number; productName: string; quantity: string };

type TransferFull = {
  id: number; reference: string; sourceBranchId: number; destinationBranchId: number;
  sourceBranchName: string; destinationBranchName: string; status: string;
  notes: string | null; createdByName: string | null; receivedByName?: string | null; itemCount: number;
  createdAt: string; sentAt?: string; receivedAt?: string;
  items?: Array<{ id: number; productId: number; productName: string; unitName: string; quantity: number; receivedQuantity: number }>;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { label: string; variant: string; icon: React.ReactNode }> = {
  draft:              { label: "Brouillon",           variant: "bg-gray-100 text-gray-700 border-gray-200",       icon: <FileText className="h-3 w-3" /> },
  sent:               { label: "Envoyé",              variant: "bg-blue-100 text-blue-700 border-blue-200",        icon: <Send className="h-3 w-3" /> },
  partially_received: { label: "Partiellement reçu",  variant: "bg-amber-100 text-amber-700 border-amber-200",     icon: <Clock className="h-3 w-3" /> },
  received:           { label: "Reçu",                variant: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: <CheckCircle className="h-3 w-3" /> },
  cancelled:          { label: "Annulé",              variant: "bg-red-100 text-red-700 border-red-200",            icon: <X className="h-3 w-3" /> },
};

const TABS = [
  { key: "all",               label: "Tous" },
  { key: "draft",             label: "Brouillons" },
  { key: "sent",              label: "Envoyés" },
  { key: "partially_received",label: "Partiel" },
  { key: "received",          label: "Reçus" },
  { key: "cancelled",         label: "Annulés" },
];

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? { label: status, variant: "bg-gray-100 text-gray-700 border-gray-200", icon: null };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${s.variant}`}>
      {s.icon}{s.label}
    </span>
  );
}

async function apiCall(path: string, method = "GET", body?: unknown) {
  const r = await fetch(`/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: "Erreur serveur" }));
    const e: any = new Error(err?.message ?? err?.error ?? "Erreur serveur");
    e.data = err;
    throw e;
  }
  return r.json();
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function Transfers() {
  const qc = useQueryClient();

  // State
  const [tab, setTab] = useState("all");
  const [filterSource, setFilterSource] = useState("all");
  const [filterDest, setFilterDest] = useState("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingTransferId, setEditingTransferId] = useState<number | null>(null);

  // Create form state
  const [form, setForm] = useState({ sourceBranchId: "", destinationBranchId: "", notes: "" });
  const [formItems, setFormItems] = useState<TransferItem[]>([]);
  const [newItem, setNewItem] = useState({ productId: "", quantity: "" });
  const [transferProductComboOpen, setTransferProductComboOpen] = useState(false);

  // Receive dialog state
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiveQtys, setReceiveQtys] = useState<Record<number, string>>({});

  // Stock shortages state
  const [shortageOpen, setShortageOpen] = useState(false);
  const [shortages, setShortages] = useState<Array<{ productName: string; required: number; available: number }>>([]);

  // Auth
  const { user: authUser } = useAuth();
  const isAdmin = (authUser as any)?.adminAccess === true;
  const myBranchIds: number[] = (authUser as any)?.branchIds ?? [];

  function canAccessBranch(branchId: number) {
    return isAdmin || myBranchIds.includes(branchId);
  }

  // Data
  const { data: branches = [] } = useGetBranches();
  const { data: products = [] } = useGetProducts({});
  const { data: companySettings } = useGetCompanySettings();

  const { data: allTransfers = [], isLoading } = useQuery<TransferFull[]>({
    queryKey: getGetTransfersQueryKey(),
    queryFn: () => apiCall("/transfers"),
  });

  const { data: detail } = useQuery<TransferFull>({
    queryKey: ["transfer", selectedId],
    queryFn: () => apiCall(`/transfers/${selectedId}`),
    enabled: !!selectedId,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: getGetTransfersQueryKey() });
    qc.invalidateQueries({ queryKey: getGetStockLevelsQueryKey() });
    if (selectedId) qc.invalidateQueries({ queryKey: ["transfer", selectedId] });
  }

  const [validating, setValidating] = useState(false);

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: unknown) => apiCall("/transfers", "POST", data),
    onSuccess: (res) => {
      if (res.error) { toast({ title: res.error, variant: "destructive" }); return; }
      invalidate(); setCreateOpen(false); resetForm();
      toast({ title: "Transfert créé en brouillon", description: res.reference });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: unknown }) => apiCall(`/transfers/${id}`, "PUT", data),
    onSuccess: (res) => {
      invalidate(); setCreateOpen(false); resetForm();
      toast({ title: "Brouillon mis à jour", description: res.reference });
    },
    onError: (e: any) => toast({ title: e?.message ?? "Erreur", variant: "destructive" }),
  });

  async function validateDirect() {
    if (!form.sourceBranchId || !form.destinationBranchId || formItems.length === 0) return;
    setValidating(true);
    let createdId: number | null = null;
    try {
      // 1. Créer le brouillon
      const created = await apiCall("/transfers", "POST", {
        sourceBranchId: parseInt(form.sourceBranchId),
        destinationBranchId: parseInt(form.destinationBranchId),
        notes: form.notes || null,
        items: formItems.map(i => ({ productId: i.productId, quantity: parseFloat(i.quantity) })),
      });
      createdId = created.id;

      // 2. Envoyer seulement (déduit du stock source, attend validation de la destination)
      await apiCall(`/transfers/${created.id}/send`, "POST");

      invalidate(); setCreateOpen(false); resetForm();
      toast({ title: "Transfert envoyé", description: `${created.reference} — en attente de réception par la boutique destination` });
    } catch (e: any) {
      // Annuler le brouillon si déjà créé
      if (createdId) await apiCall(`/transfers/${createdId}/cancel`, "POST").catch(() => {});
      invalidate();
      if (e?.data?.error === "stock_insufficient") {
        setShortages(e.data.shortages ?? []); setShortageOpen(true);
      } else {
        toast({ title: e?.message ?? "Erreur", variant: "destructive" });
      }
    } finally {
      setValidating(false);
    }
  }

  const sendMutation = useMutation({
    mutationFn: (id: number) => apiCall(`/transfers/${id}/send`, "POST"),
    onSuccess: () => {
      invalidate();
      toast({ title: "Transfert envoyé", description: "Stock déduit de la boutique source" });
    },
    onError: (e: any) => {
      if (e?.data?.error === "stock_insufficient") {
        setShortages(e.data.shortages ?? []); setShortageOpen(true); return;
      }
      toast({ title: e?.message ?? "Erreur lors de l'envoi", variant: "destructive" });
    },
  });

  const receiveMutation = useMutation({
    mutationFn: ({ id, items }: { id: number; items: Array<{ itemId: number; receivedQuantity: number }> }) =>
      apiCall(`/transfers/${id}/receive`, "POST", { items }),
    onSuccess: (res) => {
      invalidate(); setReceiveOpen(false);
      const label = res.status === "received" ? "Transfert entièrement reçu" : "Réception partielle enregistrée";
      toast({ title: label, description: res.reference });
    },
    onError: (e: any) => {
      toast({ title: e?.message ?? "Erreur lors de la réception", variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => apiCall(`/transfers/${id}/cancel`, "POST"),
    onSuccess: (res) => {
      invalidate();
      toast({ title: "Transfert annulé", description: res.reference });
    },
    onError: (e: any) => {
      toast({ title: e?.message ?? "Erreur lors de l'annulation", variant: "destructive" });
    },
  });

  // Helpers
  function resetForm() {
    setForm({ sourceBranchId: "", destinationBranchId: "", notes: "" });
    setFormItems([]);
    setNewItem({ productId: "", quantity: "" });
    setEditingTransferId(null);
  }

  function openEditDraft(t: TransferFull) {
    setForm({ sourceBranchId: String(t.sourceBranchId), destinationBranchId: String(t.destinationBranchId), notes: t.notes ?? "" });
    setFormItems((t.items ?? []).map(i => ({ productId: i.productId, productName: i.productName, quantity: String(i.quantity) })));
    setNewItem({ productId: "", quantity: "" });
    setEditingTransferId(t.id);
    setCreateOpen(true);
  }


  function addFormItem() {
    if (!newItem.productId || !newItem.quantity) return;
    const product = products.find(p => p.id === parseInt(newItem.productId));
    if (!product) return;
    setFormItems(i => [...i, { productId: parseInt(newItem.productId), productName: product.name, quantity: newItem.quantity }]);
    setNewItem({ productId: "", quantity: "" });
  }

  function submitCreate() {
    if (!form.sourceBranchId || !form.destinationBranchId || formItems.length === 0) return;
    const payload = {
      sourceBranchId: parseInt(form.sourceBranchId),
      destinationBranchId: parseInt(form.destinationBranchId),
      notes: form.notes || null,
      items: formItems.map(i => ({ productId: i.productId, quantity: parseFloat(i.quantity) })),
    };
    if (editingTransferId) {
      updateMutation.mutate({ id: editingTransferId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  function openReceive(t: TransferFull) {
    if (!t.items) return;
    const init: Record<number, string> = {};
    t.items.forEach(item => {
      const remaining = item.quantity - item.receivedQuantity;
      init[item.id] = remaining > 0 ? remaining.toString() : "0";
    });
    setReceiveQtys(init);
    setReceiveOpen(true);
  }

  function submitReceive() {
    if (!detail) return;
    const items = (detail.items ?? []).map(item => ({
      itemId: item.id,
      receivedQuantity: parseFloat(receiveQtys[item.id] ?? "0") || 0,
    }));
    receiveMutation.mutate({ id: detail.id, items });
  }

  // Filtered list
  const filtered = allTransfers.filter(t => {
    if (tab !== "all" && t.status !== tab) return false;
    if (filterSource !== "all" && String(t.sourceBranchId) !== filterSource) return false;
    if (filterDest !== "all" && String(t.destinationBranchId) !== filterDest) return false;
    return true;
  });

  const counts = TABS.reduce((acc, t) => {
    acc[t.key] = t.key === "all" ? allTransfers.length : allTransfers.filter(x => x.status === t.key).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* ── Left Panel ── */}
      <div className={`flex flex-col flex-1 min-w-0 ${selectedId ? "hidden md:flex" : "flex"}`}>
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b bg-background flex items-start justify-between shrink-0">
          <div>
            <h1 className="text-2xl font-serif font-bold flex items-center gap-2">
              <ArrowRightLeft className="h-6 w-6 text-indigo-600" />
              Transferts inter-boutiques
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">Mouvements de stock entre boutiques et entrepôts</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <ExportButton
              endpoint="export/transfers"
              params={{
                sourceBranchId: filterSource !== "all" ? filterSource : undefined,
                destinationBranchId: filterDest !== "all" ? filterDest : undefined,
                status: tab !== "all" ? tab : undefined,
              }}
              label="Exporter"
            />
            <Button onClick={() => { resetForm(); setCreateOpen(true); }} className="gap-2">
              <Plus className="h-4 w-4" />Nouveau transfert
            </Button>
          </div>
        </div>

        {/* Status Tabs */}
        <div className="px-6 pt-3 pb-0 border-b bg-background shrink-0">
          <div className="flex gap-1 overflow-x-auto pb-0">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                  tab === t.key
                    ? "border-indigo-600 text-indigo-700"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
                {counts[t.key] > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                    tab === t.key ? "bg-indigo-100 text-indigo-700" : "bg-muted text-muted-foreground"
                  }`}>{counts[t.key]}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="px-6 py-3 border-b bg-muted/30 flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">Source:</span>
            <Select value={filterSource} onValueChange={setFilterSource}>
              <SelectTrigger className="h-7 text-xs w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes</SelectItem>
                {branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">Dest.:</span>
            <Select value={filterDest} onValueChange={setFilterDest}>
              <SelectTrigger className="h-7 text-xs w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes</SelectItem>
                {branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {(filterSource !== "all" || filterDest !== "all") && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => { setFilterSource("all"); setFilterDest("all"); }}>
              <X className="h-3 w-3 mr-1" />Effacer
            </Button>
          )}
          <span className="ml-auto text-xs text-muted-foreground">{filtered.length} transfert{filtered.length !== 1 ? "s" : ""}</span>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead className="w-40">Référence</TableHead>
                <TableHead>Trajet</TableHead>
                <TableHead className="w-24 text-center">Articles</TableHead>
                <TableHead className="w-36">Date</TableHead>
                <TableHead className="w-20">Créé par</TableHead>
                <TableHead className="w-40">Statut</TableHead>
                <TableHead className="w-24">Réceptionné par</TableHead>
                <TableHead className="w-8"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-16 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />Chargement...
                </TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-16 text-muted-foreground">
                  <ArrowRightLeft className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Aucun transfert trouvé</p>
                </TableCell></TableRow>
              ) : filtered.map(t => (
                <TableRow
                  key={t.id}
                  className={`cursor-pointer hover:bg-muted/40 transition-colors ${selectedId === t.id ? "bg-indigo-50/60" : ""}`}
                  onClick={() => setSelectedId(t.id)}
                >
                  <TableCell className="font-mono text-xs text-muted-foreground">{t.reference}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium max-w-[120px] truncate">{t.sourceBranchName}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="font-medium max-w-[120px] truncate">{t.destinationBranchName}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="inline-flex items-center gap-1 text-sm font-medium">
                      <Package className="h-3.5 w-3.5 text-muted-foreground" />
                      {t.itemCount}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(t.createdAt), "d MMM yyyy", { locale: fr })}
                    {t.sentAt && <div className="text-xs mt-0.5">Envoyé {format(new Date(t.sentAt), "d MMM", { locale: fr })}</div>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{t.createdByName ? t.createdByName.split(" ")[0] : "—"}</TableCell>
                  <TableCell><StatusBadge status={t.status} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {(t as any).receivedByName ? (t as any).receivedByName.split(" ")[0] : "—"}
                  </TableCell>
                  <TableCell><ChevronRight className="h-4 w-4 text-muted-foreground" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* ── Detail Sheet (right panel) ── */}
      {selectedId && detail && (
        <div className="w-[480px] shrink-0 border-l bg-background flex flex-col overflow-hidden">
          {/* Detail Header */}
          <div className="px-5 py-4 border-b flex items-start justify-between shrink-0">
            <div>
              <p className="font-mono text-xs text-muted-foreground">{detail.reference}</p>
              <div className="flex items-center gap-2 mt-1">
                <StatusBadge status={detail.status} />
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline" size="sm" className="gap-1.5 h-8 text-xs"
                onClick={() => {
                  if (!detail || !companySettings) return;
                  generateTransferPdf({
                    reference: detail.reference, status: detail.status,
                    createdAt: detail.createdAt, sentAt: detail.sentAt ?? null,
                    receivedAt: detail.receivedAt ?? null,
                    sourceBranchName: detail.sourceBranchName, destinationBranchName: detail.destinationBranchName,
                    createdByName: detail.createdByName ?? null, notes: detail.notes ?? null,
                    items: (detail.items ?? []).map(i => ({
                      productName: i.productName, unitName: i.unitName ?? undefined,
                      quantity: i.quantity, receivedQuantity: i.receivedQuantity,
                    })),
                  }, companySettings as any);
                }}
              >
                <FileDown className="h-3.5 w-3.5" />PDF
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setSelectedId(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Detail Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Route Card */}
            <Card className="border-indigo-100">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="text-center flex-1">
                    <Building2 className="h-5 w-5 mx-auto mb-1 text-indigo-500" />
                    <p className="text-xs text-muted-foreground">Source</p>
                    <p className="text-sm font-semibold mt-0.5">{detail.sourceBranchName}</p>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <div className="h-[1px] w-12 bg-indigo-200" />
                    <ArrowRight className="h-5 w-5 text-indigo-400" />
                    <div className="h-[1px] w-12 bg-indigo-200" />
                  </div>
                  <div className="text-center flex-1">
                    <Building2 className="h-5 w-5 mx-auto mb-1 text-emerald-500" />
                    <p className="text-xs text-muted-foreground">Destination</p>
                    <p className="text-sm font-semibold mt-0.5">{detail.destinationBranchName}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Meta */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-start gap-2">
                <Calendar className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Créé le</p>
                  <p className="font-medium">{format(new Date(detail.createdAt), "d MMM yyyy", { locale: fr })}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <User className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Créé par</p>
                  <p className="font-medium">{detail.createdByName ?? "—"}</p>
                </div>
              </div>
              {detail.sentAt && (
                <div className="flex items-start gap-2">
                  <Send className="h-4 w-4 mt-0.5 text-blue-500 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Envoyé le</p>
                    <p className="font-medium">{format(new Date(detail.sentAt), "d MMM yyyy", { locale: fr })}</p>
                  </div>
                </div>
              )}
              {detail.receivedAt && (
                <div className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 mt-0.5 text-emerald-500 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Reçu le</p>
                    <p className="font-medium">{format(new Date(detail.receivedAt), "d MMM yyyy", { locale: fr })}</p>
                  </div>
                </div>
              )}
              {(detail as any).receivedByName && (
                <div className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 mt-0.5 text-emerald-500 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Réceptionné par</p>
                    <p className="font-medium">{(detail as any).receivedByName}</p>
                  </div>
                </div>
              )}
              {detail.notes && (
                <div className="flex items-start gap-2 col-span-2">
                  <FileText className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Notes</p>
                    <p className="text-sm">{detail.notes}</p>
                  </div>
                </div>
              )}
            </div>

            <Separator />

            {/* Items Table */}
            <div>
              <p className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Package className="h-4 w-4 text-muted-foreground" />
                Articles ({detail.itemCount})
              </p>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="text-xs h-8">Produit</TableHead>
                      <TableHead className="text-xs h-8 text-right w-20">Envoyé</TableHead>
                      <TableHead className="text-xs h-8 text-right w-20">Reçu</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(detail.items ?? []).map(item => {
                      const pct = item.quantity > 0 ? (item.receivedQuantity / item.quantity) * 100 : 0;
                      const isFullyReceived = item.receivedQuantity >= item.quantity;
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="text-sm py-2">{item.productName}</TableCell>
                          <TableCell className="text-sm py-2 text-right font-medium">{item.quantity} {item.unitName}</TableCell>
                          <TableCell className="py-2">
                            <div className="text-right">
                              <span className={`text-sm font-semibold ${isFullyReceived ? "text-emerald-600" : item.receivedQuantity > 0 ? "text-amber-600" : "text-muted-foreground"}`}>
                                {item.receivedQuantity}
                              </span>
                              {(detail.status === "sent" || detail.status === "partially_received") && (
                                <div className="mt-1">
                                  <Progress value={pct} className="h-1 w-16 ml-auto" />
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Timeline */}
            <div>
              <p className="text-sm font-semibold mb-3">Historique</p>
              <div className="space-y-3">
                <div className="flex gap-3 items-start">
                  <div className="h-6 w-6 rounded-full bg-gray-100 border flex items-center justify-center shrink-0 mt-0.5">
                    <FileText className="h-3 w-3 text-gray-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Brouillon créé</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(detail.createdAt), "d MMM yyyy HH:mm", { locale: fr })} · {detail.createdByName ?? "Système"}</p>
                  </div>
                </div>
                {(detail.status === "sent" || detail.status === "partially_received" || detail.status === "received") && detail.sentAt && (
                  <div className="flex gap-3 items-start">
                    <div className="h-6 w-6 rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center shrink-0 mt-0.5">
                      <Send className="h-3 w-3 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Envoyé — stock déduit de <span className="text-blue-700">{detail.sourceBranchName}</span></p>
                      <p className="text-xs text-muted-foreground">{format(new Date(detail.sentAt), "d MMM yyyy HH:mm", { locale: fr })}</p>
                    </div>
                  </div>
                )}
                {detail.status === "partially_received" && (
                  <div className="flex gap-3 items-start">
                    <div className="h-6 w-6 rounded-full bg-amber-100 border border-amber-200 flex items-center justify-center shrink-0 mt-0.5">
                      <Clock className="h-3 w-3 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Réception partielle — en attente du solde</p>
                      <p className="text-xs text-muted-foreground">Destination : {detail.destinationBranchName}</p>
                    </div>
                  </div>
                )}
                {detail.status === "received" && detail.receivedAt && (
                  <div className="flex gap-3 items-start">
                    <div className="h-6 w-6 rounded-full bg-emerald-100 border border-emerald-200 flex items-center justify-center shrink-0 mt-0.5">
                      <CheckCircle className="h-3 w-3 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Entièrement reçu par <span className="text-emerald-700">{detail.destinationBranchName}</span></p>
                      <p className="text-xs text-muted-foreground">{format(new Date(detail.receivedAt), "d MMM yyyy HH:mm", { locale: fr })}</p>
                    </div>
                  </div>
                )}
                {detail.status === "cancelled" && (
                  <div className="flex gap-3 items-start">
                    <div className="h-6 w-6 rounded-full bg-red-100 border border-red-200 flex items-center justify-center shrink-0 mt-0.5">
                      <X className="h-3 w-3 text-red-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-red-700">Transfert annulé</p>
                      <p className="text-xs text-muted-foreground">Stock restitué à la source si applicable</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Actions Footer */}
          {(detail.status === "draft" || detail.status === "sent" || detail.status === "partially_received") && (
            <div className="px-5 py-4 border-t bg-muted/20 shrink-0 space-y-2">
              {detail.status === "draft" && (
                <>
                  {canAccessBranch(detail.sourceBranchId) ? (
                    <Button
                      className="w-full gap-2 bg-indigo-600 hover:bg-indigo-700"
                      onClick={() => sendMutation.mutate(detail.id)}
                      disabled={sendMutation.isPending}
                    >
                      {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      Envoyer le transfert
                    </Button>
                  ) : (
                    <div className="w-full rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 flex items-center gap-2">
                      <Clock className="h-4 w-4 shrink-0" />
                      En attente d'envoi par le responsable de {branches.find(b => b.id === detail.sourceBranchId)?.name ?? "la source"}
                    </div>
                  )}
                  {canAccessBranch(detail.sourceBranchId) && (
                    <Button
                      variant="outline"
                      className="w-full gap-2"
                      onClick={() => openEditDraft(detail)}
                    >
                      <Pencil className="h-4 w-4" />Modifier le brouillon
                    </Button>
                  )}
                  {canAccessBranch(detail.sourceBranchId) && (
                    <Button
                      variant="outline"
                      className="w-full gap-2 text-red-600 border-red-200 hover:bg-red-50"
                      onClick={() => { if (confirm("Annuler ce transfert ?")) cancelMutation.mutate(detail.id); }}
                      disabled={cancelMutation.isPending}
                    >
                      <X className="h-4 w-4" />Annuler le brouillon
                    </Button>
                  )}
                </>
              )}
              {(detail.status === "sent" || detail.status === "partially_received") && (
                <>
                  {canAccessBranch(detail.destinationBranchId) ? (
                    <Button
                      className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700"
                      onClick={() => { openReceive(detail); setReceiveOpen(true); }}
                    >
                      <ClipboardCheck className="h-4 w-4" />
                      {detail.status === "partially_received" ? "Compléter la réception" : "Valider la réception"}
                    </Button>
                  ) : (
                    <div className="w-full rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800 flex items-center gap-2">
                      <Clock className="h-4 w-4 shrink-0" />
                      En attente de validation par le responsable de {branches.find(b => b.id === detail.destinationBranchId)?.name ?? "la destination"}
                    </div>
                  )}
                  {detail.status === "sent" && canAccessBranch(detail.sourceBranchId) && (
                    <Button
                      variant="outline"
                      className="w-full gap-2 text-red-600 border-red-200 hover:bg-red-50"
                      onClick={() => { if (confirm("Annuler ce transfert ? Le stock sera restitué à la source.")) cancelMutation.mutate(detail.id); }}
                      disabled={cancelMutation.isPending}
                    >
                      <X className="h-4 w-4" />Annuler l'envoi
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Create Dialog ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editingTransferId ? <Pencil className="h-5 w-5 text-indigo-600" /> : <ArrowRightLeft className="h-5 w-5 text-indigo-600" />}
              {editingTransferId ? "Modifier le brouillon" : "Nouveau transfert"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-medium">Boutique source *</Label>
                <Select value={form.sourceBranchId} onValueChange={v => setForm(f => ({ ...f, sourceBranchId: v }))} disabled={!!editingTransferId}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Choisir..." /></SelectTrigger>
                  <SelectContent>{branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-medium">Boutique destination *</Label>
                <Select value={form.destinationBranchId} onValueChange={v => setForm(f => ({ ...f, destinationBranchId: v }))} disabled={!!editingTransferId}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Choisir..." /></SelectTrigger>
                  <SelectContent>
                    {branches.filter(b => String(b.id) !== form.sourceBranchId).map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-xs font-medium">Notes</Label>
              <Input className="mt-1" placeholder="Motif du transfert..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>

            <div className="border rounded-lg overflow-hidden">
              <div className="bg-muted/40 px-3 py-2 flex items-center justify-between">
                <p className="text-xs font-semibold text-foreground">Articles à transférer</p>
                <span className="text-xs text-muted-foreground">{formItems.length} article{formItems.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="p-3 space-y-2">
                {formItems.map((item, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm bg-muted/30 rounded px-2 py-1.5">
                    <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="flex-1 text-sm">{item.productName}</span>
                    <span className="font-mono font-medium text-sm">{item.quantity}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => setFormItems(formItems.filter((_, j) => j !== i))}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <div className="flex gap-2 pt-1">
                  <Popover open={transferProductComboOpen} onOpenChange={setTransferProductComboOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" role="combobox" className="flex-1 h-8 justify-between font-normal text-sm">
                        <span className="truncate">
                          {newItem.productId
                            ? products.find(p => String(p.id) === newItem.productId)?.name ?? "Produit..."
                            : "Produit..."}
                        </span>
                        <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50 ml-1" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="p-0 w-64" align="start" onWheel={e => e.stopPropagation()}>
                      <Command>
                        <CommandInput placeholder="Rechercher un produit..." className="h-9" />
                        <CommandList className="max-h-[280px]">
                          <CommandEmpty>Aucun produit trouvé.</CommandEmpty>
                          <CommandGroup>
                            {products.map(p => (
                              <CommandItem key={p.id} value={p.name} onSelect={() => { setNewItem(n => ({ ...n, productId: String(p.id) })); setTransferProductComboOpen(false); }}>
                                <Check className={`mr-2 h-4 w-4 ${newItem.productId === String(p.id) ? "opacity-100" : "opacity-0"}`} />
                                {p.name}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <Input
                    type="number" step="0.001" min="0.001"
                    className="w-20 h-8 text-sm" placeholder="Qté"
                    value={newItem.quantity}
                    onChange={e => setNewItem(n => ({ ...n, quantity: e.target.value }))}
                    onKeyDown={e => e.key === "Enter" && addFormItem()}
                  />
                  <Button variant="outline" size="sm" className="h-8" onClick={addFormItem} disabled={!newItem.productId || !newItem.quantity}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); resetForm(); }}>Annuler</Button>
            <Button
              onClick={submitCreate}
              disabled={!form.sourceBranchId || !form.destinationBranchId || formItems.length === 0 || createMutation.isPending || updateMutation.isPending || validating}
              className="gap-2 bg-indigo-600 hover:bg-indigo-700"
            >
              {(createMutation.isPending || updateMutation.isPending) ? <Loader2 className="h-4 w-4 animate-spin" /> : editingTransferId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {editingTransferId ? "Enregistrer" : "Créer le brouillon"}
            </Button>
            {!editingTransferId && (
              <Button
                onClick={validateDirect}
                disabled={!form.sourceBranchId || !form.destinationBranchId || formItems.length === 0 || validating || createMutation.isPending}
                className="gap-2 bg-emerald-600 hover:bg-emerald-700"
              >
                {validating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Valider
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Receive Dialog ── */}
      <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-emerald-600" />
              Réception du transfert
            </DialogTitle>
            {detail && <p className="text-xs text-muted-foreground mt-1">Destination : <strong>{detail.destinationBranchName}</strong></p>}
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-xs text-muted-foreground bg-muted/40 rounded p-2.5">Renseignez les quantités effectivement reçues par article. Les quantités non renseignées resteront en attente.</p>
            {(detail?.items ?? []).map(item => {
              const remaining = item.quantity - item.receivedQuantity;
              return (
                <div key={item.id} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{item.productName}</p>
                    <span className="text-xs text-muted-foreground">{item.unitName}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Envoyé: <strong className="text-foreground">{item.quantity}</strong></span>
                    <span>Déjà reçu: <strong className="text-foreground">{item.receivedQuantity}</strong></span>
                    <span>Restant: <strong className="text-amber-600">{remaining}</strong></span>
                  </div>
                  <Input
                    type="number" step="0.001" min="0" max={remaining}
                    className="h-8 text-sm"
                    placeholder={`Max: ${remaining}`}
                    value={receiveQtys[item.id] ?? ""}
                    onChange={e => setReceiveQtys(q => ({ ...q, [item.id]: e.target.value }))}
                  />
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiveOpen(false)}>Annuler</Button>
            <Button
              onClick={submitReceive}
              disabled={receiveMutation.isPending}
              className="gap-2 bg-emerald-600 hover:bg-emerald-700"
            >
              {receiveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
              Confirmer la réception
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Stock Shortage Dialog ── */}
      <Dialog open={shortageOpen} onOpenChange={setShortageOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="h-5 w-5" />
              Stock insuffisant
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Les articles suivants n'ont pas suffisamment de stock dans la boutique source :</p>
            {shortages.map((s, i) => (
              <div key={i} className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-medium">{s.productName}</p>
                  <p className="text-xs text-muted-foreground">Requis: <strong className="text-foreground">{s.required}</strong> · Disponible: <strong className="text-red-600">{s.available}</strong></p>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={() => setShortageOpen(false)}>Compris</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
