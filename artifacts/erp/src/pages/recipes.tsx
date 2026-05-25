import { useState } from "react";
import { useGetRecipes, useCreateRecipe, useUpdateRecipe, useGetProducts, useGetUnits, getGetRecipesQueryKey, Recipe } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Eye, Edit2, Trash2, ChefHat } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type Ingredient = { productId: number; productName: string; quantity: string; unitId: number; unitName: string; wastageRate: string };
function formatDA(n: number) { return new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(n) + " DA"; }

export default function Recipes() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailRecipe, setDetailRecipe] = useState<Recipe | null>(null);
  const [editing, setEditing] = useState<Recipe | null>(null);
  const [form, setForm] = useState({ name: "", type: "finished", yield: "", yieldUnitId: "", productId: "", steps: "", notes: "" });
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [newIng, setNewIng] = useState({ productId: "", quantity: "", unitId: "", wastageRate: "0" });

  const { data: recipes = [], isLoading } = useGetRecipes({});
  const { data: products = [] } = useGetProducts({});
  const { data: units = [] } = useGetUnits();
  const createMutation = useCreateRecipe({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetRecipesQueryKey() }); setDialogOpen(false); toast({ title: "Recette créée" }); } } });
  const updateMutation = useUpdateRecipe({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetRecipesQueryKey() }); setDialogOpen(false); toast({ title: "Recette mise à jour" }); } } });

  function openNew() {
    setEditing(null);
    setForm({ name: "", type: "finished", yield: "", yieldUnitId: "", productId: "none", steps: "", notes: "" });
    setIngredients([]);
    setDialogOpen(true);
  }
  function openEdit(r: Recipe) {
    setEditing(r);
    setForm({ name: r.name, type: r.type, yield: r.yield.toString(), yieldUnitId: r.yieldUnitId.toString(), productId: r.productId?.toString() ?? "none", steps: r.steps ?? "", notes: r.notes ?? "" });
    setIngredients(r.ingredients.map(i => ({ productId: i.productId, productName: i.productName, quantity: i.quantity.toString(), unitId: i.unitId, unitName: i.unitName, wastageRate: i.wastageRate.toString() })));
    setDialogOpen(true);
  }
  function addIng() {
    if (!newIng.productId || !newIng.quantity || !newIng.unitId) return;
    const product = products.find(p => p.id === parseInt(newIng.productId));
    const unit = units.find(u => u.id === parseInt(newIng.unitId));
    if (!product || !unit) return;
    setIngredients(i => [...i, { productId: parseInt(newIng.productId), productName: product.name, quantity: newIng.quantity, unitId: parseInt(newIng.unitId), unitName: unit.abbreviation, wastageRate: newIng.wastageRate }]);
    setNewIng({ productId: "", quantity: "", unitId: "", wastageRate: "0" });
  }
  function save() {
    const data = {
      name: form.name, type: form.type as any, yield: parseFloat(form.yield), yieldUnitId: parseInt(form.yieldUnitId),
      productId: form.productId && form.productId !== "none" ? parseInt(form.productId) : null,
      steps: form.steps || null, notes: form.notes || null,
      ingredients: ingredients.map(i => ({ productId: i.productId, quantity: parseFloat(i.quantity), unitId: i.unitId, wastageRate: parseFloat(i.wastageRate) }))
    };
    if (editing) { updateMutation.mutate({ id: editing.id, data }); }
    else { createMutation.mutate({ data }); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold">Recettes</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{recipes.length} recette{recipes.length !== 1 ? "s" : ""}</p>
        </div>
        <Button onClick={openNew} className="gap-2"><Plus className="h-4 w-4" />Nouvelle recette</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading ? <p className="text-muted-foreground">Chargement...</p> : recipes.length === 0 ? (
          <Card className="col-span-3"><CardContent className="text-center py-12 text-muted-foreground">Aucune recette</CardContent></Card>
        ) : recipes.map(r => (
          <Card key={r.id} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 rounded-full bg-amber-100 flex items-center justify-center">
                    <ChefHat className="h-4 w-4 text-amber-600" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{r.name}</CardTitle>
                    {r.productName && <p className="text-xs text-muted-foreground">{r.productName}</p>}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDetailRecipe(r)}><Eye className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(r)}><Edit2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{r.ingredients.length} ingrédients</span>
                <span className="font-semibold">{formatDA(r.theoreticalCost)}</span>
              </div>
              <div className="flex items-center justify-between text-sm mt-1">
                <span className="text-muted-foreground">Rendement</span>
                <span>{r.yield} {r.yieldUnitName}</span>
              </div>
              <Badge variant={r.type === "finished" ? "default" : "secondary"} className="mt-2 text-xs">
                {r.type === "finished" ? "Produit fini" : "Semi-fini"}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Detail dialog */}
      {detailRecipe && (
        <Dialog open={!!detailRecipe} onOpenChange={() => setDetailRecipe(null)}>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{detailRecipe.name}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><p className="text-muted-foreground">Rendement</p><p className="font-medium">{detailRecipe.yield} {detailRecipe.yieldUnitName}</p></div>
                <div><p className="text-muted-foreground">Coût théorique</p><p className="font-medium text-amber-600">{formatDA(detailRecipe.theoreticalCost)}</p></div>
              </div>
              <div>
                <p className="text-sm font-medium mb-2">Ingrédients</p>
                <Table><TableBody>
                  {detailRecipe.ingredients.map(i => (
                    <TableRow key={i.id}>
                      <TableCell className="text-sm py-2">{i.productName}</TableCell>
                      <TableCell className="text-sm py-2 font-mono">{i.quantity} {i.unitName}</TableCell>
                      <TableCell className="text-sm py-2 text-muted-foreground">Perte: {i.wastageRate}%</TableCell>
                      <TableCell className="text-sm py-2 text-right">{formatDA(i.totalCost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody></Table>
              </div>
              {detailRecipe.steps && (
                <div><p className="text-sm font-medium mb-1">Instructions</p><p className="text-sm text-muted-foreground whitespace-pre-wrap">{detailRecipe.steps}</p></div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Create/Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Modifier la recette" : "Nouvelle recette"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Nom *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div>
                <Label>Type *</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="finished">Produit fini</SelectItem><SelectItem value="semi_finished">Semi-fini</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Produit associé</Label>
                <Select value={form.productId} onValueChange={v => setForm(f => ({ ...f, productId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Aucun" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Aucun</SelectItem>
                    {products.filter(p => p.isFabricated).map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Rendement *</Label><Input type="number" step="0.001" value={form.yield} onChange={e => setForm(f => ({ ...f, yield: e.target.value }))} /></div>
              <div>
                <Label>Unité rendement *</Label>
                <Select value={form.yieldUnitId} onValueChange={v => setForm(f => ({ ...f, yieldUnitId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Choisir..." /></SelectTrigger>
                  <SelectContent>{units.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name} ({u.abbreviation})</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="border rounded-lg p-3 space-y-3">
              <p className="text-sm font-medium">Ingrédients</p>
              {ingredients.length > 0 && (
                <Table><TableBody>
                  {ingredients.map((ing, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-sm py-2">{ing.productName}</TableCell>
                      <TableCell className="text-sm py-2">{ing.quantity} {ing.unitName}</TableCell>
                      <TableCell className="text-sm py-2 text-muted-foreground">Perte: {ing.wastageRate}%</TableCell>
                      <TableCell className="py-2"><Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIngredients(ingredients.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody></Table>
              )}
              <div className="flex gap-2">
                <Select value={newIng.productId} onValueChange={v => setNewIng(n => ({ ...n, productId: v }))}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Ingrédient..." /></SelectTrigger>
                  <SelectContent>{products.filter(p => p.isPurchasable || p.type === "ingredient").map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
                <Input type="number" step="0.001" className="w-20" placeholder="Qté" value={newIng.quantity} onChange={e => setNewIng(n => ({ ...n, quantity: e.target.value }))} />
                <Select value={newIng.unitId} onValueChange={v => setNewIng(n => ({ ...n, unitId: v }))}>
                  <SelectTrigger className="w-20"><SelectValue placeholder="U" /></SelectTrigger>
                  <SelectContent>{units.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.abbreviation}</SelectItem>)}</SelectContent>
                </Select>
                <Input type="number" step="0.1" className="w-20" placeholder="Perte %" value={newIng.wastageRate} onChange={e => setNewIng(n => ({ ...n, wastageRate: e.target.value }))} />
                <Button variant="outline" size="sm" onClick={addIng}>+</Button>
              </div>
            </div>
            <div><Label>Instructions</Label><Textarea value={form.steps} onChange={e => setForm(f => ({ ...f, steps: e.target.value }))} rows={3} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
            <Button onClick={save} disabled={!form.name || !form.yield || !form.yieldUnitId || ingredients.length === 0}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
