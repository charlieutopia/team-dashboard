create table team_dashboard.batch_jobs (
  id uuid primary key default gen_random_uuid(),
  job_date date not null unique,
  openai_batch_id text not null,
  submitted_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null check (status in ('submitted', 'in_progress', 'completed', 'failed', 'cancelled')),
  error_message text
);
