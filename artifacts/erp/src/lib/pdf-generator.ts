/**
 * pdf-generator.ts — client-side PDF generation for Pacane ERP commercial documents.
 *
 * Uses jsPDF + jspdf-autotable to produce professional, print-ready PDFs
 * for invoices, quotes, orders, and purchase orders.
 *
 * All generation happens in the browser — no extra API call required,
 * the data already loaded in the detail view is passed directly.
 */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// ── Types ──────────────────────────────────────────────────────────────────

export interface CompanySettings {
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  website?: string | null;
  taxId?: string | null;
  currencySymbol?: string;
  footerNote?: string | null;
}

export interface SaleItem {
  productName: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
}

export interface SalePayment {
  date: string;
  amount: number;
  method: string;
  notes?: string | null;
}

export interface SaleDocData {
  reference: string;
  type: string;           // "sale" | "quotation" | "order" | "draft"
  status: string;
  createdAt: string | Date;
  promisedDate?: string | null;
  branchName: string;
  branchPhone?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  shippingFee: number;
  total: number;
  paid: number;
  due: number;
  notes?: string | null;
  items: SaleItem[];
  payments: SalePayment[];
}

export interface PurchaseItem {
  productName: string;
  quantity: number;
  unitCost: number;
  discount: number;
  total: number;
}

export interface PurchasePayment {
  date: string;
  amount: number;
  method: string;
  notes?: string | null;
}

export interface PurchaseDocData {
  reference: string;
  status: string;
  paymentStatus: string;
  createdAt: string | Date;
  expectedDelivery?: string | null;
  branchName: string;
  supplierName: string;
  supplierPhone?: string | null;
  supplierEmail?: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paid: number;
  due: number;
  notes?: string | null;
  items: PurchaseItem[];
  payments: PurchasePayment[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

const BRAND_COLOR:  [number, number, number] = [184, 134, 80];   // Warm gold
const BRAND_DARK:   [number, number, number] = [50, 40, 30];     // Near-black
const BRAND_LIGHT:  [number, number, number] = [250, 245, 235];  // Cream bg
const TEXT_MUTED:   [number, number, number] = [120, 110, 95];   // Muted text
const BORDER_COLOR: [number, number, number] = [210, 195, 170];  // Border

function fmtDA(amount: number, symbol = "DA"): string {
  const rounded = Math.round(amount);
  const formatted = rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return formatted + " " + symbol;
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  try {
    const dt = typeof d === "string" ? new Date(d) : d;
    return dt.toLocaleDateString("fr-DZ", { day: "2-digit", month: "long", year: "numeric" });
  } catch {
    return String(d).slice(0, 10);
  }
}

const DOC_TYPE_LABELS: Record<string, string> = {
  sale: "FACTURE", quotation: "DEVIS", order: "BON DE COMMANDE CLIENT", draft: "BROUILLON",
};

const SALE_STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmé", pending: "En attente", cancelled: "Annulé",
  active: "Actif", completed: "Terminé",
};

const PURCHASE_STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon", ordered: "Commandé", partially_received: "Réception partielle",
  received: "Reçu intégralement", cancelled: "Annulé",
};

const PAY_STATUS_LABELS: Record<string, string> = {
  unpaid: "Non payé", partial: "Partiel", paid: "Payé intégralement",
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Espèces", transfer: "Virement bancaire", check: "Chèque",
  card: "Carte bancaire", credit: "Crédit", other: "Autre",
};

// ── Shared layout helpers ──────────────────────────────────────────────────

function buildHeader(
  doc: jsPDF,
  company: CompanySettings,
  docType: string,
  docRef: string,
  date: string,
  branchName: string,
  status: string,
  statusLabel: string,
  branchPhone?: string | null,
) {
  const pageW = doc.internal.pageSize.getWidth();

  // Background banner
  doc.setFillColor(...BRAND_LIGHT);
  doc.roundedRect(10, 8, pageW - 20, 42, 3, 3, "F");
  doc.setDrawColor(...BORDER_COLOR);
  doc.setLineWidth(0.3);
  doc.roundedRect(10, 8, pageW - 20, 42, 3, 3, "S");

  // Company name (left)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...BRAND_COLOR);
  doc.text(company.name, 16, 20);

  // Company info (left, small)
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...TEXT_MUTED);
  let cy = 26;
  if (company.address) { doc.text(company.address + (company.city ? `, ${company.city}` : ""), 16, cy); cy += 4.5; }
  const displayPhone = branchPhone ?? company.phone;
  if (displayPhone) { doc.text(`Tél: ${displayPhone}`, 16, cy); cy += 4.5; }
  if (company.email) { doc.text(company.email, 16, cy); cy += 4.5; }
  if (company.taxId) { doc.text(`NIF: ${company.taxId}`, 16, cy); }

  // Document type + ref (right)
  const rightX = pageW - 16;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...BRAND_DARK);
  doc.text(docType, rightX, 20, { align: "right" });

  doc.setFontSize(10);
  doc.setTextColor(...TEXT_MUTED);
  doc.text(docRef, rightX, 27, { align: "right" });

  doc.setFontSize(8);
  doc.text(`Date: ${date}`, rightX, 33, { align: "right" });
  doc.text(`Boutique: ${branchName}`, rightX, 38, { align: "right" });
  doc.text(`Statut: ${statusLabel}`, rightX, 43, { align: "right" });
}

function buildAddressBlock(
  doc: jsPDF,
  startY: number,
  label: string,
  name: string,
  phone?: string | null,
  email?: string | null,
) {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFillColor(250, 250, 248);
  doc.setDrawColor(...BORDER_COLOR);
  doc.setLineWidth(0.3);
  doc.roundedRect(10, startY, pageW - 20, 22, 2, 2, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...BRAND_COLOR);
  doc.text(label.toUpperCase(), 16, startY + 6);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...BRAND_DARK);
  doc.text(name, 16, startY + 13);

  if (phone || email) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...TEXT_MUTED);
    const infoParts = [phone, email].filter(Boolean).join("  ·  ");
    doc.text(infoParts, 16, startY + 18.5);
  }
  return startY + 26;
}

function buildTotalsBlock(
  doc: jsPDF,
  startY: number,
  rows: [string, string][],
  highlightLast = true,
) {
  const pageW = doc.internal.pageSize.getWidth();
  const rightX = pageW - 14;
  const labelX = pageW - 65;

  let y = startY;
  for (let i = 0; i < rows.length; i++) {
    const [label, value] = rows[i];
    const isLast = i === rows.length - 1;

    if (isLast && highlightLast) {
      doc.setFillColor(...BRAND_COLOR);
      doc.roundedRect(labelX - 4, y - 5, pageW - labelX - 10, 9, 1.5, 1.5, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(255, 255, 255);
    } else {
      doc.setFont("helvetica", i === 0 ? "normal" : "normal");
      doc.setFontSize(8);
      doc.setTextColor(...TEXT_MUTED);
      if (label.startsWith("──")) {
        doc.setDrawColor(...BORDER_COLOR);
        doc.setLineWidth(0.2);
        doc.line(labelX - 4, y - 2, rightX, y - 2);
        y += 2;
        continue;
      }
    }

    doc.text(label, labelX, y, { align: "left" });
    if (isLast && highlightLast) {
      doc.setFont("helvetica", "bold");
    }
    doc.text(value, rightX, y, { align: "right" });
    y += isLast ? 6 : 5.5;
  }
  return y + 2;
}

function buildPaymentsBlock(
  doc: jsPDF,
  startY: number,
  payments: { date: string; amount: number; method: string; notes?: string | null }[],
  symbol: string,
) {
  if (!payments.length) return startY;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...BRAND_DARK);
  doc.text("Historique des règlements", 14, startY);

  autoTable(doc, {
    startY: startY + 3,
    head: [["Date", "Mode", "Montant", "Notes"]],
    body: payments.map(p => [
      fmtDate(p.date), PAYMENT_METHOD_LABELS[p.method] ?? p.method,
      fmtDA(p.amount, symbol), p.notes ?? "",
    ]),
    styles: { fontSize: 7.5, cellPadding: 2.5 },
    headStyles: {
      fillColor: BRAND_DARK, textColor: [255, 255, 255],
      fontSize: 7.5, fontStyle: "bold",
    },
    alternateRowStyles: { fillColor: [253, 251, 247] },
    columnStyles: {
      0: { cellWidth: 28 }, 1: { cellWidth: 32 },
      2: { halign: "right", cellWidth: 30 }, 3: { cellWidth: "auto" as any },
    },
    margin: { left: 14, right: 14 },
    theme: "grid",
  });

  return (doc as any).lastAutoTable.finalY + 6;
}

