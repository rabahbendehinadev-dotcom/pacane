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
  RefreshCw, Clock, ClipboardList, FileDown,
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
      {/* Summary card */}
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

      {/* Per-ingredient table */}
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

  const detailOrder = orders.find(o => o.id === detailOrderId);

  function openDetail(orderId: number) {
    setDetailOrderId(orderId);
    setDetailTab("availability");
    setDetailOpen(true);
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
                  ) : orders.map(o => {
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
            ) : planning.map((s, i) => {
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

      {/* Production order detail sheet */}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {detailOrder && (
            <>
              <SheetHeader className="pb-4 border-b">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <SheetTitle className="font-mono text-base">{detailOrder.reference}</SheetTitle>
                    <p className="text-lg font-serif font-semibold mt-0.5">{detailOrder.recipeName}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {(() => {
                      const s = statusConfig[detailOrder.status] ?? { label: detailOrder.status, cls: "bg-gray-100", dot: "bg-gray-400" };
                      return <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${s.cls}`}>{s.label}</span>;
                    })()}
                    <Button
                      variant="outline" size="sm" className="gap-1.5 h-8 text-xs"
                      onClick={() => {
                        if (!detailOrder || !companySettings) return;
                        generateProductionOrderPdf({
                          reference: detailOrder.reference, status: detailOrder.status,
                          recipeName: detailOrder.recipeName,
                          productName: (detailOrder as any).productName ?? null,
                          branchName: detailOrder.branchName,
                          plannedQuantity: parseFloat(String(detailOrder.plannedQuantity)),
                          actualQuantity: detailOrder.actualQuantity != null ? parseFloat(String(detailOrder.actualQuantity)) : null,
                          theoreticalCost: parseFloat(String(detailOrder.theoreticalCost)),
                          actualCost: (detailOrder as any).actualCost != null ? parseFloat(String((detailOrder as any).actualCost)) : null,
                          startedAt: (detailOrder as any).startedAt ?? null,
                          completedAt: (detailOrder as any).completedAt ?? null,
                          createdAt: detailOrder.createdAt,
                          notes: (detailOrder as any).notes ?? null,
                          ingredients: availability?.ingredients?.map((ing: any) => ({
                            ingredientName: ing.ingredientName ?? ing.name,
                            unitAbbreviation: ing.unitAbbreviation,
                            requiredQty: ing.requiredQuantity ?? ing.required,
                            availableQty: ing.availableQuantity ?? ing.available,
                            status: ing.status ?? (ing.available >= ing.required ? "ok" : ing.available > 0 ? "short" : "missing"),
                          })),
                        }, companySettings as any);
                      }}
                    >
                      <FileDown className="h-3.5 w-3.5" />PDF
                    </Button>
                  </div>
                </div>
              </SheetHeader>

              {/* Order metadata */}
              <div className="grid grid-cols-2 gap-3 py-4 border-b">
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Boutique / Labo</p>
                    <p className="font-medium">{detailOrder.branchName}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <FlaskConical className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Quantité planifiée</p>
                    <p className="font-medium font-mono">{fmt3(detailOrder.plannedQuantity)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Produit fini</p>
                    <p className="font-medium">{detailOrder.productName ?? "Non défini"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <ClipboardList className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Coût théorique</p>
                    <p className="font-medium">{formatDA(detailOrder.theoreticalCost)}</p>
                  </div>
                </div>
                {detailOrder.createdByName && (
                  <div className="flex items-center gap-2 text-sm">
                    <User className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Créé par</p>
                      <p className="font-medium">{detailOrder.createdByName}</p>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Créé le</p>
                    <p className="font-medium">{format(new Date(detailOrder.createdAt), "dd MMM yyyy", { locale: fr })}</p>
                  </div>
                </div>
                {detailOrder.startedAt && (
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Lancé le</p>
                      <p className="font-medium">{format(new Date(detailOrder.startedAt), "dd MMM yyyy HH:mm", { locale: fr })}</p>
                    </div>
                  </div>
                )}
              </div>

              {detailOrder.notes && (
                <div className="py-3 border-b">
                  <p className="text-xs text-muted-foreground mb-1">Notes</p>
                  <p className="text-sm">{detailOrder.notes}</p>
                </div>
              )}

              {/* Detail tabs */}
              <Tabs value={detailTab} onValueChange={setDetailTab} className="mt-4">
                <TabsList className="w-full">
                  <TabsTrigger value="availability" className="flex-1 text-xs gap-1">
                    <FlaskConical className="h-3.5 w-3.5" />Disponibilité ingrédients
                    {availability && !availability.canLaunch && (
                      <span className="ml-1 w-2 h-2 rounded-full bg-amber-500 inline-block" />
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="overrides" className="flex-1 text-xs gap-1">
                    <Shield className="h-3.5 w-3.5" />Dérogations
                    {overrideLogs.length > 0 && (
                      <Badge variant="secondary" className="text-xs ml-1">{overrideLogs.length}</Badge>
                    )}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="availability" className="mt-4">
                  <AvailabilityPanel availability={availability} loading={availLoading} />

                  {/* Launch action */}
                  {(detailOrder.status === "planned" || detailOrder.status === "draft") && (
                    <div className="mt-6 pt-4 border-t">
                      {availability?.canLaunch ? (
                        <div className="space-y-3">
                          <Alert className="bg-green-50 border-green-200">
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                            <AlertDescription className="text-green-700 text-sm">
                              Tous les ingrédients sont disponibles. La production peut être lancée.
                            </AlertDescription>
                          </Alert>
                          <Button className="w-full gap-2" onClick={() => handleLaunch(false)} disabled={launching}>
                            {launching ? <RefreshCw className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                            Lancer la production
                          </Button>
                        </div>
                      ) : availability && !availability.canLaunch ? (
                        <div className="space-y-3">
                          <Alert className="bg-amber-50 border-amber-200">
                            <AlertTriangle className="h-4 w-4 text-amber-600" />
                            <AlertDescription className="text-amber-700 text-sm">
                              Des ingrédients sont insuffisants. Un responsable peut autoriser le lancement avec dérogation.
                            </AlertDescription>
                          </Alert>
                          <Button variant="outline" className="w-full gap-2 border-amber-300 text-amber-700 hover:bg-amber-50" onClick={() => handleLaunch(false)} disabled={launching}>
                            <Shield className="h-4 w-4" />
                            Demander dérogation et lancer
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  )}

                  {(detailOrder.status === "launched" || detailOrder.status === "in_progress") && (
                    <div className="mt-6 pt-4 border-t">
                      <Button className="w-full gap-2" onClick={() => { setSelectedOrderId(detailOrder.id); setActualQty(String(detailOrder.plannedQuantity)); setCompleteDialogOpen(true); }}>
                        <CheckCircle className="h-4 w-4" />Finaliser la production
                      </Button>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="overrides" className="mt-4">
                  <OverrideLogsPanel logs={overrideLogs} />
                </TabsContent>
              </Tabs>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Override dialog */}
      <Dialog open={overrideDialogOpen} onOpenChange={v => { setOverrideDialogOpen(v); if (!v) setOverrideReason(""); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-amber-600" />
              Lancement avec dérogation
            </DialogTitle>
            <DialogDescription>
              Des ingrédients sont insuffisants. En tant que responsable, vous pouvez autoriser le lancement. La raison sera enregistrée dans le journal d'audit.
            </DialogDescription>
          </DialogHeader>

          {availability && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 my-2">
              <p className="text-xs font-semibold text-amber-700 mb-2">Ingrédients insuffisants :</p>
              <div className="space-y-1">
                {availability.rows.filter(r => r.status !== "ok").map((r, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-amber-800">{r.ingredientName}</span>
                    <span className="font-mono text-red-600">−{fmt3(r.shortageQty)} {r.unitAbbreviation}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <Label>Raison de la dérogation <span className="text-red-500">*</span></Label>
            <Textarea
              className="mt-1.5"
              rows={3}
              placeholder="Ex: Livraison fournisseur attendue demain. Lancement autorisé pour honorer la commande client..."
              value={overrideReason}
              onChange={e => setOverrideReason(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setOverrideDialogOpen(false); setOverrideReason(""); }}>Annuler</Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 gap-2"
              onClick={() => handleLaunch(true)}
              disabled={!overrideReason.trim() || launching}
            >
              {launching ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
              Autoriser et lancer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nouvel ordre de production</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Recette <span className="text-red-500">*</span></Label>
              <Select value={form.recipeId} onValueChange={v => setForm(f => ({ ...f, recipeId: v }))}>
                <SelectTrigger><SelectValue placeholder="Choisir une recette..." /></SelectTrigger>
                <SelectContent>{recipes.map(r => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Quantité planifiée <span className="text-red-500">*</span></Label>
                <Input type="number" step="0.001" min="0" value={form.plannedQuantity} onChange={e => setForm(f => ({ ...f, plannedQuantity: e.target.value }))} />
              </div>
              <div>
                <Label>Boutique <span className="text-red-500">*</span></Label>
                <Select value={form.branchId} onValueChange={v => setForm(f => ({ ...f, branchId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Choisir..." /></SelectTrigger>
                  <SelectContent>{branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
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
            <div>
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Instructions, remarques..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Annuler</Button>
            <Button
              onClick={() => createMutation.mutate({ data: { recipeId: parseInt(form.recipeId), plannedQuantity: parseFloat(form.plannedQuantity), branchId: parseInt(form.branchId), status: form.status as any, notes: form.notes || null } })}
              disabled={!form.recipeId || !form.plannedQuantity || !form.branchId || createMutation.isPending}
            >
              {createMutation.isPending ? "Création..." : "Créer l'ordre"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Complete dialog */}
      <Dialog open={completeDialogOpen} onOpenChange={setCompleteDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Finaliser la production</DialogTitle>
            <DialogDescription>Saisir la quantité réellement produite. Le stock sera ajusté automatiquement.</DialogDescription>
          </DialogHeader>
          <div>
            <Label>Quantité produite <span className="text-red-500">*</span></Label>
            <Input type="number" step="0.001" value={actualQty} onChange={e => setActualQty(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteDialogOpen(false)}>Annuler</Button>
            <Button onClick={() => selectedOrderId && completeMutation.mutate({ id: selectedOrderId, data: { actualQuantity: parseFloat(actualQty) } })} disabled={!actualQty || completeMutation.isPending}>
              {completeMutation.isPending ? "Finalisation..." : "Terminer la production"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
