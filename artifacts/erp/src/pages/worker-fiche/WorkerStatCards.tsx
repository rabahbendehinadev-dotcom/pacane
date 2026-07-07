import { Card, CardContent } from "@/components/ui/card";
import { Wrench, ListTodo, Calendar, Banknote, Award, Clock } from "lucide-react";
import type { WorkerProfile } from "./types";

function calcAnciennete(hireDate: string | null): string {
  if (!hireDate) return "—";
  const ms = Date.now() - new Date(hireDate).getTime();
  const years = Math.floor(ms / (1000 * 60 * 60 * 24 * 365.25));
  const months = Math.floor((ms % (1000 * 60 * 60 * 24 * 365.25)) / (1000 * 60 * 60 * 24 * 30.44));
  if (years === 0) return `${months} mois`;
  if (months === 0) return `${years} an${years > 1 ? "s" : ""}`;
  return `${years} an${years > 1 ? "s" : ""} ${months} mois`;
}

function formatLastActivity(logs: WorkerProfile["recentActivity"]): string {
  if (!logs.length) return "—";
  const d = new Date(logs[0].createdAt);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Aujourd'hui";
  if (diffDays === 1) return "Hier";
  if (diffDays < 7) return `Il y a ${diffDays} jours`;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

interface StatCardProps {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  iconColor?: string;
  placeholder?: boolean;
}

function StatCard({ icon: Icon, label, value, sub, iconColor = "text-primary", placeholder }: StatCardProps) {
  return (
    <Card className={`${placeholder ? "opacity-50" : ""}`}>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`h-10 w-10 rounded-lg bg-primary/8 flex items-center justify-center shrink-0 ${iconColor}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground font-medium truncate">{label}</p>
          <p className="text-base font-bold text-foreground truncate">{value}</p>
          {sub && <p className="text-[10px] text-muted-foreground truncate">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

interface Props {
  worker: WorkerProfile;
}

export function WorkerStatCards({ worker }: Props) {
  const salary = worker.baseSalary
    ? `${parseFloat(worker.baseSalary).toLocaleString("fr-DZ")} DA`
    : "—";

  const commission = worker.commissionRate
    ? `${worker.commissionRate}%`
    : "—";

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 px-6 py-4 bg-muted/20 border-b print:hidden">
      <StatCard
        icon={Wrench}
        label="Réparations"
        value="—"
        sub="Bientôt disponible"
        iconColor="text-orange-500"
        placeholder
      />
      <StatCard
        icon={ListTodo}
        label="Tâches en cours"
        value="—"
        sub="Bientôt disponible"
        iconColor="text-blue-500"
        placeholder
      />
      <StatCard
        icon={Calendar}
        label="Ancienneté"
        value={calcAnciennete(worker.hireDate)}
        sub={worker.hireDate ? `Depuis ${new Date(worker.hireDate).toLocaleDateString("fr-FR", { month: "short", year: "numeric" })}` : undefined}
        iconColor="text-emerald-500"
      />
      <StatCard
        icon={Banknote}
        label="Salaire de base"
        value={salary}
        iconColor="text-primary"
      />
      <StatCard
        icon={Award}
        label="Commission"
        value={commission}
        sub="Sur chiffre d'affaires"
        iconColor="text-amber-500"
      />
      <StatCard
        icon={Clock}
        label="Dernière activité"
        value={formatLastActivity(worker.recentActivity)}
        iconColor="text-slate-500"
      />
    </div>
  );
}