function buildNotes(doc: jsPDF, startY: number, notes: string): number {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...BRAND_DARK);
  doc.text("Notes / Conditions", 14, startY);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...TEXT_MUTED);
  const lines = doc.splitTextToSize(notes, pageW - 30) as string[];
  doc.text(lines, 14, startY + 6);
  return startY + 6 + lines.length * 4.5 + 4;
}

function buildFooter(doc: jsPDF, company: CompanySettings) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  doc.setDrawColor(...BORDER_COLOR);
  doc.setLineWidth(0.3);
  doc.line(14, pageH - 16, pageW - 14, pageH - 16);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...TEXT_MUTED);

  const footerLeft = company.footerNote ?? `Document généré par Pacane ERP • ${company.name}`;
  doc.text(footerLeft, 14, pageH - 10);
  doc.text(`Imprimé le ${fmtDate(new Date())}`, pageW - 14, pageH - 10, { align: "right" });
}

// ── SALE PDF ──────────────────────────────────────────────────────────────

export function generateSalePdf(sale: SaleDocData, company: CompanySettings): void {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const sym = company.currencySymbol ?? "DA";

  // Header
  const docTypeLabel = DOC_TYPE_LABELS[sale.type] ?? "DOCUMENT";
  const statusLabel = SALE_STATUS_LABELS[sale.status] ?? sale.status;
  buildHeader(
    doc, company,
    docTypeLabel, sale.reference,
    fmtDate(sale.createdAt), sale.branchName,
    sale.status, statusLabel,
    sale.branchPhone,
  );

  let y = 55;

  // Promised date for orders/quotes
  if (sale.type !== "sale" && sale.promisedDate) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_MUTED);
    doc.text(`Date de livraison promise : ${fmtDate(sale.promisedDate)}`, 14, y);
    y += 6;
  }

  // Customer block
  if (sale.customerName) {
    y = buildAddressBlock(doc, y, "Facturer à", sale.customerName, sale.customerPhone, sale.customerEmail);
  } else {
    y = buildAddressBlock(doc, y, "Vente", "Comptoir (sans client enregistré)", null, null);
  }

  y += 2;

  // Items table
  autoTable(doc, {
    startY: y,
    head: [["Désignation", "Qté", "Prix unitaire", "Remise", "Total"]],
    body: sale.items.map(item => [
      item.productName,
      String(item.quantity),
      fmtDA(item.unitPrice, sym),
      item.discount > 0 ? fmtDA(item.discount, sym) : "—",
      fmtDA(item.total, sym),
    ]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: {
      fillColor: BRAND_DARK, textColor: [255, 255, 255],
      fontStyle: "bold", fontSize: 8,
    },
    alternateRowStyles: { fillColor: [253, 251, 247] },
    columnStyles: {
      0: { cellWidth: "auto" as any },
      1: { halign: "center", cellWidth: 15 },
      2: { halign: "right", cellWidth: 32 },
      3: { halign: "right", cellWidth: 28 },
      4: { halign: "right", cellWidth: 35 },
    },
    footStyles: { fillColor: BRAND_LIGHT, textColor: BRAND_DARK, fontStyle: "bold" },
    foot: [[
      { content: `${sale.items.length} article(s)`, colSpan: 3, styles: { halign: "left" } },
      { content: "Sous-total", styles: { halign: "right" } },
      { content: fmtDA(sale.subtotal, sym), styles: { halign: "right" } },
    ]],
    margin: { left: 14, right: 14 },
    theme: "grid",
    tableLineColor: BORDER_COLOR,
    tableLineWidth: 0.2,
  });

  y = (doc as any).lastAutoTable.finalY + 6;

  // Totals block (right-aligned)
  const totalsRows: [string, string][] = [];
  if (sale.discount > 0) totalsRows.push(["Remise", `- ${fmtDA(sale.discount, sym)}`]);
  if (sale.tax > 0) totalsRows.push(["TVA", `+ ${fmtDA(sale.tax, sym)}`]);
  if (sale.shippingFee > 0) totalsRows.push(["Frais de livraison", `+ ${fmtDA(sale.shippingFee, sym)}`]);
  totalsRows.push(["──────────────────", "──────────────────"]);
  totalsRows.push(["TOTAL TTC", fmtDA(sale.total, sym)]);
  if (sale.type === "sale") {
    totalsRows.push(["Montant payé", fmtDA(sale.paid, sym)]);
    totalsRows.push(["Solde restant", fmtDA(sale.due, sym)]);
  }

  y = buildTotalsBlock(doc, y, totalsRows);
  y += 4;

  // Payments
  if (sale.type === "sale" && sale.payments.length > 0) {
    y = buildPaymentsBlock(doc, y, sale.payments, sym);
  }

  // Notes
  if (sale.notes?.trim()) {
    y = buildNotes(doc, y, sale.notes);
  }

  buildFooter(doc, company);

  const filename = `${sale.reference}-${fmtDate(sale.createdAt).replace(/ /g, "-")}.pdf`;
  doc.save(filename);
}

// ── SALE TICKET PDF (80 mm thermal) ───────────────────────────────────────

