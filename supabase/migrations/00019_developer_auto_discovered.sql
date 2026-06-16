-- Step 4 org-wide scan: flag contributors the scanner auto-discovers across the
-- whole utopiabuilder org (vs the originally-seeded utopiaspace contributors),
-- so the admin UI can highlight unreviewed people whose level/email aren't set.
alter table team_dashboard.developers
  add column if not exists auto_discovered boolean not null default false;
