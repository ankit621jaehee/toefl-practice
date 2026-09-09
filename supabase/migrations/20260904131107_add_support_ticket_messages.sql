create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  sender text not null check (sender in ('user', 'support')),
  sender_user_id uuid references auth.users(id) on delete set null,
  message text not null check (char_length(trim(message)) between 1 and 5000),
  cycle integer not null default 1 check (cycle > 0),
  created_at timestamptz not null default now()
);

create index if not exists support_ticket_messages_ticket_created_at_idx
  on public.support_ticket_messages (ticket_id, created_at asc);

alter table public.support_ticket_messages enable row level security;

revoke all on table public.support_ticket_messages from anon, authenticated;
grant select on table public.support_ticket_messages to authenticated;

drop policy if exists "Users can read messages from their own support tickets"
  on public.support_ticket_messages;
create policy "Users can read messages from their own support tickets"
  on public.support_ticket_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.support_tickets ticket
      where ticket.id = support_ticket_messages.ticket_id
        and ticket.user_id = (select auth.uid())
    )
  );

insert into public.support_ticket_messages (
  ticket_id,
  sender,
  sender_user_id,
  message,
  cycle,
  created_at
)
select
  ticket.id,
  'user',
  ticket.user_id,
  ticket.message,
  1,
  ticket.created_at
from public.support_tickets ticket
where not exists (
  select 1
  from public.support_ticket_messages existing
  where existing.ticket_id = ticket.id
    and existing.sender = 'user'
    and existing.message = ticket.message
    and existing.cycle = 1
);

insert into public.support_ticket_messages (
  ticket_id,
  sender,
  sender_user_id,
  message,
  cycle,
  created_at
)
select
  ticket.id,
  'support',
  ticket.handled_by,
  ticket.support_reply,
  ticket.cycle,
  coalesce(ticket.replied_at, ticket.updated_at)
from public.support_tickets ticket
where nullif(trim(ticket.support_reply), '') is not null
  and not exists (
    select 1
    from public.support_ticket_messages existing
    where existing.ticket_id = ticket.id
      and existing.sender = 'support'
      and existing.message = ticket.support_reply
      and existing.cycle = ticket.cycle
  );
