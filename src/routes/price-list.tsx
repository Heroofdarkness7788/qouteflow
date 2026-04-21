import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { parsePriceListFile } from "@/lib/quotation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Upload, Trash2, Plus } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/price-list")({
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
    if (error) toast.error(error.message);
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
        toast.error(e instanceof Error ? e.message : "Import failed");
      } finally {
        setLoading(false);
      }
    },
    [load],
  );

  const remove = async (id: string) => {
    const { error } = await supabase.from("price_list").delete().eq("id", id);
    if (error) toast.error(error.message);
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
    if (error) toast.error(error.message);
    else load();
  };

  const filtered = rows.filter(
    (r) =>
      r.sku.toLowerCase().includes(search.toLowerCase()) ||
      r.description.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Price List</h1>
          <p className="text-sm text-muted-foreground">
            Upload your Excel/CSV price list. We use SKU codes to match items
            extracted from order emails.
          </p>
        </div>

        <Card
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
          className={`cursor-pointer border-2 border-dashed p-8 text-center transition-colors ${
            isDragActive ? "border-primary bg-accent" : "border-border"
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
          <Upload className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">
            {loading
              ? "Importing..."
              : isDragActive
                ? "Drop the file here"
                : "Drop Excel / CSV here, or click to upload"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Required columns: <strong>SKU</strong> and <strong>Price</strong>. Optional:
            Description, Unit, Currency. Existing SKUs get updated.
          </p>
        </Card>

        <div className="flex items-center justify-between gap-3">
          <Input
            placeholder="Search SKU or description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          <Button variant="outline" size="sm" onClick={addManual}>
            <Plus className="mr-2 h-4 w-4" />
            Add manually
          </Button>
        </div>

        <Card>
          <Table>
            <TableHeader>
              <TableRow>
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
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    {rows.length === 0 ? "No items yet — upload a file above." : "No matches."}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-sm">{r.sku}</TableCell>
                    <TableCell>{r.description}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.unit_price.toFixed(2)}
                    </TableCell>
                    <TableCell>{r.unit ?? "pcs"}</TableCell>
                    <TableCell>{r.currency}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => remove(r.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>

        {rows.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {rows.length} item{rows.length === 1 ? "" : "s"} in price list
          </p>
        )}
      </div>
    </AppShell>
  );
}
