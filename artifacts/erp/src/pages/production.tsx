import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useGetProductionOrders, useCreateProductionOrder, useCompleteProductionOrder, useGetProductionPlanning, useGetRecipes, useGetBranches, getGetProductionOrdersQueryKey, getGetStockLevelsQueryKey, useGetCompanySettings } from "@workspace/api-client-react";
import { generateProductionOrderPdf } from "@/lib/pdf-generator";
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
  Plus, PlayCircle, CheckCircle, Factory, Lightbulb,
  AlertTriangle, XCircle, CheckCircle2, Package, MapPin,
  FlaskConical, User, Calendar, Shield, ChevronRight,
  RefreshCw, Clock, ClipboardList, FileDown, Layers, GitBranch,
} from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "@/hooks/use-toast";

function formatDA(n: number) { return new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(n) + " DA"; }
function fmt3(n: number) { return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(n); }

const API = "/api";
function authHeaders() { return { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` }; }

type IngredientRow = {
  ingredientProductId: number;
  ingredientName: string;
  unitAbbreviation: string;
  requiredQty: number;
  availableQty: number;
  shortageQty: number;
  wastageRate: number;
  status: "ok" | "short" | "missing";
};
type AvailabilityResult = {
  recipeId: number;
  recipeName: string;
  recipeYield: number;
  plannedQuantity: number;
  branchId: number;
  branchName: string;
  scaleFactor: number;
  rows: IngredientRow[];
  overallStatus: "available" | "partial" | "unavailable";
  canLaunch: boolean;
};
type OverrideLog = {
  id: number;
  productionOrderId: number;
  userId: number;
  reason: string;
  userName: string | null;
  createdAt: string;
};
type BomLeaf = { type: "product"; productId: number; productName: string; quantity: number; unitAbbreviation: string; wastageRate: number };
type BomNode = { type: "recipe"; recipeId: number; recipeName: string; quantity: number; scaleFactor: number; children: Array<BomNode | BomLeaf> };
type BomResult = { materials: Array<{ productId: number; productName: string; quantity: number; unitAbbreviation: string; costPrice: number; totalCost: number }>; tree: BomNode; totalCost: number };

const statusConfig: Record<string, { label: string; cls: string; dot: string }> = {
  draft:       { label: "Brouillon",  cls: "bg-gray-100 text-gray-700",   dot: "bg-gray-400" },
  planned:     { label: "Planifié",   cls: "bg-blue-100 text-blue-700",   dot: "bg-blue-500" },
  launched:    { label: "Lancé",      cls: "bg-amber-100 text-amber-700", dot: "bg-amber-500" },
  in_progress: { label: "En cours",  cls: "bg-orange-100 text-orange-700", dot: "bg-orange-500" },
  completed:   { label: "Terminé",   cls: "bg-green-100 text-green-700",  dot: "bg-green-500" },
  cancelled:   { label: "Annulé",    cls: "bg-red-100 text-red-700",      dot: "bg-red-400" },
};

const availStatusConfig = {
  available:   { label: "Ingrédients disponibles",    icon: CheckCircle2,   bg: "bg-green-50",  border: "border-green-200", text: "text-green-700", badge: "bg-green-100 text-green-700" },
  partial:     { label: "Ingrédients insuffisants",   icon: AlertTriangle,  bg: "bg-amber-50",  border: "border-amber-200", text: "text-amber-700", badge: "bg-amber-100 text-amber-700" },
  unavailable: { label: "Aucun ingrédient en stock",  icon: XCircle,        bg: "bg-red-50",    border: "border-red-200",   text: "text-red-700",   badge: "bg-red-100 text-red-700" },
};

const rowStatusConfig = {
  ok:      { icon: CheckCircle2, cls: "text-green-600", rowBg: "bg-green-50/50", label: "Disponible" },
  short:   { icon: AlertTriangle, cls: "text-amber-500", rowBg: "bg-amber-50/50", label: "Insuffisant" },
  missing: { icon: XCircle, cls: "text-red-500", rowBg: "bg-red-50/50", label: "Manquant" },
};

function useProductionAvailability(orderId: number | null, enabled: boolean) {
  return useQuery<AvailabilityResult>({
    queryKey: ["production-availability", orderId],
    queryFn: async () => {
      const r = await fetch(`${API}/production/${orderId}/availability`, { headers: authHeaders() });
      if (!r.ok) throw new Error("Erreur lors du chargement de la disponibilité");
      return r.json();
    },
    enabled: !!orderId && enabled,
    staleTime: 30_000,
  });
}

function useProductionOverrides(orderId: number | null, enabled: boolean) {
  return useQuery<OverrideLog[]>({
    queryKey: ["production-overrides", orderId],
    queryFn: async () => {
      const r = await fetch(`${API}/production/${orderId}/overrides`, { headers: authHeaders() });
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    },
    enabled: !!orderId && enabled,
  });
}

function useProductionBom(orderId: number | null, enabled: boolean) {
  return useQuery<BomResult>({
    queryKey: ["production-bom", orderId],
    queryFn: async () => {
      const r = await fetch(`${API}/production/${orderId}/bom`, { headers: authHeaders() });
      if (!r.ok) throw new Error("Erreur BOM");
      return r.json();
    },
    enabled: !!orderId && enabled,
    staleTime: 60_000,
  });
}

function BomTreeNode({ node, depth = 0 }: { node: BomNode | BomLeaf; depth?: number }) {
  const indent = depth * 20;
  if (node.type === "product") {
    return (
      <div className="flex items-center gap-2 py-1.5 text-sm" style={{ paddingLeft: indent + 8 }}>
        <Package className="h-3.5 w-3.5 text-gray-400 shrink-0" />
        <span className="flex-1">{node.productName}</span>
        <span className="font-mono text-xs text-muted-foreground">{fmt3(node.quantity)} {node.unitAbbreviation}</span>
        {node.wastageRate > 0 && <span className="text-xs text-amber-600">+{node.wastageRate}%</span>}
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-center gap-2 py-1.5 text-sm font-semibold" style={{ paddingLeft: indent }}>
        <Layers className="h-3.5 w-3.5 text-purple-500 shrink-0" />
        <span className="flex-1 text-purple-700">{node.recipeName}</span>
        <span className="font-mono text-xs text-purple-600">×{fmt3(node.scaleFactor)}</span>
      </div>
      {node.children.map((child, i) => (
        <BomTreeNode key={i} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

function BomPanel({ orderId }: { orderId: number | null }) {
  const { data: bom, isLoading, error } = useProductionBom(orderId, !!orderId);

  if (isLoading) return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
      <RefreshCw className="h-4 w-4 animate-spin" />Calcul de la nomenclature...
    </div>
  );
  if (error || !bom) return (
    <div className="text-center py-8 text-sm text-muted-foreground">Impossible de charger la nomenclature.</div>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-purple-50/40 border-purple-100 p-4">
        <div className="flex items-start gap-3">
          <GitBranch className="h-5 w-5 text-purple-500 mt-0.5" />
          <div>
            <p className="font-semibold text-sm text-purple-700">Nomenclature (BOM) — Arbre de décomposition</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {bom.materials.length} matière{bom.materials.length > 1 ? "s" : ""} première{bom.materials.length > 1 ? "s" : ""} · Coût total: <span className="font-semibold text-amber-600">{formatDA(bom.totalCost)}</span>
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-md border overflow-hidden">
        <div className="bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">Arbre de composition</div>
        <div className="p-2 divide-y">
          <BomTreeNode node={bom.tree} depth={0} />
        </div>
      </div>

      <div className="rounded-md border overflow-hidden">
        <div className="bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">Matières premières agrégées</div>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/20">
              <TableHead className="text-xs py-2">Matière</TableHead>
              <TableHead className="text-xs py-2 text-right">Quantité totale</TableHead>
              <TableHead className="text-xs py-2 text-right">Coût unitaire</TableHead>
              <TableHead className="text-xs py-2 text-right">Coût total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bom.materials.map((m, i) => (
              <TableRow key={i}>
                <TableCell className="py-2 text-sm font-medium">{m.productName}</TableCell>
                <TableCell className="py-2 text-right font-mono text-sm">
                  {fmt3(m.quantity)} <span className="text-muted-foreground">{m.unitAbbreviation}</span>
                </TableCell>
                <TableCell className="py-2 text-right text-sm text-muted-foreground">{formatDA(m.costPrice)}</TableCell>
                <TableCell className="py-2 text-right font-semibold text-sm">{formatDA(m.totalCost)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AvailabilityPanel({ availability, loading }: { availability?: AvailabilityResult; loading: boolean }) {
  if (loading) return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
      <RefreshCw className="h-4 w-4 animate-spin" />Analyse des ingrédients...
    </div>
  );
  if (!availability) return null;

  const cfg = availStatusConfig[availability.overallStatus];
  const Icon = cfg.icon;
  const totalIngredients = availability.rows.length;
  const okCount = availability.rows.filter(r => r.status === "ok").length;
  const shortCount = availability.rows.filter(r => r.status === "short").length;
  const missingCount = availability.rows.filter(r => r.status === "missing").length;

  return (
    <div className="space-y-4">
      <div className={`rounded-lg border p-4 ${cfg.bg} ${cfg.border}`}>
        <div className="flex items-start gap-3">
          <Icon className={`h-5 w-5 mt-0.5 ${cfg.text}`} />
          <div className="flex-1">
            <p className={`font-semibold text-sm ${cfg.text}`}>{cfg.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {availability.recipeName} · ×{fmt3(availability.scaleFactor)} · {availability.branchName}
            </p>
            <div className="flex gap-3 mt-2">
              {okCount > 0 && <span className="text-xs font-medium text-green-700">{okCount} disponible{okCount > 1 ? "s" : ""}</span>}
              {shortCount > 0 && <span className="text-xs font-medium text-amber-700">{shortCount} insuffisant{shortCount > 1 ? "s" : ""}</span>}
              {missingCount > 0 && <span className="text-xs font-medium text-red-700">{missingCount} manquant{missingCount > 1 ? "s" : ""}</span>}
            </div>
          </div>
          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${cfg.badge}`}>
            {okCount}/{totalIngredients}
          </span>
        </div>
      </div>

      <div className="rounded-md border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="text-xs py-2">Ingrédient</TableHead>
              <TableHead className="text-xs py-2 text-right">Requis</TableHead>
              <TableHead className="text-xs py-2 text-right">Disponible</TableHead>
              <TableHead className="text-xs py-2 text-right">Manque</TableHead>
              <TableHead className="text-xs py-2 text-center">État</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {availability.rows.map((row, i) => {
              const rCfg = rowStatusConfig[row.status];
              const StatusIcon = rCfg.icon;
              const usedPct = row.requiredQty > 0 ? Math.min(100, (row.availableQty / row.requiredQty) * 100) : 100;
              return (
                <TableRow key={i} className={`${rCfg.rowBg} hover:opacity-90`}>
                  <TableCell className="py-2">
                    <div className="font-medium text-sm">{row.ingredientName}</div>
                    {row.wastageRate > 0 && (
                      <div className="text-xs text-muted-foreground">incl. {row.wastageRate}% pertes</div>
                    )}
                    <Progress value={usedPct} className="h-1 mt-1 w-24" />
                  </TableCell>
                  <TableCell className="py-2 text-right font-mono text-sm font-semibold">
                    {fmt3(row.requiredQty)} <span className="text-muted-foreground font-normal">{row.unitAbbreviation}</span>
                  </TableCell>
                  <TableCell className="py-2 text-right font-mono text-sm">
                    {fmt3(row.availableQty)} <span className="text-muted-foreground">{row.unitAbbreviation}</span>
                  </TableCell>
                  <TableCell className="py-2 text-right font-mono text-sm">
                    {row.shortageQty > 0 ? (
                      <span className="text-red-600 font-semibold">−{fmt3(row.shortageQty)} {row.unitAbbreviation}</span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="py-2">
                    <div className="flex justify-center">
                      <StatusIcon className={`h-4 w-4 ${rCfg.cls}`} />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function OverrideLogsPanel({ logs }: { logs: OverrideLog[] }) {
  if (logs.length === 0) return (
    <div className="text-center py-8 text-sm text-muted-foreground">
      Aucun lancement avec dérogation
    </div>
  );
  return (
    <div className="space-y-3">
      {logs.map(l => (
        <div key={l.id} className="rounded-md border border-amber-200 bg-amber-50/40 p-4">
          <div className="flex items-start gap-3">
            <Shield className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-sm">{l.userName ?? `Utilisateur #${l.userId}`}</span>
                <span className="text-xs text-muted-foreground">
                  {format(new Date(l.createdAt), "dd MMM yyyy à HH:mm", { locale: fr })}
                </span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{l.reason}</p>
            </div>
          </div>
        </div>
      ))}
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
  const [form, setForm] = useState({ recipeId: "", plannedQuantity: "", branchId: "", status: "planned", notes: "" });

  const { data: orders = [], isLoading } = useGetProductionOrders({});
  const { data: planning = [] } = useGetProductionPlanning({});
  const { data: recipes = [] } = useGetRecipes({});
  const { data: branches = [] } = useGetBranches();
  const { data: companySettings } = useGetCompanySettings();

  const { data: availability, isLoading: availLoading, refetch: refetchAvail } = useProductionAvailability(detailOrderId, detailOpen);
  const { data: overrideLogs = [], refetch: refetchOverrides } = useProductionOverrides(detailOrderId, detailOpen);

  const createMutation = useCreateProductionOrder({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetProductionOrdersQueryKey() });
        setCreateDialogOpen(false);
        toast({ title: "Ordre de production créé" });
      }
    }
  });

  const completeMutation = useCompleteProductionOrder({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetProductionOrdersQueryKey() });
        qc.invalidateQueries({ queryKey: getGetStockLevelsQueryKey() });
        setCompleteDialogOpen(false);
        if (detailOrderId) refetchAvail();
        toast({ title: "Production terminée", description: "Le stock a été mis à jour." });
      }
    }
  });

  const detailOrder = orders.find((o: any) => o.id === detailOrderId);
  const bomOrder = orders.find((o: any) => o.id === bomOrderId);

  function openDetail(orderId: number) {
    setDetailOrderId(orderId);
    setDetailTab("availability");
    setDetailOpen(true);
  }

  function openBom(orderId: number) {
    setBomOrderId(orderId);
    setBomModalOpen(true);
  }

  async function handleLaunch(withOverride = false) {
    if (!detailOrderId) return;
    if (withOverride && !overrideReason.trim()) {
      toast({ title: "Raison requise", description: "Veuillez expliquer la raison du lancement malgré les manques.", variant: "destructive" });
      return;
    }
    setLaunching(true);
    try {
      const body: Record<string, unknown> = {};
      if (withOverride) body.overrideReason = overrideReason.trim();
      const res = await fetch(`${API}/production/${detailOrderId}/launch`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.status === 409 && data.code === "INGREDIENTS_UNAVAILABLE") {
        setOverrideDialogOpen(true);
        return;
      }
      if (res.status === 403) {
        toast({ title: "Accès refusé", description: "Votre rôle ne permet pas de lancer avec des ingrédients insuffisants.", variant: "destructive" });
        return;
      }
      if (!res.ok) {
        toast({ title: "Erreur", description: data.error ?? "Impossible de lancer la production.", variant: "destructive" });
        return;
      }
      setOverrideDialogOpen(false);
      setOverrideReason("");
      qc.invalidateQueries({ queryKey: getGetProductionOrdersQueryKey() });
      refetchAvail();
      refetchOverrides();
      toast({ title: "Production lancée !", description: withOverride ? "Lancement autorisé avec dérogation enregistrée." : "La production a démarré." });
    } finally {
      setLaunching(false);
    }
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
          <p className="text-sm text-muted-foreground mt-0.5">Ordres de fabrication et gestion des ingrédients</p>
        </div>
        <Button onClick={() => { setForm({ recipeId: "", plannedQuantity: "", branchId: "", status: "planned", notes: "" }); setCreateDialogOpen(true); }} className="gap-2">
          <Plus className="h-4 w-4" />Nouvel ordre
        </Button>
      </div>

      <Tabs value={mainTab} onValueChange={setMainTab}>
        <TabsList>
          <TabsTrigger value="orders" className="gap-2">
            <Factory className="h-4 w-4" />Ordres de production
            <Badge variant="secondary" className="text-xs ml-1">{orders.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="planning" className="gap-2">
            <Lightbulb className="h-4 w-4" />Planification
            {planning.length > 0 && <Badge variant="secondary" className="text-xs">{planning.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="orders">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Référence</TableHead>
                    <TableHead>Recette</TableHead>
                    <TableHead>Boutique</TableHead>
                    <TableHead className="text-right">Qté planifiée</TableHead>
                    <TableHead className="text-right">Coût théo.</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">Chargement...</TableCell></TableRow>
                  ) : orders.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">Aucun ordre de production</TableCell></TableRow>
                  ) : (orders as any[]).map(o => {
                    const s = statusConfig[o.status] ?? { label: o.status, cls: "bg-gray-100", dot: "bg-gray-400" };
                    return (
                      <TableRow key={o.id} className="cursor-pointer hover:bg-muted/40" onClick={() => openDetail(o.id)}>
                        <TableCell className="font-mono text-xs font-semibold">{o.reference}</TableCell>
                        <TableCell>
                          <span className="font-medium text-sm">{o.recipeName}</span>
                          {o.productName && <p className="text-xs text-muted-foreground">{o.productName}</p>}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <MapPin className="h-3 w-3" />{o.branchName}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmt3(o.plannedQuantity)}</TableCell>
                        <TableCell className="text-right text-sm">{formatDA(o.theoreticalCost)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${s.cls}`}>{s.label}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{format(new Date(o.createdAt), "dd/MM/yyyy")}</TableCell>
                        <TableCell onClick={e => e.stopPropagation()}>
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={e => { e.stopPropagation(); openBom(o.id); }}>
                              <GitBranch className="h-3 w-3" />BOM
                            </Button>
                            {(o.status === "launched" || o.status === "in_progress") && (
                              <Button size="sm" className="h-7 text-xs gap-1" onClick={e => { e.stopPropagation(); setSelectedOrderId(o.id); setActualQty(String(o.plannedQuantity)); setCompleteDialogOpen(true); }}>
                                <CheckCircle className="h-3.5 w-3.5" />Terminer
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={e => { e.stopPropagation(); openDetail(o.id); }}>
                              <ChevronRight className="h-4 w-4" />
                            </Button>
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
            {planning.length === 0 ? (
              <Card className="col-span-3">
                <CardContent className="text-center py-12">
                  <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-2" />
                  <p className="text-green-600 font-medium">Stocks en ordre</p>
                  <p className="text-sm text-muted-foreground mt-1">Aucune production urgente nécessaire</p>
                </CardContent>
              </Card>
            ) : (planning as any[]).map((s, i) => {
              const u = urgencyConfig[s.urgency] ?? { label: s.urgency, cls: "bg-gray-100" };
              return (
                <Card key={i} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-base">{s.productName}</CardTitle>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${u.cls}`}>{u.label}</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex justify-between text-sm"><span className="text-muted-foreground">Stock actuel</span><span className="font-medium text-red-600">{fmt3(s.currentStock)}</span></div>
                    <div className="flex justify-between text-sm"><span className="text-muted-foreground">Seuil alerte</span><span>{fmt3(s.alertQuantity)}</span></div>
                    <div className="flex justify-between text-sm"><span className="text-muted-foreground">Qté suggérée</span><span className="font-semibold text-green-600">{fmt3(s.suggestedQuantity)}</span></div>
                    {s.recipeId && (
                      <Button size="sm" className="w-full mt-2 h-7 text-xs" onClick={() => {
                        setForm({ recipeId: String(s.recipeId), plannedQuantity: String(s.suggestedQuantity), branchId: "", status: "planned", notes: "" });
                        setCreateDialogOpen(true);
                      }}>
                        <Plus className="h-3 w-3 mr-1" />Créer un ordre
                      </Button>
                    )}
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
            <DialogTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-purple-500" />
              Nomenclature BOM
              {bomOrder && <span className="font-mono text-sm font-normal text-muted-foreground ml-1">— {bomOrder.reference}</span>}
            </DialogTitle>
            <DialogDescription>
              Décomposition récursive complète de tous les composants de la recette
            </DialogDescription>
          </DialogHeader>
          <BomPanel orderId={bomOrderId} />
        </DialogContent>
      </Dialog>

      {/* Production order detail sheet */}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {detailOrder && (
            <>
              <SheetHeader className="pb-4 border-b">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <SheetTitle className="font-mono text-base">{(detailOrder as any).reference}</SheetTitle>
                    <p className="text-lg font-serif font-semibold mt-0.5">{(detailOrder as any).recipeName}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {(() => {
                      const s = statusConfig[(detailOrder as any).status] ?? { label: (detailOrder as any).status, cls: "bg-gray-100", dot: "bg-gray-400" };
                      return <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${s.cls}`}>{s.label}</span>;
                    })()}
                    <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" onClick={() => { openBom(detailOrder.id); setDetailOpen(false); }}>
                      <GitBranch className="h-3.5 w-3.5 text-purple-500" />Voir BOM
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm mt-2">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" />{(detailOrder as any).branchName}
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Package className="h-3.5 w-3.5" />{fmt3((detailOrder as any).plannedQuantity)} unités planifiées
                  </div>
                  {(detailOrder as any).createdByName && (
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <User className="h-3.5 w-3.5" />{(detailOrder as any).createdByName}
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" />{format(new Date((detailOrder as any).createdAt), "dd MMM yyyy", { locale: fr })}
                  </div>
                  <div className="flex items-center gap-1.5 font-medium">
                    <FlaskConical className="h-3.5 w-3.5 text-amber-500" />
                    Coût théo.: {formatDA((detailOrder as any).theoreticalCost)}
                  </div>
                  {(detailOrder as any).actualCost != null && (
                    <div className="flex items-center gap-1.5 font-medium text-green-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Coût réel: {formatDA((detailOrder as any).actualCost)}
                    </div>
                  )}
                </div>
                {["planned", "draft"].includes((detailOrder as any).status) && (
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" className="flex-1 gap-1.5 h-8" onClick={() => handleLaunch(false)} disabled={launching}>
                      {launching ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
                      Lancer la production
                    </Button>
                  </div>
                )}
                {(detailOrder as any).status === "in_progress" && (
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" className="flex-1 gap-1.5 h-8 bg-green-600 hover:bg-green-700" onClick={() => { setSelectedOrderId(detailOrder.id); setActualQty(String((detailOrder as any).plannedQuantity)); setCompleteDialogOpen(true); }}>
                      <CheckCircle className="h-3.5 w-3.5" />Terminer la production
                    </Button>
                  </div>
                )}
              </SheetHeader>

              <div className="pt-4">
                <Tabs value={detailTab} onValueChange={setDetailTab}>
                  <TabsList className="w-full">
                    <TabsTrigger value="availability" className="flex-1 text-xs">
                      <ClipboardList className="h-3.5 w-3.5 mr-1" />Disponibilité
                    </TabsTrigger>
                    <TabsTrigger value="bom" className="flex-1 text-xs">
                      <GitBranch className="h-3.5 w-3.5 mr-1" />Nomenclature BOM
                    </TabsTrigger>
                    <TabsTrigger value="overrides" className="flex-1 text-xs">
                      <Shield className="h-3.5 w-3.5 mr-1" />Dérogations
                      {overrideLogs.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{overrideLogs.length}</Badge>}
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="availability" className="mt-4">
                    <AvailabilityPanel availability={availability} loading={availLoading} />
                  </TabsContent>
                  <TabsContent value="bom" className="mt-4">
                    <BomPanel orderId={detailOrderId} />
                  </TabsContent>
                  <TabsContent value="overrides" className="mt-4">
                    <OverrideLogsPanel logs={overrideLogs} />
                  </TabsContent>
                </Tabs>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Create Order Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nouvel ordre de production</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Recette *</Label>
              <Select value={form.recipeId} onValueChange={v => setForm(f => ({ ...f, recipeId: v }))}>
                <SelectTrigger><SelectValue placeholder="Choisir une recette..." /></SelectTrigger>
                <SelectContent>{(recipes as any[]).map((r: any) => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Quantité planifiée *</Label>
              <Input type="number" step="0.001" value={form.plannedQuantity} onChange={e => setForm(f => ({ ...f, plannedQuantity: e.target.value }))} />
            </div>
            <div>
              <Label>Boutique *</Label>
              <Select value={form.branchId} onValueChange={v => setForm(f => ({ ...f, branchId: v }))}>
                <SelectTrigger><SelectValue placeholder="Choisir une boutique..." /></SelectTrigger>
                <SelectContent>{(branches as any[]).map((b: any) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Statut initial</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Brouillon</SelectItem>
                  <SelectItem value="planned">Planifié</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Annuler</Button>
            <Button onClick={() => createMutation.mutate({ data: { recipeId: parseInt(form.recipeId), plannedQuantity: parseFloat(form.plannedQuantity), branchId: parseInt(form.branchId), status: form.status as any, notes: form.notes || null } as any })} disabled={!form.recipeId || !form.plannedQuantity || !form.branchId}>
              Créer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Complete Dialog */}
      <Dialog open={completeDialogOpen} onOpenChange={setCompleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Terminer la production</DialogTitle>
            <DialogDescription>Saisir la quantité réellement produite. Le stock sera mis à jour automatiquement.</DialogDescription>
          </DialogHeader>
          <div>
            <Label>Quantité réelle produite *</Label>
            <Input type="number" step="0.001" value={actualQty} onChange={e => setActualQty(e.target.value)} className="mt-1" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteDialogOpen(false)}>Annuler</Button>
            <Button className="bg-green-600 hover:bg-green-700" onClick={() => { if (selectedOrderId && actualQty) completeMutation.mutate({ id: selectedOrderId, data: { actualQuantity: parseFloat(actualQty) } as any }); }} disabled={!actualQty || completeMutation.isPending}>
              {completeMutation.isPending ? "En cours..." : "Confirmer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Override Dialog */}
      <Dialog open={overrideDialogOpen} onOpenChange={setOverrideDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-500" />Ingrédients insuffisants</DialogTitle>
            <DialogDescription>Des ingrédients manquent. Vous pouvez lancer avec dérogation si vous avez les droits.</DialogDescription>
          </DialogHeader>
          <div>
            <Label>Raison de la dérogation *</Label>
            <Textarea value={overrideReason} onChange={e => setOverrideReason(e.target.value)} rows={3} placeholder="Expliquez pourquoi vous lancez malgré les manques..." className="mt-1" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideDialogOpen(false)}>Annuler</Button>
            <Button variant="destructive" onClick={() => handleLaunch(true)} disabled={!overrideReason.trim() || launching}>
              {launching ? "Lancement..." : "Lancer avec dérogation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
