create schema if not exists team_dashboard;

create table team_dashboard.developers (
  id uuid primary key default gen_random_uuid(),
  github_handle text not null unique,
  display_name text not null,
  email text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table team_dashboard.tracked_repos (
  id uuid primary key default gen_random_uuid(),
  full_name text not null unique,
  spec_module text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table team_dashboard.spec_assignments (
  id uuid primary key default gen_random_uuid(),
  developer_id uuid not null references team_dashboard.developers(id) on delete cascade,
  repo_id uuid not null references team_dashboard.tracked_repos(id) on delete cascade,
  spec_item_path text not null,
  assigned_at timestamptz not null default now(),
  unique (developer_id, repo_id, spec_item_path)
);
