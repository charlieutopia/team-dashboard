alter table team_dashboard.developers enable row level security;
alter table team_dashboard.tracked_repos enable row level security;
alter table team_dashboard.spec_assignments enable row level security;
alter table team_dashboard.daily_reports enable row level security;
alter table team_dashboard.drift_findings enable row level security;
alter table team_dashboard.stuck_signals enable row level security;
alter table team_dashboard.batch_jobs enable row level security;

create or replace function team_dashboard.is_internal_user() returns boolean
language sql stable security definer
set search_path = team_dashboard, pg_temp
as $$
  select exists (
    select 1 from team_dashboard.developers
    where email = (auth.jwt() ->> 'email')
      and active = true
  );
$$;

grant execute on function team_dashboard.is_internal_user() to authenticated;

create policy "internal read developers" on team_dashboard.developers
  for select to authenticated using (team_dashboard.is_internal_user());
create policy "internal read tracked_repos" on team_dashboard.tracked_repos
  for select to authenticated using (team_dashboard.is_internal_user());
create policy "internal read spec_assignments" on team_dashboard.spec_assignments
  for select to authenticated using (team_dashboard.is_internal_user());
create policy "internal read daily_reports" on team_dashboard.daily_reports
  for select to authenticated using (team_dashboard.is_internal_user());
create policy "internal read drift_findings" on team_dashboard.drift_findings
  for select to authenticated using (team_dashboard.is_internal_user());
create policy "internal read stuck_signals" on team_dashboard.stuck_signals
  for select to authenticated using (team_dashboard.is_internal_user());
create policy "internal read batch_jobs" on team_dashboard.batch_jobs
  for select to authenticated using (team_dashboard.is_internal_user());
