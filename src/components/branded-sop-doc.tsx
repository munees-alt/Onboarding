"use client";

import { Icon } from "@/components/icon";

/* A Finanshels-branded, presentable rendering of an SOP / access guide.
   Used both in the team SOP library and on the client portal so clients see a
   polished branded document (not just a text list). Opens as a modal and can be
   printed / saved as a clean branded PDF. */

export interface BrandedSopDocProps {
  title: string;
  steps: string[];
  flow?: string | null; // accounting | tax | general
  category?: string | null; // bank | gateway | fta | ...
  email?: string; // optional access email to grant
  subtitle?: string;
  onClose: () => void;
}

const FLOW_LABEL: Record<string, string> = { accounting: "Accounting", tax: "Tax", general: "General" };
const CAT_LABEL: Record<string, string> = { bank: "Bank access", gateway: "Payment gateway", fta: "FTA / EmaraTax", vat: "VAT", ct: "Corporate Tax", software: "Accounting software", payroll: "Payroll / WPS", ecommerce: "E-commerce" };

const NAVY = "#082032";
const ORANGE = "#F97316";

function fillEmail(line: string, email?: string) {
  return line.replace(/\{email\}/g, email || "your account manager's email");
}

/** Builds a standalone branded HTML document and prints it (Save as PDF). */
function printDoc(p: BrandedSopDocProps) {
  const flow = p.flow ? FLOW_LABEL[p.flow] ?? p.flow : "";
  const cat = p.category ? CAT_LABEL[p.category] ?? p.category : "";
  const tags = [flow, cat].filter(Boolean);
  const steps = p.steps.map((s, i) => `<li><span class="n">${i + 1}</span><span class="t">${fillEmail(s, p.email).replace(/</g, "&lt;")}</span></li>`).join("");
  const emailBlock = p.email
    ? `<div class="email"><span class="lbl">Grant access to</span><strong>${p.email.replace(/</g, "&lt;")}</strong></div>`
    : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${p.title.replace(/</g, "&lt;")} — Finanshels</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1B2733;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{max-width:760px;margin:0 auto;padding:0}
  .bar{background:${NAVY};color:#fff;padding:22px 40px;display:flex;align-items:center;gap:12px}
  .mark{width:34px;height:34px;border-radius:9px;background:rgba(255,255,255,.12);display:grid;place-items:center}
  .mark svg{width:20px;height:20px;stroke:${ORANGE};fill:none;stroke-width:2.2}
  .word{font-size:19px;font-weight:800;letter-spacing:-.02em}
  .word .o{color:${ORANGE}}
  .kicker{margin-left:auto;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.6)}
  .head{padding:30px 40px 6px}
  .tags{display:flex;gap:8px;margin-bottom:12px}
  .tag{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:4px 10px;border-radius:99px;background:#FFF1E6;color:${ORANGE}}
  h1{font-size:25px;font-weight:800;letter-spacing:-.02em;color:${NAVY};line-height:1.2}
  .sub{font-size:13.5px;color:#51606E;margin-top:8px;line-height:1.6}
  .email{margin:18px 40px 0;display:flex;align-items:center;gap:10px;background:#FFF7E9;border:1px solid #F4E3C7;border-radius:11px;padding:12px 16px}
  .email .lbl{font-size:12px;color:#7A6646}
  .email strong{font-size:15px;font-family:'DM Mono',ui-monospace,monospace;color:${NAVY}}
  ol{list-style:none;padding:24px 40px 8px}
  li{display:flex;gap:14px;padding:11px 0;border-bottom:1px solid #F0ECE2;align-items:flex-start}
  li:last-child{border-bottom:none}
  .n{flex:none;width:26px;height:26px;border-radius:50%;background:${NAVY};color:#fff;font-size:13px;font-weight:700;display:grid;place-items:center;margin-top:1px}
  .t{font-size:14.5px;line-height:1.6;color:#2A3742;padding-top:2px}
  .foot{margin:18px 40px 40px;padding-top:16px;border-top:2px solid #F0ECE2;font-size:11.5px;color:#8794A0;display:flex;justify-content:space-between;align-items:center}
  @media print{.page{max-width:none}@page{margin:0}}
</style></head>
<body><div class="page">
  <div class="bar">
    <span class="mark"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span>
    <span class="word">Finan<span class="o">shels</span></span>
    <span class="kicker">Access Instructions</span>
  </div>
  <div class="head">
    ${tags.length ? `<div class="tags">${tags.map((t) => `<span class="tag">${t}</span>`).join("")}</div>` : ""}
    <h1>${p.title.replace(/</g, "&lt;")}</h1>
    ${p.subtitle ? `<div class="sub">${p.subtitle.replace(/</g, "&lt;")}</div>` : ""}
  </div>
  ${emailBlock}
  <ol>${steps}</ol>
  <div class="foot"><span>Finanshels — Accounting &amp; Tax, done right.</span><span>Questions? Reply to your onboarding email.</span></div>
</div>
<script>window.onload=function(){window.print();}</script>
</body></html>`;
  const w = window.open("", "_blank", "width=820,height=900");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

export function BrandedSopDoc(props: BrandedSopDocProps) {
  const { title, steps, flow, category, email, subtitle, onClose } = props;
  const tags = [flow ? FLOW_LABEL[flow] ?? flow : "", category ? CAT_LABEL[category] ?? category : ""].filter(Boolean);

  return (
    <div className="modal-overlay open" onClick={onClose} style={{ zIndex: 200 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(720px, 94vw)", maxHeight: "92vh", background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 24px 70px rgba(8,32,50,0.35)", display: "flex", flexDirection: "column" }}>
        {/* Brand bar */}
        <div style={{ background: NAVY, color: "#fff", padding: "18px 26px", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 32, height: 32, borderRadius: 9, background: "rgba(255,255,255,0.12)", display: "grid", placeItems: "center", color: ORANGE }}><Icon name="gauge" size={19} strokeWidth={2.2} /></span>
          <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em" }}>Finan<span style={{ color: ORANGE }}>shels</span></span>
          <span style={{ marginLeft: "auto", fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)" }}>Access Instructions</span>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", width: 28, height: 28, borderRadius: 7, cursor: "pointer", display: "grid", placeItems: "center" }}><Icon name="x" size={16} /></button>
        </div>

        <div style={{ overflowY: "auto", padding: "24px 26px 8px" }}>
          {tags.length > 0 && (
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {tags.map((t) => <span key={t} style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", padding: "4px 10px", borderRadius: 99, background: "#FFF1E6", color: ORANGE }}>{t}</span>)}
            </div>
          )}
          <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", color: NAVY, lineHeight: 1.2 }}>{title}</h2>
          {subtitle && <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 8, lineHeight: 1.6 }}>{subtitle}</div>}

          {email && (
            <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 10, background: "#FFF7E9", border: "1px solid #F4E3C7", borderRadius: 11, padding: "11px 14px" }}>
              <Icon name="mail" size={15} style={{ color: ORANGE }} />
              <span style={{ fontSize: 12, color: "#7A6646" }}>Grant access to</span>
              <strong style={{ fontSize: 14, fontFamily: "DM Mono, monospace", color: NAVY }}>{email}</strong>
            </div>
          )}

          <ol style={{ listStyle: "none", padding: "20px 0 8px", margin: 0 }}>
            {steps.map((s, i) => (
              <li key={i} style={{ display: "flex", gap: 14, padding: "11px 0", borderBottom: i === steps.length - 1 ? "none" : "1px solid #F0ECE2", alignItems: "flex-start" }}>
                <span style={{ flex: "none", width: 26, height: 26, borderRadius: "50%", background: NAVY, color: "#fff", fontSize: 13, fontWeight: 700, display: "grid", placeItems: "center", marginTop: 1 }}>{i + 1}</span>
                <span style={{ fontSize: 14, lineHeight: 1.6, color: "#2A3742", paddingTop: 2 }}>{fillEmail(s, email)}</span>
              </li>
            ))}
          </ol>
        </div>

        <div style={{ borderTop: "1px solid var(--border)", padding: "12px 26px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>Finanshels — Accounting &amp; Tax, done right.</span>
          <button className="btn-primary" onClick={() => printDoc(props)}><Icon name="download" size={14} /> Download / Print PDF</button>
        </div>
      </div>
    </div>
  );
}
