-- Phase 3 Step 3: per-dev active branches snapshot.
-- Populated by run-daily.ts after the analyze loop, using a delete-then-insert
-- per developer_id sync (mirrors sync-hr.ts). The dashboard reads this table
-- to render the structural per-card branch list (branch name + last commit
-- time + commits + lines).
--
-- Zero extra GH API cost — extracted from the same compareCommits response
-- that already feeds the analyzer.

create table if not exists team_dashboard.developer_active_branches (
  id uuid primary key default gen_random_uuid(),
  developer_id uuid not null references team_dashboard.developers(id) on delete cascade,
  repo_full_name text not null,
  branch_name text not null,
  head_sha text not null,
  base_sha text not null,
  last_commit_at timestamptz,
  last_commit_message text,
  last_commit_author text,
  commits_ahead int not null default 0,
  lines_added int not null default 0,
  lines_removed int not null default 0,
  files_changed int not null default 0,
  captured_at timestamptz not null default now(),
  unique (developer_id, repo_full_name, branch_name)
);

create index if not exists developer_active_branches_dev_recent_idx
  on team_dashboard.developer_active_branches (developer_id, last_commit_at desc);

alter table team_dashboard.developer_active_branches enable row level security;

create policy "internal read developer_active_branches"
  on team_dashboard.developer_active_branches
  for select to authenticated
  using (team_dashboard.is_internal_user());

grant select on team_dashboard.developer_active_branches to authenticated;
grant select, insert, update, delete on team_dashboard.developer_active_branches to service_role;
