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
import {
  CalendarCheck, ChevronLeft, ChevronRight, Loader2,
  Plus, Pencil, Trash2, X, Check,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { WorkerProfile } from "../types";

const AUTH = () => ({ Authorization: `Bearer ${localStorage.getItem("erp_token")}` });
const AUTHJSON = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` });

const STATUSES = [
  { value: "present",  label: "Présent",           color: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500" },
  { value: "late",     label: "En retard",          color: "bg-amber-100 text-amber-700",    dot: "bg-amber-500" },
  { value: "absent",   label: "Absent",             color: "bg-red-100 text-red-700",        dot: "bg-red-500" },
  { value: "vacation", label: "Congé",              color: "bg-blue-100 text-blue-700",      dot: "bg-blue-500" },
  { value: "sick",     label: "Congé maladie",      color: "bg-purple-100 text-purple-700",  dot: "bg-purple-500" },
  { value: "half_day", label: "Demi-journée",       color: "bg-orange-100 text-orange-700",  dot: "bg-orange-500" },
] as const;

function getStatus(value: string | null) {
  return STATUSES.find(s => s.value === value) ?? STATUSES[0];
}

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("fr-FR", {
    weekday: "short", day: "numeric", month: "short",
  });
}

interface AttendanceRecord {
  id: number;
  workerId: number;
  date: string;
  status: string;
  checkIn: string | null;
  checkOut: string | null;
  reason: string | null;
  notes: string | null;
}

interface Props { worker: WorkerProfile }

export function TabPresence({ worker }: Props) {
  const qc = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<AttendanceRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AttendanceRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [fDate, setFDate] = useState(new Date().toISOString().split("T")[0]);
  const [fStatus, setFStatus] = useState("present");
  const [fCheckIn, setFCheckIn] = useState("");
  const [fCheckOut, setFCheckOut] = useState("");
  const [fReason, setFReason] = useState("");
  const [fNotes, setFNotes] = useState("");

  const monthStr = `${year}-${String(month).padStart(2, "0")}`;

  const { data: records = [], isLoading } = useQuery<AttendanceRecord[]>({
    queryKey: ["worker-attendance", worker.id, monthStr],
    queryFn: async () => {
      const r = await fetch(`/api/workers/${worker.id}/attendance?month=${monthStr}`, { headers: AUTH() });
      if (!r.ok) throw new Error("Erreur chargement présence");
      return r.json();
    },
    staleTime: 60_000,
  });

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    const now2 = new Date();
    if (year * 100 + month >= now2.getFullYear() * 100 + now2.getMonth() + 1) return;
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  }

  function openAdd() {
    setEditTarget(null);
    setFDate(new Date().toISOString().split("T")[0]);
    setFStatus("present"); setFCheckIn(""); setFCheckOut("");
    setFReason(""); setFNotes("");
    setShowForm(true);
  }

  function openEdit(r: AttendanceRecord) {
    setEditTarget(r);
    setFDate(r.date);
    setFStatus(r.status);
    setFCheckIn(r.checkIn ?? "");
    setFCheckOut(r.checkOut ?? "");
    setFReason(r.reason ?? "");
    setFNotes(r.notes ?? "");
    setShowForm(true);
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const body = {
        date: fDate, status: fStatus,
        checkIn: fCheckIn || null, checkOut: fCheckOut || null,
        reason: fReason || null, notes: fNotes || null,
      };
      const url = `/api/workers/${worker.id}/attendance${editTarget ? `/${editTarget.id}` : ""}`;
      const method = editTarget ? "PATCH" : "POST";
      const r = await fetch(url, { method, headers: AUTHJSON(), body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Erreur");
      toast({ title: `✓ Présence ${editTarget ? "mise à jour" : "enregistrée"}` });
      setShowForm(false);
      qc.invalidateQueries({ queryKey: ["worker-attendance", worker.id] });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function deleteRecord() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/workers/${worker.id}/attendance/${deleteTarget.id}`, {
        method: "DELETE", headers: AUTH(),
      });
      if (!r.ok) throw new Error("Erreur suppression");
      toast({ title: "Entrée supprimée" });
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["worker-attendance", worker.id] });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally { setDeleting(false); }
  }

  // Summary stats
  const present = records.filter(r => r.status === "present").length;
  const late = records.filter(r => r.status === "late").length;
  const absent = records.filter(r => r.status === "absent").length;
  const vacation = records.filter(r => r.status === "vacation" || r.status === "sick").length;
  const halfDay = records.filter(r => r.status === "half_day").length;
  const total = records.length;
  const attRate = total > 0 ? Math.round(((present + late + halfDay * 0.5) / total) * 100) : null;

  const monthLabel = new Date(year, month - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;

  return (
    <div className="space-y-4">
      {/* Month navigator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={prevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium capitalize min-w-[130px] text-center">{monthLabel}</span>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={nextMonth} disabled={isCurrentMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        {!showForm && (
          <Button size="sm" variant="outline" onClick={openAdd} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />Ajouter
          </Button>
        )}
      </div>

      {/* Stats */}
      {total > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {[
            { label: "Présent", value: present, color: "text-emerald-600" },
            { label: "Retard",  value: late,    color: "text-amber-600" },
            { label: "Absent",  value: absent,  color: "text-red-600" },
            { label: "Congé",   value: vacation, color: "text-blue-600" },
            { label: "½ jour",  value: halfDay,  color: "text-orange-600" },
            { label: "Taux",    value: attRate !== null ? `${attRate}%` : "—", color: "text-primary" },
          ].map(s => (
            <Card key={s.label} className="text-center">
              <CardContent className="p-2">
                <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                <p className="text-[10px] text-muted-foreground">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add/Edit Form */}
      {showForm && (
        <Card className="border-primary/30 bg-primary/[0.02]">
          <CardHeader className="pb-3 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <CalendarCheck className="h-4 w-4 text-primary" />
                {editTarget ? "Modifier l'entrée" : "Nouvelle entrée de présence"}
              </CardTitle>
              <Button variant="ghost" size="icon" className="h-6 w-6 -mr-1" onClick={() => setShowForm(false)} disabled={saving}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <Label className="text-xs">Date <span className="text-destructive">*</span></Label>
                <Input type="date" className="mt-1 h-8 text-sm" value={fDate}
                  onChange={e => setFDate(e.target.value)} disabled={saving}
                  max={new Date().toISOString().split("T")[0]} />
              </div>
              <div>
                <Label className="text-xs">Statut <span className="text-destructive">*</span></Label>
                <Select value={fStatus} onValueChange={setFStatus} disabled={saving}>
                  <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map(s => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Heure d'entrée</Label>
                <Input type="time" className="mt-1 h-8 text-sm" value={fCheckIn}
                  onChange={e => setFCheckIn(e.target.value)} disabled={saving} />
              </div>
              <div>
                <Label className="text-xs">Heure de sortie</Label>
                <Input type="time" className="mt-1 h-8 text-sm" value={fCheckOut}
                  onChange={e => setFCheckOut(e.target.value)} disabled={saving} />
              </div>
            </div>
            {(fStatus === "absent" || fStatus === "late" || fStatus === "sick") && (
              <div>
                <Label className="text-xs">Motif</Label>
                <Input className="mt-1 h-8 text-sm" value={fReason}
                  onChange={e => setFReason(e.target.value)} disabled={saving}
                  placeholder="Raison de l'absence / retard…" />
              </div>
            )}
            <div>
              <Label className="text-xs">Notes</Label>
              <Textarea className="mt-1 text-sm resize-none" rows={2} value={fNotes}
                onChange={e => setFNotes(e.target.value)} disabled={saving} />
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

      {/* Records list */}
      {isLoading ? (
        <Card><CardContent className="py-12 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>
      ) : records.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center text-muted-foreground">
            <CalendarCheck className="h-10 w-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">Aucune donnée de présence</p>
            <p className="text-xs mt-1">Commencez par enregistrer les présences pour ce mois.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {records.map(rec => {
                const s = getStatus(rec.status);
                return (
                  <div key={rec.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 group">
                    <div className={`h-2 w-2 rounded-full shrink-0 ${s.dot}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium capitalize">{formatDate(rec.date)}</span>
                        <Badge className={`text-[10px] ${s.color} hover:${s.color}`}>{s.label}</Badge>
                      </div>
                      <div className="flex gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
                        {rec.checkIn && <span>Entrée : {rec.checkIn.slice(0, 5)}</span>}
                        {rec.checkOut && <span>Sortie : {rec.checkOut.slice(0, 5)}</span>}
                        {rec.reason && <span className="italic truncate max-w-[200px]">{rec.reason}</span>}
                      </div>
                    </div>
                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(rec)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setDeleteTarget(rec)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={v => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette entrée ?</AlertDialogTitle>
            <AlertDialogDescription>
              L'entrée du {deleteTarget && formatDate(deleteTarget.date)} sera définitivement supprimée.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={deleteRecord} disabled={deleting} className="bg-destructive hover:bg-destructive/90">
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
