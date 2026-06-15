// Creates (or resets) the admin auth user. Run:
// node --env-file=.env.local scripts/create-admin.mjs
import { createClient } from "@supabase/supabase-js";

const EMAIL = "munees@finanshels.com";
const PASSWORD = "Cadence2026!";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: created, error } = await admin.auth.admin.createUser({
  email: EMAIL,
  password: PASSWORD,
  email_confirm: true,
  user_metadata: { full_name: "Munees KV" },
});

if (error) {
  if (/already|registered|exists/i.test(error.message)) {
    const { data: list } = await admin.auth.admin.listUsers();
    const u = list.users.find((x) => x.email?.toLowerCase() === EMAIL);
    if (u) {
      await admin.auth.admin.updateUserById(u.id, { password: PASSWORD, email_confirm: true });
      console.log("Updated existing user:", u.id);
    }
  } else {
    throw error;
  }
} else {
  console.log("Created user:", created.user.id);
}

// Confirm the trigger linked a profile + role.
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: signIn, error: siErr } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
console.log("Sign-in:", siErr ? "FAILED " + siErr.message : "ok");
if (signIn?.user) {
  let { data: prof } = await admin.from("profiles").select("role,full_name,team_member_id,org_id").eq("id", signIn.user.id).maybeSingle();
  if (!prof) {
    // User predates the signup trigger — create the profile now.
    const { data: tm } = await admin.from("team_members").select("id,org_id,role,full_name").ilike("email", EMAIL).maybeSingle();
    const { data: org } = await admin.from("orgs").select("id").limit(1).single();
    await admin.from("profiles").insert({
      id: signIn.user.id,
      org_id: tm?.org_id ?? org.id,
      email: EMAIL,
      full_name: tm?.full_name ?? "Munees KV",
      team_member_id: tm?.id ?? null,
      role: tm?.role ?? "admin",
    });
    ({ data: prof } = await admin.from("profiles").select("role,full_name,team_member_id,org_id").eq("id", signIn.user.id).maybeSingle());
    console.log("Profile created.");
  }
  console.log("Profile:", prof);
}
console.log(`\nLogin: ${EMAIL} / ${PASSWORD}`);
