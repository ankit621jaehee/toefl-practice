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
  pro_bonus_points constant integer := 25;
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
    set points = coalesce(points, 0) + code_row.points
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
        improvement_access = true,
        points = coalesce(points, 0) + pro_bonus_points
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
    case
      when code_row.reward_type = 'credits' then code_row.points
      else pro_bonus_points
    end,
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
      else pro_bonus_points
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
