import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

interface PdfButtonProps {
  onGenerate: () => Promise<void> | void;
  label?: string;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
  disabled?: boolean;
}

/**
 * Generic PDF export button.
 * Calls `onGenerate()` which should invoke the pdf-generator functions.
 * Handles loading state and error toasts automatically.
 */
export function PdfButton({
  onGenerate,
  label = "Exporter PDF",
  variant = "outline",
  size = "sm",
  className = "",
  disabled = false,
}: PdfButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      await onGenerate();
    } catch (err) {
      console.error("PDF generation error:", err);
      toast({
        title: "Erreur PDF",
        description: "Impossible de générer le document PDF.",
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
      onClick={handleClick}
      disabled={disabled || loading}
      title="Télécharger en PDF"
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <FileText className="h-3.5 w-3.5" />
      )}
      {label}
    </Button>
  );
}
