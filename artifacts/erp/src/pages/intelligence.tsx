import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useGetBranches } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  Brain, RefreshCw, TrendingUp, TrendingDown, Minus, AlertTriangle,
  ShoppingCart, Package, BarChart3, Activity, Zap, Shield, Eye,
  ArrowUpRight, ArrowDownRight, Flame, CircleAlert, Info, CheckCircle2,
  ChevronRight, MapPin, Target, Lightbulb,
} from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

// ─── Types ──────────────────────────────────────────────────────────────────

type RiskLevel = "critical" | "high" | "medium" | "safe";
type AlertType = "STOCK_OUT_IMMINENT" | "OVERPRODUCTION_RISK" | "PURCHASE_REQUIRED" | "UNUSUAL_CONSUMPTION_SPIKE" | "HIGH_WASTE";
type Severity = "high" | "medium" | "low";
type Trend = "up" | "down" | "stable";
type Urgency = "critical" | "high" | "medium" | "low";

interface DemandForecast {
  productId: number; productName: string; branchId: number | null;
  avgDailyDemand: number; weeklyDemand: number; confidenceScore: number;
  trend: Trend; trendPct: number; dataPoints: number; fallback: boolean;
}
interface StockRisk {
  productId: number; productName: string; branchId: number; branchName: string;
  currentStock: number; avgDailyDemand: number; coverageDays: number;
  riskLevel: RiskLevel; reorderQty: number; depletionDate: string | null;
  safetyStock: number; reorderPoint: number;
}
interface PurchaseSuggestion {
  productId: number; productName: string; category: string;
  currentStock: number; requiredQty: number; suggestedQty: number;
  urgency: Urgency; estimatedCost: number; lastPurchasePrice: number;
  unit: string; reason: string;
}
interface ConsumptionTop {
  productId: number; productName: string; totalQty: number; avgDaily: number;
  trend: Trend; trendPct: number; revenueContribution: number;
}
interface WasteAlert {
  productId: number; productName: string; recipeId: number; recipeName: string;
  wastePercentage: number; producedQty: number; soldQty: number; unsoldQty: number;
  severity: Severity; potentialLoss: number;
}
interface IntelligenceAlert {
  id: string; type: AlertType; severity: Severity;
  title: string; message: string;
  productId?: number; productName?: string; branchId?: number; branchName?: string;
  recommendedAction: string; data?: Record<string, unknown>;
}
interface BranchSummary {
  branchId: number; branchName: string; riskCount: number;
  suggestionsCount: number; estimatedPurchaseCost: number;
}
interface IntelligenceDashboard {
  generatedAt: string;
  predictedSalesToday: number; predictedSalesWeek: number;
  alerts: IntelligenceAlert[];
  stockRisks: StockRisk[];
  purchaseSuggestions: PurchaseSuggestion[];
  wasteAlerts: WasteAlert[];
  topForecasts: DemandForecast[];
  branchSummaries: BranchSummary[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const API = "/api";
const authHeaders = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` });
function formatDA(n: number) { return new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(n) + " DA"; }
function fmt1(n: number) { return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(n); }
function fmt3(n: number) { return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(n); }

const riskCfg: Record<RiskLevel, { cls: string; dot: string; label: string; icon: React.ElementType }> = {
  critical: { cls: "bg-red-100 text-red-800 border-red-200", dot: "bg-red-500", label: "Critique", icon: Flame },
  high:     { cls: "bg-orange-100 text-orange-800 border-orange-200", dot: "bg-orange-500", label: "Élevé", icon: AlertTriangle },
  medium:   { cls: "bg-amber-100 text-amber-800 border-amber-200", dot: "bg-amber-500", label: "Moyen", icon: CircleAlert },
  safe:     { cls: "bg-green-100 text-green-700 border-green-200", dot: "bg-green-500", label: "Sûr", icon: CheckCircle2 },
};
const severityCfg: Record<Severity, { cls: string; label: string; icon: React.ElementType }> = {
  high:   { cls: "border-red-200 bg-red-50 text-red-800", label: "Critique", icon: Flame },
  medium: { cls: "border-amber-200 bg-amber-50 text-amber-800", label: "Important", icon: AlertTriangle },
  low:    { cls: "border-blue-200 bg-blue-50 text-blue-800", label: "Info", icon: Info },
};
const urgencyCfg: Record<Urgency, { cls: string; label: string }> = {
  critical: { cls: "bg-red-100 text-red-700", label: "Critique" },
  high:     { cls: "bg-orange-100 text-orange-700", label: "Urgent" },
  medium:   { cls: "bg-amber-100 text-amber-700", label: "Moyen" },
  low:      { cls: "bg-gray-100 text-gray-700", label: "Bas" },
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function TrendIcon({ trend, pct }: { trend: Trend; pct: number }) {
  if (trend === "up") return <span className="flex items-center gap-0.5 text-green-600 text-xs font-medium"><ArrowUpRight className="h-3.5 w-3.5" />+{pct.toFixed(0)}%</span>;
  if (trend === "down") return <span className="flex items-center gap-0.5 text-red-500 text-xs font-medium"><ArrowDownRight className="h-3.5 w-3.5" />−{Math.abs(pct).toFixed(0)}%</span>;
  return <span className="flex items-center gap-0.5 text-gray-400 text-xs"><Minus className="h-3 w-3" />stable</span>;
}

function ConfidenceBadge({ score }: { score: number }) {
  const cls = score >= 70 ? "bg-green-100 text-green-700" : score >= 40 ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600";
  return <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${cls}`}>{score}%</span>;
}

