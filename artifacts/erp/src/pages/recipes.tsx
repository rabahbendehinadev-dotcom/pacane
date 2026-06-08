import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useGetRecipes, useCreateRecipe, useUpdateRecipe, useGetProducts, useGetUnits, getGetRecipesQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Plus, Eye, Edit2, Trash2, ChefHat, Layers, Package, TrendingUp, RefreshCw, AlertTriangle, DollarSign, BarChart3 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type RecipeItem = {
  itemType: "product" | "recipe";
  itemId: number;
  itemName: string;
  quantity: string;
  unitId: number;
  unitName: string;
  wastageRate: string;
};

type Recipe = {
  id: number;
  name: string;
  type: string;
  productId?: number | null;
  productName?: string | null;
  sellingPrice?: number | null;
  yield: number;
  yieldUnitId: number;
  yieldUnitName: string;
  steps?: string | null;
  notes?: string | null;
  theoreticalCost: number;
  cachedTotalCost?: number | null;
  cachedCostPerUnit?: number | null;
  lastCostUpdate?: string | null;
  components: Array<{
    id?: number; itemType: string; itemId: number; itemName: string;
    productId?: number; productName?: string;
    quantity: number; unitId: number; unitName: string;
    wastageRate: number; totalCost?: number;
  }>;
  ingredients: Array<{
    id: number; productId: number; productName: string;
    quantity: number; unitId: number; unitName: string;
    wastageRate: number; totalCost: number;
  }>;
};

type CostLine = {
  itemType: string; itemId: number; itemName: string;
  quantity: number; unitAbbreviation: string;
  unitCostPrice: number; totalCost: number;
  wastageRate: number; nestingLevel: number; hasMissingCost: boolean;
};

type CostBreakdown = {
  recipeId: number; recipeName: string; quantity: number;
  lines: CostLine[];
  totalCost: number; costPerUnit: number;
  sellingPrice: number | null;
  profitPerUnit: number | null; marginPct: number | null;
  marginLevel: "green" | "orange" | "red" | null;
  warnings: string[];
  wasteCost: number; wasteAdjustedCost: number;
};

function formatDA(n: number) { return new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(n) + " DA"; }
function formatDA2(n: number) { return new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 2 }).format(n) + " DA"; }
function fmt3(n: number) { return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(n); }

