import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StickyNote, Edit2, Check, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { EditForm, WorkerProfile } from "../types";

interface Props {
  worker: WorkerProfile;
  editMode: boolean;
  form: EditForm;
  onChange: (f: Partial<EditForm>) => void;
}

export function TabNotes({ worker, editMode, form, onChange }: Props) {
  if (!editMode) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <StickyNote className="h-4 w-4 text-primary" />Notes & Observations
          </CardTitle>
        </CardHeader>
        <CardContent>
          {worker.notes ? (
            <p className="text-sm whitespace-pre-wrap leading-relaxed">{worker.notes}</p>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              <StickyNote className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Aucune note enregistrée</p>
              <p className="text-xs mt-1">Cliquez sur "Modifier" pour ajouter des notes</p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <StickyNote className="h-4 w-4 text-primary" />Notes & Observations
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Textarea
          className="text-sm resize-none min-h-[200px]"
          value={form.notes}
          onChange={e => onChange({ notes: e.target.value })}
          placeholder="Observations générales, remarques RH, informations diverses sur l'employé..."
        />
        <p className="text-xs text-muted-foreground mt-2">Ces notes sont confidentielles et visibles uniquement par les gestionnaires.</p>
      </CardContent>
    </Card>
  );
}
