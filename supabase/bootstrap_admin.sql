-- Run this once, after you add Kent in Authentication → Users.
-- Change the email to the one you used. Then run the whole file.
-- Kent can sign in after this. He adds Haley and the crew inside the app.

insert into public.profiles (id, email, display_name, role, disabled)
select id, lower(email), 'Kent', 'admin', false
from auth.users
where lower(email) = lower('kent@example.com')
on conflict (id) do update
set role = 'admin',
    display_name = 'Kent',
    disabled = false;

select id, email, display_name, role, disabled
from public.profiles
where lower(email) = lower('kent@example.com');
