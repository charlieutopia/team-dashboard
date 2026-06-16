-- Step 5 (quality hard signals): persist the per-branch file list so Test
-- Discipline (did source changes ship with tests?) is computable from the DB
-- with zero extra GitHub calls. Populated by run-daily from the branch diff.
alter table team_dashboard.developer_active_branches
  add column if not exists files_touched text[] not null default '{}';
