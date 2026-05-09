create type team_dashboard.trajectory as enum ('on_track', 'ahead', 'behind', 'stuck', 'no_activity');

create table team_dashboard.daily_reports (
  id uuid primary key default gen_random_uuid(),
  developer_id uuid not null references team_dashboard.developers(id),
  report_date date not null,
  summary text not null,
  metrics jsonb not null,
  spec_progress jsonb not null,
  trajectory team_dashboard.trajectory not null,
  generator_version text not null,
  created_at timestamptz not null default now(),
  unique (developer_id, report_date)
);

create index daily_reports_date_recent on team_dashboard.daily_reports (report_date desc);
