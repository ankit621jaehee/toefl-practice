with pending_pro_bonuses as (
  select
    user_id,
    count(*)::integer as redemption_count
  from public.redeem_logs
  where reward_type = 'pro'
    and coalesce(points_added, 0) = 0
  group by user_id
)
update public.profiles as profiles
set points = coalesce(profiles.points, 0) + pending.redemption_count * 25
from pending_pro_bonuses as pending
where profiles.id = pending.user_id;

update public.redeem_logs
set points_added = 25
where reward_type = 'pro'
  and coalesce(points_added, 0) = 0;
