create table public.practice_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_session_id text not null,
  practice_type text not null
    check (practice_type in ('sentence', 'email', 'discussion', 'mock')),
  duration_seconds integer not null default 0
    check (duration_seconds >= 0),
  score text,
  status text not null default 'completed'
    check (status in ('completed', 'ungraded', 'abandoned')),
  source_type text not null default 'forge_ai',
  started_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (user_id, client_session_id)
);

create index practice_sessions_user_started_at_idx
  on public.practice_sessions (user_id, started_at desc);

alter table public.practice_sessions enable row level security;

grant select, insert, update on table public.practice_sessions to authenticated;
revoke all on table public.practice_sessions from anon;

create policy "Users can read their own practice sessions"
  on public.practice_sessions
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own practice sessions"
  on public.practice_sessions
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own practice sessions"
  on public.practice_sessions
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
