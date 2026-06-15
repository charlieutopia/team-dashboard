-- Phase 1: intern / freelancer end dates.
-- When end_date passes, the person is treated as inactive (Charlie 2026-06-15:
-- "Ended 之后就是 inactive 了"). The active=false flip happens (a) at edit time
-- in updateEndDate when the date is already past, and (b) daily in the scanner
-- for dates that pass over time. Covered by the existing UPDATE grant + RLS.
alter table team_dashboard.developers
  add column if not exists end_date date;
