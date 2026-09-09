alter table public.practice_sessions
  add column if not exists prompt jsonb,
  add column if not exists answer text;

drop function if exists public.charge_and_save_practice_record(
  uuid,
  text,
  jsonb,
  text,
  jsonb,
  text,
  integer
);

create or replace function public.charge_and_save_practice_record(
  target_user_id uuid,
  target_practice_type text,
  target_prompt jsonb,
  target_answer text,
  target_feedback jsonb,
  target_score text,
  point_cost integer,
  target_session_id text default null
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

  if target_session_id is not null then
    update public.practice_sessions
    set
      score = target_score,
      status = 'completed'
    where user_id = target_user_id
      and client_session_id = target_session_id
      and status = 'ungraded';
  end if;

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
  integer,
  text
) from public, anon, authenticated;

grant execute on function public.charge_and_save_practice_record(
  uuid,
  text,
  jsonb,
  text,
  jsonb,
  text,
  integer,
  text
) to service_role;
