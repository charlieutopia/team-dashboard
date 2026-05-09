-- Phase 1 seed: Boss as sole reader + utopia-hub as sole tracked repo
-- Per ADR 011 (daily push policy) + ADR 005 (Boss-owned single-reader Phase 1)

insert into team_dashboard.developers (github_handle, display_name, email)
values ('charlieutopia', 'Boss', 'aiteam.utopia@gmail.com')
on conflict (email) do nothing;

insert into team_dashboard.tracked_repos (full_name, spec_module)
values ('utopiabuilder/utopia-hub', 'utopia-hub')
on conflict (full_name) do nothing;
