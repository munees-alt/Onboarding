"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type AuthState = { error: string | null };

export async function signInAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  if (!email || !password) return { error: "Email and password are required." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  redirect("/my-work");
}

export async function signUpAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const fullName = String(formData.get("full_name") || "").trim();
  if (!email || !password) return { error: "Email and password are required." };
  if (password.length < 8)
    return { error: "Password must be at least 8 characters." };

  const admin = createAdminClient();

  // Only allow signup if the email is already registered as a team member.
  const { data: member } = await admin
    .from("team_members")
    .select("id,full_name,org_id")
    .ilike("email", email)
    .eq("active", true)
    .limit(1)
    .maybeSingle();

  if (!member) {
    return { error: "This email is not registered as a team member. Ask your admin to add you first." };
  }

  // Use admin createUser with email_confirm:true — no confirmation email sent,
  // bypasses Supabase's built-in email rate limit entirely.
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName || member.full_name },
  });

  if (error) {
    // If the auth user already exists, they just need to sign in.
    if (error.message?.toLowerCase().includes("already been registered") ||
        error.message?.toLowerCase().includes("already exists")) {
      return { error: "An account with this email already exists. Please sign in instead." };
    }
    return { error: error.message };
  }

  if (!data.user) return { error: "Failed to create account. Try again." };

  // Link the auth user to the team_member row if not already linked.
  await admin
    .from("team_members")
    .update({ auth_user_id: data.user.id })
    .eq("id", member.id)
    .is("auth_user_id", null);

  // Sign the user in immediately — no email confirmation step.
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) {
    return { error: "Account created. Please sign in." };
  }

  redirect("/my-work");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