const API = "/api";
function authHeaders() { return { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` }; }

function useRecipeCost(recipeId: number | null, quantity: number, wastePercentage = 0, enabled = false) {
  return useQuery<CostBreakdown>({
    queryKey: ["recipe-cost", recipeId, quantity, wastePercentage],
    queryFn: async () => {
      const r = await fetch(`${API}/recipes/${recipeId}/cost?quantity=${quantity}&waste=${wastePercentage}`, { headers: authHeaders() });
      if (!r.ok) throw new Error("Erreur calcul coût");
      return r.json();
    },
    enabled: !!recipeId && quantity > 0 && enabled,
    staleTime: 2 * 60 * 1000,
  });
}

const marginConfig = {
  green:  { cls: "text-green-700 bg-green-100", bar: "bg-green-500", label: "Bonne marge" },
  orange: { cls: "text-amber-700 bg-amber-100", bar: "bg-amber-500", label: "Marge correcte" },
  red:    { cls: "text-red-700 bg-red-100",     bar: "bg-red-500",   label: "Marge faible" },
};

function CostAnalysisPanel({ recipeId, quantity, yieldQty }: { recipeId: number; quantity: number; yieldQty: number }) {
  const [wastePercentage, setWastePercentage] = useState(0);
  const [enabled, setEnabled] = useState(false);
  const [forceRefresh, setForceRefresh] = useState(0);
  const { data: cost, isLoading, error, refetch } = useRecipeCost(recipeId, quantity, wastePercentage, enabled || forceRefresh > 0);

  function handleCalculate() {
    if (!enabled) { setEnabled(true); } else { setForceRefresh(f => f + 1); refetch(); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div>
          <Label className="text-xs">Pertes / gaspillage (%)</Label>
          <Input type="number" min="0" max="100" step="0.5" className="w-28 mt-1 h-8 text-sm"
            value={wastePercentage} onChange={e => setWastePercentage(parseFloat(e.target.value) || 0)} />
        </div>
        <div className="pt-5">
          <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={handleCalculate} disabled={isLoading}>
            {isLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <BarChart3 className="h-3.5 w-3.5" />}
            {isLoading ? "Calcul..." : "Calculer les coûts"}
          </Button>
        </div>
      </div>

      {error && <Alert variant="destructive"><AlertDescription>Impossible de calculer le coût.</AlertDescription></Alert>}

      {cost && (
        <div className="space-y-4">
          {cost.warnings.length > 0 && (
            <Alert className="border-amber-200 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-sm text-amber-700">
                <ul className="space-y-0.5">
                  {cost.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200 p-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">Coût total</p>
              <p className="text-lg font-bold text-amber-700">{formatDA(cost.totalCost)}</p>
              {cost.wasteCost > 0 && <p className="text-xs text-muted-foreground">dont pertes: {formatDA2(cost.wasteCost)}</p>}
            </div>
            <div className="rounded-lg border bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200 p-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">Coût/unité</p>
              <p className="text-lg font-bold text-blue-700">{formatDA2(cost.costPerUnit)}</p>
              <p className="text-xs text-muted-foreground">pour {fmt3(yieldQty)} u.</p>
            </div>
            {cost.sellingPrice != null && cost.marginPct != null ? (
              <div className={`rounded-lg border p-3 text-center ${cost.marginLevel === "green" ? "bg-green-50 border-green-200" : cost.marginLevel === "orange" ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200"}`}>
                <p className="text-xs text-muted-foreground mb-1">Marge</p>
                <p className={`text-lg font-bold ${cost.marginLevel === "green" ? "text-green-700" : cost.marginLevel === "orange" ? "text-amber-700" : "text-red-700"}`}>{cost.marginPct.toFixed(1)}%</p>
                <p className="text-xs text-muted-foreground">{formatDA2(cost.profitPerUnit ?? 0)}/u.</p>
              </div>
            ) : (
              <div className="rounded-lg border bg-gray-50 border-gray-200 p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">Marge</p>
                <p className="text-sm text-muted-foreground mt-2">Prix de vente non défini</p>
              </div>
            )}
          </div>

          {/* Profitability bar */}
          {cost.sellingPrice != null && cost.marginPct != null && cost.marginLevel && (() => {
            const cfg = marginConfig[cost.marginLevel];
            return (
              <div className="rounded-lg border p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Rentabilité</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.cls}`}>{cfg.label}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <span>Prix vente: {formatDA2(cost.sellingPrice)}</span>
                  <span>—</span>
                  <span>Coût: {formatDA2(cost.costPerUnit)}</span>
                  <span>=</span>
                  <span className="font-semibold">{formatDA2(cost.profitPerUnit ?? 0)} bénéfice/u.</span>
                </div>
                <Progress value={Math.max(0, Math.min(100, cost.marginPct))} className={`h-2 ${cfg.bar}`} />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>0%</span><span className="text-amber-600">10%</span><span className="text-green-600">30%</span><span>100%</span>
                </div>
              </div>
            );
          })()}

          {/* Ingredient breakdown table */}
          <div className="rounded-md border overflow-hidden">
            <div className="bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">Décomposition des coûts</div>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/20">
                  <TableHead className="text-xs py-2">Matière / Composant</TableHead>
                  <TableHead className="text-xs py-2 text-right">Quantité</TableHead>
                  <TableHead className="text-xs py-2 text-right">Coût unit.</TableHead>
                  <TableHead className="text-xs py-2 text-right">Total</TableHead>
                  <TableHead className="text-xs py-2 text-right">%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cost.lines.map((line, i) => {
                  const pct = cost.totalCost > 0 ? (line.totalCost / cost.totalCost) * 100 : 0;
                  return (
                    <TableRow key={i} className={line.hasMissingCost ? "bg-amber-50/50" : ""}>
                      <TableCell className="py-2 text-sm">
                        <div className="flex items-center gap-1.5">
                          <Package className="h-3 w-3 text-gray-400 shrink-0" />
                          {line.itemName}
                          {line.hasMissingCost && <AlertTriangle className="h-3 w-3 text-amber-500 ml-1" />}
                        </div>
                      </TableCell>
                      <TableCell className="py-2 text-right font-mono text-sm">
                        {fmt3(line.quantity)} {line.unitAbbreviation}
                      </TableCell>
                      <TableCell className="py-2 text-right text-sm text-muted-foreground">
                        {line.unitCostPrice > 0 ? formatDA2(line.unitCostPrice) : <span className="text-amber-500">N/A</span>}
                      </TableCell>
                      <TableCell className="py-2 text-right font-semibold text-sm">{formatDA(line.totalCost)}</TableCell>
                      <TableCell className="py-2 text-right text-xs text-muted-foreground">{pct.toFixed(1)}%</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Recipes() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailRecipe, setDetailRecipe] = useState<Recipe | null>(null);
  const [detailTab, setDetailTab] = useState("components");
  const [editing, setEditing] = useState<Recipe | null>(null);
  const [form, setForm] = useState({ name: "", type: "finished", yield: "", yieldUnitId: "", productId: "none", steps: "", notes: "" });
  const [components, setComponents] = useState<RecipeItem[]>([]);
  const [newComp, setNewComp] = useState({ itemType: "product", itemId: "", quantity: "", unitId: "", wastageRate: "0" });
  const [compTab, setCompTab] = useState("product");

  const { data: recipesRaw = [], isLoading } = useGetRecipes({});
  const recipes = recipesRaw as unknown as Recipe[];
  const { data: productsRaw = [] } = useGetProducts({});
  const products = productsRaw as any[];
  const { data: unitsRaw = [] } = useGetUnits();
  const units = unitsRaw as any[];

  const createMutation = useCreateRecipe({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetRecipesQueryKey() }); setDialogOpen(false); toast({ title: "Recette créée" }); } } });
  const updateMutation = useUpdateRecipe({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetRecipesQueryKey() }); setDialogOpen(false); toast({ title: "Recette mise à jour" }); } } });

  function openNew() {
    setEditing(null);
    setForm({ name: "", type: "finished", yield: "", yieldUnitId: "", productId: "none", steps: "", notes: "" });
    setComponents([]);
    setNewComp({ itemType: "product", itemId: "", quantity: "", unitId: "", wastageRate: "0" });
    setCompTab("product");
    setDialogOpen(true);
  }

  function openEdit(r: Recipe) {
    setEditing(r);
    setForm({ name: r.name, type: r.type, yield: r.yield.toString(), yieldUnitId: r.yieldUnitId.toString(), productId: r.productId?.toString() ?? "none", steps: r.steps ?? "", notes: r.notes ?? "" });
    const comps: RecipeItem[] = (r.components ?? r.ingredients.map(i => ({ ...i, itemType: "product" as const, itemId: i.productId, itemName: i.productName }))).map((c: any) => ({
      itemType: c.itemType ?? "product",
      itemId: c.itemId ?? c.productId,
      itemName: c.itemName ?? c.productName ?? "",
      quantity: c.quantity.toString(),
      unitId: c.unitId,
      unitName: c.unitName ?? "",
      wastageRate: c.wastageRate.toString(),
    }));
    setComponents(comps);
    setNewComp({ itemType: "product", itemId: "", quantity: "", unitId: "", wastageRate: "0" });
    setCompTab("product");
    setDialogOpen(true);
  }

  function openDetail(r: Recipe) {
    setDetailRecipe(r);
    setDetailTab("components");
  }

  function addComponent() {
    if (!newComp.itemId || !newComp.quantity || !newComp.unitId) return;
    const unit = units.find((u: any) => u.id === parseInt(newComp.unitId));
    if (newComp.itemType === "product") {
      const product = products.find((p: any) => p.id === parseInt(newComp.itemId));
      if (!product || !unit) return;
      setComponents(prev => [...prev, {
        itemType: "product", itemId: product.id, itemName: product.name,
        quantity: newComp.quantity, unitId: parseInt(newComp.unitId), unitName: unit.abbreviation,
        wastageRate: newComp.wastageRate,
      }]);
    } else {
      const recipe = recipes.find(r => r.id === parseInt(newComp.itemId));
      if (!recipe || !unit) return;
      setComponents(prev => [...prev, {
        itemType: "recipe", itemId: recipe.id, itemName: recipe.name,
        quantity: newComp.quantity, unitId: parseInt(newComp.unitId), unitName: unit.abbreviation,
        wastageRate: "0",
      }]);
    }
    setNewComp({ itemType: "product", itemId: "", quantity: "", unitId: "", wastageRate: "0" });
  }

  function save() {
    const data: any = {
      name: form.name, type: form.type, yield: parseFloat(form.yield), yieldUnitId: parseInt(form.yieldUnitId),
      productId: form.productId && form.productId !== "none" ? parseInt(form.productId) : null,
      steps: form.steps || null, notes: form.notes || null,
      components: components.map(c => ({
        itemType: c.itemType, itemId: c.itemId,
        quantity: parseFloat(c.quantity), unitId: c.unitId,
        wastageRate: parseFloat(c.wastageRate),
      })),
    };
    if (editing) { updateMutation.mutate({ id: editing.id, data }); }
    else { createMutation.mutate({ data }); }
  }

  const semiFinishedRecipes = recipes.filter(r => r.type === "semi_finished");

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
        {isLoading ? <p className="text-muted-foreground col-span-3">Chargement...</p> : recipes.length === 0 ? (
          <Card className="col-span-3"><CardContent className="text-center py-12 text-muted-foreground">Aucune recette</CardContent></Card>
        ) : recipes.map(r => {
          const displayCost = r.cachedTotalCost ?? r.theoreticalCost;
          const costPerUnit = r.cachedCostPerUnit;
          return (
            <Card key={r.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`h-9 w-9 rounded-full flex items-center justify-center ${r.type === "semi_finished" ? "bg-purple-100" : "bg-amber-100"}`}>
                      {r.type === "semi_finished" ? <Layers className="h-4 w-4 text-purple-600" /> : <ChefHat className="h-4 w-4 text-amber-600" />}
                    </div>
                    <div>
                      <CardTitle className="text-base">{r.name}</CardTitle>
                      {r.productName && <p className="text-xs text-muted-foreground">{r.productName}</p>}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openDetail(r)}><Eye className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(r)}><Edit2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{(r.components ?? r.ingredients).length} composant{(r.components ?? r.ingredients).length !== 1 ? "s" : ""}</span>
                  <div className="text-right">
                    <p className="font-semibold text-amber-700">{formatDA(displayCost)}</p>
                    {costPerUnit != null && <p className="text-xs text-muted-foreground">{formatDA2(costPerUnit)}/u.</p>}
                  </div>
                </div>
                <div className="flex items-center justify-between text-sm mt-1">
                  <span className="text-muted-foreground">Rendement</span>
                  <span>{r.yield} {r.yieldUnitName}</span>
                </div>
                {r.sellingPrice != null && r.sellingPrice > 0 && costPerUnit != null && (() => {
                  const margin = ((r.sellingPrice - costPerUnit) / r.sellingPrice) * 100;
                  const lvl = margin >= 30 ? "green" : margin >= 10 ? "orange" : "red";
                  const cfg = marginConfig[lvl];
                  return (
                    <div className={`mt-2 text-xs flex items-center justify-between px-2 py-1 rounded-md ${cfg.cls}`}>
                      <span>Marge estimée</span><span className="font-bold">{margin.toFixed(1)}%</span>
                    </div>
                  );
                })()}
                <Badge variant={r.type === "finished" ? "default" : "secondary"} className={`mt-2 text-xs ${r.type === "semi_finished" ? "bg-purple-100 text-purple-700 hover:bg-purple-100" : ""}`}>
                  {r.type === "finished" ? "Produit fini" : "Semi-fini"}
                </Badge>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Detail dialog */}
      {detailRecipe && (
        <Dialog open={!!detailRecipe} onOpenChange={() => setDetailRecipe(null)}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {detailRecipe.type === "semi_finished" ? <Layers className="h-4 w-4 text-purple-500" /> : <ChefHat className="h-4 w-4 text-amber-500" />}
                {detailRecipe.name}
              </DialogTitle>
            </DialogHeader>

            <Tabs value={detailTab} onValueChange={setDetailTab}>
              <TabsList className="w-full">
                <TabsTrigger value="components" className="flex-1 text-xs">
                  <Package className="h-3.5 w-3.5 mr-1" />Composants
                </TabsTrigger>
                <TabsTrigger value="cost" className="flex-1 text-xs">
                  <TrendingUp className="h-3.5 w-3.5 mr-1" />Analyse des coûts
                </TabsTrigger>
              </TabsList>

              <TabsContent value="components" className="mt-4 space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><p className="text-muted-foreground">Rendement</p><p className="font-medium">{detailRecipe.yield} {detailRecipe.yieldUnitName}</p></div>
                  <div><p className="text-muted-foreground">Coût théorique</p><p className="font-medium text-amber-600">{formatDA(detailRecipe.theoreticalCost)}</p></div>
                  {detailRecipe.sellingPrice != null && <div><p className="text-muted-foreground">Prix de vente</p><p className="font-medium text-green-600">{formatDA(detailRecipe.sellingPrice)}</p></div>}
                  {detailRecipe.lastCostUpdate && <div><p className="text-muted-foreground">Dernier calcul</p><p className="text-xs">{new Date(detailRecipe.lastCostUpdate).toLocaleString("fr-DZ")}</p></div>}
                </div>
                <Table><TableBody>
                  {(detailRecipe.components ?? detailRecipe.ingredients.map(i => ({ ...i, itemType: "product", itemId: i.productId, itemName: i.productName }))).map((c: any, idx: number) => (
                    <TableRow key={idx}>
                      <TableCell className="text-sm py-2">
                        <div className="flex items-center gap-1.5">
                          {c.itemType === "recipe" ? <Layers className="h-3 w-3 text-purple-500 shrink-0" /> : <Package className="h-3 w-3 text-gray-400 shrink-0" />}
                          {c.itemName ?? c.productName}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm py-2 font-mono">{c.quantity} {c.unitName}</TableCell>
                      {c.wastageRate > 0 ? <TableCell className="text-sm py-2 text-muted-foreground">+{c.wastageRate}%</TableCell> : <TableCell />}
                      <TableCell className="text-sm py-2 text-right">
                        {c.totalCost != null && c.totalCost > 0 ? formatDA(c.totalCost) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody></Table>
                {detailRecipe.steps && (
                  <div><p className="text-sm font-medium mb-1">Instructions</p><p className="text-sm text-muted-foreground whitespace-pre-wrap">{detailRecipe.steps}</p></div>
                )}
              </TabsContent>

              <TabsContent value="cost" className="mt-4">
                <CostAnalysisPanel
                  recipeId={detailRecipe.id}
                  quantity={detailRecipe.yield}
                  yieldQty={detailRecipe.yield}
                />
              </TabsContent>
            </Tabs>
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
                  <SelectContent>
                    <SelectItem value="finished">Produit fini</SelectItem>
                    <SelectItem value="semi_finished">Semi-fini (sous-recette)</SelectItem>
                  </SelectContent>
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
                    {products.filter((p: any) => p.isFabricated).map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Rendement *</Label><Input type="number" step="0.001" value={form.yield} onChange={e => setForm(f => ({ ...f, yield: e.target.value }))} /></div>
              <div>
                <Label>Unité rendement *</Label>
                <Select value={form.yieldUnitId} onValueChange={v => setForm(f => ({ ...f, yieldUnitId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Choisir..." /></SelectTrigger>
                  <SelectContent>{units.map((u: any) => <SelectItem key={u.id} value={String(u.id)}>{u.name} ({u.abbreviation})</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            <div className="border rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Composants</p>
                <span className="text-xs text-muted-foreground">{components.length} élément{components.length !== 1 ? "s" : ""}</span>
              </div>
              {components.length > 0 && (
                <Table><TableBody>
                  {components.map((comp, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-sm py-2">
                        <div className="flex items-center gap-1.5">
                          {comp.itemType === "recipe" ? <Layers className="h-3 w-3 text-purple-500 shrink-0" /> : <Package className="h-3 w-3 text-gray-400 shrink-0" />}
                          {comp.itemName}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm py-2">{comp.quantity} {comp.unitName}</TableCell>
                      {comp.itemType === "product" && <TableCell className="text-sm py-2 text-muted-foreground">Perte: {comp.wastageRate}%</TableCell>}
                      {comp.itemType !== "product" && <TableCell />}
                      <TableCell className="py-2">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setComponents(prev => prev.filter((_, j) => j !== i))}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody></Table>
              )}

              <Tabs value={compTab} onValueChange={v => { setCompTab(v); setNewComp(n => ({ ...n, itemType: v, itemId: "" })); }}>
                <TabsList className="h-7">
                  <TabsTrigger value="product" className="text-xs h-6 px-2 gap-1"><Package className="h-3 w-3" />Matière première</TabsTrigger>
                  <TabsTrigger value="recipe" className="text-xs h-6 px-2 gap-1"><Layers className="h-3 w-3" />Sous-recette</TabsTrigger>
                </TabsList>
                <TabsContent value="product" className="mt-2">
                  <div className="flex gap-2">
                    <Select value={newComp.itemId} onValueChange={v => setNewComp(n => ({ ...n, itemId: v, itemType: "product" }))}>
                      <SelectTrigger className="flex-1"><SelectValue placeholder="Ingrédient..." /></SelectTrigger>
                      <SelectContent>{products.filter((p: any) => p.isPurchasable || p.type === "ingredient").map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input type="number" step="0.001" className="w-20" placeholder="Qté" value={newComp.quantity} onChange={e => setNewComp(n => ({ ...n, quantity: e.target.value }))} />
                    <Select value={newComp.unitId} onValueChange={v => setNewComp(n => ({ ...n, unitId: v }))}>
                      <SelectTrigger className="w-20"><SelectValue placeholder="U" /></SelectTrigger>
                      <SelectContent>{units.map((u: any) => <SelectItem key={u.id} value={String(u.id)}>{u.abbreviation}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input type="number" step="0.1" className="w-20" placeholder="Perte%" value={newComp.wastageRate} onChange={e => setNewComp(n => ({ ...n, wastageRate: e.target.value }))} />
                    <Button variant="outline" size="sm" onClick={addComponent}>+</Button>
                  </div>
                </TabsContent>
                <TabsContent value="recipe" className="mt-2">
                  <div className="flex gap-2">
                    <Select value={newComp.itemId} onValueChange={v => setNewComp(n => ({ ...n, itemId: v, itemType: "recipe" }))}>
                      <SelectTrigger className="flex-1"><SelectValue placeholder="Choisir une sous-recette..." /></SelectTrigger>
                      <SelectContent>
                        {semiFinishedRecipes.length === 0
                          ? <SelectItem value="_none" disabled>Aucune recette semi-finie disponible</SelectItem>
                          : semiFinishedRecipes.map(r => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input type="number" step="0.001" className="w-20" placeholder="Qté" value={newComp.quantity} onChange={e => setNewComp(n => ({ ...n, quantity: e.target.value }))} />
                    <Select value={newComp.unitId} onValueChange={v => setNewComp(n => ({ ...n, unitId: v }))}>
                      <SelectTrigger className="w-20"><SelectValue placeholder="U" /></SelectTrigger>
                      <SelectContent>{units.map((u: any) => <SelectItem key={u.id} value={String(u.id)}>{u.abbreviation}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" onClick={addComponent} disabled={newComp.itemId === "_none"}>+</Button>
                  </div>
                  {semiFinishedRecipes.length === 0 && <p className="text-xs text-muted-foreground mt-1">Créez d'abord une recette de type "Semi-fini".</p>}
                </TabsContent>
              </Tabs>
            </div>

            <div><Label>Instructions</Label><Textarea value={form.steps} onChange={e => setForm(f => ({ ...f, steps: e.target.value }))} rows={3} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
            <Button onClick={save} disabled={!form.name || !form.yield || !form.yieldUnitId || components.length === 0}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
