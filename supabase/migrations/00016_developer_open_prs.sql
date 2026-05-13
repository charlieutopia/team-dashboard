-- Phase 3 Step 4: per-dev open PRs snapshot.
-- Populated by run-daily.ts after the active-branches sync, using a single
-- GH search call per active developer per tracked repo
-- (octokit.search.issuesAndPullRequests with q='is:pr is:open author:<handle> repo:<repo>').
-- Dashboard reads this table to render the per-card "N open PRs" badge.

create table if not exists team_dashboard.developer_open_prs (
  id uuid primary key default gen_random_uuid(),
  developer_id uuid not null references team_dashboard.developers(id) on delete cascade,
  repo_full_name text not null,
  pr_number int not null,
  pr_title text not null,
  pr_url text not null,
  pr_state text not null check (pr_state in ('open', 'draft')),
  pr_created_at timestamptz,
  pr_updated_at timestamptz,
  base_branch text,
  head_branch text,
  captured_at timestamptz not null default now(),
  unique (developer_id, repo_full_name, pr_number)
);

create index if not exists developer_open_prs_dev_recent_idx
  on team_dashboard.developer_open_prs (developer_id, pr_updated_at desc);

alter table team_dashboard.developer_open_prs enable row level security;

create policy "internal read developer_open_prs"
  on team_dashboard.developer_open_prs
  for select to authenticated
  using (team_dashboard.is_internal_user());

grant select on team_dashboard.developer_open_prs to authenticated;
grant select, insert, update, delete on team_dashboard.developer_open_prs to service_role;
