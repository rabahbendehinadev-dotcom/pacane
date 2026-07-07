import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Loader2, TrendingUp, AlertTriangle, Gift, Clock, CalendarCheck, UserCheck, Medal, BarChart3 } from "lucide-react";
import type { WorkerProfile } from "../types";

const AUTH = () => ({ Authorization: `Bearer ${localStorage.getItem("erp_token")}` });

interface PerformanceData {
  score: number;
  label: string;
  attendanceRate: number;
  punctualityRate: number;
  warningsLast90: number;
  bonusesLast90: number;
  presentDays: number;
  lateDays: number;
  absentDays: number;
  totalDays: number;
}

function getScoreColor(score: number) {
  if (score >= 85) return { ring: "text-emerald-600", bar: "bg-emerald-500", bg: "bg-emerald-50", border: "border-emerald-200", label: "text-emerald-700" };
  if (score >= 70) return { ring: "text-blue-600",    bar: "bg-blue-500",    bg: "bg-blue-50",    border: "border-blue-200",    label: "text-blue-700" };
  if (score >= 55) return { ring: "text-amber-600",   bar: "bg-amber-500",   bg: "bg-amber-50",   border: "border-amber-200",   label: "text-amber-700" };
  if (score >= 40) return { ring: "text-orange-600",  bar: "bg-orange-500",  bg: "bg-orange-50",  border: "border-orange-200",  label: "text-orange-700" };
  return { ring: "text-red-600", bar: "bg-red-500", bg: "bg-red-50", border: "border-red-200", label: "text-red-700" };
}

function computeKPIs(perf: PerformanceData) {
  const attendance   = perf.attendanceRate;
  const punctuality  = perf.punctualityRate;
  const discipline   = Math.max(0, 100 - perf.warningsLast90 * 20);
  const productivity = Math.min(100, 50 + perf.bonusesLast90 * 10);
  const quality      = Math.round((attendance * 0.3 + punctuality * 0.3 + discipline * 0.2 + productivity * 0.2));
  const overall      = perf.score;
  return [
    { key: "attendance",   label: "Présence",       score: attendance,  icon: CalendarCheck, desc: "Jours présents / jours travaillés" },
    { key: "punctuality",  label: "Ponctualité",     score: punctuality, icon: Clock,         desc: "Arrivées à l'heure / total arrivées" },
    { key: "discipline",   label: "Discipline",      score: discipline,  icon: UserCheck,     desc: `${perf.warningsLast90} avertissement(s) sur 90j` },
    { key: "productivity", label: "Productivité",    score: productivity, icon: TrendingUp,   desc: `${perf.bonusesLast90} prime(s) sur 90j` },
    { key: "quality",      label: "Qualité glob.",   score: quality,     icon: Medal,         desc: "Score composite multi-critères" },
    { key: "overall",      label: "Score global",    score: overall,     icon: BarChart3,     desc: "Indice de performance combiné" },
  ];
}

