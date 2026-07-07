import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { User, Phone, MapPin, HeartHandshake } from "lucide-react";
import type { EditForm, WorkerProfile } from "../types";
import { GENDERS, MARITAL_STATUSES } from "../types";

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

export function TabInformations({ worker, editMode, form, onChange }: Props) {
  function f(key: keyof EditForm) {
    return {
      value: form[key] as string,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange({ [key]: e.target.value }),
    };
  }

  if (!editMode) {
    const genderLabel = GENDERS.find(g => g.value === worker.gender)?.label;
    const maritalLabel = MARITAL_STATUSES.find(m => m.value === worker.maritalStatus)?.label;

    return (
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <User className="h-4 w-4 text-primary" />Identité
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <Field label="Nom complet" value={worker.name} />
              <Field label="Nom de famille" value={worker.lastName} />
              <Field label="Prénom" value={worker.firstName} />
              <Field label="Date de naissance" value={worker.birthDate ? new Date(worker.birthDate).toLocaleDateString("fr-FR") : null} />
              <Field label="Sexe" value={genderLabel} />
              <Field label="Numéro CIN" value={worker.nationalId} />
              <Field label="Situation familiale" value={maritalLabel} />
              <Field label="Nombre d'enfants" value={worker.childrenCount} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Phone className="h-4 w-4 text-primary" />Coordonnées
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <Field label="Téléphone" value={worker.phone} />
              <Field label="WhatsApp" value={worker.whatsapp} />
              <Field label="Email" value={worker.email} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <MapPin className="h-4 w-4 text-primary" />Adresse
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2"><Field label="Adresse" value={worker.address} /></div>
              <Field label="Ville" value={worker.city} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <HeartHandshake className="h-4 w-4 text-primary" />Contact d'urgence
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Nom du contact" value={worker.emergencyContact} />
              <Field label="Téléphone d'urgence" value={worker.emergencyPhone} />
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
            <User className="h-4 w-4 text-primary" />Identité
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label className="text-xs">Nom complet <span className="text-destructive">*</span></Label>
              <Input className="mt-1 h-8 text-sm" {...f("name")} />
            </div>
            <div>
              <Label className="text-xs">Nom de famille</Label>
              <Input className="mt-1 h-8 text-sm" {...f("lastName")} />
            </div>
            <div>
              <Label className="text-xs">Prénom</Label>
              <Input className="mt-1 h-8 text-sm" {...f("firstName")} />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <Label className="text-xs">Date de naissance</Label>
              <Input type="date" className="mt-1 h-8 text-sm" {...f("birthDate")} />
            </div>
            <div>
              <Label className="text-xs">Sexe</Label>
              <Select value={form.gender} onValueChange={v => onChange({ gender: v })}>
                <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {GENDERS.map(g => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Numéro CIN</Label>
              <Input className="mt-1 h-8 text-sm" {...f("nationalId")} />
            </div>
            <div>
              <Label className="text-xs">Nb. d'enfants</Label>
              <Input type="number" min="0" className="mt-1 h-8 text-sm" value={form.childrenCount} onChange={e => onChange({ childrenCount: e.target.value })} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Situation familiale</Label>
            <Select value={form.maritalStatus} onValueChange={v => onChange({ maritalStatus: v })}>
              <SelectTrigger className="mt-1 h-8 text-sm w-48"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {MARITAL_STATUSES.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Phone className="h-4 w-4 text-primary" />Coordonnées
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label className="text-xs">Téléphone</Label>
              <Input className="mt-1 h-8 text-sm" dir="ltr" {...f("phone")} />
            </div>
            <div>
              <Label className="text-xs">WhatsApp</Label>
              <Input className="mt-1 h-8 text-sm" dir="ltr" {...f("whatsapp")} />
            </div>
            <div>
              <Label className="text-xs">Email</Label>
              <Input type="email" className="mt-1 h-8 text-sm" dir="ltr" {...f("email")} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary" />Adresse
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <Label className="text-xs">Adresse complète</Label>
              <Input className="mt-1 h-8 text-sm" {...f("address")} />
            </div>
            <div>
              <Label className="text-xs">Ville</Label>
              <Input className="mt-1 h-8 text-sm" {...f("city")} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <HeartHandshake className="h-4 w-4 text-primary" />Contact d'urgence
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Nom du contact</Label>
              <Input className="mt-1 h-8 text-sm" {...f("emergencyContact")} />
            </div>
            <div>
              <Label className="text-xs">Téléphone d'urgence</Label>
              <Input className="mt-1 h-8 text-sm" dir="ltr" {...f("emergencyPhone")} />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
