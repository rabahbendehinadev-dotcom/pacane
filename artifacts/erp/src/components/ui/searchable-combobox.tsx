import * as React from "react";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Check, ChevronsUpDown, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ComboboxItem {
  value: string;
  label: string;
}

interface SearchableComboboxProps {
  items: ComboboxItem[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  loading?: boolean;
  triggerClassName?: string;
  drawerTitle?: string;
  onSearchChange?: (search: string) => void;
}

function useIsMobile(breakpoint = 640) {
  const [isMobile, setIsMobile] = React.useState(
    () => typeof window !== "undefined" ? window.innerWidth < breakpoint : false
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    setIsMobile(mq.matches);
    return () => mq.removeEventListener("change", onChange);
  }, [breakpoint]);
  return isMobile;
}

export function SearchableCombobox({
  items,
  value,
  onValueChange,
  placeholder = "Sélectionner...",
  searchPlaceholder = "Rechercher...",
  emptyMessage = "Aucun résultat.",
  disabled,
  loading,
  triggerClassName,
  drawerTitle,
  onSearchChange,
}: SearchableComboboxProps) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  const selectedLabel = items.find(i => i.value === value)?.label;

  const triggerBtn = (
    <Button
      variant="outline"
      role="combobox"
      aria-expanded={open}
      disabled={disabled || loading}
      className={cn("w-full justify-between font-normal text-sm h-9 px-3", triggerClassName)}
    >
      <span className="truncate text-left">
        {loading ? (
          <span className="text-muted-foreground flex items-center gap-1.5">
            <RefreshCw className="h-3 w-3 animate-spin" />
            Chargement...
          </span>
        ) : selectedLabel ? (
          <span>{selectedLabel}</span>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
      </span>
      <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
    </Button>
  );

  const commandContent = (
    <Command>
      <CommandInput placeholder={searchPlaceholder} className="h-10 text-base" onValueChange={onSearchChange} />
      <CommandList className="max-h-[50vh] overflow-y-auto">
        <CommandEmpty>{emptyMessage}</CommandEmpty>
        <CommandGroup>
          {items.map(item => (
            <CommandItem
              key={item.value}
              value={item.label}
              className="py-3 text-sm"
              onSelect={() => {
                onValueChange(item.value);
                setOpen(false);
              }}
            >
              <Check className={cn("mr-2 h-3.5 w-3.5 shrink-0", item.value === value ? "opacity-100 text-primary" : "opacity-0")} />
              <span className="truncate">{item.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>{triggerBtn}</DrawerTrigger>
        <DrawerContent className="z-[200] pb-safe-area-inset-bottom pb-6">
          {drawerTitle && (
            <DrawerHeader className="pb-2 pt-3 px-4">
              <DrawerTitle className="text-base text-left">{drawerTitle}</DrawerTitle>
            </DrawerHeader>
          )}
          <div className="px-4 pb-4">{commandContent}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{triggerBtn}</PopoverTrigger>
      <PopoverContent
        className="p-0 min-w-[var(--radix-popover-trigger-width)]"
        style={{ width: "var(--radix-popover-trigger-width)" }}
        align="start"
        side="bottom"
      >
        {commandContent}
      </PopoverContent>
    </Popover>
  );
}
