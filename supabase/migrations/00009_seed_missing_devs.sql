-- Phase 2.A Step 5 — seed developers from utopiaspace contributor list
-- Source: gh api repos/utopiabuilder/utopiaspace/contributors --paginate (run 2026-05-10)
-- Excluded: github-actions[bot], devteam-utopia (bot-style names)
-- display_name + email use placeholder values; Boss should update via the dashboard
-- once the team confirms preferred display names + work emails.

insert into team_dashboard.developers (github_handle, display_name, email)
values
  ('naznajmuddin', 'Naz Najmuddin', 'naznajmuddin@utopia.placeholder'),
  ('rjnraliesa', 'RJ Raliesa', 'rjnraliesa@utopia.placeholder'),
  ('bvkhari', 'BV Khari', 'bvkhari@utopia.placeholder'),
  ('hilmiishak', 'Hilmi Ishak', 'hilmiishak@utopia.placeholder'),
  ('luqiemanhakim', 'Luqie Man Hakim', 'luqiemanhakim@utopia.placeholder'),
  ('nuraddlynn', 'Nur Addlynn', 'nuraddlynn@utopia.placeholder')
on conflict (github_handle) do nothing;
