import { getPublicIntake } from "./actions";
import { PublicIntakeForm } from "./intake-form";

interface Props { params: Promise<{ token: string }> }

export default async function PublicIntakePage({ params }: Props) {
  const { token } = await params;
  const res = await getPublicIntake(token);
  if (res.error || !res.data) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f6f9", padding: 24 }}>
        <div style={{ maxWidth: 460, background: "#fff", border: "1px solid #e3e6ec", borderRadius: 14, padding: 28, textAlign: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>This link isn&apos;t valid</div>
          <div style={{ color: "#666", fontSize: 14 }}>{res.error ?? "Please ask your accountant to send you a new link."}</div>
        </div>
      </div>
    );
  }
  return <PublicIntakeForm token={token} data={res.data} />;
}

// No layout, no auth — public token-gated page.
export const dynamic = "force-dynamic";
