import { useState, useCallback, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { WorkerHeader } from "./WorkerHeader";
import { WorkerStatCards } from "./WorkerStatCards";
import { TabInformations } from "./tabs/TabInformations";
import { TabTravail } from "./tabs/TabTravail";
import { TabSante } from "./tabs/TabSante";
import { TabDocuments } from "./tabs/TabDocuments";
import { TabCompetences } from "./tabs/TabCompetences";
import { TabNotes } from "./tabs/TabNotes";
import { TabHistorique } from "./tabs/TabHistorique";
import type { WorkerProfile, EditForm } from "./types";
import { profileToForm, formToPayload } from "./types";
import {
  User, Briefcase, HeartPulse, FileText, Star,
  StickyNote, History, Loader2, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const AUTH = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("erp_token")}`,
});

const EMPTY_FORM: EditForm = {
  name: "", lastName: "", firstName: "", birthDate: "", gender: "",
  phone: "", whatsapp: "", email: "", address: "", city: "",
  nationalId: "", maritalStatus: "", childrenCount: "",
  emergencyContact: "", emergencyPhone: "",
  hireDate: "", position: "", department: "", contractType: "",
  baseSalary: "", commissionRate: "", workHours: "", restDays: "",
  hasChronicDisease: false, chronicDiseaseDetails: "", takesMedication: false,
  allergies: "", bloodType: "", medicalNotes: "", notes: "",
};

async function fetchWorker(id: string): Promise<WorkerProfile> {
  const r = await fetch(`/api/workers/${id}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem("erp_token")}` },
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.error ?? "Ouvrier introuvable");
  }
  return r.json();
}

function validateForm(form: EditForm): string | null {
  if (!form.name.trim()) return "Le nom est requis";
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
    return "Format email invalide";
  if (form.baseSalary && isNaN(parseFloat(form.baseSalary)))
    return "Le salaire doit être un nombre";
  if (form.commissionRate) {
    const rate = parseFloat(form.commissionRate);
    if (isNaN(rate) || rate < 0 || rate > 100)
      return "Le taux de commission doit être entre 0 et 100";
  }
  return null;
}

export default function WorkerFichePage() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  const { data: worker, isLoading, error } = useQuery<WorkerProfile>({
    queryKey: ["worker", params.id],
    queryFn: () => fetchWorker(params.id!),
    enabled: !!params.id,
    retry: false,
    staleTime: 30_000,
  });

  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState<EditForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [localWorker, setLocalWorker] = useState<WorkerProfile | null>(null);

  const currentWorker = localWorker ?? worker;

  // Warn on unsaved changes
  useEffect(() => {
    if (!editMode) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [editMode]);

  function enterEdit() {
    if (!currentWorker) return;
    setForm(profileToForm(currentWorker));
    setEditMode(true);
  }

  function cancelEdit() {
    setEditMode(false);
  }

  const onChange = useCallback((patch: Partial<EditForm>) => {
    setForm(f => ({ ...f, ...patch }));
  }, []);

  async function save() {
    if (!currentWorker || saving) return;
    const validationError = validateForm(form);
    if (validationError) {
      toast({ title: validationError, variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = formToPayload(form);
      const r = await fetch(`/api/workers/${currentWorker.id}`, {
        method: "PATCH",
        headers: AUTH(),
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Erreur inconnue");
      toast({ title: "✓ Profil sauvegardé avec succès" });
      setEditMode(false);
      const refreshed = await fetchWorker(String(currentWorker.id));
      setLocalWorker(refreshed);
      qc.setQueryData(["worker", params.id], refreshed);
      qc.invalidateQueries({ queryKey: ["workers"] });
    } catch (e: any) {
      toast({ title: "Erreur lors de la sauvegarde", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function refresh() {
    if (!currentWorker?.id && !params.id) return;
    const refreshed = await fetchWorker(String(currentWorker?.id ?? params.id));
    setLocalWorker(refreshed);
    qc.setQueryData(["worker", params.id], refreshed);
  }

  function handleBack() {
    if (editMode) {
      const confirmed = window.confirm("Vous avez des modifications non sauvegardées. Quitter quand même ?");
      if (!confirmed) return;
    }
    setLocation("/workers");
  }

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen bg-muted/20">
        {/* Skeleton header */}
        <div className="bg-white border-b">
          <div className="px-4 sm:px-6 py-3 border-b bg-muted/30 flex items-center justify-between">
            <div className="h-8 w-24 bg-muted rounded animate-pulse" />
            <div className="h-8 w-24 bg-muted rounded animate-pulse" />
          </div>
          <div className="px-4 sm:px-6 py-5 flex gap-5">
            <div className="h-20 w-20 sm:h-24 sm:w-24 rounded-full bg-muted animate-pulse shrink-0" />
            <div className="flex-1 space-y-3 pt-2">
              <div className="h-7 w-48 bg-muted rounded animate-pulse" />
              <div className="h-4 w-72 bg-muted/60 rounded animate-pulse" />
              <div className="h-4 w-40 bg-muted/40 rounded animate-pulse" />
            </div>
          </div>
        </div>
        <div className="px-4 sm:px-6 py-6 flex items-center justify-center h-48">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error || !currentWorker) {
    return (
      <div className="min-h-screen bg-muted/20 flex flex-col items-center justify-center gap-4">
        <div className="text-center space-y-3">
          <AlertCircle className="h-10 w-10 text-muted-foreground/40 mx-auto" />
          <p className="text-base font-medium">Ouvrier introuvable</p>
          <p className="text-sm text-muted-foreground">
            {(error as Error)?.message || "Cet enregistrement n'existe pas ou a été supprimé."}
          </p>
          <Button variant="outline" size="sm" onClick={() => setLocation("/workers")} className="mt-2">
            ← Retour à la liste
          </Button>
        </div>
      </div>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-muted/20 print:bg-white">
      <WorkerHeader
        worker={currentWorker}
        editMode={editMode}
        saving={saving}
        onEdit={enterEdit}
        onSave={save}
        onCancel={cancelEdit}
        onBack={handleBack}
        onPhotoChange={url => setLocalWorker(w => w ? { ...w, photoUrl: url || null } : w)}
        onWorkerChange={w => setLocalWorker(w)}
      />

      <WorkerStatCards worker={currentWorker} />

      <div className="px-3 sm:px-6 py-4 sm:py-6">
        <Tabs defaultValue="informations" className="w-full">
          <div className="overflow-x-auto pb-1 mb-4 sm:mb-6">
            <TabsList className="inline-flex h-auto gap-1 bg-white border p-1 rounded-lg min-w-max">
              <TabsTrigger
                value="informations"
                className="gap-1.5 text-xs sm:text-sm px-2 sm:px-3 py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                <User className="h-3.5 w-3.5" />
                <span>Informations</span>
              </TabsTrigger>
              <TabsTrigger
                value="travail"
                className="gap-1.5 text-xs sm:text-sm px-2 sm:px-3 py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                <Briefcase className="h-3.5 w-3.5" />
                <span>Travail</span>
              </TabsTrigger>
              <TabsTrigger
                value="sante"
                className="gap-1.5 text-xs sm:text-sm px-2 sm:px-3 py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                <HeartPulse className="h-3.5 w-3.5" />
                <span>Santé</span>
              </TabsTrigger>
              <TabsTrigger
                value="documents"
                className="gap-1.5 text-xs sm:text-sm px-2 sm:px-3 py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                <FileText className="h-3.5 w-3.5" />
                <span>Documents</span>
                {currentWorker.documents.length > 0 && (
                  <span className="h-4 min-w-[16px] rounded-full bg-primary/20 text-[10px] font-bold flex items-center justify-center px-1">
                    {currentWorker.documents.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="competences"
                className="gap-1.5 text-xs sm:text-sm px-2 sm:px-3 py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                <Star className="h-3.5 w-3.5" />
                <span>Compétences</span>
                {currentWorker.skills.length > 0 && (
                  <span className="h-4 min-w-[16px] rounded-full bg-primary/20 text-[10px] font-bold flex items-center justify-center px-1">
                    {currentWorker.skills.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="notes"
                className="gap-1.5 text-xs sm:text-sm px-2 sm:px-3 py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                <StickyNote className="h-3.5 w-3.5" />
                <span>Notes</span>
                {currentWorker.notes && (
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                )}
              </TabsTrigger>
              <TabsTrigger
                value="historique"
                className="gap-1.5 text-xs sm:text-sm px-2 sm:px-3 py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                <History className="h-3.5 w-3.5" />
                <span>Historique</span>
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="informations" className="mt-0">
            <TabInformations worker={currentWorker} editMode={editMode} form={form} onChange={onChange} />
          </TabsContent>
          <TabsContent value="travail" className="mt-0">
            <TabTravail worker={currentWorker} editMode={editMode} form={form} onChange={onChange} />
          </TabsContent>
          <TabsContent value="sante" className="mt-0">
            <TabSante worker={currentWorker} editMode={editMode} form={form} onChange={onChange} />
          </TabsContent>
          <TabsContent value="documents" className="mt-0">
            <TabDocuments worker={currentWorker} onRefresh={refresh} />
          </TabsContent>
          <TabsContent value="competences" className="mt-0">
            <TabCompetences worker={currentWorker} onRefresh={refresh} />
          </TabsContent>
          <TabsContent value="notes" className="mt-0">
            <TabNotes worker={currentWorker} editMode={editMode} form={form} onChange={onChange} />
          </TabsContent>
          <TabsContent value="historique" className="mt-0">
            <TabHistorique logs={currentWorker.recentActivity} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