export function generateSaleTicketPdf(sale: SaleDocData, company: CompanySettings): void {
  const sym = company.currencySymbol ?? "DA";
  const docLabel = DOC_TYPE_LABELS[sale.type] ?? "DOCUMENT";
  const statusLabel = SALE_STATUS_LABELS[sale.status] ?? sale.status;
  const branchPhone = sale.branchPhone ?? company.phone;

  const totalsCount =
    (sale.subtotal !== sale.total ? 1 : 0) +
    (sale.discount > 0 ? 1 : 0) +
    (sale.tax > 0 ? 1 : 0) +
    (sale.shippingFee > 0 ? 1 : 0) +
    1 +
    (sale.paid > 0 ? 1 : 0) + (sale.due > 0 ? 1 : 0);
  const paymentsH = sale.payments.length > 0 ? sale.payments.length * 5 + 12 : 0;
  const notesH = sale.notes?.trim() ? 20 : 0;
  const estimatedH = 70 + sale.items.length * 9 + totalsCount * 5 + paymentsH + notesH + 25;

  const doc = new jsPDF({ unit: "mm", format: [80, estimatedH], orientation: "portrait" });
  const pageW = doc.internal.pageSize.getWidth();
  const cx = pageW / 2;
  const L = 4;
  const R = pageW - 4;
  let y = 8;

  // Company header
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...BRAND_COLOR);
  doc.text(company.name, cx, y, { align: "center" }); y += 6;

  doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...TEXT_MUTED);
  if (company.address) {
    doc.text(company.address + (company.city ? `, ${company.city}` : ""), cx, y, { align: "center" }); y += 4;
  }
  if (branchPhone) { doc.text(`Tél: ${branchPhone}`, cx, y, { align: "center" }); y += 4; }
  if (company.email) { doc.text(company.email, cx, y, { align: "center" }); y += 4; }

  doc.setDrawColor(...BORDER_COLOR); doc.setLineWidth(0.3);
  doc.line(L, y, R, y); y += 4;

  // Document type + meta
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...BRAND_DARK);
  doc.text(docLabel, cx, y, { align: "center" }); y += 5;

  doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...TEXT_MUTED);
  doc.text(`Réf: ${sale.reference}`, L, y);
  doc.text(statusLabel, R, y, { align: "right" }); y += 4;
  doc.text(`Date: ${fmtDate(sale.createdAt)}`, L, y); y += 4;
  doc.text(`Boutique: ${sale.branchName}`, L, y); y += 4;
  if (sale.type !== "sale" && sale.promisedDate) {
    doc.text(`Livraison: ${fmtDate(sale.promisedDate)}`, L, y); y += 4;
  }

  // Client
  if (sale.customerName) {
    doc.line(L, y, R, y); y += 3;
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...BRAND_DARK);
    doc.text(`Client: ${sale.customerName}`, L, y); y += 4;
    if (sale.customerPhone) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...TEXT_MUTED);
      doc.text(sale.customerPhone, L, y); y += 4;
    }
  }

  // Items
  doc.line(L, y, R, y); y += 3;
  doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...BRAND_DARK);
  doc.text("Désignation", L, y);
  doc.text("Qté", cx - 2, y, { align: "center" });
  doc.text("Total", R, y, { align: "right" }); y += 3;
  doc.setDrawColor(...BORDER_COLOR); doc.line(L, y, R, y); y += 3;

  doc.setFont("helvetica", "normal"); doc.setFontSize(7);
  for (const item of sale.items) {
    const name = item.productName.length > 26 ? item.productName.slice(0, 24) + "…" : item.productName;
    doc.setTextColor(...BRAND_DARK);
    doc.text(name, L, y);
    doc.text(String(item.quantity), cx - 2, y, { align: "center" });
    doc.text(fmtDA(item.total, sym), R, y, { align: "right" }); y += 3.5;
    doc.setTextColor(...TEXT_MUTED); doc.setFontSize(6.5);
    const priceInfo = `@ ${fmtDA(item.unitPrice, sym)}/u${item.discount > 0 ? ` · rem. ${fmtDA(item.discount, sym)}` : ""}`;
    doc.text(priceInfo, L + 2, y);
    doc.setFontSize(7); doc.setTextColor(...BRAND_DARK);
    y += 4.5;
  }

  // Totals
  doc.line(L, y, R, y); y += 4;

  const totRows: [string, string, boolean][] = [];
  if (sale.subtotal !== sale.total) totRows.push(["Sous-total", fmtDA(sale.subtotal, sym), false]);
  if (sale.discount > 0) totRows.push(["Remise", `- ${fmtDA(sale.discount, sym)}`, false]);
  if (sale.tax > 0) totRows.push(["TVA", `+ ${fmtDA(sale.tax, sym)}`, false]);
  if (sale.shippingFee > 0) totRows.push(["Frais de livraison", `+ ${fmtDA(sale.shippingFee, sym)}`, false]);
  totRows.push(["TOTAL TTC", fmtDA(sale.total, sym), true]);
  if (sale.paid > 0) totRows.push(["Versement payé", fmtDA(sale.paid, sym), false]);
  if (sale.due > 0) totRows.push(["Reste à payer", fmtDA(sale.due, sym), false]);

  for (const [lbl, val, isBold] of totRows) {
    doc.setFont("helvetica", isBold ? "bold" : "normal");
    doc.setFontSize(isBold ? 9 : 7);
    if (isBold) { doc.setTextColor(...BRAND_DARK); } else { doc.setTextColor(...TEXT_MUTED); }
    doc.text(lbl, L, y);
    doc.text(val, R, y, { align: "right" });
    y += isBold ? 6 : 4;
  }

  // Payments
  if (sale.payments.length > 0) {
    doc.line(L, y, R, y); y += 3;
    doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...BRAND_DARK);
    doc.text("Règlements", L, y); y += 4;
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); doc.setTextColor(...TEXT_MUTED);
    for (const p of sale.payments) {
      doc.text(`${fmtDate(p.date)} · ${PAYMENT_METHOD_LABELS[p.method] ?? p.method}`, L, y);
      doc.text(fmtDA(p.amount, sym), R, y, { align: "right" }); y += 4;
    }
  }

  // Notes
  if (sale.notes?.trim()) {
    doc.line(L, y, R, y); y += 3;
    doc.setFont("helvetica", "italic"); doc.setFontSize(7); doc.setTextColor(...TEXT_MUTED);
    const noteLines = doc.splitTextToSize(sale.notes.trim(), pageW - 8) as string[];
    doc.text(noteLines, L, y); y += noteLines.length * 4 + 2;
  }

  // Footer
  doc.line(L, y, R, y); y += 4;
  doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...TEXT_MUTED);
  doc.text("Merci de votre confiance !", cx, y, { align: "center" }); y += 4;
  if (company.footerNote) { doc.text(company.footerNote, cx, y, { align: "center" }); y += 4; }
  doc.text(`Imprimé le ${fmtDate(new Date())}`, cx, y, { align: "center" });

  doc.autoPrint();
  const blob = doc.output("blob");
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (win) {
    win.addEventListener("load", () => { setTimeout(() => URL.revokeObjectURL(url), 10_000); });
  } else {
    // Popup blocked → fallback to download
    const a = document.createElement("a");
    a.href = url;
    a.download = `TICKET-${sale.reference}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

// ── PURCHASE ORDER PDF ────────────────────────────────────────────────────

export function generatePurchasePdf(purchase: PurchaseDocData, company: CompanySettings): void {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const sym = company.currencySymbol ?? "DA";

  const statusLabel = PURCHASE_STATUS_LABELS[purchase.status] ?? purchase.status;
  const payLabel = PAY_STATUS_LABELS[purchase.paymentStatus] ?? purchase.paymentStatus;

  buildHeader(
    doc, company,
    "BON DE COMMANDE FOURNISSEUR", purchase.reference,
    fmtDate(purchase.createdAt), purchase.branchName,
    purchase.status, `${statusLabel} · ${payLabel}`,
  );

  let y = 55;

  // Delivery date
  if (purchase.expectedDelivery) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_MUTED);
    doc.text(`Livraison prévue : ${fmtDate(purchase.expectedDelivery)}`, 14, y);
    y += 6;
  }

  // Supplier block
  y = buildAddressBlock(
    doc, y, "Fournisseur", purchase.supplierName,
    purchase.supplierPhone, purchase.supplierEmail,
  );
  y += 2;

  // Items table
  autoTable(doc, {
    startY: y,
    head: [["Désignation", "Qté commandée", "Prix unitaire", "Remise", "Total"]],
    body: purchase.items.map(item => [
      item.productName,
      String(item.quantity),
      fmtDA(item.unitCost, sym),
      item.discount > 0 ? fmtDA(item.discount, sym) : "—",
      fmtDA(item.total, sym),
    ]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: {
      fillColor: BRAND_DARK, textColor: [255, 255, 255],
      fontStyle: "bold", fontSize: 8,
    },
    alternateRowStyles: { fillColor: [253, 251, 247] },
    columnStyles: {
      0: { cellWidth: "auto" as any },
      1: { halign: "center", cellWidth: 28 },
      2: { halign: "right", cellWidth: 32 },
      3: { halign: "right", cellWidth: 28 },
      4: { halign: "right", cellWidth: 35 },
    },
    footStyles: { fillColor: BRAND_LIGHT, textColor: BRAND_DARK, fontStyle: "bold" },
    foot: [[
      { content: `${purchase.items.length} référence(s)`, colSpan: 3, styles: { halign: "left" } },
      { content: "Sous-total", styles: { halign: "right" } },
      { content: fmtDA(purchase.subtotal, sym), styles: { halign: "right" } },
    ]],
    margin: { left: 14, right: 14 },
    theme: "grid",
    tableLineColor: BORDER_COLOR,
    tableLineWidth: 0.2,
  });

  y = (doc as any).lastAutoTable.finalY + 6;

  // Totals
  const totalsRows: [string, string][] = [];
  if (purchase.discount > 0) totalsRows.push(["Remise", `- ${fmtDA(purchase.discount, sym)}`]);
  if (purchase.tax > 0) totalsRows.push(["TVA / Taxes", `+ ${fmtDA(purchase.tax, sym)}`]);
  totalsRows.push(["──────────────────", "──────────────────"]);
  totalsRows.push(["TOTAL COMMANDE", fmtDA(purchase.total, sym)]);
  totalsRows.push(["Montant payé", fmtDA(purchase.paid, sym)]);
  totalsRows.push(["Solde restant", fmtDA(purchase.due, sym)]);

  y = buildTotalsBlock(doc, y, totalsRows);
  y += 4;

  // Payments
  if (purchase.payments.length > 0) {
    y = buildPaymentsBlock(doc, y, purchase.payments, sym);
  }

  // Notes
  if (purchase.notes?.trim()) {
    y = buildNotes(doc, y, purchase.notes);
  }

  buildFooter(doc, company);

  const filename = `${purchase.reference}-${fmtDate(purchase.createdAt).replace(/ /g, "-")}.pdf`;
  doc.save(filename);
}

// ── PURCHASE TICKET PDF (80 mm thermal) ───────────────────────────────────

export function generatePurchaseTicketPdf(purchase: PurchaseDocData, company: CompanySettings): void {
  const sym = company.currencySymbol ?? "DA";
  const statusLabel = PURCHASE_STATUS_LABELS[purchase.status] ?? purchase.status;
  const payLabel = PAY_STATUS_LABELS[purchase.paymentStatus] ?? purchase.paymentStatus;

  const totalsCount =
    (purchase.discount > 0 ? 1 : 0) +
    (purchase.tax > 0 ? 1 : 0) +
    1 + 1 + 1; // total + paid + due
  const paymentsH = purchase.payments.length > 0 ? purchase.payments.length * 5 + 12 : 0;
  const notesH = purchase.notes?.trim() ? 20 : 0;
  const estimatedH = 70 + purchase.items.length * 9 + totalsCount * 5 + paymentsH + notesH + 25;

  const doc = new jsPDF({ unit: "mm", format: [80, estimatedH], orientation: "portrait" });
  const pageW = doc.internal.pageSize.getWidth();
  const cx = pageW / 2;
  const L = 4;
  const R = pageW - 4;
  let y = 8;

  // Company header
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...BRAND_COLOR);
  doc.text(company.name, cx, y, { align: "center" }); y += 6;

  doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...TEXT_MUTED);
  if (company.address) {
    doc.text(company.address + (company.city ? `, ${company.city}` : ""), cx, y, { align: "center" }); y += 4;
  }
  if (company.phone) { doc.text(`Tél: ${company.phone}`, cx, y, { align: "center" }); y += 4; }

  doc.setDrawColor(...BORDER_COLOR); doc.setLineWidth(0.3);
  doc.line(L, y, R, y); y += 4;

  // Doc type + meta
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...BRAND_DARK);
  doc.text("BON DE COMMANDE FOURNISSEUR", cx, y, { align: "center" }); y += 5;

  doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...TEXT_MUTED);
  doc.text(`Réf: ${purchase.reference}`, L, y);
  doc.text(statusLabel, R, y, { align: "right" }); y += 4;
  doc.text(`Date: ${fmtDate(purchase.createdAt)}`, L, y); y += 4;
  doc.text(`Boutique: ${purchase.branchName}`, L, y); y += 4;
  doc.text(`Paiement: ${payLabel}`, L, y); y += 4;
  if (purchase.expectedDelivery) {
    doc.text(`Livraison prévue: ${fmtDate(purchase.expectedDelivery)}`, L, y); y += 4;
  }

  // Supplier
  doc.line(L, y, R, y); y += 3;
  doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...BRAND_DARK);
  doc.text(`Fournisseur: ${purchase.supplierName}`, L, y); y += 4;
  if (purchase.supplierPhone) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...TEXT_MUTED);
    doc.text(purchase.supplierPhone, L, y); y += 4;
  }

  // Items
  doc.line(L, y, R, y); y += 3;
  doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...BRAND_DARK);
  doc.text("Désignation", L, y);
  doc.text("Qté", cx - 2, y, { align: "center" });
  doc.text("Total", R, y, { align: "right" }); y += 3;
  doc.line(L, y, R, y); y += 3;

  doc.setFont("helvetica", "normal"); doc.setFontSize(7);
  for (const item of purchase.items) {
    const name = item.productName.length > 26 ? item.productName.slice(0, 24) + "…" : item.productName;
    doc.setTextColor(...BRAND_DARK);
    doc.text(name, L, y);
    doc.text(String(item.quantity), cx - 2, y, { align: "center" });
    doc.text(fmtDA(item.total, sym), R, y, { align: "right" }); y += 3.5;
    doc.setTextColor(...TEXT_MUTED); doc.setFontSize(6.5);
    const priceInfo = `@ ${fmtDA(item.unitCost, sym)}/u${item.discount > 0 ? ` · rem. ${fmtDA(item.discount, sym)}` : ""}`;
    doc.text(priceInfo, L + 2, y);
    doc.setFontSize(7); doc.setTextColor(...BRAND_DARK);
    y += 4.5;
  }

  // Totals
  doc.line(L, y, R, y); y += 4;

  const totRows: [string, string, boolean][] = [];
  if (purchase.discount > 0) totRows.push(["Remise", `- ${fmtDA(purchase.discount, sym)}`, false]);
  if (purchase.tax > 0) totRows.push(["TVA / Taxes", `+ ${fmtDA(purchase.tax, sym)}`, false]);
  totRows.push(["TOTAL COMMANDE", fmtDA(purchase.total, sym), true]);
  if (purchase.paid > 0) totRows.push(["Payé", fmtDA(purchase.paid, sym), false]);
  if (purchase.due > 0) totRows.push(["Reste à payer", fmtDA(purchase.due, sym), false]);

  for (const [lbl, val, isBold] of totRows) {
    doc.setFont("helvetica", isBold ? "bold" : "normal");
    doc.setFontSize(isBold ? 9 : 7);
    if (isBold) { doc.setTextColor(...BRAND_DARK); } else { doc.setTextColor(...TEXT_MUTED); }
    doc.text(lbl, L, y);
    doc.text(val, R, y, { align: "right" });
    y += isBold ? 6 : 4;
  }

  // Payments
  if (purchase.payments.length > 0) {
    doc.line(L, y, R, y); y += 3;
    doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...BRAND_DARK);
    doc.text("Règlements", L, y); y += 4;
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); doc.setTextColor(...TEXT_MUTED);
    for (const p of purchase.payments) {
      doc.text(`${fmtDate(p.date)} · ${PAYMENT_METHOD_LABELS[p.method] ?? p.method}`, L, y);
      doc.text(fmtDA(p.amount, sym), R, y, { align: "right" }); y += 4;
    }
  }

  // Notes
  if (purchase.notes?.trim()) {
    doc.line(L, y, R, y); y += 3;
    doc.setFont("helvetica", "italic"); doc.setFontSize(7); doc.setTextColor(...TEXT_MUTED);
    const noteLines = doc.splitTextToSize(purchase.notes.trim(), pageW - 8) as string[];
    doc.text(noteLines, L, y); y += noteLines.length * 4 + 2;
  }

  // Footer
  doc.line(L, y, R, y); y += 4;
  doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...TEXT_MUTED);
  doc.text("Merci de votre confiance !", cx, y, { align: "center" }); y += 4;
  if (company.footerNote) { doc.text(company.footerNote, cx, y, { align: "center" }); y += 4; }
  doc.text(`Imprimé le ${fmtDate(new Date())}`, cx, y, { align: "center" });

  doc.autoPrint();
  const blob = doc.output("blob");
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (win) {
    win.addEventListener("load", () => { setTimeout(() => URL.revokeObjectURL(url), 10_000); });
  } else {
    // Popup blocked → fallback to download
    const a = document.createElement("a");
    a.href = url;
    a.download = `TICKET-${purchase.reference}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

// ── SALES RETURN / AVOIR PDF ──────────────────────────────────────────────

export interface SaleReturnItem {
  productName: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface SaleReturnDocData {
  reference: string;
  saleReference: string;
  status: string;
  reason: string | null;
  notes: string | null;
  createdAt: string | Date;
  branchName: string;
  customerName: string | null;
  customerPhone?: string | null;
  totalAmount: number;
  refundedAmount: number;
  creditAmount: number;
  createdByName?: string | null;
  items: SaleReturnItem[];
}

const RETURN_STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon", confirmed: "Confirmé", refunded: "Remboursé",
  cancelled: "Annulé", credited: "Crédité",
};

export function generateSaleReturnPdf(ret: SaleReturnDocData, company: CompanySettings): void {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const sym = company.currencySymbol ?? "DA";

  buildHeader(doc, company, "AVOIR / BON DE RETOUR", ret.reference,
    fmtDate(ret.createdAt), ret.branchName, ret.status,
    RETURN_STATUS_LABELS[ret.status] ?? ret.status);

  let y = 55;

  // Linked original sale
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(...TEXT_MUTED);
  doc.text(`Vente d'origine : ${ret.saleReference}`, 14, y);
  if (ret.reason) { y += 5; doc.text(`Motif : ${ret.reason}`, 14, y); }
  y += 8;

  // Customer block
  if (ret.customerName) {
    y = buildAddressBlock(doc, y, "Client", ret.customerName, ret.customerPhone ?? null, null);
  }
  y += 2;

  // Items
  autoTable(doc, {
    startY: y,
    head: [["Désignation", "Qté retournée", "Prix unitaire", "Total"]],
    body: ret.items.map(item => [
      item.productName, String(item.quantity),
      fmtDA(item.unitPrice, sym), fmtDA(item.total, sym),
    ]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: BRAND_DARK, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
    alternateRowStyles: { fillColor: [253, 251, 247] },
    columnStyles: {
      0: { cellWidth: "auto" as any },
      1: { halign: "center", cellWidth: 30 },
      2: { halign: "right", cellWidth: 35 },
      3: { halign: "right", cellWidth: 35 },
    },
    margin: { left: 14, right: 14 }, theme: "grid",
    tableLineColor: BORDER_COLOR, tableLineWidth: 0.2,
  });

  y = (doc as any).lastAutoTable.finalY + 6;

  const totalsRows: [string, string][] = [
    ["Montant total retourné", fmtDA(ret.totalAmount, sym)],
    ["──────────────────", "──────────────────"],
  ];
  if (ret.refundedAmount > 0) totalsRows.push(["Remboursé en espèces", fmtDA(ret.refundedAmount, sym)]);
  if (ret.creditAmount > 0) totalsRows.push(["Crédit portefeuille", fmtDA(ret.creditAmount, sym)]);
  totalsRows.push(["TOTAL AVOIR", fmtDA(ret.totalAmount, sym)]);

  y = buildTotalsBlock(doc, y, totalsRows);

  if (ret.notes?.trim()) { y += 4; y = buildNotes(doc, y, ret.notes); }
  if (ret.createdByName) {
    y += 4;
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...TEXT_MUTED);
    doc.text(`Créé par : ${ret.createdByName}`, 14, y);
  }

  buildFooter(doc, company);
  doc.save(`AVOIR-${ret.reference}-${fmtDate(ret.createdAt).replace(/ /g, "-")}.pdf`);
}

// ── POS RECEIPT PDF ───────────────────────────────────────────────────────

export interface PosReceiptItem {
  productName: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
}

export interface PosReceiptData {
  reference: string;
  sessionRef?: string | null;
  createdAt: string | Date;
  branchName: string;
  branchPhone?: string | null;
  cashierName?: string | null;
  customerName?: string | null;
  items: PosReceiptItem[];
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  change: number;
  paymentMethod: string;
  creditApplied?: number;
  walletApplied?: number;
  notes?: string | null;
}

export function generatePosReceiptPdf(receipt: PosReceiptData, company: CompanySettings, format: "ticket" | "a4" = "ticket"): void {
  const sym = company.currencySymbol ?? "DA";
  const isTicket = format === "ticket";
  const doc = new jsPDF({ unit: "mm", format: isTicket ? [80, 200] : "a4", orientation: "portrait" });
  const pageW = doc.internal.pageSize.getWidth();

  if (isTicket) {
    // Compact ticket layout
    const cx = pageW / 2;
    let y = 8;

    // Header
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...BRAND_COLOR);
    doc.text(company.name, cx, y, { align: "center" }); y += 6;

    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...TEXT_MUTED);
    doc.text(receipt.branchName, cx, y, { align: "center" }); y += 4;
    const receiptPhone = receipt.branchPhone ?? company.phone;
    if (receiptPhone) { doc.text(`Tél: ${receiptPhone}`, cx, y, { align: "center" }); y += 4; }

    // Separator
    doc.setDrawColor(...BORDER_COLOR); doc.setLineWidth(0.3);
    doc.line(4, y, pageW - 4, y); y += 4;

    // Receipt meta
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...BRAND_DARK);
    doc.text("TICKET DE CAISSE", cx, y, { align: "center" }); y += 5;
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...TEXT_MUTED);
    doc.text(`Réf: ${receipt.reference}`, 4, y); y += 4;
    doc.text(fmtDate(receipt.createdAt), 4, y);
    if (receipt.cashierName) doc.text(`Caissier: ${receipt.cashierName}`, pageW - 4, y, { align: "right" });
    y += 4;
    if (receipt.customerName) { doc.text(`Client: ${receipt.customerName}`, 4, y); y += 4; }

    doc.line(4, y, pageW - 4, y); y += 4;

    // Items
    doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...BRAND_DARK);
    doc.text("Désignation", 4, y); doc.text("Qté", 44, y, { align: "center" }); doc.text("Total", pageW - 4, y, { align: "right" }); y += 3.5;
    doc.setDrawColor(...BORDER_COLOR); doc.line(4, y, pageW - 4, y); y += 3;

    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...BRAND_DARK);
    for (const item of receipt.items) {
      const name = item.productName.length > 22 ? item.productName.slice(0, 20) + "…" : item.productName;
      doc.text(name, 4, y);
      doc.text(String(item.quantity), 44, y, { align: "center" });
      doc.text(fmtDA(item.total, sym), pageW - 4, y, { align: "right" });
      if (item.unitPrice !== item.total / item.quantity) {
        y += 3.5;
        doc.setTextColor(...TEXT_MUTED); doc.setFontSize(6.5);
        doc.text(`  @ ${fmtDA(item.unitPrice, sym)}/u`, 4, y);
        doc.setTextColor(...BRAND_DARK); doc.setFontSize(7);
      }
      y += 4;
    }

    doc.line(4, y, pageW - 4, y); y += 3;

    // Totals
    const totLines: [string, string][] = [];
    if (receipt.discount > 0) totLines.push(["Remise", `- ${fmtDA(receipt.discount, sym)}`]);
    if (receipt.creditApplied && receipt.creditApplied > 0) totLines.push(["Crédit appliqué", `- ${fmtDA(receipt.creditApplied, sym)}`]);
    totLines.push(["TOTAL", fmtDA(receipt.total, sym)]);
    totLines.push(["Payé", fmtDA(receipt.paid, sym)]);
    if (receipt.change > 0) totLines.push(["Monnaie", fmtDA(receipt.change, sym)]);

    for (const [lbl, val] of totLines) {
      const isTot = lbl === "TOTAL";
      doc.setFont("helvetica", isTot ? "bold" : "normal");
      doc.setFontSize(isTot ? 8 : 7);
      if (isTot) { doc.setTextColor(...BRAND_DARK); } else { doc.setTextColor(...TEXT_MUTED); }
      doc.text(lbl, 4, y); doc.text(val, pageW - 4, y, { align: "right" });
      y += isTot ? 5 : 4;
    }

    y += 1; doc.line(4, y, pageW - 4, y); y += 4;

    // Payment mode
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...TEXT_MUTED);
    doc.text(`Mode de paiement: ${PAYMENT_METHOD_LABELS[receipt.paymentMethod] ?? receipt.paymentMethod}`, cx, y, { align: "center" }); y += 5;

    // Footer
    doc.setFontSize(6.5);
    doc.text("Merci de votre achat !", cx, y, { align: "center" }); y += 4;
    doc.text(company.footerNote ?? "Document généré par Pacane ERP", cx, y, { align: "center" });
  } else {
    // A4 receipt layout — use standard header
    buildHeader(doc, company, "TICKET DE CAISSE", receipt.reference,
      fmtDate(receipt.createdAt), receipt.branchName, "confirmed", "Confirmé", receipt.branchPhone);

    let y = 55;
    if (receipt.cashierName || receipt.customerName) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...TEXT_MUTED);
      if (receipt.cashierName) { doc.text(`Caissier : ${receipt.cashierName}`, 14, y); y += 5; }
      if (receipt.customerName) { doc.text(`Client : ${receipt.customerName}`, 14, y); y += 5; }
      y += 2;
    }

    autoTable(doc, {
      startY: y,
      head: [["Désignation", "Qté", "P.U.", "Remise", "Total"]],
      body: receipt.items.map(i => [i.productName, String(i.quantity), fmtDA(i.unitPrice, sym), i.discount > 0 ? fmtDA(i.discount, sym) : "—", fmtDA(i.total, sym)]),
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: BRAND_DARK, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
      alternateRowStyles: { fillColor: [253, 251, 247] },
      columnStyles: { 0: { cellWidth: "auto" as any }, 1: { halign: "center", cellWidth: 15 }, 2: { halign: "right", cellWidth: 30 }, 3: { halign: "right", cellWidth: 25 }, 4: { halign: "right", cellWidth: 30 } },
      margin: { left: 14, right: 14 }, theme: "grid",
    });

    y = (doc as any).lastAutoTable.finalY + 6;
    const tRows: [string, string][] = [];
    if (receipt.discount > 0) tRows.push(["Remise", `- ${fmtDA(receipt.discount, sym)}`]);
    tRows.push(["──────────────────", "──────────────────"]);
    tRows.push(["TOTAL TTC", fmtDA(receipt.total, sym)]);
    tRows.push(["Montant payé", fmtDA(receipt.paid, sym)]);
    if (receipt.change > 0) tRows.push(["Monnaie rendue", fmtDA(receipt.change, sym)]);
    tRows.push([`Mode de paiement: ${PAYMENT_METHOD_LABELS[receipt.paymentMethod] ?? receipt.paymentMethod}`, ""]);
    y = buildTotalsBlock(doc, y, tRows);
    buildFooter(doc, company);
  }

  doc.autoPrint();
  const blob = doc.output("blob");
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (win) {
    win.addEventListener("load", () => {
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    });
  }
}

