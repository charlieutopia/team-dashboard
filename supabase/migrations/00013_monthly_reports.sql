-- Phase 2 Step 3: monthly digest
-- One row per (developer, first day of month). Cron fires 07:00 KL on the 1st
-- of every month, aggregates the prior complete month's daily + weekly reports
-- into a single trend-narrative summary.
-- Tone rules: ADR 015 seven rules with 180-280 word budget (vs daily 60-100,
-- weekly 100-180) — a month deserves more space, but Boss still on phone.
-- Reuses team_dashboard.momentum enum from weekly_reports (00010).

create table team_dashboard.monthly_reports (
  id uuid primary key default gen_random_uuid(),
  developer_id uuid not null references team_dashboard.developers(id),
  month_start_date date not null,            -- first day of the month (Asia/Kuala_Lumpur)
  summary text,                              -- nullable: failure rows have no summary
  momentum team_dashboard.momentum,           -- reused enum: accelerating/steady/slowing/stalled/no_activity
  top_themes text[],                          -- 3-5 short business-language tags; null on failure
  generator_version text,
  parse_failed boolean not null default false,
  error_msg text,
  created_at timestamptz not null default now(),
  unique (developer_id, month_start_date)
);

create index monthly_reports_month_recent
  on team_dashboard.monthly_reports (month_start_date desc);

create index monthly_reports_failed_month
  on team_dashboard.monthly_reports (month_start_date desc)
  where parse_failed = true;

-- RLS: mirror daily_reports / weekly_reports pattern
alter table team_dashboard.monthly_reports enable row level security;

create policy "internal read monthly_reports" on team_dashboard.monthly_reports
  for select to authenticated using (team_dashboard.is_internal_user());

-- Grants (belt-and-suspenders on top of default privileges)
grant select on team_dashboard.monthly_reports to authenticated;
grant select, insert, update, delete on team_dashboard.monthly_reports to service_role;
