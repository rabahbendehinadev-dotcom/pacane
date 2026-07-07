import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft, ChevronRight, Plus, Pencil, X, Loader2,
  Check, Banknote, TrendingUp, TrendingDown, Printer, FileText,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { WorkerProfile } from "../types";

const AUTH = () => ({ Authorization: `Bearer ${localStorage.getItem("erp_token")}` });
const AUTHJSON = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` });

interface Salary {
  id: number;
  workerId: number;
  month: string;
  baseSalary: string;
  bonuses: string;
  deductions: string;
  overtimeHours: string;
  overtimeAmount: string;
  advance: string;
  notes: string | null;
  createdAt: string;
}

function computeNet(s: Salary | null): number {
  if (!s) return 0;
  return (
    parseFloat(s.baseSalary || "0") +
    parseFloat(s.bonuses || "0") +
    parseFloat(s.overtimeAmount || "0") -
    parseFloat(s.deductions || "0") -
    parseFloat(s.advance || "0")
  );
}

function fmt(v: string | number | null | undefined) {
  const n = parseFloat(String(v ?? "0"));
  if (isNaN(n) || n === 0) return "—";
  return n.toLocaleString("fr-FR") + " DA";
}

interface Props { worker: WorkerProfile }

export function TabSalaire({ worker }: Props) {
  const qc = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [fBase, setFBase] = useState("");
  const [fBonuses, setFBonuses] = useState("");
  const [fDeductions, setFDeductions] = useState("");
  const [fOTHours, setFOTHours] = useState("");
  const [fOTAmount, setFOTAmount] = useState("");
  const [fAdvance, setFAdvance] = useState("");
  const [fNotes, setFNotes] = useState("");

  const monthStr = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthLabel = new Date(year, month - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;

  const { data: salary, isLoading } = useQuery<Salary | null>({
    queryKey: ["worker-salary", worker.id, year, month],
    queryFn: async () => {
      const r = await fetch(`/api/workers/${worker.id}/salary?month=${monthStr.slice(0, 7)}`, { headers: AUTH() });
      if (!r.ok) throw new Error("Erreur");
      const data = await r.json();
      return data ?? null;
    },
    staleTime: 60_000,
  });

  function openForm() {
    if (salary) {
      setFBase(salary.baseSalary || "");
      setFBonuses(salary.bonuses || "");
      setFDeductions(salary.deductions || "");
      setFOTHours(salary.overtimeHours || "");
      setFOTAmount(salary.overtimeAmount || "");
      setFAdvance(salary.advance || "");
      setFNotes(salary.notes || "");
    } else {
      setFBase(worker.baseSalary ? String(worker.baseSalary) : "");
      setFBonuses(""); setFDeductions(""); setFOTHours("");
      setFOTAmount(""); setFAdvance(""); setFNotes("");
    }
    setShowForm(true);
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const body = {
        month: monthStr.slice(0, 7),
        baseSalary: parseFloat(fBase) || 0,
        bonuses: parseFloat(fBonuses) || 0,
        deductions: parseFloat(fDeductions) || 0,
        overtimeHours: parseFloat(fOTHours) || 0,
        overtimeAmount: parseFloat(fOTAmount) || 0,
        advance: parseFloat(fAdvance) || 0,
        notes: fNotes || null,
      };
      const url = `/api/workers/${worker.id}/salary${salary ? `/${salary.id}` : ""}`;
      const method = salary ? "PATCH" : "POST";
      const r = await fetch(url, { method, headers: AUTHJSON(), body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Erreur");
      toast({ title: "✓ Fiche de paie enregistrée" });
      setShowForm(false);
      qc.invalidateQueries({ queryKey: ["worker-salary", worker.id] });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  function printPayslip() {
    if (!salary) return;
    const net = computeNet(salary);
    const content = `
      <html><head><title>Fiche de Paie — ${worker.name}</title>
      <style>
        body{font-family:Arial,sans-serif;padding:40px;color:#1a1a1a;max-width:700px;margin:auto}
        .header{text-align:center;border-bottom:2px solid #333;padding-bottom:16px;margin-bottom:24px}
        .title{font-size:22px;font-weight:bold;margin-bottom:4px}
        .subtitle{font-size:13px;color:#666}
        .section{margin-bottom:20px}
        .section-title{font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#888;margin-bottom:8px;font-weight:600}
        table{width:100%;border-collapse:collapse}
        td{padding:8px 12px;border-bottom:1px solid #eee;font-size:13px}
        td:last-child{text-align:right;font-weight:500}
        .positive{color:#16a34a}
        .negative{color:#dc2626}
        .net-row td{font-size:16px;font-weight:bold;border-top:2px solid #333;padding-top:12px}
        .footer{margin-top:40px;font-size:11px;color:#999;text-align:center;border-top:1px solid #eee;padding-top:16px}
      </style></head><body>
      <div class="header">
        <div class="title">FICHE DE PAIE</div>
        <div class="subtitle">Mois de ${monthLabel.toUpperCase()}</div>
      </div>
      <div class="section">
        <div class="section-title">Informations employé</div>
        <table>
          <tr><td>Nom complet</td><td>${worker.name}</td></tr>
          <tr><td>Poste</td><td>${worker.position || "—"}</td></tr>
          <tr><td>Département</td><td>${worker.department || "—"}</td></tr>
          <tr><td>Date d'embauche</td><td>${worker.hireDate ? new Date(worker.hireDate).toLocaleDateString("fr-FR") : "—"}</td></tr>
        </table>
      </div>
      <div class="section">
        <div class="section-title">Rémunération</div>
        <table>
          <tr><td class="positive">✚ Salaire de base</td><td>${parseFloat(salary.baseSalary).toLocaleString("fr-FR")} DA</td></tr>
          ${parseFloat(salary.bonuses) > 0 ? `<tr><td class="positive">✚ Primes et indemnités</td><td>${parseFloat(salary.bonuses).toLocaleString("fr-FR")} DA</td></tr>` : ""}
          ${parseFloat(salary.overtimeAmount) > 0 ? `<tr><td class="positive">✚ Heures supplémentaires (${parseFloat(salary.overtimeHours)}h)</td><td>${parseFloat(salary.overtimeAmount).toLocaleString("fr-FR")} DA</td></tr>` : ""}
          ${parseFloat(salary.deductions) > 0 ? `<tr><td class="negative">✖ Retenues / Cotisations</td><td>${parseFloat(salary.deductions).toLocaleString("fr-FR")} DA</td></tr>` : ""}
          ${parseFloat(salary.advance) > 0 ? `<tr><td class="negative">✖ Avance sur salaire</td><td>${parseFloat(salary.advance).toLocaleString("fr-FR")} DA</td></tr>` : ""}
          <tr class="net-row"><td>NET À PAYER</td><td class="${net >= 0 ? "positive" : "negative"}">${net.toLocaleString("fr-FR")} DA</td></tr>
        </table>
      </div>
      ${salary.notes ? `<div class="section"><div class="section-title">Notes</div><p style="font-size:13px;color:#555">${salary.notes}</p></div>` : ""}
      <div class="footer">Document généré le ${new Date().toLocaleDateString("fr-FR")} — Pacane ERP</div>
      </body></html>
    `;
    const win = window.open("", "_blank", "width=800,height=700");
    if (win) { win.document.write(content); win.document.close(); win.print(); }
  }

  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
    setShowForm(false);
  };
  const nextMonth = () => {
    if (isCurrentMonth) return;
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
    setShowForm(false);
  };

  const net = salary ? computeNet(salary) : null;

  return (
    <div className="space-y-4">
      {/* Month navigator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="text-sm font-medium capitalize min-w-[140px] text-center">{monthLabel}</span>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={nextMonth} disabled={isCurrentMonth}><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div className="flex gap-2">
          {salary && (
            <Button variant="outline" size="sm" onClick={printPayslip} className="gap-1.5">
              <Printer className="h-3.5 w-3.5" />Fiche de paie
            </Button>
          )}
          {!showForm && (
            <Button size="sm" variant="outline" onClick={openForm} className="gap-1.5">
              {salary ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {salary ? "Modifier" : "Saisir"}
            </Button>
          )}
        </div>
      </div>

      {/* Display salary or empty state */}
      {isLoading ? (
        <Card><CardContent className="py-12 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>
      ) : !showForm && !salary ? (
        <Card className="border-dashed">
          <CardContent className="py-14 text-center text-muted-foreground">
            <Banknote className="h-10 w-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">Aucune fiche de paie pour ce mois</p>
            <p className="text-xs mt-1">Cliquez sur "Saisir" pour enregistrer la paie de {monthLabel}.</p>
          </CardContent>
        </Card>
      ) : !showForm && salary ? (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="border-emerald-200 bg-emerald-50/40">
              <CardContent className="p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">Salaire de base</p>
                <p className="text-lg font-bold text-emerald-700">{parseFloat(salary.baseSalary).toLocaleString("fr-FR")} DA</p>
              </CardContent>
            </Card>
            {parseFloat(salary.bonuses) > 0 && (
              <Card className="border-blue-200 bg-blue-50/40">
                <CardContent className="p-4 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Primes</p>
                  <p className="text-lg font-bold text-blue-700">+{parseFloat(salary.bonuses).toLocaleString("fr-FR")} DA</p>
                </CardContent>
              </Card>
            )}
            {parseFloat(salary.deductions) > 0 && (
              <Card className="border-red-200 bg-red-50/40">
                <CardContent className="p-4 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Retenues</p>
                  <p className="text-lg font-bold text-red-700">-{parseFloat(salary.deductions).toLocaleString("fr-FR")} DA</p>
                </CardContent>
              </Card>
            )}
            {parseFloat(salary.advance) > 0 && (
              <Card className="border-orange-200 bg-orange-50/40">
                <CardContent className="p-4 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Avance</p>
                  <p className="text-lg font-bold text-orange-700">-{parseFloat(salary.advance).toLocaleString("fr-FR")} DA</p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Net salary highlight */}
          <Card className={`border-2 ${net !== null && net >= 0 ? "border-emerald-400 bg-emerald-50/60" : "border-red-400 bg-red-50/60"}`}>
            <CardContent className="p-5 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Net à payer</p>
                <p className={`text-3xl font-bold ${net !== null && net >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                  {net !== null ? `${net.toLocaleString("fr-FR")} DA` : "—"}
                </p>
                <p className="text-xs text-muted-foreground mt-1 capitalize">{monthLabel}</p>
              </div>
              <div className={`h-16 w-16 rounded-2xl flex items-center justify-center ${net !== null && net >= 0 ? "bg-emerald-100" : "bg-red-100"}`}>
                {net !== null && net >= 0
                  ? <TrendingUp className="h-8 w-8 text-emerald-600" />
                  : <TrendingDown className="h-8 w-8 text-red-600" />}
              </div>
            </CardContent>
          </Card>

          {/* Details */}
          <Card>
            <CardContent className="p-0">
              <div className="divide-y text-sm">
                {[
                  { label: "Salaire de base", value: salary.baseSalary, sign: "+", color: "text-emerald-600" },
                  { label: "Primes / Indemnités", value: salary.bonuses, sign: "+", color: "text-emerald-600" },
                  { label: `Heures sup. (${parseFloat(salary.overtimeHours || "0")}h)`, value: salary.overtimeAmount, sign: "+", color: "text-blue-600" },
                  { label: "Retenues / Cotisations", value: salary.deductions, sign: "-", color: "text-red-600" },
                  { label: "Avance sur salaire", value: salary.advance, sign: "-", color: "text-orange-600" },
                ].map(r => parseFloat(r.value) > 0 ? (
                  <div key={r.label} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-muted-foreground">{r.label}</span>
                    <span className={`font-medium ${r.color}`}>{r.sign}{parseFloat(r.value).toLocaleString("fr-FR")} DA</span>
                  </div>
                ) : null)}
              </div>
            </CardContent>
          </Card>

          {salary.notes && (
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground font-medium mb-1 uppercase tracking-wider">Notes</p>
                <p className="text-sm">{salary.notes}</p>
              </CardContent>
            </Card>
          )}
        </>
      ) : null}

      {/* Form */}
      {showForm && (
        <Card className="border-primary/30 bg-primary/[0.02]">
          <CardHeader className="pb-3 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                Saisie de paie — {monthLabel}
              </CardTitle>
              <Button variant="ghost" size="icon" className="h-6 w-6 -mr-1" onClick={() => setShowForm(false)} disabled={saving}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Salaire de base (DA)</Label>
                <Input type="number" min="0" className="mt-1 h-8 text-sm" value={fBase}
                  onChange={e => setFBase(e.target.value)} placeholder="Ex : 35000" disabled={saving} />
              </div>
              <div>
                <Label className="text-xs">Primes (DA)</Label>
                <Input type="number" min="0" className="mt-1 h-8 text-sm" value={fBonuses}
                  onChange={e => setFBonuses(e.target.value)} placeholder="0" disabled={saving} />
              </div>
              <div>
                <Label className="text-xs">Retenues (DA)</Label>
                <Input type="number" min="0" className="mt-1 h-8 text-sm" value={fDeductions}
                  onChange={e => setFDeductions(e.target.value)} placeholder="0" disabled={saving} />
              </div>
              <div>
                <Label className="text-xs">Heures sup. (h)</Label>
                <Input type="number" min="0" step="0.5" className="mt-1 h-8 text-sm" value={fOTHours}
                  onChange={e => setFOTHours(e.target.value)} placeholder="0" disabled={saving} />
              </div>
              <div>
                <Label className="text-xs">Montant H.S. (DA)</Label>
                <Input type="number" min="0" className="mt-1 h-8 text-sm" value={fOTAmount}
                  onChange={e => setFOTAmount(e.target.value)} placeholder="0" disabled={saving} />
              </div>
              <div>
                <Label className="text-xs">Avance (DA)</Label>
                <Input type="number" min="0" className="mt-1 h-8 text-sm" value={fAdvance}
                  onChange={e => setFAdvance(e.target.value)} placeholder="0" disabled={saving} />
              </div>
            </div>
            {/* Live net preview */}
            {fBase && (
              <div className={`rounded-lg p-3 text-center border ${
                (parseFloat(fBase||"0")+parseFloat(fBonuses||"0")+parseFloat(fOTAmount||"0")-parseFloat(fDeductions||"0")-parseFloat(fAdvance||"0")) >= 0
                  ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
                <span className="text-xs text-muted-foreground">Net estimé : </span>
                <span className="font-bold text-sm">
                  {(parseFloat(fBase||"0")+parseFloat(fBonuses||"0")+parseFloat(fOTAmount||"0")-parseFloat(fDeductions||"0")-parseFloat(fAdvance||"0")).toLocaleString("fr-FR")} DA
                </span>
              </div>
            )}
            <div>
              <Label className="text-xs">Notes internes</Label>
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
    </div>
  );
}
