-- Phase 2 Step 1: public holiday calendar
-- Required for "working days" denominator in KPI math (per ADR 015 follow-up).
-- Working days = calendar days - weekends - public_holidays - developer_leave_days
-- KL state seeded for 2026. Add future years by INSERT; never edit landed rows.

create table team_dashboard.public_holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null,
  name text not null,
  state text not null default 'KL',
  notes text,
  created_at timestamptz not null default now(),
  unique (holiday_date, name, state)
);

create index public_holidays_state_date on team_dashboard.public_holidays (state, holiday_date);

-- KL 2026 (21 entries, from raw/research/2026-05-12-malaysian-public-holidays.pdf)
insert into team_dashboard.public_holidays (holiday_date, name, state) values
  ('2026-01-01', 'New Year''s Day', 'KL'),
  ('2026-02-01', 'Thaipusam', 'KL'),
  ('2026-02-01', 'Federal Territory Day', 'KL'),
  ('2026-02-02', 'Thaipusam / Federal Territory Day (observed)', 'KL'),
  ('2026-02-17', 'Chinese New Year', 'KL'),
  ('2026-02-18', 'Chinese New Year Holiday', 'KL'),
  ('2026-03-07', 'Nuzul Al-Quran', 'KL'),
  ('2026-03-21', 'Hari Raya Aidilfitri', 'KL'),
  ('2026-03-22', 'Hari Raya Aidilfitri Holiday', 'KL'),
  ('2026-03-23', 'Hari Raya Aidilfitri Holiday', 'KL'),
  ('2026-05-01', 'Labour Day', 'KL'),
  ('2026-05-27', 'Hari Raya Haji', 'KL'),
  ('2026-05-31', 'Wesak Day', 'KL'),
  ('2026-06-01', 'Agong''s Birthday / Wesak Day Holiday', 'KL'),
  ('2026-06-17', 'Awal Muharram', 'KL'),
  ('2026-08-25', 'Prophet Muhammad''s Birthday', 'KL'),
  ('2026-08-31', 'Merdeka Day', 'KL'),
  ('2026-09-16', 'Malaysia Day', 'KL'),
  ('2026-11-08', 'Deepavali', 'KL'),
  ('2026-11-09', 'Deepavali Holiday', 'KL'),
  ('2026-12-25', 'Christmas Day', 'KL');

-- RLS: only internal users can read (mirror daily_reports pattern)
alter table team_dashboard.public_holidays enable row level security;
create policy "internal read public_holidays" on team_dashboard.public_holidays
  for select to authenticated using (team_dashboard.is_internal_user());

-- Grants (belt-and-suspenders on top of default privileges from 00007)
grant select on team_dashboard.public_holidays to authenticated;
grant select, insert, update, delete on team_dashboard.public_holidays to service_role;
