-- Grants for team_dashboard schema access via Postgrest
-- Service role bypasses RLS; authenticated role honors RLS policies.
-- Idempotent — safe to re-run.

grant usage on schema team_dashboard to authenticated, anon, service_role;
grant select on all tables in schema team_dashboard to authenticated;
grant select, insert, update, delete on all tables in schema team_dashboard to service_role;
grant usage on all sequences in schema team_dashboard to service_role;

alter default privileges in schema team_dashboard
  grant select on tables to authenticated;
alter default privileges in schema team_dashboard
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema team_dashboard
  grant usage on sequences to service_role;
