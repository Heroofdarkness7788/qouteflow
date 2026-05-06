import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { parsePriceListFile } from "@/lib/quotation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Upload, Trash2, Plus } from "lucide-react";
import { friendlyError } from "@/lib/auth-context";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";


export const Route = createFileRoute("/_authenticated/price-list")({
  component: PriceListPage,
  head: () => ({ meta: [{ title: "Price List — QuoteFlow" }] }),
});

type Row = {
  id: string;
  sku: string;
  description: string;
  unit_price: number;
  unit: string | null;
  currency: string;
};

function PriceListPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("price_list")
      .select("*")
      .order("sku");
    if (error) toast.error(friendlyError(error, "Failed to load price list"));
    else setRows(data as Row[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  const onDrop = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;
      setLoading(true);
      try {
        const buf = await file.arrayBuffer();
        const items = parsePriceListFile(buf);
        if (!items.length) {
          toast.error("No rows detected. Make sure the sheet has SKU and Price columns.");
          return;
        }
        const payload = items.map((i) => ({
          sku: i.sku.toUpperCase(),
          description: i.description,
          unit_price: i.unit_price,
          unit: i.unit ?? "pcs",
          currency: i.currency ?? "USD",
        }));
        const { error } = await supabase
          .from("price_list")
          .upsert(payload, { onConflict: "sku" });
        if (error) throw error;
        toast.success(`Imported ${items.length} items`);
        load();
      } catch (e) {
        toast.error(friendlyError(e, "Import failed"));
      } finally {
        setLoading(false);
      }
    },
    [load],
  );

  const remove = async (id: string) => {
    const { error } = await supabase.from("price_list").delete().eq("id", id);
    if (error) toast.error(friendlyError(error, "Delete failed"));
    else {
      setRows((r) => r.filter((x) => x.id !== id));
      toast.success("Deleted");
    }
  };

  const addManual = async () => {
    const sku = prompt("SKU?");
    if (!sku) return;
    const desc = prompt("Description?") ?? sku;
    const price = Number(prompt("Unit price?") ?? "0");
    const { error } = await supabase
      .from("price_list")
      .upsert({ sku: sku.toUpperCase(), description: desc, unit_price: price });
    if (error) toast.error(friendlyError(error, "Could not add"));
    else load();
  };

  const filtered = rows.filter(
    (r) =>
      r.sku.toLowerCase().includes(search.toLowerCase()) ||
      r.description.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <AppShell>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Price list</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            SKU codes are matched against items extracted from order emails.
          </p>
        </div>

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
          className={`cursor-pointer rounded-lg border border-dashed p-10 text-center transition-all hover-lift ${
            isDragActive ? "border-foreground bg-muted" : "border-border hover:border-foreground/40"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              onDrop(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <Upload className="mx-auto mb-3 h-5 w-5 text-muted-foreground" />
          <p className="text-sm">
            {loading
              ? "Importing…"
              : isDragActive
                ? "Drop to import"
                : "Drop a file, or click to upload"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Excel or CSV with SKU and Price columns.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Input
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="sm:max-w-xs border-0 border-b rounded-none px-0 shadow-none focus-visible:ring-0 focus-visible:border-foreground"
          />
          <Button variant="ghost" size="sm" onClick={addManual} className="w-full sm:w-auto">
            <Plus className="mr-1 h-4 w-4" />
            Add item
          </Button>
        </div>

        {/* Desktop table */}
        <div className="hidden sm:block animate-fade-in">
          <Table>
            <TableHeader>
              <TableRow className="border-b">
                <TableHead>SKU</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Curr.</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                    {rows.length === 0 ? "No items yet." : "No matches."}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id} className="row-hover group border-b border-border/60">
                    <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                    <TableCell>{r.description}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.unit_price.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.unit ?? "pcs"}</TableCell>
                    <TableCell className="text-muted-foreground">{r.currency}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => remove(r.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Mobile list */}
        <div className="space-y-0 sm:hidden">
          {filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {rows.length === 0 ? "No items yet." : "No matches."}
            </p>
          ) : (
            filtered.map((r) => (
              <div
                key={r.id}
                className="flex items-start justify-between gap-3 border-b border-border/60 py-3 row-hover px-1"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs">{r.sku}</p>
                  <p className="truncate text-sm">{r.description}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                    {r.currency} {r.unit_price.toFixed(2)} / {r.unit ?? "pcs"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(r.id)}
                  className="shrink-0 h-8 w-8"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>

        {rows.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {rows.length} item{rows.length === 1 ? "" : "s"}
          </p>
        )}
      </div>
    </AppShell>
  );
}
