-- Layer B: AI weekly digest
-- One row per (developer, week-starting-Monday). Cron fires Mon 07:30 KL,
-- summarizes the previous Mon-Sun week from each dev's daily_reports.
-- Tone rules locked in ADR 015 (Boss-readable: BLUF + first-name +
-- business-language). Word budget wider than daily (100-180 vs 60-100) —
-- a week deserves more space.

-- 1. Momentum enum (mirrors trajectory pattern from daily_reports)
create type team_dashboard.momentum as enum (
  'accelerating',  -- this week notably pushed harder than last week
  'steady',        -- this week looks like the prior week
  'slowing',       -- this week notably less than last week
  'stalled',       -- almost no work this week despite recent activity
  'no_activity'    -- no work this week at all
);

-- 2. Table
create table team_dashboard.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  developer_id uuid not null references team_dashboard.developers(id),
  week_start_date date not null,             -- Monday of the week (Asia/Kuala_Lumpur)
  summary text,                              -- nullable: failure rows have no summary
  momentum team_dashboard.momentum,
  top_themes text[],                         -- 3-5 short business-language tags; null on failure
  generator_version text,
  parse_failed boolean not null default false,
  error_msg text,
  created_at timestamptz not null default now(),
  unique (developer_id, week_start_date)
);

-- 3. Indexes
create index weekly_reports_week_recent
  on team_dashboard.weekly_reports (week_start_date desc);

create index weekly_reports_failed_week
  on team_dashboard.weekly_reports (week_start_date desc)
  where parse_failed = true;

-- 4. RLS — same pattern as daily_reports (read for internal users; service_role bypasses)
alter table team_dashboard.weekly_reports enable row level security;

create policy "internal read weekly_reports" on team_dashboard.weekly_reports
  for select to authenticated using (team_dashboard.is_internal_user());

-- 5. Grants — belt-and-suspenders on top of the default privileges from 00007
grant select on team_dashboard.weekly_reports to authenticated;
grant select, insert, update, delete on team_dashboard.weekly_reports to service_role;
