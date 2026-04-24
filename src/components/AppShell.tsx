import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Logo } from "./Logo";
import { Inbox, ListChecks, Database, LogOut, Users, Phone, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const baseNav = [
  { to: "/", label: "New Order", icon: Inbox },
  { to: "/orders", label: "Orders", icon: ListChecks },
  { to: "/price-list", label: "Price List", icon: Database },
] as const;

const adminNav = { to: "/admin", label: "Users", icon: Users } as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      return;
    }
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle()
      .then(({ data }) => setIsAdmin(!!data));
  }, [user?.id]);

  const nav = isAdmin ? [...baseNav, adminNav] : baseNav;

  const signOut = async () => {
    await supabase.auth.signOut();
    toast.success("Signed out");
    navigate({ to: "/login" });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Top contact strip */}
      <div className="bg-brand-accent text-brand-accent-foreground">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-1.5 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <Phone className="h-3 w-3" /> +966-12-289-2200
            </span>
            <span className="hidden items-center gap-1.5 sm:inline-flex">
              <Mail className="h-3 w-3" /> info@quoteflow.app
            </span>
          </div>
          {user?.email && (
            <span className="hidden md:inline opacity-90">{user.email}</span>
          )}
        </div>
      </div>

      {/* Main brand header */}
      <header className="sticky top-0 z-10 border-b border-sidebar-border bg-brand text-brand-foreground shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Logo />
          <nav className="hidden gap-1 sm:flex">
            {nav.map((n) => {
              const active =
                n.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(n.to);
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className={cn(
                    "relative flex items-center gap-2 rounded-sm px-3 py-2 text-sm font-medium uppercase tracking-wide transition-colors",
                    active
                      ? "text-brand-foreground after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:bg-brand-accent"
                      : "text-brand-foreground/75 hover:text-brand-foreground hover:bg-white/5",
                  )}
                >
                  <n.icon className="h-4 w-4" />
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={signOut}
              title="Sign out"
              className="text-brand-foreground hover:bg-white/10 hover:text-brand-foreground"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:ml-2 sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto border-t border-white/10 px-2 py-2 sm:hidden">
          {nav.map((n) => {
            const active =
              n.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-sm px-3 py-1.5 text-sm font-medium uppercase tracking-wide",
                  active
                    ? "bg-brand-accent text-brand-accent-foreground"
                    : "text-brand-foreground/80 hover:bg-white/10",
                )}
              >
                <n.icon className="h-4 w-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>

      {/* Footer */}
      <footer className="mt-12 border-t border-sidebar-border bg-brand text-brand-foreground">
        <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-brand-foreground/80">
          © {new Date().getFullYear()} QuoteFlow ·{" "}
          <span className="text-brand-accent">Quotation Management</span>
        </div>
      </footer>
    </div>
  );
}
