import { useState, useRef } from "react";
import { useGetProducts, useCreateProduct, useUpdateProduct, useGetCategories, useGetUnits, useGetBranches, getGetProductsQueryKey, Product } from "@workspace/api-client-react";
import { customFetch } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Search, Edit2, Trash2, Package, ImagePlus, X, Loader2, ChevronsUpDown, Check, Upload, AlertTriangle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { toast } from "@/hooks/use-toast";
import { ExportButton } from "@/components/ExportButton";

function ProductThumb({ url, name }: { url: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) return <Package className="h-4 w-4 text-primary" />;
  return <img src={url} alt={name} className="h-full w-full object-cover" onError={() => setBroken(true)} />;
}

function formatDA(n: number) { return new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(n) + " DA"; }

const EMPTY = { name: "", type: "finished", sku: "", categoryId: "none", unitId: "none", workerId: "none", costPrice: "", sellingPrice: "", alertQuantity: "", isSellable: true, isPurchasable: true, isFabricated: false, isInternalConsumable: false, description: "" };

interface WorkerOption { id: number; name: string; isActive: boolean; }
async function fetchActiveWorkers(): Promise<WorkerOption[]> {
  const r = await fetch("/api/workers", { headers: { Authorization: `Bearer ${localStorage.getItem("erp_token")}` } });
  if (!r.ok) return [];
  return r.json();
}

