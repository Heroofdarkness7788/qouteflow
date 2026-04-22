import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Trash2, UserPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { friendlyError, useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated/team")({
  component: TeamPage,
  head: () => ({ meta: [{ title: "Team — QuoteFlow" }] }),
});

type AllowedEmail = {
  id: string;
  email: string;
  created_at: string;
};

function TeamPage() {
  const { user } = useAuth();
  const [emails, setEmails] = useState<AllowedEmail[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [adding, setAdding] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("allowed_emails")
      .select("id,email,created_at")
      .order("created_at", { ascending: true });
    if (error) toast.error(friendlyError(error, "Failed to load team"));
    else setEmails((data ?? []) as AllowedEmail[]);
  };

  useEffect(() => {
    load();
  }, []);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    setAdding(true);
    try {
      const { error } = await supabase
        .from("allowed_emails")
        .insert({ email, added_by: user?.id ?? null });
      if (error) throw error;
      setNewEmail("");
      toast.success(`Added ${email}`);
      load();
    } catch (e) {
      toast.error(friendlyError(e, "Could not add email"));
    } finally {
      setAdding(false);
    }
  };

  const remove = async (row: AllowedEmail) => {
    if (row.email === user?.email?.toLowerCase()) {
      toast.error("You can't remove yourself.");
      return;
    }
    if (!confirm(`Remove ${row.email} from the team?`)) return;
    const { error } = await supabase
      .from("allowed_emails")
      .delete()
      .eq("id", row.id);
    if (error) toast.error(friendlyError(error, "Could not remove"));
    else {
      setEmails((es) => es.filter((e) => e.id !== row.id));
      toast.success("Removed");
    }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Team</h1>
          <p className="text-sm text-muted-foreground">
            Anyone whose email is on this list can sign up and use QuoteFlow.
            Sign-ups from other emails are rejected.
          </p>
        </div>

        <Card className="p-5">
          <form onSubmit={add} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="new-email">Add a teammate's email</Label>
              <Input
                id="new-email"
                type="email"
                required
                placeholder="teammate@company.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={adding}>
              {adding ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="mr-2 h-4 w-4" />
              )}
              Add to allow-list
            </Button>
          </form>
        </Card>

        <Card className="divide-y">
          {emails.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No teammates yet.
            </div>
          ) : (
            emails.map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between gap-3 p-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{row.email}</p>
                  <p className="text-xs text-muted-foreground">
                    Added {new Date(row.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {row.email === user?.email?.toLowerCase() && (
                    <Badge variant="secondary">You</Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => remove(row)}
                    disabled={row.email === user?.email?.toLowerCase()}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </Card>
      </div>
    </AppShell>
  );
}
