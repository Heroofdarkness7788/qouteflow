import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, FileText, Send } from "lucide-react";
import { toast } from "sonner";
import { friendlyError } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated/orders")({
  component: OrdersPage,
  head: () => ({ meta: [{ title: "Orders — QuoteFlow" }] }),
});

type Order = {
  id: string;
  quotation_number: string;
  customer_name: string | null;
  customer_email: string | null;
  email_subject: string | null;
  total: number;
  currency: string;
  status: string;
  quotation_file_path: string | null;
  unmatched_skus: string[] | null;
  created_at: string;
};

function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    supabase
      .from("orders")
      .select(
        "id,quotation_number,customer_name,customer_email,email_subject,total,currency,status,quotation_file_path,unmatched_skus,created_at",
      )
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) toast.error(friendlyError(error, "Failed to load orders"));
        else setOrders((data ?? []) as Order[]);
      });
  }, []);

  const markAsSent = async (o: Order) => {
    const { error } = await supabase
      .from("orders")
      .update({ status: "sent" })
      .eq("id", o.id);
    if (error) {
      toast.error(friendlyError(error, "Failed to update status"));
      return;
    }
    setOrders((prev) =>
      prev.map((x) => (x.id === o.id ? { ...x, status: "sent" } : x)),
    );
    toast.success(`${o.quotation_number} marked as sent`);
  };

  const download = async (o: Order) => {
    if (!o.quotation_file_path) return;
    const { data, error } = await supabase.storage
      .from("quotations")
      .createSignedUrl(o.quotation_file_path, 60);
    if (error || !data) {
      toast.error(friendlyError(error, "Download failed"));
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Orders</h1>
          <p className="text-sm text-muted-foreground">
            All quotations generated so far. Download the Excel file and attach it
            to your Gmail reply.
          </p>
        </div>

        {orders.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-12 text-center">
            <FileText className="h-10 w-10 text-muted-foreground" />
            <div>
              <p className="font-medium">No quotations yet</p>
              <p className="text-sm text-muted-foreground">
                Process your first order to see it here.
              </p>
            </div>
            <Button asChild>
              <Link to="/">New Order</Link>
            </Button>
          </Card>
        ) : (
          <div className="space-y-3">
            {orders.map((o) => (
              <Card key={o.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-sm font-medium">
                        {o.quotation_number}
                      </p>
                      <Badge variant="secondary">{o.status}</Badge>
                      {o.unmatched_skus && o.unmatched_skus.length > 0 && (
                        <Badge variant="destructive">
                          {o.unmatched_skus.length} unmatched
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 truncate text-sm">
                      <span className="font-medium">
                        {o.customer_name ?? "Unknown customer"}
                      </span>
                      {o.customer_email && (
                        <span className="text-muted-foreground">
                          {" "}
                          · {o.customer_email}
                        </span>
                      )}
                    </p>
                    {o.email_subject && (
                      <p className="truncate text-xs text-muted-foreground">
                        {o.email_subject}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(o.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <p className="text-lg font-semibold tabular-nums">
                      {o.currency} {o.total.toFixed(2)}
                    </p>
                    <div className="flex gap-2">
                      {o.quotation_file_path && (
                        <Button size="sm" variant="outline" onClick={() => download(o)}>
                          <Download className="mr-2 h-4 w-4" />
                          Excel
                        </Button>
                      )}
                      {o.status === "draft" && (
                        <Button size="sm" onClick={() => markAsSent(o)}>
                          <Send className="mr-2 h-4 w-4" />
                          Mark as Sent
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
