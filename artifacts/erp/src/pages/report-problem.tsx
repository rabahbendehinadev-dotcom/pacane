import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, CheckCircle2, Send, Loader2 } from "lucide-react";
import { useLocation } from "wouter";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");
function authHeader() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` };
}

const PROBLEM_TYPES = [
  { value: "technical", label: "Technique" },
  { value: "account", label: "Compte" },
  { value: "requests", label: "Demandes" },
  { value: "preparation", label: "Préparation" },
  { value: "stock", label: "Stock" },
  { value: "cash", label: "Caisse" },
  { value: "other", label: "Autre" },
];

const URGENCY_LEVELS = [
  { value: "low", label: "Faible", color: "text-slate-600" },
  { value: "normal", label: "Normal", color: "text-blue-600" },
  { value: "high", label: "Élevé", color: "text-amber-600" },
  { value: "critical", label: "Critique", color: "text-red-600" },
];

export default function ReportProblemPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [submitted, setSubmitted] = useState<any>(null);

  const [form, setForm] = useState({
    title: "",
    type: "other",
    description: "",
    urgency: "normal",
    fileUrl: "",
  });

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const r = await fetch(`${API}/api/support-tickets`, {
        method: "POST", headers: authHeader(), body: JSON.stringify(data),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Erreur");
      return d;
    },
    onSuccess: (d) => {
      setSubmitted(d);
      toast({ title: "Ticket envoyé", description: `Votre référence : ${d.ticket_ref}` });
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.description.trim()) {
      toast({ title: "Veuillez remplir tous les champs obligatoires", variant: "destructive" });
      return;
    }
    mutation.mutate(form);
  }

  if (submitted) {
    return (
      <div className="max-w-lg mx-auto py-8">
        <Card className="border-green-200 bg-green-50">
          <CardContent className="flex flex-col items-center py-10 gap-4 text-center">
            <CheckCircle2 className="h-16 w-16 text-green-600" />
            <h2 className="text-xl font-bold text-green-800">Ticket envoyé avec succès</h2>
            <p className="text-muted-foreground">Votre numéro de référence :</p>
            <div className="bg-white border border-green-300 rounded-lg px-6 py-3 text-2xl font-mono font-bold text-green-700">
              {submitted.ticket_ref}
            </div>
            <p className="text-sm text-muted-foreground">Conservez ce numéro pour suivre votre ticket. Vous serez notifié à chaque réponse.</p>
            <div className="flex gap-3 flex-wrap justify-center">
              <Button onClick={() => navigate("/my-tickets")}>Suivre mes tickets</Button>
              <Button variant="outline" onClick={() => { setSubmitted(null); setForm({ title: "", type: "other", description: "", urgency: "normal", fileUrl: "" }); }}>
                Nouveau ticket
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <AlertCircle className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Signaler un problème</h1>
          <p className="text-sm text-muted-foreground">Envoyez un ticket et l'administration vous répondra</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader><CardTitle className="text-base">Détails du problème</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-muted/40 rounded-lg p-3 text-sm space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-28">Utilisateur :</span>
                <span className="font-medium">{(user as any)?.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-28">Compte :</span>
                <span className="font-medium">{(user as any)?.email || (user as any)?.username}</span>
              </div>
            </div>

            <div>
              <Label className="mb-1.5 block">Titre du problème *</Label>
              <Input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Description courte du problème..." required />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1.5 block">Type de problème</Label>
                <Select value={form.type} onValueChange={v => setForm(p => ({ ...p, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROBLEM_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1.5 block">Niveau d'urgence</Label>
                <Select value={form.urgency} onValueChange={v => setForm(p => ({ ...p, urgency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {URGENCY_LEVELS.map(u => (
                      <SelectItem key={u.value} value={u.value}>
                        <span className={u.color}>{u.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="mb-1.5 block">Description détaillée *</Label>
              <Textarea
                value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                rows={5}
                placeholder="Décrivez le problème en détail : quand est-il survenu, que faisiez-vous..."
                required
              />
            </div>

            <Button type="submit" disabled={mutation.isPending} className="w-full flex items-center gap-2 py-3">
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Envoyer le ticket
            </Button>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
