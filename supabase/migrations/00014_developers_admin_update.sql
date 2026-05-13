-- Phase 3 Step 2: allow internal users (Boss + future authed admins) to UPDATE
-- the developers table from the dashboard's admin page (rename + active toggle).
-- READ policy already exists in 00005_rls.sql; this adds UPDATE only.
-- INSERT / DELETE remain service-role-only — adding new devs / removing them
-- still goes through migrations or scanner sync, not the dashboard UI.
--
-- Two layers required: (a) Postgres table-level GRANT (the role must have the
-- UPDATE privilege at all), (b) RLS policy (which rows the role may touch).
-- 00007_grants.sql granted only SELECT to authenticated; this migration adds
-- UPDATE on the developers table specifically (other tables remain read-only
-- to authenticated, writes go via service_role).

grant update on team_dashboard.developers to authenticated;

create policy "internal update developers" on team_dashboard.developers
  for update to authenticated
  using (team_dashboard.is_internal_user())
  with check (team_dashboard.is_internal_user());
