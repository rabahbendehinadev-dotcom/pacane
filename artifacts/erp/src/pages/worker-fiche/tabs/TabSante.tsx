import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { HeartPulse, AlertTriangle, Pill } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { EditForm, WorkerProfile } from "../types";
import { BLOOD_TYPES } from "../types";

function Field({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm font-medium">{value || <span className="text-muted-foreground/50 font-normal">—</span>}</p>
    </div>
  );
}

function YesNoBadge({ value, yesLabel = "Oui", noLabel = "Non" }: { value: boolean | null; yesLabel?: string; noLabel?: string }) {
  if (value === null) return <span className="text-muted-foreground/50 text-sm font-normal">—</span>;
  return value
    ? <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 text-xs">{yesLabel}</Badge>
    : <Badge variant="secondary" className="text-xs">{noLabel}</Badge>;
}

interface Props {
  worker: WorkerProfile;
  editMode: boolean;
  form: EditForm;
  onChange: (f: Partial<EditForm>) => void;
}

export function TabSante({ worker, editMode, form, onChange }: Props) {
  if (!editMode) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <HeartPulse className="h-4 w-4 text-primary" />Informations médicales générales
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Groupe sanguin</p>
                {worker.bloodType
                  ? <Badge className="bg-red-100 text-red-700 hover:bg-red-100 font-bold">{worker.bloodType}</Badge>
                  : <span className="text-muted-foreground/50 text-sm">—</span>}
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Maladie chronique</p>
                <YesNoBadge value={worker.hasChronicDisease} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Prise de médicaments</p>
                <YesNoBadge value={worker.takesMedication} />
              </div>
            </div>
          </CardContent>
        </Card>

        {worker.hasChronicDisease && (
          <Card className="border-amber-200 bg-amber-50/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2 text-amber-700">
                <AlertTriangle className="h-4 w-4" />Maladie chronique
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">{worker.chronicDiseaseDetails || "—"}</p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Pill className="h-4 w-4 text-primary" />Allergies & Notes médicales
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Allergies connues" value={worker.allergies} />
            <Field label="Notes médicales" value={worker.medicalNotes} />
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
            <HeartPulse className="h-4 w-4 text-primary" />Informations médicales générales
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label className="text-xs">Groupe sanguin</Label>
              <Select value={form.bloodType} onValueChange={v => onChange({ bloodType: v })}>
                <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {BLOOD_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3 pt-5">
              <Switch
                checked={form.hasChronicDisease}
                onCheckedChange={v => onChange({ hasChronicDisease: v })}
              />
              <Label className="text-sm cursor-pointer">Maladie chronique</Label>
            </div>
            <div className="flex items-center gap-3 pt-5">
              <Switch
                checked={form.takesMedication}
                onCheckedChange={v => onChange({ takesMedication: v })}
              />
              <Label className="text-sm cursor-pointer">Prend des médicaments</Label>
            </div>
          </div>

          {form.hasChronicDisease && (
            <div>
              <Label className="text-xs">Détails de la maladie chronique</Label>
              <Textarea
                className="mt-1 text-sm resize-none"
                rows={2}
                value={form.chronicDiseaseDetails}
                onChange={e => onChange({ chronicDiseaseDetails: e.target.value })}
                placeholder="Précisez la maladie..."
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Pill className="h-4 w-4 text-primary" />Allergies & Notes médicales
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs">Allergies connues</Label>
            <Textarea
              className="mt-1 text-sm resize-none"
              rows={2}
              value={form.allergies}
              onChange={e => onChange({ allergies: e.target.value })}
              placeholder="Ex: Pénicilline, pollen, arachides..."
            />
          </div>
          <div>
            <Label className="text-xs">Notes médicales</Label>
            <Textarea
              className="mt-1 text-sm resize-none"
              rows={3}
              value={form.medicalNotes}
              onChange={e => onChange({ medicalNotes: e.target.value })}
              placeholder="Toute information médicale pertinente..."
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
