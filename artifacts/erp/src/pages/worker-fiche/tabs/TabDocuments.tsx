import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  FileText, Upload, Trash2, Download, FileBadge,
  FileImage, FileSpreadsheet, Plus, X, Loader2,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { WorkerDocument, WorkerProfile } from "../types";
import { DOCUMENT_CATEGORIES } from "../types";

const AUTH = () => ({ Authorization: `Bearer ${localStorage.getItem("erp_token")}` });

function getMimeIcon(mime: string | null) {
  if (!mime) return FileText;
  if (mime.startsWith("image/")) return FileImage;
  if (mime === "application/pdf") return FileBadge;
  if (mime.includes("sheet") || mime.includes("excel")) return FileSpreadsheet;
  return FileText;
}

function formatSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

interface Props {
  worker: WorkerProfile;
  onRefresh: () => Promise<void>;
}

export function TabDocuments({ worker, onRefresh }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState(DOCUMENT_CATEGORIES[0]?.value ?? "other");
  const [uploading, setUploading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WorkerDocument | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  function resetForm() {
    setLabel("");
    setCategory(DOCUMENT_CATEGORIES[0]?.value ?? "other");
    setSelectedFile(null);
    if (fileRef.current) fileRef.current.value = "";
    setShowForm(false);
  }

  async function upload() {
    if (!selectedFile) {
      toast({ title: "Veuillez choisir un fichier", variant: "destructive" });
      return;
    }
    if (!label.trim()) {
      toast({ title: "Le libellé est requis", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", selectedFile);
      fd.append("label", label.trim());
      fd.append("category", category);
      const r = await fetch(`/api/workers/${worker.id}/documents`, {
        method: "POST",
        headers: AUTH(),
        body: fd,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Erreur lors de l'upload");
      toast({ title: `✓ Document "${label.trim()}" ajouté` });
      resetForm();
      setRefreshing(true);
      await onRefresh();
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
      setRefreshing(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/workers/${worker.id}/documents/${deleteTarget.id}`, {
        method: "DELETE",
        headers: AUTH(),
      });
      if (!r.ok) {
        const data = await r.json();
        throw new Error(data.error ?? "Erreur");
      }
      toast({ title: "Document supprimé" });
      setDeleteTarget(null);
      setRefreshing(true);
      await onRefresh();
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally {
      setDeleting(false);
      setRefreshing(false);
    }
  }

  // Group documents by category
  const grouped: Record<string, WorkerDocument[]> = {};
  for (const cat of DOCUMENT_CATEGORIES) {
    const docs = worker.documents.filter(d => d.category === cat.value);
    if (docs.length > 0) grouped[cat.value] = docs;
  }
  // Uncategorized (category not in list)
  const knownValues = new Set(DOCUMENT_CATEGORIES.map(c => c.value));
  const uncategorized = worker.documents.filter(d => !knownValues.has(d.category));
  if (uncategorized.length > 0) grouped["_other"] = uncategorized;

  return (
    <div className="space-y-4">
      {/* Upload form */}
      {showForm ? (
        <Card className="border-primary/30 bg-primary/[0.02]">
          <CardHeader className="pb-3 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Upload className="h-4 w-4 text-primary" />
                Ajouter un document
              </CardTitle>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 -mr-1"
                onClick={resetForm}
                disabled={uploading}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Catégorie</Label>
                <Select value={category} onValueChange={setCategory} disabled={uploading}>
                  <SelectTrigger className="mt-1 h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOCUMENT_CATEGORIES.map(c => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">
                  Libellé <span className="text-destructive">*</span>
                </Label>
                <Input
                  className="mt-1 h-8 text-sm"
                  value={label}
                  onChange={e => setLabel(e.target.value)}
                  placeholder="Ex : Contrat CDI 2024, Carte d'identité…"
                  disabled={uploading}
                  maxLength={120}
                  onKeyDown={e => e.key === "Enter" && upload()}
                />
              </div>
            </div>

            {/* Drop zone */}
            <div>
              <Label className="text-xs">
                Fichier <span className="text-destructive">*</span>
              </Label>
              <div
                className={`mt-1 border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                  selectedFile
                    ? "border-primary/50 bg-primary/5"
                    : "hover:border-primary/30 hover:bg-muted/30"
                } ${uploading ? "pointer-events-none opacity-60" : ""}`}
                onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault();
                  const file = e.dataTransfer.files[0];
                  if (file) setSelectedFile(file);
                }}
              >
                {selectedFile ? (
                  <div>
                    <p className="text-sm font-medium text-primary truncate">{selectedFile.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{formatSize(selectedFile.size)}</p>
                  </div>
                ) : (
                  <div>
                    <Upload className="h-5 w-5 mx-auto mb-1 text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">
                      Cliquer ou glisser un fichier
                    </p>
                    <p className="text-xs text-muted-foreground/60 mt-0.5">
                      PDF, images, Word, Excel — max 20 Mo
                    </p>
                  </div>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
                onChange={e => setSelectedFile(e.target.files?.[0] ?? null)}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={resetForm}
                disabled={uploading}
              >
                Annuler
              </Button>
              <Button
                size="sm"
                onClick={upload}
                disabled={uploading || !selectedFile || !label.trim()}
              >
                {uploading ? (
                  <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Envoi…</>
                ) : (
                  "Uploader"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {worker.documents.length === 0
              ? "Aucun document dans le dossier"
              : `${worker.documents.length} document${worker.documents.length > 1 ? "s" : ""}`}
          </p>
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Ajouter un document
          </Button>
        </div>
      )}

      {/* Document list */}
      {worker.documents.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center text-muted-foreground">
            <FileText className="h-10 w-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">Dossier vide</p>
            <p className="text-xs mt-1">
              Ajoutez des documents : contrat, CIN, diplômes, fiches de paie…
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className={`space-y-3 transition-opacity ${refreshing ? "opacity-50 pointer-events-none" : ""}`}>
          {Object.entries(grouped).map(([catKey, docs]) => {
            const catLabel =
              DOCUMENT_CATEGORIES.find(c => c.value === catKey)?.label ?? "Autres";
            return (
              <Card key={catKey}>
                <CardHeader className="pb-2 pt-3 px-4">
                  <CardTitle className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                    {catLabel}
                    <span className="ml-2 font-normal normal-case">({docs.length})</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3 space-y-1.5">
                  {docs.map(doc => {
                    const Icon = getMimeIcon(doc.mimeType);
                    return (
                      <div
                        key={doc.id}
                        className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/30 hover:bg-muted/60 transition-colors group"
                      >
                        <Icon className="h-4 w-4 text-primary shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{doc.label}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {new Date(doc.uploadedAt).toLocaleDateString("fr-FR", {
                              day: "numeric", month: "short", year: "numeric",
                            })}
                            {doc.fileSize ? ` · ${formatSize(doc.fileSize)}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" asChild>
                            <a
                              href={doc.fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Télécharger / Ouvrir"
                              onClick={e => e.stopPropagation()}
                            >
                              <Download className="h-3.5 w-3.5" />
                            </a>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setDeleteTarget(doc)}
                            title="Supprimer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={v => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce document ?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground">{deleteTarget?.label}</strong> sera définitivement
              supprimé du dossier. Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
