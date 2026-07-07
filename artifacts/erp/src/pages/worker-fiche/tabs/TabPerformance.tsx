import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Loader2, TrendingUp, AlertTriangle, Gift, Clock, CalendarCheck, UserCheck } from "lucide-react";
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
  if (score >= 85) return { ring: "text-emerald-600", bg: "bg-emerald-500", bar: "bg-emerald-500", label: "text-emerald-700" };
  if (score >= 70) return { ring: "text-blue-600", bg: "bg-blue-500", bar: "bg-blue-500", label: "text-blue-700" };
  if (score >= 55) return { ring: "text-amber-600", bg: "bg-amber-500", bar: "bg-amber-500", label: "text-amber-700" };
  if (score >= 40) return { ring: "text-orange-600", bg: "bg-orange-500", bar: "bg-orange-500", label: "text-orange-700" };
  return { ring: "text-red-600", bg: "bg-red-500", bar: "bg-red-500", label: "text-red-700" };
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

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-16 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error || !perf) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground text-sm">
          Impossible de charger les données de performance.
        </CardContent>
      </Card>
    );
  }

  const colors = getScoreColor(perf.score);

  return (
    <div className="space-y-4">
      {/* Main score card */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row items-center gap-6">
            {/* Circular score */}
            <div className="relative shrink-0">
              <svg width="130" height="130" viewBox="0 0 130 130">
                <circle cx="65" cy="65" r="56" fill="none" stroke="currentColor" strokeWidth="12"
                  className="text-muted/30" />
                <circle
                  cx="65" cy="65" r="56" fill="none" strokeWidth="12"
                  strokeLinecap="round"
                  className={colors.ring}
                  stroke="currentColor"
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
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Score de performance</p>
              <p className={`text-2xl font-bold ${colors.ring} mb-2`}>{perf.label}</p>
              <p className="text-sm text-muted-foreground mb-4">
                Basé sur les 30 derniers jours d'activité (présence, ponctualité, avertissements et primes).
              </p>

              {/* Score breakdown */}
              <div className="space-y-2">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <CalendarCheck className="h-3 w-3" />Taux de présence (40%)
                    </span>
                    <span className="font-medium">{perf.attendanceRate}%</span>
                  </div>
                  <Progress value={perf.attendanceRate} className="h-1.5" />
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />Ponctualité (30%)
                    </span>
                    <span className="font-medium">{perf.punctualityRate}%</span>
                  </div>
                  <Progress value={perf.punctualityRate} className="h-1.5" />
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Detail cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <CalendarCheck className="h-5 w-5 mx-auto mb-2 text-emerald-600" />
            <p className="text-2xl font-bold text-emerald-600">{perf.presentDays}</p>
            <p className="text-xs text-muted-foreground">Jours présents</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Clock className="h-5 w-5 mx-auto mb-2 text-amber-600" />
            <p className="text-2xl font-bold text-amber-600">{perf.lateDays}</p>
            <p className="text-xs text-muted-foreground">Retards</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <AlertTriangle className="h-5 w-5 mx-auto mb-2 text-orange-600" />
            <p className="text-2xl font-bold text-orange-600">{perf.warningsLast90}</p>
            <p className="text-xs text-muted-foreground">Avertissements (90j)</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Gift className="h-5 w-5 mx-auto mb-2 text-emerald-600" />
            <p className="text-2xl font-bold text-emerald-600">{perf.bonusesLast90}</p>
            <p className="text-xs text-muted-foreground">Primes (90j)</p>
          </CardContent>
        </Card>
      </div>

      {/* Evaluation guide */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-xs text-muted-foreground uppercase tracking-wider font-semibold flex items-center gap-2">
            <TrendingUp className="h-3.5 w-3.5" />
            Grille d'évaluation
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="space-y-1.5">
            {[
              { range: "85 – 100", label: "Excellent",              color: "bg-emerald-500" },
              { range: "70 – 84",  label: "Très bien",              color: "bg-blue-500" },
              { range: "55 – 69",  label: "Bien",                   color: "bg-amber-500" },
              { range: "40 – 54",  label: "Moyen",                  color: "bg-orange-500" },
              { range: "0 – 39",   label: "Doit s'améliorer",       color: "bg-red-500" },
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
            Aucune donnée de présence pour ce mois. Commencez à enregistrer les présences pour voir le score évoluer.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
