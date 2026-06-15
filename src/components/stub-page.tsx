import { Icon } from "./icon";

export function StubPage({
  title,
  blurb,
}: {
  title: string;
  blurb?: string;
}) {
  return (
    <div className="scroll">
      <div className="page">
        <div className="section-head">
          <div>
            <h2>{title}</h2>
            <div className="sub">{blurb ?? "Part of Cadence — coming in a later stage."}</div>
          </div>
        </div>
        <div
          style={{
            background: "#fff",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "80px 40px",
            textAlign: "center",
            color: "var(--ink-3)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: "50%",
              background: "var(--orange-soft)",
              display: "grid",
              placeItems: "center",
              color: "var(--orange)",
            }}
          >
            <Icon name="hammer" size={22} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink-1)" }}>
            Coming soon
          </div>
          <div style={{ fontSize: 13, maxWidth: 360, lineHeight: 1.6 }}>
            This module is planned for a later stage of the Cadence build. The
            onboarding workflow is the current focus.
          </div>
        </div>
      </div>
    </div>
  );
}
