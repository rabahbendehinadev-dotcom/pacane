import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Edit2, UserX, UserCheck, HardHat, Search } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const AUTH = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` });

interface Worker {
  id: number;
  name: string;
  isActive: boolean;
  productCount: number;
  createdAt: string;
}

async function fetchWorkers(): Promise<Worker[]> {
  const r = await fetch("/api/workers", { headers: AUTH() });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export default function WorkersPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Worker | null>(null);
  const [formName, setFormName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<Worker | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  const { data: workers = [], isLoading } = useQuery<Worker[]>({
    queryKey: ["workers"],
    queryFn: fetchWorkers,
  });

  const filtered = workers.filter(w => w.name.toLowerCase().includes(search.toLowerCase()));

  function openNew() {
    setEditing(null);
    setFormName("");
    setDialogOpen(true);
  }

  function openEdit(w: Worker) {
    setEditing(w);
    setFormName(w.name);
    setDialogOpen(true);
  }

  async function save() {
    if (!formName.trim()) { toast({ title: "Nom requis", variant: "destructive" }); return; }
    setSaving(true);
    try {
      if (editing) {
        const r = await fetch(`/api/workers/${editing.id}`, { method: "PATCH", headers: AUTH(), body: JSON.stringify({ name: formName.trim() }) });
        if (!r.ok) throw new Error((await r.json()).error);
        toast({ title: "Ouvrier mis à jour" });
      } else {
        const r = await fetch("/api/workers", { method: "POST", headers: AUTH(), body: JSON.stringify({ name: formName.trim() }) });
        if (!r.ok) throw new Error((await r.json()).error);
        toast({ title: "Ouvrier créé" });
      }
      qc.invalidateQueries({ queryKey: ["workers"] });
      setDialogOpen(false);
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function toggleActive(w: Worker) {
    if (w.isActive) {
      setDeactivateTarget(w);
    } else {
      try {
        const r = await fetch(`/api/workers/${w.id}/activate`, { method: "PATCH", headers: AUTH() });
        if (!r.ok) throw new Error((await r.json()).error);
        toast({ title: "Ouvrier réactivé" });
        qc.invalidateQueries({ queryKey: ["workers"] });
      } catch (err: any) {
        toast({ title: "Erreur", description: err.message, variant: "destructive" });
      }
    }
  }

  async function confirmDeactivate() {
    if (!deactivateTarget) return;
    setDeactivating(true);
    try {
      const r = await fetch(`/api/workers/${deactivateTarget.id}/deactivate`, { method: "PATCH", headers: AUTH() });
      if (!r.ok) throw new Error((await r.json()).error);
      toast({ title: "Ouvrier désactivé" });
      qc.invalidateQueries({ queryKey: ["workers"] });
      setDeactivateTarget(null);
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    } finally { setDeactivating(false); }
  }

  const activeCount = workers.filter(w => w.isActive).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold">Ouvriers</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {activeCount} actif{activeCount !== 1 ? "s" : ""} · {workers.length} au total
          </p>
        </div>
        <Button onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" />Nouvel ouvrier
        </Button>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher un ouvrier..."
              className="pl-9"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Produits associés</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-12 text-muted-foreground">Chargement...</TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-12 text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <HardHat className="h-8 w-8 text-muted-foreground/40" />
                      <p>{search ? "Aucun résultat" : "Aucun ouvrier enregistré"}</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : filtered.map(w => (
                <TableRow key={w.id} className={`hover:bg-muted/40 ${!w.isActive ? "opacity-60" : ""}`}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <HardHat className="h-4 w-4 text-primary" />
                      </div>
                      <span className="font-medium text-sm">{w.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {w.isActive ? (
                      <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-xs">Actif</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">Désactivé</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {w.productCount > 0 ? (
                      <span className="font-medium">{w.productCount} produit{w.productCount !== 1 ? "s" : ""}</span>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(w)} title="Modifier">
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`h-7 w-7 ${w.isActive ? "text-amber-600 hover:text-amber-700 hover:bg-amber-50" : "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"}`}
                        onClick={() => toggleActive(w)}
                        title={w.isActive ? "Désactiver" : "Réactiver"}
                      >
                        {w.isActive ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing ? "Modifier l'ouvrier" : "Nouvel ouvrier"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nom complet <span className="text-destructive">*</span></Label>
              <Input
                className="mt-1"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder="Ex : Ahmed Benali"
                onKeyDown={e => e.key === "Enter" && save()}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
            <Button onClick={save} disabled={saving || !formName.trim()}>
              {saving ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deactivate confirmation */}
      <AlertDialog open={!!deactivateTarget} onOpenChange={v => !v && setDeactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Désactiver l'ouvrier ?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deactivateTarget?.name}</strong> sera désactivé(e).
              {(deactivateTarget?.productCount ?? 0) > 0 && (
                <> Ses <strong>{deactivateTarget?.productCount}</strong> produit{deactivateTarget?.productCount !== 1 ? "s" : ""} associé{deactivateTarget?.productCount !== 1 ? "s" : ""} conserveront ce lien mais il/elle ne pourra plus être affecté(e) à de nouveaux produits.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeactivate}
              disabled={deactivating}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {deactivating ? "..." : "Désactiver"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
