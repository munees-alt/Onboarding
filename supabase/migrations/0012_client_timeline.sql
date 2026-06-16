-- Onboarding timeline captured at client creation, for tracking + later insights.
alter table clients add column if not exists target_go_live date;
alter table clients add column if not exists expected_onboarding_days int;
