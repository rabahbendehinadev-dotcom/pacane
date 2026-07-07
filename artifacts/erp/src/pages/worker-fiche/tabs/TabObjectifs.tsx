import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ChevronLeft, ChevronRight, Target, Plus, Pencil, Trash2, X, Loader2, Check,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { WorkerProfile } from "../types";

const AUTH = () => ({ Authorization: `Bearer ${localStorage.getItem("erp_token")}` });
const AUTHJSON = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` });

const OBJ_TYPES = [
  { value: "presence_rate",  label: "Taux de présence",   unit: "%" },
  { value: "punctuality",    label: "Ponctualité",         unit: "%" },
  { value: "tasks",          label: "Tâches accomplies",   unit: "tâches" },
  { value: "warnings_max",   label: "Max avertissements",  unit: "avert." },
  { value: "custom",         label: "Autre objectif",      unit: "pts" },
];

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  in_progress: { label: "En cours",   color: "bg-blue-100 text-blue-700" },
  achieved:    { label: "Atteint",    color: "bg-emerald-100 text-emerald-700" },
  failed:      { label: "Non atteint", color: "bg-red-100 text-red-700" },
};

interface Objective {
  id: number;
  workerId: number;
  month: string;
  title: string;
  type: string;
  targetValue: string;
  currentValue: string;
  unit: string | null;
  status: string | null;
  notes: string | null;
  createdAt: string;
}

interface Props { worker: WorkerProfile }

export function TabObjectifs({ worker }: Props) {
  const qc = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Objective | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Objective | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [fType, setFType] = useState("custom");
  const [fTitle, setFTitle] = useState("");
  const [fTarget, setFTarget] = useState("");
  const [fCurrent, setFCurrent] = useState("");
  const [fUnit, setFUnit] = useState("%");
  const [fStatus, setFStatus] = useState("in_progress");
  const [fNotes, setFNotes] = useState("");

  const monthStr = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthLabel = new Date(year, month - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;

  const { data: objectives = [], isLoading } = useQuery<Objective[]>({
    queryKey: ["worker-objectives", worker.id, year, month],
    queryFn: async () => {
      const r = await fetch(`/api/workers/${worker.id}/objectives?month=${monthStr.slice(0, 7)}`, { headers: AUTH() });
      if (!r.ok) throw new Error("Erreur");
      return r.json();
    },
    staleTime: 30_000,
  });

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
    setShowForm(false);
  }
  function nextMonth() {
    if (isCurrentMonth) return;
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
    setShowForm(false);
  }

  function openAdd() {
    setEditTarget(null);
    setFType("custom"); setFTitle(""); setFTarget(""); setFCurrent("0"); setFUnit("%"); setFStatus("in_progress"); setFNotes("");
    setShowForm(true);
  }

  function openEdit(o: Objective) {
    setEditTarget(o);
    setFType(o.type); setFTitle(o.title); setFTarget(o.targetValue);
    setFCurrent(o.currentValue); setFUnit(o.unit ?? "%"); setFStatus(o.status ?? "in_progress"); setFNotes(o.notes ?? "");
    setShowForm(true);
  }

  function onTypeChange(v: string) {
    setFType(v);
    const t = OBJ_TYPES.find(o => o.value === v);
    if (t) { setFUnit(t.unit); setFTitle(t.label); }
  }

  async function save() {
    if (!fTitle.trim() || !fTarget) { toast({ title: "Titre et valeur cible requis", variant: "destructive" }); return; }
    if (saving) return;
    setSaving(true);
    try {
      const url = `/api/workers/${worker.id}/objectives${editTarget ? `/${editTarget.id}` : ""}`;
      const method = editTarget ? "PATCH" : "POST";
      const body = {
        month: monthStr.slice(0, 7),
        title: fTitle.trim(),
        type: fType,
        targetValue: parseFloat(fTarget),
        currentValue: parseFloat(fCurrent || "0"),
        unit: fUnit || null,
        status: fStatus,
        notes: fNotes || null,
      };
      const r = await fetch(url, { method, headers: AUTHJSON(), body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Erreur");
      toast({ title: `✓ Objectif ${editTarget ? "mis à jour" : "ajouté"}` });
      setShowForm(false);
      qc.invalidateQueries({ queryKey: ["worker-objectives", worker.id] });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function deleteObj() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/workers/${worker.id}/objectives/${deleteTarget.id}`, { method: "DELETE", headers: AUTH() });
      if (!r.ok) throw new Error("Erreur");
      toast({ title: "Objectif supprimé" });
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["worker-objectives", worker.id] });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally { setDeleting(false); }
  }

  const achieved = objectives.filter(o => o.status === "achieved").length;
  const total = objectives.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="text-sm font-medium capitalize min-w-[140px] text-center">{monthLabel}</span>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={nextMonth} disabled={isCurrentMonth}><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div className="flex items-center gap-2">
          {total > 0 && (
            <span className="text-xs text-muted-foreground">{achieved}/{total} atteint{achieved > 1 ? "s" : ""}</span>
          )}
          {!showForm && (
            <Button size="sm" variant="outline" onClick={openAdd} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />Ajouter
            </Button>
          )}
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <Card className="border-primary/30 bg-primary/[0.02]">
          <CardHeader className="pb-3 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" />
                {editTarget ? "Modifier l'objectif" : "Nouvel objectif"}
              </CardTitle>
              <Button variant="ghost" size="icon" className="h-6 w-6 -mr-1" onClick={() => setShowForm(false)} disabled={saving}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={fType} onValueChange={onTypeChange} disabled={saving}>
                  <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OBJ_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Titre <span className="text-destructive">*</span></Label>
                <Input className="mt-1 h-8 text-sm" value={fTitle} onChange={e => setFTitle(e.target.value)} disabled={saving} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Objectif cible <span className="text-destructive">*</span></Label>
                <Input type="number" min="0" className="mt-1 h-8 text-sm" value={fTarget} onChange={e => setFTarget(e.target.value)} disabled={saving} />
              </div>
              <div>
                <Label className="text-xs">Valeur actuelle</Label>
                <Input type="number" min="0" className="mt-1 h-8 text-sm" value={fCurrent} onChange={e => setFCurrent(e.target.value)} disabled={saving} />
              </div>
              <div>
                <Label className="text-xs">Unité</Label>
                <Input className="mt-1 h-8 text-sm" value={fUnit} onChange={e => setFUnit(e.target.value)} disabled={saving} />
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Statut</Label>
                <Select value={fStatus} onValueChange={setFStatus} disabled={saving}>
                  <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_CFG).map(([v, c]) => <SelectItem key={v} value={v}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Notes</Label>
                <Input className="mt-1 h-8 text-sm" value={fNotes} onChange={e => setFNotes(e.target.value)} disabled={saving} placeholder="Optionnel" />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)} disabled={saving}>Annuler</Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Enregistrement…</> : <><Check className="h-3.5 w-3.5 mr-1.5" />Sauvegarder</>}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* List */}
      {isLoading ? (
        <Card><CardContent className="py-12 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>
      ) : objectives.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-14 text-center text-muted-foreground">
            <Target className="h-10 w-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">Aucun objectif pour ce mois</p>
            <p className="text-xs mt-1">Fixez des objectifs mensuels clairs pour cet employé.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {objectives.map(o => {
            const target = parseFloat(o.targetValue);
            const current = parseFloat(o.currentValue);
            const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
            const sCfg = STATUS_CFG[o.status ?? "in_progress"] ?? STATUS_CFG.in_progress;
            return (
              <Card key={o.id} className={o.status === "achieved" ? "border-emerald-200 bg-emerald-50/20" : ""}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Target className={`h-4 w-4 mt-0.5 shrink-0 ${o.status === "achieved" ? "text-emerald-600" : "text-primary"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <span className="text-sm font-medium">{o.title}</span>
                        <Badge className={`text-[10px] ${sCfg.color} hover:${sCfg.color}`}>{sCfg.label}</Badge>
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                        <span>{current.toLocaleString("fr-FR")} / {target.toLocaleString("fr-FR")} {o.unit}</span>
                        <span className={`font-semibold ${pct >= 100 ? "text-emerald-600" : pct >= 70 ? "text-amber-600" : "text-red-600"}`}>{pct}%</span>
                      </div>
                      <Progress value={pct} className="h-2" />
                      {o.notes && <p className="text-xs text-muted-foreground mt-1 italic">{o.notes}</p>}
                    </div>
                    <div className="flex gap-0.5 shrink-0">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(o)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setDeleteTarget(o)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={v => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cet objectif ?</AlertDialogTitle>
            <AlertDialogDescription>
              "<strong>{deleteTarget?.title}</strong>" sera définitivement supprimé.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={deleteObj} disabled={deleting} className="bg-destructive hover:bg-destructive/90">
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
