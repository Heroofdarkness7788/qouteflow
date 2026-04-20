import * as XLSX from "xlsx";

export type QuotationLine = {
  sku: string;
  description: string;
  quantity: number;
  unit_price: number;
  unit?: string;
  line_total: number;
};

export type QuotationData = {
  quotation_number: string;
  date: string;
  customer_name: string;
  customer_email: string;
  currency: string;
  lines: QuotationLine[];
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  notes?: string;
  unmatched_skus?: string[];
};

export function buildQuotationWorkbook(data: QuotationData): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  const header: (string | number)[][] = [
    ["QUOTATION"],
    [],
    ["Quotation No.", data.quotation_number],
    ["Date", data.date],
    ["Customer", data.customer_name || ""],
    ["Email", data.customer_email || ""],
    ["Currency", data.currency],
    [],
    ["#", "SKU", "Description", "Unit", "Qty", "Unit Price", "Line Total"],
  ];

  const rows = data.lines.map((l, i) => [
    i + 1,
    l.sku,
    l.description,
    l.unit ?? "pcs",
    l.quantity,
    l.unit_price,
    l.line_total,
  ]);

  const totals: (string | number)[][] = [
    [],
    ["", "", "", "", "", "Subtotal", data.subtotal],
    ["", "", "", "", "", `Tax (${data.tax_rate}%)`, data.tax_amount],
    ["", "", "", "", "", "TOTAL", data.total],
  ];

  if (data.notes) {
    totals.push([], ["Notes:", data.notes]);
  }
  if (data.unmatched_skus && data.unmatched_skus.length) {
    totals.push([], [
      "Unmatched SKUs (not in price list):",
      data.unmatched_skus.join(", "),
    ]);
  }

  const aoa = [...header, ...rows, ...totals];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Column widths
  ws["!cols"] = [
    { wch: 4 },
    { wch: 14 },
    { wch: 40 },
    { wch: 8 },
    { wch: 8 },
    { wch: 12 },
    { wch: 14 },
  ];

  // Merge title across columns
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }];

  XLSX.utils.book_append_sheet(wb, ws, "Quotation");

  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return buf as ArrayBuffer;
}

export function parsePriceListFile(file: ArrayBuffer): {
  sku: string;
  description: string;
  unit_price: number;
  unit?: string;
  currency?: string;
}[] {
  const wb = XLSX.read(file, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
  });

  const findKey = (obj: Record<string, unknown>, candidates: string[]) => {
    const keys = Object.keys(obj);
    for (const c of candidates) {
      const k = keys.find((kk) => kk.toLowerCase().trim() === c);
      if (k) return k;
    }
    // partial match
    for (const c of candidates) {
      const k = keys.find((kk) => kk.toLowerCase().includes(c));
      if (k) return k;
    }
    return null;
  };

  const out: ReturnType<typeof parsePriceListFile> = [];
  for (const r of rows) {
    const skuKey = findKey(r, ["sku", "code", "item code", "product code", "item"]);
    const descKey = findKey(r, ["description", "name", "product", "item name"]);
    const priceKey = findKey(r, ["price", "unit price", "rate", "cost"]);
    const unitKey = findKey(r, ["unit", "uom"]);
    const currencyKey = findKey(r, ["currency", "ccy"]);
    if (!skuKey || !priceKey) continue;
    const sku = String(r[skuKey] ?? "").trim();
    const price = Number(String(r[priceKey] ?? "").replace(/[^\d.\-]/g, ""));
    if (!sku || isNaN(price)) continue;
    out.push({
      sku,
      description: descKey ? String(r[descKey] ?? "").trim() : sku,
      unit_price: price,
      unit: unitKey ? String(r[unitKey] ?? "").trim() || undefined : undefined,
      currency: currencyKey ? String(r[currencyKey] ?? "").trim() || undefined : undefined,
    });
  }
  return out;
}
