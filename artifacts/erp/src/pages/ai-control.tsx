import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useGetBranches } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  Cpu, RefreshCw, Zap, TrendingUp, TrendingDown, ShoppingCart, ArrowLeftRight,
  Factory, DollarSign, AlertTriangle, CheckCircle2, Flame, Target, BarChart3,
  ChevronRight, MapPin, PlayCircle, Lightbulb, Layers, Package, GitBranch,
  Activity, Shield, Minus, ArrowUpRight, ArrowDownRight, CircleAlert, Info,
  Wand2, Sparkles, Bot,
} from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

// ─── Types ───────────────────────────────────────────────────────────────────

type Urgency = "critical" | "high" | "medium" | "low";
type Status = "critical" | "at_risk" | "stable" | "overstocked";
type RiskStatus = "danger" | "warning" | "sûr";

interface ScenarioProduct {
  productId: number; productName: string; recipeId?: number;
  daysTimeline: Array<{ date: string; openingStock: number; forecastDemand: number; plannedProduction: number; closingStock: number; shortage: number; overstock: number }>;
  totalShortage: number; totalOverstock: number; totalWasteRisk: number;
  extraProductionNeeded: number; extraPurchasingNeeded: number;
  status: Status; financialImpact: number;
}
interface SimResult {
  params: { demandMultiplier: number; daysAhead: number };
  generatedAt: string;
  products: ScenarioProduct[];
  summary: { totalShortageUnits: number; totalOverstockUnits: number; estimatedRevenueLoss: number; estimatedWasteCost: number; criticalCount: number; atRiskCount: number; stableCount: number; overstockedCount: number; recommendations: string[] };
}
interface ProductionPlanItem {
  recipeId: number; recipeName: string; productId: number; productName: string;
  date: string; requiredQty: number; estimatedCost: number;
  priority: "urgent" | "normal" | "optional";
  reason: string; ingredientAvailability: "ok" | "partial" | "blocked"; bottleneck?: string;
}
interface ProductionPlan {
  branchId: number; branchName: string; dateFrom: string; dateTo: string;
  items: ProductionPlanItem[];
  totalEstimatedCost: number;
  bottlenecks: Array<{ ingredient: string; shortage: number; affectedRecipes: string[] }>;
  workerloadByDay: Record<string, number>;
  efficiency: number;
}
interface TransferSuggestion {
  productId: number; productName: string;
  fromBranchId: number; fromBranchName: string;
  toBranchId: number; toBranchName: string;
  quantity: number; unit: string; urgency: Urgency;
  overstockAtSource: number; shortageAtDest: number; riskReductionScore: number;
}
interface StockDistPlan {
  generatedAt: string; transfers: TransferSuggestion[];
  totalTransfers: number; riskReductionPct: number; estimatedRevenueSaved: number;
  branches: Array<{ branchId: number; branchName: string; beforeScore: number; afterScore: number; status: string }>;
}
interface PurchaseLine {
  productId: number; productName: string; currentStock: number;
  forecastConsumption7d: number; forecastConsumption14d: number;
  suggestedQty: number; bulkQty: number; lastPrice: number;
  estimatedCost: number; urgency: Urgency; orderBy: string; reason: string;
}
interface PurchasePlan { generatedAt: string; lines: PurchaseLine[]; totalCost: number; urgentCost: number }
interface CostAlert {
  productId: number; productName: string; currentWac: number; previousWac: number;
  changePct: number; affectedRecipes: Array<{ recipeId: number; recipeName: string; costImpact: number }>;
  severity: "low" | "medium" | "high"; recommendation: string;
}
interface CostReport {
  generatedAt: string; totalSavingsPotential: number;
  alerts: CostAlert[];
  expensiveRecipes: Array<{ recipeId: number; recipeName: string; totalCost: number; costPerUnit: number; sellingPrice: number; margin: number; topIngredients: Array<{ name: string; costShare: number }>; recommendation: string }>;
  globalRecommendations: string[];
}
interface AiDecision {
  id: string; priority: number; type: "produce" | "purchase" | "transfer" | "reformulate" | "alert";
  title: string; description: string; estimatedImpact: string;
  financialImpact: number; urgency: Urgency; actionable: boolean; params?: Record<string, unknown>;
}
interface AiCenter {
  generatedAt: string;
  scenario14d: SimResult;
  productionPlan: ProductionPlan[];
  distributionPlan: StockDistPlan;
  purchasePlan: PurchasePlan;
  costReport: CostReport;
  decisions: AiDecision[];
  overallHealthScore: number;
  riskMatrix: Array<{ branchId: number; branchName: string; shortageRisk: number; overstockRisk: number; status: RiskStatus }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const API = "/api";
const authH = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` });
const DA = (n: number) => new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(n) + " DA";
const DA2 = (n: number) => new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 2 }).format(n) + " DA";
const F1 = (n: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(n);
const F3 = (n: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(n);

const statusCfg: Record<Status, { cls: string; label: string; icon: React.ElementType }> = {
  critical:    { cls: "text-red-700 bg-red-100 border-red-200",      label: "Critique",     icon: Flame },
  at_risk:     { cls: "text-orange-700 bg-orange-100 border-orange-200", label: "À risque",  icon: AlertTriangle },
  stable:      { cls: "text-green-700 bg-green-100 border-green-200",  label: "Stable",      icon: CheckCircle2 },
  overstocked: { cls: "text-blue-700 bg-blue-100 border-blue-200",     label: "Surstock",    icon: Layers },
};
const urgencyCfg: Record<Urgency, { cls: string; label: string }> = {
  critical: { cls: "bg-red-100 text-red-700",    label: "Critique" },
  high:     { cls: "bg-orange-100 text-orange-700", label: "Urgent" },
  medium:   { cls: "bg-amber-100 text-amber-700",  label: "Moyen" },
  low:      { cls: "bg-gray-100 text-gray-600",    label: "Bas" },
};
const decisionIcon: Record<AiDecision["type"], React.ElementType> = {
  produce:    Factory,
  purchase:   ShoppingCart,
  transfer:   ArrowLeftRight,
  reformulate: Wand2,
  alert:      AlertTriangle,
};
const decisionColor: Record<AiDecision["type"], string> = {
  produce:    "text-amber-600 bg-amber-50 border-amber-200",
  purchase:   "text-blue-700 bg-blue-50 border-blue-200",
  transfer:   "text-purple-700 bg-purple-50 border-purple-200",
  reformulate: "text-green-700 bg-green-50 border-green-200",
  alert:      "text-red-700 bg-red-50 border-red-200",
};
const priorityCls: Record<"urgent"|"normal"|"optional", string> = {
  urgent:   "bg-red-100 text-red-700",
  normal:   "bg-amber-100 text-amber-700",
  optional: "bg-gray-100 text-gray-600",
};
const riskStatusCfg: Record<RiskStatus, { bg: string; ring: string; label: string }> = {
  danger:  { bg: "bg-red-500",    ring: "ring-red-300",    label: "Danger" },
  warning: { bg: "bg-amber-500",  ring: "ring-amber-300",  label: "Alerte" },
  "sûr":   { bg: "bg-green-500",  ring: "ring-green-300",  label: "Sûr" },
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function HealthMeter({ score }: { score: number }) {
  const color = score >= 75 ? "text-green-600" : score >= 50 ? "text-amber-600" : "text-red-600";
  const barColor = score >= 75 ? "bg-green-500" : score >= 50 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-24 w-24">
        <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e5e7eb" strokeWidth="3" />
          <circle cx="18" cy="18" r="15.9" fill="none"
            stroke={score >= 75 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444"}
            strokeWidth="3"
            strokeDasharray={`${score} ${100 - score}`}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-xl font-bold ${color}`}>{score}</span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground text-center">Score de santé<br />global</p>
    </div>
  );
}

