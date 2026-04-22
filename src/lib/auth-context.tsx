import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
};

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  loading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Set up listener FIRST
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setLoading(false);
    });
    // Then check existing session
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

/** Friendly error message mapping. Logs full error to console for devs. */
export function friendlyError(err: unknown, fallback = "Something went wrong. Please try again."): string {
  console.error("[App error]", err);
  if (!(err instanceof Error)) return fallback;
  const msg = err.message;
  // Auth-specific
  if (/Invalid login credentials/i.test(msg)) return "Invalid email or password.";
  if (/Email not confirmed/i.test(msg)) return "Please verify your email before signing in.";
  if (/User already registered/i.test(msg)) return "An account with this email already exists.";
  if (/not authorized to sign up/i.test(msg))
    return "This email isn't on the team allow-list. Ask a teammate to add you.";
  // Postgres
  if (/duplicate key/i.test(msg) || /unique constraint/i.test(msg))
    return "That entry already exists.";
  if (/violates row-level security/i.test(msg))
    return "You don't have permission to do that.";
  return fallback;
}
