import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { customFetch, useGetBranches } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BarChart, Bar, PieChart as RPieChart, Pie, Cell, Tooltip,
  ResponsiveContainer, XAxis, YAxis, CartesianGrid, AreaChart, Area,
} from "recharts";
import {
  Heart, Crown, Star, Users, UserX, UserPlus, TrendingUp, TrendingDown,
  Zap, Tag, RefreshCw, Moon, XCircle, Calendar, Award,
  Download, Search, Filter, ChevronRight, Building2,
  AlertTriangle, CheckCircle2, CreditCard, Banknote, ArrowUpRight,
  BarChart2, Target, Clock, Flame, ShieldAlert,
} from "lucide-react";
import { format, subDays, subMonths, subYears } from "date-fns";
import { fr } from "date-fns/locale";
import { useAuth } from "@/lib/auth";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDA(n: number) {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M DA";
  if (Math.abs(n) >= 1_000) return Math.round(n / 1_000) + "k DA";
  return Math.round(n) + " DA";
}
function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try { return format(new Date(d), "dd MMM yyyy", { locale: fr }); } catch { return "—"; }
}
function fmtDays(n: number) {
  if (n < 1) return "Aujourd'hui";
  if (n === 1) return "Hier";
  if (n < 7) return `Il y a ${n}j`;
  if (n < 30) return `Il y a ${Math.round(n / 7)}sem`;
  if (n < 365) return `Il y a ${Math.round(n / 30)}mois`;
  return `Il y a ${Math.round(n / 365)}an(s)`;
}

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  crown: Crown, star: Star, heart: Heart, "trending-up": TrendingUp,
  "user-plus": UserPlus, zap: Zap, "refresh-cw": RefreshCw, moon: Moon,
  "x-circle": XCircle, calendar: Calendar, tag: Tag, "user-x": UserX,
};

const PERIOD_OPTIONS = [
  { label: "30 jours",  value: "30d",  from: () => format(subDays(new Date(), 29), "yyyy-MM-dd") },
  { label: "90 jours",  value: "90d",  from: () => format(subDays(new Date(), 89), "yyyy-MM-dd") },
  { label: "180 jours", value: "180d", from: () => format(subDays(new Date(), 179), "yyyy-MM-dd") },
  { label: "365 jours", value: "365d", from: () => format(subDays(new Date(), 364), "yyyy-MM-dd") },
  { label: "Tout",      value: "all",  from: () => "2023-01-01" },
];

const SEGMENTS_FILTER = [
  { key: "all", label: "Tous" },
  { key: "vip", label: "VIP" },
  { key: "tres_fideles", label: "Très fidèles" },
  { key: "fideles", label: "Fidèles" },
  { key: "prometteurs", label: "Prometteurs" },
  { key: "nouveaux", label: "Nouveaux" },
  { key: "fort_potentiel", label: "Fort potentiel" },
  { key: "a_reactiver", label: "À réactiver" },
  { key: "en_sommeil", label: "En sommeil" },
  { key: "perdus", label: "Perdus" },
  { key: "prix", label: "Sensibles prix" },
  { key: "occasionnels", label: "Occasionnels" },
  { key: "aucun_achat", label: "Aucun achat" },
];

const PRIORITY_CFG = {
  critical: { label: "Critique",  cls: "bg-red-100 text-red-700 border-red-200" },
  high:     { label: "Élevée",    cls: "bg-orange-100 text-orange-700 border-orange-200" },
  medium:   { label: "Moyenne",   cls: "bg-amber-100 text-amber-700 border-amber-200" },
  low:      { label: "Faible",    cls: "bg-slate-100 text-slate-600 border-slate-200" },
};

const TABS = [
  { id: "overview",      label: "Vue d'ensemble",   icon: BarChart2 },
  { id: "segments",      label: "Segments",          icon: Users },
  { id: "opportunities", label: "Opportunités",      icon: Target },
  { id: "dormant",       label: "Clients dormants",  icon: Moon },
  { id: "rankings",      label: "Classement",        icon: Award },
  { id: "campaigns",     label: "Campagnes",         icon: Flame },
];

// ─── Shared components ────────────────────────────────────────────────────────

function SegBadge({ seg, label, color }: { seg: string; label: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold border"
      style={{ backgroundColor: color + "18", color, borderColor: color + "40" }}>
      {label}
    </span>
  );
}

function ScorePips({ score, max = 5 }: { score: number; max?: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <div key={i} className={`h-1.5 w-2.5 rounded-sm ${i < score ? "bg-green-500" : "bg-muted"}`} />
      ))}
    </div>
  );
}

