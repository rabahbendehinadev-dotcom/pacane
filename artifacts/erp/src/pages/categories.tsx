import { useState } from "react";
import { useGetCategories, useCreateCategory, useUpdateCategory, getGetCategoriesQueryKey, customFetch } from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Edit2, Tag, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export default function Categories() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", parentId: "none" });
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);

  const { data: categories = [], isLoading } = useGetCategories();

  const createMutation = useCreateCategory({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetCategoriesQueryKey() }); setDialogOpen(false); toast({ title: "Catégorie créée" }); } } });
  const updateMutation = useUpdateCategory({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetCategoriesQueryKey() }); setDialogOpen(false); toast({ title: "Catégorie mise à jour" }); } } });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => customFetch(`/api/categories/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getGetCategoriesQueryKey() });
      setDeleteTarget(null);
      toast({ title: "Catégorie supprimée" });
    },
    onError: (err: any) => {
      setDeleteTarget(null);
      toast({ title: "Impossible de supprimer", description: err?.message ?? "Cette catégorie est utilisée", variant: "destructive" });
    },
  });

  function openNew() { setEditingId(null); setForm({ name: "", parentId: "none" }); setDialogOpen(true); }
  function openEdit(c: any) { setEditingId(c.id); setForm({ name: c.name, parentId: c.parentId?.toString() ?? "none" }); setDialogOpen(true); }
  function save() {
    const data = { name: form.name, parentId: form.parentId && form.parentId !== "none" ? parseInt(form.parentId) : null };
    if (editingId) { updateMutation.mutate({ id: editingId, data }); }
    else { createMutation.mutate({ data }); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold">Catégories</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{categories.length} catégorie{categories.length !== 1 ? "s" : ""}</p>
        </div>
        <Button onClick={openNew} className="gap-2"><Plus className="h-4 w-4" />Nouvelle catégorie</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Catégorie parente</TableHead>
                <TableHead>Produits</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={4} className="text-center py-12 text-muted-foreground">Chargement...</TableCell></TableRow>
              ) : categories.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center py-12 text-muted-foreground">Aucune catégorie</TableCell></TableRow>
              ) : categories.map(c => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {c.parentId && <span className="text-muted-foreground ml-4">└</span>}
                      <Tag className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-sm">{c.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{c.parentName ?? "—"}</TableCell>
                  <TableCell className="text-sm">{c.productCount}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(c)}>
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setDeleteTarget({ id: c.id, name: c.name })}
                      >
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

      {/* Dialog création / modification */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{editingId ? "Modifier la catégorie" : "Nouvelle catégorie"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Nom *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div>
              <Label>Catégorie parente</Label>
              <Select value={form.parentId} onValueChange={v => setForm(f => ({ ...f, parentId: v }))}>
                <SelectTrigger><SelectValue placeholder="Aucune (racine)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Aucune</SelectItem>
                  {categories.filter(c => !c.parentId && c.id !== editingId).map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
            <Button onClick={save} disabled={!form.name}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation suppression */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer la catégorie</AlertDialogTitle>
            <AlertDialogDescription>
              Voulez-vous vraiment supprimer <strong>"{deleteTarget?.name}"</strong> ?
              <br />Cette action est irréversible. La suppression sera refusée si des produits utilisent encore cette catégorie.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
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
