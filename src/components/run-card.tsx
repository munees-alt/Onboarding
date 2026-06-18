import Link from "next/link";
import { Icon } from "./icon";
import { fmtDate, type RunCardData } from "@/lib/data/runs";

export interface RunCardAction {
  stepTitle: string;
  stageName: string;
  mine: boolean;
  waitingRole: string | null;
}

export function RunCard({ run, action, dense }: { run: RunCardData; action?: RunCardAction | null; dense?: boolean }) {
  if (dense) {
    return (
      <Link href={`/onboarding/${run.id}`} className="mywork-card mw-dense" style={{ textDecoration: "none", color: "inherit" }}>
        <div className="mw-top">
          <h4 style={{ margin: 0, fontSize: 14 }}>{run.clientName}</h4>
          <span className="mw-due">{run.progress}%</span>
        </div>
        <div className="mw-template" style={{ marginTop: 2 }}><Icon name="route" size={11} /> {run.templateName}</div>
        <div className="progress orange" style={{ marginTop: 8 }}><i style={{ width: `${run.progress}%` }} /></div>
        <div className="mw-foot" style={{ marginTop: 8 }}>
          <div className="mw-stages">
            {Array.from({ length: run.stageCount }).map((_, i) => (
              <span key={i} className={"stage-pip" + (i < run.stagesDone ? " done" : i === run.stagesDone ? " active" : "")} />
            ))}
          </div>
          <span className="mw-current-name" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{run.currentStage}. {run.currentStageName ?? "—"}</span>
        </div>
      </Link>
    );
  }
  return (
    <Link
      href={`/onboarding/${run.id}`}
      className="mywork-card"
      style={{ textDecoration: "none", color: "inherit" }}
    >
      <div className="mw-top">
        <span className="mw-client">Onboarding</span>
        {run.target && (
          <span className="mw-due">
            <Icon name="calendar" size={12} /> Target {fmtDate(run.target)}
          </span>
        )}
      </div>
      <h4>{run.clientName}</h4>
      <div className="mw-template">
        <Icon name="route" size={12} /> {run.templateName}
      </div>

      {action && (
        <div style={{
          marginTop: 10, borderRadius: 9, padding: "9px 11px",
          background: action.mine ? "var(--orange-soft)" : "var(--bg)",
          border: "1px solid " + (action.mine ? "var(--orange)" : "var(--border)"),
        }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: action.mine ? "var(--orange)" : "var(--ink-3)", display: "flex", alignItems: "center", gap: 5 }}>
            <Icon name={action.mine ? "hand" : "clock"} size={11} />
            {action.mine ? "Your step now" : `Waiting on ${action.waitingRole ?? "the team"}`}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-1)", marginTop: 3 }}>{action.stepTitle}</div>
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 1 }}>{action.stageName}</div>
        </div>
      )}

      <div className="mw-progress">
        <div className="mw-progress-top">
          <span>Progress</span>
          <span>{run.progress}%</span>
        </div>
        <div className="progress orange">
          <i style={{ width: `${run.progress}%` }} />
        </div>
      </div>

      <div className="mw-current">
        <span className="mw-current-lbl">Current stage</span>
        <span className="mw-current-name">
          {run.currentStage}. {run.currentStageName ?? "—"}
        </span>
      </div>

      <div className="mw-foot">
        <div className="mw-stages">
          {Array.from({ length: run.stageCount }).map((_, i) => (
            <span
              key={i}
              className={
                "stage-pip" +
                (i < run.stagesDone ? " done" : i === run.stagesDone ? " active" : "")
              }
            />
          ))}
        </div>
        {run.amName && <span className="mw-due">{run.amName}</span>}
      </div>
    </Link>
  );
}
