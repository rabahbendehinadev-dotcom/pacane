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
import { Gift, Plus, Trash2, X, Loader2, Banknote } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { WorkerProfile } from "../types";

const AUTHJSON = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` });
const AUTH = () => ({ Authorization: `Bearer ${localStorage.getItem("erp_token")}` });

const BONUS_TYPES = [
  { value: "performance", label: "Performance",       color: "bg-emerald-100 text-emerald-700" },
  { value: "attendance",  label: "Assiduité",         color: "bg-blue-100 text-blue-700" },
  { value: "loyalty",     label: "Fidélité",          color: "bg-purple-100 text-purple-700" },
  { value: "special",     label: "Exceptionnel",      color: "bg-amber-100 text-amber-700" },
  { value: "other",       label: "Autre",             color: "bg-slate-100 text-slate-700" },
];

function getBonusType(v: string | null) {
  return BONUS_TYPES.find(b => b.value === v) ?? BONUS_TYPES[0];
}

interface Bonus {
  id: number;
  workerId: number;
  amount: string;
  reason: string;
  bonusType: string | null;
  bonusDate: string;
  createdAt: string;
}

interface Props { worker: WorkerProfile }

export function TabPrimes({ worker }: Props) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Bonus | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [fAmount, setFAmount] = useState("");
  const [fReason, setFReason] = useState("");
  const [fType, setFType] = useState("performance");
  const [fDate, setFDate] = useState(new Date().toISOString().split("T")[0]);

  const { data: bonuses = [], isLoading } = useQuery<Bonus[]>({
    queryKey: ["worker-bonuses", worker.id],
    queryFn: async () => {
      const r = await fetch(`/api/workers/${worker.id}/bonuses`, { headers: AUTH() });
      if (!r.ok) throw new Error("Erreur");
      return r.json();
    },
    staleTime: 30_000,
  });

  function resetForm() { setFAmount(""); setFReason(""); setFType("performance"); setFDate(new Date().toISOString().split("T")[0]); setShowForm(false); }

  async function submit() {
    if (!fAmount || !fReason.trim()) { toast({ title: "Montant et raison requis", variant: "destructive" }); return; }
    const amt = parseFloat(fAmount.replace(",", "."));
    if (isNaN(amt) || amt <= 0) { toast({ title: "Montant invalide", variant: "destructive" }); return; }
    if (saving) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/workers/${worker.id}/bonuses`, {
        method: "POST",
        headers: AUTHJSON(),
        body: JSON.stringify({ amount: amt, reason: fReason.trim(), bonusType: fType, bonusDate: fDate }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Erreur");
      toast({ title: `✓ Prime de ${amt.toLocaleString("fr-FR")} DA accordée` });
      resetForm();
      qc.invalidateQueries({ queryKey: ["worker-bonuses", worker.id] });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function deleteBonus() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/workers/${worker.id}/bonuses/${deleteTarget.id}`, {
        method: "DELETE", headers: AUTH(),
      });
      if (!r.ok) throw new Error("Erreur");
      toast({ title: "Prime supprimée" });
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["worker-bonuses", worker.id] });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally { setDeleting(false); }
  }

  const totalAmount = bonuses.reduce((sum, b) => sum + parseFloat(b.amount), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {bonuses.length > 0 ? (
            <span>
              {bonuses.length} prime{bonuses.length > 1 ? "s" : ""} ·{" "}
              <span className="font-semibold text-emerald-600">{totalAmount.toLocaleString("fr-FR")} DA</span> au total
            </span>
          ) : (
            <span>Aucune prime enregistrée</span>
          )}
        </div>
        {!showForm && (
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />Accorder une prime
          </Button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <Card className="border-emerald-200 bg-emerald-50/30">
          <CardHeader className="pb-3 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Gift className="h-4 w-4 text-emerald-600" />
                Nouvelle prime / récompense
              </CardTitle>
              <Button variant="ghost" size="icon" className="h-6 w-6 -mr-1" onClick={resetForm} disabled={saving}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <Label className="text-xs">Montant (DA) <span className="text-destructive">*</span></Label>
                <Input type="number" min="1" className="mt-1 h-8 text-sm" value={fAmount}
                  onChange={e => setFAmount(e.target.value)} placeholder="Ex : 5000" disabled={saving} autoFocus />
              </div>
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={fType} onValueChange={setFType} disabled={saving}>
                  <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BONUS_TYPES.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">Date</Label>
                <Input type="date" className="mt-1 h-8 text-sm" value={fDate}
                  onChange={e => setFDate(e.target.value)} disabled={saving}
                  max={new Date().toISOString().split("T")[0]} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Raison / Motif <span className="text-destructive">*</span></Label>
              <Textarea className="mt-1 text-sm resize-none" rows={2} value={fReason}
                onChange={e => setFReason(e.target.value)} disabled={saving}
                placeholder="Ex : Excellent résultat de production en juillet…" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={resetForm} disabled={saving}>Annuler</Button>
              <Button size="sm" onClick={submit} disabled={saving || !fAmount || !fReason.trim()}
                className="bg-emerald-600 hover:bg-emerald-700 text-white">
                {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Gift className="h-3.5 w-3.5 mr-1.5" />}
                {saving ? "Enregistrement…" : "Accorder la prime"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* List */}
      {isLoading ? (
        <Card><CardContent className="py-12 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>
      ) : bonuses.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center text-muted-foreground">
            <Gift className="h-10 w-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">Aucune prime accordée</p>
            <p className="text-xs mt-1">Récompensez vos meilleurs collaborateurs.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {bonuses.map(b => {
                const t = getBonusType(b.bonusType);
                const amt = parseFloat(b.amount);
                return (
                  <div key={b.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 group">
                    <Banknote className="h-4 w-4 text-emerald-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-emerald-700">+{amt.toLocaleString("fr-FR")} DA</span>
                        <Badge className={`text-[10px] ${t.color} hover:${t.color}`}>{t.label}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{b.reason}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {new Date(b.bonusDate + "T00:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => setDeleteTarget(b)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
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
            <AlertDialogTitle>Supprimer cette prime ?</AlertDialogTitle>
            <AlertDialogDescription>
              La prime de <strong className="text-foreground">{deleteTarget && parseFloat(deleteTarget.amount).toLocaleString("fr-FR")} DA</strong> sera définitivement supprimée.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={deleteBonus} disabled={deleting} className="bg-destructive hover:bg-destructive/90">
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
