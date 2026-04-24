import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Permanently deletes a user from auth.users (cascades through profiles/user_roles).
 * Caller must be an admin. Cannot delete yourself.
 */
export const deleteUserAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => {
    if (!input?.userId || typeof input.userId !== "string") {
      throw new Error("userId is required");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId: callerId } = context;

    if (data.userId === callerId) {
      throw new Error("You cannot delete your own account.");
    }

    // Verify caller is admin (RLS-scoped query as the caller)
    const { data: roleRow, error: roleErr } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleErr) throw new Error(roleErr.message);
    if (!roleRow) throw new Error("Forbidden: admin role required.");

    // Remove DB rows we own first (in case no FK cascade exists).
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
    await supabaseAdmin.from("profiles").delete().eq("id", data.userId);

    const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(
      data.userId,
    );
    if (delErr) throw new Error(delErr.message);

    return { success: true };
  });
