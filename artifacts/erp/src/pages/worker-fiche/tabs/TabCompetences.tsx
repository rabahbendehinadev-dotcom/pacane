import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Star, Plus, Trash2, X, Check, Pencil } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { WorkerProfile, WorkerSkill } from "../types";
import { SKILL_LEVELS } from "../types";

const AUTH = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` });
const AUTH_PLAIN = () => ({ Authorization: `Bearer ${localStorage.getItem("erp_token")}` });

function LevelBadge({ level }: { level: string | null }) {
  if (!level) return null;
  const cfg = SKILL_LEVELS.find(l => l.value === level);
  return <Badge className={`text-xs ${cfg?.color ?? "bg-slate-100 text-slate-700"} hover:${cfg?.color}`}>{cfg?.label ?? level}</Badge>;
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
  onRefresh: () => void;
}

export function TabCompetences({ worker, onRefresh }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<SkillFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<SkillFormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<WorkerSkill | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function addSkill() {
    if (!form.skill.trim()) { toast({ title: "Compétence requise", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const r = await fetch(`/api/workers/${worker.id}/skills`, {
        method: "POST", headers: AUTH(),
        body: JSON.stringify({ skill: form.skill.trim(), level: form.level || null, yearsExperience: form.yearsExperience || null, certification: form.certification.trim() || null }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      toast({ title: "Compétence ajoutée" });
      setForm(EMPTY_FORM);
      setShowAdd(false);
      onRefresh();
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function saveEdit(id: number) {
    setSaving(true);
    try {
      const r = await fetch(`/api/workers/${worker.id}/skills/${id}`, {
        method: "PATCH", headers: AUTH(),
        body: JSON.stringify({ skill: editForm.skill.trim(), level: editForm.level || null, yearsExperience: editForm.yearsExperience || null, certification: editForm.certification.trim() || null }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      toast({ title: "Compétence mise à jour" });
      setEditingId(null);
      onRefresh();
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function deleteSkill() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/workers/${worker.id}/skills/${deleteTarget.id}`, { method: "DELETE", headers: AUTH_PLAIN() });
      if (!r.ok) throw new Error((await r.json()).error);
      toast({ title: "Compétence supprimée" });
      setDeleteTarget(null);
      onRefresh();
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally { setDeleting(false); }
  }

  function startEdit(s: WorkerSkill) {
    setEditingId(s.id);
    setEditForm({ skill: s.skill, level: s.level ?? "", yearsExperience: s.yearsExperience != null ? String(s.yearsExperience) : "", certification: s.certification ?? "" });
  }

  return (
    <div className="space-y-4">
      {/* Add form */}
      {showAdd ? (
        <Card className="border-primary/30">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Star className="h-4 w-4 text-primary" />Nouvelle compétence
              </CardTitle>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowAdd(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="sm:col-span-2">
                <Label className="text-xs">Compétence <span className="text-destructive">*</span></Label>
                <Input className="mt-1 h-8 text-sm" value={form.skill} onChange={e => setForm(f => ({ ...f, skill: e.target.value }))} placeholder="Ex: Pâtisserie, Découpe, Emballage..." />
              </div>
              <div>
                <Label className="text-xs">Niveau</Label>
                <Select value={form.level} onValueChange={v => setForm(f => ({ ...f, level: v }))}>
                  <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {SKILL_LEVELS.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Années d'expérience</Label>
                <Input type="number" min="0" className="mt-1 h-8 text-sm" value={form.yearsExperience} onChange={e => setForm(f => ({ ...f, yearsExperience: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Certification / Diplôme</Label>
              <Input className="mt-1 h-8 text-sm" value={form.certification} onChange={e => setForm(f => ({ ...f, certification: e.target.value }))} placeholder="Ex: BEP Cuisine, CAP..." />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowAdd(false)}>Annuler</Button>
              <Button size="sm" onClick={addSkill} disabled={saving || !form.skill.trim()}>
                {saving ? "..." : "Ajouter"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => setShowAdd(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />Ajouter une compétence
          </Button>
        </div>
      )}

      {/* Skills list */}
      {worker.skills.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Star className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Aucune compétence enregistrée</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {worker.skills.map(s => (
                <div key={s.id} className="px-4 py-3">
                  {editingId === s.id ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="sm:col-span-2">
                          <Input className="h-7 text-sm" value={editForm.skill} onChange={e => setEditForm(f => ({ ...f, skill: e.target.value }))} />
                        </div>
                        <Select value={editForm.level} onValueChange={v => setEditForm(f => ({ ...f, level: v }))}>
                          <SelectTrigger className="h-7 text-sm"><SelectValue placeholder="Niveau" /></SelectTrigger>
                          <SelectContent>
                            {SKILL_LEVELS.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Input type="number" min="0" className="h-7 text-sm" placeholder="Années" value={editForm.yearsExperience} onChange={e => setEditForm(f => ({ ...f, yearsExperience: e.target.value }))} />
                      </div>
                      <Input className="h-7 text-sm" placeholder="Certification" value={editForm.certification} onChange={e => setEditForm(f => ({ ...f, certification: e.target.value }))} />
                      <div className="flex gap-2">
                        <Button size="sm" className="h-6 text-xs" onClick={() => saveEdit(s.id)} disabled={saving}><Check className="h-3 w-3 mr-1" />OK</Button>
                        <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setEditingId(null)}><X className="h-3 w-3 mr-1" />Annuler</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 group">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center flex-wrap gap-2 mb-0.5">
                          <span className="text-sm font-medium">{s.skill}</span>
                          <LevelBadge level={s.level} />
                        </div>
                        <div className="flex gap-3 text-xs text-muted-foreground">
                          {s.yearsExperience != null && <span>{s.yearsExperience} an{s.yearsExperience !== 1 ? "s" : ""} d'expérience</span>}
                          {s.certification && <span>· {s.certification}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(s)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setDeleteTarget(s)}>
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
            <AlertDialogDescription><strong>{deleteTarget?.skill}</strong> sera supprimée.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={deleteSkill} disabled={deleting} className="bg-destructive hover:bg-destructive/90">
              {deleting ? "..." : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
