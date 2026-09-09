create index if not exists redeem_codes_allowed_user_id_idx
  on public.redeem_codes (allowed_user_id)
  where allowed_user_id is not null;

create index if not exists redeem_logs_code_id_idx
  on public.redeem_logs (code_id);
