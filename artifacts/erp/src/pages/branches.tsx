import { useState } from "react";
import { useGetBranches, useCreateBranch, useUpdateBranch, getGetBranchesQueryKey, customFetch, type Branch } from "@workspace/api-client-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Edit2, Trash2, Store, Factory, Warehouse, Building2, Search, AlertCircle, CheckCircle2, Clock, ShoppingCart, Star } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";

const EMPTY = {
  name: "", code: "", type: "shop", address: "", city: "", phone: "",
  isActive: true, isMain: false,
  posEnabled: true, requireOpenSession: false, salesActive: true,
};

const BRANCH_TYPES: Record<string, { label: string; icon: React.ComponentType<any>; color: string }> = {
  shop: { label: "Boutique", icon: Store, color: "bg-blue-100 text-blue-700" },
  lab: { label: "Laboratoire", icon: Factory, color: "bg-amber-100 text-amber-700" },
  warehouse: { label: "Entrepôt", icon: Warehouse, color: "bg-purple-100 text-purple-700" },
  office: { label: "Bureau", icon: Building2, color: "bg-gray-100 text-gray-700" },
  central: { label: "Siège", icon: Building2, color: "bg-slate-100 text-slate-700" },
};

function TypeBadge({ type }: { type: string }) {
  const meta = BRANCH_TYPES[type] ?? BRANCH_TYPES.shop;
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${meta.color}`}>
      <Icon className="h-3.5 w-3.5" />{meta.label}
    </span>
  );
}

function PosBadge({ posEnabled, salesActive }: { posEnabled: boolean; salesActive: boolean }) {
  if (!salesActive) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
      <AlertCircle className="h-3 w-3" />Ventes OFF
    </span>
  );
  if (!posEnabled) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-600">
      <AlertCircle className="h-3 w-3" />POS OFF
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
      <CheckCircle2 className="h-3 w-3" />POS actif
    </span>
  );
}

export default function Branches() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [deletingBranch, setDeletingBranch] = useState<Branch | null>(null);

  const defaultBranchMutation = useMutation({
    mutationFn: (branchId: number | null) =>
      customFetch("/api/auth/me/default-branch", { method: "PATCH", body: JSON.stringify({ branchId }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["auth-me"] });
      toast({ title: "Boutique par défaut mise à jour" });
    },
    onError: (e: any) => toast({ title: "Erreur", description: e?.message, variant: "destructive" }),
  });

  const { data: branches = [], isLoading } = useGetBranches();

  const createMutation = useCreateBranch({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetBranchesQueryKey() });
        setDialogOpen(false);
        toast({ title: "Boutique créée" });
      },
      onError: (e: any) => {
        toast({ title: "Erreur", description: (e?.data as any)?.error ?? "Erreur de création", variant: "destructive" });
      }
    }
  });

  const updateMutation = useUpdateBranch({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetBranchesQueryKey() });
        setDialogOpen(false);
        toast({ title: "Boutique mise à jour" });
      }
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => customFetch(`/api/branches/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getGetBranchesQueryKey() });
      setDeletingBranch(null);
      toast({ title: "Boutique supprimée définitivement" });
    },
    onError: (e: any) => {
      setDeletingBranch(null);
      toast({ title: "Erreur", description: e?.message ?? "Impossible de supprimer", variant: "destructive" });
    },
  });

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY });
    setDialogOpen(true);
  }

  function openEdit(b: Branch) {
    setEditing(b);
    setForm({
      name: b.name, code: b.code, type: b.type, address: b.address ?? "",
      city: b.city ?? "", phone: b.phone ?? "", isActive: b.isActive, isMain: b.isMain,
      posEnabled: (b as any).posEnabled ?? true,
      requireOpenSession: (b as any).requireOpenSession ?? false,
      salesActive: (b as any).salesActive ?? true,
    });
    setDialogOpen(true);
  }

  function save() {
    const data = { ...form } as any;
    if (editing) {
      updateMutation.mutate({ id: editing.id, data });
    } else {
      createMutation.mutate({ data });
    }
  }

  const filtered = branches.filter(b =>
    b.name.toLowerCase().includes(search.toLowerCase()) ||
    b.code.toLowerCase().includes(search.toLowerCase()) ||
    (b.city ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-serif font-bold tracking-tight">Boutiques</h1>
          <p className="text-muted-foreground text-sm">Boutiques, laboratoires et entrepôts du réseau</p>
        </div>
        <Button onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" />Nouvelle boutique
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Rechercher..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="rounded-lg border bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead>Nom</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Ville</TableHead>
              <TableHead>POS</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">Chargement...</TableCell></TableRow>
            )}
            {!isLoading && filtered.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">Aucune boutique</TableCell></TableRow>
            )}
            {filtered.map(b => (
              <TableRow key={b.id} className="hover:bg-muted/20">
                <TableCell className="font-medium">
                  {b.name}
                  {b.isMain && <Badge variant="outline" className="ml-2 text-[10px]">Principale</Badge>}
                </TableCell>
                <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded">{b.code}</code></TableCell>
                <TableCell><TypeBadge type={b.type} /></TableCell>
                <TableCell className="text-muted-foreground">{b.city ?? "—"}</TableCell>
                <TableCell>
                  <PosBadge posEnabled={(b as any).posEnabled ?? true} salesActive={(b as any).salesActive ?? true} />
                  {(b as any).posEnabled && (b as any).salesActive && (b as any).requireOpenSession && (
                    <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] text-amber-600 font-medium">
                      <Clock className="h-2.5 w-2.5" />session requise
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={b.isActive ? "default" : "secondary"} className={b.isActive ? "bg-green-100 text-green-700 border-0" : ""}>
                    {b.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1 justify-end">
                    <Button
                      variant="ghost" size="icon"
                      className={`h-8 w-8 ${user?.defaultBranchId === b.id ? "text-amber-500" : "text-muted-foreground hover:text-amber-500"}`}
                      onClick={() => defaultBranchMutation.mutate(user?.defaultBranchId === b.id ? null : b.id)}
                      disabled={defaultBranchMutation.isPending}
                      title={user?.defaultBranchId === b.id ? "Retirer comme boutique par défaut" : "Définir comme boutique par défaut"}
                    >
                      <Star className={`h-3.5 w-3.5 ${user?.defaultBranchId === b.id ? "fill-amber-500" : ""}`} />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(b)}>
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="icon"
                      className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                      onClick={() => setDeletingBranch(b)}
                      disabled={b.isMain}
                      title={b.isMain ? "La boutique principale ne peut pas être supprimée" : "Supprimer définitivement"}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Modifier la boutique" : "Nouvelle boutique"}</DialogTitle>
            <DialogDescription>
              {editing ? `Modification de ${editing.name}` : "Ajoutez une boutique, un laboratoire ou un entrepôt."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* ─── Informations générales ─── */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Nom *</Label>
                <Input className="mt-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ex: Boutique Hydra" />
              </div>
              <div>
                <Label>Code *</Label>
                <Input className="mt-1" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="Ex: HYD01" />
              </div>
            </div>
            <div>
              <Label>Type</Label>
              <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(BRANCH_TYPES).map(([v, meta]) => (
                    <SelectItem key={v} value={v}>{meta.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Ville</Label>
                <Input className="mt-1" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="Ex: Alger" />
              </div>
              <div>
                <Label>Téléphone</Label>
                <Input className="mt-1" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+213..." />
              </div>
            </div>
            <div>
              <Label>Adresse</Label>
              <Input className="mt-1" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Rue, numéro, commune..." />
            </div>
            <div className="flex gap-6 pt-1">
              <label className="flex items-center gap-3 cursor-pointer">
                <Switch checked={form.isActive} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} />
                <span className="text-sm font-medium">Active</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <Switch checked={form.isMain} onCheckedChange={v => setForm(f => ({ ...f, isMain: v }))} />
                <span className="text-sm font-medium">Boutique principale</span>
              </label>
            </div>

            {/* ─── POS Configuration ─── */}
            <Separator />
            <div>
              <div className="flex items-center gap-2 mb-3">
                <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">Configuration point de vente</span>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <Switch
                    className="mt-0.5"
                    checked={form.salesActive}
                    onCheckedChange={v => setForm(f => ({ ...f, salesActive: v, posEnabled: v ? f.posEnabled : false }))}
                  />
                  <div>
                    <p className="text-sm font-medium">Ventes actives</p>
                    <p className="text-xs text-muted-foreground">Cette boutique peut traiter des ventes clients. Désactiver bloque toutes les ventes et le POS.</p>
                  </div>
                </label>

                <label className={`flex items-start gap-3 cursor-pointer ${!form.salesActive ? "opacity-40 pointer-events-none" : ""}`}>
                  <Switch
                    className="mt-0.5"
                    checked={form.posEnabled}
                    onCheckedChange={v => setForm(f => ({ ...f, posEnabled: v, requireOpenSession: v ? f.requireOpenSession : false }))}
                    disabled={!form.salesActive}
                  />
                  <div>
                    <p className="text-sm font-medium">Point de vente (POS) activé</p>
                    <p className="text-xs text-muted-foreground">Les opérateurs peuvent utiliser la caisse enregistreuse pour cette boutique.</p>
                  </div>
                </label>

                <label className={`flex items-start gap-3 cursor-pointer ${!form.posEnabled || !form.salesActive ? "opacity-40 pointer-events-none" : ""}`}>
                  <Switch
                    className="mt-0.5"
                    checked={form.requireOpenSession}
                    onCheckedChange={v => setForm(f => ({ ...f, requireOpenSession: v }))}
                    disabled={!form.posEnabled || !form.salesActive}
                  />
                  <div>
                    <p className="text-sm font-medium">Session de caisse obligatoire</p>
                    <p className="text-xs text-muted-foreground">Les ventes sont bloquées jusqu'à l'ouverture d'une session de caisse active. Recommandé pour le contrôle des espèces.</p>
                  </div>
                </label>

                {/* Visual summary */}
                <div className={`rounded-md px-3 py-2 text-xs font-medium mt-1 flex items-center gap-2 ${
                  !form.salesActive ? "bg-gray-100 text-gray-500" :
                  !form.posEnabled ? "bg-orange-50 text-orange-700" :
                  form.requireOpenSession ? "bg-amber-50 text-amber-700" :
                  "bg-green-50 text-green-700"
                }`}>
                  {!form.salesActive && <><AlertCircle className="h-3.5 w-3.5" /> Boutique non commerciale — aucune vente possible</>}
                  {form.salesActive && !form.posEnabled && <><AlertCircle className="h-3.5 w-3.5" /> Ventes actives mais sans caisse enregistreuse</>}
                  {form.salesActive && form.posEnabled && form.requireOpenSession && <><Clock className="h-3.5 w-3.5" /> POS actif — session obligatoire avant chaque vente</>}
                  {form.salesActive && form.posEnabled && !form.requireOpenSession && <><CheckCircle2 className="h-3.5 w-3.5" /> POS actif — ventes sans contrainte de session</>}
                </div>
              </div>
            </div>

          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
            <Button onClick={save} disabled={!form.name || !form.code || isPending}>
              {isPending ? "Enregistrement..." : editing ? "Mettre à jour" : "Créer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingBranch} onOpenChange={open => { if (!open) setDeletingBranch(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer définitivement ?</AlertDialogTitle>
            <AlertDialogDescription>
              La boutique <strong>{deletingBranch?.name}</strong> sera supprimée définitivement.
              Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => deletingBranch && deleteMutation.mutate(deletingBranch.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Suppression..." : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
