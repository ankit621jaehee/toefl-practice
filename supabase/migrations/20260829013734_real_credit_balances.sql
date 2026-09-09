create table if not exists public.user_temporary_credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null check (amount > 0),
  remaining integer not null check (remaining >= 0 and remaining <= amount),
  source text not null,
  source_key text not null,
  expires_at date not null,
  created_at timestamptz not null default now(),
  unique (user_id, source, source_key)
);

create index if not exists user_temporary_credits_spend_order_idx
  on public.user_temporary_credits (user_id, expires_at, created_at)
  where remaining > 0;

alter table public.user_temporary_credits enable row level security;

create policy "Users can read their own temporary credits"
  on public.user_temporary_credits
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.user_check_ins (
  user_id uuid not null references auth.users(id) on delete cascade,
  check_in_date date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, check_in_date)
);

alter table public.user_check_ins enable row level security;

create policy "Users can read their own check-ins"
  on public.user_check_ins
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.user_credit_milestones (
  user_id uuid not null references auth.users(id) on delete cascade,
  milestone_days integer not null check (milestone_days in (7, 14, 21, 28)),
  points_awarded integer not null check (points_awarded > 0),
  claimed_at timestamptz not null default now(),
  primary key (user_id, milestone_days)
);

alter table public.user_credit_milestones enable row level security;

create policy "Users can read their own credit milestones"
  on public.user_credit_milestones
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

grant select on public.user_temporary_credits to authenticated;
grant select on public.user_check_ins to authenticated;
grant select on public.user_credit_milestones to authenticated;
grant select, insert, update, delete on public.user_temporary_credits to service_role;
grant select, insert, update, delete on public.user_check_ins to service_role;
grant select, insert, update, delete on public.user_credit_milestones to service_role;

create or replace function public.get_profile_credit_balance(target_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  permanent_balance integer;
  temporary_balance integer;
  check_in_dates jsonb;
  claimed_milestones jsonb;
begin
  select greatest(coalesce(p.points, 0), 0)
    into permanent_balance
  from public.profiles p
  where p.id = target_user_id;

  if permanent_balance is null then
    raise exception using errcode = 'P0001', message = 'PROFILE_NOT_FOUND';
  end if;

  select coalesce(sum(c.remaining), 0)::integer
    into temporary_balance
  from public.user_temporary_credits c
  where c.user_id = target_user_id
    and c.remaining > 0
    and c.expires_at >= current_date;

  select coalesce(
    jsonb_agg(to_char(i.check_in_date, 'YYYY-MM-DD') order by i.check_in_date),
    '[]'::jsonb
  )
    into check_in_dates
  from public.user_check_ins i
  where i.user_id = target_user_id;

  select coalesce(
    jsonb_agg(m.milestone_days order by m.milestone_days),
    '[]'::jsonb
  )
    into claimed_milestones
  from public.user_credit_milestones m
  where m.user_id = target_user_id;

  return jsonb_build_object(
    'temporaryBalance', temporary_balance,
    'permanentBalance', permanent_balance,
    'balance', temporary_balance + permanent_balance,
    'checkInDates', check_in_dates,
    'claimedMilestones', claimed_milestones
  );
end;
$$;

create or replace function public.charge_profile_credits(
  target_user_id uuid,
  point_cost integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  permanent_balance integer;
  temporary_balance integer;
  available_balance integer;
  remaining_cost integer;
  amount_to_use integer;
  credit_row record;
begin
  if point_cost <= 0 then
    raise exception using errcode = '22023', message = 'INVALID_POINT_COST';
  end if;

  select greatest(coalesce(p.points, 0), 0)
    into permanent_balance
  from public.profiles p
  where p.id = target_user_id
  for update;

  if permanent_balance is null then
    raise exception using errcode = 'P0001', message = 'PROFILE_NOT_FOUND';
  end if;

  select coalesce(sum(c.remaining), 0)::integer
    into temporary_balance
  from public.user_temporary_credits c
  where c.user_id = target_user_id
    and c.remaining > 0
    and c.expires_at >= current_date;

  available_balance := temporary_balance + permanent_balance;
  if available_balance < point_cost then
    raise exception using errcode = 'P0001', message = 'INSUFFICIENT_CREDITS';
  end if;

  remaining_cost := point_cost;

  for credit_row in
    select c.id, c.remaining
    from public.user_temporary_credits c
    where c.user_id = target_user_id
      and c.remaining > 0
      and c.expires_at >= current_date
    order by c.expires_at, c.created_at, c.id
    for update
  loop
    exit when remaining_cost = 0;
    amount_to_use := least(credit_row.remaining, remaining_cost);

    update public.user_temporary_credits
    set remaining = remaining - amount_to_use
    where id = credit_row.id;

    remaining_cost := remaining_cost - amount_to_use;
  end loop;

  if remaining_cost > 0 then
    update public.profiles
    set points = points - remaining_cost
    where id = target_user_id;
  end if;

  return public.get_profile_credit_balance(target_user_id);
end;
$$;

create or replace function public.claim_daily_credit(target_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted_count integer;
  check_in_inserted boolean := false;
  streak integer := 0;
  milestone integer;
  milestone_bonus integer;
  balance_result jsonb;
begin
  perform 1
  from public.profiles p
  where p.id = target_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'PROFILE_NOT_FOUND';
  end if;

  insert into public.user_check_ins (user_id, check_in_date)
  values (target_user_id, current_date)
  on conflict (user_id, check_in_date) do nothing;
  get diagnostics inserted_count = row_count;
  check_in_inserted := inserted_count = 1;

  if check_in_inserted then
    insert into public.user_temporary_credits (
      user_id,
      amount,
      remaining,
      source,
      source_key,
      expires_at
    )
    values (
      target_user_id,
      1,
      1,
      'daily_check_in',
      to_char(current_date, 'YYYY-MM-DD'),
      current_date + 30
    )
    on conflict (user_id, source, source_key) do nothing;
  end if;

  loop
    exit when streak >= 365;
    exit when not exists (
      select 1
      from public.user_check_ins i
      where i.user_id = target_user_id
        and i.check_in_date = current_date - streak
    );
    streak := streak + 1;
  end loop;

  if check_in_inserted then
    foreach milestone in array array[7, 14, 21, 28]
    loop
      if streak >= milestone then
        milestone_bonus := case milestone
          when 7 then 2
          when 14 then 4
          when 21 then 6
          when 28 then 8
        end;

        insert into public.user_credit_milestones (
          user_id,
          milestone_days,
          points_awarded
        )
        values (target_user_id, milestone, milestone_bonus)
        on conflict (user_id, milestone_days) do nothing;
        get diagnostics inserted_count = row_count;

        if inserted_count = 1 then
          update public.profiles
          set points = points + milestone_bonus
          where id = target_user_id;
        end if;
      end if;
    end loop;
  end if;

  balance_result := public.get_profile_credit_balance(target_user_id);
  return balance_result || jsonb_build_object(
    'checkedIn', true,
    'alreadyCheckedIn', not check_in_inserted,
    'streak', streak
  );
end;
$$;

revoke execute on function public.get_profile_credit_balance(uuid)
  from public, anon, authenticated;
revoke execute on function public.charge_profile_credits(uuid, integer)
  from public, anon, authenticated;
revoke execute on function public.claim_daily_credit(uuid)
  from public, anon, authenticated;

grant execute on function public.get_profile_credit_balance(uuid) to service_role;
grant execute on function public.charge_profile_credits(uuid, integer) to service_role;
grant execute on function public.claim_daily_credit(uuid) to service_role;
