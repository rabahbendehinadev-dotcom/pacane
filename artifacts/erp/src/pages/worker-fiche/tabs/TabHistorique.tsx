import { Card, CardContent } from "@/components/ui/card";
import { History, User, Camera, FileText, Star, Shield, UserCheck, UserX, Edit } from "lucide-react";
import type { WorkerActivityLog } from "../types";
import { ACTION_LABELS } from "../types";

function getActionIcon(action: string) {
  switch (action) {
    case "created": return User;
    case "updated": return Edit;
    case "photo_uploaded": return Camera;
    case "photo_deleted": return Camera;
    case "document_added": return FileText;
    case "document_deleted": return FileText;
    case "skill_added": return Star;
    case "skill_updated": return Star;
    case "skill_deleted": return Star;
    case "activated": return UserCheck;
    case "deactivated": return UserX;
    default: return Shield;
  }
}

function getActionColor(action: string): string {
  if (action.includes("delete") || action === "deactivated") return "text-destructive bg-destructive/10";
  if (action === "created" || action === "activated") return "text-emerald-600 bg-emerald-100";
  if (action.includes("photo")) return "text-blue-500 bg-blue-100";
  if (action.includes("document")) return "text-purple-500 bg-purple-100";
  if (action.includes("skill")) return "text-amber-500 bg-amber-100";
  return "text-primary bg-primary/10";
}

function formatDate(dt: string | Date) {
  const d = new Date(dt);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  const timeStr = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  if (diffDays === 0) return `Aujourd'hui à ${timeStr}`;
  if (diffDays === 1) return `Hier à ${timeStr}`;
  if (diffDays < 7) return `Il y a ${diffDays} jours à ${timeStr}`;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) + ` à ${timeStr}`;
}

function getDescription(log: WorkerActivityLog): string {
  const base = ACTION_LABELS[log.action] ?? log.action;
  if (log.meta && typeof log.meta === "object") {
    const m = log.meta as Record<string, unknown>;
    if (log.action === "updated" && Array.isArray(m.fields)) {
      return `${base} (${(m.fields as string[]).slice(0, 3).join(", ")}${m.fields.length > 3 ? "..." : ""})`;
    }
    if ((log.action === "document_added" || log.action === "document_deleted") && m.label) {
      return `${base} : ${m.label}`;
    }
    if (log.action === "skill_added" && m.skill) return `${base} : ${m.skill}`;
    if (log.action === "skill_deleted" && m.skill) return `${base} : ${m.skill}`;
  }
  return base;
}

interface Props {
  logs: WorkerActivityLog[];
}

export function TabHistorique({ logs }: Props) {
  if (logs.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <History className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Aucune activité enregistrée</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-0">
      <div className="relative">
        <div className="absolute left-[22px] top-2 bottom-2 w-px bg-border" />
        <div className="space-y-1">
          {logs.map((log, i) => {
            const Icon = getActionIcon(log.action);
            const colorClass = getActionColor(log.action);
            return (
              <div key={log.id} className="flex gap-4 relative group">
                <div className={`mt-0.5 h-9 w-9 rounded-full flex items-center justify-center shrink-0 z-10 border-2 border-background ${colorClass}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 py-2 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-tight">{getDescription(log)}</p>
                      {log.performedByName && (
                        <p className="text-xs text-muted-foreground mt-0.5">par {log.performedByName}</p>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground shrink-0 mt-0.5">{formatDate(log.createdAt)}</p>
                  </div>
                  {log.oldValue && log.newValue && (
                    <div className="mt-1 text-xs text-muted-foreground flex items-center gap-2">
                      <span className="line-through">{log.oldValue}</span>
                      <span>→</span>
                      <span className="font-medium text-foreground">{log.newValue}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
