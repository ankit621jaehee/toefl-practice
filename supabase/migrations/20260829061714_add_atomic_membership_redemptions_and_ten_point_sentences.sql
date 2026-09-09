alter table public.redeem_codes
  add column if not exists reward_type text not null default 'credits',
  add column if not exists pro_days integer;

alter table public.redeem_codes
  drop constraint if exists redeem_codes_reward_type_check,
  drop constraint if exists redeem_codes_reward_payload_check;

alter table public.redeem_codes
  add constraint redeem_codes_reward_type_check
    check (reward_type in ('credits', 'pro')),
  add constraint redeem_codes_reward_payload_check
    check (
      (reward_type = 'credits' and points > 0 and pro_days is null)
      or (reward_type = 'pro' and points = 0 and pro_days > 0)
    );

alter table public.redeem_logs
  add column if not exists reward_type text not null default 'credits',
  add column if not exists pro_days integer,
  add column if not exists subscription_expires_at timestamptz;

alter table public.redeem_logs
  drop constraint if exists redeem_logs_reward_type_check;

alter table public.redeem_logs
  add constraint redeem_logs_reward_type_check
    check (reward_type in ('credits', 'pro'));

create or replace function public.redeem_code_for_user(
  target_user_id uuid,
  raw_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  code_row public.redeem_codes%rowtype;
  profile_row public.profiles%rowtype;
  next_expiry timestamptz;
  balance_result jsonb;
begin
  if target_user_id is null then
    raise exception using errcode = '22023', message = 'INVALID_USER';
  end if;

  if nullif(trim(raw_code), '') is null then
    raise exception using errcode = '22023', message = 'EMPTY_CODE';
  end if;

  select *
    into code_row
  from public.redeem_codes
  where code = upper(trim(raw_code))
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'INVALID_CODE';
  end if;

  if not code_row.is_active then
    raise exception using errcode = 'P0001', message = 'INACTIVE_CODE';
  end if;

  if code_row.expires_at is not null and code_row.expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'EXPIRED_CODE';
  end if;

  if code_row.used_count >= code_row.max_uses then
    raise exception using errcode = 'P0001', message = 'CODE_LIMIT_REACHED';
  end if;

  if exists (
    select 1
    from public.redeem_logs logs
    where logs.user_id = target_user_id
      and logs.code_id = code_row.id
  ) then
    raise exception using errcode = 'P0001', message = 'CODE_ALREADY_REDEEMED';
  end if;

  select *
    into profile_row
  from public.profiles
  where id = target_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'PROFILE_NOT_FOUND';
  end if;

  if code_row.reward_type = 'credits' then
    update public.profiles
    set points = points + code_row.points
    where id = target_user_id;
  else
    next_expiry := greatest(
      now(),
      coalesce(profile_row.subscription_expires_at, now())
    ) + make_interval(days => code_row.pro_days);

    update public.profiles
    set subscription_tier = 'pro',
        subscription_expires_at = next_expiry,
        past_exam_access = true,
        improvement_access = true
    where id = target_user_id;
  end if;

  insert into public.redeem_logs (
    user_id,
    code_id,
    points_added,
    reward_type,
    pro_days,
    subscription_expires_at
  )
  values (
    target_user_id,
    code_row.id,
    case when code_row.reward_type = 'credits' then code_row.points else 0 end,
    code_row.reward_type,
    code_row.pro_days,
    next_expiry
  );

  update public.redeem_codes
  set used_count = used_count + 1,
      is_active = case
        when used_count + 1 >= max_uses then false
        else is_active
      end
  where id = code_row.id;

  balance_result := public.get_profile_credit_balance(target_user_id);

  return balance_result || jsonb_build_object(
    'success', true,
    'rewardType', code_row.reward_type,
    'creditsAdded', case
      when code_row.reward_type = 'credits' then code_row.points
      else 0
    end,
    'proDays', coalesce(code_row.pro_days, 0),
    'subscriptionTier', case
      when code_row.reward_type = 'pro' then 'pro'
      else profile_row.subscription_tier
    end,
    'subscriptionExpiresAt', next_expiry
  );
end;
$function$;

revoke all on function public.redeem_code_for_user(uuid, text)
  from public, anon, authenticated;
grant execute on function public.redeem_code_for_user(uuid, text)
  to service_role;

-- Start the paid-code launch from a clean membership state without changing
-- any permanent or temporary credit balances.
update public.profiles
set subscription_tier = 'free',
    subscription_expires_at = null,
    past_exam_access = false,
    improvement_access = false;

drop policy if exists "Entitled users can read published question sets"
  on public.question_sets;

create policy "Active Pro users can read published question sets"
  on public.question_sets
  for select
  to authenticated
  using (
    status = 'published'
    and exists (
      select 1
      from public.profiles as profiles
      where profiles.id = (select auth.uid())
        and profiles.subscription_tier = 'pro'
        and (
          profiles.subscription_expires_at is null
          or profiles.subscription_expires_at > now()
        )
    )
  );

-- All stored sentence scores predate the ten-point scale and were calculated
-- out of five. Convert them once so old records and new attempts are comparable.
update public.mock_records
set sentence_score = least(10, sentence_score * 2),
    final_score = case
      when email_score = 'Not graded' and discussion_score = 'Not graded'
        then least(10, final_score * 2)
      else final_score
    end
where jsonb_typeof(sentence_questions) = 'array'
  and jsonb_array_length(sentence_questions) > 0;

update public.question_attempts
set result = jsonb_set(
  result,
  '{sentenceScore}',
  to_jsonb(least(10, ((result ->> 'sentenceScore')::numeric * 2)))
)
where result ? 'sentenceScore'
  and (result ->> 'sentenceScore') ~ '^[0-9]+(\.[0-9]+)?$';

update public.question_attempts as attempts
set score = least(10, attempts.score * 2),
    result = jsonb_set(
      attempts.result,
      '{finalScore}',
      to_jsonb(least(10, ((attempts.result ->> 'finalScore')::numeric * 2)))
    )
where attempts.result ? 'recordId'
  and (attempts.result ->> 'recordId') ~* '^[0-9a-f-]{36}$'
  and (attempts.result ->> 'finalScore') ~ '^[0-9]+(\.[0-9]+)?$'
  and exists (
    select 1
    from public.mock_records as records
    where records.id = (attempts.result ->> 'recordId')::uuid
      and records.email_score = 'Not graded'
      and records.discussion_score = 'Not graded'
  );
