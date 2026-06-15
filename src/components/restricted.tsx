import { Icon } from "./icon";

export function Restricted({ message }: { message: string }) {
  return (
    <div className="scroll">
      <div
        className="page"
        style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 400, gap: 12, textAlign: "center" }}
      >
        <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--orange-soft)", display: "grid", placeItems: "center", color: "var(--orange)" }}>
          <Icon name="lock" size={22} />
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink-1)" }}>Access restricted</div>
        <div style={{ fontSize: 13, color: "var(--ink-3)", maxWidth: 320, lineHeight: 1.6 }}>{message}</div>
      </div>
    </div>
  );
}
