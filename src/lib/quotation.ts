import * as XLSX from "xlsx";

export type QuotationLine = {
  sku: string;
  description: string;
  quantity: number;
  unit_price: number; // cost / base price from price list
  margin_pct: number; // markup % applied to unit_price
  discount_pct: number; // discount % applied after markup
  unit?: string;
  line_total: number; // qty * unit_price * (1+margin) * (1-discount)
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

export function computeLineTotal(
  qty: number,
  unitPrice: number,
  marginPct: number,
  discountPct: number,
): number {
  const sell = unitPrice * (1 + (marginPct || 0) / 100);
  const afterDisc = sell * (1 - (discountPct || 0) / 100);
  return +(qty * afterDisc).toFixed(2);
}

export function sellingPrice(unitPrice: number, marginPct: number): number {
  return +(unitPrice * (1 + (marginPct || 0) / 100)).toFixed(4);
}

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
    [
      "#",
      "SKU",
      "Description",
      "Unit",
      "Qty",
      "Cost",
      "Margin %",
      "Sell Price",
      "Discount %",
      "Line Total",
    ],
  ];

  const rows = data.lines.map((l, i) => [
    i + 1,
    l.sku,
    l.description,
    l.unit ?? "pcs",
    l.quantity,
    l.unit_price,
    l.margin_pct,
    sellingPrice(l.unit_price, l.margin_pct),
    l.discount_pct,
    l.line_total,
  ]);

  const totals: (string | number)[][] = [
    [],
    ["", "", "", "", "", "", "", "", "Subtotal", data.subtotal],
    ["", "", "", "", "", "", "", "", `Tax (${data.tax_rate}%)`, data.tax_amount],
    ["", "", "", "", "", "", "", "", "TOTAL", data.total],
  ];

  if (data.notes) {
    totals.push([], ["Notes:", data.notes]);
  }
  if (data.unmatched_skus && data.unmatched_skus.length) {
    totals.push(
      [],
      [
        "Unmatched SKUs (not in price list):",
        data.unmatched_skus.join(", "),
      ],
    );
  }

  const aoa = [...header, ...rows, ...totals];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  ws["!cols"] = [
    { wch: 4 },
    { wch: 14 },
    { wch: 36 },
    { wch: 8 },
    { wch: 8 },
    { wch: 10 },
    { wch: 10 },
    { wch: 12 },
    { wch: 12 },
    { wch: 14 },
  ];

  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } }];

  XLSX.utils.book_append_sheet(wb, ws, "Quotation");

  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return buf as ArrayBuffer;
}

/**
 * Build a Zoho Books-compatible CSV for Estimates import.
 * Columns based on Zoho's standard estimate import template.
 */
export function buildZohoEstimateCSV(data: QuotationData): string {
  const headers = [
    "Estimate Number",
    "Estimate Date",
    "Customer Name",
    "Customer Email",
    "Currency Code",
    "Item Name",
    "SKU",
    "Item Desc",
    "Quantity",
    "Usage unit",
    "Item Price",
    "Discount",
    "Discount Type",
    "Item Tax %",
    "Item Total",
    "Notes",
  ];

  const escape = (v: string | number | undefined | null): string => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const rows: string[][] = [headers];

  data.lines.forEach((l, idx) => {
    const sell = sellingPrice(l.unit_price, l.margin_pct);
    rows.push([
      data.quotation_number,
      data.date,
      data.customer_name || "",
      data.customer_email || "",
      data.currency,
      l.description,
      l.sku,
      l.description,
      String(l.quantity),
      l.unit ?? "pcs",
      String(sell),
      String(l.discount_pct || 0),
      "percentage",
      idx === 0 ? String(data.tax_rate || 0) : "0",
      String(l.line_total),
      idx === 0 ? data.notes ?? "" : "",
    ].map(escape));
  });

  return rows.map((r) => r.join(",")).join("\r\n");
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
