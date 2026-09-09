create table if not exists public.user_learning_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  target_score numeric(2, 1) not null default 5.0
    check (
      target_score between 1.0 and 6.0
      and target_score * 2 = trunc(target_score * 2)
    ),
  exam_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_learning_profiles enable row level security;

drop policy if exists "Users can read their own learning profile"
  on public.user_learning_profiles;
create policy "Users can read their own learning profile"
  on public.user_learning_profiles
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own learning profile"
  on public.user_learning_profiles;
create policy "Users can create their own learning profile"
  on public.user_learning_profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own learning profile"
  on public.user_learning_profiles;
create policy "Users can update their own learning profile"
  on public.user_learning_profiles
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update on public.user_learning_profiles to authenticated;
revoke all on public.user_learning_profiles from anon;

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reply_email text not null,
  message text not null check (char_length(trim(message)) between 1 and 5000),
  status text not null default 'sent'
    check (status in ('sent', 'processing', 'resolved', 'closed')),
  cycle integer not null default 1 check (cycle > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_tickets_user_created_at_idx
  on public.support_tickets (user_id, created_at desc);

alter table public.support_tickets enable row level security;

drop policy if exists "Users can read their own support tickets"
  on public.support_tickets;
create policy "Users can read their own support tickets"
  on public.support_tickets
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own support tickets"
  on public.support_tickets;
create policy "Users can create their own support tickets"
  on public.support_tickets
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and status = 'sent'
    and cycle = 1
  );

grant select, insert on public.support_tickets to authenticated;
revoke all on public.support_tickets from anon;

drop policy if exists "Users can read their own redemption history"
  on public.redeem_logs;
create policy "Users can read their own redemption history"
  on public.redeem_logs
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

grant select on public.redeem_logs to authenticated;

create or replace function public.charge_and_save_practice_record(
  target_user_id uuid,
  target_practice_type text,
  target_prompt jsonb,
  target_answer text,
  target_feedback jsonb,
  target_score text,
  point_cost integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  balance_result jsonb;
  saved_record_id uuid;
begin
  if target_practice_type not in ('email', 'discussion') then
    raise exception using errcode = '22023', message = 'INVALID_PRACTICE_TYPE';
  end if;

  if point_cost <= 0 then
    raise exception using errcode = '22023', message = 'INVALID_POINT_COST';
  end if;

  balance_result := public.charge_profile_credits(target_user_id, point_cost);

  insert into public.practice_records (
    user_id,
    practice_type,
    prompt,
    answer,
    feedback,
    score,
    points_spent
  )
  values (
    target_user_id,
    target_practice_type,
    target_prompt,
    target_answer,
    target_feedback,
    target_score,
    point_cost
  )
  returning id into saved_record_id;

  return balance_result || jsonb_build_object('recordId', saved_record_id);
end;
$function$;

revoke all on function public.charge_and_save_practice_record(
  uuid,
  text,
  jsonb,
  text,
  jsonb,
  text,
  integer
) from public, anon, authenticated;

grant execute on function public.charge_and_save_practice_record(
  uuid,
  text,
  jsonb,
  text,
  jsonb,
  text,
  integer
) to service_role;
