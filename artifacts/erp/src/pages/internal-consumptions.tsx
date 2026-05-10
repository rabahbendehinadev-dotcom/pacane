import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetBranches, useGetProducts, useGetCompanySettings } from "@workspace/api-client-react";
import { generateInternalConsumptionPdf } from "@/lib/pdf-generator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ChevronsUpDown, Check, Plus, Trash2, X, FileDown, CheckCircle, Pencil, Package, Loader2, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";

function formatDA(n: number) {
  return new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(n) + " DA";
}

// ── Types ─────────────────────────────────────────────────────────────────────

type ICItem = {
  productId: number;
  productName: string;
  quantity: string;
  unitId: number | null;
  unitName: string;
  unitCost: string;
};

type ICDoc = {
  id: number;
  reference: string;
  sourceBranchId: number;
  destinationBranchId: number;
  sourceBranchName: string;
  destinationBranchName: string;
  documentDate: string;
  status: string;
  totalCost: number;
  itemCount: number;
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
  items?: Array<{
    id: number;
    productId: number;
    productName: string;
    quantity: number;
    unitId: number | null;
    unitName: string;
    unitCost: number;
    totalCost: number;
  }>;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { label: string; variant: string }> = {
  draft:     { label: "Brouillon",  variant: "bg-gray-100 text-gray-700 border-gray-200" },
  confirmed: { label: "Confirmé",   variant: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  cancelled: { label: "Annulé",     variant: "bg-red-100 text-red-700 border-red-200" },
};

const TABS = [
  { key: "all", label: "Tous" },
  { key: "draft", label: "Brouillons" },
  { key: "confirmed", label: "Confirmés" },
  { key: "cancelled", label: "Annulés" },
];

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? { label: status, variant: "bg-gray-100 text-gray-700 border-gray-200" };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${s.variant}`}>
      {s.label}
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

function fmt(n: number) {
  return new Intl.NumberFormat("fr-DZ", { minimumFractionDigits: 0, maximumFractionDigits: 3 }).format(n);
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function InternalConsumptions() {
  const qc = useQueryClient();
  const { user: authUser } = useAuth();
  const isAdmin = (authUser as any)?.adminAccess === true;
  const myBranchIds: number[] = (authUser as any)?.branchIds ?? [];
  const perms: string[] = (authUser as any)?.permissions ?? [];

  function hasPerm(p: string) {
    if (perms.includes("*")) return true;
    if (perms.includes(p)) return true;
    const mod = p.split(".")[0];
    return perms.includes(`${mod}.*`);
  }

  const canCreate = isAdmin || hasPerm("internal_consumptions.create");
  const canConfirm = isAdmin || hasPerm("internal_consumptions.confirm");
  const canCancel = isAdmin || hasPerm("internal_consumptions.cancel");

  // Filters & UI state
  const [tab, setTab] = useState("all");
  const [filterSource, setFilterSource] = useState("all");
  const [filterDest, setFilterDest] = useState("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [shortageOpen, setShortageOpen] = useState(false);
  const [shortages, setShortages] = useState<Array<{ productName: string; required: number; available: number }>>([]);

  // Create/edit form state
  const [form, setForm] = useState({ sourceBranchId: "", destinationBranchId: "", documentDate: format(new Date(), "yyyy-MM-dd"), notes: "" });
  const [formItems, setFormItems] = useState<ICItem[]>([]);
  const [newItem, setNewItem] = useState({ productId: "", quantity: "", unitCost: "" });
  const [productComboOpen, setProductComboOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Data
  const params: Record<string, any> = {};
  if (tab !== "all") params.status = tab;
  if (filterSource !== "all") params.sourceBranchId = parseInt(filterSource);
  if (filterDest !== "all") params.destinationBranchId = parseInt(filterDest);

  const { data: docs = [], isLoading, refetch } = useQuery<ICDoc[]>({
    queryKey: ["internal-consumptions", params],
    queryFn: () => {
      const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
      return apiCall(`/internal-consumptions${qs ? `?${qs}` : ""}`);
    },
  });

  const { data: selectedDoc, isLoading: detailLoading } = useQuery<ICDoc>({
    queryKey: ["internal-consumption", selectedId],
    queryFn: () => apiCall(`/internal-consumptions/${selectedId}`),
    enabled: selectedId !== null,
  });

  const { data: branches = [] } = useGetBranches();
  const { data: products = [] } = useGetProducts({});
  const { data: companySettings } = useGetCompanySettings();

  const filteredDocs = docs;
  const totalCost = filteredDocs.reduce((s, d) => s + d.totalCost, 0);

  function resetForm() {
    setForm({ sourceBranchId: "", destinationBranchId: "", documentDate: format(new Date(), "yyyy-MM-dd"), notes: "" });
    setFormItems([]);
    setNewItem({ productId: "", quantity: "", unitCost: "" });
  }

  function openCreate() {
    resetForm();
    setEditingId(null);
    setCreateOpen(true);
  }

  function openEdit(doc: ICDoc) {
    if (!doc.items) return;
    setForm({
      sourceBranchId: String(doc.sourceBranchId),
      destinationBranchId: String(doc.destinationBranchId),
      documentDate: doc.documentDate ? doc.documentDate.slice(0, 10) : format(new Date(), "yyyy-MM-dd"),
      notes: doc.notes ?? "",
    });
    setFormItems(doc.items.map(i => ({
      productId: i.productId,
      productName: i.productName,
      quantity: fmt(i.quantity),
      unitId: i.unitId,
      unitName: i.unitName,
      unitCost: String(i.unitCost),
    })));
    setEditingId(doc.id);
    setCreateOpen(true);
  }

  function addItem() {
    if (!newItem.productId || !newItem.quantity) return;
    const prod = products.find(p => String(p.id) === newItem.productId);
    if (!prod) return;
    const qty = parseFloat(newItem.quantity);
    if (isNaN(qty) || qty <= 0) return;
    const cost = parseFloat(newItem.unitCost || "0");
    setFormItems(prev => [...prev, {
      productId: prod.id,
      productName: prod.name,
      quantity: String(qty),
      unitId: (prod as any).unitId ?? null,
      unitName: "",
      unitCost: String(isNaN(cost) ? 0 : cost),
    }]);
    setNewItem({ productId: "", quantity: "", unitCost: "" });
  }

  async function saveDoc() {
    if (!form.sourceBranchId || !form.destinationBranchId || formItems.length === 0) {
      toast({ title: "Champs requis", description: "Renseignez les boutiques et au moins un article.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        sourceBranchId: parseInt(form.sourceBranchId),
        destinationBranchId: parseInt(form.destinationBranchId),
        documentDate: form.documentDate ? new Date(form.documentDate).toISOString() : new Date().toISOString(),
        notes: form.notes || null,
        items: formItems.map(i => ({
          productId: i.productId,
          quantity: parseFloat(i.quantity),
          unitId: i.unitId,
          unitCost: parseFloat(i.unitCost || "0"),
        })),
      };
      if (editingId) {
        await apiCall(`/internal-consumptions/${editingId}`, "PUT", payload);
        toast({ title: "Document mis à jour" });
      } else {
        await apiCall("/internal-consumptions", "POST", payload);
        toast({ title: "Document créé" });
      }
      qc.invalidateQueries({ queryKey: ["internal-consumptions"] });
      qc.invalidateQueries({ queryKey: ["internal-consumption", editingId] });
      setCreateOpen(false);
      resetForm();
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function confirmDoc(id: number) {
    try {
      await apiCall(`/internal-consumptions/${id}/confirm`, "POST");
      toast({ title: "Document confirmé", description: "Les mouvements de stock ont été appliqués." });
      qc.invalidateQueries({ queryKey: ["internal-consumptions"] });
      qc.invalidateQueries({ queryKey: ["internal-consumption", id] });
    } catch (e: any) {
      if (e.data?.error === "stock_insufficient") {
        setShortages(e.data.shortages ?? []);
        setShortageOpen(true);
      } else {
        toast({ title: "Erreur", description: e.message, variant: "destructive" });
      }
    }
  }

  async function cancelDoc(id: number) {
    try {
      await apiCall(`/internal-consumptions/${id}/cancel`, "POST");
      toast({ title: "Document annulé" });
      qc.invalidateQueries({ queryKey: ["internal-consumptions"] });
      qc.invalidateQueries({ queryKey: ["internal-consumption", id] });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    }
  }

  function printDoc(doc: ICDoc) {
    if (!doc.items) return;
    generateInternalConsumptionPdf(
      {
        reference: doc.reference,
        status: doc.status,
        documentDate: doc.documentDate,
        sourceBranchName: doc.sourceBranchName,
        destinationBranchName: doc.destinationBranchName,
        createdByName: doc.createdByName,
        notes: doc.notes,
        totalCost: doc.totalCost,
        items: doc.items.map(i => ({
          productName: i.productName,
          quantity: i.quantity,
          unitName: i.unitName,
          unitCost: i.unitCost,
          totalCost: i.totalCost,
        })),
      },
      {
        name: (companySettings as any)?.name ?? "Pacane",
        phone: (companySettings as any)?.phone,
        address: (companySettings as any)?.address,
        city: (companySettings as any)?.city,
        email: (companySettings as any)?.email,
        taxId: (companySettings as any)?.taxId,
        footerNote: (companySettings as any)?.footerNote,
      }
    );
  }

  const selectedProduct = products.find(p => String(p.id) === newItem.productId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Consommation interne</h1>
          <p className="text-muted-foreground text-sm">Gestion des produits consommables internes (frottoir, balai, chiffon...)</p>
        </div>
        {canCreate && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Nouveau document
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total documents</CardTitle>
          </CardHeader>
          <CardContent className="pb-4 px-4">
            <p className="text-2xl font-bold">{docs.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Coût total</CardTitle>
          </CardHeader>
          <CardContent className="pb-4 px-4">
            <p className="text-2xl font-bold">{formatDA(totalCost)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Brouillons</CardTitle>
          </CardHeader>
          <CardContent className="pb-4 px-4">
            <p className="text-2xl font-bold text-amber-600">{docs.filter(d => d.status === "draft").length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Confirmés</CardTitle>
          </CardHeader>
          <CardContent className="pb-4 px-4">
            <p className="text-2xl font-bold text-emerald-600">{docs.filter(d => d.status === "confirmed").length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs + Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="flex gap-1 flex-wrap">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 ml-auto flex-wrap">
          <Select value={filterSource} onValueChange={setFilterSource}>
            <SelectTrigger className="w-44 h-8 text-xs">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes sources</SelectItem>
              {branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterDest} onValueChange={setFilterDest}>
            <SelectTrigger className="w-44 h-8 text-xs">
              <SelectValue placeholder="Destination" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes destinations</SelectItem>
              {branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Référence</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead className="text-center">Articles</TableHead>
                <TableHead className="text-right">Coût total</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Chargement...</TableCell></TableRow>
              ) : filteredDocs.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  <Package className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  Aucun document trouvé
                </TableCell></TableRow>
              ) : filteredDocs.map(doc => (
                <TableRow key={doc.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedId(doc.id)}>
                  <TableCell className="font-mono text-sm font-medium">{doc.reference}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{doc.documentDate ? format(new Date(doc.documentDate), "dd MMM yyyy", { locale: fr }) : "—"}</TableCell>
                  <TableCell className="text-sm">{doc.sourceBranchName}</TableCell>
                  <TableCell className="text-sm">{doc.destinationBranchName}</TableCell>
                  <TableCell className="text-center text-sm">{doc.itemCount}</TableCell>
                  <TableCell className="text-right text-sm font-medium">{formatDA(doc.totalCost)}</TableCell>
                  <TableCell><StatusBadge status={doc.status} /></TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <div className="flex gap-1">
                      {doc.status === "draft" && canCreate && (
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => {
                          setSelectedId(doc.id);
                        }}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                      )}
                      {doc.status === "draft" && canConfirm && (
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                          onClick={() => confirmDoc(doc.id)}>
                          <CheckCircle className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Detail Sheet */}
      <Sheet open={selectedId !== null} onOpenChange={open => { if (!open) setSelectedId(null); }}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Détail consommation interne</SheetTitle>
          </SheetHeader>
          {detailLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : selectedDoc ? (
            <div className="mt-6 space-y-6">
              {/* Header info */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Référence</p>
                  <p className="font-mono font-semibold">{selectedDoc.reference}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Statut</p>
                  <StatusBadge status={selectedDoc.status} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Source</p>
                  <p>{selectedDoc.sourceBranchName}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Destination</p>
                  <p>{selectedDoc.destinationBranchName}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Date document</p>
                  <p>{selectedDoc.documentDate ? format(new Date(selectedDoc.documentDate), "dd MMM yyyy", { locale: fr }) : "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Créé par</p>
                  <p>{selectedDoc.createdByName ?? "—"}</p>
                </div>
              </div>

              {selectedDoc.notes && (
                <div className="bg-muted/50 rounded-md p-3 text-sm text-muted-foreground">
                  {selectedDoc.notes}
                </div>
              )}

              <Separator />

              {/* Items */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Articles consommés</p>
                <div className="space-y-2">
                  {selectedDoc.items?.map(item => (
                    <div key={item.id} className="flex items-center justify-between p-2.5 bg-muted/30 rounded-md">
                      <div>
                        <p className="text-sm font-medium">{item.productName}</p>
                        <p className="text-xs text-muted-foreground">{fmt(item.quantity)} {item.unitName} × {formatDA(item.unitCost)}</p>
                      </div>
                      <p className="text-sm font-semibold">{formatDA(item.totalCost)}</p>
                    </div>
                  ))}
                </div>
              </div>

              <Separator />

              {/* Total */}
              <div className="flex items-center justify-between font-semibold">
                <span>Coût total</span>
                <span className="text-lg">{formatDA(selectedDoc.totalCost)}</span>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2 pt-2">
                <Button size="sm" variant="outline" onClick={() => selectedDoc.items && printDoc(selectedDoc)}>
                  <FileDown className="h-4 w-4 mr-2" />
                  PDF
                </Button>
                {selectedDoc.status === "draft" && canCreate && (
                  <Button size="sm" variant="outline" onClick={() => { openEdit(selectedDoc); setSelectedId(null); }}>
                    <Pencil className="h-4 w-4 mr-2" />
                    Modifier
                  </Button>
                )}
                {selectedDoc.status === "draft" && canConfirm && (
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => confirmDoc(selectedDoc.id)}>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Confirmer
                  </Button>
                )}
                {selectedDoc.status === "draft" && canCancel && (
                  <Button size="sm" variant="destructive" onClick={() => cancelDoc(selectedDoc.id)}>
                    <X className="h-4 w-4 mr-2" />
                    Annuler
                  </Button>
                )}
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* Create/Edit Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Modifier le document" : "Nouveau document de consommation interne"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Boutique source *</Label>
                <Select value={form.sourceBranchId} onValueChange={v => setForm(f => ({ ...f, sourceBranchId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
                  <SelectContent>
                    {branches.filter(b => isAdmin || myBranchIds.includes(b.id)).map(b => (
                      <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Boutique destination *</Label>
                <Select value={form.destinationBranchId} onValueChange={v => setForm(f => ({ ...f, destinationBranchId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
                  <SelectContent>
                    {branches.map(b => (
                      <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Date du document</Label>
                <Input type="date" value={form.documentDate} onChange={e => setForm(f => ({ ...f, documentDate: e.target.value }))} />
              </div>
              <div>
                <Label>Notes</Label>
                <Input placeholder="Notes optionnelles..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>

            <Separator />

            {/* Items */}
            <div>
              <p className="text-sm font-semibold mb-3">Articles à consommer</p>
              {formItems.length > 0 && (
                <div className="space-y-2 mb-3">
                  {formItems.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2 p-2 bg-muted/30 rounded-md text-sm">
                      <span className="flex-1 font-medium">{item.productName}</span>
                      <span className="text-muted-foreground w-16 text-right">{item.quantity}</span>
                      <span className="text-muted-foreground w-24 text-right">{formatDA(parseFloat(item.unitCost || "0"))}/u</span>
                      <button onClick={() => setFormItems(prev => prev.filter((_, i) => i !== idx))} className="text-destructive hover:text-destructive/80">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-12 gap-2">
                <div className="col-span-5">
                  <Popover open={productComboOpen} onOpenChange={setProductComboOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" role="combobox" className="w-full justify-between h-9 text-sm font-normal">
                        {selectedProduct ? selectedProduct.name : "Choisir produit..."}
                        <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 ml-1" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Rechercher..." />
                        <CommandList>
                          <CommandEmpty>Aucun produit trouvé</CommandEmpty>
                          <CommandGroup>
                            {products.map(p => (
                              <CommandItem
                                key={p.id}
                                value={p.name}
                                onSelect={() => {
                                  setNewItem(prev => ({ ...prev, productId: String(p.id), unitCost: String((p as any).costPrice ?? 0) }));
                                  setProductComboOpen(false);
                                }}
                              >
                                <Check className={`h-3.5 w-3.5 mr-2 ${newItem.productId === String(p.id) ? "opacity-100" : "opacity-0"}`} />
                                {p.name}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="col-span-2">
                  <Input
                    placeholder="Qté"
                    type="number"
                    min="0"
                    step="0.001"
                    value={newItem.quantity}
                    onChange={e => setNewItem(prev => ({ ...prev, quantity: e.target.value }))}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="col-span-3">
                  <Input
                    placeholder="Coût unitaire"
                    type="number"
                    min="0"
                    step="0.01"
                    value={newItem.unitCost}
                    onChange={e => setNewItem(prev => ({ ...prev, unitCost: e.target.value }))}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="col-span-2">
                  <Button
                    variant="secondary"
                    className="w-full h-9 text-sm"
                    onClick={addItem}
                    disabled={!newItem.productId || !newItem.quantity}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Ajouter
                  </Button>
                </div>
              </div>
            </div>

            {formItems.length > 0 && (
              <div className="flex justify-end text-sm font-semibold pt-2 border-t">
                Coût total : {formatDA(formItems.reduce((s, i) => s + parseFloat(i.quantity || "0") * parseFloat(i.unitCost || "0"), 0))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Annuler</Button>
            <Button onClick={saveDoc} disabled={saving || formItems.length === 0}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {editingId ? "Enregistrer" : "Créer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stock shortages dialog */}
      <Dialog open={shortageOpen} onOpenChange={setShortageOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Stock insuffisant
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Les produits suivants n'ont pas assez de stock dans la boutique source :</p>
          <div className="space-y-2">
            {shortages.map((s, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-red-50 rounded-md text-sm border border-red-100">
                <span className="font-medium">{s.productName}</span>
                <span className="text-muted-foreground">Requis: {fmt(s.required)} — Disponible: {fmt(s.available)}</span>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={() => setShortageOpen(false)}>Fermer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
