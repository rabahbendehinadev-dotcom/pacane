import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Users, UserCheck, UserX, Clock, Stethoscope, Palmtree, BarChart3, TrendingUp,
  Trophy, AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Star,
  Loader2, ClipboardList, Check, X, Wallet, Building2, Search, Download,
  Flame, Award, Target, BrainCircuit, Bell, Gift,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";

const AUTH = () => ({ Authorization: `Bearer ${localStorage.getItem("erp_token")}` });
const AUTHJSON = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` });

interface HRStats {
  totalActive: number;
  today: { present: number; late: number; absent: number; vacation: number; sick: number; total: number };
  monthly: { attendanceRate: number; punctualityRate: number; openWarnings: number };
}
interface TrendPoint { date: string; present: number; late: number; absent: number; vacation: number; }
interface DeptStat { department: string; total: number; active: number; }
interface EmployeeOfMonth { id: number; name: string; photoUrl?: string; position?: string; department?: string; score: number; label: string; }
interface RankingEntry { worker: { id: number; name: string; position?: string; department?: string }; score: number; label: string; attendanceRate: number; }
interface TodayEntry { worker: { id: number; name: string; position?: string; department?: string; photoUrl?: string }; attendance: { id: number; status: string; checkIn?: string; } | null; }
interface SalaryStats { base: number; bonuses: number; deductions: number; advance: number; overtime: number; net: number; count: number; }
interface PendingRequest { id: number; workerId: number; type: string; title: string; description?: string; startDate?: string; endDate?: string; amount?: string; createdAt: string; workerName: string; workerPhoto?: string; workerPosition?: string; }
interface CalendarEvent { date: string; type: string; label: string; workerName: string; workerId: number; }

const TABS = [
  { id: "dashboard", label: "Dashboard",   icon: BarChart3 },
  { id: "today",     label: "Présence",    icon: UserCheck },
  { id: "calendar",  label: "Calendrier",  icon: CalendarDays },
  { id: "requests",  label: "Demandes",    icon: ClipboardList },
  { id: "ranking",   label: "Classement",  icon: Trophy },
  { id: "analyses",  label: "Analyses IA", icon: BrainCircuit },
  { id: "report",    label: "Rapport",     icon: TrendingUp },
];

const STATUS_OPTIONS = [
  { value: "present",  label: "Présent",       color: "bg-emerald-500" },
  { value: "late",     label: "Retard",        color: "bg-amber-500" },
  { value: "absent",   label: "Absent",        color: "bg-red-500" },
  { value: "vacation", label: "Congé",         color: "bg-blue-500" },
  { value: "sick",     label: "Malade",        color: "bg-purple-500" },
  { value: "half_day", label: "Demi-journée",  color: "bg-orange-400" },
];

const EVENT_COLORS: Record<string, string> = {
  absent:          "bg-red-100 text-red-700 border-red-200",
  vacation:        "bg-blue-100 text-blue-700 border-blue-200",
  sick:            "bg-purple-100 text-purple-700 border-purple-200",
  birthday:        "bg-pink-100 text-pink-700 border-pink-200",
  anniversary:     "bg-amber-100 text-amber-700 border-amber-200",
  request_conge:   "bg-blue-100 text-blue-700 border-blue-200",
  request_maladie: "bg-purple-100 text-purple-700 border-purple-200",
  default:         "bg-gray-100 text-gray-700 border-gray-200",
};

const CHART_COLORS = ["#10b981", "#f59e0b", "#ef4444", "#6366f1", "#8b5cf6"];

function fmt(n: number) { return n.toLocaleString("fr-FR") + " DA"; }

const REQUEST_TYPE_LABELS: Record<string, string> = {
  conge: "🏖️ Congé", maladie: "🏥 Maladie", avance: "💰 Avance",
  changement_horaire: "🔄 Changement dossier", autre: "📋 Autre",
};

export default function WorkersHR() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("dashboard");
  const now = new Date();
  const [calYear, setCalYear]   = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth() + 1);
  const [reportYear, setReportYear]   = useState(now.getFullYear());
  const [reportMonth, setReportMonth] = useState(now.getMonth() + 1);
  const [bulkStatus, setBulkStatus] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [responding, setResponding] = useState<{ id: number; workerId: number; action: "approved" | "rejected" } | null>(null);

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: stats } = useQuery<HRStats>({
    queryKey: ["hr-stats"],
    queryFn: async () => { const r = await fetch("/api/workers/hr-stats", { headers: AUTH() }); return r.json(); },
    staleTime: 60_000, refetchInterval: 120_000,
  });

  const { data: trendData = [] } = useQuery<TrendPoint[]>({
    queryKey: ["attendance-trend"],
    queryFn: async () => { const r = await fetch("/api/workers/attendance-trend", { headers: AUTH() }); return r.json(); },
    staleTime: 300_000,
    enabled: activeTab === "dashboard",
  });

  const { data: deptStats = [] } = useQuery<DeptStat[]>({
    queryKey: ["department-stats"],
    queryFn: async () => { const r = await fetch("/api/workers/department-stats", { headers: AUTH() }); return r.json(); },
    staleTime: 300_000,
    enabled: activeTab === "dashboard",
  });

  const { data: employeeOfMonth } = useQuery<EmployeeOfMonth | null>({
    queryKey: ["employee-of-month"],
    queryFn: async () => { const r = await fetch("/api/workers/employee-of-month", { headers: AUTH() }); return r.json(); },
    staleTime: 3_600_000,
    enabled: activeTab === "dashboard",
  });

  const { data: salaryStats } = useQuery<SalaryStats>({
    queryKey: ["salary-stats"],
    queryFn: async () => { const r = await fetch("/api/workers/salary-stats", { headers: AUTH() }); return r.json(); },
    staleTime: 300_000,
    enabled: activeTab === "dashboard",
  });

  const { data: todayAttendance = [], isLoading: todayLoading } = useQuery<TodayEntry[]>({
    queryKey: ["attendance-today"],
    queryFn: async () => { const r = await fetch("/api/workers/attendance-today", { headers: AUTH() }); return r.json(); },
    staleTime: 30_000,
    enabled: activeTab === "today",
  });

  const { data: calendarEvents = [], isLoading: calLoading } = useQuery<CalendarEvent[]>({
    queryKey: ["calendar-events", calYear, calMonth],
    queryFn: async () => {
      const r = await fetch(`/api/workers/calendar-events?month=${calYear}-${String(calMonth).padStart(2, "0")}`, { headers: AUTH() });
      return r.json();
    },
    staleTime: 120_000,
    enabled: activeTab === "calendar",
  });

  const { data: pendingRequests = [], isLoading: reqLoading } = useQuery<PendingRequest[]>({
    queryKey: ["hr-pending-requests"],
    queryFn: async () => { const r = await fetch("/api/workers/requests-pending", { headers: AUTH() }); return r.json(); },
    staleTime: 30_000,
    enabled: activeTab === "requests",
  });

  const { data: ranking = [], isLoading: rankLoading } = useQuery<RankingEntry[]>({
    queryKey: ["hr-ranking"],
    queryFn: async () => { const r = await fetch("/api/workers/ranking", { headers: AUTH() }); return r.json(); },
    staleTime: 120_000,
    enabled: activeTab === "ranking" || activeTab === "analyses",
  });

  const { data: report = [], isLoading: reportLoading } = useQuery<any[]>({
    queryKey: ["hr-report", reportYear, reportMonth],
    queryFn: async () => {
      const r = await fetch(`/api/workers/hr-report?year=${reportYear}&month=${reportMonth}`, { headers: AUTH() });
      const d = await r.json();
      return d.workers ?? [];
    },
    staleTime: 120_000,
    enabled: activeTab === "report",
  });

  const { data: analysesWorkers = [] } = useQuery<any[]>({
    queryKey: ["analyses-workers"],
    queryFn: async () => {
      const r = await fetch(`/api/workers/hr-report?year=${now.getFullYear()}&month=${now.getMonth() + 1}`, { headers: AUTH() });
      const d = await r.json();
      return d.workers ?? [];
    },
    staleTime: 300_000,
    enabled: activeTab === "analyses",
  });

  // ── Derived ────────────────────────────────────────────────────────────────
  const filteredToday = useMemo(() => {
    return todayAttendance.filter(e => {
      const q = searchQuery.toLowerCase();
      const nameMatch = !q || e.worker.name.toLowerCase().includes(q);
      const deptMatch = deptFilter === "all" || e.worker.department === deptFilter;
      return nameMatch && deptMatch;
    });
  }, [todayAttendance, searchQuery, deptFilter]);

  const departments = useMemo(() => {
    const ds = new Set(todayAttendance.map(e => e.worker.department).filter(Boolean));
    return Array.from(ds) as string[];
  }, [todayAttendance]);

  const topAbsent = useMemo(() => [...analysesWorkers].sort((a, b) => (b.absent ?? 0) - (a.absent ?? 0)).slice(0, 5), [analysesWorkers]);
  const topPresent = useMemo(() => [...ranking].slice(0, 5), [ranking]);
  const deptAbsences = useMemo(() => {
    const map: Record<string, number> = {};
    analysesWorkers.forEach((w: any) => {
      const d = w.worker?.department ?? "Non défini";
      map[d] = (map[d] ?? 0) + (w.absent ?? 0);
    });
    return Object.entries(map).map(([dept, absences]) => ({ dept, absences })).sort((a, b) => b.absences - a.absences).slice(0, 6);
  }, [analysesWorkers]);

  // ── Calendar grid ──────────────────────────────────────────────────────────
  const calMonthLabel = new Date(calYear, calMonth - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const firstDay  = new Date(calYear, calMonth - 1, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth, 0).getDate();
  const calStart  = firstDay === 0 ? 6 : firstDay - 1;
  const calCells: (number | null)[] = [
    ...Array(calStart).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const eventsByDay = useMemo(() => {
    const map: Record<number, CalendarEvent[]> = {};
    calendarEvents.forEach(e => {
      const day = parseInt(e.date.split("-")[2]);
      if (!map[day]) map[day] = [];
      map[day].push(e);
    });
    return map;
  }, [calendarEvents]);

  // ── Actions ────────────────────────────────────────────────────────────────
  async function saveBulk() {
    const entries = Object.entries(bulkStatus);
    if (entries.length === 0) { toast({ title: "Aucune modification", variant: "destructive" }); return; }
    setSubmitting(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      const r = await fetch("/api/workers/attendance-bulk", {
        method: "POST", headers: AUTHJSON(),
        body: JSON.stringify({ date: today, entries: entries.map(([workerId, status]) => ({ workerId: parseInt(workerId), status })) }),
      });
      if (!r.ok) throw new Error("Erreur serveur");
      toast({ title: `✓ ${entries.length} présence(s) enregistrée(s)` });
      setBulkStatus({});
      qc.invalidateQueries({ queryKey: ["attendance-today"] });
      qc.invalidateQueries({ queryKey: ["hr-stats"] });
      qc.invalidateQueries({ queryKey: ["attendance-trend"] });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally { setSubmitting(false); }
  }

  async function respondToRequest(req: PendingRequest, status: "approved" | "rejected") {
    setResponding({ id: req.id, workerId: req.workerId, action: status });
    try {
      const r = await fetch(`/api/workers/${req.workerId}/requests/${req.id}`, {
        method: "PATCH", headers: AUTHJSON(),
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error("Erreur");
      toast({ title: status === "approved" ? "✓ Demande approuvée" : "Demande refusée" });
      qc.invalidateQueries({ queryKey: ["hr-pending-requests"] });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally { setResponding(null); }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />Gestion RH
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Module de gestion des ressources humaines</p>
        </div>
        {stats && (
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="gap-1.5">
              <div className="h-2 w-2 bg-emerald-500 rounded-full animate-pulse" />
              {(stats.today?.present ?? 0) + (stats.today?.late ?? 0)} présent{(stats.today?.present ?? 0) + (stats.today?.late ?? 0) > 1 ? "s" : ""} aujourd'hui
            </Badge>
            {(stats.monthly?.openWarnings ?? 0) > 0 && (
              <Badge className="bg-amber-100 text-amber-700 gap-1.5 hover:bg-amber-100">
                <AlertTriangle className="h-3 w-3" />{stats.monthly?.openWarnings} avert. ouverts
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex overflow-x-auto gap-1 pb-1 -mx-1 px-1">
        {TABS.map(t => {
          const Icon = t.icon;
          const isActive = activeTab === t.id;
          const badge = t.id === "requests" && pendingRequests.length > 0 ? pendingRequests.length : null;
          return (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all shrink-0 relative
                ${isActive ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
              <Icon className="h-4 w-4" />{t.label}
              {badge && (
                <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full h-4 w-4 flex items-center justify-center">{badge}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── DASHBOARD ─────────────────────────────────────────────────────── */}
      {activeTab === "dashboard" && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: "Présents", value: stats?.today?.present ?? "—", icon: UserCheck,   color: "text-emerald-600", bg: "bg-emerald-50",  border: "border-emerald-200" },
              { label: "Retards",  value: stats?.today?.late ?? "—",    icon: Clock,        color: "text-amber-600",   bg: "bg-amber-50",    border: "border-amber-200" },
              { label: "Absents",  value: stats?.today?.absent ?? "—",  icon: UserX,        color: "text-red-600",     bg: "bg-red-50",      border: "border-red-200" },
              { label: "Malades",  value: stats?.today?.sick ?? "—",    icon: Stethoscope,  color: "text-purple-600",  bg: "bg-purple-50",   border: "border-purple-200" },
              { label: "Congés",   value: stats?.today?.vacation ?? "—", icon: Palmtree,    color: "text-blue-600",    bg: "bg-blue-50",     border: "border-blue-200" },
              { label: "Actifs",   value: stats?.totalActive ?? "—",   icon: Users,        color: "text-primary",     bg: "bg-primary/5",   border: "border-primary/20" },
            ].map(k => (
              <Card key={k.label} className={`${k.bg} ${k.border} border`}>
                <CardContent className="p-4 flex flex-col items-center text-center">
                  <k.icon className={`h-5 w-5 mb-2 ${k.color}`} />
                  <span className={`text-2xl font-bold ${k.color}`}>{k.value}</span>
                  <span className="text-[11px] text-muted-foreground mt-0.5">{k.label}</span>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid lg:grid-cols-3 gap-5">
            {/* Trend chart */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />Présence — 30 derniers jours
                </CardTitle>
              </CardHeader>
              <CardContent>
                {trendData.length === 0 ? (
                  <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />Chargement…
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={trendData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
                      <defs>
                        <linearGradient id="presentGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="absentGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip formatter={(v: any, n: string) => [v, n === "present" ? "Présents" : n === "absent" ? "Absents" : n === "late" ? "Retards" : "Congés"]}
                        labelFormatter={l => new Date(l).toLocaleDateString("fr-FR")} />
                      <Area type="monotone" dataKey="present" stroke="#10b981" fill="url(#presentGrad)" strokeWidth={2} />
                      <Area type="monotone" dataKey="late"    stroke="#f59e0b" fill="none" strokeWidth={1.5} strokeDasharray="4 2" />
                      <Area type="monotone" dataKey="absent"  stroke="#ef4444" fill="url(#absentGrad)" strokeWidth={1.5} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Employee of month */}
            <Card className="bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2 text-amber-800">
                  <Award className="h-4 w-4 text-amber-600" />Employé du mois
                </CardTitle>
              </CardHeader>
              <CardContent>
                {employeeOfMonth ? (
                  <div className="text-center">
                    <div className="relative inline-block mb-3">
                      {employeeOfMonth.photoUrl ? (
                        <img src={employeeOfMonth.photoUrl} alt={employeeOfMonth.name}
                          className="h-20 w-20 rounded-full object-cover mx-auto ring-4 ring-amber-300 shadow-md" />
                      ) : (
                        <div className="h-20 w-20 rounded-full bg-gradient-to-br from-amber-400 to-orange-400 mx-auto ring-4 ring-amber-300 flex items-center justify-center text-2xl font-bold text-white shadow-md">
                          {employeeOfMonth.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="absolute -bottom-1 -right-1 h-7 w-7 bg-amber-400 rounded-full flex items-center justify-center shadow">
                        <Trophy className="h-4 w-4 text-white" />
                      </div>
                    </div>
                    <p className="font-bold text-base text-amber-900">{employeeOfMonth.name}</p>
                    <p className="text-xs text-amber-700 mb-3">{employeeOfMonth.position ?? "—"}</p>
                    <div className="bg-amber-100 rounded-lg p-2 flex items-center justify-center gap-1">
                      <Star className="h-4 w-4 text-amber-500 fill-amber-400" />
                      <span className="text-lg font-bold text-amber-700">{employeeOfMonth.score}</span>
                      <span className="text-xs text-amber-600">/100</span>
                    </div>
                    <p className="text-xs text-amber-700 mt-1.5 font-medium">{employeeOfMonth.label}</p>
                    <Link href={`/workers/${employeeOfMonth.id}`}>
                      <Button size="sm" variant="outline" className="mt-3 h-7 text-xs border-amber-300 text-amber-800 hover:bg-amber-50">Voir la fiche</Button>
                    </Link>
                  </div>
                ) : (
                  <div className="text-center py-8 text-amber-700/60">
                    <Trophy className="h-10 w-10 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Aucun employé actif</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            {/* Department chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-primary" />Répartition par département
                </CardTitle>
              </CardHeader>
              <CardContent>
                {deptStats.length === 0 ? (
                  <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">Aucune donnée</div>
                ) : (
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={deptStats.slice(0, 8)} margin={{ top: 5, right: 5, bottom: 30, left: -15 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="department" tick={{ fontSize: 9 }} angle={-20} textAnchor="end" interval={0} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Bar dataKey="active" fill="#6366f1" radius={[4, 4, 0, 0]} name="Actifs" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Salary & KPI recap */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-primary" />Récap mensuel
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {salaryStats && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: "Masse salariale",  value: salaryStats.base,       color: "text-emerald-600" },
                        { label: "Total primes",      value: salaryStats.bonuses,    color: "text-blue-600" },
                        { label: "Total retenues",    value: salaryStats.deductions, color: "text-red-600" },
                        { label: "Net total",         value: salaryStats.net,        color: "text-primary" },
                      ].map(s => (
                        <div key={s.label} className="bg-muted/40 rounded-lg p-3">
                          <p className="text-[10px] text-muted-foreground">{s.label}</p>
                          <p className={`text-sm font-bold mt-0.5 ${s.color}`}>{fmt(s.value)}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground text-center">{salaryStats.count} fiche(s) de paie ce mois</p>
                  </>
                )}
                <div className="space-y-2 pt-2 border-t">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Taux de présence</span>
                    <span className="font-semibold text-emerald-600">{stats?.monthly?.attendanceRate ?? 0}%</span>
                  </div>
                  <Progress value={stats?.monthly?.attendanceRate ?? 0} className="h-2" />
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Taux de ponctualité</span>
                    <span className="font-semibold text-blue-600">{stats?.monthly?.punctualityRate ?? 0}%</span>
                  </div>
                  <Progress value={stats?.monthly?.punctualityRate ?? 0} className="h-2 [&>div]:bg-blue-500" />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ── TODAY ATTENDANCE ──────────────────────────────────────────────── */}
      {activeTab === "today" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <div className="flex gap-2 flex-1 max-w-md">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input className="pl-8 h-8 text-sm" placeholder="Rechercher…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
              </div>
              {departments.length > 0 && (
                <Select value={deptFilter} onValueChange={setDeptFilter}>
                  <SelectTrigger className="h-8 w-40 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les dept.</SelectItem>
                    {departments.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{Object.keys(bulkStatus).length} modif.</span>
              <Button size="sm" onClick={saveBulk} disabled={submitting || Object.keys(bulkStatus).length === 0}>
                {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Check className="h-3.5 w-3.5 mr-1.5" />}
                Enregistrer
              </Button>
            </div>
          </div>

          {todayLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="grid gap-2">
              {filteredToday.map(entry => {
                const current = bulkStatus[entry.worker.id] ?? entry.attendance?.status ?? "absent";
                const opt = STATUS_OPTIONS.find(s => s.value === current);
                return (
                  <Card key={entry.worker.id} className="hover:shadow-sm transition-shadow">
                    <CardContent className="p-3 flex items-center gap-3">
                      {entry.worker.photoUrl ? (
                        <img src={entry.worker.photoUrl} alt={entry.worker.name} className="h-9 w-9 rounded-full object-cover ring-2 ring-border shrink-0" />
                      ) : (
                        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                          {entry.worker.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <Link href={`/workers/${entry.worker.id}`}>
                          <p className="text-sm font-medium hover:text-primary cursor-pointer truncate">{entry.worker.name}</p>
                        </Link>
                        <p className="text-[11px] text-muted-foreground truncate">{entry.worker.position ?? entry.worker.department ?? "—"}</p>
                      </div>
                      <Select value={current} onValueChange={v => setBulkStatus(prev => ({ ...prev, [entry.worker.id]: v }))}>
                        <SelectTrigger className="h-7 w-36 text-xs">
                          <div className="flex items-center gap-1.5">
                            <div className={`h-2 w-2 rounded-full shrink-0 ${opt?.color ?? "bg-gray-400"}`} />
                            <SelectValue />
                          </div>
                        </SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS.map(s => (
                            <SelectItem key={s.value} value={s.value}>
                              <div className="flex items-center gap-2">
                                <div className={`h-2.5 w-2.5 rounded-full ${s.color}`} />
                                {s.label}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </CardContent>
                  </Card>
                );
              })}
              {filteredToday.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <Users className="h-10 w-10 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">Aucun employé trouvé</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── CALENDAR ──────────────────────────────────────────────────────── */}
      {activeTab === "calendar" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => { if (calMonth === 1) { setCalYear(y => y - 1); setCalMonth(12); } else setCalMonth(m => m - 1); }}
              className="h-8 w-8 flex items-center justify-center rounded-lg border hover:bg-muted transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <h2 className="text-sm font-semibold capitalize">{calMonthLabel}</h2>
            <button
              onClick={() => { if (calMonth === 12) { setCalYear(y => y + 1); setCalMonth(1); } else setCalMonth(m => m + 1); }}
              className="h-8 w-8 flex items-center justify-center rounded-lg border hover:bg-muted transition-colors">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <Card>
            <CardContent className="p-3 sm:p-4">
              <div className="grid grid-cols-7 gap-1 mb-2">
                {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map(d => (
                  <div key={d} className="text-center text-[11px] font-semibold text-muted-foreground py-1">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {calCells.map((day, i) => {
                  if (!day) return <div key={`e-${i}`} />;
                  const evts = eventsByDay[day] ?? [];
                  const todayStr = `${calYear}-${String(calMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const isToday = todayStr === new Date().toISOString().split("T")[0];
                  return (
                    <div key={day} className={`min-h-[70px] rounded-lg p-1 border transition-colors ${isToday ? "border-primary/50 bg-primary/5" : "border-transparent hover:border-border"}`}>
                      <div className={`text-[11px] font-semibold text-right mb-1 ${isToday ? "text-primary" : "text-muted-foreground"}`}>{day}</div>
                      <div className="space-y-0.5">
                        {evts.slice(0, 3).map((e, j) => {
                          const cls = EVENT_COLORS[e.type] ?? EVENT_COLORS.default;
                          return (
                            <div key={j} className={`text-[9px] px-1 py-0.5 rounded truncate border ${cls}`} title={`${e.workerName} — ${e.label}`}>
                              {e.workerName.split(" ")[0]}
                            </div>
                          );
                        })}
                        {evts.length > 3 && <div className="text-[9px] text-muted-foreground pl-1">+{evts.length - 3}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Legend */}
          <Card>
            <CardContent className="p-3 flex flex-wrap gap-3 text-xs">
              {[
                { type: "absent",      label: "Absence" },
                { type: "vacation",    label: "Congé" },
                { type: "sick",        label: "Maladie" },
                { type: "birthday",    label: "Anniversaire" },
                { type: "anniversary", label: "Anniv. embauche" },
              ].map(l => {
                const cls = EVENT_COLORS[l.type];
                return (
                  <div key={l.type} className={`flex items-center gap-1 px-2 py-0.5 rounded border ${cls}`}>
                    <div className="h-2 w-2 rounded-full bg-current opacity-60" />
                    {l.label}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Event list */}
          {calLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : calendarEvents.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Événements de {calMonthLabel}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y max-h-64 overflow-y-auto">
                  {calendarEvents.map((e, i) => {
                    const cls = EVENT_COLORS[e.type] ?? EVENT_COLORS.default;
                    return (
                      <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${cls} shrink-0`}>
                          {new Date(e.date + "T00:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                        </span>
                        <span className="text-sm truncate">{e.workerName}</span>
                        <span className="text-xs text-muted-foreground ml-auto shrink-0">{e.label}</span>
                        <Link href={`/workers/${e.workerId}`}>
                          <Button variant="ghost" size="sm" className="h-6 text-xs px-2 shrink-0">Voir</Button>
                        </Link>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-dashed">
              <CardContent className="py-10 text-center text-muted-foreground">
                <CalendarDays className="h-10 w-10 mx-auto mb-2 opacity-20" />
                <p className="text-sm">Aucun événement ce mois-ci</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── REQUESTS ──────────────────────────────────────────────────────── */}
      {activeTab === "requests" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Demandes en attente</h2>
            {pendingRequests.length > 0 && (
              <Badge className="bg-red-100 text-red-700 hover:bg-red-100">{pendingRequests.length} en attente</Badge>
            )}
          </div>
          {reqLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : pendingRequests.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-14 text-center text-muted-foreground">
                <ClipboardList className="h-10 w-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm font-medium">Aucune demande en attente</p>
                <p className="text-xs mt-1">Toutes les demandes ont été traitées.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {pendingRequests.map(req => (
                <Card key={req.id} className="border-amber-200 bg-amber-50/20">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3 flex-wrap sm:flex-nowrap">
                      {req.workerPhoto ? (
                        <img src={req.workerPhoto} alt={req.workerName} className="h-10 w-10 rounded-full object-cover ring-2 ring-border shrink-0" />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                          {req.workerName.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-medium text-sm">{req.workerName}</span>
                          <Badge variant="outline" className="text-[10px]">{REQUEST_TYPE_LABELS[req.type] ?? req.type}</Badge>
                        </div>
                        <p className="text-sm mb-0.5">{req.title}</p>
                        {req.description && <p className="text-xs text-muted-foreground mb-0.5">{req.description}</p>}
                        <div className="flex gap-3 text-[10px] text-muted-foreground flex-wrap">
                          {req.startDate && <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />{new Date(req.startDate + "T00:00:00").toLocaleDateString("fr-FR")}</span>}
                          {req.amount && <span>💰 {parseFloat(req.amount).toLocaleString("fr-FR")} DA</span>}
                          <span>Soumis le {new Date(req.createdAt).toLocaleDateString("fr-FR")}</span>
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0 flex-wrap">
                        <Button size="sm" className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                          onClick={() => respondToRequest(req, "approved")}
                          disabled={responding?.id === req.id}>
                          {responding?.id === req.id && responding.action === "approved" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                          Approuver
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-red-600 border-red-200 hover:bg-red-50"
                          onClick={() => respondToRequest(req, "rejected")}
                          disabled={responding?.id === req.id}>
                          {responding?.id === req.id && responding.action === "rejected" ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                          Refuser
                        </Button>
                        <Link href={`/workers/${req.workerId}`}>
                          <Button size="sm" variant="ghost" className="h-7 text-xs">Fiche</Button>
                        </Link>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── RANKING ───────────────────────────────────────────────────────── */}
      {activeTab === "ranking" && (
        <div className="space-y-4">
          {rankLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : ranking.length === 0 ? (
            <Card className="border-dashed"><CardContent className="py-14 text-center text-muted-foreground"><Trophy className="h-10 w-10 mx-auto mb-3 opacity-20" /><p className="text-sm">Aucune donnée disponible</p></CardContent></Card>
          ) : (
            <>
              <div className="grid lg:grid-cols-2 gap-5">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Score de performance</CardTitle></CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={ranking.slice(0, 10)} layout="vertical" margin={{ top: 0, right: 10, bottom: 0, left: -10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} />
                        <YAxis type="category" dataKey="worker.name" tick={{ fontSize: 10 }} width={90} />
                        <Tooltip formatter={(v: any) => [`${v}/100`, "Score"]} />
                        <Bar dataKey="score" radius={[0, 4, 4, 0]}>
                          {ranking.slice(0, 10).map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[Math.min(Math.floor(i / 2), CHART_COLORS.length - 1)]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Podium du mois</CardTitle></CardHeader>
                  <CardContent>
                    <div className="flex items-end justify-center gap-3 pt-4">
                      {[1, 0, 2].map(rank => {
                        const e = ranking[rank];
                        if (!e) return <div key={rank} className="w-20" />;
                        const heights = [28, 36, 22];
                        const colors = ["bg-gray-300", "bg-amber-400", "bg-amber-600"];
                        const medals = ["🥈", "🥇", "🥉"];
                        return (
                          <div key={rank} className="flex flex-col items-center gap-2">
                            <span className="text-2xl">{medals[rank]}</span>
                            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                              {e.worker.name.charAt(0).toUpperCase()}
                            </div>
                            <p className="text-xs font-medium text-center w-20 truncate">{e.worker.name}</p>
                            <p className="text-[10px] text-muted-foreground">{e.score}/100</p>
                            <div className={`w-20 ${colors[rank]} rounded-t-lg`} style={{ height: `${heights[rank] * 3}px` }} />
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              </div>
              <Card>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {ranking.map((e, i) => (
                      <div key={e.worker.id} className={`flex items-center gap-3 px-4 py-3 ${i < 3 ? "bg-amber-50/30" : ""}`}>
                        <span className="text-sm font-bold text-muted-foreground w-6 shrink-0">
                          {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{e.worker.name}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{e.worker.position ?? e.worker.department ?? "—"}</p>
                        </div>
                        <div className="text-right mr-4 hidden sm:block">
                          <p className="text-xs text-muted-foreground">Présence</p>
                          <p className="text-sm font-semibold">{e.attendanceRate}%</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Progress value={e.score} className="h-2 w-20 hidden sm:block" />
                          <span className="text-sm font-bold text-primary w-14 text-right">{e.score}/100</span>
                        </div>
                        <Badge variant="outline" className="text-[10px] hidden sm:flex">{e.label}</Badge>
                        <Link href={`/workers/${e.worker.id}`}>
                          <Button variant="ghost" size="sm" className="h-7 text-xs">Voir</Button>
                        </Link>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}

      {/* ── ANALYSES ──────────────────────────────────────────────────────── */}
      {activeTab === "analyses" && (
        <div className="space-y-5">
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-primary" />
            <h2 className="text-sm font-semibold">Analyse intelligente des RH</h2>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold text-red-700 uppercase tracking-wider flex items-center gap-1.5">
                  <Flame className="h-3.5 w-3.5" />Plus d'absences
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {topAbsent.length === 0 ? (
                    <div className="px-4 py-6 text-center text-muted-foreground text-xs">Aucune donnée</div>
                  ) : topAbsent.map((w: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="text-sm font-bold text-red-400 w-4">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{w.worker?.name ?? "—"}</p>
                        <p className="text-[10px] text-muted-foreground">{w.absent ?? 0} absence(s)</p>
                      </div>
                      <Link href={`/workers/${w.worker?.id}`}><Button variant="ghost" size="sm" className="h-6 text-xs px-2">→</Button></Link>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold text-emerald-700 uppercase tracking-wider flex items-center gap-1.5">
                  <Star className="h-3.5 w-3.5" />Meilleurs employés
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {topPresent.length === 0 ? (
                    <div className="px-4 py-6 text-center text-muted-foreground text-xs">Aucune donnée</div>
                  ) : topPresent.map((e, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="text-sm">{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{e.worker.name}</p>
                        <p className="text-[10px] text-muted-foreground">{e.score}/100 — {e.label}</p>
                      </div>
                      <Link href={`/workers/${e.worker.id}`}><Button variant="ghost" size="sm" className="h-6 text-xs px-2">→</Button></Link>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold text-orange-700 uppercase tracking-wider flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5" />Absences / Département
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {deptAbsences.length === 0 ? (
                    <div className="px-4 py-6 text-center text-muted-foreground text-xs">Aucune donnée</div>
                  ) : deptAbsences.map((d, i) => (
                    <div key={i} className="px-4 py-2.5">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-medium truncate max-w-[140px]">{d.dept}</span>
                        <span className="text-muted-foreground shrink-0 ml-2">{d.absences}</span>
                      </div>
                      <Progress value={deptAbsences[0]?.absences ? (d.absences / deptAbsences[0].absences) * 100 : 0} className="h-1.5 [&>div]:bg-orange-400" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* AI Suggestions */}
          <Card className="bg-gradient-to-br from-primary/5 to-blue-50 border-primary/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <BrainCircuit className="h-4 w-4 text-primary" />Suggestions d'amélioration
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2.5">
                {[
                  (stats?.monthly?.attendanceRate ?? 100) < 80 ? { icon: "⚠️", text: `Taux de présence bas (${stats?.monthly?.attendanceRate ?? 0}%). Envisagez des entretiens individuels.` } : null,
                  (stats?.monthly?.openWarnings ?? 0) > 3 ? { icon: "🔔", text: `${stats?.monthly?.openWarnings} avertissements ouverts. Planifiez des réunions disciplinaires.` } : null,
                  (stats?.monthly?.punctualityRate ?? 100) < 85 ? { icon: "⏰", text: `Ponctualité à ${stats?.monthly?.punctualityRate ?? 0}%. Revoyez les horaires ou proposez plus de flexibilité.` } : null,
                  topAbsent.length > 0 && topAbsent[0]?.absent > 4 ? { icon: "📋", text: `${topAbsent[0]?.worker?.name} a ${topAbsent[0]?.absent} absences ce mois. Un suivi RH est recommandé.` } : null,
                  deptAbsences.length > 0 && deptAbsences[0]?.absences > 3 ? { icon: "🏢", text: `Le département "${deptAbsences[0].dept}" enregistre le plus d'absences (${deptAbsences[0].absences}). Investiguer les causes.` } : null,
                  { icon: "✅", text: "Continuez à enregistrer les présences quotidiennement pour des analyses plus précises et des rapports complets." },
                ].filter(Boolean).map((s: any, i) => (
                  <div key={i} className="flex items-start gap-2.5 p-3 bg-white/70 rounded-lg border border-primary/10">
                    <span className="text-lg shrink-0">{s.icon}</span>
                    <p className="text-sm text-foreground/80">{s.text}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── REPORT ────────────────────────────────────────────────────────── */}
      {activeTab === "report" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" className="h-8 w-8"
                onClick={() => { if (reportMonth === 1) { setReportYear(y => y - 1); setReportMonth(12); } else setReportMonth(m => m - 1); }}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-medium capitalize min-w-[130px] text-center">
                {new Date(reportYear, reportMonth - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}
              </span>
              <Button variant="outline" size="icon" className="h-8 w-8"
                onClick={() => { if (reportMonth === 12) { setReportYear(y => y + 1); setReportMonth(1); } else setReportMonth(m => m + 1); }}
                disabled={reportYear === now.getFullYear() && reportMonth === now.getMonth() + 1}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5 ml-auto" onClick={() => window.print()}>
              <Download className="h-3.5 w-3.5" />Imprimer / PDF
            </Button>
          </div>

          {reportLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      {["Employé", "Présents", "Retards", "Absents", "Congés", "Malades", "Taux", "Score", "Primes", "Avert."].map(h => (
                        <th key={h} className={`py-3 font-semibold ${h === "Employé" ? "text-left px-4" : "text-center px-3"}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {report.map((r: any) => (
                      <tr key={r.worker?.id ?? r.name} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5">
                          <Link href={`/workers/${r.worker?.id}`}>
                            <span className="font-medium hover:text-primary cursor-pointer">{r.worker?.name ?? r.name}</span>
                          </Link>
                          <p className="text-[10px] text-muted-foreground">{r.worker?.department ?? "—"}</p>
                        </td>
                        <td className="px-3 py-2.5 text-center font-medium text-emerald-600">{r.present ?? 0}</td>
                        <td className="px-3 py-2.5 text-center font-medium text-amber-600">{r.late ?? 0}</td>
                        <td className="px-3 py-2.5 text-center font-medium text-red-600">{r.absent ?? 0}</td>
                        <td className="px-3 py-2.5 text-center font-medium text-blue-600">{r.vacation ?? 0}</td>
                        <td className="px-3 py-2.5 text-center font-medium text-purple-600">{r.sick ?? 0}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`font-semibold ${(r.attendanceRate ?? 0) >= 90 ? "text-emerald-600" : (r.attendanceRate ?? 0) >= 70 ? "text-amber-600" : "text-red-600"}`}>
                            {r.attendanceRate ?? 0}%
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center font-semibold text-primary">{r.performanceScore ?? 0}</td>
                        <td className="px-3 py-2.5 text-center font-medium text-blue-600">{r.bonusesCount ?? 0}</td>
                        <td className="px-3 py-2.5 text-center font-medium text-orange-600">{r.warningsCount ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {report.length === 0 && (
                  <div className="py-12 text-center text-muted-foreground text-sm">
                    <ClipboardList className="h-8 w-8 mx-auto mb-2 opacity-20" />
                    Aucun rapport disponible pour ce mois.
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
