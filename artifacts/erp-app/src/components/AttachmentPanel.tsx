import { useState, useRef, useCallback } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Paperclip, Upload, FileText, FileImage, File,
  Download, Trash2, AlertTriangle, Loader2, ExternalLink, X
} from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

// ── Types ────────────────────────────────────────────────────────────────
export type AttachmentEntityType = "expense" | "purchase" | "sale";

interface AttachmentRecord {
  id: number;
  entityType: string;
  entityId: number;
  originalFilename: string;
  objectPath: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByUserId: number | null;
  uploadedByName: string | null;
  branchId: number | null;
  createdAt: string;
}

interface AttachmentPanelProps {
  entityType: AttachmentEntityType;
  entityId: number;
  branchId?: number | null;
  readOnly?: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────
const ALLOWED_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
const MAX_SIZE_MB = 10;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

const ACCEPT_STRING = ".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xls,.xlsx";

// ── Helpers ───────────────────────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function getMimeIcon(mime: string) {
  if (mime.startsWith("image/")) return FileImage;
  if (mime === "application/pdf") return FileText;
  return File;
}

function getMimeBadge(mime: string): { label: string; color: string } {
  if (mime.startsWith("image/")) return { label: "Image", color: "bg-blue-100 text-blue-700" };
  if (mime === "application/pdf") return { label: "PDF", color: "bg-red-100 text-red-700" };
  if (mime.includes("word")) return { label: "Word", color: "bg-sky-100 text-sky-700" };
  if (mime.includes("excel") || mime.includes("spreadsheet")) return { label: "Excel", color: "bg-green-100 text-green-700" };
  return { label: "Fichier", color: "bg-gray-100 text-gray-700" };
}

function getServingUrl(objectPath: string): string {
  return `/api/storage${objectPath}`;
}

