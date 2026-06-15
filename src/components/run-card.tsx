import Link from "next/link";
import { Icon } from "./icon";
import { fmtDate, type RunCardData } from "@/lib/data/runs";

export function RunCard({ run }: { run: RunCardData }) {
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
