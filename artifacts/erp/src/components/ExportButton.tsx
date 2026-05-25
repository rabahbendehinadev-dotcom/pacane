import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

interface ExportButtonProps {
  endpoint: string;
  params?: Record<string, string | number | undefined | null>;
  label?: string;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
  disabled?: boolean;
}

/**
 * Reusable CSV export button.
 * Calls GET /api/{endpoint} with query params, and triggers a browser download
 * of the returned CSV file. The filename comes from the Content-Disposition header.
 *
 * Usage:
 *   <ExportButton
 *     endpoint="export/sales"
 *     params={{ branchId: "2", status: "confirmed", from: "2026-01-01", to: "2026-04-30" }}
 *   />
 */
export function ExportButton({
  endpoint,
  params = {},
  label = "Exporter CSV",
  variant = "outline",
  size = "sm",
  className = "",
  disabled = false,
}: ExportButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleExport() {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== "" && v !== "all") {
          qs.set(k, String(v));
        }
      }
      const url = `/api/${endpoint}${qs.toString() ? "?" + qs.toString() : ""}`;
      const token = typeof localStorage !== "undefined" ? localStorage.getItem("erp_token") : null;
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(url, { credentials: "include", headers });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({
          title: "Erreur d'export",
          description: body.error ?? `Erreur ${res.status}`,
          variant: "destructive",
        });
        return;
      }

      const blob = await res.blob();
      if (blob.size === 0) {
        toast({
          title: "Aucune donnée",
          description: "Aucun enregistrement ne correspond aux filtres sélectionnés.",
        });
        return;
      }

      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] ?? `export-${Date.now()}.csv`;

      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);

      toast({ title: "Export téléchargé", description: filename });
    } catch (err) {
      toast({
        title: "Erreur réseau",
        description: "Impossible de télécharger le fichier CSV.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      variant={variant}
      size={size}
      className={`gap-2 ${className}`}
      onClick={handleExport}
      disabled={disabled || loading}
      title="Télécharger les données en CSV"
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Download className="h-3.5 w-3.5" />
      )}
      {label}
    </Button>
  );
}
