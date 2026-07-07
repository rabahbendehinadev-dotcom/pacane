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
import { Send, Plus, X, Loader2, CheckCircle2, XCircle, Clock, CalendarDays, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { WorkerProfile } from "../types";

const AUTH = () => ({ Authorization: `Bearer ${localStorage.getItem("erp_token")}` });
const AUTHJSON = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` });

const REQUEST_TYPES = [
  { value: "conge",            label: "Demande de congé",       icon: "🏖️" },
  { value: "maladie",          label: "Congé maladie",          icon: "🏥" },
  { value: "avance",           label: "Avance sur salaire",     icon: "💰" },
  { value: "changement_horaire", label: "Changement de dossier", icon: "🔄" },
  { value: "autre",            label: "Autre demande",          icon: "📋" },
];

const STATUS_CFG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  pending:  { label: "En attente",  color: "bg-amber-100 text-amber-700",   icon: Clock },
  approved: { label: "Approuvée",   color: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 },
  rejected: { label: "Refusée",     color: "bg-red-100 text-red-700",       icon: XCircle },
};

interface WorkerRequest {
  id: number;
  workerId: number;
  type: string;
  title: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  amount: string | null;
  status: string;
  responseNotes: string | null;
  respondedAt: string | null;
  createdAt: string;
}

interface Props { worker: WorkerProfile }

export function TabDemandes({ worker }: Props) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [responding, setResponding] = useState<{ id: number; action: "approved" | "rejected" } | null>(null);
  const [responseNotes, setResponseNotes] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<WorkerRequest | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [fType, setFType] = useState("conge");
  const [fTitle, setFTitle] = useState("");
  const [fDesc, setFDesc] = useState("");
  const [fStartDate, setFStartDate] = useState("");
  const [fEndDate, setFEndDate] = useState("");
  const [fAmount, setFAmount] = useState("");

  const { data: requests = [], isLoading } = useQuery<WorkerRequest[]>({
    queryKey: ["worker-requests", worker.id],
    queryFn: async () => {
      const r = await fetch(`/api/workers/${worker.id}/requests`, { headers: AUTH() });
      if (!r.ok) throw new Error("Erreur");
      return r.json();
    },
    staleTime: 30_000,
  });

  function resetForm() {
    setFType("conge"); setFTitle(""); setFDesc("");
    setFStartDate(""); setFEndDate(""); setFAmount("");
    setShowForm(false);
  }

  function autoTitle(type: string) {
    const t = REQUEST_TYPES.find(t => t.value === type);
    return t ? t.label : "";
  }

  async function submit() {
    if (!fTitle.trim()) { toast({ title: "Titre requis", variant: "destructive" }); return; }
    if (saving) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/workers/${worker.id}/requests`, {
        method: "POST",
        headers: AUTHJSON(),
        body: JSON.stringify({
          type: fType,
          title: fTitle.trim(),
          description: fDesc.trim() || null,
          startDate: fStartDate || null,
          endDate: fEndDate || null,
          amount: fAmount ? parseFloat(fAmount) : null,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Erreur");
      toast({ title: "✓ Demande soumise" });
      resetForm();
      qc.invalidateQueries({ queryKey: ["worker-requests", worker.id] });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function respond(reqId: number, status: "approved" | "rejected") {
    if (responding) return;
    setResponding({ id: reqId, action: status });
    try {
      const r = await fetch(`/api/workers/${worker.id}/requests/${reqId}`, {
        method: "PATCH",
        headers: AUTHJSON(),
        body: JSON.stringify({ status, responseNotes: responseNotes.trim() || null }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Erreur");
      toast({ title: status === "approved" ? "✓ Demande approuvée" : "Demande refusée" });
      setResponseNotes("");
      qc.invalidateQueries({ queryKey: ["worker-requests", worker.id] });
      qc.invalidateQueries({ queryKey: ["hr-pending-requests"] });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally { setResponding(null); }
  }

  async function deleteReq() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/workers/${worker.id}/requests/${deleteTarget.id}`, {
        method: "DELETE", headers: AUTH(),
      });
      if (!r.ok) throw new Error("Erreur");
      toast({ title: "Demande supprimée" });
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["worker-requests", worker.id] });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally { setDeleting(false); }
  }

  const pending = requests.filter(r => r.status === "pending").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {pending > 0 && <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">{pending} en attente</Badge>}
          {requests.length === 0 && <span>Aucune demande</span>}
        </div>
        {!showForm && (
          <Button size="sm" variant="outline" onClick={() => { setShowForm(true); setFTitle(autoTitle("conge")); }} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />Nouvelle demande
          </Button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <Card className="border-primary/30 bg-primary/[0.02]">
          <CardHeader className="pb-3 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Send className="h-4 w-4 text-primary" />Nouvelle demande
              </CardTitle>
              <Button variant="ghost" size="icon" className="h-6 w-6 -mr-1" onClick={resetForm} disabled={saving}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Type de demande</Label>
                <Select value={fType} onValueChange={v => { setFType(v); setFTitle(autoTitle(v)); }} disabled={saving}>
                  <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REQUEST_TYPES.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.icon} {t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Titre <span className="text-destructive">*</span></Label>
                <Input className="mt-1 h-8 text-sm" value={fTitle} onChange={e => setFTitle(e.target.value)}
                  placeholder="Titre de la demande" disabled={saving} />
              </div>
            </div>
            {(fType === "conge" || fType === "maladie") && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Date début</Label>
                  <Input type="date" className="mt-1 h-8 text-sm" value={fStartDate} onChange={e => setFStartDate(e.target.value)} disabled={saving} />
                </div>
                <div>
                  <Label className="text-xs">Date fin</Label>
                  <Input type="date" className="mt-1 h-8 text-sm" value={fEndDate} onChange={e => setFEndDate(e.target.value)} disabled={saving} />
                </div>
              </div>
            )}
            {fType === "avance" && (
              <div>
                <Label className="text-xs">Montant demandé (DA)</Label>
                <Input type="number" min="0" className="mt-1 h-8 text-sm" value={fAmount} onChange={e => setFAmount(e.target.value)}
                  placeholder="Ex : 5000" disabled={saving} />
              </div>
            )}
            <div>
              <Label className="text-xs">Description / Justification</Label>
              <Textarea className="mt-1 text-sm resize-none" rows={3} value={fDesc} onChange={e => setFDesc(e.target.value)}
                placeholder="Précisez les détails de votre demande…" disabled={saving} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={resetForm} disabled={saving}>Annuler</Button>
              <Button size="sm" onClick={submit} disabled={saving || !fTitle.trim()}>
                {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
                {saving ? "Envoi…" : "Soumettre"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* List */}
      {isLoading ? (
        <Card><CardContent className="py-12 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>
      ) : requests.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center text-muted-foreground">
            <Send className="h-10 w-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">Aucune demande enregistrée</p>
            <p className="text-xs mt-1">Les demandes de congé, avance, etc. apparaîtront ici.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {requests.map(req => {
            const sCfg = STATUS_CFG[req.status] ?? STATUS_CFG.pending;
            const SIcon = sCfg.icon;
            const typeInfo = REQUEST_TYPES.find(t => t.value === req.type);
            return (
              <Card key={req.id} className={req.status === "approved" ? "border-emerald-200" : req.status === "rejected" ? "border-red-200 opacity-70" : ""}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <span className="text-xl shrink-0 mt-0.5">{typeInfo?.icon ?? "📋"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-sm font-medium">{req.title}</span>
                        <Badge className={`text-[10px] ${sCfg.color} hover:${sCfg.color} flex items-center gap-0.5`}>
                          <SIcon className="h-2.5 w-2.5" />{sCfg.label}
                        </Badge>
                      </div>
                      {req.description && <p className="text-xs text-muted-foreground mb-1">{req.description}</p>}
                      <div className="flex gap-3 text-[10px] text-muted-foreground flex-wrap">
                        {req.startDate && <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />{new Date(req.startDate + "T00:00:00").toLocaleDateString("fr-FR")} {req.endDate && req.endDate !== req.startDate && `→ ${new Date(req.endDate + "T00:00:00").toLocaleDateString("fr-FR")}`}</span>}
                        {req.amount && <span>💰 {parseFloat(req.amount).toLocaleString("fr-FR")} DA</span>}
                        <span>Soumis le {new Date(req.createdAt).toLocaleDateString("fr-FR")}</span>
                      </div>
                      {req.status !== "pending" && req.responseNotes && (
                        <p className="mt-1.5 text-xs italic text-muted-foreground border-l-2 border-muted pl-2">{req.responseNotes}</p>
                      )}
                      {req.status === "pending" && (
                        <div className="mt-3 space-y-2">
                          <Input className="h-7 text-xs" placeholder="Commentaire de réponse (optionnel)"
                            value={responding?.id === req.id ? responseNotes : ""}
                            onChange={e => setResponseNotes(e.target.value)}
                            disabled={!!responding} />
                          <div className="flex gap-2">
                            <Button size="sm" className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                              onClick={() => respond(req.id, "approved")}
                              disabled={responding?.id === req.id}>
                              {responding?.id === req.id && responding.action === "approved"
                                ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                              Approuver
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-red-600 border-red-200 hover:bg-red-50"
                              onClick={() => respond(req.id, "rejected")}
                              disabled={responding?.id === req.id}>
                              {responding?.id === req.id && responding.action === "rejected"
                                ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                              Refuser
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setDeleteTarget(req)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
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
            <AlertDialogTitle>Supprimer cette demande ?</AlertDialogTitle>
            <AlertDialogDescription>
              "<strong>{deleteTarget?.title}</strong>" sera définitivement supprimée.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={deleteReq} disabled={deleting} className="bg-destructive hover:bg-destructive/90">
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
