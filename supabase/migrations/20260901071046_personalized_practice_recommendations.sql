create table public.personalized_practice_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_type text not null check (task_type in ('email', 'discussion')),
  topic text not null,
  source text not null check (source in ('past_exam', 'ai_generated')),
  question_set_id uuid references public.question_sets(id) on delete set null,
  question_key text,
  recommended_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index personalized_practice_user_recent_idx
  on public.personalized_practice_recommendations (user_id, recommended_at desc);

create index personalized_practice_user_topic_idx
  on public.personalized_practice_recommendations
  (user_id, task_type, topic, recommended_at desc);

create index personalized_practice_question_idx
  on public.personalized_practice_recommendations (user_id, question_set_id, question_key)
  where question_set_id is not null;

alter table public.personalized_practice_recommendations enable row level security;

create policy "Users can read their personalized recommendations"
  on public.personalized_practice_recommendations
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.personalized_practice_recommendations from anon;
revoke insert, update, delete on table public.personalized_practice_recommendations from authenticated;
grant select on table public.personalized_practice_recommendations to authenticated;
