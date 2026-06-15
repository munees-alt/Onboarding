-- One row per (run, step) so per-run step state can be upserted.
do $$ begin
  alter table run_steps add constraint run_steps_run_step_uniq unique (run_id, step_no);
exception when duplicate_table or duplicate_object then null; end $$;
