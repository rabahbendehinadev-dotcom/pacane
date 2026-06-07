import { DropdownMenu, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ChevronDown, Store } from "lucide-react";

interface Branch { id: number; name: string; }

interface BranchMultiSelectProps {
  branches: Branch[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  size?: "sm" | "default";
  placeholder?: string;
}

export function BranchMultiSelect({
  branches,
  selectedIds,
  onChange,
  size = "default",
  placeholder = "Toutes les boutiques",
}: BranchMultiSelectProps) {
  const allSelected = selectedIds.length === 0;

  const buildLabel = () => {
    if (allSelected) return placeholder;
    if (selectedIds.length === 1) {
      return branches.find(b => b.id === selectedIds[0])?.name ?? "1 boutique";
    }
    const names = branches
      .filter(b => selectedIds.includes(b.id))
      .map(b => b.name)
      .join(", ");
    return names.length > 24 ? `${selectedIds.length} boutiques` : names;
  };

  const toggle = (id: number) => {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter(x => x !== id)
        : [...selectedIds, id]
    );
  };

  const displayLabel = buildLabel();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={
            size === "sm"
              ? "h-7 text-xs gap-1.5 px-2.5 font-normal"
              : "h-8 text-sm gap-1.5 px-3 font-normal"
          }
        >
          <Store className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="max-w-[150px] truncate">{displayLabel}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 p-1">
        <div
          className="flex items-center gap-2.5 px-2.5 py-2 cursor-pointer rounded-sm hover:bg-muted/60 select-none"
          onClick={() => onChange([])}
        >
          <Checkbox
            checked={allSelected}
            onCheckedChange={() => onChange([])}
            className="pointer-events-none"
          />
          <span className="text-xs font-medium">{placeholder}</span>
        </div>
        {branches.length > 0 && <DropdownMenuSeparator />}
        {branches.map(b => (
          <div
            key={b.id}
            className="flex items-center gap-2.5 px-2.5 py-2 cursor-pointer rounded-sm hover:bg-muted/60 select-none"
            onClick={() => toggle(b.id)}
          >
            <Checkbox
              checked={selectedIds.includes(b.id)}
              onCheckedChange={() => toggle(b.id)}
              className="pointer-events-none"
            />
            <span className="text-xs">{b.name}</span>
          </div>
        ))}
        {selectedIds.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <div
              className="flex items-center gap-2.5 px-2.5 py-1.5 cursor-pointer rounded-sm hover:bg-muted/60 select-none"
              onClick={() => onChange([])}
            >
              <span className="text-[11px] text-muted-foreground">Tout désélectionner</span>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
