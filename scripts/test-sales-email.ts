// Run: npx tsx scripts/test-sales-email.ts
// Verifies the parser against a faithful HTML reconstruction of the sample
// "Payment Received" email, passed through the same HTML→text logic google.ts uses.
import { parsePaymentEmail } from "../src/lib/sales-email";

// Mirror of htmlToText() in src/lib/google.ts (kept in sync for this test).
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/(td|th)>/gi, "\t")
    .replace(/<\/(tr|p|div|li|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

const html = `
<div><img src="logo.png"><p>Internal Payment Notification</p></div>
<div><h2>&#9995; Payment Received</h2></div>
<table>
  <tr><td>Client Name</td><td><b>Saurabh Saxena</b></td></tr>
  <tr><td>Company</td><td><b>Cross Border Consultancy FZCO</b></td></tr>
  <tr><td>Proposal ID</td><td><code>PR-2026-1264-v1</code></td></tr>
  <tr><td>Amount Paid</td><td>AED 10,611.30</td></tr>
  <tr><td>Payment Date</td><td>23 Jun 2026</td></tr>
  <tr><td>Payment Method</td><td>Stripe</td></tr>
  <tr><td>Recorded By</td><td>System (Stripe)</td></tr>
  <tr><td>Engagement Letter</td><td>Required</td></tr>
</table>
<h3>SERVICES INCLUDED</h3>
<ul>
  <li>Accounting &amp; Bookkeeping</li>
  <li>Prior-Period Catch-Up &amp; Books Cleanup</li>
</ul>
<div><b>Engagement Letter Required</b><p>Please follow up with the client to obtain their signed engagement letter before initiating onboarding or any service delivery.</p></div>
`;

const text = htmlToText(html);
const parsed = parsePaymentEmail("Payment Received - Cross Border Consultancy FZCO", text);

console.log("--- extracted text ---\n" + text + "\n----------------------");
console.log("PARSED:", JSON.stringify(parsed, null, 2));

const expect = {
  clientName: "Saurabh Saxena",
  companyName: "Cross Border Consultancy FZCO",
  proposalId: "PR-2026-1264-v1",
  services: ["Accounting & Bookkeeping", "Prior-Period Catch-Up & Books Cleanup"],
};
const checks: [string, boolean][] = [
  ["clientName", parsed.clientName === expect.clientName],
  ["companyName", parsed.companyName === expect.companyName],
  ["proposalId", parsed.proposalId === expect.proposalId],
  ["services", JSON.stringify(parsed.services) === JSON.stringify(expect.services)],
];
let pass = true;
for (const [name, ok] of checks) { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) pass = false; }
process.exit(pass ? 0 : 1);
