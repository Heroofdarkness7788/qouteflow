import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Shield, ShieldOff, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { friendlyError } from "@/lib/auth-context";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminPage,
  head: () => ({
    meta: [{ title: "Admin · Users" }],
  }),
});

type UserRow = {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  is_admin: boolean;
};

function AdminPage() {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const checkAdmin = async () => {
    if (!user) return false;
    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (error) {
      console.error(error);
      return false;
    }
    return !!data;
  };

  const loadUsers = async () => {
    setLoading(true);
    try {
      const [{ data: profiles, error: pErr }, { data: roles, error: rErr }] =
        await Promise.all([
          supabase
            .from("profiles")
            .select("id, email, created_at, last_sign_in_at")
            .order("created_at", { ascending: false }),
          supabase.from("user_roles").select("user_id, role").eq("role", "admin"),
        ]);
      if (pErr) throw pErr;
      if (rErr) throw rErr;
      const adminSet = new Set((roles ?? []).map((r) => r.user_id));
      setUsers(
        (profiles ?? []).map((p) => ({
          id: p.id,
          email: p.email,
          created_at: p.created_at,
          last_sign_in_at: p.last_sign_in_at,
          is_admin: adminSet.has(p.id),
        })),
      );
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't load users."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      const ok = await checkAdmin();
      if (!mounted) return;
      setIsAdmin(ok);
      if (ok) await loadUsers();
      else setLoading(false);
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const grantAdmin = async (userId: string) => {
    setBusyId(userId);
    try {
      const { error } = await supabase
        .from("user_roles")
        .insert({ user_id: userId, role: "admin" });
      if (error) throw error;
      toast.success("Admin role granted");
      await loadUsers();
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't grant admin role."));
    } finally {
      setBusyId(null);
    }
  };

  const revokeAdmin = async (userId: string) => {
    if (userId === user?.id) {
      toast.error("You can't revoke your own admin role.");
      return;
    }
    setBusyId(userId);
    try {
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", userId)
        .eq("role", "admin");
      if (error) throw error;
      toast.success("Admin role revoked");
      await loadUsers();
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't revoke admin role."));
    } finally {
      setBusyId(null);
    }
  };

  if (loading || isAdmin === null) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  if (!isAdmin) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md rounded-lg border border-border bg-card p-8 text-center">
          <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Admins only</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            You don't have permission to view this page.
          </p>
        </div>
      </AppShell>
    );
  }

  const fmt = (d: string | null) =>
    d ? new Date(d).toLocaleString() : "—";

  return (
    <AppShell>
      <div className="mb-6 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground">
            {users.length} user{users.length === 1 ? "" : "s"} signed up. Promote
            teammates to admin to give them user-management rights.
          </p>
        </div>
      </div>
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Signed up</TableHead>
              <TableHead>Last sign-in</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => {
              const self = u.id === user?.id;
              return (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">
                    {u.email}
                    {self && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        (you)
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {u.is_admin ? (
                      <Badge>Admin</Badge>
                    ) : (
                      <Badge variant="secondary">User</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {fmt(u.created_at)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {fmt(u.last_sign_in_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    {u.is_admin ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={self || busyId === u.id}
                        onClick={() => revokeAdmin(u.id)}
                      >
                        {busyId === u.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ShieldOff className="h-4 w-4" />
                        )}
                        <span className="ml-2">Revoke admin</span>
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        disabled={busyId === u.id}
                        onClick={() => grantAdmin(u.id)}
                      >
                        {busyId === u.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Shield className="h-4 w-4" />
                        )}
                        <span className="ml-2">Make admin</span>
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {users.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No users yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </AppShell>
  );
}
