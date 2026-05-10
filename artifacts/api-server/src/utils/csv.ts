import type { Response } from "express";

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const header = columns.map(c => `"${c.header}"`).join(",");
  const body = rows.map(row =>
    columns.map(c => {
      const v = c.value(row);
      if (v === null || v === undefined) return '""';
      const s = String(v).replace(/"/g, '""');
      return `"${s}"`;
    }).join(",")
  ).join("\n");
  return header + "\n" + body;
}

export function sendCsv(res: Response, filename: string, csv: string): void {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.send("\uFEFF" + csv);
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function buildFilename(module: string, branchName?: string | null, from?: string, to?: string): string {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const parts = [module];
  if (branchName) parts.push(slugify(branchName));
  if (from && to && from === to.slice(0, 7)) {
    parts.push(from.slice(0, 7));
  } else if (from && to) {
    parts.push(from, to);
  } else {
    parts.push(yearMonth);
  }
  return parts.join("-") + ".csv";
}

export function fmtDA(n: number): string {
  return new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(n) + " DA";
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "";
  const s = typeof d === "string" ? d : d.toISOString();
  return s.slice(0, 10);
}

export function fmtDatetime(d: string | Date | null | undefined): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toISOString().slice(0, 16).replace("T", " ");
}
