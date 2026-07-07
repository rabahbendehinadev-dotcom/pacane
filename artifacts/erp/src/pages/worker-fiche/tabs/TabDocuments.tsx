import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { FileText, Upload, Trash2, Download, FileBadge, FileImage, FileSpreadsheet, Plus, X } from "lucide-react";
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
  onRefresh: () => void;
}

export function TabDocuments({ worker, onRefresh }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState("other");
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WorkerDocument | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  async function upload() {
    if (!selectedFile) { toast({ title: "Veuillez choisir un fichier", variant: "destructive" }); return; }
    if (!label.trim()) { toast({ title: "Libellé requis", variant: "destructive" }); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", selectedFile);
      fd.append("label", label.trim());
      fd.append("category", category);
      const r = await fetch(`/api/workers/${worker.id}/documents`, { method: "POST", headers: AUTH(), body: fd });
      if (!r.ok) throw new Error((await r.json()).error);
      toast({ title: "Document ajouté" });
      setShowForm(false);
      setLabel("");
      setCategory("other");
      setSelectedFile(null);
      if (fileRef.current) fileRef.current.value = "";
      onRefresh();
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally { setUploading(false); }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/workers/${worker.id}/documents/${deleteTarget.id}`, { method: "DELETE", headers: AUTH() });
      if (!r.ok) throw new Error((await r.json()).error);
      toast({ title: "Document supprimé" });
      setDeleteTarget(null);
      onRefresh();
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally { setDeleting(false); }
  }

  const grouped = DOCUMENT_CATEGORIES.reduce<Record<string, WorkerDocument[]>>((acc, cat) => {
    const docs = worker.documents.filter(d => d.category === cat.value);
    if (docs.length > 0) acc[cat.value] = docs;
    return acc;
  }, {});
  const other = worker.documents.filter(d => !DOCUMENT_CATEGORIES.slice(0, -1).some(c => c.value === d.category));
  if (other.length > 0) grouped["other"] = other;

  return (
    <div className="space-y-4">
      {/* Upload form */}
      {showForm ? (
        <Card className="border-primary/30 bg-primary/3">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Upload className="h-4 w-4 text-primary" />Ajouter un document
              </CardTitle>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setShowForm(false); setSelectedFile(null); }}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Catégorie</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DOCUMENT_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">Libellé du document <span className="text-destructive">*</span></Label>
                <Input className="mt-1 h-8 text-sm" value={label} onChange={e => setLabel(e.target.value)} placeholder="Ex: Contrat CDI 2024" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Fichier <span className="text-destructive">*</span></Label>
              <div
                className="mt-1 border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileRef.current?.click()}
              >
                {selectedFile ? (
                  <p className="text-sm font-medium text-primary">{selectedFile.name} ({formatSize(selectedFile.size)})</p>
                ) : (
                  <p className="text-sm text-muted-foreground">Cliquer pour choisir (PDF, images, Word, Excel — max 20 Mo)</p>
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
              <Button variant="outline" size="sm" onClick={() => { setShowForm(false); setSelectedFile(null); }}>Annuler</Button>
              <Button size="sm" onClick={upload} disabled={uploading || !selectedFile || !label.trim()}>
                {uploading ? "Envoi..." : "Uploader"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />Ajouter un document
          </Button>
        </div>
      )}

      {/* Documents list */}
      {worker.documents.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Aucun document dans le dossier</p>
          </CardContent>
        </Card>
      ) : (
        Object.entries(grouped).map(([catKey, docs]) => {
          const catLabel = DOCUMENT_CATEGORIES.find(c => c.value === catKey)?.label ?? "Autres";
          return (
            <Card key={catKey}>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs text-muted-foreground uppercase tracking-wider font-medium">{catLabel}</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                {docs.map(doc => {
                  const Icon = getMimeIcon(doc.mimeType);
                  return (
                    <div key={doc.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors group">
                      <Icon className="h-5 w-5 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{doc.label}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(doc.uploadedAt).toLocaleDateString("fr-FR")}
                          {doc.fileSize ? ` · ${formatSize(doc.fileSize)}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                          <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" title="Télécharger">
                            <Download className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
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
        })
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={v => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce document ?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.label}</strong> sera définitivement supprimé. Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleting} className="bg-destructive hover:bg-destructive/90">
              {deleting ? "..." : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
