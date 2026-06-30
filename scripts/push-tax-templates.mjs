import { createClient } from "@supabase/supabase-js";

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const assignTeamStage = (id) => ({
  id: `${id}0`, name: "Assign Team",
  desc: "Set the Account Manager, Team Lead, and Team Member before starting work.",
  steps: [
    { id: `${id}0.1`, title: "Assign Account Manager", kind: "person", who: ["AM"],
      note: "Default: Gautam Sanoj (Tax Head). Change if needed.",
      act: { type: "assign", role: "AM", btn: "Assign AM" } },
    { id: `${id}0.2`, title: "Assign Team Lead", kind: "person", who: ["AM"],
      note: "Default: Nafila. Change if needed.",
      act: { type: "assign", role: "Team Lead", btn: "Assign Team Lead" } },
    { id: `${id}0.3`, title: "Assign Team Member", kind: "person", who: ["AM"],
      note: "Auto-suggested by capacity (least-loaded under Nafila). Change if needed.",
      act: { type: "assign", role: "Senior", btn: "Assign Team Member" } }
  ]
});

const CT_DOCS = ["Trade Licence (current)","MOA / AOA","Owner / shareholder Emirates ID","Owner / shareholder passport copy","Establishment / Immigration card","Bank statement (last 3 months)"];
const VAT_DOCS = ["Trade Licence (current)","MOA / AOA","Bank statement (last 3 months)","Sample sales invoices (last 12 months)","Customs registration (if importer/exporter)","Lease / tenancy contract"];
const FTA_DOCS = ["Trade Licence (latest)","MOA / AOA (if amended)","Owner / authorised signatory Emirates ID","Latest FTA certificate (CT / VAT)"];
const ACK_ITEMS = ["FTA acknowledgement / certificate downloaded","Uploaded to the client Drive folder","Sent to the client (email / WhatsApp)","Compliance record updated (next due date set)"];

const makeTpl = (id, name, color, desc, docs, fileTitle, fileItems, includeClient) => ({
  id, name, tier: "Compliance", teamLabel: "AM-led, Senior support", color,
  live: true, usedBy: 0, category: "Taxation", desc, uploads: [], intake: [], taskboard: [],
  stages: [
    assignTeamStage(id),
    { id: `${id}1`, name: "Collect documents from team",
      desc: "Confirm every document we already have internally + paste the Drive link the team shared.",
      steps: [{ id: `${id}1.1`, title: "Confirm internal documents received", kind: "person", who: ["AM","Senior"],
        note: "Tick off each document as you confirm it on Drive. Paste the team Drive link in the step notes.",
        act: { type: "checklist", btn: "All received from team", items: docs } }] },
    ...(includeClient ? [{
      id: `${id}2`, name: "Request missing documents from client",
      desc: "Send a no-login link the client can upload to.",
      steps: [{ id: `${id}2.1`, title: "Send no-login upload link + WhatsApp / email request", kind: "link", who: ["AM"],
        note: "Generates a no-login upload link plus ready-to-send messages. Nudge if documents are slow.",
        act: { type: "dispatch", intake: true, btn: "Mark sent", optional: true } }] }] : []),
    { id: includeClient ? `${id}3` : `${id}2`, name: fileTitle,
      desc: "Open the FTA portal and complete the submission.",
      steps: [{ id: `${includeClient ? `${id}3` : `${id}2`}.1`, title: fileTitle, kind: "person", who: ["AM","Senior"],
        note: "Open the FTA portal, sign in, and complete the submission. Tick each item as you go.",
        act: { type: "checklist", btn: "Submission complete", items: fileItems } }] },
    { id: includeClient ? `${id}4` : `${id}3`, name: "Send acknowledgement",
      desc: "Share the FTA acknowledgement with the client and close the run.",
      steps: [{ id: `${includeClient ? `${id}4` : `${id}3`}.1`,
        title: includeClient ? "Share registration acknowledgement with client" : "Share filing acknowledgement with client",
        kind: "person", who: ["AM"],
        note: "Attach the FTA acknowledgement / certificate, send it to the client, and tick to confirm.",
        act: { type: "checklist", btn: "Acknowledgement sent", items: ACK_ITEMS } }] }
  ]
});

const templates = [
  makeTpl("ct-registration","Corporate Tax Registration","#f97316","Register the client with the FTA for Corporate Tax.",CT_DOCS,
    "File CT registration in the FTA portal",["Logged into the FTA portal","Client details entered","Documents uploaded","Registration submitted","Acknowledgement downloaded"],true),
  makeTpl("vat-registration","VAT Registration","#8b5cf6","Register the client for VAT with the FTA.",VAT_DOCS,
    "File VAT registration in the FTA portal",["Logged into the FTA portal","Business details entered","Revenue figures entered","Documents uploaded","Registration submitted","Acknowledgement downloaded"],true),
  makeTpl("ct-filing","Corporate Tax Filing","#0ea5e9","File the Corporate Tax return for the client.",
    ["Trial balance / management accounts","Final P&L and balance sheet","Tax adjustments worksheet","Supporting schedules (depreciation, related-party, etc.)"],
    "File CT return in the FTA portal",["Logged into the FTA portal","Period selected","Figures entered","Schedules uploaded","Return submitted","Acknowledgement downloaded"],false),
  makeTpl("vat-filing","VAT Filing","#10b981","File the VAT return for the client.",
    ["VAT sales & purchase ledger export","Bank statement for the period","Expense invoices","Import / export declarations (if applicable)"],
    "File VAT return in the FTA portal",["Logged into the FTA portal","Period selected","Output VAT entered","Input VAT entered","Amount confirmed","Return submitted","Acknowledgement downloaded"],false),
  makeTpl("fta-amendment","FTA Amendment","#ef4444","Process an amendment to the FTA registration.",FTA_DOCS,
    "Submit amendment in the FTA portal",["Logged into the FTA portal","Amendment type selected","Updated details entered","Documents uploaded","Amendment submitted","Confirmation downloaded"],true),
];

let ok = 0;
for (const tpl of templates) {
  const { error } = await s.from("onboarding_templates").upsert({ id: tpl.id, name: tpl.name, data: tpl }, { onConflict: "id" });
  if (error) console.error("Error:", tpl.id, error.message);
  else { console.log("saved:", tpl.id, "stages:", tpl.stages.length); ok++; }
}
console.log(`Done: ${ok}/${templates.length}`);
