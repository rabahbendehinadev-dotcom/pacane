import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { ReactNode } from "react";

interface Column<T> {
  header: string;
  accessorKey?: keyof T;
  cell?: (item: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  isLoading?: boolean;
  emptyState?: ReactNode;
  onRowClick?: (item: T) => void;
}

export function DataTable<T>({ data, columns, isLoading, emptyState, onRowClick }: DataTableProps<T>) {
  if (isLoading) {
    return (
      <div className="w-full h-48 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data || data.length === 0) {
    return emptyState ? <>{emptyState}</> : (
      <div className="w-full p-8 text-center border rounded-md bg-card text-muted-foreground">
        No data available
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            {columns.map((col, i) => (
              <TableHead key={i} className={col.className}>
                {col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((item, i) => (
            <TableRow 
              key={i} 
              onClick={onRowClick ? () => onRowClick(item) : undefined}
              className={onRowClick ? "cursor-pointer hover:bg-muted/50 transition-colors" : ""}
            >
              {columns.map((col, j) => (
                <TableCell key={j} className={col.className}>
                  {col.cell ? col.cell(item) : col.accessorKey ? String(item[col.accessorKey] || "") : null}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
