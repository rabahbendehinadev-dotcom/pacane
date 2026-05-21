import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ReactNode } from "react";

interface FilterBarProps {
  searchPlaceholder?: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  children?: ReactNode; // For additional filters like dropdowns
}

export function FilterBar({ searchPlaceholder = "Search...", searchValue, onSearchChange, children }: FilterBarProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-4 items-center mb-6">
      <div className="relative w-full sm:max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input 
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9 h-10 bg-card"
        />
      </div>
      <div className="flex items-center gap-2 w-full sm:w-auto">
        {children}
      </div>
    </div>
  );
}
