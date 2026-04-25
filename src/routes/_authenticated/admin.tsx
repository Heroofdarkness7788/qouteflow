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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Loader2,
  Shield,
  ShieldOff,
  ShieldAlert,
  UserMinus,
  Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { friendlyError } from "@/lib/auth-context";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { deleteUserAccount } from "@/utils/admin.functions";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminPage,
  head: () => ({
    meta: [{ title: "Admin · Users" }],
  }),
});

type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
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
  const deleteUserFn = useServerFn(deleteUserAccount);

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
            .select("id, email, full_name, created_at, last_sign_in_at")
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
          full_name: p.full_name,
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

  // Soft-remove access: deletes ALL roles for the user. They remain in auth
  // but every RLS policy on (authenticated) tables still applies — they just
  // lose the 'user' role label and any 'admin' role. Their auth account stays
  // so historical orders/profile keep their email.
  const revokeAllAccess = async (u: UserRow) => {
    if (u.id === user?.id) {
      toast.error("You can't revoke your own access.");
      return;
    }
    setBusyId(u.id);
    try {
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", u.id);
      if (error) throw error;
      toast.success(`Access revoked for ${u.email}`);
      await loadUsers();
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't revoke access."));
    } finally {
      setBusyId(null);
    }
  };

  const deleteAccount = async (u: UserRow) => {
    setBusyId(u.id);
    try {
      await deleteUserFn({ data: { userId: u.id } });
      toast.success(`Deleted ${u.email}`);
      await loadUsers();
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't delete account."));
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
            {users.length} user{users.length === 1 ? "" : "s"} signed up. Manage
            roles, revoke access, or permanently delete an account.
          </p>
        </div>
      </div>
      {/* Desktop table */}
      <div className="hidden rounded-lg border border-border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Signed up</TableHead>
              <TableHead>Last sign-in</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => {
              const self = u.id === user?.id;
              const busy = busyId === u.id;
              return (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="font-medium">
                      {u.full_name?.trim() || "—"}
                      {self && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (you)
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {u.email}
                    </div>
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
                  <TableCell>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {u.is_admin ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={self || busy}
                          onClick={() => revokeAdmin(u.id)}
                        >
                          {busy ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <ShieldOff className="h-4 w-4" />
                          )}
                          <span className="ml-2">Revoke admin</span>
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() => grantAdmin(u.id)}
                        >
                          {busy ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Shield className="h-4 w-4" />
                          )}
                          <span className="ml-2">Make admin</span>
                        </Button>
                      )}

                      <Button
                        variant="outline"
                        size="sm"
                        disabled={self || busy}
                        onClick={() => revokeAllAccess(u)}
                        title="Removes all roles. User stays in the system but can't use the app."
                      >
                        <UserMinus className="h-4 w-4" />
                        <span className="ml-2">Revoke access</span>
                      </Button>

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={self || busy}
                          >
                            <Trash2 className="h-4 w-4" />
                            <span className="ml-2">Delete</span>
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              Delete {u.email}?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              This permanently removes the user's account and
                              login. Quotations they created will remain. This
                              action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteAccount(u)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Delete account
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
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

      {/* Mobile card list */}
      <div className="space-y-3 md:hidden">
        {users.length === 0 && (
          <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            No users yet.
          </div>
        )}
        {users.map((u) => {
          const self = u.id === user?.id;
          const busy = busyId === u.id;
          return (
            <div
              key={u.id}
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">
                      {u.full_name?.trim() || "—"}
                    </p>
                    {self && (
                      <span className="text-xs text-muted-foreground">
                        (you)
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {u.email}
                  </p>
                </div>
                {u.is_admin ? (
                  <Badge>Admin</Badge>
                ) : (
                  <Badge variant="secondary">User</Badge>
                )}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
                <span>Joined {fmt(u.created_at)}</span>
                <span className="text-right">
                  Last in {fmt(u.last_sign_in_at)}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {u.is_admin ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={self || busy}
                    onClick={() => revokeAdmin(u.id)}
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ShieldOff className="h-4 w-4" />
                    )}
                    <span className="ml-1.5">Revoke admin</span>
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => grantAdmin(u.id)}
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Shield className="h-4 w-4" />
                    )}
                    <span className="ml-1.5">Make admin</span>
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={self || busy}
                  onClick={() => revokeAllAccess(u)}
                >
                  <UserMinus className="h-4 w-4" />
                  <span className="ml-1.5">Revoke</span>
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={self || busy}
                      className="col-span-2"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="ml-1.5">Delete account</span>
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {u.email}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This permanently removes the user's account and login.
                        Quotations they created will remain. This action cannot
                        be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteAccount(u)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete account
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
