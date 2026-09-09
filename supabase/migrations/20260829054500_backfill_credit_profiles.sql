insert into public.profiles (id, email, points)
select users.id, users.email, 0
from auth.users as users
left join public.profiles as profiles on profiles.id = users.id
where profiles.id is null
on conflict (id) do nothing;

-- This function is invoked only by the auth.users trigger. It should not be
-- callable through the exposed RPC API.
revoke execute on function public.handle_new_user()
  from public, anon, authenticated;
