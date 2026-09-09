alter table public.support_tickets
  add column if not exists support_reply text,
  add column if not exists replied_at timestamptz,
  add column if not exists handled_by uuid references auth.users(id) on delete set null;

alter table public.support_tickets
  drop constraint if exists support_tickets_support_reply_length_check;

alter table public.support_tickets
  add constraint support_tickets_support_reply_length_check
  check (support_reply is null or char_length(support_reply) <= 5000);

create index if not exists support_tickets_status_updated_at_idx
  on public.support_tickets (status, updated_at desc);
