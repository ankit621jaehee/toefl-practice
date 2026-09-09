alter function public.uppercase_redeem_code()
  set search_path = '';

revoke all on function public.uppercase_redeem_code()
  from public, anon, authenticated;
grant execute on function public.uppercase_redeem_code()
  to service_role;
