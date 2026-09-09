alter table public.support_tickets
  add column if not exists expires_at timestamptz;

update public.support_tickets
set expires_at = updated_at + interval '1 month'
where expires_at is null;

alter table public.support_tickets
  alter column expires_at set default (now() + interval '1 month'),
  alter column expires_at set not null;

create index if not exists support_tickets_expires_at_idx
  on public.support_tickets (expires_at);

create or replace function public.refresh_support_ticket_expiry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.expires_at := new.updated_at + interval '1 month';
  return new;
end;
$$;

drop trigger if exists refresh_support_ticket_expiry
  on public.support_tickets;
create trigger refresh_support_ticket_expiry
before insert or update of updated_at
on public.support_tickets
for each row
execute function public.refresh_support_ticket_expiry();

drop policy if exists "Users can read their own support tickets"
  on public.support_tickets;
create policy "Users can read their own support tickets"
  on public.support_tickets
  for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    and expires_at > now()
  );

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'purge-expired-support-tickets',
  '17 3 * * *',
  $$delete from public.support_tickets where expires_at <= now()$$
);
