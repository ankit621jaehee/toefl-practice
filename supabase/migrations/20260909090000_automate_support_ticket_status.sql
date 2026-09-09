create index if not exists support_tickets_resolved_replied_at_idx
  on public.support_tickets (replied_at)
  where status = 'resolved';

create or replace function public.close_stale_resolved_support_tickets()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  closed_count integer;
begin
  update public.support_tickets
  set
    status = 'closed',
    updated_at = now()
  where status = 'resolved'
    and replied_at is not null
    and replied_at <= now() - interval '48 hours';

  get diagnostics closed_count = row_count;
  return closed_count;
end;
$$;

revoke all on function public.close_stale_resolved_support_tickets() from public;
revoke all on function public.close_stale_resolved_support_tickets() from anon;
revoke all on function public.close_stale_resolved_support_tickets() from authenticated;
grant execute on function public.close_stale_resolved_support_tickets() to service_role;
grant execute on function public.close_stale_resolved_support_tickets() to postgres;

do $$
declare
  existing_job_id bigint;
begin
  select jobid
  into existing_job_id
  from cron.job
  where jobname = 'close-stale-resolved-support-tickets'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
end;
$$;

select cron.schedule(
  'close-stale-resolved-support-tickets',
  '* * * * *',
  $$select public.close_stale_resolved_support_tickets()$$
);

select public.close_stale_resolved_support_tickets();
