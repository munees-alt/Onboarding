"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "DM Sans, system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, background: "#f2f1ee" }}>
        <div style={{ textAlign: "center", maxWidth: 480, padding: 24 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#0f1117" }}>Something went wrong</div>
          <div style={{ fontSize: 13, color: "#3b4254", marginTop: 8, fontFamily: "DM Mono, monospace" }}>{error.message || "Unexpected error"}</div>
          <button onClick={reset} style={{ marginTop: 16, background: "#f97316", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 600, cursor: "pointer" }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