function RiskHeatmap({ matrix }: { matrix: AiCenter["riskMatrix"] }) {
  if (!matrix?.length) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {matrix.map(b => {
        const cfg = riskStatusCfg[b.status as RiskStatus] ?? riskStatusCfg["sûr"];
        return (
          <div key={b.branchId} className={`rounded-xl border-2 p-4 text-center relative overflow-hidden ring-2 ${cfg.ring} ring-offset-2`}>
            <div className={`absolute inset-0 opacity-10 ${cfg.bg}`} />
            <div className={`w-3 h-3 rounded-full ${cfg.bg} mx-auto mb-2`} />
            <p className="font-semibold text-sm truncate">{b.branchName}</p>
            <p className="text-xs text-muted-foreground mt-1">Rupture: {b.shortageRisk}% · Surstock: {b.overstockRisk}%</p>
            <span className={`inline-block mt-1.5 text-xs px-2 py-0.5 rounded-full font-semibold ${cfg.bg} text-white`}>{cfg.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function DecisionsPanel({ decisions }: { decisions: AiDecision[] }) {
  if (!decisions?.length) return (
    <div className="text-center py-12">
      <Sparkles className="h-10 w-10 text-green-400 mx-auto mb-3" />
      <p className="text-green-600 font-medium">Aucune décision prioritaire requise</p>
    </div>
  );
  return (
    <div className="space-y-3">
      {decisions.map(d => {
        const Icon = decisionIcon[d.type];
        const color = decisionColor[d.type];
        const ug = urgencyCfg[d.urgency];
        return (
          <div key={d.id} className={`rounded-xl border-2 p-4 ${color}`}>
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 shrink-0 h-8 w-8 rounded-lg flex items-center justify-center border-2 ${color}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <p className="font-bold text-sm">{d.title}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ug.cls}`}>{ug.label}</span>
                  {d.actionable && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">Actionnable</span>}
                </div>
                <p className="text-sm opacity-80 mb-1">{d.description}</p>
                <div className="flex items-center gap-1.5 text-xs opacity-70">
                  <Target className="h-3 w-3" />{d.estimatedImpact}
                </div>
                {d.financialImpact !== 0 && (
                  <p className={`text-xs mt-1 font-semibold ${d.financialImpact > 0 ? "text-green-700" : "text-red-700"}`}>
                    Impact financier: {d.financialImpact > 0 ? "+" : ""}{DA(Math.abs(d.financialImpact))}
                  </p>
                )}
              </div>
              <span className="text-xs font-mono opacity-50 shrink-0">#{d.priority}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SimulationPanel() {
  const [demandMult, setDemandMult] = useState(1.0);
  const [daysAhead, setDaysAhead] = useState(14);
  const [branchId, setBranchId] = useState<string>("all");
  const [capacityFactor, setCapacityFactor] = useState(1.0);
  const [enabled, setEnabled] = useState(false);
  const { data: branches = [] } = useGetBranches();

  const { data, isLoading, refetch } = useQuery<SimResult>({
    queryKey: ["sim-scenario", demandMult, daysAhead, branchId, capacityFactor],
    queryFn: async () => {
      const r = await fetch(`${API}/ai/simulate`, {
        method: "POST", headers: authH(),
        body: JSON.stringify({
          demandMultiplier: demandMult, daysAhead,
          branchId: branchId !== "all" ? parseInt(branchId) : null,
          productionCapacityFactor: capacityFactor,
        }),
      });
      if (!r.ok) throw new Error("Erreur simulation");
      return r.json();
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  function runSim() { if (!enabled) setEnabled(true); else refetch(); }

  const pct = (demandMult - 1) * 100;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-gradient-to-br from-violet-50 to-indigo-50 border-violet-200 p-5 space-y-5">
        <div className="flex items-center gap-2">
          <PlayCircle className="h-5 w-5 text-violet-600" />
          <p className="font-bold text-violet-800">Moteur de simulation What-If</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-semibold">Multiplicateur de demande</Label>
              <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${pct > 0 ? "bg-green-100 text-green-700" : pct < 0 ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}`}>
                {pct > 0 ? "+" : ""}{pct.toFixed(0)}%
              </span>
            </div>
            <Slider min={0.5} max={2.5} step={0.1} value={[demandMult]}
              onValueChange={([v]) => { setDemandMult(v); setEnabled(false); }}
              className="cursor-pointer" />
            <div className="flex justify-between text-xs text-muted-foreground mt-1"><span>−50%</span><span className="font-medium text-violet-600">Normal</span><span>+150%</span></div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-semibold">Capacité de production</Label>
              <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${capacityFactor < 1 ? "bg-red-100 text-red-700" : capacityFactor > 1 ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>{(capacityFactor * 100).toFixed(0)}%</span>
            </div>
            <Slider min={0.3} max={2.0} step={0.1} value={[capacityFactor]}
              onValueChange={([v]) => { setCapacityFactor(v); setEnabled(false); }}
              className="cursor-pointer" />
            <div className="flex justify-between text-xs text-muted-foreground mt-1"><span>30%</span><span className="font-medium text-violet-600">100%</span><span>200%</span></div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-sm font-semibold mb-1.5 block">Boutique</Label>
            <Select value={branchId} onValueChange={v => { setBranchId(v); setEnabled(false); }}>
              <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes les boutiques</SelectItem>
                {(branches as any[]).map((b: any) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm font-semibold mb-1.5 block">Horizon (jours)</Label>
            <Select value={String(daysAhead)} onValueChange={v => { setDaysAhead(parseInt(v)); setEnabled(false); }}>
              <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 jours</SelectItem>
                <SelectItem value="14">14 jours</SelectItem>
                <SelectItem value="30">30 jours</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button className="w-full gap-2 bg-violet-600 hover:bg-violet-700" onClick={runSim} disabled={isLoading}>
          {isLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
          {isLoading ? "Simulation en cours..." : "Lancer la simulation"}
        </Button>
      </div>

      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Ruptures critiques", value: data.summary.criticalCount, cls: "bg-red-50 border-red-200 text-red-700" },
              { label: "À risque", value: data.summary.atRiskCount, cls: "bg-orange-50 border-orange-200 text-orange-700" },
              { label: "Stables", value: data.summary.stableCount, cls: "bg-green-50 border-green-200 text-green-700" },
              { label: "Surstocks", value: data.summary.overstockedCount, cls: "bg-blue-50 border-blue-200 text-blue-700" },
            ].map((s, i) => (
              <div key={i} className={`rounded-lg border p-3 text-center ${s.cls}`}>
                <p className="text-2xl font-bold">{s.value}</p>
                <p className="text-xs mt-0.5 opacity-70">{s.label}</p>
              </div>
            ))}
          </div>

          {data.summary.estimatedRevenueLoss > 0 && (
            <Alert className="border-red-200 bg-red-50">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-800">
                <strong>Perte de revenus estimée: {DA(data.summary.estimatedRevenueLoss)}</strong>
                {" "}· Surstock/gaspillage: {DA(data.summary.estimatedWasteCost)}
              </AlertDescription>
            </Alert>
          )}

          {data.summary.recommendations.length > 0 && (
            <div className="space-y-1">
              {data.summary.recommendations.map((r, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
                  <Lightbulb className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />{r}
                </div>
              ))}
            </div>
          )}

          <div className="rounded-md border overflow-hidden">
            <div className="bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">Produits simulés ({data.products.length})</div>
            <Table>
              <TableHeader><TableRow className="bg-muted/20">
                <TableHead className="text-xs py-2">Produit</TableHead>
                <TableHead className="text-xs py-2 text-right">Rupture</TableHead>
                <TableHead className="text-xs py-2 text-right">Surstock</TableHead>
                <TableHead className="text-xs py-2 text-right">Prod. requise</TableHead>
                <TableHead className="text-xs py-2 text-right">Impact (DA)</TableHead>
                <TableHead className="text-xs py-2 text-center">Statut</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {data.products.slice(0, 15).map((p, i) => {
                  const cfg = statusCfg[p.status];
                  const Icon = cfg.icon;
                  return (
                    <TableRow key={i} className={p.status === "critical" ? "bg-red-50/30" : p.status === "at_risk" ? "bg-orange-50/20" : ""}>
                      <TableCell className="py-2 font-medium text-sm">{p.productName}</TableCell>
                      <TableCell className="py-2 text-right font-mono text-sm">{p.totalShortage > 0 ? <span className="text-red-600 font-semibold">{F1(p.totalShortage)}</span> : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="py-2 text-right font-mono text-sm">{p.totalOverstock > 0 ? <span className="text-blue-600">{F1(p.totalOverstock)}</span> : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="py-2 text-right font-mono text-sm">{p.extraProductionNeeded > 0 ? F1(p.extraProductionNeeded) : "—"}</TableCell>
                      <TableCell className="py-2 text-right text-sm">{Math.abs(p.financialImpact) > 0 ? <span className={p.financialImpact > 0 ? "text-red-600" : "text-green-600"}>{DA(Math.abs(p.financialImpact))}</span> : "—"}</TableCell>
                      <TableCell className="py-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Icon className={`h-3.5 w-3.5 ${cfg.cls.split(" ")[0]}`} />
                          <span className={`text-xs px-1.5 py-0.5 rounded-full border font-medium ${cfg.cls}`}>{cfg.label}</span>
                        </div>
                      </TableCell>
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

function ProductionPlanPanel({ plans }: { plans: ProductionPlan[] | undefined }) {
  if (!plans?.length) return <div className="text-center py-12 text-muted-foreground">Aucun plan de production généré.</div>;
  const allItems = plans.flatMap(p => p.items.filter(i => i.priority === "urgent" || i.priority === "normal"));
  const totalCost = plans.reduce((s, p) => s + p.totalEstimatedCost, 0);
  const allBottlenecks = plans.flatMap(p => p.bottlenecks);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border bg-amber-50 border-amber-200 p-3 text-center">
          <p className="text-xl font-bold text-amber-700">{allItems.filter(i => i.priority === "urgent").length}</p>
          <p className="text-xs text-muted-foreground">Ordres urgents</p>
        </div>
        <div className="rounded-lg border bg-blue-50 border-blue-200 p-3 text-center">
          <p className="text-xl font-bold text-blue-700">{DA(totalCost)}</p>
          <p className="text-xs text-muted-foreground">Coût total estimé</p>
        </div>
        <div className="rounded-lg border bg-green-50 border-green-200 p-3 text-center">
          <p className="text-xl font-bold text-green-700">{plans[0]?.efficiency ?? 0}%</p>
          <p className="text-xs text-muted-foreground">Efficacité</p>
        </div>
      </div>

      {allBottlenecks.length > 0 && (
        <Alert className="border-red-200 bg-red-50">
          <AlertTriangle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-800">
            <strong>Goulots d'étranglement:</strong>{" "}
            {allBottlenecks.slice(0, 3).map(b => `${b.ingredient} (manque: ${F1(b.shortage)})`).join(" · ")}
          </AlertDescription>
        </Alert>
      )}

      <Table>
        <TableHeader><TableRow className="bg-muted/30">
          <TableHead className="text-xs py-2">Recette</TableHead>
          <TableHead className="text-xs py-2">Boutique</TableHead>
          <TableHead className="text-xs py-2">Date</TableHead>
          <TableHead className="text-xs py-2 text-right">Qté</TableHead>
          <TableHead className="text-xs py-2 text-right">Coût</TableHead>
          <TableHead className="text-xs py-2 text-center">Priorité</TableHead>
          <TableHead className="text-xs py-2 text-center">Ingrédients</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {allItems.slice(0, 20).map((item, i) => {
            const plan = plans.find(p => p.items.includes(item));
            const availCfg = { ok: { cls: "text-green-600", icon: CheckCircle2 }, partial: { cls: "text-amber-600", icon: AlertTriangle }, blocked: { cls: "text-red-600", icon: AlertTriangle } };
            const av = availCfg[item.ingredientAvailability];
            return (
              <TableRow key={i} className={item.priority === "urgent" ? "bg-red-50/20" : ""}>
                <TableCell className="py-2 font-medium text-sm">{item.recipeName}</TableCell>
                <TableCell className="py-2 text-sm text-muted-foreground">{plan?.branchName}</TableCell>
                <TableCell className="py-2 text-sm">{format(new Date(item.date), "EEE dd/MM", { locale: fr })}</TableCell>
                <TableCell className="py-2 text-right font-mono text-sm">{F1(item.requiredQty)}</TableCell>
                <TableCell className="py-2 text-right text-sm font-medium">{DA(item.estimatedCost)}</TableCell>
                <TableCell className="py-2 text-center"><span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${priorityCls[item.priority]}`}>{item.priority === "urgent" ? "🔴 Urgent" : item.priority === "normal" ? "🟡 Normal" : "⚪ Optionnel"}</span></TableCell>
                <TableCell className="py-2 text-center">
                  <div className={`flex items-center justify-center gap-1 ${av.cls}`}>
                    <av.icon className="h-3.5 w-3.5" />
                    <span className="text-xs">{item.ingredientAvailability === "blocked" ? (item.bottleneck ?? "Bloqué") : item.ingredientAvailability === "partial" ? "Partiel" : "OK"}</span>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function TransfersPanel({ plan }: { plan: StockDistPlan | undefined }) {
  if (!plan) return null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border bg-purple-50 border-purple-200 p-3 text-center">
          <p className="text-xl font-bold text-purple-700">{plan.totalTransfers}</p>
          <p className="text-xs text-muted-foreground">Transferts suggérés</p>
        </div>
        <div className="rounded-lg border bg-green-50 border-green-200 p-3 text-center">
          <p className="text-xl font-bold text-green-700">+{F1(plan.riskReductionPct)}%</p>
          <p className="text-xs text-muted-foreground">Réduction de risque</p>
        </div>
        <div className="rounded-lg border bg-blue-50 border-blue-200 p-3 text-center">
          <p className="text-xl font-bold text-blue-700">{DA(plan.estimatedRevenueSaved)}</p>
          <p className="text-xs text-muted-foreground">Revenu sauvegardé</p>
        </div>
      </div>

      <div className="rounded-lg border p-3 bg-muted/20">
        <p className="text-xs font-semibold text-muted-foreground mb-2">Score par boutique (avant → après transferts)</p>
        <div className="space-y-2">
          {plan.branches.map(b => (
            <div key={b.branchId} className="flex items-center gap-3">
              <span className="text-sm w-28 truncate">{b.branchName}</span>
              <div className="flex-1 flex items-center gap-2">
                <span className={`text-xs font-mono ${b.beforeScore < 60 ? "text-red-600" : "text-muted-foreground"}`}>{b.beforeScore}</span>
                <Progress value={b.beforeScore} className="h-1.5 flex-1" />
                <ArrowUpRight className="h-3 w-3 text-green-500 shrink-0" />
                <span className="text-xs font-mono text-green-600">{b.afterScore}</span>
              </div>
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${b.status === "sûr" ? "bg-green-100 text-green-700" : b.status === "acceptable" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>{b.status}</span>
            </div>
          ))}
        </div>
      </div>

      {plan.transfers.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">Aucun transfert nécessaire — stocks bien équilibrés</div>
      ) : (
        <Table>
          <TableHeader><TableRow className="bg-muted/30">
            <TableHead className="text-xs py-2">Produit</TableHead>
            <TableHead className="text-xs py-2">De</TableHead>
            <TableHead className="text-xs py-2">Vers</TableHead>
            <TableHead className="text-xs py-2 text-right">Qté</TableHead>
            <TableHead className="text-xs py-2 text-right">Surplus src.</TableHead>
            <TableHead className="text-xs py-2 text-right">Manque dest.</TableHead>
            <TableHead className="text-xs py-2 text-center">Urgence</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {plan.transfers.map((t, i) => {
              const ug = urgencyCfg[t.urgency];
              return (
                <TableRow key={i} className={t.urgency === "critical" ? "bg-red-50/30" : ""}>
                  <TableCell className="py-2 font-medium text-sm">{t.productName}</TableCell>
                  <TableCell className="py-2 text-sm text-muted-foreground">{t.fromBranchName}</TableCell>
                  <TableCell className="py-2 text-sm text-muted-foreground">{t.toBranchName}</TableCell>
                  <TableCell className="py-2 text-right font-mono font-bold text-sm">{F3(t.quantity)}</TableCell>
                  <TableCell className="py-2 text-right font-mono text-sm text-blue-600">{F1(t.overstockAtSource)}</TableCell>
                  <TableCell className="py-2 text-right font-mono text-sm text-red-600">−{F1(t.shortageAtDest)}</TableCell>
                  <TableCell className="py-2 text-center"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ug.cls}`}>{ug.label}</span></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function PurchasesPanel({ plan }: { plan: PurchasePlan | undefined }) {
  if (!plan) return null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border bg-amber-50 border-amber-200 p-3 text-center">
          <p className="text-2xl font-bold text-amber-700">{DA(plan.totalCost)}</p>
          <p className="text-xs text-muted-foreground">{plan.lines.length} articles · Total estimé</p>
        </div>
        <div className="rounded-lg border bg-red-50 border-red-200 p-3 text-center">
          <p className="text-2xl font-bold text-red-700">{DA(plan.urgentCost)}</p>
          <p className="text-xs text-muted-foreground">Achats urgents · À commander maintenant</p>
        </div>
      </div>
      <Table>
        <TableHeader><TableRow className="bg-muted/30">
          <TableHead className="text-xs py-2">Matière</TableHead>
          <TableHead className="text-xs py-2 text-right">Stock</TableHead>
          <TableHead className="text-xs py-2 text-right">Conso. 7j</TableHead>
          <TableHead className="text-xs py-2 text-right">Qté optim.</TableHead>
          <TableHead className="text-xs py-2 text-right">Coût</TableHead>
          <TableHead className="text-xs py-2 text-center">Commander avant</TableHead>
          <TableHead className="text-xs py-2 text-center">Urgence</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {plan.lines.map((l, i) => {
            const ug = urgencyCfg[l.urgency];
            return (
              <TableRow key={i} className={l.urgency === "critical" ? "bg-red-50/30" : ""}>
                <TableCell className="py-2 font-medium text-sm">{l.productName}</TableCell>
                <TableCell className="py-2 text-right font-mono text-sm">{F1(l.currentStock)}</TableCell>
                <TableCell className="py-2 text-right font-mono text-sm">{F1(l.forecastConsumption7d)}</TableCell>
                <TableCell className="py-2 text-right font-mono text-sm font-bold">{F3(l.bulkQty)}</TableCell>
                <TableCell className="py-2 text-right font-semibold text-sm text-amber-700">{DA(l.estimatedCost)}</TableCell>
                <TableCell className="py-2 text-center text-sm">{format(new Date(l.orderBy), "dd/MM", { locale: fr })}</TableCell>
                <TableCell className="py-2 text-center"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ug.cls}`}>{ug.label}</span></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function CostOptimPanel({ report }: { report: CostReport | undefined }) {
  if (!report) return null;
  return (
    <div className="space-y-4">
      {report.totalSavingsPotential > 0 && (
        <div className="rounded-xl border-2 border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 p-4 flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-green-100 flex items-center justify-center shrink-0">
            <DollarSign className="h-6 w-6 text-green-600" />
          </div>
          <div>
            <p className="font-bold text-green-800 text-lg">{DA(report.totalSavingsPotential)}</p>
            <p className="text-sm text-green-700">Économies potentielles identifiées</p>
          </div>
        </div>
      )}

      {report.globalRecommendations.length > 0 && (
        <div className="space-y-1.5">
          {report.globalRecommendations.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-sm bg-blue-50 border border-blue-100 rounded-md px-3 py-2 text-blue-800">
              <Lightbulb className="h-3.5 w-3.5 text-blue-500 shrink-0" />{r}
            </div>
          ))}
        </div>
      )}

      {report.alerts.length > 0 && (
        <div>
          <p className="text-sm font-semibold mb-2 flex items-center gap-1.5"><TrendingUp className="h-4 w-4 text-orange-500" />Fluctuations de prix</p>
          <div className="space-y-2">
            {report.alerts.map((a, i) => (
              <div key={i} className={`rounded-lg border p-3 ${a.severity === "high" ? "bg-red-50 border-red-200" : a.severity === "medium" ? "bg-amber-50 border-amber-200" : "bg-gray-50 border-gray-200"}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm">{a.productName}</span>
                  <span className={`text-sm font-bold ${a.changePct > 0 ? "text-red-600" : "text-green-600"}`}>
                    {a.changePct > 0 ? <ArrowUpRight className="inline h-4 w-4" /> : <ArrowDownRight className="inline h-4 w-4" />}
                    {a.changePct > 0 ? "+" : ""}{a.changePct.toFixed(1)}%
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mb-1">{DA2(a.currentWac)} (était {DA2(a.previousWac)})</p>
                {a.affectedRecipes.length > 0 && <p className="text-xs text-muted-foreground">Recettes impactées: {a.affectedRecipes.map(r => r.recipeName).join(", ")}</p>}
                <p className="text-xs mt-1.5 italic opacity-70">{a.recommendation}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {report.expensiveRecipes.length > 0 && (
        <div>
          <p className="text-sm font-semibold mb-2 flex items-center gap-1.5"><BarChart3 className="h-4 w-4 text-red-500" />Recettes à marge critique</p>
          <div className="space-y-2">
            {report.expensiveRecipes.map((r, i) => (
              <div key={i} className={`rounded-lg border p-3 ${r.margin < 10 ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm">{r.recipeName}</span>
                  <span className={`text-sm font-bold ${r.margin < 10 ? "text-red-600" : "text-amber-600"}`}>{r.margin.toFixed(1)}% marge</span>
                </div>
                <div className="flex gap-4 text-xs text-muted-foreground mb-1">
                  <span>Coût: {DA2(r.costPerUnit)}/u.</span>
                  <span>Vente: {DA2(r.sellingPrice)}</span>
                </div>
                <div className="flex gap-1 flex-wrap mb-1.5">
                  {r.topIngredients.map((ing, j) => (
                    <span key={j} className="text-xs bg-white border rounded px-1.5 py-0.5">{ing.name} ({ing.costShare}%)</span>
                  ))}
                </div>
                <p className="text-xs italic opacity-70">{r.recommendation}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AiControlPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("decisions");
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, error, refetch } = useQuery<AiCenter>({
    queryKey: ["ai-control-center"],
    queryFn: async () => {
      const r = await fetch(`${API}/ai/control-center`, { headers: authH() });
      if (!r.ok) throw new Error("Erreur AI Control Center");
      return r.json();
    },
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await Promise.all([
        fetch(`${API}/ai/invalidate-cache`, { method: "POST", headers: authH() }),
        fetch(`${API}/dashboard/intelligence/invalidate-cache`, { method: "POST", headers: authH() }),
      ]);
      await refetch();
    } finally { setRefreshing(false); }
  }

  const criticalDecisions = data?.decisions.filter(d => d.urgency === "critical").length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 flex items-center justify-center shadow-lg">
            <Cpu className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-serif font-bold flex items-center gap-2">
              AI Control Center
              <span className="text-xs font-sans font-normal text-white bg-gradient-to-r from-indigo-500 to-purple-600 px-2 py-0.5 rounded-full">Pro</span>
            </h1>
            <p className="text-sm text-muted-foreground">
              {data?.generatedAt ? `Analyse: ${format(new Date(data.generatedAt), "HH:mm", { locale: fr })}` : "Simulation · Optimisation · Décisions IA"}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={handleRefresh} disabled={isLoading || refreshing}>
          <RefreshCw className={`h-4 w-4 ${isLoading || refreshing ? "animate-spin" : ""}`} />
          Recalculer
        </Button>
      </div>

      {isLoading && (
        <div className="flex flex-col items-center justify-center gap-4 py-24">
          <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center animate-pulse">
            <Bot className="h-8 w-8 text-white" />
          </div>
          <div className="text-center">
            <p className="font-semibold text-lg">Moteurs IA en cours d'analyse...</p>
            <p className="text-muted-foreground text-sm mt-1">Simulation · Optimisation · Prévisions · Coûts</p>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-red-400 mx-auto mb-2" />
          <p className="text-red-700 font-medium">Impossible de charger le Control Center</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => refetch()}>Réessayer</Button>
        </div>
      )}

      {data && !isLoading && (
        <>
          {/* KPI Row */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="md:col-span-1 flex justify-center items-center bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl border border-indigo-200 p-4">
              <HealthMeter score={data.overallHealthScore} />
            </div>
            {[
              { label: "Décisions IA", value: data.decisions.length, sub: `${criticalDecisions} critiques`, cls: criticalDecisions > 0 ? "bg-red-50 border-red-200 text-red-700" : "bg-indigo-50 border-indigo-200 text-indigo-700", icon: Bot },
              { label: "Transferts suggérés", value: data.distributionPlan.totalTransfers, sub: `+${F1(data.distributionPlan.riskReductionPct)}% risque réduit`, cls: "bg-purple-50 border-purple-200 text-purple-700", icon: ArrowLeftRight },
              { label: "Achat total optimisé", value: DA(data.purchasePlan.totalCost), sub: `${data.purchasePlan.lines.length} articles`, cls: "bg-amber-50 border-amber-200 text-amber-700", icon: ShoppingCart },
              { label: "Économies potentielles", value: DA(data.costReport.totalSavingsPotential), sub: `${data.costReport.expensiveRecipes.length} recettes à optimiser`, cls: "bg-green-50 border-green-200 text-green-700", icon: DollarSign },
            ].map((kpi, i) => (
              <Card key={i} className={`border-2 ${kpi.cls}`}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <kpi.icon className="h-4 w-4" />
                    <p className="text-xs font-medium opacity-70">{kpi.label}</p>
                  </div>
                  <p className="font-bold text-xl leading-none">{kpi.value}</p>
                  <p className="text-xs mt-1 opacity-60">{kpi.sub}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Risk heatmap */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <MapPin className="h-4 w-4 text-rose-500" />Carte des risques par boutique
              </CardTitle>
            </CardHeader>
            <CardContent><RiskHeatmap matrix={data.riskMatrix} /></CardContent>
          </Card>

          {/* Main tabs */}
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full flex flex-wrap h-auto gap-1 p-1">
              <TabsTrigger value="decisions" className="text-xs gap-1.5">
                <Sparkles className="h-3.5 w-3.5" />Décisions IA
                {criticalDecisions > 0 && <Badge variant="destructive" className="text-xs ml-0.5">{criticalDecisions}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="simulation" className="text-xs gap-1.5">
                <PlayCircle className="h-3.5 w-3.5" />Simulation What-If
              </TabsTrigger>
              <TabsTrigger value="production" className="text-xs gap-1.5">
                <Factory className="h-3.5 w-3.5" />Plan de production
              </TabsTrigger>
              <TabsTrigger value="transfers" className="text-xs gap-1.5">
                <ArrowLeftRight className="h-3.5 w-3.5" />Distribution stock
                {data.distributionPlan.totalTransfers > 0 && <Badge variant="secondary" className="text-xs ml-0.5">{data.distributionPlan.totalTransfers}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="purchases" className="text-xs gap-1.5">
                <ShoppingCart className="h-3.5 w-3.5" />Achats optimisés
                {data.purchasePlan.lines.length > 0 && <Badge variant="secondary" className="text-xs ml-0.5">{data.purchasePlan.lines.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="costs" className="text-xs gap-1.5">
                <DollarSign className="h-3.5 w-3.5" />Optimisation coûts
                {data.costReport.totalSavingsPotential > 0 && <Badge variant="secondary" className="text-xs ml-0.5">{data.costReport.expensiveRecipes.length}</Badge>}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="decisions" className="mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Bot className="h-4 w-4 text-indigo-500" />Recommandations IA prioritaires
                    <span className="text-sm font-normal text-muted-foreground ml-1">Aucune action automatique — confirmation requise</span>
                  </CardTitle>
                </CardHeader>
                <CardContent><DecisionsPanel decisions={data.decisions} /></CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="simulation" className="mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <PlayCircle className="h-4 w-4 text-violet-500" />Simulateur de scénarios
                  </CardTitle>
                </CardHeader>
                <CardContent><SimulationPanel /></CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="production" className="mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Factory className="h-4 w-4 text-amber-500" />Plan de production optimisé (7 jours)
                  </CardTitle>
                </CardHeader>
                <CardContent><ProductionPlanPanel plans={data.productionPlan} /></CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="transfers" className="mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <ArrowLeftRight className="h-4 w-4 text-purple-500" />Redistribution intelligente du stock
                  </CardTitle>
                </CardHeader>
                <CardContent><TransfersPanel plan={data.distributionPlan} /></CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="purchases" className="mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <ShoppingCart className="h-4 w-4 text-amber-500" />Plan d'achat optimisé (quantités en vrac)
                  </CardTitle>
                </CardHeader>
                <CardContent><PurchasesPanel plan={data.purchasePlan} /></CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="costs" className="mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-green-500" />Optimisation de la structure des coûts
                  </CardTitle>
                </CardHeader>
                <CardContent><CostOptimPanel report={data.costReport} /></CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
