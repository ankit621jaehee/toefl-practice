create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'system'
    check (kind in ('system', 'support_reply', 'admin_broadcast')),
  title text not null check (char_length(trim(title)) between 1 and 120),
  message text not null check (char_length(trim(message)) between 1 and 5000),
  destination text,
  source_type text,
  source_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, source_type, source_id)
);

create index if not exists user_notifications_user_created_at_idx
  on public.user_notifications (user_id, created_at desc);

create index if not exists user_notifications_user_unread_idx
  on public.user_notifications (user_id, created_at desc)
  where read_at is null;

alter table public.user_notifications enable row level security;

revoke all on table public.user_notifications from anon, authenticated;
grant select on table public.user_notifications to authenticated;
grant update (read_at) on table public.user_notifications to authenticated;

create policy "Users can read their own notifications"
  on public.user_notifications
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can mark their own notifications as read"
  on public.user_notifications
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.create_support_reply_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ticket_user_id uuid;
begin
  if new.sender <> 'support' then
    return new;
  end if;

  select ticket.user_id
  into ticket_user_id
  from public.support_tickets as ticket
  where ticket.id = new.ticket_id;

  if ticket_user_id is null then
    return new;
  end if;

  insert into public.user_notifications (
    user_id,
    kind,
    title,
    message,
    destination,
    source_type,
    source_id,
    created_at
  )
  values (
    ticket_user_id,
    'support_reply',
    '客服回复了你的工单',
    new.message,
    'help',
    'support_ticket_message',
    new.id,
    new.created_at
  )
  on conflict (user_id, source_type, source_id) do nothing;

  return new;
end;
$$;

revoke all on function public.create_support_reply_notification() from public;
revoke all on function public.create_support_reply_notification() from anon;
revoke all on function public.create_support_reply_notification() from authenticated;

drop trigger if exists create_support_reply_notification
  on public.support_ticket_messages;
create trigger create_support_reply_notification
after insert on public.support_ticket_messages
for each row
execute function public.create_support_reply_notification();

alter publication supabase_realtime add table public.user_notifications;
