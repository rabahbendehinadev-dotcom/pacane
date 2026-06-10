import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useGetProductionOrders, useCreateProductionOrder, useCompleteProductionOrder, useGetProductionPlanning, useGetRecipes, useGetBranches, getGetProductionOrdersQueryKey, getGetStockLevelsQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Plus, PlayCircle, CheckCircle, Factory, Lightbulb, AlertTriangle, XCircle,
  CheckCircle2, Package, MapPin, FlaskConical, User, Calendar, Shield,
  ChevronRight, RefreshCw, ClipboardList, Layers, GitBranch, TrendingUp,
  TrendingDown, DollarSign, BarChart3,
} from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "@/hooks/use-toast";

function formatDA(n: number) { return new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(n) + " DA"; }
function formatDA2(n: number) { return new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 2 }).format(n) + " DA"; }
function fmt3(n: number) { return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(n); }

const API = "/api";
function authHeaders() { return { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` }; }

type CostLine = { itemType: string; itemId: number; itemName: string; quantity: number; unitAbbreviation: string; unitCostPrice: number; totalCost: number; wastageRate: number; nestingLevel: number; hasMissingCost: boolean };
type CostBreakdown = { recipeId: number; recipeName: string; quantity: number; lines: CostLine[]; totalCost: number; costPerUnit: number; sellingPrice: number | null; profitPerUnit: number | null; marginPct: number | null; marginLevel: "green" | "orange" | "red" | null; warnings: string[]; wasteCost: number };

type IngredientRow = { ingredientProductId: number; ingredientName: string; unitAbbreviation: string; requiredQty: number; availableQty: number; shortageQty: number; wastageRate: number; status: "ok" | "short" | "missing" };
type AvailabilityResult = { recipeId: number; recipeName: string; recipeYield: number; plannedQuantity: number; branchId: number; branchName: string; scaleFactor: number; rows: IngredientRow[]; overallStatus: "available" | "partial" | "unavailable"; canLaunch: boolean };
type OverrideLog = { id: number; productionOrderId: number; userId: number; reason: string; userName: string | null; createdAt: string };
type BomLeaf = { type: "product"; productId: number; productName: string; quantity: number; unitAbbreviation: string; wastageRate: number };
type BomNode = { type: "recipe"; recipeId: number; recipeName: string; quantity: number; scaleFactor: number; children: Array<BomNode | BomLeaf> };
type BomResult = { materials: Array<{ productId: number; productName: string; quantity: number; unitAbbreviation: string; costPrice: number; totalCost: number }>; tree: BomNode; totalCost: number };

const statusConfig: Record<string, { label: string; cls: string; dot: string }> = {
  draft:       { label: "Brouillon",  cls: "bg-gray-100 text-gray-700",    dot: "bg-gray-400" },
  planned:     { label: "Planifié",   cls: "bg-blue-100 text-blue-700",    dot: "bg-blue-500" },
  launched:    { label: "Lancé",      cls: "bg-amber-100 text-amber-700",  dot: "bg-amber-500" },
  in_progress: { label: "En cours",  cls: "bg-orange-100 text-orange-700", dot: "bg-orange-500" },
  completed:   { label: "Terminé",   cls: "bg-green-100 text-green-700",   dot: "bg-green-500" },
  cancelled:   { label: "Annulé",    cls: "bg-red-100 text-red-700",       dot: "bg-red-400" },
};

const marginConfig = {
  green:  { cls: "text-green-700 bg-green-100 border-green-200", label: "Bonne marge (≥30%)" },
  orange: { cls: "text-amber-700 bg-amber-100 border-amber-200", label: "Marge correcte (10–30%)" },
  red:    { cls: "text-red-700 bg-red-100 border-red-200",       label: "Marge faible (<10%)" },
};

function useProductionAvailability(orderId: number | null, enabled: boolean) {
  return useQuery<AvailabilityResult>({ queryKey: ["production-availability", orderId], queryFn: async () => { const r = await fetch(`${API}/production/${orderId}/availability`, { headers: authHeaders() }); if (!r.ok) throw new Error("Erreur"); return r.json(); }, enabled: !!orderId && enabled, staleTime: 30_000 });
}
function useProductionOverrides(orderId: number | null, enabled: boolean) {
  return useQuery<OverrideLog[]>({ queryKey: ["production-overrides", orderId], queryFn: async () => { const r = await fetch(`${API}/production/${orderId}/overrides`, { headers: authHeaders() }); if (!r.ok) return []; const d = await r.json(); return Array.isArray(d) ? d : []; }, enabled: !!orderId && enabled });
}
function useProductionBom(orderId: number | null, enabled: boolean) {
  return useQuery<BomResult>({ queryKey: ["production-bom", orderId], queryFn: async () => { const r = await fetch(`${API}/production/${orderId}/bom`, { headers: authHeaders() }); if (!r.ok) throw new Error("Erreur BOM"); return r.json(); }, enabled: !!orderId && enabled, staleTime: 60_000 });
}
function useProductionCost(orderId: number | null, enabled: boolean) {
  return useQuery<CostBreakdown & { savedItems: any[] }>({ queryKey: ["production-cost", orderId], queryFn: async () => { const r = await fetch(`${API}/production/${orderId}/cost`, { headers: authHeaders() }); if (!r.ok) throw new Error("Erreur coût"); return r.json(); }, enabled: !!orderId && enabled, staleTime: 60_000 });
}
function useCostPreview(recipeId: string, quantity: string, wastePercentage: number, enabled: boolean) {
  return useQuery<CostBreakdown>({ queryKey: ["cost-preview", recipeId, quantity, wastePercentage], queryFn: async () => { const r = await fetch(`${API}/production/cost-preview`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ recipeId: parseInt(recipeId), quantity: parseFloat(quantity), wastePercentage }) }); if (!r.ok) throw new Error("Erreur"); return r.json(); }, enabled: !!recipeId && !!quantity && parseFloat(quantity) > 0 && enabled, staleTime: 60_000 });
}

function BomTreeNode({ node, depth = 0 }: { node: BomNode | BomLeaf; depth?: number }) {
  const indent = depth * 18;
  if (node.type === "product") return (
    <div className="flex items-center gap-2 py-1.5 text-sm" style={{ paddingLeft: indent + 8 }}>
      <Package className="h-3.5 w-3.5 text-gray-400 shrink-0" />
      <span className="flex-1">{node.productName}</span>
      <span className="font-mono text-xs text-muted-foreground">{fmt3(node.quantity)} {node.unitAbbreviation}</span>
      {node.wastageRate > 0 && <span className="text-xs text-amber-600">+{node.wastageRate}%</span>}
    </div>
  );
  return (
    <div>
      <div className="flex items-center gap-2 py-1.5 text-sm font-semibold" style={{ paddingLeft: indent }}>
        <Layers className="h-3.5 w-3.5 text-purple-500 shrink-0" />
        <span className="flex-1 text-purple-700">{node.recipeName}</span>
        <span className="font-mono text-xs text-purple-600">×{fmt3(node.scaleFactor)}</span>
      </div>
      {node.children.map((child, i) => <BomTreeNode key={i} node={child} depth={depth + 1} />)}
    </div>
  );
}

function BomPanel({ orderId }: { orderId: number | null }) {
  const { data: bom, isLoading, error } = useProductionBom(orderId, !!orderId);
  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center"><RefreshCw className="h-4 w-4 animate-spin" />Calcul...</div>;
  if (error || !bom) return <div className="text-center py-8 text-sm text-muted-foreground">Impossible de charger la nomenclature.</div>;
  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-purple-50/40 border-purple-100 p-3">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-purple-500" />
          <span className="font-medium text-sm text-purple-700">Arbre de décomposition</span>
          <span className="ml-auto text-sm font-semibold text-amber-600">{formatDA(bom.totalCost)}</span>
        </div>
      </div>
      <div className="rounded-md border p-2 divide-y"><BomTreeNode node={bom.tree} /></div>
      <div className="rounded-md border overflow-hidden">
        <div className="bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">Matières agrégées</div>
        <Table>
          <TableHeader><TableRow className="bg-muted/20">
            <TableHead className="text-xs py-2">Matière</TableHead>
            <TableHead className="text-xs py-2 text-right">Qté totale</TableHead>
            <TableHead className="text-xs py-2 text-right">Coût/u.</TableHead>
            <TableHead className="text-xs py-2 text-right">Total</TableHead>
          </TableRow></TableHeader>
          <TableBody>{bom.materials.map((m, i) => (
            <TableRow key={i}>
              <TableCell className="py-2 text-sm font-medium">{m.productName}</TableCell>
              <TableCell className="py-2 text-right font-mono text-sm">{fmt3(m.quantity)} <span className="text-muted-foreground">{m.unitAbbreviation}</span></TableCell>
              <TableCell className="py-2 text-right text-sm text-muted-foreground">{formatDA2(m.costPrice)}</TableCell>
              <TableCell className="py-2 text-right font-semibold text-sm">{formatDA(m.totalCost)}</TableCell>
            </TableRow>
          ))}</TableBody>
        </Table>
      </div>
    </div>
  );
}

function CostPanel({ orderId, order }: { orderId: number | null; order: any }) {
  const { data: cost, isLoading, error } = useProductionCost(orderId, !!orderId);
  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center"><RefreshCw className="h-4 w-4 animate-spin" />Calcul des coûts...</div>;
  if (error || !cost) return <div className="text-center py-8 text-sm text-muted-foreground">Impossible de charger les coûts.</div>;

  const variance = order?.costVariance;
  return (
    <div className="space-y-4">
      {cost.warnings?.length > 0 && (
        <Alert className="border-amber-200 bg-amber-50">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-sm">
            {cost.warnings.map((w: string, i: number) => <div key={i}>⚠ {w}</div>)}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border bg-amber-50/50 border-amber-100 p-3">
          <p className="text-xs text-muted-foreground mb-1">Coût estimé WAC</p>
          <p className="text-xl font-bold text-amber-700">{formatDA(cost.totalCost)}</p>
          <p className="text-xs text-muted-foreground">{formatDA2(cost.costPerUnit)}/unité</p>
        </div>
        {order?.theoreticalCost != null && (
          <div className="rounded-lg border bg-blue-50/50 border-blue-100 p-3">
            <p className="text-xs text-muted-foreground mb-1">Coût théorique</p>
            <p className="text-xl font-bold text-blue-700">{formatDA(order.theoreticalCost)}</p>
          </div>
        )}
        {order?.actualCost != null && (
          <div className="rounded-lg border bg-green-50/50 border-green-100 p-3">
            <p className="text-xs text-muted-foreground mb-1">Coût réel</p>
            <p className="text-xl font-bold text-green-700">{formatDA(order.actualCost)}</p>
          </div>
        )}
        {variance != null && (
          <div className={`rounded-lg border p-3 ${variance > 0 ? "bg-red-50 border-red-100" : "bg-green-50 border-green-100"}`}>
            <p className="text-xs text-muted-foreground mb-1">Écart de coût</p>
            <div className="flex items-center gap-1">
              {variance > 0 ? <TrendingUp className="h-4 w-4 text-red-600" /> : <TrendingDown className="h-4 w-4 text-green-600" />}
              <p className={`text-xl font-bold ${variance > 0 ? "text-red-700" : "text-green-700"}`}>{variance > 0 ? "+" : ""}{formatDA(variance)}</p>
            </div>
          </div>
        )}
      </div>

      {cost.marginLevel && cost.marginPct != null && (() => {
        const cfg = marginConfig[cost.marginLevel];
        return (
          <div className={`rounded-lg border p-4 ${cfg.cls}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                <span className="font-semibold text-sm">Rentabilité</span>
              </div>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cfg.cls}`}>{cfg.label}</span>
            </div>
            <div className="text-sm space-y-1">
              <div className="flex justify-between"><span>Prix de vente</span><span className="font-medium">{formatDA2(cost.sellingPrice ?? 0)}</span></div>
              <div className="flex justify-between"><span>Coût/unité</span><span className="font-medium">{formatDA2(cost.costPerUnit)}</span></div>
              <div className="flex justify-between border-t pt-1 mt-1"><span className="font-semibold">Bénéfice/unité</span><span className="font-bold">{formatDA2(cost.profitPerUnit ?? 0)}</span></div>
            </div>
            <Progress value={Math.max(0, Math.min(100, cost.marginPct))} className="h-2 mt-3" />
            <p className="text-center font-bold mt-1">{cost.marginPct.toFixed(1)}%</p>
          </div>
        );
      })()}

      <div className="rounded-md border overflow-hidden">
        <div className="bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">Décomposition des coûts (WAC)</div>
        <Table>
          <TableHeader><TableRow className="bg-muted/20">
            <TableHead className="text-xs py-2">Matière</TableHead>
            <TableHead className="text-xs py-2 text-right">Qté</TableHead>
            <TableHead className="text-xs py-2 text-right">Coût unit.</TableHead>
            <TableHead className="text-xs py-2 text-right">Total</TableHead>
            <TableHead className="text-xs py-2 text-right">%</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {cost.lines.map((line, i) => {
              const pct = cost.totalCost > 0 ? (line.totalCost / cost.totalCost) * 100 : 0;
              return (
                <TableRow key={i} className={line.hasMissingCost ? "bg-amber-50/50" : ""}>
                  <TableCell className="py-2 text-sm">
                    <div className="flex items-center gap-1.5">
                      <Package className="h-3 w-3 text-gray-400 shrink-0" />{line.itemName}
                      {line.hasMissingCost && <AlertTriangle className="h-3 w-3 text-amber-500" />}
                    </div>
                  </TableCell>
                  <TableCell className="py-2 text-right font-mono text-sm">{fmt3(line.quantity)} {line.unitAbbreviation}</TableCell>
                  <TableCell className="py-2 text-right text-sm text-muted-foreground">{line.unitCostPrice > 0 ? formatDA2(line.unitCostPrice) : <span className="text-amber-500">N/A</span>}</TableCell>
                  <TableCell className="py-2 text-right font-semibold text-sm">{formatDA(line.totalCost)}</TableCell>
                  <TableCell className="py-2 text-right text-xs text-muted-foreground">{pct.toFixed(1)}%</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AvailabilityPanel({ availability, loading }: { availability?: AvailabilityResult; loading: boolean }) {
  if (loading) return <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center"><RefreshCw className="h-4 w-4 animate-spin" />Analyse...</div>;
  if (!availability) return null;
  const availStatusConfig = {
    available:   { bg: "bg-green-50", border: "border-green-200", text: "text-green-700", icon: CheckCircle2 },
    partial:     { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", icon: AlertTriangle },
    unavailable: { bg: "bg-red-50",   border: "border-red-200",   text: "text-red-700",   icon: XCircle },
  };
  const cfg = availStatusConfig[availability.overallStatus];
  const Icon = cfg.icon;
  const okCount = availability.rows.filter(r => r.status === "ok").length;
  return (
    <div className="space-y-4">
      <div className={`rounded-lg border p-4 ${cfg.bg} ${cfg.border}`}>
        <div className="flex items-center gap-2">
          <Icon className={`h-5 w-5 ${cfg.text}`} />
          <div className="flex-1">
            <p className={`font-semibold text-sm ${cfg.text}`}>
              {availability.overallStatus === "available" ? "Tous les ingrédients disponibles" : availability.overallStatus === "partial" ? "Ingrédients insuffisants" : "Aucun ingrédient en stock"}
            </p>
            <p className="text-xs text-muted-foreground">{okCount}/{availability.rows.length} disponibles · {availability.branchName}</p>
          </div>
        </div>
      </div>
      <Table>
        <TableHeader><TableRow className="bg-muted/40">
          <TableHead className="text-xs py-2">Ingrédient</TableHead>
          <TableHead className="text-xs py-2 text-right">Requis</TableHead>
          <TableHead className="text-xs py-2 text-right">Dispo.</TableHead>
          <TableHead className="text-xs py-2 text-right">Manque</TableHead>
          <TableHead className="text-xs py-2"></TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {availability.rows.map((row, i) => (
            <TableRow key={i} className={row.status === "missing" ? "bg-red-50/50" : row.status === "short" ? "bg-amber-50/50" : ""}>
              <TableCell className="py-2 text-sm font-medium">{row.ingredientName}</TableCell>
              <TableCell className="py-2 text-right font-mono text-sm">{fmt3(row.requiredQty)} {row.unitAbbreviation}</TableCell>
              <TableCell className="py-2 text-right font-mono text-sm">{fmt3(row.availableQty)}</TableCell>
              <TableCell className="py-2 text-right font-mono text-sm">{row.shortageQty > 0 ? <span className="text-red-600 font-semibold">−{fmt3(row.shortageQty)}</span> : <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell className="py-2">
                {row.status === "ok" ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : row.status === "short" ? <AlertTriangle className="h-4 w-4 text-amber-500" /> : <XCircle className="h-4 w-4 text-red-500" />}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function OverrideLogsPanel({ logs }: { logs: OverrideLog[] }) {
  if (logs.length === 0) return <div className="text-center py-8 text-sm text-muted-foreground">Aucune dérogation</div>;
  return (
    <div className="space-y-3">
      {logs.map(l => (
        <div key={l.id} className="rounded-md border border-amber-200 bg-amber-50/40 p-4">
          <div className="flex items-start gap-3">
            <Shield className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-sm">{l.userName ?? `User #${l.userId}`}</span>
                <span className="text-xs text-muted-foreground">{format(new Date(l.createdAt), "dd MMM yyyy à HH:mm", { locale: fr })}</span>
              </div>
              <p className="text-sm text-muted-foreground">{l.reason}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Live cost preview in create form
function CostPreviewPanel({ recipeId, quantity, wastePercentage }: { recipeId: string; quantity: string; wastePercentage: number }) {
  const enabled = !!recipeId && !!quantity && parseFloat(quantity) > 0;
  const { data: cost, isLoading, error } = useCostPreview(recipeId, quantity, wastePercentage, enabled);

  if (!enabled) return (
    <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-center text-sm text-muted-foreground">
      Sélectionnez une recette et une quantité pour voir l'estimation des coûts
    </div>
  );
  if (isLoading) return (
    <div className="rounded-lg border bg-muted/20 p-4 flex items-center gap-2 text-sm text-muted-foreground justify-center">
      <RefreshCw className="h-3.5 w-3.5 animate-spin" />Calcul des coûts en cours...
    </div>
  );
  if (error || !cost) return null;

  return (
    <div className="rounded-lg border bg-gradient-to-br from-amber-50/50 to-orange-50/50 border-amber-200 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <DollarSign className="h-4 w-4 text-amber-600" />
        <p className="font-semibold text-sm text-amber-800">Estimation des coûts</p>
        {cost.warnings?.length > 0 && <AlertTriangle className="h-3.5 w-3.5 text-amber-500 ml-auto" />}
      </div>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div className="text-center">
          <p className="text-xs text-muted-foreground">Coût total</p>
          <p className="font-bold text-amber-700">{formatDA(cost.totalCost)}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-muted-foreground">Coût/unité</p>
          <p className="font-bold">{formatDA2(cost.costPerUnit)}</p>
        </div>
        {cost.marginLevel ? (
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Marge prévue</p>
            <p className={`font-bold ${cost.marginLevel === "green" ? "text-green-600" : cost.marginLevel === "orange" ? "text-amber-600" : "text-red-600"}`}>{cost.marginPct?.toFixed(1)}%</p>
          </div>
        ) : <div />}
      </div>
      <div className="space-y-1">
        {cost.lines.slice(0, 4).map((l, i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground truncate max-w-[180px]">{l.itemName}</span>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-muted-foreground font-mono">{fmt3(l.quantity)} {l.unitAbbreviation}</span>
              <span className="font-medium">{formatDA(l.totalCost)}</span>
            </div>
          </div>
        ))}
        {cost.lines.length > 4 && <p className="text-xs text-muted-foreground text-center">+{cost.lines.length - 4} autres matières...</p>}
      </div>
    </div>
  );
}

export default function Production() {
  const qc = useQueryClient();
  const [mainTab, setMainTab] = useState("orders");
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailOrderId, setDetailOrderId] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState("availability");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false);
  const [bomModalOpen, setBomModalOpen] = useState(false);
  const [bomOrderId, setBomOrderId] = useState<number | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [actualQty, setActualQty] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [launching, setLaunching] = useState(false);
  const [form, setForm] = useState({ recipeId: "", plannedQuantity: "", branchId: "", status: "planned", notes: "", wastePercentage: "0" });

  const { data: orders = [], isLoading } = useGetProductionOrders({});
  const { data: planning = [] } = useGetProductionPlanning({});
  const { data: recipes = [] } = useGetRecipes({});
  const { data: branches = [] } = useGetBranches();

  const { data: availability, isLoading: availLoading, refetch: refetchAvail } = useProductionAvailability(detailOrderId, detailOpen);
  const { data: overrideLogs = [], refetch: refetchOverrides } = useProductionOverrides(detailOrderId, detailOpen);

  const createMutation = useCreateProductionOrder({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetProductionOrdersQueryKey() });
        setCreateDialogOpen(false);
        toast({ title: "Ordre créé" });
      },
      onError: (err: any) => {
        const msg: string =
          err?.response?.data?.error ??
          err?.message ??
          "Impossible de créer l'ordre de production";
        const code: string | undefined = err?.response?.data?.code;
        let description = msg;
        if (code === "RECIPE_EMPTY") description = "Cette recette n'a aucun ingrédient. Ajoutez des composants à la recette avant de créer un ordre.";
        else if (code === "RECIPE_NOT_FOUND") description = "La recette sélectionnée est introuvable.";
        else if (code === "BRANCH_ACCESS_DENIED") description = "Vous n'avez pas accès à cette boutique.";
        toast({ title: "Erreur", description, variant: "destructive" });
      },
    },
  });
  const completeMutation = useCompleteProductionOrder({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetProductionOrdersQueryKey() }); qc.invalidateQueries({ queryKey: getGetStockLevelsQueryKey() }); setCompleteDialogOpen(false); if (detailOrderId) { refetchAvail(); qc.invalidateQueries({ queryKey: ["production-cost", detailOrderId] }); } toast({ title: "Production terminée" }); } } });

  const detailOrder = (orders as any[]).find((o: any) => o.id === detailOrderId);
  const bomOrder = (orders as any[]).find((o: any) => o.id === bomOrderId);

  function openDetail(orderId: number) { setDetailOrderId(orderId); setDetailTab("availability"); setDetailOpen(true); }
  function openBom(orderId: number) { setBomOrderId(orderId); setBomModalOpen(true); }

  async function handleLaunch(withOverride = false) {
    if (!detailOrderId) return;
    if (withOverride && !overrideReason.trim()) { toast({ title: "Raison requise", variant: "destructive" }); return; }
    setLaunching(true);
    try {
      const body: Record<string, unknown> = {};
      if (withOverride) body.overrideReason = overrideReason.trim();
      const res = await fetch(`${API}/production/${detailOrderId}/launch`, { method: "POST", headers: authHeaders(), body: JSON.stringify(body) });
      const data = await res.json();
      if (res.status === 409 && data.code === "INGREDIENTS_UNAVAILABLE") { setOverrideDialogOpen(true); return; }
      if (!res.ok) { toast({ title: "Erreur", description: data.error ?? "Impossible de lancer.", variant: "destructive" }); return; }
      setOverrideDialogOpen(false); setOverrideReason("");
      qc.invalidateQueries({ queryKey: getGetProductionOrdersQueryKey() });
      refetchAvail(); refetchOverrides();
      toast({ title: "Production lancée !" });
    } finally { setLaunching(false); }
  }

  const urgencyConfig: Record<string, { label: string; cls: string }> = {
    critical: { label: "Critique", cls: "bg-red-100 text-red-700" },
    high:     { label: "Haute",    cls: "bg-orange-100 text-orange-700" },
    medium:   { label: "Moyenne",  cls: "bg-amber-100 text-amber-700" },
    low:      { label: "Basse",    cls: "bg-gray-100 text-gray-700" },
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold">Production</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Ordres de fabrication · Coûts · Rentabilité</p>
        </div>
        <Button onClick={() => { setForm({ recipeId: "", plannedQuantity: "", branchId: "", status: "planned", notes: "", wastePercentage: "0" }); setCreateDialogOpen(true); }} className="gap-2">
          <Plus className="h-4 w-4" />Nouvel ordre
        </Button>
      </div>

      <Tabs value={mainTab} onValueChange={setMainTab}>
        <TabsList>
          <TabsTrigger value="orders" className="gap-2"><Factory className="h-4 w-4" />Ordres<Badge variant="secondary" className="text-xs ml-1">{(orders as any[]).length}</Badge></TabsTrigger>
          <TabsTrigger value="planning" className="gap-2"><Lightbulb className="h-4 w-4" />Planification{(planning as any[]).length > 0 && <Badge variant="secondary" className="text-xs">{(planning as any[]).length}</Badge>}</TabsTrigger>
        </TabsList>

        <TabsContent value="orders">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Référence</TableHead><TableHead>Recette</TableHead><TableHead>Boutique</TableHead>
                    <TableHead className="text-right">Qté</TableHead><TableHead className="text-right">Coût estimé</TableHead>
                    <TableHead>Statut</TableHead><TableHead>Date</TableHead><TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">Chargement...</TableCell></TableRow>
                  ) : (orders as any[]).length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">Aucun ordre</TableCell></TableRow>
                  ) : (orders as any[]).map((o: any) => {
                    const s = statusConfig[o.status] ?? { label: o.status, cls: "bg-gray-100", dot: "bg-gray-400" };
                    const displayCost = o.actualCost ?? o.estimatedCost ?? o.theoreticalCost;
                    return (
                      <TableRow key={o.id} className="cursor-pointer hover:bg-muted/40" onClick={() => openDetail(o.id)}>
                        <TableCell className="font-mono text-xs font-semibold">{o.reference}</TableCell>
                        <TableCell><span className="font-medium text-sm">{o.recipeName}</span>{o.productName && <p className="text-xs text-muted-foreground">{o.productName}</p>}</TableCell>
                        <TableCell><div className="flex items-center gap-1 text-sm text-muted-foreground"><MapPin className="h-3 w-3" />{o.branchName}</div></TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmt3(o.plannedQuantity)}</TableCell>
                        <TableCell className="text-right">
                          <div>
                            <span className="text-sm font-semibold">{formatDA(displayCost)}</span>
                            {o.profitability && <p className={`text-xs font-medium ${o.profitability.marginLevel === "green" ? "text-green-600" : o.profitability.marginLevel === "orange" ? "text-amber-600" : "text-red-600"}`}>{o.profitability.marginPct.toFixed(1)}% marge</p>}
                          </div>
                        </TableCell>
                        <TableCell><div className="flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${s.dot}`} /><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${s.cls}`}>{s.label}</span></div></TableCell>
                        <TableCell className="text-sm text-muted-foreground">{format(new Date(o.createdAt), "dd/MM/yyyy")}</TableCell>
                        <TableCell onClick={e => e.stopPropagation()}>
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={e => { e.stopPropagation(); openBom(o.id); }}>
                              <GitBranch className="h-3 w-3" />BOM
                            </Button>
                            {(o.status === "launched" || o.status === "in_progress") && (
                              <Button size="sm" className="h-7 text-xs gap-1 bg-green-600 hover:bg-green-700" onClick={e => { e.stopPropagation(); setSelectedOrderId(o.id); setActualQty(String(o.plannedQuantity)); setCompleteDialogOpen(true); }}>
                                <CheckCircle className="h-3.5 w-3.5" />Terminer
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={e => { e.stopPropagation(); openDetail(o.id); }}><ChevronRight className="h-4 w-4" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="planning">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(planning as any[]).length === 0 ? (
              <Card className="col-span-3"><CardContent className="text-center py-12"><CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-2" /><p className="text-green-600 font-medium">Stocks en ordre</p></CardContent></Card>
            ) : (planning as any[]).map((s: any, i: number) => {
              const u = urgencyConfig[s.urgency] ?? { label: s.urgency, cls: "bg-gray-100" };
              return (
                <Card key={i}>
                  <CardHeader className="pb-2"><div className="flex items-start justify-between"><CardTitle className="text-base">{s.productName}</CardTitle><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${u.cls}`}>{u.label}</span></div></CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex justify-between text-sm"><span className="text-muted-foreground">Stock actuel</span><span className="font-medium text-red-600">{fmt3(s.currentStock)}</span></div>
                    <div className="flex justify-between text-sm"><span className="text-muted-foreground">Seuil alerte</span><span>{fmt3(s.alertQuantity)}</span></div>
                    <div className="flex justify-between text-sm"><span className="text-muted-foreground">Qté suggérée</span><span className="font-semibold text-green-600">{fmt3(s.suggestedQuantity)}</span></div>
                    {s.recipeId && <Button size="sm" className="w-full mt-2 h-7 text-xs" onClick={() => { setForm({ recipeId: String(s.recipeId), plannedQuantity: String(s.suggestedQuantity), branchId: "", status: "planned", notes: "", wastePercentage: "0" }); setCreateDialogOpen(true); }}><Plus className="h-3 w-3 mr-1" />Créer un ordre</Button>}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      {/* BOM Modal */}
      <Dialog open={bomModalOpen} onOpenChange={setBomModalOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><GitBranch className="h-5 w-5 text-purple-500" />Nomenclature BOM{bomOrder && <span className="font-mono text-sm font-normal text-muted-foreground ml-1">— {bomOrder.reference}</span>}</DialogTitle>
            <DialogDescription>Décomposition récursive des composants de la recette</DialogDescription>
          </DialogHeader>
          <BomPanel orderId={bomOrderId} />
        </DialogContent>
      </Dialog>

      {/* Detail sheet */}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {detailOrder && (
            <>
              <SheetHeader className="pb-4 border-b">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <SheetTitle className="font-mono text-sm">{(detailOrder as any).reference}</SheetTitle>
                    <p className="text-lg font-serif font-semibold mt-0.5">{(detailOrder as any).recipeName}</p>
                  </div>
                  {(() => { const s = statusConfig[(detailOrder as any).status] ?? { label: (detailOrder as any).status, cls: "bg-gray-100", dot: "bg-gray-400" }; return <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${s.cls}`}>{s.label}</span>; })()}
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm mt-1">
                  <div className="flex items-center gap-1.5 text-muted-foreground"><MapPin className="h-3.5 w-3.5" />{(detailOrder as any).branchName}</div>
                  <div className="flex items-center gap-1.5 text-muted-foreground"><Package className="h-3.5 w-3.5" />{fmt3((detailOrder as any).plannedQuantity)} planifiées</div>
                  <div className="flex items-center gap-1.5 font-medium"><DollarSign className="h-3.5 w-3.5 text-amber-500" />Coût: {formatDA((detailOrder as any).estimatedCost ?? (detailOrder as any).theoreticalCost)}</div>
                  {(detailOrder as any).profitability && (
                    <div className={`flex items-center gap-1.5 font-medium text-sm ${(detailOrder as any).profitability.marginLevel === "green" ? "text-green-700" : (detailOrder as any).profitability.marginLevel === "orange" ? "text-amber-700" : "text-red-700"}`}>
                      <BarChart3 className="h-3.5 w-3.5" />Marge: {(detailOrder as any).profitability.marginPct.toFixed(1)}%
                    </div>
                  )}
                </div>
                {["planned", "draft"].includes((detailOrder as any).status) && (
                  <Button size="sm" className="mt-3 w-full gap-1.5 h-8" onClick={() => handleLaunch(false)} disabled={launching}>
                    {launching ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}Lancer
                  </Button>
                )}
                {(detailOrder as any).status === "in_progress" && (
                  <Button size="sm" className="mt-3 w-full gap-1.5 h-8 bg-green-600 hover:bg-green-700" onClick={() => { setSelectedOrderId(detailOrderId!); setActualQty(String((detailOrder as any).plannedQuantity)); setCompleteDialogOpen(true); }}>
                    <CheckCircle className="h-3.5 w-3.5" />Terminer
                  </Button>
                )}
              </SheetHeader>
              <div className="pt-4">
                <Tabs value={detailTab} onValueChange={setDetailTab}>
                  <TabsList className="w-full grid grid-cols-4">
                    <TabsTrigger value="availability" className="text-xs"><ClipboardList className="h-3.5 w-3.5 mr-1" />Dispo.</TabsTrigger>
                    <TabsTrigger value="cost" className="text-xs"><DollarSign className="h-3.5 w-3.5 mr-1" />Coûts</TabsTrigger>
                    <TabsTrigger value="bom" className="text-xs"><GitBranch className="h-3.5 w-3.5 mr-1" />BOM</TabsTrigger>
                    <TabsTrigger value="overrides" className="text-xs">
                      <Shield className="h-3.5 w-3.5 mr-1" />Dérog.{overrideLogs.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{overrideLogs.length}</Badge>}
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="availability" className="mt-4"><AvailabilityPanel availability={availability} loading={availLoading} /></TabsContent>
                  <TabsContent value="cost" className="mt-4"><CostPanel orderId={detailOrderId} order={detailOrder} /></TabsContent>
                  <TabsContent value="bom" className="mt-4"><BomPanel orderId={detailOrderId} /></TabsContent>
                  <TabsContent value="overrides" className="mt-4"><OverrideLogsPanel logs={overrideLogs} /></TabsContent>
                </Tabs>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Create dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Nouvel ordre de production</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Recette *</Label>
              <Select value={form.recipeId} onValueChange={v => setForm(f => ({ ...f, recipeId: v }))}>
                <SelectTrigger><SelectValue placeholder="Choisir une recette..." /></SelectTrigger>
                <SelectContent>{(recipes as any[]).map((r: any) => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)}</SelectContent>
              </Select>
              {(() => {
                if (!form.recipeId) return null;
                const sel = (recipes as any[]).find((r: any) => String(r.id) === form.recipeId);
                const compCount = (sel?.components ?? sel?.ingredients ?? []).length;
                if (compCount === 0) return (
                  <Alert className="mt-2 border-amber-200 bg-amber-50 py-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <AlertDescription className="text-xs text-amber-700">
                      Cette recette n'a aucun composant. <a href="/recipes" className="underline font-medium">Ajoutez des ingrédients</a> avant de créer un ordre.
                    </AlertDescription>
                  </Alert>
                );
                return null;
              })()}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Quantité planifiée *</Label><Input type="number" step="0.001" value={form.plannedQuantity} onChange={e => setForm(f => ({ ...f, plannedQuantity: e.target.value }))} /></div>
              <div><Label>Pertes (%)</Label><Input type="number" step="0.5" min="0" max="100" value={form.wastePercentage} onChange={e => setForm(f => ({ ...f, wastePercentage: e.target.value }))} /></div>
            </div>
            <div>
              <Label>Boutique *</Label>
              <Select value={form.branchId} onValueChange={v => setForm(f => ({ ...f, branchId: v }))}>
                <SelectTrigger><SelectValue placeholder="Choisir une boutique..." /></SelectTrigger>
                <SelectContent>{(branches as any[]).map((b: any) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {/* Live cost preview */}
            <CostPreviewPanel recipeId={form.recipeId} quantity={form.plannedQuantity} wastePercentage={parseFloat(form.wastePercentage) || 0} />

            <div>
              <Label>Statut initial</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="draft">Brouillon</SelectItem><SelectItem value="planned">Planifié</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Annuler</Button>
            {(() => {
              const sel = (recipes as any[]).find((r: any) => String(r.id) === form.recipeId);
              const recipeEmpty = !!sel && (sel?.components ?? sel?.ingredients ?? []).length === 0;
              return (
                <Button
                  onClick={() => createMutation.mutate({ data: { recipeId: parseInt(form.recipeId), plannedQuantity: parseFloat(form.plannedQuantity), branchId: parseInt(form.branchId), status: form.status as any, notes: form.notes || null, wastePercentage: parseFloat(form.wastePercentage) || 0 } as any })}
                  disabled={!form.recipeId || !form.plannedQuantity || !form.branchId || recipeEmpty || createMutation.isPending}
                >
                  {createMutation.isPending ? "Création..." : "Créer"}
                </Button>
              );
            })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Complete dialog */}
      <Dialog open={completeDialogOpen} onOpenChange={setCompleteDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Terminer la production</DialogTitle><DialogDescription>Le stock sera mis à jour avec les coûts réels.</DialogDescription></DialogHeader>
          <div><Label>Quantité réelle produite *</Label><Input type="number" step="0.001" value={actualQty} onChange={e => setActualQty(e.target.value)} className="mt-1" /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteDialogOpen(false)}>Annuler</Button>
            <Button className="bg-green-600 hover:bg-green-700" onClick={() => { if (selectedOrderId && actualQty) completeMutation.mutate({ id: selectedOrderId, data: { actualQuantity: parseFloat(actualQty) } as any }); }} disabled={!actualQty || completeMutation.isPending}>
              {completeMutation.isPending ? "En cours..." : "Confirmer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Override dialog */}
      <Dialog open={overrideDialogOpen} onOpenChange={setOverrideDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-500" />Ingrédients insuffisants</DialogTitle><DialogDescription>Saisissez une raison pour lancer malgré les manques.</DialogDescription></DialogHeader>
          <div><Label>Raison *</Label><Textarea value={overrideReason} onChange={e => setOverrideReason(e.target.value)} rows={3} className="mt-1" /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideDialogOpen(false)}>Annuler</Button>
            <Button variant="destructive" onClick={() => handleLaunch(true)} disabled={!overrideReason.trim() || launching}>Lancer avec dérogation</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
