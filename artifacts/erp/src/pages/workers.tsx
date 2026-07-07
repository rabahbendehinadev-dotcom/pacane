import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Edit2, UserX, UserCheck, HardHat, Search, Phone } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const AUTH = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` });

interface Worker {
  id: number;
  name: string;
  phone: string | null;
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
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Worker | null>(null);
  const [formName, setFormName] = useState("");
  const [formPhone, setFormPhone] = useState("");
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
    setFormPhone("");
    setDialogOpen(true);
  }

  function openEdit(w: Worker) {
    setEditing(w);
    setFormName(w.name);
    setFormPhone(w.phone ?? "");
    setDialogOpen(true);
  }

  async function save() {
    if (!formName.trim()) { toast({ title: "Nom requis", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const body = { name: formName.trim(), phone: formPhone.trim() || null };
      if (editing) {
        const r = await fetch(`/api/workers/${editing.id}`, { method: "PATCH", headers: AUTH(), body: JSON.stringify(body) });
        if (!r.ok) throw new Error((await r.json()).error);
        toast({ title: "Ouvrier mis à jour" });
      } else {
        const r = await fetch("/api/workers", { method: "POST", headers: AUTH(), body: JSON.stringify(body) });
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
                <TableHead>WhatsApp / Téléphone</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Produits associés</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">Chargement...</TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <HardHat className="h-8 w-8 text-muted-foreground/40" />
                      <p>{search ? "Aucun résultat" : "Aucun ouvrier enregistré"}</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : filtered.map(w => (
                <TableRow key={w.id} className={`hover:bg-muted/40 ${!w.isActive ? "opacity-60" : ""}`}>
                  <TableCell>
                    <button
                      onClick={() => setLocation(`/workers/${w.id}`)}
                      className="flex items-center gap-2.5 text-left hover:text-primary group"
                    >
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                        <HardHat className="h-4 w-4 text-primary" />
                      </div>
                      <span className="font-medium text-sm group-hover:underline underline-offset-2">{w.name}</span>
                    </button>
                  </TableCell>
                  <TableCell>
                    {w.phone ? (
                      <a
                        href={`https://wa.me/${w.phone.replace(/\D/g, "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm text-emerald-600 hover:text-emerald-700 hover:underline"
                      >
                        <Phone className="h-3.5 w-3.5" />
                        {w.phone}
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground/50">—</span>
                    )}
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
            <div>
              <Label className="flex items-center gap-1.5">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-[#25D366]" xmlns="http://www.w3.org/2000/svg"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                Numéro WhatsApp
              </Label>
              <Input
                className="mt-1"
                value={formPhone}
                onChange={e => setFormPhone(e.target.value)}
                placeholder="Ex : 213555001234"
                dir="ltr"
              />
              <p className="text-xs text-muted-foreground mt-1">Sans espaces ni tirets, avec l'indicatif pays (ex: 213…)</p>
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
