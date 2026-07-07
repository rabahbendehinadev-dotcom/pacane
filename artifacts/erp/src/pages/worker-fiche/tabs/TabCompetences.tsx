import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Star, Plus, Trash2, X, Check, Pencil, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { WorkerProfile, WorkerSkill } from "../types";
import { SKILL_LEVELS } from "../types";

const AUTH = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("erp_token")}`,
});

function LevelBadge({ level }: { level: string | null }) {
  if (!level) return null;
  const cfg = SKILL_LEVELS.find(l => l.value === level);
  return (
    <Badge className={`text-xs ${cfg?.color ?? "bg-slate-100 text-slate-700"}`}>
      {cfg?.label ?? level}
    </Badge>
  );
}

interface SkillFormState {
  skill: string;
  level: string;
  yearsExperience: string;
  certification: string;
}

const EMPTY_FORM: SkillFormState = { skill: "", level: "", yearsExperience: "", certification: "" };

interface Props {
  worker: WorkerProfile;
  onRefresh: () => Promise<void>;
}

export function TabCompetences({ worker, onRefresh }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<SkillFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<SkillFormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<WorkerSkill | null>(null);
  const [deleting, setDeleting] = useState(false);

  function resetAdd() {
    setForm(EMPTY_FORM);
    setShowAdd(false);
  }

  async function addSkill() {
    if (!form.skill.trim()) {
      toast({ title: "Le nom de la compétence est requis", variant: "destructive" });
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/workers/${worker.id}/skills`, {
        method: "POST",
        headers: AUTH(),
        body: JSON.stringify({
          skill: form.skill.trim(),
          level: form.level || null,
          yearsExperience: form.yearsExperience ? parseInt(form.yearsExperience, 10) : null,
          certification: form.certification.trim() || null,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Erreur");
      toast({ title: `✓ Compétence "${form.skill.trim()}" ajoutée` });
      resetAdd();
      setRefreshing(true);
      await onRefresh();
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
      setRefreshing(false);
    }
  }

  async function saveEdit(id: number) {
    if (saving) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/workers/${worker.id}/skills/${id}`, {
        method: "PATCH",
        headers: AUTH(),
        body: JSON.stringify({
          skill: editForm.skill.trim(),
          level: editForm.level || null,
          yearsExperience: editForm.yearsExperience ? parseInt(editForm.yearsExperience, 10) : null,
          certification: editForm.certification.trim() || null,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Erreur");
      toast({ title: "Compétence mise à jour" });
      setEditingId(null);
      setRefreshing(true);
      await onRefresh();
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
      setRefreshing(false);
    }
  }

  async function deleteSkill() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/workers/${worker.id}/skills/${deleteTarget.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${localStorage.getItem("erp_token")}` },
      });
      if (!r.ok) {
        const data = await r.json();
        throw new Error(data.error ?? "Erreur");
      }
      toast({ title: "Compétence supprimée" });
      setDeleteTarget(null);
      setRefreshing(true);
      await onRefresh();
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally {
      setDeleting(false);
      setRefreshing(false);
    }
  }

  function startEdit(s: WorkerSkill) {
    setEditingId(s.id);
    setEditForm({
      skill: s.skill,
      level: s.level ?? "",
      yearsExperience: s.yearsExperience != null ? String(s.yearsExperience) : "",
      certification: s.certification ?? "",
    });
  }

  return (
    <div className="space-y-4">
      {/* Add form */}
      {showAdd ? (
        <Card className="border-primary/30 bg-primary/[0.02]">
          <CardHeader className="pb-3 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Star className="h-4 w-4 text-primary" />
                Nouvelle compétence
              </CardTitle>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 -mr-1"
                onClick={resetAdd}
                disabled={saving}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="sm:col-span-2">
                <Label className="text-xs">
                  Compétence <span className="text-destructive">*</span>
                </Label>
                <Input
                  className="mt-1 h-8 text-sm"
                  value={form.skill}
                  onChange={e => setForm(f => ({ ...f, skill: e.target.value }))}
                  placeholder="Ex : Pâtisserie, Découpe, Gestion…"
                  disabled={saving}
                  onKeyDown={e => e.key === "Enter" && addSkill()}
                  autoFocus
                />
              </div>
              <div>
                <Label className="text-xs">Niveau</Label>
                <Select
                  value={form.level}
                  onValueChange={v => setForm(f => ({ ...f, level: v }))}
                  disabled={saving}
                >
                  <SelectTrigger className="mt-1 h-8 text-sm">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {SKILL_LEVELS.map(l => (
                      <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Années d'exp.</Label>
                <Input
                  type="number"
                  min="0"
                  max="50"
                  className="mt-1 h-8 text-sm"
                  value={form.yearsExperience}
                  onChange={e => setForm(f => ({ ...f, yearsExperience: e.target.value }))}
                  disabled={saving}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Certification / Diplôme lié</Label>
              <Input
                className="mt-1 h-8 text-sm"
                value={form.certification}
                onChange={e => setForm(f => ({ ...f, certification: e.target.value }))}
                placeholder="Ex : BEP Cuisine, CAP Pâtisserie…"
                disabled={saving}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={resetAdd} disabled={saving}>
                Annuler
              </Button>
              <Button size="sm" onClick={addSkill} disabled={saving || !form.skill.trim()}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                {saving ? "Ajout…" : "Ajouter"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {worker.skills.length === 0
              ? "Aucune compétence enregistrée"
              : `${worker.skills.length} compétence${worker.skills.length > 1 ? "s" : ""}`}
          </p>
          <Button size="sm" variant="outline" onClick={() => setShowAdd(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Ajouter une compétence
          </Button>
        </div>
      )}

      {/* Skills list */}
      {worker.skills.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center text-muted-foreground">
            <Star className="h-10 w-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">Aucune compétence</p>
            <p className="text-xs mt-1">
              Documentez les savoir-faire de cet employé pour le valoriser.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className={`transition-opacity ${refreshing ? "opacity-50 pointer-events-none" : ""}`}>
          <CardContent className="p-0">
            <div className="divide-y">
              {worker.skills.map(s => (
                <div key={s.id} className="px-4 py-3 group">
                  {editingId === s.id ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="sm:col-span-2">
                          <Input
                            className="h-7 text-sm"
                            value={editForm.skill}
                            onChange={e => setEditForm(f => ({ ...f, skill: e.target.value }))}
                            autoFocus
                          />
                        </div>
                        <Select
                          value={editForm.level}
                          onValueChange={v => setEditForm(f => ({ ...f, level: v }))}
                        >
                          <SelectTrigger className="h-7 text-sm">
                            <SelectValue placeholder="Niveau" />
                          </SelectTrigger>
                          <SelectContent>
                            {SKILL_LEVELS.map(l => (
                              <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          type="number"
                          min="0"
                          className="h-7 text-sm"
                          placeholder="Années"
                          value={editForm.yearsExperience}
                          onChange={e => setEditForm(f => ({ ...f, yearsExperience: e.target.value }))}
                        />
                      </div>
                      <Input
                        className="h-7 text-sm"
                        placeholder="Certification"
                        value={editForm.certification}
                        onChange={e => setEditForm(f => ({ ...f, certification: e.target.value }))}
                      />
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={() => saveEdit(s.id)}
                          disabled={saving}
                        >
                          {saving
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <Check className="h-3 w-3" />}
                          Sauvegarder
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs gap-1"
                          onClick={() => setEditingId(null)}
                          disabled={saving}
                        >
                          <X className="h-3 w-3" />Annuler
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center flex-wrap gap-1.5 mb-0.5">
                          <span className="text-sm font-medium">{s.skill}</span>
                          <LevelBadge level={s.level} />
                        </div>
                        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                          {s.yearsExperience != null && (
                            <span>
                              {s.yearsExperience} an{s.yearsExperience !== 1 ? "s" : ""} d'expérience
                            </span>
                          )}
                          {s.certification && (
                            <span className="flex items-center gap-1">
                              <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
                              {s.certification}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => startEdit(s)}
                          title="Modifier"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setDeleteTarget(s)}
                          title="Supprimer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={v => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette compétence ?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground">{deleteTarget?.skill}</strong> sera supprimée
              définitivement du profil.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteSkill}
              disabled={deleting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