// ── STOCK TRANSFER PDF ───────────────────────────────────────────────────

export interface TransferItem {
  productName: string;
  unitName?: string;
  quantity: number;
  receivedQuantity?: number;
}

export interface TransferDocData {
  reference: string;
  status: string;
  createdAt: string | Date;
  sentAt?: string | Date | null;
  receivedAt?: string | Date | null;
  sourceBranchName: string;
  destinationBranchName: string;
  createdByName?: string | null;
  notes?: string | null;
  items: TransferItem[];
}

const TRANSFER_STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon", sent: "Envoyé", partially_received: "Partiellement reçu",
  received: "Reçu intégralement", cancelled: "Annulé",
};

export function generateTransferPdf(transfer: TransferDocData, company: CompanySettings): void {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  buildHeader(doc, company, "BON DE TRANSFERT DE STOCK", transfer.reference,
    fmtDate(transfer.createdAt), transfer.sourceBranchName, transfer.status,
    TRANSFER_STATUS_LABELS[transfer.status] ?? transfer.status);

  let y = 55;

  // Route block
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFillColor(245, 242, 235);
  doc.setDrawColor(...BORDER_COLOR); doc.setLineWidth(0.3);
  doc.roundedRect(10, y, pageW - 20, 20, 2, 2, "FD");
  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...BRAND_COLOR);
  doc.text("SOURCE", 16, y + 7);
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...BRAND_DARK);
  doc.text(transfer.sourceBranchName, 16, y + 14);

  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...BRAND_COLOR);
  doc.text("DESTINATION", pageW - 16, y + 7, { align: "right" });
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...BRAND_DARK);
  doc.text(transfer.destinationBranchName, pageW - 16, y + 14, { align: "right" });

  // Arrow
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...BRAND_DARK);
  doc.text("→", pageW / 2, y + 13, { align: "center" });
  y += 26;

  // Dates
  if (transfer.sentAt || transfer.receivedAt) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...TEXT_MUTED);
    if (transfer.sentAt) { doc.text(`Envoyé le : ${fmtDate(transfer.sentAt)}`, 14, y); y += 5; }
    if (transfer.receivedAt) { doc.text(`Reçu le : ${fmtDate(transfer.receivedAt)}`, 14, y); y += 5; }
    y += 2;
  }

  // Items table — show sent qty and received qty if applicable
  const showReceived = transfer.items.some(i => i.receivedQuantity !== undefined && i.receivedQuantity !== null);
  const headers = showReceived
    ? [["Désignation", "Unité", "Qté envoyée", "Qté reçue", "Écart"]]
    : [["Désignation", "Unité", "Quantité envoyée"]];

  const body = transfer.items.map(item => {
    const row = [item.productName, item.unitName ?? "—", String(item.quantity)];
    if (showReceived) {
      const recv = item.receivedQuantity ?? 0;
      const diff = recv - item.quantity;
      row.push(String(recv));
      row.push(diff === 0 ? "✓" : diff > 0 ? `+${diff}` : String(diff));
    }
    return row;
  });

  autoTable(doc, {
    startY: y, head: headers, body,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: BRAND_DARK, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
    alternateRowStyles: { fillColor: [253, 251, 247] },
    columnStyles: {
      0: { cellWidth: "auto" as any },
      1: { halign: "center", cellWidth: 20 },
      2: { halign: "center", cellWidth: 30 },
      ...(showReceived ? { 3: { halign: "center", cellWidth: 25 }, 4: { halign: "center", cellWidth: 20 } } : {}),
    },
    foot: [[{
      content: `${transfer.items.length} référence(s) · Total articles: ${transfer.items.reduce((a, i) => a + i.quantity, 0)}`,
      colSpan: showReceived ? 5 : 3, styles: { halign: "left", fillColor: BRAND_LIGHT as any, textColor: BRAND_DARK as any, fontStyle: "bold" },
    }]],
    margin: { left: 14, right: 14 }, theme: "grid",
    tableLineColor: BORDER_COLOR, tableLineWidth: 0.2,
  });

  y = (doc as any).lastAutoTable.finalY + 6;

  if (transfer.createdByName) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...TEXT_MUTED);
    doc.text(`Créé par : ${transfer.createdByName}`, 14, y); y += 5;
  }
  if (transfer.notes?.trim()) { y = buildNotes(doc, y, transfer.notes); }

  // Signature lines
  const sigY = (doc as any).internal.pageSize.getHeight() - 40;
  doc.setDrawColor(...BORDER_COLOR); doc.setLineWidth(0.3);
  doc.line(14, sigY, 90, sigY);
  doc.line(pageW - 90, sigY, pageW - 14, sigY);
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...TEXT_MUTED);
  doc.text("Signature expéditeur", 52, sigY + 5, { align: "center" });
  doc.text("Signature réceptionnaire", pageW - 52, sigY + 5, { align: "center" });

  buildFooter(doc, company);
  doc.save(`BON-TRANSFERT-${transfer.reference}-${fmtDate(transfer.createdAt).replace(/ /g, "-")}.pdf`);
}

