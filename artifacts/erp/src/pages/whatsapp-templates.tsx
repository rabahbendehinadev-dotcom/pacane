import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Pencil, Trash2, MessageCircle, Info, History, Phone, FileText, User } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
  loadTemplates,
  saveTemplates,
  loadHistory,
  type WhatsappTemplate,
  type WhatsappLog,
} from "@/lib/whatsapp-templates";

const VARIABLES = ["{{client}}", "{{montant}}", "{{ref}}"];

const EMPTY_FORM = { name: "", message: "" };

function formatDateTime(iso: string) {
  try {
    return format(new Date(iso), "dd/MM/yyyy HH:mm", { locale: fr });
  } catch {
    return iso;
  }
}

export default function WhatsappTemplatesPage() {
  const [templates, setTemplates] = useState<WhatsappTemplate[]>([]);
  const [history, setHistory] = useState<WhatsappLog[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("templates");

  useEffect(() => {
    setTemplates(loadTemplates());
    setHistory(loadHistory());
  }, []);

  function refreshHistory() {
    setHistory(loadHistory());
  }

  function persist(next: WhatsappTemplate[]) {
    setTemplates(next);
    saveTemplates(next);
  }

  function openNew() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(t: WhatsappTemplate) {
    setEditingId(t.id);
    setForm({ name: t.name, message: t.message });
    setDialogOpen(true);
  }

  function handleSave() {
    if (!form.name.trim() || !form.message.trim()) return;
    if (editingId) {
      persist(templates.map(t => t.id === editingId ? { ...t, name: form.name.trim(), message: form.message.trim() } : t));
      toast({ title: "Modèle mis à jour" });
    } else {
      const newT: WhatsappTemplate = { id: Date.now().toString(), name: form.name.trim(), message: form.message.trim() };
      persist([...templates, newT]);
      toast({ title: "Modèle ajouté" });
    }
    setDialogOpen(false);
  }

  function handleDelete(id: string) {
    persist(templates.filter(t => t.id !== id));
    setDeleteId(null);
    toast({ title: "Modèle supprimé" });
  }

  function insertVar(v: string) {
    setForm(f => ({ ...f, message: f.message + v }));
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MessageCircle className="h-6 w-6 text-green-500" />
            Modèles WhatsApp
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gérez vos messages de remerciement envoyés après chaque vente en caisse.
          </p>
        </div>
        {activeTab === "templates" && (
          <Button onClick={openNew} className="gap-2">
            <Plus className="h-4 w-4" />
            Nouveau modèle
          </Button>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); if (v === "history") refreshHistory(); }}>
        <TabsList>
          <TabsTrigger value="templates" className="gap-2">
            <MessageCircle className="h-4 w-4" />Modèles
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <History className="h-4 w-4" />Historique
            {history.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0">{history.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Templates tab ─────────────────────────────────────── */}
        <TabsContent value="templates" className="space-y-4 mt-4">
          {/* Variables info */}
          <Card className="border-blue-200 bg-blue-50/50">
            <CardContent className="pt-4 pb-3">
              <div className="flex gap-2 items-start">
                <Info className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                <div className="text-sm text-blue-700">
                  <p className="font-medium mb-1">Variables disponibles dans le message :</p>
                  <div className="flex flex-wrap gap-2">
                    {VARIABLES.map(v => (
                      <code key={v} className="bg-blue-100 px-2 py-0.5 rounded text-xs font-mono">{v}</code>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-blue-600">
                    Elles seront remplacées automatiquement : <strong>client</strong> = nom du client, <strong>montant</strong> = total, <strong>ref</strong> = numéro de facture.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {templates.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <MessageCircle className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>Aucun modèle pour l'instant.</p>
                <Button variant="outline" className="mt-4 gap-2" onClick={openNew}>
                  <Plus className="h-4 w-4" />Créer un modèle
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {templates.map(t => (
                <Card key={t.id}>
                  <CardHeader className="pb-2 pt-4 px-4">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <MessageCircle className="h-4 w-4 text-green-500 shrink-0" />
                        {t.name}
                      </CardTitle>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(t)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(t.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap bg-muted/50 rounded p-2 font-mono text-xs">
                      {t.message}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {VARIABLES.filter(v => t.message.includes(v)).map(v => (
                        <Badge key={v} variant="secondary" className="text-xs font-mono">{v}</Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── History tab ───────────────────────────────────────── */}
        <TabsContent value="history" className="mt-4">
          {history.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <History className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">Aucun message envoyé pour l'instant.</p>
                <p className="text-xs mt-1">Les messages envoyés depuis la caisse apparaîtront ici.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground mb-3">
                Derniers {history.length} message{history.length > 1 ? "s" : ""} envoyés (max 50)
              </p>
              {history.map(log => (
                <Card key={log.id} className="border-green-100">
                  <CardContent className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="flex items-center gap-1 text-sm font-medium">
                            <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            {log.clientName || <span className="text-muted-foreground italic">Client inconnu</span>}
                          </span>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Phone className="h-3 w-3 shrink-0" />
                            {log.phone}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded">
                            <MessageCircle className="h-3 w-3 shrink-0" />
                            {log.templateName}
                          </span>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <FileText className="h-3 w-3 shrink-0" />
                            {log.invoiceRef}
                          </span>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                        {formatDateTime(log.sentAt)}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Modifier le modèle" : "Nouveau modèle"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Nom du modèle *</Label>
              <Input
                placeholder="Ex: Merci pour l'achat"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label>Message *</Label>
              <div className="flex flex-wrap gap-1 mb-1">
                {VARIABLES.map(v => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => insertVar(v)}
                    className="text-xs bg-green-100 text-green-700 hover:bg-green-200 px-2 py-0.5 rounded font-mono transition-colors"
                  >
                    + {v}
                  </button>
                ))}
              </div>
              <Textarea
                placeholder="Écrivez votre message ici..."
                value={form.message}
                onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                rows={4}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">Cliquez sur une variable pour l'insérer dans le message.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
            <Button disabled={!form.name.trim() || !form.message.trim()} onClick={handleSave}>
              {editingId ? "Enregistrer" : "Ajouter"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Supprimer le modèle ?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Cette action est irréversible.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Annuler</Button>
            <Button variant="destructive" onClick={() => deleteId && handleDelete(deleteId)}>Supprimer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
