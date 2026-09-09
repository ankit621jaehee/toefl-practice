alter table public.profiles
  add column if not exists subscription_tier text not null default 'free',
  add column if not exists subscription_expires_at timestamptz;

alter table public.profiles
  drop constraint if exists profiles_subscription_tier_check;

alter table public.profiles
  add constraint profiles_subscription_tier_check
  check (subscription_tier in ('free', 'pro'));

-- Preserve the existing paid/review entitlements when introducing plans.
update public.profiles as profiles
set subscription_tier = 'pro'
where profiles.past_exam_access = true
   or exists (
     select 1
     from public.user_question_set_access as access
     where access.user_id = profiles.id
   );

drop policy if exists "Anyone can read published question sets"
  on public.question_sets;

create policy "Entitled users can read published question sets"
  on public.question_sets
  for select
  to authenticated
  using (
    status = 'published'
    and (
      exists (
        select 1
        from public.profiles as profiles
        where profiles.id = (select auth.uid())
          and profiles.subscription_tier = 'pro'
          and (
            profiles.subscription_expires_at is null
            or profiles.subscription_expires_at > now()
          )
      )
      or exists (
        select 1
        from public.user_question_set_access as access
        where access.user_id = (select auth.uid())
          and access.question_set_id = question_sets.id
      )
    )
  );
