import { useState, useCallback } from "react";
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
import { User, Briefcase, HeartPulse, FileText, Star, StickyNote, History, Loader2, AlertCircle } from "lucide-react";

const AUTH = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` });

async function fetchWorker(id: string): Promise<WorkerProfile> {
  const r = await fetch(`/api/workers/${id}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem("erp_token")}` },
  });
  if (!r.ok) throw new Error("Ouvrier introuvable");
  return r.json();
}

export default function WorkerFichePage() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  const { data: worker, isLoading, error, refetch } = useQuery<WorkerProfile>({
    queryKey: ["worker", params.id],
    queryFn: () => fetchWorker(params.id!),
    enabled: !!params.id,
    retry: false,
  });

  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState<EditForm>(() => ({
    name: "", lastName: "", firstName: "", birthDate: "", gender: "",
    phone: "", whatsapp: "", email: "", address: "", city: "",
    nationalId: "", maritalStatus: "", childrenCount: "",
    emergencyContact: "", emergencyPhone: "",
    hireDate: "", position: "", department: "", contractType: "",
    baseSalary: "", commissionRate: "", workHours: "", restDays: "",
    hasChronicDisease: false, chronicDiseaseDetails: "", takesMedication: false,
    allergies: "", bloodType: "", medicalNotes: "", notes: "",
  }));
  const [saving, setSaving] = useState(false);
  const [localWorker, setLocalWorker] = useState<WorkerProfile | null>(null);

  // Sync local worker from query
  const currentWorker = localWorker ?? worker;

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
    if (!currentWorker) return;
    if (!form.name.trim()) { toast({ title: "Le nom est requis", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const payload = formToPayload(form);
      const r = await fetch(`/api/workers/${currentWorker.id}`, {
        method: "PATCH",
        headers: AUTH(),
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Erreur inconnue");
      toast({ title: "Profil sauvegardé" });
      setEditMode(false);
      // Refresh data
      const refreshed = await fetchWorker(String(currentWorker.id));
      setLocalWorker(refreshed);
      qc.setQueryData(["worker", params.id], refreshed);
      qc.invalidateQueries({ queryKey: ["workers"] });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function refresh() {
    const refreshed = await fetchWorker(String(currentWorker?.id ?? params.id));
    setLocalWorker(refreshed);
    qc.setQueryData(["worker", params.id], refreshed);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !currentWorker) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <AlertCircle className="h-8 w-8" />
        <p className="text-sm">Ouvrier introuvable</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/20 print:bg-white">
      <WorkerHeader
        worker={currentWorker}
        editMode={editMode}
        saving={saving}
        onEdit={enterEdit}
        onSave={save}
        onCancel={cancelEdit}
        onBack={() => setLocation("/workers")}
        onPhotoChange={url => setLocalWorker(w => w ? { ...w, photoUrl: url || null } : w)}
        onWorkerChange={setLocalWorker}
      />

      <WorkerStatCards worker={currentWorker} />

      <div className="px-4 sm:px-6 py-6">
        <Tabs defaultValue="informations" className="w-full">
          <TabsList className="flex flex-wrap gap-1 h-auto mb-6 bg-white border p-1 rounded-lg">
            <TabsTrigger value="informations" className="gap-1.5 text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <User className="h-3.5 w-3.5" /><span className="hidden sm:inline">Informations</span><span className="sm:hidden">Info</span>
            </TabsTrigger>
            <TabsTrigger value="travail" className="gap-1.5 text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <Briefcase className="h-3.5 w-3.5" /><span className="hidden sm:inline">Travail</span><span className="sm:hidden">Travail</span>
            </TabsTrigger>
            <TabsTrigger value="sante" className="gap-1.5 text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <HeartPulse className="h-3.5 w-3.5" /><span className="hidden sm:inline">Santé</span><span className="sm:hidden">Santé</span>
            </TabsTrigger>
            <TabsTrigger value="documents" className="gap-1.5 text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <FileText className="h-3.5 w-3.5" /><span className="hidden sm:inline">Documents</span><span className="sm:hidden">Docs</span>
              {currentWorker.documents.length > 0 && (
                <span className="ml-1 h-4 w-4 rounded-full bg-primary/20 text-[10px] font-bold flex items-center justify-center">{currentWorker.documents.length}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="competences" className="gap-1.5 text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <Star className="h-3.5 w-3.5" /><span className="hidden sm:inline">Compétences</span><span className="sm:hidden">Skills</span>
              {currentWorker.skills.length > 0 && (
                <span className="ml-1 h-4 w-4 rounded-full bg-primary/20 text-[10px] font-bold flex items-center justify-center">{currentWorker.skills.length}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="notes" className="gap-1.5 text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <StickyNote className="h-3.5 w-3.5" /><span className="hidden sm:inline">Notes</span><span className="sm:hidden">Notes</span>
            </TabsTrigger>
            <TabsTrigger value="historique" className="gap-1.5 text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <History className="h-3.5 w-3.5" /><span className="hidden sm:inline">Historique</span><span className="sm:hidden">Log</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="informations">
            <TabInformations worker={currentWorker} editMode={editMode} form={form} onChange={onChange} />
          </TabsContent>
          <TabsContent value="travail">
            <TabTravail worker={currentWorker} editMode={editMode} form={form} onChange={onChange} />
          </TabsContent>
          <TabsContent value="sante">
            <TabSante worker={currentWorker} editMode={editMode} form={form} onChange={onChange} />
          </TabsContent>
          <TabsContent value="documents">
            <TabDocuments worker={currentWorker} onRefresh={refresh} />
          </TabsContent>
          <TabsContent value="competences">
            <TabCompetences worker={currentWorker} onRefresh={refresh} />
          </TabsContent>
          <TabsContent value="notes">
            <TabNotes worker={currentWorker} editMode={editMode} form={form} onChange={onChange} />
          </TabsContent>
          <TabsContent value="historique">
            <TabHistorique logs={currentWorker.recentActivity} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
