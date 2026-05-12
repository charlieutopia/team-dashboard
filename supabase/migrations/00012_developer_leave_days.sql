-- Phase 2 Step 1: developer leave-days mirror table
-- Synced daily from utopia-hub HR (leave_applications + leave_application_days),
-- filtered to approved-only (manager_approval='approved' AND hr_approval='approved').
-- Single source of truth for "was this developer on approved leave on this date".
-- Bridge: team-dashboard.developers.email → utopia-hub.profiles.email → profile_id
-- → leave_applications.employee_id → leave_application_days (per-date expansion).

create table team_dashboard.developer_leave_days (
  id uuid primary key default gen_random_uuid(),
  developer_id uuid not null references team_dashboard.developers(id),
  leave_date date not null,
  leave_type text not null,                       -- e.g. "Ordinary Leave (OL)", "Medical Leave", "Public Holiday (PH)"
  is_half_day boolean not null default false,
  half_segment text,                              -- "AM" / "PM" / null for full day
  source_leave_application_id uuid,               -- back-pointer to utopia-hub.leave_applications.id
  synced_at timestamptz not null default now(),
  unique (developer_id, leave_date)               -- one row per (dev, day); sync dedupes if multiple apps cover same day
);

create index developer_leave_days_date_recent
  on team_dashboard.developer_leave_days (leave_date desc);

create index developer_leave_days_dev_date
  on team_dashboard.developer_leave_days (developer_id, leave_date desc);

-- RLS: mirror daily_reports / public_holidays pattern
alter table team_dashboard.developer_leave_days enable row level security;
create policy "internal read developer_leave_days" on team_dashboard.developer_leave_days
  for select to authenticated using (team_dashboard.is_internal_user());

-- Grants
grant select on team_dashboard.developer_leave_days to authenticated;
grant select, insert, update, delete on team_dashboard.developer_leave_days to service_role;
