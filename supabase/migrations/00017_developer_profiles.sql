-- Phase 1 Step 2: developer seniority profiles.
-- Adds level / tenure_note / is_reviewer / owned_systems to developers so the
-- dashboard can show seniority as CONTEXT beside each person (never as a hidden
-- score adjustment). Editable from /admin/team — the table-level UPDATE grant +
-- "internal update developers" RLS policy from 00014 already cover these new
-- columns, so no extra grant/policy is needed.
--
-- level is nullable on purpose: a dev with no level set yet (e.g. a brand-new
-- handle the scanner just discovered) renders without a level chip until set.

create type team_dashboard.dev_level as enum ('intern', 'junior', 'senior', 'freelancer');

alter table team_dashboard.developers
  add column if not exists level         team_dashboard.dev_level,
  add column if not exists tenure_note   text,
  add column if not exists is_reviewer   boolean not null default false,
  add column if not exists owned_systems text[]  not null default '{}';