// ── PRODUCTION ORDER PDF ──────────────────────────────────────────────────

export interface ProductionIngredient {
  ingredientName: string;
  unitAbbreviation?: string;
  requiredQty: number;
  availableQty?: number;
  status?: "ok" | "short" | "missing";
}

export interface ProductionOrderDocData {
  reference: string;
  status: string;
  recipeName: string;
  productName?: string | null;
  branchName: string;
  plannedQuantity: number;
  actualQuantity?: number | null;
  theoreticalCost: number;
  actualCost?: number | null;
  startedAt?: string | Date | null;
  completedAt?: string | Date | null;
  createdAt: string | Date;
  createdByName?: string | null;
  notes?: string | null;
  ingredients?: ProductionIngredient[];
}

const PROD_STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon", planned: "Planifié", launched: "Lancé",
  in_progress: "En cours", completed: "Terminé", cancelled: "Annulé",
};

export function generateProductionOrderPdf(order: ProductionOrderDocData, company: CompanySettings): void {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const sym = company.currencySymbol ?? "DA";

  buildHeader(doc, company, "ORDRE DE PRODUCTION", order.reference,
    fmtDate(order.createdAt), order.branchName, order.status,
    PROD_STATUS_LABELS[order.status] ?? order.status);

  let y = 55;

  // Recipe + product info
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFillColor(245, 242, 235);
  doc.setDrawColor(...BORDER_COLOR); doc.setLineWidth(0.3);
  doc.roundedRect(10, y, pageW - 20, 28, 2, 2, "FD");

  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...BRAND_COLOR);
  doc.text("RECETTE", 16, y + 7);
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...BRAND_DARK);
  doc.text(order.recipeName, 16, y + 14);
  if (order.productName) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...TEXT_MUTED);
    doc.text(`Produit fini : ${order.productName}`, 16, y + 21);
  }

  // Right side: quantities
  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...BRAND_COLOR);
  doc.text("QUANTITÉ PLANIFIÉE", pageW - 16, y + 7, { align: "right" });
  doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(...BRAND_DARK);
  doc.text(String(order.plannedQuantity), pageW - 16, y + 16, { align: "right" });
  if (order.actualQuantity != null) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...TEXT_MUTED);
    doc.text(`Réalisé : ${order.actualQuantity}`, pageW - 16, y + 23, { align: "right" });
  }
  y += 34;

  // Dates + metadata
  const metaItems: [string, string][] = [
    ["Boutique / Laboratoire", order.branchName],
    ["Coût théorique", fmtDA(order.theoreticalCost, sym)],
  ];
  if (order.actualCost != null) metaItems.push(["Coût réel", fmtDA(order.actualCost, sym)]);
  if (order.startedAt) metaItems.push(["Lancé le", fmtDate(order.startedAt)]);
  if (order.completedAt) metaItems.push(["Terminé le", fmtDate(order.completedAt)]);
  if (order.createdByName) metaItems.push(["Créé par", order.createdByName]);

  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...TEXT_MUTED);
  for (let i = 0; i < metaItems.length; i += 2) {
    const [lbl1, val1] = metaItems[i];
    doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...BRAND_COLOR);
    doc.text(lbl1.toUpperCase(), 14, y);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...BRAND_DARK);
    doc.text(val1, 14, y + 4.5);

    if (metaItems[i + 1]) {
      const [lbl2, val2] = metaItems[i + 1];
      doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...BRAND_COLOR);
      doc.text(lbl2.toUpperCase(), pageW / 2 + 5, y);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...BRAND_DARK);
      doc.text(val2, pageW / 2 + 5, y + 4.5);
    }
    y += 10;
  }
  y += 2;

  // Ingredients table
  if (order.ingredients && order.ingredients.length > 0) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...BRAND_DARK);
    doc.text("Ingrédients", 14, y); y += 3;

    autoTable(doc, {
      startY: y,
      head: order.ingredients.some(i => i.availableQty !== undefined)
        ? [["Ingrédient", "Unité", "Qté nécessaire", "Qté disponible", "Statut"]]
        : [["Ingrédient", "Unité", "Quantité nécessaire"]],
      body: order.ingredients.map(ing => {
        const row = [ing.ingredientName, ing.unitAbbreviation ?? "—", String(ing.requiredQty)];
        if (ing.availableQty !== undefined) {
          row.push(String(ing.availableQty ?? 0));
          row.push(ing.status === "ok" ? "✓ OK" : ing.status === "short" ? "⚠ Manque" : "✗ Absent");
        }
        return row;
      }),
      styles: { fontSize: 7.5, cellPadding: 2.5 },
      headStyles: { fillColor: BRAND_DARK, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7.5 },
      alternateRowStyles: { fillColor: [253, 251, 247] },
      columnStyles: {
        0: { cellWidth: "auto" as any },
        1: { halign: "center", cellWidth: 18 },
        2: { halign: "right", cellWidth: 30 },
        ...(order.ingredients.some(i => i.availableQty !== undefined) ? { 3: { halign: "right", cellWidth: 30 }, 4: { halign: "center", cellWidth: 25 } } : {}),
      },
      margin: { left: 14, right: 14 }, theme: "grid",
      tableLineColor: BORDER_COLOR, tableLineWidth: 0.2,
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  if (order.notes?.trim()) { y = buildNotes(doc, y, order.notes); }

  buildFooter(doc, company);
  doc.save(`PROD-${order.reference}-${fmtDate(order.createdAt).replace(/ /g, "-")}.pdf`);
}

// ── EXPENSE SLIP PDF ──────────────────────────────────────────────────────

export interface ExpenseDocData {
  reference: string;
  branchName: string;
  category: string;
  amount: number;
  date: string | Date;
  paymentMethod: string;
  status: string;
  notes?: string | null;
  createdByName?: string | null;
  createdAt?: string | Date;
}

const EXPENSE_STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon", validated: "Validé", cancelled: "Annulé",
};

