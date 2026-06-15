import { requireSession } from "@/lib/auth";
import { canOpenSettings } from "@/lib/roles";
import { Restricted } from "@/components/restricted";
import { createAdminClient } from "@/lib/supabase/admin";
import { SettingsForm } from "./settings-form";
import type { AiFeature, FeatureModel } from "@/lib/ai-config";

export default async function SettingsPage() {
  const s = await requireSession();
  if (!canOpenSettings(s.profile.role))
    return <Restricted message="Settings are only available to the Master Admin and Ops Head." />;

  const admin = createAdminClient();
  const [{ data: ai }, { data: intg }, { data: gconn }] = await Promise.all([
    admin.from("ai_settings").select("openai_key_enc,anthropic_key_enc,google_key_enc,feature_models").eq("org_id", s.profile.org_id).maybeSingle(),
    admin.from("integration_settings").select("fathom_connected,pms_name,pms_key_enc").eq("org_id", s.profile.org_id).maybeSingle(),
    s.profile.team_member_id
      ? admin.from("member_connections").select("provider,account_email,connected").eq("team_member_id", s.profile.team_member_id).in("provider", ["google", "zoho"])
      : Promise.resolve({ data: [] }),
  ]);
  const conns = (gconn ?? []) as { provider: string; account_email: string | null; connected: boolean }[];
  const google = conns.find((c) => c.provider === "google");
  const zoho = conns.find((c) => c.provider === "zoho");

  return (
    <SettingsForm
      keysSet={{ openai: !!ai?.openai_key_enc, anthropic: !!ai?.anthropic_key_enc, google: !!ai?.google_key_enc }}
      models={(ai?.feature_models ?? {}) as Partial<Record<AiFeature, FeatureModel>>}
      fathomSet={!!intg?.fathom_connected}
      pmsName={intg?.pms_name ?? ""}
      pmsSet={!!intg?.pms_key_enc}
      googleEmail={google?.connected ? google.account_email ?? null : null}
      zohoConnected={!!zoho?.connected}
    />
  );
}