function KPIGauge({ label, score, icon: Icon, desc }: { label: string; score: number; icon: React.ElementType; desc: string }) {
  const c = getScoreColor(score);
  return (
    <Card className={`${c.bg} ${c.border} border`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Icon className={`h-4 w-4 ${c.ring}`} />
            <span className="text-xs font-semibold text-foreground">{label}</span>
          </div>
          <span className={`text-lg font-bold ${c.ring}`}>{score}</span>
        </div>
        <div className="relative h-2 bg-white/60 rounded-full overflow-hidden">
          <div
            className={`h-full ${c.bar} rounded-full transition-all duration-700`}
            style={{ width: `${score}%` }}
          />
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5">{desc}</p>
      </CardContent>
    </Card>
  );
}

interface Props { worker: WorkerProfile }

export function TabPerformance({ worker }: Props) {
  const { data: perf, isLoading, error } = useQuery<PerformanceData>({
    queryKey: ["worker-performance", worker.id],
    queryFn: async () => {
      const r = await fetch(`/api/workers/${worker.id}/performance`, { headers: AUTH() });
      if (!r.ok) throw new Error("Erreur chargement performance");
      return r.json();
    },
    staleTime: 120_000,
  });

  if (isLoading) return (
    <Card><CardContent className="py-16 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></CardContent></Card>
  );
  if (error || !perf) return (
    <Card><CardContent className="py-12 text-center text-muted-foreground text-sm">Impossible de charger les données.</CardContent></Card>
  );

  const colors = getScoreColor(perf.score);
  const kpis = computeKPIs(perf);

  return (
    <div className="space-y-4">
      {/* Hero score */}
      <Card className={`${colors.bg} ${colors.border} border-2`}>
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row items-center gap-6">
            {/* Circular score */}
            <div className="relative shrink-0">
              <svg width="130" height="130" viewBox="0 0 130 130">
                <circle cx="65" cy="65" r="56" fill="none" stroke="currentColor" strokeWidth="12" className="text-white/60" />
                <circle cx="65" cy="65" r="56" fill="none" strokeWidth="12" strokeLinecap="round"
                  className={colors.ring} stroke="currentColor"
                  strokeDasharray={`${2 * Math.PI * 56}`}
                  strokeDashoffset={`${2 * Math.PI * 56 * (1 - perf.score / 100)}`}
                  transform="rotate(-90 65 65)"
                  style={{ transition: "stroke-dashoffset 1s ease" }}
                />
                <text x="65" y="60" textAnchor="middle" className="fill-foreground" fontSize="24" fontWeight="700">{perf.score}</text>
                <text x="65" y="76" textAnchor="middle" className="fill-muted-foreground" fontSize="11">/100</text>
              </svg>
            </div>
            <div className="flex-1 text-center sm:text-left">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Indice de performance</p>
              <p className={`text-3xl font-bold ${colors.ring} mb-2`}>{perf.label}</p>
              <p className="text-sm text-muted-foreground mb-3">
                Calculé sur les 30 derniers jours de présence et 90 jours d'historique disciplinaire.
              </p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">Présence</span><span className="font-semibold">{perf.attendanceRate}%</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Ponctualité</span><span className="font-semibold">{perf.punctualityRate}%</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Avertissements</span><span className={`font-semibold ${perf.warningsLast90 > 0 ? "text-orange-600" : "text-emerald-600"}`}>{perf.warningsLast90}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Primes (90j)</span><span className="font-semibold text-emerald-600">{perf.bonusesLast90}</span></div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI grid */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
          <BarChart3 className="h-3.5 w-3.5" />Indicateurs de performance (KPIs)
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {kpis.map(kpi => (
            <KPIGauge key={kpi.key} label={kpi.label} score={kpi.score} icon={kpi.icon} desc={kpi.desc} />
          ))}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Présents", value: perf.presentDays,  icon: CalendarCheck, color: "text-emerald-600" },
          { label: "Retards",  value: perf.lateDays,     icon: Clock,         color: "text-amber-600" },
          { label: "Absents",  value: perf.absentDays,   icon: AlertTriangle, color: "text-red-600" },
          { label: "Primes",   value: perf.bonusesLast90, icon: Gift,         color: "text-blue-600" },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-4 text-center">
              <s.icon className={`h-5 w-5 mx-auto mb-2 ${s.color}`} />
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Evaluation guide */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-xs text-muted-foreground uppercase tracking-wider font-semibold flex items-center gap-2">
            <TrendingUp className="h-3.5 w-3.5" />Grille d'évaluation
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="space-y-1.5">
            {[
              { range: "85 – 100", label: "Excellent",        color: "bg-emerald-500" },
              { range: "70 – 84",  label: "Très bien",        color: "bg-blue-500" },
              { range: "55 – 69",  label: "Bien",             color: "bg-amber-500" },
              { range: "40 – 54",  label: "Moyen",            color: "bg-orange-500" },
              { range: "0 – 39",   label: "Doit s'améliorer", color: "bg-red-500" },
            ].map(level => (
              <div key={level.range} className={`flex items-center gap-3 px-3 py-2 rounded-lg ${perf.label === level.label ? "bg-muted/60 ring-1 ring-primary/20" : ""}`}>
                <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${level.color}`} />
                <span className="text-xs font-medium flex-1">{level.label}</span>
                <span className="text-xs text-muted-foreground">{level.range} pts</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {perf.totalDays === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            <UserCheck className="h-8 w-8 mx-auto mb-2 opacity-30" />
            Aucune donnée de présence enregistrée. Commencez à saisir les présences pour activer les KPIs.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
