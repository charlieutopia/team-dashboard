-- Phase 2.A pivot to Claude Code Max headless: schema changes
-- See wiki/products/team-dashboard/build-briefs/2026-05-10-phase-2-a-cc-headless-pivot.md

-- 1. Drop batch_jobs table — no async batch lifecycle anymore (synchronous CC invocation per ADR 013)
drop table if exists team_dashboard.batch_jobs;

-- 2. daily_reports: relax NOT NULLs to allow failure rows
-- A failed row carries (developer_id, report_date, parse_failed=true, error_msg) only
alter table team_dashboard.daily_reports
  alter column summary drop not null,
  alter column metrics drop not null,
  alter column spec_progress drop not null,
  alter column trajectory drop not null,
  alter column generator_version drop not null;

-- 3. Add failure-tracking columns
alter table team_dashboard.daily_reports
  add column if not exists parse_failed boolean not null default false,
  add column if not exists error_msg text;

-- 4. Index to find failure rows quickly (Boss investigates which devs failed today)
create index if not exists daily_reports_failed_today
  on team_dashboard.daily_reports (report_date desc)
  where parse_failed = true;
