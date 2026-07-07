import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, Plus, Trash2, X, Loader2, ShieldOff, CheckCircle2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { WorkerProfile } from "../types";

const AUTHJSON = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` });
const AUTH = () => ({ Authorization: `Bearer ${localStorage.getItem("erp_token")}` });

const SEVERITIES = [
  { value: "low",      label: "Faible",   color: "bg-slate-100 text-slate-700" },
  { value: "medium",   label: "Moyen",    color: "bg-amber-100 text-amber-700" },
  { value: "high",     label: "Élevé",    color: "bg-orange-100 text-orange-700" },
  { value: "critical", label: "Critique", color: "bg-red-100 text-red-700" },
];

function getSeverity(v: string | null) {
  return SEVERITIES.find(s => s.value === v) ?? SEVERITIES[1];
}

interface Warning {
  id: number;
  workerId: number;
  title: string;
  description: string | null;
  severity: string | null;
  status: string | null;
  createdAt: string;
  closedAt: string | null;
}

interface Props { worker: WorkerProfile }

export function TabAvertissements({ worker }: Props) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Warning | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState<number | null>(null);

  const [fTitle, setFTitle] = useState("");
  const [fDesc, setFDesc] = useState("");
  const [fSeverity, setFSeverity] = useState("medium");

  const { data: warnings = [], isLoading } = useQuery<Warning[]>({
    queryKey: ["worker-warnings", worker.id],
    queryFn: async () => {
      const r = await fetch(`/api/workers/${worker.id}/warnings`, { headers: AUTH() });
      if (!r.ok) throw new Error("Erreur");
      return r.json();
    },
    staleTime: 30_000,
  });

  function resetForm() { setFTitle(""); setFDesc(""); setFSeverity("medium"); setShowForm(false); }

  async function submit() {
    if (!fTitle.trim()) { toast({ title: "Titre requis", variant: "destructive" }); return; }
    if (saving) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/workers/${worker.id}/warnings`, {
        method: "POST",
        headers: AUTHJSON(),
        body: JSON.stringify({ title: fTitle.trim(), description: fDesc.trim() || null, severity: fSeverity }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Erreur");
      toast({ title: "✓ Avertissement émis" });
      resetForm();
      qc.invalidateQueries({ queryKey: ["worker-warnings", worker.id] });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function toggleStatus(w: Warning) {
    if (toggling !== null) return;
    setToggling(w.id);
    try {
      const newStatus = w.status === "open" ? "closed" : "open";
      const r = await fetch(`/api/workers/${worker.id}/warnings/${w.id}`, {
        method: "PATCH",
        headers: AUTHJSON(),
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Erreur");
      toast({ title: newStatus === "closed" ? "Avertissement clôturé" : "Avertissement réouvert" });
      qc.invalidateQueries({ queryKey: ["worker-warnings", worker.id] });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally { setToggling(null); }
  }

  async function deleteWarning() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/workers/${worker.id}/warnings/${deleteTarget.id}`, {
        method: "DELETE", headers: AUTH(),
      });
      if (!r.ok) throw new Error("Erreur");
      toast({ title: "Avertissement supprimé" });
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["worker-warnings", worker.id] });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally { setDeleting(false); }
  }

  const openCount = warnings.filter(w => w.status === "open").length;
  const closedCount = warnings.filter(w => w.status !== "open").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-3 text-sm text-muted-foreground">
          {openCount > 0 && <span className="text-orange-600 font-medium">{openCount} ouvert{openCount > 1 ? "s" : ""}</span>}
          {closedCount > 0 && <span>{closedCount} clôturé{closedCount > 1 ? "s" : ""}</span>}
          {warnings.length === 0 && <span>Aucun avertissement</span>}
        </div>
        {!showForm && (
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />Émettre un avertissement
          </Button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <Card className="border-orange-200 bg-orange-50/30">
          <CardHeader className="pb-3 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-orange-600" />
                Nouvel avertissement officiel
              </CardTitle>
              <Button variant="ghost" size="icon" className="h-6 w-6 -mr-1" onClick={resetForm} disabled={saving}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <Label className="text-xs">Titre <span className="text-destructive">*</span></Label>
                <Input className="mt-1 h-8 text-sm" value={fTitle} onChange={e => setFTitle(e.target.value)}
                  placeholder="Ex : Retard répété, Comportement inapproprié…" disabled={saving} autoFocus />
              </div>
              <div>
                <Label className="text-xs">Sévérité</Label>
                <Select value={fSeverity} onValueChange={setFSeverity} disabled={saving}>
                  <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SEVERITIES.map(s => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Description / Motif</Label>
              <Textarea className="mt-1 text-sm resize-none" rows={3} value={fDesc}
                onChange={e => setFDesc(e.target.value)} disabled={saving}
                placeholder="Décrivez les faits en détail…" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={resetForm} disabled={saving}>Annuler</Button>
              <Button size="sm" onClick={submit} disabled={saving || !fTitle.trim()}
                className="bg-orange-600 hover:bg-orange-700 text-white">
                {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />}
                {saving ? "Émission…" : "Émettre l'avertissement"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* List */}
      {isLoading ? (
        <Card><CardContent className="py-12 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>
      ) : warnings.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center text-muted-foreground">
            <ShieldOff className="h-10 w-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">Aucun avertissement</p>
            <p className="text-xs mt-1">Cet employé n'a reçu aucun avertissement.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {warnings.map(w => {
            const sev = getSeverity(w.severity);
            const isClosed = w.status === "closed";
            return (
              <Card key={w.id} className={isClosed ? "opacity-60" : ""}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className={`h-4 w-4 mt-0.5 shrink-0 ${isClosed ? "text-muted-foreground" : "text-orange-600"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-sm font-medium ${isClosed ? "line-through text-muted-foreground" : ""}`}>
                          {w.title}
                        </span>
                        <Badge className={`text-[10px] ${sev.color} hover:${sev.color}`}>{sev.label}</Badge>
                        {isClosed && <Badge variant="secondary" className="text-[10px]">Clôturé</Badge>}
                      </div>
                      {w.description && (
                        <p className="text-xs text-muted-foreground mb-1">{w.description}</p>
                      )}
                      <p className="text-[10px] text-muted-foreground">
                        Émis le {new Date(w.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                        {w.closedAt && ` · Clôturé le ${new Date(w.closedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost" size="icon" className={`h-7 w-7 ${isClosed ? "text-emerald-600 hover:bg-emerald-50" : "text-slate-600 hover:bg-slate-50"}`}
                        onClick={() => toggleStatus(w)}
                        disabled={toggling === w.id}
                        title={isClosed ? "Réouvrir" : "Clôturer"}
                      >
                        {toggling === w.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : isClosed ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setDeleteTarget(w)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
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
            <AlertDialogTitle>Supprimer cet avertissement ?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground">{deleteTarget?.title}</strong> sera définitivement supprimé du dossier.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={deleteWarning} disabled={deleting} className="bg-destructive hover:bg-destructive/90">
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
