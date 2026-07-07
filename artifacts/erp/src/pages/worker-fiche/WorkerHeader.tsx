import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowLeft, Edit2, FileText, Printer, Camera, Trash2, Check, X, UserCheck, UserX } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { WorkerProfile } from "./types";

const AUTH = () => ({ Authorization: `Bearer ${localStorage.getItem("erp_token")}` });

function getInitials(name: string) {
  return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

function formatHireDate(d: string | null) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

interface Props {
  worker: WorkerProfile;
  editMode: boolean;
  saving: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onBack: () => void;
  onPhotoChange: (url: string) => void;
  onWorkerChange: (w: WorkerProfile) => void;
}

export function WorkerHeader({ worker, editMode, saving, onEdit, onSave, onCancel, onBack, onPhotoChange, onWorkerChange }: Props) {
  const photoRef = useRef<HTMLInputElement>(null);
  const [photoLoading, setPhotoLoading] = useState(false);

  async function handlePhotoUpload(file: File) {
    if (!file.type.startsWith("image/")) { toast({ title: "Image uniquement", variant: "destructive" }); return; }
    setPhotoLoading(true);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      const r = await fetch(`/api/workers/${worker.id}/photo`, { method: "POST", headers: AUTH(), body: fd });
      if (!r.ok) throw new Error((await r.json()).error);
      const { photoUrl } = await r.json();
      onPhotoChange(photoUrl);
      onWorkerChange({ ...worker, photoUrl });
      toast({ title: "Photo mise à jour" });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally { setPhotoLoading(false); }
  }

  async function handleDeletePhoto() {
    setPhotoLoading(true);
    try {
      const r = await fetch(`/api/workers/${worker.id}/photo`, { method: "DELETE", headers: AUTH() });
      if (!r.ok) throw new Error((await r.json()).error);
      onPhotoChange("");
      onWorkerChange({ ...worker, photoUrl: null });
      toast({ title: "Photo supprimée" });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally { setPhotoLoading(false); }
  }

  const photoUrl = worker.photoUrl ? `${worker.photoUrl}?v=${worker.updatedAt}` : undefined;

  return (
    <div className="bg-white border-b print:border-none">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b bg-muted/30">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Ouvriers</span>
        </Button>
        <div className="flex items-center gap-2">
          {editMode ? (
            <>
              <Button variant="outline" size="sm" onClick={onCancel} disabled={saving} className="gap-1.5">
                <X className="h-3.5 w-3.5" />Annuler
              </Button>
              <Button size="sm" onClick={onSave} disabled={saving} className="gap-1.5">
                <Check className="h-3.5 w-3.5" />
                {saving ? "Enregistrement..." : "Sauvegarder"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5 hidden sm:flex">
                <Printer className="h-3.5 w-3.5" />Imprimer
              </Button>
              <Button size="sm" onClick={onEdit} className="gap-1.5">
                <Edit2 className="h-3.5 w-3.5" />Modifier
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Profile section */}
      <div className="px-6 py-6 flex flex-col sm:flex-row items-start sm:items-center gap-5">
        {/* Avatar + photo controls */}
        <div className="relative shrink-0">
          <Avatar className="h-20 w-20 sm:h-24 sm:w-24 border-2 border-white shadow-md ring-2 ring-primary/10">
            <AvatarImage src={photoUrl} alt={worker.name} />
            <AvatarFallback className="text-xl font-bold bg-primary/10 text-primary">
              {getInitials(worker.name)}
            </AvatarFallback>
          </Avatar>
          {!editMode && (
            <button
              onClick={() => photoRef.current?.click()}
              disabled={photoLoading}
              className="absolute bottom-0 right-0 h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md hover:bg-primary/90 transition-colors"
              title="Changer la photo"
            >
              <Camera className="h-3.5 w-3.5" />
            </button>
          )}
          {worker.photoUrl && !editMode && (
            <button
              onClick={handleDeletePhoto}
              disabled={photoLoading}
              className="absolute top-0 right-0 h-6 w-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow-md hover:bg-destructive/90 transition-colors"
              title="Supprimer la photo"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => e.target.files?.[0] && handlePhotoUpload(e.target.files[0])}
          />
        </div>

        {/* Info principale */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h1 className="text-2xl font-serif font-bold text-foreground truncate">{worker.name}</h1>
            {worker.isActive ? (
              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 shrink-0">Actif</Badge>
            ) : (
              <Badge variant="secondary" className="shrink-0">Inactif</Badge>
            )}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted-foreground mt-1">
            {worker.position && (
              <span className="font-medium text-foreground/80">{worker.position}</span>
            )}
            {worker.department && (
              <span className="flex items-center gap-1">
                <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
                {worker.department}
              </span>
            )}
            {worker.contractType && (
              <span className="flex items-center gap-1">
                <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
                {worker.contractType}
              </span>
            )}
            {worker.hireDate && (
              <span className="flex items-center gap-1">
                <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
                Depuis le {formatHireDate(worker.hireDate)}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-2 mt-3">
            {worker.phone && (
              <a href={`tel:${worker.phone}`} className="text-xs text-muted-foreground hover:text-foreground bg-muted/50 rounded px-2 py-0.5">
                📞 {worker.phone}
              </a>
            )}
            {worker.email && (
              <a href={`mailto:${worker.email}`} className="text-xs text-muted-foreground hover:text-foreground bg-muted/50 rounded px-2 py-0.5 truncate max-w-[200px]">
                ✉️ {worker.email}
              </a>
            )}
            {worker.city && (
              <span className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-0.5">
                📍 {worker.city}
              </span>
            )}
          </div>
        </div>

        {/* Quick stats */}
        <div className="flex gap-3 shrink-0">
          <div className="text-center px-3 py-2 bg-muted/40 rounded-lg min-w-[60px]">
            <p className="text-lg font-bold text-primary">{worker.productCount}</p>
            <p className="text-[10px] text-muted-foreground leading-tight">Produits</p>
          </div>
          <div className="text-center px-3 py-2 bg-muted/40 rounded-lg min-w-[60px]">
            <p className="text-lg font-bold text-primary">{worker.documents.length}</p>
            <p className="text-[10px] text-muted-foreground leading-tight">Documents</p>
          </div>
          <div className="text-center px-3 py-2 bg-muted/40 rounded-lg min-w-[60px]">
            <p className="text-lg font-bold text-primary">{worker.skills.length}</p>
            <p className="text-[10px] text-muted-foreground leading-tight">Compétences</p>
          </div>
        </div>
      </div>
    </div>
  );
}
