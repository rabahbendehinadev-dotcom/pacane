import { useState, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Upload, FileSpreadsheet, ChevronRight, ChevronLeft, CheckCircle2,
  AlertTriangle, XCircle, Info, Download, Loader2, RefreshCw, FileText
} from "lucide-react";
import { toast } from "@/hooks/use-toast";

const API = (path: string) => `/api${path}`;
const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem("erp_token")}` });

// ── Types ─────────────────────────────────────────────────────────────────────
type MappingEntry = { column: string | null; status: "auto" | "confirm" | "missing" };
type FuzzyMatch = { id: number; name: string };

type PreviewComponent = {
  rowIndex: number; compName: string;
  productId: number | null; productFuzzy: FuzzyMatch[];
  quantity: number; unitName: string; unitId: number | null;
  wastageRate: number; errors: string[];
};

type PreviewRecipe = {
  name: string; type: string; yieldVal: number; yieldUnitName: string;
  productName: string; productFuzzy: FuzzyMatch[];
  componentCount: number; errors: string[];
  isDuplicate: boolean; existingId: number | null;
  firstRowIndex: number;
  components: PreviewComponent[];
};

type DuplicateStrategy = "ignore" | "update" | "copy" | "update_components";

type ImportReport = {
  created: number; updated: number; skipped: number; failed: number;
  errors: string[];
  report: { name: string; status: "created" | "updated" | "skipped" | "failed"; message?: string }[];
};

// ── Field labels ──────────────────────────────────────────────────────────────
const FIELD_LABELS: Record<string, string> = {
  nom: "Nom de la recette *",
  type: "Type",
  rendement: "Rendement",
  unite_rendement: "Unité de rendement",
  produit_lie: "Produit lié",
  etapes: "Étapes",
  notes: "Notes",
  nom_composant: "Composant *",
  quantite: "Quantité *",
  unite: "Unité *",
  taux_de_perte: "Taux de perte",
};

const REQUIRED_FIELDS = new Set(["nom", "nom_composant", "quantite", "unite"]);
const FIELD_ORDER = ["nom", "nom_composant", "quantite", "unite", "type", "rendement", "unite_rendement", "produit_lie", "taux_de_perte", "etapes", "notes"];

// ── Step indicator ────────────────────────────────────────────────────────────
const STEPS = ["Fichier", "Feuille", "Colonnes", "Aperçu", "Doublons", "Import", "Rapport"];

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1 mb-6 overflow-x-auto pb-1">
      {STEPS.map((label, i) => {
        const idx = i + 1;
        const done = idx < current;
        const active = idx === current;
        return (
          <div key={label} className="flex items-center gap-1 shrink-0">
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-colors ${
              done ? "bg-emerald-100 text-emerald-700" :
              active ? "bg-primary text-primary-foreground" :
              "bg-muted text-muted-foreground"
            }`}>
              {done ? <CheckCircle2 className="h-3 w-3" /> : <span>{idx}</span>}
              <span className="hidden sm:inline">{label}</span>
            </div>
            {i < STEPS.length - 1 && <div className={`w-3 h-px ${done ? "bg-emerald-400" : "bg-border"}`} />}
          </div>
        );
      })}
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: "auto" | "confirm" | "missing" }) {
  if (status === "auto") return <Badge className="text-xs bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Détecté</Badge>;
  if (status === "confirm") return <Badge className="text-xs bg-amber-100 text-amber-700 hover:bg-amber-100">À confirmer</Badge>;
  return <Badge variant="outline" className="text-xs text-muted-foreground">Manquant</Badge>;
}

