-- Step 5/6: per-developer per-ISO-week QUALITY signals.
-- 4 bands (weak/developing/solid/strong), NOT a single score; NO leaderboard;
-- coaching-first (evaluation gated). 5 dimensions per the build-brief:
--   hard (deterministic git): test_discipline, stability, code_care
--   soft (AI, Step 6):        review_citizenship, clarity
-- code_care is AI-judged (git blame is not GitHub-API-feasible). Filled
-- incrementally — test_discipline + stability first; the rest stay null until
-- their build lands. level_snapshot is CONTEXT (read the band against the
-- level), never a hidden adjustment.
create type team_dashboard.quality_band as enum ('weak','developing','solid','strong','skipped');

create table if not exists team_dashboard.weekly_quality_reports (
  id uuid primary key default gen_random_uuid(),
  developer_id uuid not null references team_dashboard.developers(id) on delete cascade,
  week_start_date date not null,

  -- hard signals (deterministic git)
  test_discipline_band       team_dashboard.quality_band,
  test_discipline_evidence   text,
  stability_band             team_dashboard.quality_band,
  stability_evidence         text,
  code_care_band             team_dashboard.quality_band,   -- AI-judged later
  code_care_evidence         text,

  -- soft signals (AI, Step 6)
  review_citizenship_band    team_dashboard.quality_band,
  review_citizenship_evidence text,
  clarity_band               team_dashboard.quality_band,
  clarity_evidence           text,

  -- rollup
  headline        text,
  needs_a_chat    boolean not null default false,
  level_snapshot  team_dashboard.dev_level,
  computed_at     timestamptz not null default now(),
  scanner_version text,
  error_msg       text,

  unique (developer_id, week_start_date)
);

create index if not exists weekly_quality_week_recent
  on team_dashboard.weekly_quality_reports (week_start_date desc);

alter table team_dashboard.weekly_quality_reports enable row level security;

create policy "internal read weekly_quality_reports"
  on team_dashboard.weekly_quality_reports
  for select to authenticated
  using (team_dashboard.is_internal_user());

grant select on team_dashboard.weekly_quality_reports to authenticated;
grant select, insert, update, delete on team_dashboard.weekly_quality_reports to service_role;
