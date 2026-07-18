import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Mail, RefreshCw, Link2Off, Inbox } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  startGmailConnect,
  saveGmailConnection,
  getGmailStatus,
  disconnectGmail,
  listRecentGmail,
  fetchGmailMessage,
  type GmailListItem,
  type GmailMessage,
} from "@/utils/gmail.functions";
import { connectAppUser } from "@/integrations/lovable/appUserConnectorClient";
import { friendlyError } from "@/lib/auth-context";

const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";

export function GmailImportDialog({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onImport: (msg: GmailMessage) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [messages, setMessages] = useState<GmailListItem[]>([]);
  const [importingId, setImportingId] = useState<string | null>(null);

  const status = useServerFn(getGmailStatus);
  const start = useServerFn(startGmailConnect);
  const save = useServerFn(saveGmailConnection);
  const disc = useServerFn(disconnectGmail);
  const list = useServerFn(listRecentGmail);
  const fetchMsg = useServerFn(fetchGmailMessage);

  const refresh = async (isConnected: boolean) => {
    if (!isConnected) {
      setMessages([]);
      return;
    }
    setLoading(true);
    try {
      const rows = await list({ data: { query: "is:unread newer_than:30d", max: 15 } });
      setMessages(rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load emails");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      try {
        const s = await status({});
        setConnected(s.connected);
        setEmail(s.email);
        if (s.connected) await refresh(true);
      } catch (e) {
        toast.error(friendlyError(e, "Failed to check Gmail status"));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const connect = async () => {
    const result = await connectAppUser({
      connectorId: "google_mail",
      gatewayBaseUrl: GATEWAY_BASE_URL,
      start: (targetOrigin) => start({ data: targetOrigin }),
    });
    if (!result.success) {
      if (result.error) toast.error(result.error);
      return;
    }
    if (!result.connectionAPIKey) {
      toast.error("Gmail didn't return a usable connection. Try again.");
      return;
    }
    try {
      await save({ data: { connectionAPIKey: result.connectionAPIKey } });
      toast.success("Gmail connected");
      const s = await status({});
      setConnected(s.connected);
      setEmail(s.email);
      await refresh(true);
    } catch (e) {
      toast.error(friendlyError(e, "Failed to save Gmail connection"));
    }
  };

  const disconnect = async () => {
    setLoading(true);
    try {
      await disc({});
      setConnected(false);
      setEmail(null);
      setMessages([]);
      toast.success("Gmail disconnected");
    } catch (e) {
      toast.error(friendlyError(e, "Disconnect failed"));
    } finally {
      setLoading(false);
    }
  };

  const importOne = async (m: GmailListItem) => {
    setImportingId(m.id);
    try {
      const full = await fetchMsg({ data: { messageId: m.id } });
      onImport(full);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to import email");
    } finally {
      setImportingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" /> Import from Gmail
          </DialogTitle>
        </DialogHeader>

        {connected === null || (loading && messages.length === 0) ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !connected ? (
          <div className="py-8 text-center space-y-4">
            <Inbox className="mx-auto h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Connect your Gmail</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Read-only access to your inbox so you can import order emails with one click.
              </p>
            </div>
            <Button onClick={connect}>Connect Gmail</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="truncate">Signed in as {email ?? "your Gmail"}</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => refresh(true)}
                  disabled={loading}
                  className="flex items-center gap-1 rounded px-2 py-1 hover:bg-muted"
                  title="Refresh"
                >
                  <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
                  Refresh
                </button>
                <button
                  onClick={disconnect}
                  className="flex items-center gap-1 rounded px-2 py-1 hover:bg-muted"
                  title="Disconnect"
                >
                  <Link2Off className="h-3 w-3" />
                  Disconnect
                </button>
              </div>
            </div>

            <div className="max-h-[60vh] overflow-y-auto rounded-md border">
              {messages.length === 0 ? (
                <p className="p-8 text-center text-sm text-muted-foreground">
                  No unread emails in the last 30 days.
                </p>
              ) : (
                <ul className="divide-y">
                  {messages.map((m) => (
                    <li
                      key={m.id}
                      className="group flex cursor-pointer items-start gap-3 p-3 transition-colors hover:bg-muted/50"
                      onClick={() => importingId === null && importOne(m)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="truncate text-sm font-medium">
                            {m.subject || "(no subject)"}
                          </p>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {formatDate(m.date)}
                          </span>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{m.from}</p>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {m.snippet}
                        </p>
                      </div>
                      {importingId === m.id && (
                        <Loader2 className="mt-1 h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatDate(raw: string): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
