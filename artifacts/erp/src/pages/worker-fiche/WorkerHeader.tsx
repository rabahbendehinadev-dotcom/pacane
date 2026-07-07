import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Edit2, Printer, Camera, Trash2, Check, X, UserX, UserCheck, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { WorkerProfile } from "./types";

const AUTH = () => ({ Authorization: `Bearer ${localStorage.getItem("erp_token")}` });

function getInitials(name: string) {
  return name.split(" ").filter(Boolean).map(n => n[0]).join("").toUpperCase().slice(0, 2) || "?";
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
  const [toggleConfirm, setToggleConfirm] = useState(false);
  const [toggling, setToggling] = useState(false);

  async function handlePhotoUpload(file: File) {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Image uniquement (JPG, PNG, WEBP)", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Fichier trop volumineux (max 5 Mo)", variant: "destructive" });
      return;
    }
    setPhotoLoading(true);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      const r = await fetch(`/api/workers/${worker.id}/photo`, {
        method: "POST",
        headers: AUTH(),
        body: fd,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Erreur lors de l'upload");
      onPhotoChange(data.photoUrl);
      onWorkerChange({ ...worker, photoUrl: data.photoUrl });
      toast({ title: "Photo mise à jour ✓" });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally {
      setPhotoLoading(false);
      if (photoRef.current) photoRef.current.value = "";
    }
  }

  async function handleDeletePhoto() {
    setPhotoLoading(true);
    try {
      const r = await fetch(`/api/workers/${worker.id}/photo`, {
        method: "DELETE",
        headers: AUTH(),
      });
      if (!r.ok) {
        const data = await r.json();
        throw new Error(data.error ?? "Erreur");
      }
      onPhotoChange("");
      onWorkerChange({ ...worker, photoUrl: null });
      toast({ title: "Photo supprimée" });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally {
      setPhotoLoading(false);
    }
  }

  async function handleToggleActive() {
    setToggling(true);
    try {
      const endpoint = worker.isActive ? "deactivate" : "activate";
      const r = await fetch(`/api/workers/${worker.id}/${endpoint}`, {
        method: "PATCH",
        headers: AUTH(),
      });
      if (!r.ok) {
        const data = await r.json();
        throw new Error(data.error ?? "Erreur");
      }
      const updated = await r.json();
      onWorkerChange({ ...worker, isActive: updated.isActive });
      toast({
        title: worker.isActive ? "Ouvrier désactivé" : "Ouvrier réactivé",
      });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally {
      setToggling(false);
      setToggleConfirm(false);
    }
  }

  const photoUrl = worker.photoUrl ? `${worker.photoUrl}?v=${worker.updatedAt}` : undefined;

  return (
    <>
      <div className="bg-white border-b print:border-none">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b bg-muted/30">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Ouvriers</span>
          </Button>

          <div className="flex items-center gap-2">
            {/* Activate / deactivate */}
            {!editMode && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setToggleConfirm(true)}
                disabled={toggling}
                className={`gap-1.5 hidden sm:flex ${
                  worker.isActive
                    ? "text-amber-600 border-amber-200 hover:bg-amber-50 hover:text-amber-700"
                    : "text-emerald-600 border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
                }`}
              >
                {toggling ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : worker.isActive ? (
                  <UserX className="h-3.5 w-3.5" />
                ) : (
                  <UserCheck className="h-3.5 w-3.5" />
                )}
                {worker.isActive ? "Désactiver" : "Réactiver"}
              </Button>
            )}

            {!editMode && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.print()}
                className="gap-1.5 hidden sm:flex"
              >
                <Printer className="h-3.5 w-3.5" />Imprimer
              </Button>
            )}

            {editMode ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onCancel}
                  disabled={saving}
                  className="gap-1.5"
                >
                  <X className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Annuler</span>
                </Button>
                <Button
                  size="sm"
                  onClick={onSave}
                  disabled={saving}
                  className="gap-1.5"
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  {saving ? "Enregistrement…" : "Sauvegarder"}
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={onEdit} className="gap-1.5">
                <Edit2 className="h-3.5 w-3.5" />Modifier
              </Button>
            )}
          </div>
        </div>

        {/* Profile section */}
        <div className="px-4 sm:px-6 py-5 sm:py-6 flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-5">
          {/* Avatar + photo controls */}
          <div className="relative shrink-0">
            <div className={`transition-opacity ${photoLoading ? "opacity-60" : ""}`}>
              <Avatar className="h-20 w-20 sm:h-24 sm:w-24 border-2 border-white shadow-md ring-2 ring-primary/10">
                <AvatarImage src={photoUrl} alt={worker.name} />
                <AvatarFallback className="text-xl font-bold bg-primary/10 text-primary">
                  {photoLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : getInitials(worker.name)}
                </AvatarFallback>
              </Avatar>
            </div>

            {!editMode && !photoLoading && (
              <button
                onClick={() => photoRef.current?.click()}
                className="absolute bottom-0 right-0 h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md hover:bg-primary/90 transition-colors"
                title="Changer la photo"
              >
                <Camera className="h-3.5 w-3.5" />
              </button>
            )}
            {worker.photoUrl && !editMode && !photoLoading && (
              <button
                onClick={handleDeletePhoto}
                className="absolute top-0 right-0 h-6 w-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow-md hover:bg-destructive/90 transition-colors"
                title="Supprimer la photo"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
            <input
              ref={photoRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) handlePhotoUpload(file);
              }}
            />
          </div>

          {/* Info principale */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-xl sm:text-2xl font-serif font-bold text-foreground">{worker.name}</h1>
              {worker.isActive ? (
                <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 shrink-0 text-xs">
                  Actif
                </Badge>
              ) : (
                <Badge variant="secondary" className="shrink-0 text-xs">
                  Inactif
                </Badge>
              )}
            </div>

            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-muted-foreground mt-1">
              {worker.position && (
                <span className="font-medium text-foreground/80">{worker.position}</span>
              )}
              {worker.department && (
                <span className="flex items-center gap-1.5">
                  <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
                  {worker.department}
                </span>
              )}
              {worker.contractType && (
                <span className="flex items-center gap-1.5">
                  <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
                  {worker.contractType}
                </span>
              )}
              {worker.hireDate && (
                <span className="flex items-center gap-1.5">
                  <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
                  Depuis le {formatHireDate(worker.hireDate)}
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-2 mt-3">
              {worker.phone && (
                <a
                  href={`tel:${worker.phone}`}
                  className="text-xs text-muted-foreground hover:text-foreground bg-muted/50 hover:bg-muted/80 rounded-full px-2.5 py-1 transition-colors"
                >
                  📞 {worker.phone}
                </a>
              )}
              {worker.whatsapp && worker.whatsapp !== worker.phone && (
                <a
                  href={`https://wa.me/${worker.whatsapp.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground hover:text-emerald-600 bg-muted/50 hover:bg-emerald-50 rounded-full px-2.5 py-1 transition-colors"
                >
                  💬 {worker.whatsapp}
                </a>
              )}
              {worker.email && (
                <a
                  href={`mailto:${worker.email}`}
                  className="text-xs text-muted-foreground hover:text-foreground bg-muted/50 hover:bg-muted/80 rounded-full px-2.5 py-1 transition-colors truncate max-w-[200px]"
                >
                  ✉️ {worker.email}
                </a>
              )}
              {worker.city && (
                <span className="text-xs text-muted-foreground bg-muted/50 rounded-full px-2.5 py-1">
                  📍 {worker.city}
                </span>
              )}
            </div>
          </div>

          {/* Quick stats */}
          <div className="flex gap-2 sm:gap-3 shrink-0 w-full sm:w-auto">
            <div className="flex-1 sm:flex-none text-center px-3 py-2 bg-muted/40 rounded-xl min-w-[58px] border border-transparent hover:border-primary/10 transition-colors">
              <p className="text-lg font-bold text-primary">{worker.productCount}</p>
              <p className="text-[10px] text-muted-foreground leading-tight">Produits</p>
            </div>
            <div className="flex-1 sm:flex-none text-center px-3 py-2 bg-muted/40 rounded-xl min-w-[58px] border border-transparent hover:border-primary/10 transition-colors">
              <p className="text-lg font-bold text-primary">{worker.documents.length}</p>
              <p className="text-[10px] text-muted-foreground leading-tight">Documents</p>
            </div>
            <div className="flex-1 sm:flex-none text-center px-3 py-2 bg-muted/40 rounded-xl min-w-[58px] border border-transparent hover:border-primary/10 transition-colors">
              <p className="text-lg font-bold text-primary">{worker.skills.length}</p>
              <p className="text-[10px] text-muted-foreground leading-tight">Compétences</p>
            </div>
          </div>
        </div>
      </div>

      {/* Confirm toggle dialog */}
      <AlertDialog open={toggleConfirm} onOpenChange={setToggleConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {worker.isActive ? "Désactiver cet ouvrier ?" : "Réactiver cet ouvrier ?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {worker.isActive
                ? `${worker.name} sera marqué comme inactif. Il n'apparaîtra plus dans les sélections mais ses données seront conservées.`
                : `${worker.name} sera réactivé et pourra à nouveau être assigné à des produits.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={toggling}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleToggleActive}
              disabled={toggling}
              className={worker.isActive
                ? "bg-amber-600 hover:bg-amber-700"
                : "bg-emerald-600 hover:bg-emerald-700"}
            >
              {toggling ? "…" : worker.isActive ? "Désactiver" : "Réactiver"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
