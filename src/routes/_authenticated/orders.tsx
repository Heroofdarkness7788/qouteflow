import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download, Eye, FileText, Printer, Send, ThumbsDown, ThumbsUp } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { friendlyError, useAuth } from "@/lib/auth-context";
import type { QuotationLine } from "@/lib/quotation";
import { generateQuotationPDF } from "@/lib/quotation-pdf";

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
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  currency: string;
  status: string;
  notes: string | null;
  matched_items: QuotationLine[] | null;
  quotation_file_path: string | null;
  unmatched_skus: string[] | null;
  created_at: string;
  sent_at: string | null;
  created_by_name: string | null;
  sent_by_name: string | null;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
  review_remarks: string | null;
};

function OrdersPage() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [reviewing, setReviewing] = useState<Order | null>(null);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [remarksError, setRemarksError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("orders")
      .select(
        "id,quotation_number,customer_name,customer_email,email_subject,total,subtotal,tax_rate,tax_amount,currency,status,notes,matched_items,quotation_file_path,unmatched_skus,created_at,sent_at,created_by_name,sent_by_name,reviewed_at,reviewed_by_name,review_remarks",
      )
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) toast.error(friendlyError(error, "Failed to load orders"));
        else setOrders((data ?? []) as unknown as Order[]);
      });
  }, []);

  const getMyName = async (): Promise<string | null> => {
    if (!user?.id) return null;
    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", user.id)
      .maybeSingle();
    return prof?.full_name?.trim() || prof?.email || null;
  };

  const markAsSent = async (o: Order) => {
    const sentAt = new Date().toISOString();
    const sentByName = await getMyName();
    const { error } = await supabase
      .from("orders")
      .update({
        status: "sent",
        sent_at: sentAt,
        sent_by: user?.id ?? null,
        sent_by_name: sentByName,
      })
      .eq("id", o.id);
    if (error) {
      toast.error(friendlyError(error, "Failed to update status"));
      return;
    }
    setOrders((prev) =>
      prev.map((x) =>
        x.id === o.id
          ? { ...x, status: "sent", sent_at: sentAt, sent_by_name: sentByName }
          : x,
      ),
    );
    toast.success(`${o.quotation_number} marked as sent`);
  };

  const submitReview = async (decision: "approve" | "reject") => {
    if (!reviewing) return;
    const trimmedRemarks = remarks.trim();
    if (decision === "reject" && !trimmedRemarks) {
      setRemarksError("Remarks are required when rejecting an order.");
      return;
    }
    setRemarksError(null);
    const isApprove = decision === "approve";
    isApprove ? setApproving(true) : setRejecting(true);
    try {
      const reviewedAt = new Date().toISOString();
      const reviewedByName = await getMyName();
      const remarksValue = trimmedRemarks || null;
      const baseUpdate = {
        reviewed_at: reviewedAt,
        reviewed_by: user?.id ?? null,
        reviewed_by_name: reviewedByName,
        review_remarks: remarksValue,
      };
      const { error } = await supabase
        .from("orders")
        .update(isApprove ? baseUpdate : { ...baseUpdate, status: "rejected" })
        .eq("id", reviewing.id);
      if (error) throw error;
      const { error: auditError } = await supabase.from("order_audit_logs").insert({
        order_id: reviewing.id,
        action: isApprove ? "approved" : "rejected",
        actor_id: user?.id ?? null,
        actor_name: reviewedByName,
        remarks: remarksValue,
      });
      if (auditError) console.error("Failed to write audit log", auditError);
      setOrders((prev) =>
        prev.map((x) =>
          x.id === reviewing.id
            ? {
                ...x,
                ...(isApprove ? {} : { status: "rejected" }),
                reviewed_at: reviewedAt,
                reviewed_by_name: reviewedByName,
                review_remarks: remarksValue,
              }
            : x,
        ),
      );
      toast.success(
        `${reviewing.quotation_number} ${isApprove ? "approved" : "rejected"}`,
      );
      setReviewing(null);
      setRemarks("");
    } catch (e) {
      toast.error(friendlyError(e, isApprove ? "Failed to approve" : "Failed to reject"));
    } finally {
      isApprove ? setApproving(false) : setRejecting(false);
    }
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

  const buildPDF = (o: Order) =>
    generateQuotationPDF({
      quotation_number: o.quotation_number,
      date: new Date(o.created_at).toLocaleDateString(),
      customer_name: o.customer_name,
      customer_email: o.customer_email,
      currency: o.currency,
      lines: o.matched_items ?? [],
      subtotal: o.subtotal,
      tax_rate: o.tax_rate,
      tax_amount: o.tax_amount,
      total: o.total,
      notes: o.notes,
      created_by_name: o.created_by_name,
      sent_by_name: o.sent_by_name,
      sent_at: o.sent_at,
      reviewed_by_name: o.reviewed_by_name,
      reviewed_at: o.reviewed_at,
    });

  const viewPDF = (o: Order) => {
    const doc = buildPDF(o);
    window.open(doc.output("bloburl"), "_blank");
  };

  const downloadPDF = (o: Order) => {
    buildPDF(o).save(`${o.quotation_number}.pdf`);
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Orders</h1>
          <p className="text-sm text-muted-foreground">
            All quotations generated so far. Review, download the Excel and Zoho CSV, then mark as sent.
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
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-sm font-medium">
                        {o.quotation_number}
                      </p>
                      <Badge variant="secondary">{o.status}</Badge>
                      {o.reviewed_at && (
                        <Badge className="bg-emerald-600 hover:bg-emerald-600">
                          Reviewed & Approved
                        </Badge>
                      )}
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
                      Created {new Date(o.created_at).toLocaleString()}
                      {o.created_by_name && (
                        <span> · by {o.created_by_name}</span>
                      )}
                    </p>
                    {o.reviewed_at && (
                      <p className="text-xs text-muted-foreground">
                        Reviewed & approved {new Date(o.reviewed_at).toLocaleString()}
                        {o.reviewed_by_name && (
                          <span> · by {o.reviewed_by_name}</span>
                        )}
                      </p>
                    )}
                    {o.sent_at && (
                      <p className="text-xs text-muted-foreground">
                        Sent {new Date(o.sent_at).toLocaleString()}
                        {o.sent_by_name && (
                          <span> · by {o.sent_by_name}</span>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="flex w-full flex-row items-center justify-between gap-2 sm:w-auto sm:flex-col sm:items-end">
                    <p className="text-lg font-semibold tabular-nums">
                      {o.currency} {o.total.toFixed(2)}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setReviewing(o)}>
                        <Eye className="mr-2 h-4 w-4" />
                        Review
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => viewPDF(o)}>
                        <Printer className="mr-2 h-4 w-4" />
                        View/Print
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => downloadPDF(o)}>
                        <FileText className="mr-2 h-4 w-4" />
                        PDF
                      </Button>
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

      <Dialog
        open={!!reviewing}
        onOpenChange={(open) => {
          if (!open) {
            setReviewing(null);
            setRemarks("");
          } else if (reviewing) {
            setRemarks(reviewing.review_remarks ?? "");
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          {reviewing && (
            <>
              <DialogHeader>
                <DialogTitle className="font-mono">{reviewing.quotation_number}</DialogTitle>
                <DialogDescription>
                  {reviewing.customer_name ?? "Unknown customer"}
                  {reviewing.customer_email && ` · ${reviewing.customer_email}`}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {reviewing.reviewed_at && (
                  <div className="rounded-md border border-emerald-600/50 bg-emerald-600/10 p-3 text-sm">
                    <p>
                      Already reviewed & approved by{" "}
                      <span className="font-medium">{reviewing.reviewed_by_name ?? "—"}</span>{" "}
                      on {new Date(reviewing.reviewed_at).toLocaleString()}
                    </p>
                    {reviewing.review_remarks && (
                      <p className="mt-2">
                        <span className="font-medium">Remarks:</span>{" "}
                        {reviewing.review_remarks}
                      </p>
                    )}
                  </div>
                )}

                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SKU</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Sell</TableHead>
                        <TableHead className="text-right">Disc %</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(reviewing.matched_items ?? []).map((l, i) => {
                        const sell = +(l.unit_price * (1 + (l.margin_pct || 0) / 100)).toFixed(2);
                        return (
                          <TableRow key={i}>
                            <TableCell className="font-mono text-xs">{l.sku}</TableCell>
                            <TableCell className="text-sm">{l.description}</TableCell>
                            <TableCell className="text-right tabular-nums">{l.quantity}</TableCell>
                            <TableCell className="text-right tabular-nums">{sell.toFixed(2)}</TableCell>
                            <TableCell className="text-right tabular-nums">{l.discount_pct}</TableCell>
                            <TableCell className="text-right tabular-nums font-medium">
                              {l.line_total.toFixed(2)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex flex-col items-end gap-1 border-t border-border pt-3 text-sm tabular-nums">
                  <div className="flex w-64 justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{reviewing.currency} {reviewing.subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex w-64 justify-between">
                    <span className="text-muted-foreground">Tax ({reviewing.tax_rate}%)</span>
                    <span>{reviewing.currency} {reviewing.tax_amount.toFixed(2)}</span>
                  </div>
                  <div className="flex w-64 justify-between text-base font-semibold">
                    <span>Total</span>
                    <span>{reviewing.currency} {reviewing.total.toFixed(2)}</span>
                  </div>
                </div>

                {!reviewing.reviewed_at && (
                  <div className="space-y-1.5">
                    <Label htmlFor="review-remarks">
                      Remarks <span className="text-muted-foreground">(required to reject)</span>
                    </Label>
                    <Textarea
                      id="review-remarks"
                      placeholder="Add comments to record alongside the decision"
                      value={remarks}
                      onChange={(e) => {
                        setRemarks(e.target.value);
                        if (remarksError && e.target.value.trim()) setRemarksError(null);
                      }}
                      rows={3}
                      aria-invalid={!!remarksError}
                    />
                    {remarksError && (
                      <p className="text-xs font-medium text-destructive">{remarksError}</p>
                    )}
                  </div>
                )}

                {reviewing.notes && (
                  <div className="rounded-md border border-border p-3 text-sm">
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Notes</p>
                    {reviewing.notes}
                  </div>
                )}

                <div className="text-xs text-muted-foreground">
                  Created by {reviewing.created_by_name ?? "—"} on{" "}
                  {new Date(reviewing.created_at).toLocaleString()}
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => viewPDF(reviewing)}>
                  <Printer className="mr-2 h-4 w-4" />
                  View/Print
                </Button>
                <Button variant="outline" onClick={() => setReviewing(null)}>
                  Close
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => submitReview("reject")}
                  disabled={rejecting || approving || !!reviewing.reviewed_at}
                >
                  <ThumbsDown className="mr-2 h-4 w-4" />
                  {rejecting ? "Rejecting..." : "Reject"}
                </Button>
                <Button
                  onClick={() => submitReview("approve")}
                  disabled={approving || rejecting || !!reviewing.reviewed_at}
                >
                  <ThumbsUp className="mr-2 h-4 w-4" />
                  {reviewing.reviewed_at ? "Already approved" : approving ? "Approving..." : "Approve"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