function RfmScoreCard({ r, f, m, total }: { r: number; f: number; m: number; total: number }) {
  return (
    <div className="grid grid-cols-4 gap-2 text-center">
      {[["R", r, "text-blue-700"], ["F", f, "text-green-700"], ["M", m, "text-amber-700"]].map(([lbl, val, cls]) => (
        <div key={String(lbl)} className="bg-muted/30 rounded-lg p-2">
          <p className="text-[10px] text-muted-foreground">{lbl}</p>
          <p className={`text-lg font-black ${cls}`}>{val}</p>
          <ScorePips score={Number(val)} />
        </div>
      ))}
      <div className="bg-indigo-50 rounded-lg p-2 border border-indigo-100">
        <p className="text-[10px] text-muted-foreground">Total</p>
        <p className="text-lg font-black text-indigo-700">{total}</p>
        <p className="text-[9px] text-muted-foreground">/ 15</p>
      </div>
    </div>
  );
}

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background border border-border rounded-lg shadow-lg p-3 text-xs space-y-1">
      <p className="font-semibold text-muted-foreground">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex justify-between gap-4">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="font-bold">{typeof p.value === "number" && p.value > 999 ? fmtDA(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="h-32 flex items-center justify-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

// ─── Main loyalty page ────────────────────────────────────────────────────────
export default function LoyaltyPage() {
  const { user } = useAuth();
  const params = useParams<{ tab?: string }>();
  const [, navigate] = useLocation();
  const activeTab = params.tab ?? "overview";

  // Filters
  const [period, setPeriod] = useState("365d");
  const [branchId, setBranchId] = useState("all");
  const [segment, setSegment] = useState("all");
  const [search, setSearch] = useState("");
  const [includeNoActivity, setIncludeNoActivity] = useState(true);

  const { data: branches } = useGetBranches();
  const showBranchFilter = user?.adminAccess || (user?.branchIds && user.branchIds.length > 1);

  const periodCfg = PERIOD_OPTIONS.find(p => p.value === period) ?? PERIOD_OPTIONS[3];
  const from = periodCfg.from();
  const to = format(new Date(), "yyyy-MM-dd");

  const qs = useMemo(() => {
    const p: Record<string, string> = { from, to };
    if (branchId !== "all") p.branchId = branchId;
    return new URLSearchParams(p).toString();
  }, [from, to, branchId]);

  const segmentsQs = useMemo(() => {
    const p: Record<string, string> = { from, to };
    if (branchId !== "all") p.branchId = branchId;
    if (segment !== "all") p.segment = segment;
    if (search) p.search = search;
    if (includeNoActivity) p.includeNoActivity = "true";
    return new URLSearchParams(p).toString();
  }, [from, to, branchId, segment, search, includeNoActivity]);

  const { data: overview, isLoading: ovLoading } = useQuery({
    queryKey: ["loyalty-overview", qs],
    queryFn: () => customFetch(`/api/loyalty/overview?${qs}`),
    enabled: activeTab === "overview",
  });
  const { data: segmentsData, isLoading: segLoading } = useQuery({
    queryKey: ["loyalty-segments", segmentsQs],
    queryFn: () => customFetch(`/api/loyalty/segments?${segmentsQs}`),
    enabled: activeTab === "segments" || activeTab === "overview",
  });
  const { data: oppsData, isLoading: oppsLoading } = useQuery({
    queryKey: ["loyalty-opps", qs],
    queryFn: () => customFetch(`/api/loyalty/opportunities?${qs}`),
    enabled: activeTab === "opportunities",
  });
  const { data: dormantData, isLoading: dormLoading } = useQuery({
    queryKey: ["loyalty-dormant", qs],
    queryFn: () => customFetch(`/api/loyalty/dormant?${qs}`),
    enabled: activeTab === "dormant",
  });
  const { data: rankingsData, isLoading: rankLoading } = useQuery({
    queryKey: ["loyalty-rankings", qs],
    queryFn: () => customFetch(`/api/loyalty/rankings?${qs}`),
    enabled: activeTab === "rankings",
  });
  const { data: crmRfmData, isLoading: crmLoading } = useQuery({
    queryKey: ["crm-rfm", qs],
    queryFn: () => customFetch(`/api/crm/rfm?${qs}`),
    enabled: activeTab === "overview",
  });

  const ov = overview as any;
  const segs = (segmentsData as any[]) ?? [];
  const opps = (oppsData as any[]) ?? [];
  const dorm = dormantData as any;
  const ranks = rankingsData as any;
  const crm = crmRfmData as any;

  const [rankTab, setRankTab] = useState<"byRevenue" | "byFrequency" | "byBasket" | "byScore">("byRevenue");
  const [campaignFilters, setCampaignFilters] = useState({ minRevenue: "", maxInactivity: "", segmentKey: "all", branchId: "all" });

  const handleExport = () => window.open(`/api/export/loyalty-customers?${segmentsQs}`, "_blank");

  const handleRecompute = async () => {
    try {
      await customFetch("/api/loyalty/recompute", { method: "POST", body: { period: "365d" } });
    } catch {}
  };

  // Campaign filtered list
  const campaignCustomers = useMemo(() => {
    if (activeTab !== "campaigns") return [];
    return segs.filter(c => {
      if (campaignFilters.segmentKey !== "all" && c.segment !== campaignFilters.segmentKey) return false;
      if (campaignFilters.minRevenue && c.netRevenue < parseFloat(campaignFilters.minRevenue)) return false;
      if (campaignFilters.maxInactivity && c.recencyDays > parseInt(campaignFilters.maxInactivity, 10)) return false;
      return true;
    });
  }, [segs, campaignFilters, activeTab]);

  const exportCampaignCSV = () => {
    const header = "Nom,Téléphone,Segment,Dernière activité,Jours inactif,CA net,Panier moyen";
    const rows = campaignCustomers.map(c =>
      [c.displayName, c.phone ?? "", c.segmentLabel, fmtDate(c.lastPurchaseDate), c.recencyDays, Math.round(c.netRevenue), Math.round(c.avgBasket)].map(v => `"${v}"`).join(",")
    );
    const blob = new Blob(["\uFEFF" + [header, ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "audience_campagne.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full">
      {/* ── Header + Tab nav ───────────────────────────────────────────────── */}
      <div className="border-b border-border/60 bg-background sticky top-0 z-10">
        <div className="px-6 pt-4 pb-0">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-rose-50 rounded-xl">
              <Heart className="h-5 w-5 text-rose-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Fidélité Clients & Segmentation RFM</h1>
              <p className="text-xs text-muted-foreground">Intelligence commerciale · {periodCfg.label}</p>
            </div>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={handleRecompute}>
                <RefreshCw className="h-3 w-3" />Recalculer
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={handleExport}>
                <Download className="h-3 w-3" />Export CSV
              </Button>
            </div>
          </div>

          {/* Filters bar */}
          <div className="flex flex-wrap gap-2 mb-3">
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="h-7 text-xs w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {showBranchFilter && (
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger className="h-7 text-xs w-40"><SelectValue placeholder="Toutes agences" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes les agences</SelectItem>
                  {(branches ?? []).map((b: any) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <div className="relative">
              <Search className="absolute left-2 top-1.5 h-3 w-3 text-muted-foreground" />
              <Input placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)} className="h-7 text-xs pl-6 w-40" />
            </div>
          </div>

          {/* Tab navigation */}
          <div className="flex gap-0">
            {TABS.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button key={tab.id} onClick={() => navigate(`/loyalty/${tab.id}`)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${isActive ? "border-rose-600 text-rose-700" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                  <Icon className="h-3.5 w-3.5" />{tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Tab content ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto p-6 space-y-6">

        {/* ═══════════════════════ TAB: Vue d'ensemble ═══════════════════════ */}
        {activeTab === "overview" && (
          <>
            {/* KPI strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
              {[
                { label: "Total clients", value: ov?.totalCustomers ?? "—", icon: Users, color: "blue" },
                { label: "Clients actifs", value: ov?.activeCustomers ?? "—", icon: CheckCircle2, color: "green" },
                { label: "Nouveaux", value: ov?.newCustomers ?? "—", icon: UserPlus, color: "violet" },
                { label: "Fidélisés", value: ov?.returningCustomers ?? "—", icon: Heart, color: "rose" },
                { label: "Dormants", value: ov?.dormantCustomers ?? "—", icon: Moon, color: "amber" },
                { label: "Perdus", value: ov?.lostCustomers ?? "—", icon: XCircle, color: "red" },
                { label: "CA net total", value: ov ? fmtDA(ov.totalNetRevenue) : "—", icon: TrendingUp, color: "emerald" },
                { label: "Panier moyen", value: ov ? fmtDA(ov.avgBasket) : "—", icon: Tag, color: "indigo" },
              ].map(({ label, value, icon: Icon, color }) => {
                const bg: Record<string, string> = { blue: "bg-blue-50", green: "bg-green-50", violet: "bg-violet-50", rose: "bg-rose-50", amber: "bg-amber-50", red: "bg-red-50", emerald: "bg-emerald-50", indigo: "bg-indigo-50" };
                const ic: Record<string, string> = { blue: "text-blue-600", green: "text-green-600", violet: "text-violet-600", rose: "text-rose-600", amber: "text-amber-600", red: "text-red-600", emerald: "text-emerald-600", indigo: "text-indigo-600" };
                const vc: Record<string, string> = { blue: "text-blue-700", green: "text-green-700", violet: "text-violet-700", rose: "text-rose-700", amber: "text-amber-700", red: "text-red-700", emerald: "text-emerald-700", indigo: "text-indigo-700" };
                return (
                  <Card key={label} className="border-0 shadow-sm">
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <div className={`p-1.5 rounded-lg ${bg[color]}`}><Icon className={`h-3.5 w-3.5 ${ic[color]}`} /></div>
                        <p className="text-[10px] text-muted-foreground font-medium">{label}</p>
                      </div>
                      {ovLoading ? <div className="h-6 w-16 bg-muted animate-pulse rounded" /> : (
                        <p className={`text-xl font-black ${vc[color]}`}>{value}</p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Segment donut + opportunities */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="border-0 shadow-sm lg:col-span-2">
                <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Répartition par segment</CardTitle></CardHeader>
                <CardContent className="pb-4">
                  <div className="grid grid-cols-2 gap-4">
                    {/* Bar chart */}
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={ov?.segmentDistribution?.slice(0, 8) ?? []} layout="vertical" margin={{ left: 0, right: 10 }}>
                        <XAxis type="number" tick={{ fontSize: 8 }} hide />
                        <YAxis type="category" dataKey="label" tick={{ fontSize: 9 }} width={85} />
                        <Tooltip formatter={(v: any) => `${v} clients`} />
                        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                          {(ov?.segmentDistribution?.slice(0, 8) ?? []).map((s: any, i: number) => (
                            <Cell key={i} fill={s.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    {/* Segment chips */}
                    <div className="space-y-1.5 overflow-auto max-h-52">
                      {(ov?.segmentDistribution ?? []).map((s: any) => (
                        <div key={s.key} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5">
                            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                            <span className="text-muted-foreground">{s.label}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold" style={{ color: s.color }}>{s.count}</span>
                            <span className="text-muted-foreground text-[10px]">{s.pct}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" />Signaux d'action</CardTitle></CardHeader>
                <CardContent className="pb-3 space-y-2">
                  {(ov?.topOpportunities ?? []).map((op: string, i: number) => (
                    <div key={i} className="flex items-start gap-2 p-2.5 bg-amber-50 rounded-lg border border-amber-100 text-xs text-amber-800">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{op}
                    </div>
                  ))}
                  {(!ov?.topOpportunities?.length) && (
                    <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg text-xs text-green-700">
                      <CheckCircle2 className="h-4 w-4" />Aucun signal d'alerte pour cette période
                    </div>
                  )}
                  <Separator className="my-2" />
                  <div className="text-xs text-muted-foreground">
                    <p>Fréquence moyenne: <span className="font-semibold text-foreground">{ov?.avgFrequency ?? "—"} achat(s)</span></p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* New customer trend */}
            {ov?.newCustomerTrend?.length > 0 && (
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Nouveaux clients actifs (30 derniers jours)</CardTitle></CardHeader>
                <CardContent className="pb-4">
                  <ResponsiveContainer width="100%" height={120}>
                    <AreaChart data={ov.newCustomerTrend}>
                      <defs>
                        <linearGradient id="gNew" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ec4899" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#ec4899" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="date" tick={{ fontSize: 8 }} tickFormatter={d => d.slice(5)} />
                      <YAxis tick={{ fontSize: 8 }} allowDecimals={false} />
                      <Tooltip />
                      <Area type="monotone" dataKey="count" name="Nouveaux clients" stroke="#ec4899" fill="url(#gNew)" strokeWidth={2} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* ── RFM Analytics from /api/crm/rfm ─────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Top 10 clients par CA */}
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Crown className="h-4 w-4 text-amber-500" />Top 10 clients par CA net
                  </CardTitle>
                </CardHeader>
                <CardContent className="pb-3">
                  {crmLoading ? (
                    <div className="h-32 flex items-center justify-center"><div className="h-4 w-32 bg-muted animate-pulse rounded" /></div>
                  ) : (crm?.top10BySpend ?? []).length > 0 ? (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={crm.top10BySpend} layout="vertical" margin={{ left: 0, right: 40 }}>
                        <XAxis type="number" tick={{ fontSize: 8 }} tickFormatter={(v: number) => fmtDA(v)} hide />
                        <YAxis type="category" dataKey="displayName" tick={{ fontSize: 8 }} width={90} />
                        <Tooltip content={<ChartTip />} />
                        <Bar dataKey="netRevenue" name="CA net" radius={[0, 4, 4, 0]}>
                          {(crm?.top10BySpend ?? []).map((c: any, i: number) => (
                            <Cell key={i} fill={c.segmentColor ?? "#6366f1"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <EmptyState message="Aucune donnée disponible" />}
                </CardContent>
              </Card>

              {/* Fréquence distribution + tier counts */}
              <div className="flex flex-col gap-4">
                <Card className="border-0 shadow-sm flex-1">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <BarChart2 className="h-4 w-4 text-indigo-500" />Distribution de la fréquence d'achat
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pb-3">
                    {crmLoading ? (
                      <div className="h-24 flex items-center justify-center"><div className="h-4 w-32 bg-muted animate-pulse rounded" /></div>
                    ) : (crm?.frequencyBuckets ?? []).length > 0 ? (
                      <ResponsiveContainer width="100%" height={120}>
                        <BarChart data={crm.frequencyBuckets} margin={{ top: 4 }}>
                          <XAxis dataKey="label" tick={{ fontSize: 8 }} />
                          <YAxis tick={{ fontSize: 8 }} allowDecimals={false} />
                          <Tooltip formatter={(v: any) => [`${v} clients`, "Clients"]} />
                          <Bar dataKey="count" name="Clients" fill="#6366f1" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : <EmptyState message="Aucune donnée disponible" />}
                  </CardContent>
                </Card>

                {/* Tier badges: VIP / Régulier / Dormant */}
                <Card className="border-0 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">Classification RFM</CardTitle>
                  </CardHeader>
                  <CardContent className="pb-3">
                    {crmLoading ? (
                      <div className="flex gap-2"><div className="h-12 flex-1 bg-muted animate-pulse rounded" /><div className="h-12 flex-1 bg-muted animate-pulse rounded" /><div className="h-12 flex-1 bg-muted animate-pulse rounded" /></div>
                    ) : (
                      <div className="grid grid-cols-4 gap-2 text-center">
                        {[
                          { key: "VIP",      color: "text-amber-700",  bg: "bg-amber-50",  label: "VIP",      icon: Crown },
                          { key: "Régulier", color: "text-blue-700",   bg: "bg-blue-50",   label: "Régulier", icon: Users },
                          { key: "Nouveau",  color: "text-violet-700", bg: "bg-violet-50", label: "Nouveau",  icon: UserPlus },
                          { key: "Dormant",  color: "text-slate-600",  bg: "bg-slate-50",  label: "Dormant",  icon: Moon },
                        ].map(({ key, color, bg, label, icon: Icon }) => (
                          <div key={key} className={`${bg} rounded-xl p-3`}>
                            <Icon className={`h-4 w-4 mx-auto mb-1 ${color}`} />
                            <p className={`text-lg font-black ${color}`}>{crm?.summary?.tierCounts?.[key] ?? 0}</p>
                            <p className="text-[10px] text-muted-foreground">{label}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </>
        )}

        {/* ═══════════════════════ TAB: Segments ══════════════════════════════ */}
        {activeTab === "segments" && (
          <>
            {/* Segment filter chips */}
            <div className="flex flex-wrap gap-1.5">
              {SEGMENTS_FILTER.map(sf => (
                <button key={sf.key} onClick={() => setSegment(sf.key)}
                  className={`px-2.5 py-1 text-xs rounded-full border font-medium transition-colors ${segment === sf.key ? "bg-rose-600 text-white border-rose-600" : "border-border text-muted-foreground hover:border-rose-300"}`}>
                  {sf.label}
                </button>
              ))}
              <button onClick={() => setIncludeNoActivity(!includeNoActivity)}
                className={`px-2.5 py-1 text-xs rounded-full border font-medium transition-colors ${includeNoActivity ? "bg-slate-200 text-slate-700 border-slate-300" : "border-border text-muted-foreground"}`}>
                Inclure sans achat
              </button>
            </div>

            <Card className="border-0 shadow-sm">
              <CardContent className="p-0">
                {segLoading ? (
                  <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">Calcul RFM en cours...</div>
                ) : segs.length > 0 ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="text-xs font-semibold w-8">#</TableHead>
                          <TableHead className="text-xs font-semibold">Client</TableHead>
                          <TableHead className="text-xs font-semibold">Segment</TableHead>
                          <TableHead className="text-xs font-semibold text-center">R</TableHead>
                          <TableHead className="text-xs font-semibold text-center">F</TableHead>
                          <TableHead className="text-xs font-semibold text-center">M</TableHead>
                          <TableHead className="text-xs font-semibold text-center">Score</TableHead>
                          <TableHead className="text-xs font-semibold text-right">CA net</TableHead>
                          <TableHead className="text-xs font-semibold text-right">Achats</TableHead>
                          <TableHead className="text-xs font-semibold text-right">Panier moy.</TableHead>
                          <TableHead className="text-xs font-semibold">Dernier achat</TableHead>
                          <TableHead className="text-xs font-semibold text-right">Crédit</TableHead>
                          <TableHead className="text-xs font-semibold">Agence</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {segs.slice(0, 100).map((c: any, i: number) => (
                          <TableRow key={c.customerId} className="hover:bg-muted/30">
                            <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                            <TableCell>
                              <div>
                                <p className="text-xs font-semibold">{c.displayName}</p>
                                {c.phone && <p className="text-[10px] text-muted-foreground">{c.phone}</p>}
                              </div>
                            </TableCell>
                            <TableCell><SegBadge seg={c.segment} label={c.segmentLabel} color={c.segmentColor} /></TableCell>
                            <TableCell className="text-center">
                              <span className="text-xs font-bold text-blue-700">{c.rScore || "—"}</span>
                            </TableCell>
                            <TableCell className="text-center">
                              <span className="text-xs font-bold text-green-700">{c.fScore || "—"}</span>
                            </TableCell>
                            <TableCell className="text-center">
                              <span className="text-xs font-bold text-amber-700">{c.mScore || "—"}</span>
                            </TableCell>
                            <TableCell className="text-center">
                              <span className={`text-xs font-black ${c.totalScore >= 12 ? "text-rose-700" : c.totalScore >= 9 ? "text-green-700" : c.totalScore >= 6 ? "text-blue-700" : "text-muted-foreground"}`}>
                                {c.totalScore || "—"}
                              </span>
                            </TableCell>
                            <TableCell className="text-xs text-right font-semibold text-green-700">
                              {c.netRevenue > 0 ? fmtDA(c.netRevenue) : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-xs text-right text-muted-foreground">{c.frequency || "—"}</TableCell>
                            <TableCell className="text-xs text-right text-muted-foreground">
                              {c.avgBasket > 0 ? fmtDA(c.avgBasket) : "—"}
                            </TableCell>
                            <TableCell className="text-xs">
                              {c.lastPurchaseDate ? (
                                <div>
                                  <p>{fmtDays(c.recencyDays)}</p>
                                  <p className="text-[10px] text-muted-foreground">{fmtDate(c.lastPurchaseDate)}</p>
                                </div>
                              ) : <span className="text-muted-foreground">Jamais</span>}
                            </TableCell>
                            <TableCell className="text-xs text-right">
                              {c.walletBalance > 0 ? (
                                <span className="text-indigo-700 font-semibold">{fmtDA(c.walletBalance)}</span>
                              ) : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{c.mainBranch}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : <EmptyState message="Aucun client ne correspond aux filtres sélectionnés" />}
              </CardContent>
            </Card>
          </>
        )}

        {/* ═══════════════════════ TAB: Opportunités ══════════════════════════ */}
        {activeTab === "opportunities" && (
          <>
            {oppsLoading ? (
              <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">Analyse en cours...</div>
            ) : opps.length > 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {opps.map((opp: any, i: number) => {
                  const priorCfg = PRIORITY_CFG[opp.priority as keyof typeof PRIORITY_CFG] ?? PRIORITY_CFG.low;
                  const typeIcons: Record<string, React.FC<{ className?: string }>> = {
                    near_vip: Crown, high_basket_low_freq: Zap, wallet_unused: Banknote,
                    declining_recency: TrendingDown, one_time_big: ArrowUpRight,
                  };
                  const TypeIcon = typeIcons[opp.type] ?? Target;
                  return (
                    <Card key={i} className="border-0 shadow-sm hover:shadow-md transition-shadow">
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className="p-2 rounded-xl bg-rose-50 shrink-0">
                            <TypeIcon className="h-4 w-4 text-rose-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="text-sm font-bold">{opp.customerName}</p>
                              <Badge className={`text-[9px] h-4 px-1 border ${priorCfg.cls}`}>{priorCfg.label}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mb-2">{opp.reason}</p>
                            <div className="p-2 bg-blue-50 rounded-lg text-[11px] text-blue-800 mb-2">
                              <span className="font-semibold">Action suggérée : </span>{opp.suggestedAction}
                            </div>
                            <div className="flex items-center justify-between text-[10px]">
                              <span className="text-muted-foreground">Impact: <span className="font-semibold text-green-700">{opp.estimatedImpact}</span></span>
                              <span className="text-muted-foreground">CA: <span className="font-semibold">{fmtDA(opp.revenue)}</span></span>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-48 text-center gap-3">
                <CheckCircle2 className="h-12 w-12 text-green-400" />
                <p className="text-sm text-muted-foreground">Aucune opportunité détectée sur cette période</p>
                <p className="text-xs text-muted-foreground">Changez la période ou vérifiez les données de ventes</p>
              </div>
            )}
          </>
        )}

        {/* ═══════════════════════ TAB: Clients dormants ══════════════════════ */}
        {activeTab === "dormant" && (
          <>
            {/* Summary */}
            {dorm?.summary && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Total dormants", value: dorm.summary.total, color: "text-slate-700" },
                  { label: "Critique", value: dorm.summary.critical, color: "text-red-700" },
                  { label: "Priorité élevée", value: dorm.summary.high, color: "text-orange-700" },
                  { label: "CA potentiel perdu", value: fmtDA(dorm.summary.totalLostRevenuePotential), color: "text-amber-700" },
                ].map(s => (
                  <Card key={s.label} className="border-0 shadow-sm">
                    <CardContent className="p-3">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{s.label}</p>
                      <p className={`text-xl font-black ${s.color}`}>{s.value}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Dormant list */}
            {dormLoading ? (
              <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">Analyse...</div>
            ) : (dorm?.dormant?.length > 0 || dorm?.noActivity?.length > 0) ? (
              <div className="space-y-3">
                {[...(dorm?.dormant ?? []), ...(dorm?.noActivity ?? [])].map((c: any, i: number) => {
                  const priorCfg = PRIORITY_CFG[c.reactivationPriority as keyof typeof PRIORITY_CFG] ?? PRIORITY_CFG.low;
                  return (
                    <Card key={i} className={`border-0 shadow-sm ${c.reactivationPriority === "critical" ? "border-l-4 border-l-red-500" : c.reactivationPriority === "high" ? "border-l-4 border-l-orange-400" : ""}`}>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="text-sm font-bold">{c.displayName}</p>
                              <SegBadge seg={c.segment} label={c.segmentLabel} color={c.segmentColor} />
                              <Badge className={`text-[9px] h-4 px-1 border ${priorCfg.cls}`}>{priorCfg.label}</Badge>
                            </div>
                            <div className="flex gap-4 text-xs text-muted-foreground">
                              <span><Clock className="h-3 w-3 inline mr-0.5" />
                                {c.recencyDays > 0 ? `Inactif depuis ${c.recencyDays} jour(s)` : "Jamais acheté"}
                              </span>
                              {c.frequency > 0 && <span>{c.frequency} achat(s) · {fmtDA(c.netRevenue)} CA</span>}
                              {c.lastPurchaseDate && <span>Dernier: {fmtDate(c.lastPurchaseDate)}</span>}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[10px] text-muted-foreground mb-1">Action suggérée</p>
                            <p className="text-xs font-medium text-blue-700 max-w-48 text-right">{c.suggestedOffer}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ) : <EmptyState message="Aucun client dormant détecté sur cette période" />}
          </>
        )}

        {/* ═══════════════════════ TAB: Classement ════════════════════════════ */}
        {activeTab === "rankings" && (
          <>
            {/* Rank dimension tabs */}
            <div className="flex gap-1">
              {([
                ["byRevenue", "Par CA", TrendingUp],
                ["byFrequency", "Par fréquence", BarChart2],
                ["byBasket", "Par panier", Tag],
                ["byScore", "Par score RFM", Crown],
              ] as const).map(([key, lbl, Icon]) => (
                <button key={key} onClick={() => setRankTab(key as any)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${rankTab === key ? "bg-rose-600 text-white border-rose-600" : "border-border text-muted-foreground hover:border-rose-300"}`}>
                  <Icon className="h-3 w-3" />{lbl}
                </button>
              ))}
            </div>

            <Card className="border-0 shadow-sm">
              <CardContent className="p-0">
                {rankLoading ? (
                  <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">Calcul...</div>
                ) : (ranks?.[rankTab]?.length > 0) ? (
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="text-xs font-semibold w-8">#</TableHead>
                        <TableHead className="text-xs font-semibold">Client</TableHead>
                        <TableHead className="text-xs font-semibold">Segment</TableHead>
                        <TableHead className="text-xs font-semibold text-right">CA net</TableHead>
                        <TableHead className="text-xs font-semibold text-right">Achats</TableHead>
                        <TableHead className="text-xs font-semibold text-right">Panier moy.</TableHead>
                        <TableHead className="text-xs font-semibold text-center">Score RFM</TableHead>
                        <TableHead className="text-xs font-semibold">Inactivité</TableHead>
                        <TableHead className="text-xs font-semibold">Agence</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(ranks?.[rankTab] ?? []).map((c: any, i: number) => (
                        <TableRow key={c.customerId}>
                          <TableCell>
                            <div className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-black ${i === 0 ? "bg-amber-100 text-amber-700" : i === 1 ? "bg-slate-100 text-slate-600" : i === 2 ? "bg-orange-50 text-orange-600" : "text-muted-foreground"}`}>
                              {i + 1}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs font-semibold">{c.displayName}</TableCell>
                          <TableCell><SegBadge seg={c.segment} label={c.segmentLabel} color={c.segmentColor} /></TableCell>
                          <TableCell className="text-xs text-right font-bold text-green-700">{fmtDA(c.netRevenue)}</TableCell>
                          <TableCell className="text-xs text-right text-muted-foreground">{c.frequency}</TableCell>
                          <TableCell className="text-xs text-right text-muted-foreground">{fmtDA(c.avgBasket)}</TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1 text-[10px]">
                              <span className="text-blue-600 font-bold">{c.rScore}</span>
                              <span className="text-muted-foreground">/</span>
                              <span className="text-green-600 font-bold">{c.fScore}</span>
                              <span className="text-muted-foreground">/</span>
                              <span className="text-amber-600 font-bold">{c.mScore}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{fmtDays(c.recencyDays)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{c.mainBranch}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : <EmptyState message="Aucun client sur cette période" />}
              </CardContent>
            </Card>
          </>
        )}

        {/* ═══════════════════════ TAB: Campagnes ════════════════════════════ */}
        {activeTab === "campaigns" && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
              {/* Filters */}
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Filter className="h-4 w-4 text-rose-500" />Filtres audience
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Segment cible</Label>
                    <Select value={campaignFilters.segmentKey} onValueChange={v => setCampaignFilters(f => ({ ...f, segmentKey: v }))}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SEGMENTS_FILTER.map(sf => <SelectItem key={sf.key} value={sf.key}>{sf.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">CA minimum (DA)</Label>
                    <Input placeholder="ex: 50000" value={campaignFilters.minRevenue}
                      onChange={e => setCampaignFilters(f => ({ ...f, minRevenue: e.target.value }))}
                      className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Inactivité max (jours)</Label>
                    <Input placeholder="ex: 90" value={campaignFilters.maxInactivity}
                      onChange={e => setCampaignFilters(f => ({ ...f, maxInactivity: e.target.value }))}
                      className="h-8 text-xs" />
                  </div>
                  <Separator />
                  <div className="text-center">
                    <p className="text-xl font-black text-rose-700">{campaignCustomers.length}</p>
                    <p className="text-[10px] text-muted-foreground">clients dans l'audience</p>
                  </div>
                  <Button className="w-full h-8 text-xs" variant="outline" onClick={exportCampaignCSV} disabled={campaignCustomers.length === 0}>
                    <Download className="h-3.5 w-3.5 mr-1.5" />Exporter l'audience
                  </Button>
                </CardContent>
              </Card>

              {/* Campaign suggestions */}
              <div className="lg:col-span-3 space-y-3">
                {/* Auto-generated suggestions */}
                {[
                  {
                    title: "Réactivation urgente — Clients à réactiver",
                    target: "a_reactiver",
                    color: "bg-orange-50 border-orange-200",
                    titleColor: "text-orange-800",
                    msg: "Nous ne vous avons pas vu depuis un moment... Revenez découvrir nos nouvelles créations avec -10% sur votre prochaine commande.",
                    count: segs.filter(s => s.segment === "a_reactiver").length,
                  },
                  {
                    title: "Offre VIP exclusive — Vos meilleurs clients",
                    target: "vip",
                    color: "bg-amber-50 border-amber-200",
                    titleColor: "text-amber-800",
                    msg: "En exclusivité pour nos clients VIP : accès prioritaire à notre nouvelle collection de pâtisseries de saison.",
                    count: segs.filter(s => s.segment === "vip").length,
                  },
                  {
                    title: "Bienvenue & fidélisation — Nouveaux clients",
                    target: "nouveaux",
                    color: "bg-violet-50 border-violet-200",
                    titleColor: "text-violet-800",
                    msg: "Merci pour votre premier achat ! Découvrez toute notre gamme et bénéficiez d'une réduction sur votre 2ème commande.",
                    count: segs.filter(s => s.segment === "nouveaux").length,
                  },
                  {
                    title: "Fréquence — Clients à fort potentiel sous-exploités",
                    target: "fort_potentiel",
                    color: "bg-blue-50 border-blue-200",
                    titleColor: "text-blue-800",
                    msg: "Vous avez bon goût ! Nos formules abonnement vous permettent de commander plus souvent et de bénéficier de tarifs préférentiels.",
                    count: segs.filter(s => s.segment === "fort_potentiel").length,
                  },
                ].map((s, i) => (
                  <Card key={i} className={`border ${s.color} shadow-sm`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <p className={`text-sm font-bold ${s.titleColor}`}>{s.title}</p>
                            <Badge variant="outline" className="text-[10px] h-4">{s.count} clients</Badge>
                          </div>
                          <div className="p-2.5 bg-white/70 rounded-lg text-xs text-slate-700 italic">
                            "{s.msg}"
                          </div>
                        </div>
                        <Button size="sm" variant="outline" className="h-7 text-xs shrink-0"
                          onClick={() => setCampaignFilters(f => ({ ...f, segmentKey: s.target }))}>
                          Sélectionner
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}

                {/* Filtered audience preview */}
                {campaignCustomers.length > 0 && (
                  <Card className="border-0 shadow-sm">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold">Aperçu audience ({campaignCustomers.length} clients)</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead className="text-xs font-semibold">Client</TableHead>
                            <TableHead className="text-xs font-semibold">Segment</TableHead>
                            <TableHead className="text-xs font-semibold text-right">CA net</TableHead>
                            <TableHead className="text-xs font-semibold">Inactivité</TableHead>
                            <TableHead className="text-xs font-semibold">Téléphone</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {campaignCustomers.slice(0, 20).map((c: any) => (
                            <TableRow key={c.customerId}>
                              <TableCell className="text-xs font-semibold">{c.displayName}</TableCell>
                              <TableCell><SegBadge seg={c.segment} label={c.segmentLabel} color={c.segmentColor} /></TableCell>
                              <TableCell className="text-xs text-right font-bold text-green-700">{fmtDA(c.netRevenue)}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{fmtDays(c.recencyDays)}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{c.phone ?? "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