function typeBadge(type: string) {
  const m: Record<string, { label: string; cls: string }> = {
    finished: { label: "Produit fini", cls: "bg-green-100 text-green-700" },
    ingredient: { label: "Ingrédient", cls: "bg-blue-100 text-blue-700" },
    semi_finished: { label: "Semi-fini", cls: "bg-amber-100 text-amber-700" },
    consumable: { label: "Consommable", cls: "bg-gray-100 text-gray-700" },
    service: { label: "Service", cls: "bg-purple-100 text-purple-700" }
  };
  const s = m[type] ?? { label: type, cls: "bg-gray-100" };
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

export default function Products() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [selectedBranchIds, setSelectedBranchIds] = useState<number[]>([]);
  const [branchPopoverOpen, setBranchPopoverOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [pendingImagePath, setPendingImagePath] = useState<string | null>(null);
  const [imageCleared, setImageCleared] = useState(false);
  const [replenishmentRules, setReplenishmentRules] = useState<Record<number, { targetDim: string; targetLun: string; targetMar: string; targetMer: string; targetJeu: string; targetVen: string; targetSat: string }>>({});
  const [enabledReplenishBranches, setEnabledReplenishBranches] = useState<Set<number>>(new Set());
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkUnitOpen, setBulkUnitOpen] = useState(false);
  const [bulkUnitId, setBulkUnitId] = useState("none");
  const [bulkLoading, setBulkLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importStep, setImportStep] = useState<"upload" | "preview" | "confirm">("upload");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<any>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [confirmWord, setConfirmWord] = useState("");
  const [importResult, setImportResult] = useState<any>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgeWord, setPurgeWord] = useState("");
  const [purgeLoading, setPurgeLoading] = useState(false);
  const [purgeResult, setPurgeResult] = useState<any>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const { user } = useAuth();
  const isAdmin = !!(user as any)?.adminAccess;
  const { data: rawProducts = [], isLoading } = useGetProducts({ search: search || undefined, type: typeFilter !== "all" ? typeFilter : undefined });
  const products = branchFilter === "all"
    ? rawProducts
    : rawProducts.filter(p => ((p as any).branchIds ?? []).includes(parseInt(branchFilter)));
  const { data: categories = [] } = useGetCategories();
  const { data: units = [] } = useGetUnits();
  const { data: branches = [] } = useGetBranches();
  const { data: allWorkers = [] } = useQuery<WorkerOption[]>({ queryKey: ["workers"], queryFn: fetchActiveWorkers });
  const pieceUnitId = units.find(u => !u.allowDecimals && (u.name.toLowerCase().includes("pièce") || u.abbreviation.toLowerCase() === "pcs"))?.id?.toString() ?? null;
  const EMPTY_DAYS = { targetDim: "", targetLun: "", targetMar: "", targetMer: "", targetJeu: "", targetVen: "", targetSat: "" };
  const DAY_KEYS = ["targetDim", "targetLun", "targetMar", "targetMer", "targetJeu", "targetVen", "targetSat"] as const;
  type DayKey = typeof DAY_KEYS[number];

  async function saveReplenishmentRulesFor(productId: number, rules: Record<number, typeof EMPTY_DAYS>, enabledBranches: Set<number>) {
    const allBranchIds = new Set([...Object.keys(rules).map(Number), ...Array.from(enabledBranches)]);
    const payload = Array.from(allBranchIds).map(branchId => {
      const r = rules[branchId] ?? EMPTY_DAYS;
      const isEnabled = enabledBranches.has(branchId);
      return {
        branchId,
        targetDim: isEnabled ? (parseFloat(r.targetDim || "0") || 0) : 0,
        targetLun: isEnabled ? (parseFloat(r.targetLun || "0") || 0) : 0,
        targetMar: isEnabled ? (parseFloat(r.targetMar || "0") || 0) : 0,
        targetMer: isEnabled ? (parseFloat(r.targetMer || "0") || 0) : 0,
        targetJeu: isEnabled ? (parseFloat(r.targetJeu || "0") || 0) : 0,
        targetVen: isEnabled ? (parseFloat(r.targetVen || "0") || 0) : 0,
        targetSat: isEnabled ? (parseFloat(r.targetSat || "0") || 0) : 0,
      };
    });
    if (payload.length === 0) return;
    await customFetch(`/api/replenishment/rules/product/${productId}`, { method: "PUT", body: JSON.stringify({ rules: payload }) });
  }

  const createMutation = useCreateProduct({ mutation: {
    onSuccess: async (data: any) => {
      try { await saveReplenishmentRulesFor(data.id, replenishmentRules, enabledReplenishBranches); } catch {}
      qc.invalidateQueries({ queryKey: getGetProductsQueryKey() }); setDialogOpen(false); toast({ title: "Produit créé" });
    },
    onError: (err: any) => { toast({ title: "Erreur lors de la création", description: err?.message ?? "Une erreur est survenue", variant: "destructive" }); }
  }});
  const updateMutation = useUpdateProduct({ mutation: {
    onSuccess: async () => {
      if (editing) { try { await saveReplenishmentRulesFor(editing.id, replenishmentRules, enabledReplenishBranches); } catch {} }
      qc.invalidateQueries({ queryKey: getGetProductsQueryKey() }); setDialogOpen(false); toast({ title: "Produit mis à jour" });
    },
    onError: (err: any) => { toast({ title: "Erreur lors de la mise à jour", description: err?.message ?? "Une erreur est survenue", variant: "destructive" }); }
  }});

  async function confirmDelete() {
    if (!deleteId) return;
    setDeleteLoading(true);
    try {
      await customFetch(`/api/products/${deleteId}`, { method: "DELETE" });
      qc.invalidateQueries({ queryKey: getGetProductsQueryKey() });
      toast({ title: "Produit supprimé" });
      setDeleteId(null);
    } catch (err: any) {
      const msg = err?.data?.error ?? err?.message ?? "Erreur inconnue";
      toast({ title: "Suppression impossible", description: msg, variant: "destructive" });
    } finally { setDeleteLoading(false); }
  }

  function resetImageState(cleared = false) { setImagePreview(null); setPendingImagePath(null); setImageCleared(cleared); if (imageInputRef.current) imageInputRef.current.value = ""; }
  function openNew() { setEditing(null); setForm({ ...EMPTY, unitId: pieceUnitId ?? "none" }); setSelectedBranchIds([]); resetImageState(); setReplenishmentRules({}); setEnabledReplenishBranches(new Set()); setDialogOpen(true); }
  async function openEdit(p: Product) {
    setEditing(p);
    const effectiveUnitId = p.type === "finished" ? (pieceUnitId ?? p.unitId?.toString() ?? "none") : (p.unitId?.toString() ?? "none");
    setForm({ name: p.name, type: p.type, sku: p.sku ?? "", categoryId: p.categoryId?.toString() ?? "none", unitId: effectiveUnitId, workerId: (p as any).workerId?.toString() ?? "none", costPrice: p.costPrice?.toString() ?? "", sellingPrice: p.sellingPrice?.toString() ?? "", alertQuantity: p.alertQuantity?.toString() ?? "", isSellable: p.isSellable, isPurchasable: p.isPurchasable, isFabricated: p.isFabricated, isInternalConsumable: (p as any).isInternalConsumable ?? false, description: p.description ?? "" });
    setSelectedBranchIds((p as any).branchIds ?? []);
    setImagePreview(p.imageUrl ?? null);
    setPendingImagePath(null);
    setImageCleared(false);
    setReplenishmentRules({});
    setEnabledReplenishBranches(new Set());
    setDialogOpen(true);
    try {
      const rules = await customFetch(`/api/replenishment/rules/product/${p.id}`) as Array<{ branchId: number; targetDim: string; targetLun: string; targetMar: string; targetMer: string; targetJeu: string; targetVen: string; targetSat: string; isActive: boolean }>;
      const map: Record<number, typeof EMPTY_DAYS> = {};
      const enabledIds = new Set<number>();
      for (const r of rules) {
        map[r.branchId] = {
          targetDim: r.targetDim ?? "0", targetLun: r.targetLun ?? "0", targetMar: r.targetMar ?? "0",
          targetMer: r.targetMer ?? "0", targetJeu: r.targetJeu ?? "0", targetVen: r.targetVen ?? "0", targetSat: r.targetSat ?? "0",
        };
        if (r.isActive) enabledIds.add(r.branchId);
      }
      setReplenishmentRules(map);
      setEnabledReplenishBranches(enabledIds);
    } catch {}
  }

  function toggleBranch(id: number) {
    setSelectedBranchIds(prev => prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id]);
  }

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast({ title: "Fichier non valide", description: "Veuillez choisir une image.", variant: "destructive" }); return; }
    if (file.size > 5 * 1024 * 1024) { toast({ title: "Image trop lourde", description: "Taille max : 5 Mo.", variant: "destructive" }); return; }
    setImagePreview(URL.createObjectURL(file));
    setImageUploading(true);
    try {
      const token = localStorage.getItem("erp_token");
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/upload/product-image", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) throw new Error(await res.text());
      const { imageUrl } = await res.json();
      setPendingImagePath(imageUrl);
    } catch { toast({ title: "Échec du téléchargement", variant: "destructive" }); setImagePreview(null); }
    finally { setImageUploading(false); }
  }

  async function save() {
    const imageUrl = pendingImagePath ?? (imageCleared ? null : (editing?.imageUrl ?? null));
    const data = {
      ...form,
      categoryId: form.categoryId && form.categoryId !== "none" ? parseInt(form.categoryId) : null,
      unitId: form.unitId && form.unitId !== "none" ? parseInt(form.unitId) : null,
      workerId: form.workerId && form.workerId !== "none" ? parseInt(form.workerId) : null,
      costPrice: form.costPrice ? parseFloat(form.costPrice) : null,
      sellingPrice: form.sellingPrice ? parseFloat(form.sellingPrice) : null,
      alertQuantity: form.alertQuantity ? parseFloat(form.alertQuantity) : null,
      branchIds: selectedBranchIds,
      imageUrl,
    };
    if (editing) { updateMutation.mutate({ id: editing.id, data: { ...data } as any }); }
    else { createMutation.mutate({ data: { name: data.name, type: data.type as any, sku: data.sku || null, categoryId: data.categoryId, unitId: data.unitId ?? 1, description: data.description || null, costPrice: data.costPrice ?? 0, sellingPrice: data.sellingPrice ?? 0, alertQuantity: data.alertQuantity, isManaged: true, isSellable: data.isSellable, isPurchasable: data.isPurchasable, isFabricated: data.isFabricated, isInternalConsumable: (data as any).isInternalConsumable ?? false, branchIds: selectedBranchIds, imageUrl } as any }); }
  }

  async function runPreview() {
    if (!importFile) return;
    setImportLoading(true);
    try {
      const fd = new FormData();
      fd.append("csv", importFile);
      const token = localStorage.getItem("erp_token");
      const res = await fetch("/api/products/csv-preview", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Erreur"); }
      const data = await res.json();
      setImportPreview(data);
      setImportStep("preview");
    } catch (err: any) {
      toast({ title: "Erreur de prévisualisation", description: err.message, variant: "destructive" });
    } finally { setImportLoading(false); }
  }

  async function runImport() {
    if (!importFile || confirmWord !== "RESET PRODUITS") return;
    setImportLoading(true);
    try {
      const fd = new FormData();
      fd.append("csv", importFile);
      const token = localStorage.getItem("erp_token");
      const res = await fetch("/api/products/csv-reset", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Erreur"); }
      const data = await res.json();
      setImportResult(data);
      qc.invalidateQueries({ queryKey: getGetProductsQueryKey() });
      setImportStep("confirm");
      toast({ title: `Import réussi — ${data.createdCount} créés, ${data.updatedCount} mis à jour, ${data.archivedCount} archivés` });
    } catch (err: any) {
      toast({ title: "Erreur d'import", description: err.message, variant: "destructive" });
    } finally { setImportLoading(false); }
  }

  function resetImportDialog() {
    setImportStep("upload"); setImportFile(null); setImportPreview(null);
    setConfirmWord(""); setImportResult(null);
    if (csvInputRef.current) csvInputRef.current.value = "";
  }

  async function runPurge() {
    if (purgeWord !== "DELETE CURRENT PRODUCTS") return;
    setPurgeLoading(true);
    try {
      const token = localStorage.getItem("erp_token");
      const res = await fetch("/api/products/catalog-purge", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Erreur"); }
      const data = await res.json();
      setPurgeResult(data.counts);
      qc.invalidateQueries({ queryKey: getGetProductsQueryKey() });
      toast({ title: `Catalogue supprimé — ${data.counts.products_deleted} produits et données de test supprimés` });
    } catch (err: any) {
      toast({ title: "Erreur de suppression", description: err.message, variant: "destructive" });
    } finally { setPurgeLoading(false); }
  }

  const allVisibleSelected = products.length > 0 && products.every(p => selectedIds.includes(p.id));
  const allFinished = selectedIds.length > 0 && selectedIds.every(id => products.find(p => p.id === id)?.type === "finished");

  function openBulkUnit() {
    const defaultUnit = typeFilter === "finished" && pieceUnitId ? pieceUnitId : (pieceUnitId ?? "none");
    setBulkUnitId(defaultUnit);
    setBulkUnitOpen(true);
  }

  async function applyBulkUnit() {
    if (bulkUnitId === "none" || selectedIds.length === 0) return;
    setBulkLoading(true);
    try {
      const res = await customFetch("/api/products/bulk-unit", { method: "PATCH", body: JSON.stringify({ productIds: selectedIds, unitId: parseInt(bulkUnitId) }) });
      const data = await res.json();
      qc.invalidateQueries({ queryKey: getGetProductsQueryKey() });
      setSelectedIds([]);
      setBulkUnitOpen(false);
      toast({ title: `Unité mise à jour pour ${data.updatedCount} produit${data.updatedCount > 1 ? "s" : ""}.` });
    } catch (err: any) {
      toast({ title: "Erreur lors de la mise à jour", description: err?.message ?? "Erreur inconnue", variant: "destructive" });
    } finally { setBulkLoading(false); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold">Produits</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{products.length} produit{products.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex gap-2 items-center">
          <ExportButton
            endpoint="export/products"
            params={{ search: search || undefined, type: typeFilter !== "all" ? typeFilter : undefined, branchId: branchFilter !== "all" ? branchFilter : undefined }}
            label="Exporter"
          />
          {isAdmin && (
            <>
              <Button variant="outline" className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/5" onClick={() => { setPurgeWord(""); setPurgeResult(null); setPurgeOpen(true); }}>
                <Trash2 className="h-4 w-4" />Supprimer catalogue
              </Button>
              <Button variant="outline" className="gap-2" onClick={() => { resetImportDialog(); setImportOpen(true); }}>
                <Upload className="h-4 w-4" />Importer CSV
              </Button>
            </>
          )}
          <Button onClick={openNew} className="gap-2"><Plus className="h-4 w-4" />Nouveau produit</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Rechercher..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <Select value={branchFilter} onValueChange={setBranchFilter}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Tous les sites" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les sites</SelectItem>
                {branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Tous les types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                <SelectItem value="finished">Produits finis</SelectItem>
                <SelectItem value="ingredient">Ingrédients</SelectItem>
                <SelectItem value="semi_finished">Semi-finis</SelectItem>
                <SelectItem value="consumable">Consommables</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {selectedIds.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/5 border border-primary/20 rounded-lg">
          <span className="text-sm font-medium text-primary">{selectedIds.length} produit{selectedIds.length > 1 ? "s" : ""} sélectionné{selectedIds.length > 1 ? "s" : ""}</span>
          <div className="flex-1" />
          <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={openBulkUnit}>
            <Edit2 className="h-3.5 w-3.5" />Changer l'unité
          </Button>
          <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={() => setSelectedIds([])}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox checked={allVisibleSelected} onCheckedChange={v => setSelectedIds(v ? products.map(p => p.id) : [])} />
                </TableHead>
                <TableHead>Produit</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Catégorie</TableHead>
                <TableHead>Sites commerciaux</TableHead>
                <TableHead>Coût</TableHead>
                <TableHead>Prix vente</TableHead>
                <TableHead>Marge %</TableHead>
                <TableHead>Attributs</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={10} className="text-center py-12 text-muted-foreground">Chargement...</TableCell></TableRow>
              ) : products.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="text-center py-12 text-muted-foreground">Aucun produit</TableCell></TableRow>
              ) : products.map(p => (
                <TableRow key={p.id} className={`cursor-pointer hover:bg-muted/40 ${selectedIds.includes(p.id) ? "bg-primary/5" : ""}`}>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <Checkbox checked={selectedIds.includes(p.id)} onCheckedChange={v => setSelectedIds(prev => v ? [...prev, p.id] : prev.filter(id => id !== p.id))} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 overflow-hidden">
                        <ProductThumb url={p.imageUrl ?? null} name={p.name} />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{p.name}</p>
                        {p.sku && <p className="text-xs text-muted-foreground font-mono">{p.sku}</p>}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{typeBadge(p.type)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{p.categoryName ?? "—"}</TableCell>
                  <TableCell>
                    {((p as any).branchIds ?? []).length === 0 ? (
                      <span className="text-xs text-muted-foreground/60">Tous</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {((p as any).branchIds as number[]).map(bid => {
                          const b = branches.find(x => x.id === bid);
                          return b ? <Badge key={bid} variant="secondary" className="text-xs font-normal">{b.name}</Badge> : null;
                        })}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm font-mono">{p.costPrice ? formatDA(parseFloat(p.costPrice.toString())) : "—"}</TableCell>
                  <TableCell className="text-sm font-semibold text-primary">{p.sellingPrice ? formatDA(parseFloat(p.sellingPrice.toString())) : "—"}</TableCell>
                  <TableCell className="text-sm font-mono">
                    {(() => {
                      const cost = p.costPrice ? parseFloat(p.costPrice.toString()) : null;
                      const sell = p.sellingPrice ? parseFloat(p.sellingPrice.toString()) : null;
                      if (cost == null || sell == null || sell === 0) return <span className="text-muted-foreground">—</span>;
                      const marge = ((sell - cost) / sell) * 100;
                      return <span className={marge < 0 ? "text-red-500" : ""}>{marge.toFixed(1)}%</span>;
                    })()}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {p.isSellable && <Badge variant="outline" className="text-xs">Vendable</Badge>}
                      {p.isPurchasable && <Badge variant="outline" className="text-xs">Achetable</Badge>}
                      {p.isFabricated && <Badge variant="secondary" className="text-xs">Fabriqué</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)}>
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={e => { e.stopPropagation(); setDeleteId(p.id); }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Modifier le produit" : "Nouveau produit"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {/* Image upload */}
            <div>
              <Label>Photo du produit</Label>
              <div className="mt-1 flex items-center gap-3">
                <div
                  className="h-20 w-20 rounded-lg border-2 border-dashed border-muted-foreground/30 flex items-center justify-center overflow-hidden cursor-pointer hover:border-primary/50 transition-colors shrink-0 bg-muted/20"
                  onClick={() => !imageUploading && imageInputRef.current?.click()}
                >
                  {imageUploading ? (
                    <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
                  ) : imagePreview ? (
                    <img src={imagePreview} alt="preview" className="h-full w-full object-cover" />
                  ) : (
                    <ImagePlus className="h-6 w-6 text-muted-foreground/50" />
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Button type="button" variant="outline" size="sm" onClick={() => imageInputRef.current?.click()} disabled={imageUploading}>
                    {imageUploading ? "Téléchargement..." : "Choisir une image"}
                  </Button>
                  {imagePreview && (
                    <Button type="button" variant="ghost" size="sm" className="text-destructive h-7 text-xs" onClick={() => { resetImageState(true); }}>
                      <X className="h-3 w-3 mr-1" />Supprimer
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground">PNG, JPG, WEBP — max 5 Mo</p>
                </div>
              </div>
              <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div><Label>Nom *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div>
                <Label>Type *</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v, unitId: v === "finished" ? (pieceUnitId ?? f.unitId) : f.unitId }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="finished">Produit fini</SelectItem>
                    <SelectItem value="ingredient">Ingrédient</SelectItem>
                    <SelectItem value="semi_finished">Semi-fini</SelectItem>
                    <SelectItem value="consumable">Consommable</SelectItem>
                    <SelectItem value="service">Service</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Catégorie</Label>
                <Select value={form.categoryId} onValueChange={v => setForm(f => ({ ...f, categoryId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Aucune" /></SelectTrigger>
                  <SelectContent position="popper" className="max-h-60 overflow-y-auto">
                    <SelectItem value="none">Aucune</SelectItem>
                    {Array.from(new Map(categories.map(c => [c.name, c])).values()).map(c => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Unité {form.type === "finished" && <span className="text-xs text-muted-foreground ml-1">(imposée : Pièce)</span>}</Label>
                <Select value={form.unitId} onValueChange={v => setForm(f => ({ ...f, unitId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Aucune" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Aucune</SelectItem>
                    {units.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Responsable de préparation</Label>
              <Select value={form.workerId} onValueChange={v => setForm(f => ({ ...f, workerId: v }))}>
                <SelectTrigger><SelectValue placeholder="Non affecté" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Non affecté</SelectItem>
                  {allWorkers.filter(w => w.isActive || w.id.toString() === form.workerId).map(w => (
                    <SelectItem key={w.id} value={String(w.id)}>
                      {w.name}{!w.isActive ? " (désactivé)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Sites commerciaux — multi-select dropdown */}
            <div>
              <Label>Sites commerciaux</Label>
              <p className="text-xs text-muted-foreground mb-1.5">Laisser vide = disponible dans tous les sites</p>
              <Popover open={branchPopoverOpen} onOpenChange={setBranchPopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="w-full flex items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="text-muted-foreground">
                      {selectedBranchIds.length === 0
                        ? "Tous les sites"
                        : selectedBranchIds.length === 1
                          ? branches.find(b => b.id === selectedBranchIds[0])?.name
                          : `${selectedBranchIds.length} sites sélectionnés`}
                    </span>
                    <ChevronsUpDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Rechercher un site..." />
                    <CommandList>
                      <CommandEmpty>Aucun site trouvé</CommandEmpty>
                      <CommandGroup>
                        {branches.map(b => (
                          <CommandItem
                            key={b.id}
                            value={b.name}
                            onSelect={() => toggleBranch(b.id)}
                            className="cursor-pointer"
                          >
                            <Check className={`mr-2 h-4 w-4 ${selectedBranchIds.includes(b.id) ? "opacity-100" : "opacity-0"}`} />
                            {b.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {selectedBranchIds.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {selectedBranchIds.map(id => {
                    const b = branches.find(x => x.id === id);
                    return b ? (
                      <Badge key={id} variant="secondary" className="text-xs gap-1">
                        {b.name}
                        <button
                          type="button"
                          className="hover:text-destructive leading-none"
                          onClick={() => toggleBranch(id)}
                        >×</button>
                      </Badge>
                    ) : null;
                  })}
                </div>
              )}
            </div>

            <div className="grid grid-cols-4 gap-4">
              <div><Label>Prix coût (DA)</Label><Input type="number" value={form.costPrice} onChange={e => setForm(f => ({ ...f, costPrice: e.target.value }))} /></div>
              <div><Label>Prix vente (DA)</Label><Input type="number" value={form.sellingPrice} onChange={e => setForm(f => ({ ...f, sellingPrice: e.target.value }))} /></div>
              <div>
                <Label>Marge</Label>
                {(() => {
                  const cost = parseFloat(form.costPrice);
                  const sell = parseFloat(form.sellingPrice);
                  if (!form.costPrice || !form.sellingPrice || isNaN(cost) || isNaN(sell) || cost === 0 || sell === 0) {
                    return <div className="flex h-9 items-center rounded-md border bg-muted px-3 text-sm text-muted-foreground">—</div>;
                  }
                  const marge = ((sell - cost) / cost) * 100;
                  return (
                    <div className={`flex h-9 items-center rounded-md border bg-muted px-3 text-sm font-medium ${marge < 0 ? "text-red-500" : "text-foreground"}`}>
                      {marge.toFixed(1)}%
                    </div>
                  );
                })()}
              </div>
              <div><Label>Seuil alerte</Label><Input type="number" step="0.001" value={form.alertQuantity} onChange={e => setForm(f => ({ ...f, alertQuantity: e.target.value }))} /></div>
            </div>
            <div><Label>Référence SKU</Label><Input value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} /></div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer"><Checkbox checked={form.isSellable} onCheckedChange={v => setForm(f => ({ ...f, isSellable: !!v }))} />Vendable</label>
              <label className="flex items-center gap-2 text-sm cursor-pointer"><Checkbox checked={form.isPurchasable} onCheckedChange={v => setForm(f => ({ ...f, isPurchasable: !!v }))} />Achetable</label>
              <label className="flex items-center gap-2 text-sm cursor-pointer"><Checkbox checked={form.isFabricated} onCheckedChange={v => setForm(f => ({ ...f, isFabricated: !!v }))} />Fabriqué</label>
              <label className="flex items-center gap-2 text-sm cursor-pointer"><Checkbox checked={(form as any).isInternalConsumable} onCheckedChange={v => setForm(f => ({ ...f, isInternalConsumable: !!v }))} />Consommable interne</label>
            </div>
            <div><Label>Description</Label><Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>

            {/* Replenishment Rules */}
            {branches.length > 0 && (() => {
              const DAYS: { key: DayKey; label: string }[] = [
                { key: "targetDim", label: "Dim" },
                { key: "targetLun", label: "Lun" },
                { key: "targetMar", label: "Mar" },
                { key: "targetMer", label: "Mer" },
                { key: "targetJeu", label: "Jeu" },
                { key: "targetVen", label: "Ven" },
                { key: "targetSat", label: "Sam" },
              ];
              return (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center gap-2">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Réapprovisionnement automatique</span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                  <p className="text-xs text-muted-foreground">Cochez les boutiques et définissez la cible par jour.</p>
                  <div className="space-y-2">
                    {branches.map(b => {
                      const rule = replenishmentRules[b.id] ?? EMPTY_DAYS;
                      const enabled = enabledReplenishBranches.has(b.id);
                      return (
                        <div key={b.id} className="rounded-md border overflow-hidden">
                          <label className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/40 select-none">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-gray-300 accent-amber-600"
                              checked={enabled}
                              onChange={e => {
                                setEnabledReplenishBranches(prev => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(b.id); else next.delete(b.id);
                                  return next;
                                });
                                if (!e.target.checked) {
                                  setReplenishmentRules(prev => ({ ...prev, [b.id]: { ...EMPTY_DAYS } }));
                                } else if (!replenishmentRules[b.id]) {
                                  setReplenishmentRules(prev => ({ ...prev, [b.id]: { ...EMPTY_DAYS } }));
                                }
                              }}
                            />
                            <span className="text-sm font-medium">{b.name}</span>
                          </label>
                          {enabled && (
                            <div className="border-t bg-muted/20 px-3 py-2 space-y-1">
                              {DAYS.map(d => (
                                <div key={d.key} className="flex items-center gap-3">
                                  <span className="w-8 text-xs font-semibold text-muted-foreground">{d.label}</span>
                                  <Input
                                    type="number" min="0" step="1"
                                    className="h-7 text-sm flex-1"
                                    placeholder="0"
                                    value={rule[d.key]}
                                    onChange={e => setReplenishmentRules(prev => ({
                                      ...prev,
                                      [b.id]: { ...(prev[b.id] ?? EMPTY_DAYS), [d.key]: e.target.value }
                                    }))}
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
            <Button onClick={save} disabled={!form.name || createMutation.isPending || updateMutation.isPending || imageUploading}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Catalog Purge Dialog ── */}
      <Dialog open={purgeOpen} onOpenChange={v => { if (!v) { setPurgeWord(""); } setPurgeOpen(v); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-4 w-4" />
              {purgeResult ? "Suppression terminée" : "Supprimer le catalogue actuel"}
            </DialogTitle>
          </DialogHeader>

          {!purgeResult ? (
            <div className="space-y-4 py-2">
              <div className="rounded-lg border-2 border-destructive/30 bg-destructive/5 p-4 space-y-2">
                <p className="text-sm font-semibold text-destructive">⚠ Action irréversible</p>
                <p className="text-xs text-destructive/80">Cette action supprimera définitivement le catalogue produit actuel et toutes les données de test liées :</p>
                <ul className="text-xs text-destructive/70 space-y-0.5 list-disc list-inside">
                  <li>Tous les produits</li>
                  <li>Ventes, achats, retours et leurs lignes</li>
                  <li>Stocks, mouvements, ajustements</li>
                  <li>Transferts, production, recettes</li>
                  <li>Sessions POS et paiements</li>
                </ul>
                <p className="text-xs text-muted-foreground pt-1">Conservés : branches, utilisateurs, rôles, contacts, unités, catégories, paramètres.</p>
              </div>
              <div>
                <Label>Tapez <span className="font-mono font-bold text-destructive">DELETE CURRENT PRODUCTS</span> pour confirmer</Label>
                <Input
                  className="mt-1.5 font-mono border-destructive/40 focus-visible:ring-destructive/30"
                  value={purgeWord}
                  onChange={e => setPurgeWord(e.target.value)}
                  placeholder="DELETE CURRENT PRODUCTS"
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPurgeOpen(false)}>Annuler</Button>
                <Button
                  variant="destructive"
                  disabled={purgeWord !== "DELETE CURRENT PRODUCTS" || purgeLoading}
                  onClick={runPurge}
                >
                  {purgeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Supprimer définitivement"}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-center">
                <p className="text-2xl font-bold text-green-600">{purgeResult.products_deleted}</p>
                <p className="text-sm text-green-700">produits supprimés</p>
                <p className="text-xs text-green-600 mt-1">{purgeResult.products_remaining === 0 ? "✓ Catalogue vide — prêt pour l'import CSV" : `⚠ ${purgeResult.products_remaining} produits restants`}</p>
              </div>
              <div className="rounded border divide-y text-xs">
                {Object.entries(purgeResult)
                  .filter(([k, v]) => !["products_before","products_deleted","products_remaining"].includes(k) && (v as number) > 0)
                  .map(([k, v]) => (
                    <div key={k} className="flex justify-between px-3 py-1.5">
                      <span className="text-muted-foreground">{k.replace(/_/g, " ")}</span>
                      <span className="font-medium">{String(v)}</span>
                    </div>
                  ))}
              </div>
              <DialogFooter>
                <Button onClick={() => { setPurgeOpen(false); setPurgeResult(null); }}>Fermer</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Import CSV Dialog ── */}
      <Dialog open={importOpen} onOpenChange={v => { if (!v) resetImportDialog(); setImportOpen(v); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              {importStep === "upload" && "Importer CSV — Charger le fichier"}
              {importStep === "preview" && "Importer CSV — Aperçu"}
              {importStep === "confirm" && (importResult ? "Import terminé" : "Confirmer la réinitialisation")}
            </DialogTitle>
          </DialogHeader>

          {importStep === "upload" && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-700">Cette action va archiver tous les produits actuels et importer ceux du fichier CSV. Les unités du CSV seront préservées telles quelles.</p>
              </div>
              <div>
                <Label>Fichier CSV (format export Pacane)</Label>
                <div
                  className="mt-1.5 border-2 border-dashed border-muted-foreground/30 rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => csvInputRef.current?.click()}
                >
                  {importFile ? (
                    <div className="text-sm font-medium text-primary">{importFile.name}</div>
                  ) : (
                    <>
                      <Upload className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
                      <p className="text-sm text-muted-foreground">Cliquer pour sélectionner le fichier CSV</p>
                    </>
                  )}
                </div>
                <input ref={csvInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={e => setImportFile(e.target.files?.[0] ?? null)} />
              </div>
              <p className="text-xs text-muted-foreground">✓ Les unités seront importées depuis le fichier CSV, même pour les produits finis.</p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setImportOpen(false)}>Annuler</Button>
                <Button onClick={runPreview} disabled={!importFile || importLoading}>
                  {importLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Prévisualiser"}
                </Button>
              </DialogFooter>
            </div>
          )}

          {importStep === "preview" && importPreview && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-muted/50 p-3 text-center">
                  <p className="text-2xl font-bold text-primary">{importPreview.totalRows}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Produits à importer</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3 text-center">
                  <p className="text-2xl font-bold text-amber-600">{importPreview.currentProductCount}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Produits actuels (seront archivés)</p>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium mb-1.5">Unités détectées</p>
                <div className="flex flex-wrap gap-1.5">
                  {importPreview.units.map((u: any) => (
                    <Badge key={u.name} variant="secondary" className="text-xs">{u.name}: {u.count}</Badge>
                  ))}
                </div>
              </div>
              {importPreview.categories.length > 0 && (
                <div>
                  <p className="text-xs font-medium mb-1.5">Catégories détectées</p>
                  <div className="flex flex-wrap gap-1.5">
                    {importPreview.categories.map((c: string) => <Badge key={c} variant="outline" className="text-xs">{c}</Badge>)}
                  </div>
                </div>
              )}
              {importPreview.duplicateSKUs.length > 0 && (
                <p className="text-xs text-amber-600">⚠ {importPreview.duplicateSKUs.length} SKU(s) en double dans le CSV (seront ignorés)</p>
              )}
              <div>
                <p className="text-xs font-medium mb-1.5">Aperçu (5 premières lignes)</p>
                <div className="rounded border text-xs overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-muted/50"><tr><th className="px-2 py-1 text-left">Produit</th><th className="px-2 py-1">Unité</th><th className="px-2 py-1">Catégorie</th></tr></thead>
                    <tbody>
                      {importPreview.preview.map((p: any, i: number) => (
                        <tr key={i} className="border-t"><td className="px-2 py-1">{p.name}</td><td className="px-2 py-1 text-center">{p.unit}</td><td className="px-2 py-1">{p.category || "—"}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setImportStep("upload")}>Retour</Button>
                <Button onClick={() => { setConfirmWord(""); setImportStep("confirm"); }} variant="destructive">Continuer</Button>
              </DialogFooter>
            </div>
          )}

          {importStep === "confirm" && !importResult && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-sm font-medium text-destructive">Action irréversible</p>
                <p className="text-xs text-destructive/80 mt-1">Les {importPreview?.currentProductCount ?? "?"} produits actuels seront archivés et remplacés par {importPreview?.totalRows ?? "?"} produits du CSV.</p>
              </div>
              <div>
                <Label>Tapez <span className="font-mono font-bold">RESET PRODUITS</span> pour confirmer</Label>
                <Input className="mt-1.5 font-mono" value={confirmWord} onChange={e => setConfirmWord(e.target.value)} placeholder="RESET PRODUITS" />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setImportStep("preview")}>Retour</Button>
                <Button onClick={runImport} disabled={confirmWord !== "RESET PRODUITS" || importLoading} variant="destructive">
                  {importLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Réinitialiser et importer"}
                </Button>
              </DialogFooter>
            </div>
          )}

          {importStep === "confirm" && importResult && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg bg-green-50 p-3"><p className="text-xl font-bold text-green-600">{importResult.createdCount}</p><p className="text-xs text-muted-foreground">Créés</p></div>
                <div className="rounded-lg bg-blue-50 p-3"><p className="text-xl font-bold text-blue-600">{importResult.updatedCount}</p><p className="text-xs text-muted-foreground">Mis à jour</p></div>
                <div className="rounded-lg bg-gray-50 p-3"><p className="text-xl font-bold text-gray-500">{importResult.archivedCount}</p><p className="text-xs text-muted-foreground">Archivés</p></div>
              </div>
              {importResult.createdUnits?.length > 0 && <p className="text-xs text-muted-foreground">Unités créées: {importResult.createdUnits.join(", ")}</p>}
              {importResult.createdCategories?.length > 0 && <p className="text-xs text-muted-foreground">Catégories créées: {importResult.createdCategories.join(", ")}</p>}
              <p className="text-xs text-green-600">✓ Unités du CSV préservées — aucun forçage vers Pièce.</p>
              <DialogFooter>
                <Button onClick={() => { resetImportDialog(); setImportOpen(false); }}>Fermer</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={bulkUnitOpen} onOpenChange={setBulkUnitOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Changer l'unité</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">{selectedIds.length} produit{selectedIds.length > 1 ? "s" : ""} sélectionné{selectedIds.length > 1 ? "s" : ""}</p>
            <div>
              <Label>Nouvelle unité</Label>
              <Select value={bulkUnitId} onValueChange={setBulkUnitId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Choisir une unité" /></SelectTrigger>
                <SelectContent>
                  {units.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name} ({u.abbreviation})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {allFinished && pieceUnitId && bulkUnitId !== pieceUnitId && (
              <p className="text-xs text-amber-600 bg-amber-50 rounded px-3 py-2">Attention : les produits finis doivent normalement utiliser Pièce.</p>
            )}
            {allFinished && pieceUnitId && (
              <p className="text-xs text-muted-foreground">Les produits sélectionnés sont des produits finis.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkUnitOpen(false)}>Annuler</Button>
            <Button onClick={applyBulkUnit} disabled={bulkUnitId === "none" || bulkLoading}>
              {bulkLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Appliquer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={open => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer le produit ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. Le produit sera définitivement supprimé.
              La suppression échouera si le produit a encore du stock ou est lié à des commandes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleteLoading} className="bg-destructive hover:bg-destructive/90">
              {deleteLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
