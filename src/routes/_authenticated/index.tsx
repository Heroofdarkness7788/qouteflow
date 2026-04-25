import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useState, useCallback, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { friendlyError, useAuth } from "@/lib/auth-context";
import { Sparkles, Upload, X, Download, Save, Loader2, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import {
  extractOrderFromEmail,
} from "@/utils/orders.functions";
import {
  searchEbayBestSellers,
  type EbayBestSeller,
} from "@/utils/ebay.functions";
import {
  buildQuotationWorkbook,
  buildZohoEstimateCSV,
  computeLineTotal,
  sellingPrice,
  type QuotationLine,
} from "@/lib/quotation";

export const Route = createFileRoute("/_authenticated/")({
  component: NewOrderPage,
  head: () => ({
    meta: [
      { title: "New Order — QuoteFlow" },
      {
        name: "description",
        content:
          "Paste a customer order email and instantly generate an Excel quotation matched against your price list.",
      },
    ],
  }),
});

type Attachment = { name: string; mime_type: string; data: string; size: number };

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      resolve(res.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function NewOrderPage() {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [taxRate, setTaxRate] = useState(0);
  const [defaultMargin, setDefaultMargin] = useState(0);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lines, setLines] = useState<QuotationLine[]>([]);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [ebayResults, setEbayResults] = useState<Record<string, EbayBestSeller>>({});
  const [ebayLoading, setEbayLoading] = useState(false);

  const extract = useServerFn(extractOrderFromEmail);
  const ebaySearch = useServerFn(searchEbayBestSellers);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  const onDrop = useCallback(async (files: File[]) => {
    const newOnes: Attachment[] = [];
    for (const f of files) {
      if (f.size > 8 * 1024 * 1024) {
        toast.error(`${f.name} too large (max 8MB)`);
        continue;
      }
      const data = await fileToBase64(f);
      newOnes.push({ name: f.name, mime_type: f.type || "application/octet-stream", data, size: f.size });
    }
    setAttachments((a) => [...a, ...newOnes].slice(0, 5));
  }, []);

  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + l.line_total, 0),
    [lines],
  );
  const taxAmount = useMemo(() => (subtotal * taxRate) / 100, [subtotal, taxRate]);
  const total = subtotal + taxAmount;

  const recalc = (l: QuotationLine): QuotationLine => ({
    ...l,
    line_total: computeLineTotal(l.quantity, l.unit_price, l.margin_pct, l.discount_pct),
  });
  const updateQty = (idx: number, qty: number) => {
    setLines((ls) => ls.map((l, i) => (i === idx ? recalc({ ...l, quantity: qty }) : l)));
  };
  const updatePrice = (idx: number, price: number) => {
    setLines((ls) => ls.map((l, i) => (i === idx ? recalc({ ...l, unit_price: price }) : l)));
  };
  const updateMargin = (idx: number, m: number) => {
    setLines((ls) => ls.map((l, i) => (i === idx ? recalc({ ...l, margin_pct: m }) : l)));
  };
  const updateDiscount = (idx: number, d: number) => {
    setLines((ls) => ls.map((l, i) => (i === idx ? recalc({ ...l, discount_pct: d }) : l)));
  };
  const removeLine = (idx: number) =>
    setLines((ls) => ls.filter((_, i) => i !== idx));

  const runExtract = async () => {
    if (!body.trim()) {
      toast.error("Paste the email body first");
      return;
    }
    setExtracting(true);
    try {
      const result = await extract({
        data: {
          email_subject: subject,
          email_body: body,
          attachments: attachments.map(({ name, mime_type, data }) => ({
            name,
            mime_type,
            data,
          })),
        },
      });

      if (result.customer_name && !customerName) setCustomerName(result.customer_name);
      if (result.customer_email && !customerEmail)
        setCustomerEmail(result.customer_email);
      if (result.notes) setNotes(result.notes);

      if (result.items.length === 0) {
        toast.warning("AI didn't find any line items. This may not be an order.");
        return;
      }

      // Match against price list
      const skus = [...new Set(result.items.map((i) => i.sku))];
      const { data: priceRows, error } = await supabase
        .from("price_list")
        .select("sku,description,unit_price,unit,currency")
        .in("sku", skus);
      if (error) throw error;

      const map = new Map(
        (priceRows ?? []).map((r) => [r.sku.toUpperCase(), r]),
      );

      const matched: QuotationLine[] = [];
      const missing: string[] = [];

      const used = new Set<string>();
      for (const item of result.items) {
        const sku = item.sku.toUpperCase();
        const p = map.get(sku);
        if (!p) {
          if (!used.has(sku)) missing.push(sku);
          used.add(sku);
          continue;
        }
        const up = Number(p.unit_price);
        matched.push({
          sku,
          description: p.description,
          quantity: item.quantity,
          unit_price: up,
          margin_pct: defaultMargin,
          discount_pct: 0,
          unit: p.unit ?? "pcs",
          line_total: computeLineTotal(item.quantity, up, defaultMargin, 0),
        });
      }
      if (matched[0]?.sku && priceRows?.[0]?.currency) {
        setCurrency(priceRows[0].currency);
      }
      setLines(matched);
      setUnmatched(missing);
      toast.success(
        `Extracted ${result.items.length} line${result.items.length === 1 ? "" : "s"}` +
          (missing.length ? ` · ${missing.length} unmatched SKU` : ""),
      );

      // Auto-fetch eBay top best-seller for every extracted item.
      const queries = result.items.map((it) => {
        const matchedRow = map.get(it.sku.toUpperCase());
        return matchedRow?.description || it.raw_name || it.sku;
      });
      const uniqueQueries = [...new Set(queries.filter(Boolean))];
      if (uniqueQueries.length > 0) {
        setEbayLoading(true);
        setEbayResults({});
        ebaySearch({ data: { queries: uniqueQueries } })
          .then((rows: EbayBestSeller[]) => {
            const map: Record<string, EbayBestSeller> = {};
            for (const r of rows) map[r.query] = r;
            setEbayResults(map);
            const found = rows.filter((r: EbayBestSeller) => r.found).length;
            if (found > 0) toast.success(`Found ${found} eBay match${found === 1 ? "" : "es"}`);
          })
          .catch((e: unknown) => {
            toast.error(friendlyError(e, "eBay lookup failed"));
          })
          .finally(() => setEbayLoading(false));
      }
    } catch (e) {
      toast.error(friendlyError(e, "Extraction failed"));
    } finally {
      setExtracting(false);
    }
  };

  const generateQuotationNumber = () => {
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `Q-${ymd}-${rand}`;
  };

  const saveAndDownload = async () => {
    if (lines.length === 0) {
      toast.error("Add at least one line item");
      return;
    }
    setSaving(true);
    try {
      const quotation_number = generateQuotationNumber();
      const quotationData = {
        quotation_number,
        date: new Date().toISOString().slice(0, 10),
        customer_name: customerName,
        customer_email: customerEmail,
        currency,
        lines,
        subtotal: +subtotal.toFixed(2),
        tax_rate: taxRate,
        tax_amount: +taxAmount.toFixed(2),
        total: +total.toFixed(2),
        notes,
        unmatched_skus: unmatched,
      };
      const buf = buildQuotationWorkbook(quotationData);
      const csv = buildZohoEstimateCSV(quotationData);

      const xlsxBlob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const csvBlob = new Blob([csv], { type: "text/csv;charset=utf-8" });

      const path = `${new Date().getFullYear()}/${quotation_number}.xlsx`;
      const { error: upErr } = await supabase.storage
        .from("quotations")
        .upload(path, xlsxBlob, {
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          upsert: true,
        });
      if (upErr) throw upErr;

      const csvPath = `${new Date().getFullYear()}/${quotation_number}.csv`;
      await supabase.storage.from("quotations").upload(csvPath, csvBlob, {
        contentType: "text/csv;charset=utf-8",
        upsert: true,
      });

      const { error: insErr } = await supabase.from("orders").insert({
        quotation_number,
        customer_name: customerName || null,
        customer_email: customerEmail || null,
        email_subject: subject || null,
        email_body: body || null,
        attachment_names: attachments.map((a) => a.name),
        extracted_items: lines.map((l) => ({ sku: l.sku, quantity: l.quantity })),
        matched_items: lines,
        unmatched_skus: unmatched,
        subtotal: +subtotal.toFixed(2),
        tax_rate: taxRate,
        tax_amount: +taxAmount.toFixed(2),
        total: +total.toFixed(2),
        currency,
        notes: notes || null,
        status: "draft",
        quotation_file_path: path,
      });
      if (insErr) throw insErr;

      const triggerDownload = (blob: Blob, filename: string) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      };
      triggerDownload(xlsxBlob, `${quotation_number}.xlsx`);
      triggerDownload(csvBlob, `${quotation_number}-zoho.csv`);

      toast.success(`Quotation ${quotation_number} saved`);
      // Reset for next order
      setSubject("");
      setBody("");
      setCustomerName("");
      setCustomerEmail("");
      setLines([]);
      setUnmatched([]);
      setNotes("");
      setAttachments([]);
    } catch (e) {
      toast.error(friendlyError(e, "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New Order</h1>
          <p className="text-sm text-muted-foreground">
            Paste the customer's order email below. AI will extract SKUs and
            quantities, match them against your price list, and build a
            ready-to-send Excel quotation.
          </p>
        </div>

        <Card className="p-5">
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="subj">Email subject</Label>
                <Input
                  id="subj"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Order for delivery next week"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cust-email">Customer email (optional)</Label>
                <Input
                  id="cust-email"
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="client@example.com"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="body">Email body</Label>
              <Textarea
                id="body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Paste the full email content here..."
                rows={8}
                className="font-mono text-sm"
              />
            </div>

            <div>
              <Label className="mb-1.5 block">Attachments (PDF, Excel, images — optional)</Label>
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragActive(true);
                }}
                onDragLeave={() => setIsDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragActive(false);
                  onDrop(Array.from(e.dataTransfer.files));
                }}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed p-3 transition-colors ${
                  isDragActive ? "border-primary bg-accent" : "border-border"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    onDrop(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                />
                <Upload className="h-5 w-5 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Drop files or click — up to 5 files, 8MB each
                </p>
              </div>
              {attachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {attachments.map((a, i) => (
                    <Badge key={i} variant="secondary" className="pr-1">
                      {a.name}
                      <button
                        onClick={() =>
                          setAttachments((arr) => arr.filter((_, ii) => ii !== i))
                        }
                        className="ml-1 rounded-full p-0.5 hover:bg-muted-foreground/20"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <Button
              onClick={runExtract}
              disabled={extracting || !body.trim()}
              className="w-full sm:w-auto"
            >
              {extracting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              {extracting ? "Extracting..." : "Extract & match items"}
            </Button>
          </div>
        </Card>

        {(lines.length > 0 || unmatched.length > 0) && (
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Quotation</h2>
                <p className="text-sm text-muted-foreground">
                  Review and edit before generating the Excel file.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label className="text-xs">Customer name</Label>
                  <Input
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Client Co."
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Default Margin %</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={defaultMargin}
                    onChange={(e) => {
                      const m = Number(e.target.value);
                      setDefaultMargin(m);
                      setLines((ls) =>
                        ls.map((l) => ({
                          ...l,
                          margin_pct: m,
                          line_total: computeLineTotal(l.quantity, l.unit_price, m, l.discount_pct),
                        })),
                      );
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tax %</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={taxRate}
                    onChange={(e) => setTaxRate(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Currency</Label>
                  <Input
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  />
                </div>
              </div>
            </div>

            {unmatched.length > 0 && (
              <div className="mb-4 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
                <p className="font-medium text-warning-foreground">
                  {unmatched.length} SKU{unmatched.length === 1 ? "" : "s"} not in price list
                </p>
                <p className="mt-1 font-mono text-xs">{unmatched.join(", ")}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  These are noted at the bottom of the quotation. Add them to the
                  Price List and re-extract to include them.
                </p>
              </div>
            )}

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-20">Qty</TableHead>
                    <TableHead className="w-24 text-right">Cost</TableHead>
                    <TableHead className="w-20 text-right">Margin %</TableHead>
                    <TableHead className="w-24 text-right">Sell</TableHead>
                    <TableHead className="w-20 text-right">Disc %</TableHead>
                    <TableHead className="w-24 text-right">Total</TableHead>
                    <TableHead className="w-56">
                      eBay best seller
                      {ebayLoading && (
                        <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />
                      )}
                    </TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-sm">{l.sku}</TableCell>
                      <TableCell>{l.description}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="1"
                          value={l.quantity}
                          onChange={(e) => updateQty(i, Number(e.target.value))}
                          className="h-8 w-16"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          value={l.unit_price}
                          onChange={(e) => updatePrice(i, Number(e.target.value))}
                          className="h-8 w-20 text-right"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.1"
                          value={l.margin_pct}
                          onChange={(e) => updateMargin(i, Number(e.target.value))}
                          className="h-8 w-16 text-right"
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {sellingPrice(l.unit_price, l.margin_pct).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.1"
                          value={l.discount_pct}
                          onChange={(e) => updateDiscount(i, Number(e.target.value))}
                          className="h-8 w-16 text-right"
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {l.line_total.toFixed(2)}
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const eb = ebayResults[l.description];
                          if (ebayLoading && !eb) {
                            return (
                              <span className="text-xs text-muted-foreground">
                                <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                                searching…
                              </span>
                            );
                          }
                          if (!eb) {
                            return <span className="text-xs text-muted-foreground">—</span>;
                          }
                          if (!eb.found || !eb.url) {
                            return (
                              <span className="text-xs text-muted-foreground">No match</span>
                            );
                          }
                          return (
                            <a
                              href={eb.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="group flex items-start gap-2"
                              title={eb.title ?? ""}
                            >
                              {eb.image && (
                                <img
                                  src={eb.image}
                                  alt=""
                                  className="h-10 w-10 shrink-0 rounded border border-border object-cover"
                                  loading="lazy"
                                />
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="line-clamp-2 text-xs font-medium leading-tight group-hover:underline">
                                  {eb.title}
                                </p>
                                {eb.price !== null && (
                                  <p className="text-xs tabular-nums text-muted-foreground">
                                    {eb.currency ?? "USD"} {eb.price.toFixed(2)}
                                    <ExternalLink className="ml-1 inline h-3 w-3" />
                                  </p>
                                )}
                              </div>
                            </a>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeLine(i)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="mt-4 space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Delivery terms, validity period, etc."
              />
            </div>

            <div className="mt-5 flex flex-col items-end gap-1 border-t border-border pt-4 text-sm tabular-nums">
              <div className="flex w-64 justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{currency} {subtotal.toFixed(2)}</span>
              </div>
              <div className="flex w-64 justify-between">
                <span className="text-muted-foreground">Tax ({taxRate}%)</span>
                <span>{currency} {taxAmount.toFixed(2)}</span>
              </div>
              <div className="flex w-64 justify-between text-base font-semibold">
                <span>Total</span>
                <span>{currency} {total.toFixed(2)}</span>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button onClick={saveAndDownload} disabled={saving} size="lg">
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    <Download className="mr-2 h-4 w-4" />
                  </>
                )}
                {saving ? "Saving..." : "Save & download (Excel + Zoho CSV)"}
              </Button>
            </div>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
