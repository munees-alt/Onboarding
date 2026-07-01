-- Batch: platform cleanup — seed the department access template so the
-- Master Admin can configure access by department, role, or user right away
-- instead of building each department's module list by hand. Every nav module
-- gets an explicit row per department (true = allowed, false = blocked), so
-- each department is fully restrictive to exactly what's listed below. The
-- Master Admin can still change any of this any time from
-- Settings → Access · who can open which module → By Department.
do $$
declare
  all_nav text[] := array[
    'my-work','aml','tax-compliance','onboarding','clients','connections',
    'all-runs','process-intel','templates','sop','create-run','am-report',
    'master-coa','master-tax-codes','org-chart','team-health','tickets',
    'doc-audit','audit-log','settings'
  ];
  dept_defs jsonb := '{
    "AML": ["my-work","clients","connections","aml","audit-log"],
    "COE": ["clients","templates","sop","am-report","master-coa","master-tax-codes","org-chart","team-health","onboarding","aml","tax-compliance","audit-log"],
    "Center of Excellence": ["clients","templates","sop","am-report","master-coa","master-tax-codes","org-chart","team-health","onboarding","aml","tax-compliance","audit-log"],
    "Clients and Team Health": ["audit-log"],
    "Engineering": ["tickets","audit-log","doc-audit"],
    "FinOps and Finance Operations and Onboarding": ["my-work","onboarding","clients","connections","templates","sop","master-coa","master-tax-codes","audit-log"],
    "Management": ["clients","templates","sop","am-report","master-coa","master-tax-codes","org-chart","team-health","onboarding","aml","tax-compliance","audit-log"],
    "HR and TA": ["audit-log"],
    "Marketing": ["audit-log"],
    "Office Admin and IT": ["audit-log"],
    "Partnership": ["audit-log"],
    "Sales": ["audit-log"],
    "Tax": ["my-work","tax-compliance","connections","audit-log","clients"],
    "Tax External": ["my-work","tax-compliance","connections","audit-log","clients"],
    "Tax SPC": ["my-work","tax-compliance","connections","audit-log","clients"]
  }'::jsonb;
  r record;
  dept text;
  nav text;
  allowed text[];
begin
  for r in select id from orgs loop
    for dept in select jsonb_object_keys(dept_defs) loop
      select array_agg(x) into allowed from jsonb_array_elements_text(dept_defs->dept) as x;
      foreach nav in array all_nav loop
        insert into dept_overrides (org_id, dept, nav_id, allow)
        values (r.id, dept, nav, nav = any(allowed))
        on conflict (org_id, dept, nav_id) do update set allow = excluded.allow, updated_at = now();
      end loop;
    end loop;
  end loop;
end $$;