function AlertsPanel({ alerts }: { alerts: IntelligenceAlert[] }) {
  if (alerts.length === 0) return (
    <div className="text-center py-12">
      <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-3" />
      <p className="text-green-600 font-medium">Aucune alerte active</p>
    </div>
  );
  return (
    <div className="space-y-2.5">
      {alerts.map(alert => {
        const cfg = severityCfg[alert.severity];
        const Icon = cfg.icon;
        return (
          <div key={alert.id} className={`rounded-lg border p-4 ${cfg.cls}`}>
            <div className="flex items-start gap-3">
              <Icon className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-semibold text-sm">{alert.title}</p>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full border font-medium ${cfg.cls}`}>{cfg.label}</span>
                </div>
                <p className="text-sm opacity-80 mb-1">{alert.message}</p>
                <div className="flex items-center gap-1.5 text-xs opacity-70">
                  <ChevronRight className="h-3 w-3" />
                  <span>{alert.recommendedAction}</span>
                </div>
                {alert.branchName && (
                  <p className="text-xs opacity-60 mt-1 flex items-center gap-1"><MapPin className="h-3 w-3" />{alert.branchName}</p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ForecastsPanel({ forecasts }: { forecasts: DemandForecast[] }) {
  const valid = forecasts.filter(f => !f.fallback && f.avgDailyDemand > 0);
  if (valid.length === 0) return <div className="text-center py-12 text-muted-foreground text-sm">Données insuffisantes pour générer des prévisions.</div>;
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/30">
          <TableHead className="text-xs py-2">Produit</TableHead>
          <TableHead className="text-xs py-2 text-right">Moy. jour</TableHead>
          <TableHead className="text-xs py-2 text-right">Prév. sem.</TableHead>
          <TableHead className="text-xs py-2 text-center">Tendance</TableHead>
          <TableHead className="text-xs py-2 text-center">Confiance</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {valid.map(f => (
          <TableRow key={f.productId}>
            <TableCell className="py-2 font-medium text-sm">{f.productName}</TableCell>
            <TableCell className="py-2 text-right font-mono text-sm">{fmt1(f.avgDailyDemand)}</TableCell>
            <TableCell className="py-2 text-right font-mono text-sm font-semibold">{fmt1(f.weeklyDemand)}</TableCell>
            <TableCell className="py-2 text-center"><TrendIcon trend={f.trend} pct={f.trendPct} /></TableCell>
            <TableCell className="py-2 text-center"><ConfidenceBadge score={f.confidenceScore} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function RisksPanel({ risks }: { risks: StockRisk[] }) {
  if (risks.length === 0) return (
    <div className="text-center py-12">
      <CheckCircle2 className="h-10 w-10 text-green-400 mx-auto mb-3" />
      <p className="text-green-600 font-medium">Tous les stocks sont sûrs</p>
    </div>
  );
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/30">
          <TableHead className="text-xs py-2">Produit</TableHead>
          <TableHead className="text-xs py-2">Boutique</TableHead>
          <TableHead className="text-xs py-2 text-right">Stock</TableHead>
          <TableHead className="text-xs py-2 text-right">Couverture</TableHead>
          <TableHead className="text-xs py-2 text-right">Épuisement</TableHead>
          <TableHead className="text-xs py-2 text-center">Risque</TableHead>
          <TableHead className="text-xs py-2 text-right">Commander</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {risks.map((r, i) => {
          const cfg = riskCfg[r.riskLevel];
          const RiskIcon = cfg.icon;
          return (
            <TableRow key={i} className={r.riskLevel === "critical" ? "bg-red-50/40" : r.riskLevel === "high" ? "bg-orange-50/30" : ""}>
              <TableCell className="py-2 font-medium text-sm">{r.productName}</TableCell>
              <TableCell className="py-2 text-sm text-muted-foreground">{r.branchName}</TableCell>
              <TableCell className="py-2 text-right font-mono text-sm">{fmt1(r.currentStock)}</TableCell>
              <TableCell className="py-2 text-right">
                <span className={`font-semibold text-sm ${r.riskLevel === "critical" ? "text-red-600" : r.riskLevel === "high" ? "text-orange-600" : "text-amber-600"}`}>
                  {fmt1(r.coverageDays)}j
                </span>
              </TableCell>
              <TableCell className="py-2 text-right text-sm text-muted-foreground">
                {r.depletionDate ? format(new Date(r.depletionDate), "dd/MM", { locale: fr }) : "—"}
              </TableCell>
              <TableCell className="py-2 text-center">
                <div className="flex items-center justify-center gap-1">
                  <RiskIcon className={`h-3.5 w-3.5 ${r.riskLevel === "critical" ? "text-red-600" : r.riskLevel === "high" ? "text-orange-600" : "text-amber-600"}`} />
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full border ${cfg.cls}`}>{cfg.label}</span>
                </div>
              </TableCell>
              <TableCell className="py-2 text-right font-mono text-sm font-semibold">
                {r.reorderQty > 0 ? fmt3(r.reorderQty) : "—"}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function PurchasesPanel({ suggestions }: { suggestions: PurchaseSuggestion[] }) {
  const totalCost = suggestions.reduce((s, sg) => s + sg.estimatedCost, 0);
  if (suggestions.length === 0) return (
    <div className="text-center py-12 text-muted-foreground text-sm">Aucune suggestion d'achat pour le moment.</div>
  );
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-lg bg-amber-50 border border-amber-200 px-4 py-2">
        <span className="text-sm font-medium text-amber-800">{suggestions.length} matière{suggestions.length !== 1 ? "s" : ""} à commander</span>
        <span className="font-bold text-amber-700">Total estimé: {formatDA(totalCost)}</span>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30">
            <TableHead className="text-xs py-2">Matière</TableHead>
            <TableHead className="text-xs py-2 text-right">Stock actuel</TableHead>
            <TableHead className="text-xs py-2 text-right">Qté suggérée</TableHead>
            <TableHead className="text-xs py-2 text-right">Coût estimé</TableHead>
            <TableHead className="text-xs py-2 text-center">Urgence</TableHead>
            <TableHead className="text-xs py-2">Raison</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {suggestions.map((sg, i) => {
            const ug = urgencyCfg[sg.urgency];
            return (
              <TableRow key={i} className={sg.urgency === "critical" ? "bg-red-50/30" : ""}>
                <TableCell className="py-2 font-medium text-sm">{sg.productName}</TableCell>
                <TableCell className="py-2 text-right font-mono text-sm">{fmt1(sg.currentStock)}</TableCell>
                <TableCell className="py-2 text-right font-mono text-sm font-bold">{fmt3(sg.suggestedQty)}</TableCell>
                <TableCell className="py-2 text-right font-semibold text-sm text-amber-700">{formatDA(sg.estimatedCost)}</TableCell>
                <TableCell className="py-2 text-center">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ug.cls}`}>{ug.label}</span>
                </TableCell>
                <TableCell className="py-2 text-xs text-muted-foreground max-w-[200px] truncate">{sg.reason}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function WastePanel({ alerts }: { alerts: WasteAlert[] }) {
  if (alerts.length === 0) return (
    <div className="text-center py-12">
      <CheckCircle2 className="h-10 w-10 text-green-400 mx-auto mb-3" />
      <p className="text-green-600 font-medium">Aucun gaspillage détecté</p>
    </div>
  );
  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30">
            <TableHead className="text-xs py-2">Produit</TableHead>
            <TableHead className="text-xs py-2">Recette</TableHead>
            <TableHead className="text-xs py-2 text-right">Produit</TableHead>
            <TableHead className="text-xs py-2 text-right">Vendu</TableHead>
            <TableHead className="text-xs py-2 text-right">Invendu</TableHead>
            <TableHead className="text-xs py-2 text-right">Gaspillage</TableHead>
            <TableHead className="text-xs py-2 text-right">Perte estimée</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {alerts.map((a, i) => (
            <TableRow key={i} className={a.severity === "high" ? "bg-red-50/30" : a.severity === "medium" ? "bg-amber-50/30" : ""}>
              <TableCell className="py-2 font-medium text-sm">{a.productName}</TableCell>
              <TableCell className="py-2 text-sm text-muted-foreground">{a.recipeName}</TableCell>
              <TableCell className="py-2 text-right font-mono text-sm">{fmt1(a.producedQty)}</TableCell>
              <TableCell className="py-2 text-right font-mono text-sm text-green-600">{fmt1(a.soldQty)}</TableCell>
              <TableCell className="py-2 text-right font-mono text-sm text-red-600">{fmt1(a.unsoldQty)}</TableCell>
              <TableCell className="py-2 text-right">
                <div className="flex items-center justify-end gap-1">
                  <Progress value={a.wastePercentage} className="h-1.5 w-16" />
                  <span className={`text-sm font-bold ${a.severity === "high" ? "text-red-600" : a.severity === "medium" ? "text-amber-600" : "text-gray-600"}`}>{a.wastePercentage.toFixed(1)}%</span>
                </div>
              </TableCell>
              <TableCell className="py-2 text-right font-semibold text-sm text-red-600">−{formatDA(a.potentialLoss)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function IntelligencePage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("overview");
  const [refreshing, setRefreshing] = useState(false);

  const { data: branches = [] } = useGetBranches();

  const { data, isLoading, error, refetch } = useQuery<IntelligenceDashboard>({
    queryKey: ["intelligence-dashboard"],
    queryFn: async () => {
      const r = await fetch(`${API}/dashboard/intelligence`, { headers: authHeaders() });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error((body as any).error ?? `Erreur ${r.status}`);
      }
      return r.json();
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await fetch(`${API}/dashboard/intelligence/invalidate-cache`, { method: "POST", headers: authHeaders() });
      await refetch();
      qc.invalidateQueries({ queryKey: ["intelligence-dashboard"] });
    } finally { setRefreshing(false); }
  }

  const criticalAlerts = data?.alerts.filter(a => a.severity === "high") ?? [];
  const mediumAlerts = data?.alerts.filter(a => a.severity === "medium") ?? [];
  const criticalRisks = data?.stockRisks.filter(r => r.riskLevel === "critical" || r.riskLevel === "high") ?? [];
  const urgentSuggestions = data?.purchaseSuggestions.filter(s => s.urgency === "critical" || s.urgency === "high") ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-sm">
            <Brain className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-serif font-bold">Intelligence ERP</h1>
            <p className="text-sm text-muted-foreground">
              {data?.generatedAt ? `Mis à jour: ${format(new Date(data.generatedAt), "HH:mm", { locale: fr })}` : "Prévisions, risques et recommandations"}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={handleRefresh} disabled={isLoading || refreshing}>
          <RefreshCw className={`h-4 w-4 ${isLoading || refreshing ? "animate-spin" : ""}`} />
          Actualiser
        </Button>
      </div>

      {/* Critical alert banner */}
      {criticalAlerts.length > 0 && (
        <Alert className="border-red-300 bg-red-50">
          <Flame className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-800 font-medium">
            {criticalAlerts.length} alerte{criticalAlerts.length !== 1 ? "s" : ""} critique{criticalAlerts.length !== 1 ? "s" : ""} — {criticalAlerts.slice(0, 2).map(a => a.title).join(" · ")}
            {criticalAlerts.length > 2 && ` +${criticalAlerts.length - 2} autres`}
          </AlertDescription>
        </Alert>
      )}

      {isLoading && (
        <div className="flex items-center justify-center gap-3 py-20 text-muted-foreground">
          <RefreshCw className="h-5 w-5 animate-spin" />
          <span className="text-sm">Analyse intelligente en cours...</span>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-red-400 mx-auto mb-2" />
          <p className="text-red-700 font-medium">Impossible de charger l'intelligence</p>
          {(error as Error).message && (error as Error).message !== "Erreur intelligence" && (
            <p className="text-red-500 text-sm mt-1 font-mono">{(error as Error).message}</p>
          )}
          <Button size="sm" variant="outline" className="mt-3" onClick={() => refetch()}>Réessayer</Button>
        </div>
      )}

      {data && !isLoading && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-gradient-to-br from-violet-50 to-indigo-50 border-violet-200">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Target className="h-4 w-4 text-violet-600" />
                  <p className="text-xs text-muted-foreground font-medium">Ventes prévues — Auj.</p>
                </div>
                <p className="text-2xl font-bold text-violet-700">{fmt1(data.predictedSalesToday)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">unités · {fmt1(data.predictedSalesWeek)} cette sem.</p>
              </CardContent>
            </Card>

            <Card className={criticalAlerts.length > 0 ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className={`h-4 w-4 ${criticalAlerts.length > 0 ? "text-red-600" : "text-green-600"}`} />
                  <p className="text-xs text-muted-foreground font-medium">Alertes actives</p>
                </div>
                <p className={`text-2xl font-bold ${criticalAlerts.length > 0 ? "text-red-700" : "text-green-700"}`}>{data.alerts.length}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{criticalAlerts.length} critique{criticalAlerts.length !== 1 ? "s" : ""} · {mediumAlerts.length} important{mediumAlerts.length !== 1 ? "s" : ""}</p>
              </CardContent>
            </Card>

            <Card className={criticalRisks.length > 0 ? "bg-orange-50 border-orange-200" : "bg-green-50 border-green-200"}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className={`h-4 w-4 ${criticalRisks.length > 0 ? "text-orange-600" : "text-green-600"}`} />
                  <p className="text-xs text-muted-foreground font-medium">Risques stock</p>
                </div>
                <p className={`text-2xl font-bold ${criticalRisks.length > 0 ? "text-orange-700" : "text-green-700"}`}>{data.stockRisks.length}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{criticalRisks.length} à traiter immédiatement</p>
              </CardContent>
            </Card>

            <Card className={urgentSuggestions.length > 0 ? "bg-amber-50 border-amber-200" : "bg-gray-50 border-gray-200"}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <ShoppingCart className="h-4 w-4 text-amber-600" />
                  <p className="text-xs text-muted-foreground font-medium">Achats suggérés</p>
                </div>
                <p className="text-2xl font-bold text-amber-700">{data.purchaseSuggestions.length}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {formatDA(data.purchaseSuggestions.reduce((s, sg) => s + sg.estimatedCost, 0))} estimé
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Branch summary cards */}
          {data.branchSummaries.length > 1 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.branchSummaries.map(bs => (
                <Card key={bs.branchId} className="border-dashed">
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                      <MapPin className="h-4 w-4 text-indigo-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">{bs.branchName}</p>
                      <p className="text-xs text-muted-foreground">
                        {bs.riskCount} risque{bs.riskCount !== 1 ? "s" : ""} · {bs.suggestionsCount} commande{bs.suggestionsCount !== 1 ? "s" : ""} · {formatDA(bs.estimatedPurchaseCost)}
                      </p>
                    </div>
                    {bs.riskCount > 0 && (
                      <Badge variant="destructive" className="text-xs shrink-0">{bs.riskCount}</Badge>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Main tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full sm:w-auto flex flex-wrap h-auto gap-1 p-1">
              <TabsTrigger value="overview" className="text-xs gap-1.5">
                <Activity className="h-3.5 w-3.5" />Alertes
                {data.alerts.length > 0 && <Badge variant={criticalAlerts.length > 0 ? "destructive" : "secondary"} className="text-xs ml-0.5">{data.alerts.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="forecasts" className="text-xs gap-1.5">
                <TrendingUp className="h-3.5 w-3.5" />Prévisions
              </TabsTrigger>
              <TabsTrigger value="risks" className="text-xs gap-1.5">
                <Shield className="h-3.5 w-3.5" />Risques stock
                {criticalRisks.length > 0 && <Badge variant="destructive" className="text-xs ml-0.5">{criticalRisks.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="purchases" className="text-xs gap-1.5">
                <ShoppingCart className="h-3.5 w-3.5" />Achats suggérés
                {data.purchaseSuggestions.length > 0 && <Badge variant="secondary" className="text-xs ml-0.5">{data.purchaseSuggestions.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="waste" className="text-xs gap-1.5">
                <BarChart3 className="h-3.5 w-3.5" />Gaspillage
                {data.wasteAlerts.filter(a => a.severity !== "low").length > 0 && <Badge variant="secondary" className="text-xs ml-0.5">{data.wasteAlerts.filter(a => a.severity !== "low").length}</Badge>}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Zap className="h-4 w-4 text-amber-500" />Alertes intelligentes
                    <span className="text-sm font-normal text-muted-foreground ml-1">temps réel</span>
                  </CardTitle>
                </CardHeader>
                <CardContent><AlertsPanel alerts={data.alerts} /></CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="forecasts" className="mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-violet-500" />Prévisions de demande
                    <span className="text-sm font-normal text-muted-foreground ml-1">30 derniers jours · moyenne mobile pondérée</span>
                  </CardTitle>
                </CardHeader>
                <CardContent><ForecastsPanel forecasts={data.topForecasts} /></CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="risks" className="mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Shield className="h-4 w-4 text-orange-500" />Risques de rupture de stock
                  </CardTitle>
                </CardHeader>
                <CardContent><RisksPanel risks={data.stockRisks} /></CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="purchases" className="mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <ShoppingCart className="h-4 w-4 text-amber-500" />Suggestions d'achat automatiques
                  </CardTitle>
                </CardHeader>
                <CardContent><PurchasesPanel suggestions={data.purchaseSuggestions} /></CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="waste" className="mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-red-500" />Détection gaspillage & surproduction
                    <span className="text-sm font-normal text-muted-foreground ml-1">30 derniers jours</span>
                  </CardTitle>
                </CardHeader>
                <CardContent><WastePanel alerts={data.wasteAlerts} /></CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
