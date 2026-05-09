-- Boss as the sole Phase 1 reader
insert into team_dashboard.developers (github_handle, display_name, email)
values ('charlieutopia', 'Boss', 'aiteam.utopia@gmail.com')
on conflict (email) do nothing;

-- utopia-hub as the sole Phase 1 tracked repo
insert into team_dashboard.tracked_repos (full_name, spec_module)
values ('utopiabuilder/utopia-hub', 'utopia-hub')
on conflict (full_name) do nothing;