// ── Main component ─────────────────────────────────────────────────────────────
export function RecipeImportWizard({ open, onClose, onSuccess }: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Step 1 state
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  // Step 2 state
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>("");

  // Step 3 state
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, MappingEntry>>({});

  // Step 4 state
  const [preview, setPreview] = useState<PreviewRecipe[]>([]);
  const [totalRecipes, setTotalRecipes] = useState(0);
  const [totalErrors, setTotalErrors] = useState(0);
  const [duplicates, setDuplicates] = useState<{ name: string; existingId: number | null }[]>([]);

  // Step 5 state — resolved product choices and duplicate strategies
  const [resolvedProducts, setResolvedProducts] = useState<Record<string, number>>({});
  const [duplicateStrategies, setDuplicateStrategies] = useState<Record<string, DuplicateStrategy>>({});

  // Step 7 state
  const [report, setReport] = useState<ImportReport | null>(null);
  const [importProgress, setImportProgress] = useState(0);

  function reset() {
    setStep(1); setFile(null); setSheetNames([]); setSelectedSheet("");
    setHeaders([]); setMapping({}); setPreview([]); setTotalRecipes(0);
    setTotalErrors(0); setDuplicates([]); setResolvedProducts({});
    setDuplicateStrategies({}); setReport(null); setImportProgress(0);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleClose() { reset(); onClose(); }

  // ── File validation ───────────────────────────────────────────────────────
  function validateFile(f: File): boolean {
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["csv", "xlsx", "xls"].includes(ext)) {
      toast({ title: "Format non supporté", description: "Utilisez .csv, .xlsx ou .xls", variant: "destructive" });
      return false;
    }
    if (f.size > 20 * 1024 * 1024) {
      toast({ title: "Fichier trop volumineux", description: "Maximum 20 Mo", variant: "destructive" });
      return false;
    }
    return true;
  }

  function pickFile(f: File) {
    if (!validateFile(f)) return;
    setFile(f);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) pickFile(f);
  }

  // ── Step 1 → 2/3 : parse file ────────────────────────────────────────────
  async function doParse(sheetOverride?: string) {
    if (!file) return;
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (sheetOverride) fd.append("sheet", sheetOverride);

      const r = await fetch(API("/recipes/import/parse"), { method: "POST", headers: authHeader(), body: fd });
      const data = await r.json();
      if (!r.ok) { toast({ title: data.error ?? "Erreur de lecture", variant: "destructive" }); return; }

      setHeaders(data.headers);
      setMapping(data.mapping);
      setSheetNames(data.sheetNames ?? []);
      if (!sheetOverride && data.currentSheet) setSelectedSheet(data.currentSheet);

      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const isExcel = ext === "xlsx" || ext === "xls";
      if (isExcel && (data.sheetNames ?? []).length > 1 && !sheetOverride) {
        setStep(2); // show sheet picker
      } else {
        setStep(3); // go directly to mapping
      }
    } catch {
      toast({ title: "Impossible de lire le fichier", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  // ── Step 3 → 4 : preview ─────────────────────────────────────────────────
  async function doPreview() {
    if (!file) return;
    setLoading(true);
    try {
      const currentMapping: Record<string, string | null> = {};
      for (const [field, entry] of Object.entries(mapping)) currentMapping[field] = entry.column;

      const fd = new FormData();
      fd.append("file", file);
      fd.append("mapping", JSON.stringify(currentMapping));
      if (selectedSheet) fd.append("sheet", selectedSheet);

      const r = await fetch(API("/recipes/import/preview"), { method: "POST", headers: authHeader(), body: fd });
      const data = await r.json();
      if (!r.ok) { toast({ title: data.error ?? "Erreur de validation", variant: "destructive" }); return; }

      setPreview(data.preview ?? []);
      setTotalRecipes(data.totalRecipes ?? 0);
      setTotalErrors(data.totalErrors ?? 0);
      setDuplicates(data.duplicates ?? []);

      // Init duplicate strategies
      const strats: Record<string, DuplicateStrategy> = {};
      for (const d of (data.duplicates ?? [])) strats[d.name] = "ignore";
      setDuplicateStrategies(strats);

      setStep(4);
    } catch {
      toast({ title: "Erreur de validation", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  // Step 4 → 5 or 6
  function afterPreview() {
    if (duplicates.length > 0) setStep(5);
    else setStep(6);
  }

  // ── Step 6 : execute ──────────────────────────────────────────────────────
  async function doExecute() {
    if (!file) return;
    setImportProgress(10);
    setLoading(true);

    try {
      const currentMapping: Record<string, string | null> = {};
      for (const [field, entry] of Object.entries(mapping)) currentMapping[field] = entry.column;

      const fd = new FormData();
      fd.append("file", file);
      fd.append("mapping", JSON.stringify(currentMapping));
      fd.append("duplicateStrategies", JSON.stringify(duplicateStrategies));
      fd.append("resolvedProducts", JSON.stringify(resolvedProducts));
      if (selectedSheet) fd.append("sheet", selectedSheet);

      setImportProgress(30);
      const r = await fetch(API("/recipes/import/execute"), { method: "POST", headers: authHeader(), body: fd });
      setImportProgress(80);
      const data = await r.json();
      setImportProgress(100);

      if (!r.ok) { toast({ title: data.error ?? "Erreur lors de l'import", variant: "destructive" }); return; }

      setReport(data);
      onSuccess();
      setStep(7);
    } catch {
      toast({ title: "Erreur lors de l'import", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  // ── Download template ─────────────────────────────────────────────────────
  async function downloadTemplate(format: "xlsx" | "csv") {
    if (format === "xlsx") {
      const r = await fetch(API("/recipes/import/template"), { headers: authHeader() });
      if (!r.ok) return;
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "modele_recettes.xlsx"; a.click(); URL.revokeObjectURL(url);
    } else {
      const csv = "nom,type,rendement,unite_rendement,produit_lie,nom_composant,quantite,unite,taux_de_perte,etapes,notes\nCroissant au beurre,finished,12,pcs,Croissant,Farine T45,500,g,0,Mélanger | Pétrir,\nCroissant au beurre,finished,12,pcs,Croissant,Beurre AOP,300,g,2,,\n";
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "modele_recettes.csv"; a.click(); URL.revokeObjectURL(url);
    }
  }

  // ── Download final report ─────────────────────────────────────────────────
  function downloadReport() {
    if (!report) return;
    const rows = [["Nom", "Statut", "Message"], ...report.report.map(r => [r.name, r.status, r.message ?? ""])];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `rapport_import_recettes_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  // ── Mapping helpers ───────────────────────────────────────────────────────
  function setMappingColumn(field: string, column: string | null) {
    setMapping(prev => ({ ...prev, [field]: { ...prev[field], column, status: column ? "auto" : "missing" } }));
  }

  const missingRequired = REQUIRED_FIELDS && Object.entries(mapping)
    .filter(([field]) => REQUIRED_FIELDS.has(field) && !mapping[field]?.column)
    .map(([f]) => FIELD_LABELS[f]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="mb-2">
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileSpreadsheet className="h-4 w-4 shrink-0" />
            Importer des recettes
          </DialogTitle>
          <DialogDescription className="text-xs">
            CSV, XLSX ou XLS — une ligne par composant
          </DialogDescription>
        </DialogHeader>

        <StepBar current={step} />

        {/* ── Step 1: Upload ─────────────────────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-4">
            {/* Drop zone */}
            <div
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"
              }`}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              {file ? (
                <div>
                  <p className="font-medium text-sm text-foreground">{file.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{(file.size / 1024).toFixed(0)} Ko</p>
                </div>
              ) : (
                <div>
                  <p className="text-sm font-medium">Glisser un fichier ici ou cliquer pour choisir</p>
                  <p className="text-xs text-muted-foreground mt-1">.csv, .xlsx, .xls — max 20 Mo</p>
                </div>
              )}
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) pickFile(f); }} />
            </div>

            {/* Templates */}
            <div className="bg-muted/40 rounded-lg p-3">
              <p className="text-xs font-medium text-muted-foreground mb-2">Télécharger un modèle</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => downloadTemplate("xlsx")}>
                  <FileSpreadsheet className="h-3 w-3 mr-1" /> Modèle Excel (.xlsx)
                </Button>
                <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => downloadTemplate("csv")}>
                  <FileText className="h-3 w-3 mr-1" /> Modèle CSV
                </Button>
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={() => doParse()} disabled={!file || loading} size="sm">
                {loading ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Lecture...</> :
                  <>Continuer <ChevronRight className="h-3.5 w-3.5 ml-1" /></>}
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 2: Sheet picker ─────────────────────────────────────────── */}
        {step === 2 && (
          <div className="space-y-4">
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-sm">
                Ce fichier Excel contient <strong>{sheetNames.length} feuilles</strong>. Sélectionnez la feuille à importer.
              </AlertDescription>
            </Alert>

            <div className="grid gap-2">
              {sheetNames.map(name => (
                <button key={name} onClick={() => setSelectedSheet(name)}
                  className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                    selectedSheet === name ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
                  }`}>
                  <FileSpreadsheet className={`h-4 w-4 shrink-0 ${selectedSheet === name ? "text-primary" : "text-muted-foreground"}`} />
                  <span className="text-sm font-medium">{name}</span>
                  {selectedSheet === name && <CheckCircle2 className="h-4 w-4 ml-auto text-primary" />}
                </button>
              ))}
            </div>

            <div className="flex justify-between">
              <Button variant="outline" size="sm" onClick={() => setStep(1)}>
                <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Retour
              </Button>
              <Button size="sm" disabled={!selectedSheet || loading} onClick={() => doParse(selectedSheet)}>
                {loading ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Lecture...</> :
                  <>Continuer <ChevronRight className="h-3.5 w-3.5 ml-1" /></>}
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 3: Column mapping ───────────────────────────────────────── */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
              <strong>{headers.length} colonnes</strong> détectées dans le fichier. Vérifiez la correspondance et ajustez si nécessaire.
            </div>

            {missingRequired.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Champs obligatoires non mappés : <strong>{missingRequired.join(", ")}</strong>
                </AlertDescription>
              </Alert>
            )}

            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="text-xs py-2 w-40">Champ ERP</TableHead>
                    <TableHead className="text-xs py-2">Colonne du fichier</TableHead>
                    <TableHead className="text-xs py-2 w-28 text-right">Statut</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {FIELD_ORDER.map(field => {
                    const entry = mapping[field] ?? { column: null, status: "missing" };
                    return (
                      <TableRow key={field} className={!entry.column && REQUIRED_FIELDS.has(field) ? "bg-red-50/40" : ""}>
                        <TableCell className="text-xs py-2 font-medium">{FIELD_LABELS[field]}</TableCell>
                        <TableCell className="py-1.5">
                          <Select value={entry.column ?? "__none__"} onValueChange={v => setMappingColumn(field, v === "__none__" ? null : v)}>
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue placeholder="— non mappé —" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__" className="text-xs text-muted-foreground">— non mappé —</SelectItem>
                              {headers.map(h => (
                                <SelectItem key={h} value={h} className="text-xs">{h}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="py-2 text-right"><StatusBadge status={entry.column ? entry.status : "missing"} /></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-between">
              <Button variant="outline" size="sm" onClick={() => setStep(sheetNames.length > 1 ? 2 : 1)}>
                <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Retour
              </Button>
              <Button size="sm" disabled={missingRequired.length > 0 || loading} onClick={doPreview}>
                {loading ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Validation...</> :
                  <>Prévisualiser <ChevronRight className="h-3.5 w-3.5 ml-1" /></>}
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 4: Preview ──────────────────────────────────────────────── */}
        {step === 4 && (
          <div className="space-y-4">
            {/* Summary row */}
            <div className="flex flex-wrap gap-2 text-sm">
              <div className="bg-muted/50 rounded-lg px-3 py-2 flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                <span><strong>{totalRecipes}</strong> recette{totalRecipes !== 1 ? "s" : ""}</span>
              </div>
              {duplicates.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <span className="text-amber-700"><strong>{duplicates.length}</strong> doublon{duplicates.length !== 1 ? "s" : ""}</span>
                </div>
              )}
              {totalErrors > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-500" />
                  <span className="text-red-700"><strong>{totalErrors}</strong> erreur{totalErrors !== 1 ? "s" : ""}</span>
                </div>
              )}
              {totalErrors === 0 && duplicates.length === 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span className="text-emerald-700">Prêt à importer</span>
                </div>
              )}
            </div>

            {/* Preview table */}
            <div className="rounded-md border overflow-hidden max-h-72 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 sticky top-0">
                    <TableHead className="text-xs py-2">Recette</TableHead>
                    <TableHead className="text-xs py-2">Type</TableHead>
                    <TableHead className="text-xs py-2 text-right">Comp.</TableHead>
                    <TableHead className="text-xs py-2 text-right">Statut</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.map((r, i) => {
                    const hasErrors = r.errors.length > 0 || r.components.some(c => c.errors.some(e => !e.includes("approximative")));
                    const hasFuzzy = r.productFuzzy.length > 0 || r.components.some(c => c.productFuzzy.length > 0);
                    return (
                      <TableRow key={i} className={hasErrors ? "bg-red-50/40" : ""}>
                        <TableCell className="text-xs py-2">
                          <div className="font-medium">{r.name}</div>
                          {r.isDuplicate && <div className="text-amber-600 text-xs flex items-center gap-1"><AlertTriangle className="h-2.5 w-2.5" />Existe déjà</div>}
                          {r.errors.filter(e => !e.includes("approximative")).map((e, ei) => (
                            <div key={ei} className="text-red-600 text-xs flex items-center gap-1"><XCircle className="h-2.5 w-2.5 shrink-0" />{e}</div>
                          ))}
                          {hasFuzzy && !hasErrors && (
                            <div className="text-blue-600 text-xs flex items-center gap-1"><Info className="h-2.5 w-2.5" />Correspondances approximatives</div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs py-2">
                          <Badge variant={r.type === "finished" ? "default" : "secondary"} className={`text-xs ${r.type === "semi_finished" ? "bg-purple-100 text-purple-700 hover:bg-purple-100" : ""}`}>
                            {r.type === "finished" ? "Fini" : "Semi-fini"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs py-2 text-right text-muted-foreground">{r.componentCount}</TableCell>
                        <TableCell className="py-2 text-right">
                          {hasErrors
                            ? <Badge variant="destructive" className="text-xs">Erreurs</Badge>
                            : hasFuzzy
                            ? <Badge className="text-xs bg-blue-100 text-blue-700 hover:bg-blue-100">Approximatif</Badge>
                            : <Badge className="text-xs bg-emerald-100 text-emerald-700 hover:bg-emerald-100">✓ OK</Badge>
                          }
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {totalRecipes > 20 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-xs text-center py-2 text-muted-foreground italic">
                        … et {totalRecipes - 20} autre{totalRecipes - 20 !== 1 ? "s" : ""} recette{totalRecipes - 20 !== 1 ? "s" : ""}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Fuzzy product resolution */}
            {preview.some(r => r.productFuzzy.length > 0 || r.components.some(c => c.productFuzzy.length > 0)) && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Correspondances approximatives — choisir le produit correct :</p>
                {preview.flatMap(r => [
                  ...r.productFuzzy.length > 0 ? [{
                    rawName: r.productName, label: `Produit lié de "${r.name}"`, fuzzy: r.productFuzzy
                  }] : [],
                  ...r.components.filter(c => c.productFuzzy.length > 0).map(c => ({
                    rawName: c.compName, label: `Composant "${c.compName}" dans "${r.name}"`, fuzzy: c.productFuzzy
                  })),
                ]).map((item, i) => (
                  <div key={i} className="bg-blue-50/60 border border-blue-200 rounded-lg p-2.5 space-y-1.5">
                    <p className="text-xs text-blue-800">{item.label} — <em className="font-mono">{item.rawName}</em></p>
                    <div className="flex flex-wrap gap-1.5">
                      {item.fuzzy.map(p => (
                        <button key={p.id}
                          className={`text-xs px-2 py-1 rounded border transition-colors ${resolvedProducts[item.rawName] === p.id ? "bg-blue-600 text-white border-blue-600" : "bg-white border-border hover:border-blue-400"}`}
                          onClick={() => setResolvedProducts(prev => ({ ...prev, [item.rawName]: p.id }))}>
                          Associer à "{p.name}"
                        </button>
                      ))}
                      <button
                        className={`text-xs px-2 py-1 rounded border transition-colors ${resolvedProducts[item.rawName] === -1 ? "bg-red-100 text-red-700 border-red-300" : "bg-white border-border hover:border-red-300 text-muted-foreground"}`}
                        onClick={() => setResolvedProducts(prev => { const n = { ...prev }; delete n[item.rawName]; return n; })}>
                        Ignorer
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="outline" size="sm" onClick={() => setStep(3)}>
                <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Retour
              </Button>
              <Button size="sm" onClick={afterPreview} disabled={totalErrors > 0 && preview.every(r => r.errors.some(e => !e.includes("approximative")))}>
                Continuer <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 5: Duplicates ───────────────────────────────────────────── */}
        {step === 5 && (
          <div className="space-y-4">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                <strong>{duplicates.length}</strong> recette{duplicates.length !== 1 ? "s existent" : " existe"} déjà. Choisissez l'action à effectuer pour chacune.
              </AlertDescription>
            </Alert>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {duplicates.map(dup => (
                <div key={dup.name} className="border rounded-lg p-3 space-y-2">
                  <p className="text-sm font-medium">{dup.name}</p>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                    {(["ignore", "update", "update_components", "copy"] as DuplicateStrategy[]).map(strat => {
                      const labels: Record<DuplicateStrategy, string> = {
                        ignore: "Ignorer",
                        update: "Mettre à jour",
                        update_components: "Composants seuls",
                        copy: "Créer une copie",
                      };
                      const active = duplicateStrategies[dup.name] === strat;
                      return (
                        <button key={strat}
                          className={`text-xs px-2 py-1.5 rounded-md border font-medium transition-colors ${
                            active
                              ? strat === "ignore" ? "bg-muted text-foreground border-border" :
                                strat === "update" ? "bg-amber-500 text-white border-amber-500" :
                                strat === "update_components" ? "bg-blue-500 text-white border-blue-500" :
                                "bg-purple-500 text-white border-purple-500"
                              : "bg-background text-muted-foreground border-border hover:border-foreground/30"
                          }`}
                          onClick={() => setDuplicateStrategies(prev => ({ ...prev, [dup.name]: strat }))}>
                          {labels[strat]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Quick actions */}
            <div className="flex flex-wrap gap-2 text-xs">
              <Button variant="outline" size="sm" className="text-xs h-7"
                onClick={() => setDuplicateStrategies(Object.fromEntries(duplicates.map(d => [d.name, "ignore"])))}>
                Tout ignorer
              </Button>
              <Button variant="outline" size="sm" className="text-xs h-7"
                onClick={() => setDuplicateStrategies(Object.fromEntries(duplicates.map(d => [d.name, "update"])))}>
                Tout mettre à jour
              </Button>
            </div>

            <div className="flex justify-between">
              <Button variant="outline" size="sm" onClick={() => setStep(4)}>
                <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Retour
              </Button>
              <Button size="sm" onClick={() => setStep(6)}>
                Continuer <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 6: Execute ──────────────────────────────────────────────── */}
        {step === 6 && (
          <div className="space-y-4">
            <div className="bg-muted/40 rounded-xl p-4 space-y-3">
              <p className="text-sm font-medium">Résumé de l'importation</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Recettes à importer :</span> <strong>{totalRecipes}</strong></div>
                <div><span className="text-muted-foreground">Doublons :</span> <strong>{duplicates.length}</strong></div>
                <div><span className="text-muted-foreground">Fichier :</span> <span className="font-mono text-xs">{file?.name}</span></div>
                {selectedSheet && <div><span className="text-muted-foreground">Feuille :</span> <strong>{selectedSheet}</strong></div>}
              </div>
            </div>

            {loading && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Importation en cours…</span>
                  <span>{importProgress}%</span>
                </div>
                <Progress value={importProgress} className="h-2" />
              </div>
            )}

            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs">
                L'import sera exécuté en base de données. Les données non valides seront ignorées. Vous pouvez télécharger le rapport après l'import.
              </AlertDescription>
            </Alert>

            <div className="flex justify-between">
              <Button variant="outline" size="sm" onClick={() => setStep(duplicates.length > 0 ? 5 : 4)} disabled={loading}>
                <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Retour
              </Button>
              <Button size="sm" onClick={doExecute} disabled={loading}>
                {loading ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Importation…</> :
                  <><Upload className="h-3.5 w-3.5 mr-1.5" />Confirmer l'import</>}
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 7: Report ───────────────────────────────────────────────── */}
        {step === 7 && report && (
          <div className="space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([
                { label: "Créées", value: report.created, color: "emerald" },
                { label: "Mises à jour", value: report.updated, color: "blue" },
                { label: "Ignorées", value: report.skipped, color: "gray" },
                { label: "Échecs", value: report.failed, color: "red" },
              ] as const).map(({ label, value, color }) => (
                <div key={label} className={`rounded-lg p-3 text-center ${
                  color === "emerald" ? "bg-emerald-50 border border-emerald-200" :
                  color === "blue" ? "bg-blue-50 border border-blue-200" :
                  color === "gray" ? "bg-muted/50 border border-border" :
                  "bg-red-50 border border-red-200"
                }`}>
                  <p className={`text-2xl font-bold ${
                    color === "emerald" ? "text-emerald-700" :
                    color === "blue" ? "text-blue-700" :
                    color === "gray" ? "text-muted-foreground" :
                    "text-red-700"
                  }`}>{value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
                </div>
              ))}
            </div>

            {/* Errors */}
            {report.errors.length > 0 && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>
                  <p className="font-medium mb-1 text-xs">Erreurs :</p>
                  <ul className="space-y-0.5 text-xs">
                    {report.errors.slice(0, 5).map((e, i) => <li key={i}>• {e}</li>)}
                    {report.errors.length > 5 && <li className="text-muted-foreground">… et {report.errors.length - 5} autre(s)</li>}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {/* Detail table */}
            <div className="rounded-md border overflow-hidden max-h-52 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 sticky top-0">
                    <TableHead className="text-xs py-2">Recette</TableHead>
                    <TableHead className="text-xs py-2 text-right">Résultat</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.report.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs py-2">
                        <div>{r.name}</div>
                        {r.message && <div className="text-muted-foreground text-xs">{r.message}</div>}
                      </TableCell>
                      <TableCell className="py-2 text-right">
                        {r.status === "created" && <Badge className="text-xs bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Créée</Badge>}
                        {r.status === "updated" && <Badge className="text-xs bg-blue-100 text-blue-700 hover:bg-blue-100">Mise à jour</Badge>}
                        {r.status === "skipped" && <Badge variant="outline" className="text-xs text-muted-foreground">Ignorée</Badge>}
                        {r.status === "failed" && <Badge variant="destructive" className="text-xs">Échec</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 justify-between">
              <Button variant="outline" size="sm" onClick={downloadReport}>
                <Download className="h-3.5 w-3.5 mr-1.5" /> Télécharger le rapport
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={reset}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Nouvel import
                </Button>
                <Button size="sm" onClick={handleClose}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Terminer
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
