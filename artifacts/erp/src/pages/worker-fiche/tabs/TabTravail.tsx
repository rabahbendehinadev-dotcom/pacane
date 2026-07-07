import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Briefcase, Clock, DollarSign } from "lucide-react";
import type { EditForm, WorkerProfile } from "../types";
import { CONTRACT_TYPES } from "../types";

function Field({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm font-medium">{value || <span className="text-muted-foreground/50 font-normal">—</span>}</p>
    </div>
  );
}

interface Props {
  worker: WorkerProfile;
  editMode: boolean;
  form: EditForm;
  onChange: (f: Partial<EditForm>) => void;
}

export function TabTravail({ worker, editMode, form, onChange }: Props) {
  function f(key: keyof EditForm) {
    return {
      value: form[key] as string,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange({ [key]: e.target.value }),
    };
  }

  if (!editMode) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-primary" />Poste & Contrat
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <Field label="Date d'embauche" value={worker.hireDate ? new Date(worker.hireDate).toLocaleDateString("fr-FR") : null} />
              <Field label="Poste / Fonction" value={worker.position} />
              <Field label="Département / Service" value={worker.department} />
              <Field label="Type de contrat" value={worker.contractType} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-primary" />Rémunération
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <Field
                label="Salaire de base"
                value={worker.baseSalary ? `${parseFloat(worker.baseSalary).toLocaleString("fr-DZ")} DA` : null}
              />
              <Field
                label="Taux de commission"
                value={worker.commissionRate ? `${worker.commissionRate}%` : null}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />Horaires
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Heures de travail" value={worker.workHours} />
              <Field label="Jours de repos" value={worker.restDays} />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-primary" />Poste & Contrat
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <Label className="text-xs">Date d'embauche</Label>
              <Input type="date" className="mt-1 h-8 text-sm" {...f("hireDate")} />
            </div>
            <div>
              <Label className="text-xs">Type de contrat</Label>
              <Select value={form.contractType} onValueChange={v => onChange({ contractType: v })}>
                <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {CONTRACT_TYPES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Poste / Fonction</Label>
              <Input className="mt-1 h-8 text-sm" {...f("position")} />
            </div>
            <div>
              <Label className="text-xs">Département / Service</Label>
              <Input className="mt-1 h-8 text-sm" {...f("department")} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-primary" />Rémunération
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Salaire de base (DA)</Label>
              <Input type="number" min="0" step="500" className="mt-1 h-8 text-sm" {...f("baseSalary")} />
            </div>
            <div>
              <Label className="text-xs">Taux de commission (%)</Label>
              <Input type="number" min="0" max="100" step="0.5" className="mt-1 h-8 text-sm" {...f("commissionRate")} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />Horaires
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Heures de travail</Label>
              <Input className="mt-1 h-8 text-sm" placeholder="Ex: 8h00 - 17h00" {...f("workHours")} />
            </div>
            <div>
              <Label className="text-xs">Jours de repos</Label>
              <Input className="mt-1 h-8 text-sm" placeholder="Ex: Vendredi, Samedi" {...f("restDays")} />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
