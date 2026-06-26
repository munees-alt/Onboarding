// Parses the fixed Finanshels sales "Payment Received" (Internal Payment Notification) email
// into the fields we store on an auto-created onboarding lead. Pure + side-effect free so it
// can be unit-tested. Expects the line-structured text produced by getGmailMessage (one row
// per line; "Label  value" kept on a single line).
//
// Template:
//   Client Name      <name>
//   Company          <company>
//   Proposal ID      <id>
//   Amount Paid / Payment Date / Payment Method / Recorded By / Engagement Letter ...
//   SERVICES INCLUDED
//     • <service>
//     • <service>

export interface ParsedLead {
  clientName: string | null;
  companyName: string | null;
  services: string[];
  proposalId: string | null;
}

const BULLET_RE = /^[•\-*●▪‣⁃►▶→○»·]+\s*/;
// Lines that end the SERVICES INCLUDED list (the warning box) or are other field labels.
const STOP_RE = /^(engagement letter|please follow up|amount paid|payment date|payment method|recorded by|proposal id|company|client name|client\b|customer)/i;

function findLabelled(body: string, labels: string[]): string | null {
  const lines = body.split("\n");
  for (const label of labels) {
    const inline = new RegExp(`^\\s*${label}\\s*[:\\-–]?\\s*(.+?)\\s*$`, "i");
    const labelOnly = new RegExp(`^\\s*${label}\\s*[:\\-–]?\\s*$`, "i");
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(inline);
      if (m && m[1].trim()) return m[1].trim();
      // Label alone on its line → value is the next non-empty line (some plain-text layouts).
      if (labelOnly.test(lines[i])) {
        const next = lines.slice(i + 1).find((l) => l.trim());
        if (next && !STOP_RE.test(next.trim())) return next.trim();
      }
    }
  }
  return null;
}

export function parseServices(body: string): string[] {
  const lines = body.split("\n").map((l) => l.trim());
  const start = lines.findIndex((l) => /services?\s+included/i.test(l));
  if (start !== -1) {
    const out: string[] = [];
    for (let i = start + 1; i < lines.length && out.length < 15; i++) {
      const l = lines[i];
      if (!l) { if (out.length) break; else continue; }
      if (STOP_RE.test(l)) break;
      const item = l.replace(BULLET_RE, "").trim();
      if (item) out.push(item);
    }
    if (out.length) return out;
  }
  const one = findLabelled(body, ["Services", "Service", "Package", "Plan", "Scope"]);
  return one ? one.split(/[,;•|]+/).map((s) => s.trim()).filter(Boolean) : [];
}

export function parsePaymentEmail(subject: string, body: string): ParsedLead {
  const clean = body.replace(/\r/g, "");
  const companyName = findLabelled(clean, ["Company Name", "Company", "Business Name", "Business", "Client Company"]);
  const clientName = findLabelled(clean, ["Client Name", "Client", "Contact Name", "Contact", "Customer Name", "Customer", "Name"]);
  const proposalId = findLabelled(clean, ["Proposal ID", "Proposal No", "Proposal Number", "Proposal", "Quote ID", "Quotation ID", "Quote No"]);
  const services = parseServices(clean);
  const subjTail = subject.replace(/^.*payment received\s*[-–:]?\s*/i, "").trim();
  return { clientName, companyName: companyName ?? (subjTail || null), services, proposalId };
}
