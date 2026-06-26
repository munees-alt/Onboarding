-- Rich, editable call insights: flexible titled sections captured from the call
-- (business model, systems, banking, compliance, reporting, expectations, open items …).
-- Stored as { sections: [{heading, body}] }. description/pain_points columns still hold the brief + pains.
alter table clients add column if not exists call_insights jsonb not null default '{}'::jsonb;