export function generateExpensePdf(expense: ExpenseDocData, company: CompanySettings): void {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const sym = company.currencySymbol ?? "DA";

  buildHeader(doc, company, "BON DE DÉPENSE", expense.reference,
    fmtDate(expense.date), expense.branchName, expense.status,
    EXPENSE_STATUS_LABELS[expense.status] ?? expense.status);

  let y = 58;
  const pageW = doc.internal.pageSize.getWidth();

  // Main expense card
  doc.setFillColor(...BRAND_LIGHT);
  doc.setDrawColor(...BORDER_COLOR); doc.setLineWidth(0.3);
  doc.roundedRect(10, y, pageW - 20, 60, 3, 3, "FD");

  const fields: [string, string][] = [
    ["Catégorie", expense.category],
    ["Montant", fmtDA(expense.amount, sym)],
    ["Date de dépense", fmtDate(expense.date)],
    ["Mode de paiement", PAYMENT_METHOD_LABELS[expense.paymentMethod] ?? expense.paymentMethod],
    ["Boutique", expense.branchName],
    ["Statut", EXPENSE_STATUS_LABELS[expense.status] ?? expense.status],
  ];
  if (expense.createdByName) fields.push(["Saisi par", expense.createdByName]);

  const colW = (pageW - 20) / 2 - 4;
  let fx = 16; let fy = y + 10;
  for (let i = 0; i < fields.length; i++) {
    const [lbl, val] = fields[i];
    doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...BRAND_COLOR);
    doc.text(lbl.toUpperCase(), fx, fy);
    doc.setFont("helvetica", "bold"); doc.setFontSize(lbl === "Montant" ? 11 : 9); doc.setTextColor(...BRAND_DARK);
    doc.text(val, fx, fy + 5);

    if (i % 2 === 0) { fx = pageW / 2 + 5; }
    else { fx = 16; fy += 16; }
  }

  y += 68;

  if (expense.notes?.trim()) { y = buildNotes(doc, y, expense.notes); }

  // Signature area
  y += 10;
  doc.setDrawColor(...BORDER_COLOR); doc.setLineWidth(0.3);
  doc.line(14, y, 90, y); doc.line(pageW - 90, y, pageW - 14, y);
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...TEXT_MUTED);
  doc.text("Signature responsable", 52, y + 5, { align: "center" });
  doc.text("Signature validateur", pageW - 52, y + 5, { align: "center" });

  buildFooter(doc, company);
  doc.save(`DEPENSE-${expense.reference}-${fmtDate(expense.date).replace(/ /g, "-")}.pdf`);
}