// ── AttachmentPanel component ─────────────────────────────────────────────
export function AttachmentPanel({ entityType, entityId, branchId, readOnly = false }: AttachmentPanelProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Load attachments on mount
  const loadAttachments = useCallback(async () => {
    try {
      const res = await customFetch(`/api/attachments?entityType=${entityType}&entityId=${entityId}`);
      if (res.ok) {
        const data = await res.json();
        setAttachments(data);
      }
    } catch {
      // silently fail
    } finally {
      setLoaded(true);
    }
  }, [entityType, entityId]);

  // Load on first render (lazy)
  if (!loaded) {
    loadAttachments();
  }

  // ── Upload flow ──────────────────────────────────────────────────────
  const handleFile = async (file: File) => {
    // Client-side validation
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast({
        title: "Type de fichier non autorisé",
        description: `Types acceptés : PDF, images (JPG, PNG, WEBP), documents Office (Word, Excel)`,
        variant: "destructive",
      });
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      toast({
        title: "Fichier trop volumineux",
        description: `Taille maximale : ${MAX_SIZE_MB} Mo. Votre fichier fait ${formatBytes(file.size)}.`,
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    try {
      // Step 1: Request presigned URL
      const urlRes = await customFetch("/api/storage/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });

      if (!urlRes.ok) {
        throw new Error("Impossible d'obtenir l'URL d'upload");
      }
      const { uploadURL, objectPath } = await urlRes.json();

      // Step 2: Upload directly to GCS
      const uploadRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });

      if (!uploadRes.ok) {
        throw new Error("Échec du transfert vers le stockage");
      }

      // Step 3: Register attachment metadata
      const regRes = await customFetch("/api/attachments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType,
          entityId,
          originalFilename: file.name,
          objectPath,
          mimeType: file.type,
          sizeBytes: file.size,
          branchId: branchId ?? null,
        }),
      });

      if (!regRes.ok) {
        const err = await regRes.json();
        throw new Error(err.error ?? "Erreur d'enregistrement");
      }

      const newAttachment: AttachmentRecord = await regRes.json();
      setAttachments(prev => [...prev, newAttachment]);

      toast({
        title: "Pièce jointe ajoutée",
        description: file.name,
      });
    } catch (err: any) {
      toast({
        title: "Erreur d'upload",
        description: err.message ?? "Une erreur est survenue",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  // ── Delete ───────────────────────────────────────────────────────────
  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      const res = await customFetch(`/api/attachments/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Erreur de suppression");
      }
      setAttachments(prev => prev.filter(a => a.id !== id));
      toast({ title: "Pièce jointe supprimée" });
    } catch (err: any) {
      toast({
        title: "Erreur",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Paperclip className="h-3.5 w-3.5" />
          Pièces jointes
          {attachments.length > 0 && (
            <Badge variant="secondary" className="text-xs">{attachments.length}</Badge>
          )}
        </div>
        {!readOnly && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <><Loader2 className="h-3 w-3 animate-spin" />Upload en cours…</>
            ) : (
              <><Upload className="h-3 w-3" />Joindre un fichier</>
            )}
          </Button>
        )}
      </div>

      {/* Drop zone (only when no file is uploading and not read-only) */}
      {!readOnly && attachments.length === 0 && !uploading && (
        <div
          className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer ${
            dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/20 hover:border-primary/40 hover:bg-muted/30"
          }`}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Upload className="h-7 w-7 opacity-40" />
            <p className="text-sm">
              Glissez un fichier ici ou <span className="text-primary font-medium">parcourir</span>
            </p>
            <p className="text-xs opacity-60">PDF, images, Word, Excel — max {MAX_SIZE_MB} Mo</p>
          </div>
        </div>
      )}

      {/* File list */}
      {attachments.length > 0 && (
        <div className="space-y-2">
          {attachments.map(att => {
            const Icon = getMimeIcon(att.mimeType);
            const badge = getMimeBadge(att.mimeType);
            const servingUrl = getServingUrl(att.objectPath);
            const isDeleting = deletingId === att.id;
            const isImage = att.mimeType.startsWith("image/");

            return (
              <div
                key={att.id}
                className="flex items-center gap-3 p-3 rounded-xl border bg-card hover:bg-muted/30 transition-colors group"
              >
                {/* Icon / preview */}
                <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                  {isImage ? (
                    <img
                      src={servingUrl}
                      alt={att.originalFilename}
                      className="h-9 w-9 object-cover rounded-lg"
                      onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <Icon className="h-4.5 w-4.5 text-muted-foreground" />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" title={att.originalFilename}>
                    {att.originalFilename}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${badge.color}`}>
                      {badge.label}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatBytes(att.sizeBytes)}</span>
                    {att.uploadedByName && (
                      <span className="text-xs text-muted-foreground">· {att.uploadedByName}</span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      · {format(new Date(att.createdAt), "dd MMM yyyy", { locale: fr })}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <a
                    href={servingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    download={att.originalFilename}
                    className="inline-flex items-center justify-center h-7 w-7 rounded-lg hover:bg-muted transition-colors"
                    title="Télécharger"
                  >
                    <Download className="h-3.5 w-3.5 text-muted-foreground" />
                  </a>
                  <a
                    href={servingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center h-7 w-7 rounded-lg hover:bg-muted transition-colors"
                    title="Ouvrir dans un nouvel onglet"
                  >
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                  </a>
                  {!readOnly && (
                    <button
                      onClick={() => handleDelete(att.id)}
                      disabled={isDeleting}
                      className="inline-flex items-center justify-center h-7 w-7 rounded-lg hover:bg-red-50 transition-colors"
                      title="Supprimer"
                    >
                      {isDeleting
                        ? <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin" />
                        : <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      }
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {/* Add more button when files already exist */}
          {!readOnly && (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-lg hover:bg-muted/40"
            >
              {uploading
                ? <><Loader2 className="h-3 w-3 animate-spin" />Upload en cours…</>
                : <><Upload className="h-3 w-3" />Ajouter un autre fichier</>
              }
            </button>
          )}
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT_STRING}
        className="hidden"
        onChange={handleInputChange}
      />
    </div>
  );
}
