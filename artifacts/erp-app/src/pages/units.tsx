import { useState } from "react";
import { useGetUnits, useCreateUnit, getGetUnitsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Scale } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export default function Units() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ name: "", abbreviation: "", allowDecimals: true });

  const { data: units = [], isLoading } = useGetUnits();
  const createMutation = useCreateUnit({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetUnitsQueryKey() }); setDialogOpen(false); toast({ title: "Unité créée" }); } } });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold">Unités de mesure</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{units.length} unité{units.length !== 1 ? "s" : ""}</p>
        </div>
        <Button onClick={() => { setForm({ name: "", abbreviation: "", allowDecimals: true }); setDialogOpen(true); }} className="gap-2">
          <Plus className="h-4 w-4" />Nouvelle unité
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Abréviation</TableHead>
                <TableHead>Décimales</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={3} className="text-center py-12 text-muted-foreground">Chargement...</TableCell></TableRow>
              ) : units.map(u => (
                <TableRow key={u.id}>
                  <TableCell className="flex items-center gap-2"><Scale className="h-4 w-4 text-muted-foreground" /><span className="font-medium text-sm">{u.name}</span></TableCell>
                  <TableCell><span className="font-mono bg-muted px-2 py-0.5 rounded text-sm">{u.abbreviation}</span></TableCell>
                  <TableCell>{u.allowDecimals ? "Oui" : "Non"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Nouvelle unité</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Nom *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="ex: Kilogramme" /></div>
            <div><Label>Abréviation *</Label><Input value={form.abbreviation} onChange={e => setForm(f => ({ ...f, abbreviation: e.target.value }))} placeholder="ex: kg" /></div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={form.allowDecimals} onCheckedChange={v => setForm(f => ({ ...f, allowDecimals: !!v }))} />
              Autoriser les décimales
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
            <Button onClick={() => createMutation.mutate({ data: form })} disabled={!form.name || !form.abbreviation}>Créer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