// ── STOCK ADJUSTMENT PDF ──────────────────────────────────────────────────

export interface AdjustmentDocData {
  reference: string;
  branchName: string;
  productName: string;
  quantityChange: number;
  reason: string;
  notes?: string | null;
  createdByName?: string | null;
  createdAt: string | Date;
}

export function generateAdjustmentPdf(adj: AdjustmentDocData, company: CompanySettings): void {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageW = doc.internal.pageSize.getWidth();
  const isPositive = adj.quantityChange > 0;

  buildHeader(doc, company, "BON D'AJUSTEMENT DE STOCK", adj.reference,
    fmtDate(adj.createdAt), adj.branchName, isPositive ? "positive" : "negative",
    isPositive ? "Entrée" : "Sortie");

  let y = 58;

  doc.setFillColor(...BRAND_LIGHT);
  doc.setDrawColor(...BORDER_COLOR); doc.setLineWidth(0.3);
  doc.roundedRect(10, y, pageW - 20, 50, 3, 3, "FD");

  const fields: [string, string][] = [
    ["Produit", adj.productName],
    ["Variation de stock", `${isPositive ? "+" : ""}${adj.quantityChange}`],
    ["Boutique", adj.branchName],
    ["Motif", adj.reason],
    ["Date", fmtDate(adj.createdAt)],
    ["Saisi par", adj.createdByName ?? "—"],
  ];

  let fx = 16; let fy = y + 10;
  for (let i = 0; i < fields.length; i++) {
    const [lbl, val] = fields[i];
    doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...BRAND_COLOR);
    doc.text(lbl.toUpperCase(), fx, fy);
    const isQty = lbl === "Variation de stock";
    doc.setFont("helvetica", "bold"); doc.setFontSize(isQty ? 14 : 9);
    if (isQty) { doc.setTextColor(isPositive ? 20 : 200, isPositive ? 120 : 40, 20); } else { doc.setTextColor(...BRAND_DARK); }
    doc.text(val, fx, fy + (isQty ? 7 : 5));

    if (i % 2 === 0) { fx = pageW / 2 + 5; }
    else { fx = 16; fy += 16; }
  }

  y += 58;
  if (adj.notes?.trim()) { y = buildNotes(doc, y, adj.notes); }

  buildFooter(doc, company);
  doc.save(`AJUST-${adj.reference}-${fmtDate(adj.createdAt).replace(/ /g, "-")}.pdf`);
}

// ── GOODS RECEIPT PDF (Bon de réception d'achat) ─────────────────────────

export interface ReceptionItem {
  productName: string;
  orderedQuantity: number;
  receivedQuantity: number;
  rejectedQuantity?: number;
  unitCost: number;
  total: number;
}

export interface ReceptionDocData {
  reference: string;
  purchaseReference: string;
  branchName: string;
  supplierName: string;
  status: string;
  createdAt: string | Date;
  receivedByName?: string | null;
  notes?: string | null;
  items: ReceptionItem[];
  totalReceived: number;
}

