-- Audit and Liquidation are now two separate nav sections (nav ids 'audit' and
-- 'liquidation'), replacing the combined 'audit-liquidation'. Seed department
-- access for both, mirroring the grants/blocks that 0056 set for the combined
-- section. The old 'audit-liquidation' rows are left in place (harmless — the
-- nav id no longer exists).
do $$
declare
  grant_depts text[] := array['COE','Center of Excellence','Management','FinOps and Finance Operations and Onboarding'];
  block_depts text[] := array['HR and TA','Marketing','Office Admin and IT','Partnership','Sales','Engineering','Clients and Team Health','AML','Tax','Tax External','Tax SPC'];
  nav_ids text[] := array['audit','liquidation'];
  r record;
  d text;
  nav text;
begin
  for r in select id from orgs loop
    foreach nav in array nav_ids loop
      foreach d in array grant_depts loop
        insert into dept_overrides (org_id, dept, nav_id, allow)
        values (r.id, d, nav, true)
        on conflict (org_id, dept, nav_id) do update set allow = excluded.allow, updated_at = now();
      end loop;
      foreach d in array block_depts loop
        insert into dept_overrides (org_id, dept, nav_id, allow)
        values (r.id, d, nav, false)
        on conflict (org_id, dept, nav_id) do update set allow = excluded.allow, updated_at = now();
      end loop;
    end loop;
  end loop;
end $$;
