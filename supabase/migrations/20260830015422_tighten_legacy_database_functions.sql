alter function public.set_daily_writing_articles_updated_at()
  set search_path = '';

-- Redemption now goes through /api/redeem-code, which authenticates the
-- request and invokes the service-role-only redeem_code_for_user RPC.
-- Keep the legacy wrapper unavailable through the public Data API.
revoke all on function public.redeem_code(text) from public, anon, authenticated;
grant execute on function public.redeem_code(text) to service_role;
