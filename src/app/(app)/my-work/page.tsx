import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getRunCards } from "@/lib/data/runs";
import { RunCard } from "@/components/run-card";

export default async function MyWorkPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const memberId = session.teamMember?.id;
  const role = session.profile.role;

  let runIds: string[] | undefined;
  if (role === "admin" || role === "ops_head") {
    runIds = undefined; // see everything
  } else if (memberId) {
    const [{ data: teamRows }, { data: amRuns }] = await Promise.all([
      supabase.from("run_team").select("run_id").eq("team_member_id", memberId),
      supabase.from("onboarding_runs").select("id").eq("am_id", memberId),
    ]);
    runIds = [
      ...new Set([
        ...(teamRows ?? []).map((r) => r.run_id),
        ...(amRuns ?? []).map((r) => r.id),
      ]),
    ];
  } else {
    runIds = [];
  }

  const runs = (await getRunCards(supabase, runIds)).filter(
    (r) => r.status !== "archived" && r.status !== "closed",
  );

  return (
    <div className="scroll">
      <div className="page">
        <div className="section-head">
          <div>
            <h2>My Work</h2>
            <div className="sub">
              {role === "admin" || role === "ops_head"
                ? "All active onboarding runs."
                : "Onboarding runs assigned to you."}
            </div>
          </div>
        </div>

        {runs.length === 0 ? (
          <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: "60px 40px", textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>
            Nothing assigned to you yet.
          </div>
        ) : (
          <div className="mywork-grid">
            {runs.map((r) => (
              <RunCard key={r.id} run={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
