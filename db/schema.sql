create table if not exists public.okrs (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  title text not null,
  scope text not null,
  deadline date not null,
  category text not null,
  priority text not null check (priority in ('P1', 'P2', 'P3', 'P4', 'P5')),
  notes text not null default '',
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  expected_vs_actual_days integer
);

create index if not exists okrs_user_status_priority_deadline_idx
  on public.okrs (user_id, status, priority, deadline);
