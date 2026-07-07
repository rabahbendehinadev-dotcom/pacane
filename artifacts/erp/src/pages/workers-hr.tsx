import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  Users, UserCheck, UserX, CalendarCheck, Clock, AlertTriangle,
  Gift, Trophy, TrendingUp, Loader2, ChevronLeft, ChevronRight,
  HardHat, BarChart2,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";

const AUTH = () => ({ Authorization: `Bearer ${localStorage.getItem("erp_token")}` });
const AUTHJSON = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` });

interface HRStats {
  totalWorkers: number;
  activeWorkers: number;
  inactiveWorkers: number;
  today: { present: number; late: number; absent: number; vacation: number; halfDay: number; notRecorded: number };
  openWarnings: number;
  monthlyBonusTotal: number;
  monthlyAttRate: number;
  monthlyPunctRate: number;
}

interface RankedWorker {
  id: number;
  name: string;
  photoUrl: string | null;
  position: string | null;
  department: string | null;
  score: number;
  label: string;
  attendanceRate: number;
  punctualityRate: number;
  warningsLast90: number;
  bonusesLast90: number;
}

interface TodayWorker {
  id: number;
  name: string;
  photoUrl: string | null;
  position: string | null;
  today: { id: number; status: string; checkIn: string | null; checkOut: string | null } | null;
}

interface ReportWorker {
  id: number;
  name: string;
  position: string | null;
  present: number;
  late: number;
  absent: number;
  vacation: number;
  sick: number;
  halfDay: number;
  total: number;
  attRate: number | null;
  warnings: number;
  bonusTotal: number;
}

interface Report {
  month: string;
  workers: ReportWorker[];
}

const ATTENDANCE_STATUS_LABELS: Record<string, { label: string; color: string; dot: string }> = {
  present:  { label: "Présent",        color: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500" },
  late:     { label: "En retard",      color: "bg-amber-100 text-amber-700",    dot: "bg-amber-500" },
  absent:   { label: "Absent",         color: "bg-red-100 text-red-700",        dot: "bg-red-500" },
  vacation: { label: "Congé",          color: "bg-blue-100 text-blue-700",      dot: "bg-blue-500" },
  sick:     { label: "Congé maladie",  color: "bg-purple-100 text-purple-700",  dot: "bg-purple-500" },
  half_day: { label: "Demi-journée",   color: "bg-orange-100 text-orange-700",  dot: "bg-orange-500" },
};

function getInitials(name: string) {
  return name.split(" ").filter(Boolean).map(n => n[0]).join("").toUpperCase().slice(0, 2) || "?";
}

function getScoreColor(score: number) {
  if (score >= 85) return "text-emerald-600";
  if (score >= 70) return "text-blue-600";
  if (score >= 55) return "text-amber-600";
  if (score >= 40) return "text-orange-600";
  return "text-red-600";
}

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => {
  const d = new Date();
  d.setMonth(d.getMonth() - i);
  const val = d.toISOString().slice(0, 7);
  const label = d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return { value: val, label };
});

const PIE_COLORS = ["#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#8b5cf6", "#94a3b8"];

export default function WorkersHRPage() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<"dashboard" | "today" | "ranking" | "report">("dashboard");
  const [reportMonth, setReportMonth] = useState(MONTH_OPTIONS[0].value);
  const [savingBulk, setSavingBulk] = useState(false);
  const [bulkStatuses, setBulkStatuses] = useState<Record<number, string>>({});

  const { data: stats, isLoading: statsLoading } = useQuery<HRStats>({
    queryKey: ["hr-stats"],
    queryFn: async () => {
      const r = await fetch("/api/workers/hr-stats", { headers: AUTH() });
      if (!r.ok) throw new Error("Erreur stats");
      return r.json();
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: ranking = [], isLoading: rankLoading } = useQuery<RankedWorker[]>({
    queryKey: ["hr-ranking"],
    queryFn: async () => {
      const r = await fetch("/api/workers/ranking", { headers: AUTH() });
      if (!r.ok) throw new Error("Erreur ranking");
      return r.json();
    },
    staleTime: 120_000,
    enabled: activeTab === "ranking" || activeTab === "dashboard",
  });

  const { data: todayWorkers = [], isLoading: todayLoading, refetch: refetchToday } = useQuery<TodayWorker[]>({
    queryKey: ["hr-today"],
    queryFn: async () => {
      const r = await fetch("/api/workers/attendance-today", { headers: AUTH() });
      if (!r.ok) throw new Error("Erreur présence");
      return r.json();
    },
    staleTime: 30_000,
    enabled: activeTab === "today",
  });

  const { data: report, isLoading: reportLoading } = useQuery<Report>({
    queryKey: ["hr-report", reportMonth],
    queryFn: async () => {
      const r = await fetch(`/api/workers/hr-report?month=${reportMonth}`, { headers: AUTH() });
      if (!r.ok) throw new Error("Erreur rapport");
      return r.json();
    },
    staleTime: 120_000,
    enabled: activeTab === "report",
  });

  async function saveBulkAttendance() {
    const today = new Date().toISOString().split("T")[0];
    const entries = Object.entries(bulkStatuses).map(([wId, status]) => ({
      workerId: parseInt(wId), status,
    }));
    if (entries.length === 0) { toast({ title: "Aucune présence à enregistrer", variant: "destructive" }); return; }
    setSavingBulk(true);
    try {
      const r = await fetch("/api/workers/attendance-bulk", {
        method: "POST",
        headers: AUTHJSON(),
        body: JSON.stringify({ date: today, entries }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Erreur");
      toast({ title: `✓ ${entries.length} présence${entries.length > 1 ? "s" : ""} enregistrée${entries.length > 1 ? "s" : ""}` });
      setBulkStatuses({});
      refetchToday();
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally { setSavingBulk(false); }
  }

  // Today's pie chart data
  const todayPieData = stats ? [
    { name: "Présents",   value: stats.today.present,     color: "#10b981" },
    { name: "En retard",  value: stats.today.late,        color: "#f59e0b" },
    { name: "Absents",    value: stats.today.absent,      color: "#ef4444" },
    { name: "Congé",      value: stats.today.vacation,    color: "#3b82f6" },
    { name: "½ jour",     value: stats.today.halfDay,     color: "#f97316" },
    { name: "Non saisi",  value: stats.today.notRecorded, color: "#94a3b8" },
  ].filter(d => d.value > 0) : [];

  const tabs = [
    { id: "dashboard", label: "Tableau de bord", icon: BarChart2 },
    { id: "today",     label: "Présence du jour", icon: CalendarCheck },
    { id: "ranking",   label: "Classement",       icon: Trophy },
    { id: "report",    label: "Rapport mensuel",  icon: TrendingUp },
  ] as const;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold">Gestion RH</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Présence, performance et pilotage des équipes
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setLocation("/workers")} className="gap-1.5">
          <HardHat className="h-4 w-4" />
          Ouvriers
        </Button>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 bg-white border rounded-xl p-1 w-fit">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg whitespace-nowrap transition-colors ${
                activeTab === t.id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ── DASHBOARD ─────────────────────────────────────────────────────────── */}
      {activeTab === "dashboard" && (
        <div className="space-y-6">
          {statsLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : stats ? (
            <>
              {/* KPI cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Users className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold">{stats.totalWorkers}</p>
                        <p className="text-xs text-muted-foreground">Total ouvriers</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-emerald-100 flex items-center justify-center">
                        <UserCheck className="h-5 w-5 text-emerald-600" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-emerald-600">{stats.activeWorkers}</p>
                        <p className="text-xs text-muted-foreground">Actifs</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-amber-100 flex items-center justify-center">
                        <AlertTriangle className="h-5 w-5 text-amber-600" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-amber-600">{stats.openWarnings}</p>
                        <p className="text-xs text-muted-foreground">Avertissements ouverts</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-emerald-100 flex items-center justify-center">
                        <Gift className="h-5 w-5 text-emerald-600" />
                      </div>
                      <div>
                        <p className="text-xl font-bold text-emerald-600">
                          {stats.monthlyBonusTotal.toLocaleString("fr-FR")} DA
                        </p>
                        <p className="text-xs text-muted-foreground">Primes ce mois</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Rates */}
              <div className="grid grid-cols-2 gap-3">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5">
                      <CalendarCheck className="h-3.5 w-3.5" />Taux de présence (30j)
                    </p>
                    <div className="flex items-end gap-2">
                      <p className="text-3xl font-bold text-primary">{stats.monthlyAttRate}%</p>
                    </div>
                    <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${stats.monthlyAttRate}%` }} />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />Taux de ponctualité (30j)
                    </p>
                    <div className="flex items-end gap-2">
                      <p className="text-3xl font-bold text-primary">{stats.monthlyPunctRate}%</p>
                    </div>
                    <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${stats.monthlyPunctRate}%` }} />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Today attendance + top performers */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Pie chart today */}
                <Card>
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <CalendarCheck className="h-4 w-4 text-primary" />
                      Présence aujourd'hui
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      <div className="text-center">
                        <p className="text-2xl font-bold text-emerald-600">{stats.today.present}</p>
                        <p className="text-[10px] text-muted-foreground">Présents</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold text-amber-600">{stats.today.late}</p>
                        <p className="text-[10px] text-muted-foreground">En retard</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold text-red-600">{stats.today.absent}</p>
                        <p className="text-[10px] text-muted-foreground">Absents</p>
                      </div>
                    </div>
                    {todayPieData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={180}>
                        <PieChart>
                          <Pie data={todayPieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
                            {todayPieData.map((entry, index) => (
                              <Cell key={entry.name} fill={entry.color} />
                            ))}
                          </Pie>
                          <Legend iconType="circle" iconSize={8} formatter={(val) => <span className="text-xs">{val}</span>} />
                          <Tooltip formatter={(v) => [`${v} personne${Number(v) > 1 ? "s" : ""}`, ""]} />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      <p className="text-xs text-muted-foreground text-center py-8">
                        Aucune présence enregistrée aujourd'hui
                      </p>
                    )}
                    {stats.today.notRecorded > 0 && (
                      <p className="text-xs text-muted-foreground text-center">
                        {stats.today.notRecorded} ouvrier{stats.today.notRecorded > 1 ? "s" : ""} non saisi{stats.today.notRecorded > 1 ? "s" : ""}
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Top 5 performers */}
                <Card>
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Trophy className="h-4 w-4 text-amber-500" />
                      Top 5 performances
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    {rankLoading ? (
                      <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                    ) : ranking.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-6">Aucune donnée de performance</p>
                    ) : (
                      <div className="space-y-2">
                        {ranking.slice(0, 5).map((w, i) => (
                          <button
                            key={w.id}
                            onClick={() => setLocation(`/workers/${w.id}`)}
                            className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted/40 transition-colors text-left"
                          >
                            <span className={`text-sm font-bold w-5 shrink-0 ${i === 0 ? "text-amber-500" : i === 1 ? "text-slate-400" : i === 2 ? "text-amber-700" : "text-muted-foreground"}`}>
                              {i + 1}
                            </span>
                            <Avatar className="h-7 w-7 shrink-0">
                              <AvatarImage src={w.photoUrl ?? undefined} />
                              <AvatarFallback className="text-[10px] bg-primary/10 text-primary">{getInitials(w.name)}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium truncate">{w.name}</p>
                              {w.position && <p className="text-[10px] text-muted-foreground truncate">{w.position}</p>}
                            </div>
                            <span className={`text-sm font-bold shrink-0 ${getScoreColor(w.score)}`}>{w.score}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* ── TODAY ATTENDANCE ───────────────────────────────────────────────────── */}
      {activeTab === "today" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </p>
            <Button
              size="sm"
              onClick={saveBulkAttendance}
              disabled={savingBulk || Object.keys(bulkStatuses).length === 0}
              className="gap-1.5"
            >
              {savingBulk ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarCheck className="h-3.5 w-3.5" />}
              {savingBulk ? "Enregistrement…" : `Enregistrer (${Object.keys(bulkStatuses).length})`}
            </Button>
          </div>

          {todayLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : todayWorkers.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                Aucun ouvrier actif trouvé.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="divide-y">
                  {todayWorkers.map(w => {
                    const saved = w.today;
                    const pending = bulkStatuses[w.id];
                    const current = pending || saved?.status || null;
                    return (
                      <div key={w.id} className="flex items-center gap-3 px-4 py-2.5">
                        <Avatar className="h-8 w-8 shrink-0">
                          <AvatarImage src={w.photoUrl ?? undefined} />
                          <AvatarFallback className="text-xs bg-primary/10 text-primary">{getInitials(w.name)}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <button
                            onClick={() => setLocation(`/workers/${w.id}`)}
                            className="text-sm font-medium hover:text-primary hover:underline underline-offset-2 text-left"
                          >
                            {w.name}
                          </button>
                          {w.position && <p className="text-xs text-muted-foreground">{w.position}</p>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {saved && !pending && (
                            <Badge className={`text-[10px] ${ATTENDANCE_STATUS_LABELS[saved.status]?.color ?? "bg-muted"} hover:opacity-100`}>
                              {ATTENDANCE_STATUS_LABELS[saved.status]?.label ?? saved.status}
                            </Badge>
                          )}
                          <Select
                            value={pending || ""}
                            onValueChange={v => {
                              if (!v) {
                                setBulkStatuses(prev => { const n = { ...prev }; delete n[w.id]; return n; });
                              } else {
                                setBulkStatuses(prev => ({ ...prev, [w.id]: v }));
                              }
                            }}
                          >
                            <SelectTrigger className="h-7 w-[130px] text-xs">
                              <SelectValue placeholder={saved ? "Modifier…" : "Saisir…"} />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(ATTENDANCE_STATUS_LABELS).map(([val, cfg]) => (
                                <SelectItem key={val} value={val} className="text-xs">{cfg.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── RANKING ───────────────────────────────────────────────────────────── */}
      {activeTab === "ranking" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Classement basé sur la présence, ponctualité, avertissements et primes des 30–90 derniers jours.
          </p>
          {rankLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : ranking.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                Aucune donnée de performance disponible. Commencez par enregistrer des présences.
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Bar chart */}
              <Card>
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm font-medium">Score de performance — Top {ranking.length}</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={ranking} margin={{ top: 5, right: 10, left: -20, bottom: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="name" angle={-35} textAnchor="end" tick={{ fontSize: 10 }} interval={0} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                      <Tooltip formatter={(v) => [`${v} pts`, "Score"]} />
                      <Bar dataKey="score" fill="#6366f1" radius={[4, 4, 0, 0]}>
                        {ranking.map((entry, index) => (
                          <Cell
                            key={entry.id}
                            fill={entry.score >= 85 ? "#10b981" : entry.score >= 70 ? "#3b82f6" : entry.score >= 55 ? "#f59e0b" : entry.score >= 40 ? "#f97316" : "#ef4444"}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* List */}
              <Card>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {ranking.map((w, i) => (
                      <button
                        key={w.id}
                        onClick={() => setLocation(`/workers/${w.id}`)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors text-left"
                      >
                        <span className={`text-base font-bold w-6 shrink-0 ${i === 0 ? "text-amber-500" : i === 1 ? "text-slate-400" : i === 2 ? "text-amber-700" : "text-muted-foreground"}`}>
                          {i < 3 ? ["🥇", "🥈", "🥉"][i] : `${i + 1}.`}
                        </span>
                        <Avatar className="h-9 w-9 shrink-0">
                          <AvatarImage src={w.photoUrl ?? undefined} />
                          <AvatarFallback className="text-xs bg-primary/10 text-primary">{getInitials(w.name)}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{w.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {w.label} · Présence {w.attendanceRate}% · Ponctualité {w.punctualityRate}%
                          </p>
                        </div>
                        <div className={`text-lg font-bold shrink-0 ${getScoreColor(w.score)}`}>
                          {w.score}
                        </div>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}

      {/* ── MONTHLY REPORT ─────────────────────────────────────────────────────── */}
      {activeTab === "report" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Select value={reportMonth} onValueChange={setReportMonth}>
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTH_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value} className="capitalize">{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5">
              Imprimer
            </Button>
          </div>

          {reportLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : !report ? null : (
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-medium capitalize">
                  Rapport mensuel — {new Date(reportMonth + "-01").toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-0 pb-4 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left px-4 py-2 font-medium">Ouvrier</th>
                      <th className="text-center px-2 py-2 font-medium text-emerald-700">Présent</th>
                      <th className="text-center px-2 py-2 font-medium text-amber-700">Retard</th>
                      <th className="text-center px-2 py-2 font-medium text-red-700">Absent</th>
                      <th className="text-center px-2 py-2 font-medium text-blue-700">Congé</th>
                      <th className="text-center px-2 py-2 font-medium text-purple-700">Maladie</th>
                      <th className="text-center px-2 py-2 font-medium text-orange-700">½ Jour</th>
                      <th className="text-center px-2 py-2 font-medium">Taux</th>
                      <th className="text-center px-2 py-2 font-medium text-orange-600">Avert.</th>
                      <th className="text-center px-2 py-2 font-medium text-emerald-600">Primes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {report.workers.map(w => (
                      <tr key={w.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2">
                          <button
                            onClick={() => setLocation(`/workers/${w.id}`)}
                            className="font-medium hover:text-primary hover:underline underline-offset-2 text-left"
                          >
                            {w.name}
                          </button>
                          {w.position && <p className="text-muted-foreground">{w.position}</p>}
                        </td>
                        <td className="text-center px-2 py-2 font-medium text-emerald-700">{w.present || "—"}</td>
                        <td className="text-center px-2 py-2 font-medium text-amber-700">{w.late || "—"}</td>
                        <td className="text-center px-2 py-2 font-medium text-red-700">{w.absent || "—"}</td>
                        <td className="text-center px-2 py-2 text-blue-700">{w.vacation || "—"}</td>
                        <td className="text-center px-2 py-2 text-purple-700">{w.sick || "—"}</td>
                        <td className="text-center px-2 py-2 text-orange-700">{w.halfDay || "—"}</td>
                        <td className="text-center px-2 py-2">
                          {w.attRate !== null ? (
                            <span className={`font-medium ${w.attRate >= 80 ? "text-emerald-600" : w.attRate >= 60 ? "text-amber-600" : "text-red-600"}`}>
                              {w.attRate}%
                            </span>
                          ) : "—"}
                        </td>
                        <td className="text-center px-2 py-2">
                          {w.warnings > 0 ? <span className="font-medium text-orange-600">{w.warnings}</span> : "—"}
                        </td>
                        <td className="text-center px-2 py-2">
                          {w.bonusTotal > 0 ? (
                            <span className="font-medium text-emerald-600">{w.bonusTotal.toLocaleString("fr-FR")} DA</span>
                          ) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {report.workers.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-8">Aucun ouvrier actif.</p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
