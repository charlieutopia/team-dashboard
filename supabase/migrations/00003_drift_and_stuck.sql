create type team_dashboard.drift_bucket as enum ('covered', 'partial', 'out_of_scope', 'missing');

create table team_dashboard.drift_findings (
  id uuid primary key default gen_random_uuid(),
  developer_id uuid not null references team_dashboard.developers(id),
  report_date date not null,
  spec_item_path text not null,
  bucket team_dashboard.drift_bucket not null,
  file_path text,
  line_range int4range,
  evidence text not null,
  detector_version text not null,
  created_at timestamptz not null default now()
);

create index drift_findings_dev_date_recent on team_dashboard.drift_findings (developer_id, report_date desc);

create table team_dashboard.stuck_signals (
  id uuid primary key default gen_random_uuid(),
  repo_id uuid not null references team_dashboard.tracked_repos(id),
  developer_id uuid references team_dashboard.developers(id),
  branch text not null,
  signal text not null check (signal in ('green', 'yellow', 'red')),
  reasons jsonb not null,
  branch_age_hours int not null,
  hours_since_last_commit int not null,
  commit_cadence_per_day numeric,
  blocker_keyword_hits int not null default 0,
  scanned_at timestamptz not null default now()
);

create index stuck_signals_dev_recent on team_dashboard.stuck_signals (developer_id, scanned_at desc);