export function generateReceptionPdf(reception: ReceptionDocData, company: CompanySettings): void {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const sym = company.currencySymbol ?? "DA";

  buildHeader(doc, company, "BON DE RÉCEPTION", reception.reference,
    fmtDate(reception.createdAt), reception.branchName, "received", "Reçu");

  let y = 55;

  // Linked PO
  doc.setFont("helvetica", "italic"); doc.setFontSize(8); doc.setTextColor(...TEXT_MUTED);
  doc.text(`Bon de commande lié : ${reception.purchaseReference}`, 14, y); y += 6;

  // Supplier block
  y = buildAddressBlock(doc, y, "Fournisseur", reception.supplierName, null, null);
  y += 2;

  // Items
  autoTable(doc, {
    startY: y,
    head: [["Désignation", "Qté commandée", "Qté reçue", "Qté rejetée", "P.U.", "Total"]],
    body: reception.items.map(item => [
      item.productName, String(item.orderedQuantity), String(item.receivedQuantity),
      String(item.rejectedQuantity ?? 0), fmtDA(item.unitCost, sym), fmtDA(item.total, sym),
    ]),
    styles: { fontSize: 7.5, cellPadding: 2.5 },
    headStyles: { fillColor: BRAND_DARK, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7.5 },
    alternateRowStyles: { fillColor: [253, 251, 247] },
    columnStyles: {
      0: { cellWidth: "auto" as any },
      1: { halign: "center", cellWidth: 24 }, 2: { halign: "center", cellWidth: 22 },
      3: { halign: "center", cellWidth: 22 }, 4: { halign: "right", cellWidth: 25 }, 5: { halign: "right", cellWidth: 28 },
    },
    foot: [[{
      content: `Total reçu : ${fmtDA(reception.totalReceived, sym)}`,
      colSpan: 6, styles: { halign: "right", fillColor: BRAND_LIGHT as any, textColor: BRAND_DARK as any, fontStyle: "bold" },
    }]],
    margin: { left: 14, right: 14 }, theme: "grid",
    tableLineColor: BORDER_COLOR, tableLineWidth: 0.2,
  });

  y = (doc as any).lastAutoTable.finalY + 6;
  if (reception.receivedByName) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...TEXT_MUTED);
    doc.text(`Reçu par : ${reception.receivedByName}`, 14, y); y += 5;
  }
  if (reception.notes?.trim()) { y = buildNotes(doc, y, reception.notes); }

  buildFooter(doc, company);
  doc.save(`BRF-${reception.reference}-${fmtDate(reception.createdAt).replace(/ /g, "-")}.pdf`);
}

// ── POS SESSION CLOSURE REPORT ─────────────────────────────────────────────

export interface SessionClosureData {
  reference?: string;
  branchName: string;
  userName: string;
  openedAt: string;
  closedAt: string | null;
  openingCash: number;
  totalSales: number;
  totalCashSales: number;
  totalCardSales: number;
  expectedCash: number | null;
  countedCash: number | null;
  variance: number | null;
  closureNotes?: string | null;
}

export function generateSessionClosurePdf(session: SessionClosureData, company: CompanySettings): void {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageW = doc.internal.pageSize.getWidth();
  const sym = company.currencySymbol ?? "DA";
  const ref = session.reference ?? `CLOTURE-${Date.now()}`;

  buildHeader(doc, company, "RAPPORT DE FERMETURE DE CAISSE", ref,
    fmtDate(session.closedAt ?? new Date().toISOString()), session.branchName, "negative", "Fermée");

  let y = 60;

  // ── Infos session ──
  doc.setFillColor(...BRAND_LIGHT);
  doc.setDrawColor(...BORDER_COLOR); doc.setLineWidth(0.3);
  doc.roundedRect(10, y, pageW - 20, 30, 3, 3, "FD");

  const infoFields: [string, string][] = [
    ["Boutique", session.branchName],
    ["Caissier(ère)", session.userName],
    ["Ouverture", fmtDate(session.openedAt) + " à " + (session.openedAt ? new Date(session.openedAt).toLocaleTimeString("fr-DZ", { hour: "2-digit", minute: "2-digit" }) : "—")],
    ["Fermeture", session.closedAt ? fmtDate(session.closedAt) + " à " + new Date(session.closedAt).toLocaleTimeString("fr-DZ", { hour: "2-digit", minute: "2-digit" }) : "—"],
  ];

  let fx = 16; let fy = y + 10;
  for (let i = 0; i < infoFields.length; i++) {
    const [lbl, val] = infoFields[i];
    doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...BRAND_COLOR);
    doc.text(lbl.toUpperCase(), fx, fy);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...BRAND_DARK);
    doc.text(val, fx, fy + 5);
    if (i % 2 === 0) { fx = pageW / 2 + 5; }
    else { fx = 16; fy += 14; }
  }

  y += 38;

  // ── Tableau ventes ──
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...BRAND_COLOR);
  doc.text("RÉSUMÉ DES VENTES", 14, y); y += 4;

  autoTable(doc, {
    startY: y,
    head: [["Moyen de paiement", "Montant"]],
    body: [
      ["Espèces (نقداً)", fmtDA(session.totalCashSales, sym)],
      ["Carte bancaire", fmtDA(session.totalCardSales, sym)],
      [{ content: "TOTAL VENTES", styles: { fontStyle: "bold" } }, { content: fmtDA(session.totalSales, sym), styles: { fontStyle: "bold" } }],
    ],
    theme: "grid",
    styles: { font: "helvetica", fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: BRAND_DARK, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
    columnStyles: { 0: { cellWidth: pageW - 20 - 50 }, 1: { cellWidth: 50, halign: "right" } },
    margin: { left: 14, right: 14 },
    didParseCell: (data: any) => {
      if (data.row.index === 2) {
        data.cell.styles.fillColor = BRAND_LIGHT;
        data.cell.styles.textColor = BRAND_DARK;
      }
    },
  });

  y = (doc as any).lastAutoTable.finalY + 8;

  // ── Tableau caisse ──
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...BRAND_COLOR);
  doc.text("ÉTAT DE LA CAISSE", 14, y); y += 4;

  const varAmt = session.variance ?? 0;
  const varOk = Math.abs(varAmt) < 100;

  autoTable(doc, {
    startY: y,
    body: [
      ["Fond initial (fonds de départ)", fmtDA(session.openingCash, sym)],
      ["+ Ventes espèces", fmtDA(session.totalCashSales, sym)],
      [{ content: "= Espèces attendues dans le tiroir", styles: { fontStyle: "bold" } }, { content: fmtDA(session.expectedCash ?? 0, sym), styles: { fontStyle: "bold" } }],
      ["Espèces comptées (réel)", fmtDA(session.countedCash ?? 0, sym)],
      [
        { content: "Écart de caisse", styles: { fontStyle: "bold", textColor: varOk ? [20, 120, 20] : [200, 40, 40] } },
        { content: (varAmt >= 0 ? "+" : "") + fmtDA(varAmt, sym), styles: { fontStyle: "bold", textColor: varOk ? [20, 120, 20] : [200, 40, 40] } }
      ],
    ],
    theme: "striped",
    styles: { font: "helvetica", fontSize: 9, cellPadding: 3 },
    columnStyles: { 0: { cellWidth: pageW - 20 - 50 }, 1: { cellWidth: 50, halign: "right" } },
    margin: { left: 14, right: 14 },
  });

  y = (doc as any).lastAutoTable.finalY + 8;

  // ── Statut écart ──
  if (varOk) {
    doc.setFillColor(220, 245, 220);
    doc.setDrawColor(100, 180, 100); doc.setLineWidth(0.3);
    doc.roundedRect(14, y, pageW - 28, 10, 2, 2, "FD");
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(20, 120, 20);
    doc.text("✓  Caisse équilibrée — Aucun écart significatif", 20, y + 7);
  } else {
    doc.setFillColor(250, 220, 220);
    doc.setDrawColor(200, 80, 80); doc.setLineWidth(0.3);
    doc.roundedRect(14, y, pageW - 28, 10, 2, 2, "FD");
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(180, 40, 40);
    doc.text("⚠  Écart de caisse à vérifier", 20, y + 7);
  }
  y += 18;

  // ── Notes ──
  if (session.closureNotes?.trim()) {
    y = buildNotes(doc, y, session.closureNotes);
  }

  // ── Signature ──
  y = Math.max(y, 230);
  doc.setDrawColor(...BORDER_COLOR); doc.setLineWidth(0.3);
  doc.line(14, y, 80, y);
  doc.line(pageW - 80, y, pageW - 14, y);
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...TEXT_MUTED);
  doc.text("Signature du caissier(ère)", 14, y + 5);
  doc.text("Signature du gérant / contrôleur", pageW - 80, y + 5);

  buildFooter(doc, company);
  const dateStr = fmtDate(session.closedAt ?? new Date().toISOString()).replace(/ /g, "-");
  doc.save(`CLOTURE-${session.branchName.replace(/\s+/g, "-")}-${dateStr}.pdf`);
}
