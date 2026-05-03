import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { QuotationLine } from "./quotation";

export type QuotationPDFData = {
  quotation_number: string;
  date: string;
  customer_name: string | null;
  customer_email: string | null;
  currency: string;
  lines: QuotationLine[];
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  notes?: string | null;
  created_by_name?: string | null;
  sent_by_name?: string | null;
  sent_at?: string | null;
  reviewed_by_name?: string | null;
  reviewed_at?: string | null;
};

export function generateQuotationPDF(data: QuotationPDFData): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;

  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text("QUOTATION", margin, 50);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`#${data.quotation_number}`, pageWidth - margin, 50, { align: "right" });
  doc.text(`Date: ${data.date}`, pageWidth - margin, 65, { align: "right" });

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Bill To:", margin, 90);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(data.customer_name || "—", margin, 105);
  if (data.customer_email) doc.text(data.customer_email, margin, 118);

  const body = data.lines.map((l, i) => {
    const sell = +(l.unit_price * (1 + (l.margin_pct || 0) / 100)).toFixed(2);
    return [
      String(i + 1),
      l.sku,
      l.description,
      String(l.quantity),
      sell.toFixed(2),
      `${l.discount_pct || 0}%`,
      l.line_total.toFixed(2),
    ];
  });

  autoTable(doc, {
    startY: 140,
    head: [["#", "SKU", "Description", "Qty", "Unit Price", "Disc", "Total"]],
    body,
    margin: { left: margin, right: margin },
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [40, 40, 40] },
    columnStyles: {
      0: { cellWidth: 25 },
      1: { cellWidth: 70 },
      3: { halign: "right", cellWidth: 40 },
      4: { halign: "right", cellWidth: 65 },
      5: { halign: "right", cellWidth: 45 },
      6: { halign: "right", cellWidth: 70 },
    },
  });

  // @ts-expect-error lastAutoTable injected by plugin
  let y: number = doc.lastAutoTable.finalY + 20;
  const labelX = pageWidth - margin - 150;
  const valX = pageWidth - margin;

  doc.setFontSize(10);
  doc.text("Subtotal:", labelX, y);
  doc.text(`${data.currency} ${data.subtotal.toFixed(2)}`, valX, y, { align: "right" });
  y += 15;
  doc.text(`Tax (${data.tax_rate}%):`, labelX, y);
  doc.text(`${data.currency} ${data.tax_amount.toFixed(2)}`, valX, y, { align: "right" });
  y += 18;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("TOTAL:", labelX, y);
  doc.text(`${data.currency} ${data.total.toFixed(2)}`, valX, y, { align: "right" });

  y += 30;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  if (data.notes) {
    doc.setFont("helvetica", "bold");
    doc.text("Notes:", margin, y);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(data.notes, pageWidth - margin * 2);
    doc.text(lines, margin, y + 13);
    y += 13 + lines.length * 12;
  }

  // Stamps
  y = Math.max(y + 20, doc.internal.pageSize.getHeight() - 100);
  doc.setDrawColor(180);
  doc.line(margin, y, pageWidth - margin, y);
  y += 14;
  doc.setFontSize(8);
  doc.setTextColor(90);
  if (data.created_by_name) doc.text(`Created by: ${data.created_by_name}`, margin, y);
  if (data.reviewed_by_name && data.reviewed_at) {
    doc.text(
      `Reviewed & approved by: ${data.reviewed_by_name} on ${new Date(data.reviewed_at).toLocaleString()}`,
      margin,
      y + 12,
    );
  }
  if (data.sent_by_name && data.sent_at) {
    doc.text(
      `Sent by: ${data.sent_by_name} on ${new Date(data.sent_at).toLocaleString()}`,
      margin,
      y + 24,
    );
  }

  return doc;
}
