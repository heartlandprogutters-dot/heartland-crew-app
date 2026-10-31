-- Roles: Trainee, Lead Man, Approver, Admin.
-- Run this once in the Supabase SQL Editor after 20261031140000_move_pin.sql.
-- Safe to run again.
--
-- Existing crew logins become trainees. New signups default to trainee.
-- Trainee and Lead Man can post and read only their own jobs, same as crew did.
-- They are separate roles so a later feature can tell them apart in
-- public.is_field_role() and public.can_read_job() without rewriting every policy.
-- Approver and admin are unchanged: they review every job. Only admin edits roles.

create or replace function public.role_is_field(p_role text)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select p_role in ('trainee', 'lead_man');
$fn$;

create or replace function public.assert_role(p_roles text[], p_message text)
returns public.profiles
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v public.profiles;
begin
  select * into v from public.profiles where id = auth.uid();
  if not found then
    raise exception 'Sign in first.';
  end if;
  if v.disabled then
    raise exception 'This account is turned off. Ask Kent.';
  end if;
  -- Posting functions written before this file pass 'crew' for "anyone who
  -- posts." That slot means every field role (trainee and lead man).
  if v.role = any (p_roles)
     or (public.role_is_field(v.role) and 'crew' = any (p_roles)) then
    return v;
  end if;
  raise exception '%', p_message;
end;
$fn$;

create or replace function public.is_field_role()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and disabled = false
      and public.role_is_field(role)
  );
$fn$;

create or replace function public.can_post()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.is_field_role() or public.is_approver();
$fn$;

create or replace function public.can_read_job(p_created_by uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.is_approver()
    or (public.is_field_role() and p_created_by is not distinct from auth.uid());
$fn$;

-- Move people off the retired role before the check constraint changes.
update public.profiles
set role = 'trainee'
where role = 'crew';

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('trainee', 'lead_man', 'approver', 'admin'));

alter table public.profiles alter column role set default 'trainee';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_staff text := coalesce(current_setting('app.creating_staff', true), '');
  v_role text := coalesce(current_setting('app.new_user_role', true), '');
  v_name text := nullif(current_setting('app.new_user_name', true), '');
begin
  if tg_op is distinct from 'INSERT' then
    raise exception 'Not allowed.';
  end if;
  if v_name is null then
    v_name := nullif(new.raw_user_meta_data ->> 'display_name', '');
  end if;
  if v_name is null and new.email is not null then
    v_name := split_part(new.email, '@', 1);
  end if;
  if v_name is null or btrim(v_name) = '' then
    v_name := 'Crew';
  end if;
  if v_staff <> '1' or not (public.role_is_field(v_role) or v_role in ('approver', 'admin')) then
    v_role := 'trainee';
    v_staff := '';
  end if;
  insert into public.profiles (id, email, display_name, role, disabled)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    left(btrim(v_name), 60),
    v_role,
    v_staff is distinct from '1'
  )
  on conflict (id) do nothing;
  return new;
end;
$fn$;

create or replace function public.admin_set_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_caller public.profiles;
  v_current text;
  v_admins integer;
begin
  v_caller := public.assert_role(array['admin'], 'Only an admin can change roles.');
  if not (public.role_is_field(p_role) or p_role in ('approver', 'admin')) then
    raise exception 'Role must be trainee, lead man, approver, or admin.';
  end if;
  select role into v_current from public.profiles where id = p_user_id;
  if v_current is null then
    raise exception 'That person was not found.';
  end if;
  select count(*) into v_admins
  from public.profiles
  where role = 'admin' and disabled = false;
  if v_current = 'admin' and p_role <> 'admin' and v_admins <= 1 then
    raise exception 'Keep at least one admin.';
  end if;
  if p_user_id = v_caller.id and p_role <> 'admin' then
    raise exception 'You cannot change your own admin role here.';
  end if;
  update public.profiles set role = p_role where id = p_user_id;
end;
$fn$;

-- Approve and reject already require approver or admin. Replacing assert_role
-- above does not let a trainee or lead man call them.
-- Add person must accept trainee and lead man. The old function only allowed crew.

create or replace function public.admin_create_user(
  p_email text,
  p_password text,
  p_display_name text,
  p_role text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  new_id uuid := gen_random_uuid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text;
begin
  perform public.assert_role(array['admin'], 'Only an admin can add people.');
  if not (public.role_is_field(p_role) or p_role in ('approver', 'admin')) then
    raise exception 'Role must be trainee, lead man, approver, or admin.';
  end if;
  if char_length(coalesce(p_password, '')) < 8 or char_length(p_password) > 72 then
    raise exception 'Use a temporary password between 8 and 72 characters.';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a real email address.';
  end if;
  v_name := public.clean_text(p_display_name, 60);
  if v_name is null or v_name !~ '^[A-Za-z][A-Za-z .''-]{0,59}$' then
    raise exception 'Enter a first name for this person.';
  end if;
  if exists (select 1 from public.profiles where lower(email) = v_email)
     or exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'Someone already uses that email.';
  end if;

  perform set_config('app.creating_staff', '1', true);
  perform set_config('app.new_user_role', p_role, true);
  perform set_config('app.new_user_name', v_name, true);

  begin
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, email_change_confirm_status,
      phone_change, phone_change_token, reauthentication_token,
      is_sso_user, is_anonymous
    ) values (
      '00000000-0000-0000-0000-000000000000',
      new_id,
      'authenticated',
      'authenticated',
      v_email,
      extensions.crypt(p_password, extensions.gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('display_name', v_name),
      now(),
      now(),
      '', '', '', '',
      '', 0,
      '', '', '',
      false, false
    );
  exception
    when undefined_column then
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change, email_change_token_new
      ) values (
        '00000000-0000-0000-0000-000000000000',
        new_id,
        'authenticated',
        'authenticated',
        v_email,
        extensions.crypt(p_password, extensions.gen_salt('bf')),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('display_name', v_name),
        now(),
        now(),
        '', '', '', ''
      );
  end;

  begin
    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(),
      new_id,
      jsonb_build_object('sub', new_id::text, 'email', v_email),
      'email',
      new_id::text,
      now(),
      now(),
      now()
    );
  exception
    when undefined_column then
      insert into auth.identities (
        id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
      ) values (
        gen_random_uuid(),
        new_id,
        jsonb_build_object('sub', new_id::text, 'email', v_email),
        'email',
        now(),
        now(),
        now()
      );
  end;

  update public.profiles
  set role = p_role,
      display_name = v_name,
      disabled = false,
      email = v_email
  where id = new_id;

  if not found then
    raise exception 'The login was created but the profile was not. Tell a helper the database trigger is missing.';
  end if;
  return new_id;
exception
  when others then
    if sqlerrm like 'Someone already uses that email.%'
       or sqlerrm like 'Only an admin%'
       or sqlerrm like 'Enter a %'
       or sqlerrm like 'Use a temporary password%'
       or sqlerrm like 'Role must be%' then
      raise;
    end if;
    raise exception 'Could not add that login from the app. In Supabase go to Authentication, then Users, then Add user. After that, set their role on the Crew screen. (%)', sqlerrm;
end;
$fn$;

drop policy if exists jobs_select_own_or_staff on public.jobs;
create policy jobs_select_own_or_staff
  on public.jobs
  for select
  to authenticated
  using (public.can_read_job(created_by));

drop policy if exists job_photos_select_own_or_staff on public.job_photos;
create policy job_photos_select_own_or_staff
  on public.job_photos
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.jobs j
      where j.id = job_id
        and public.can_read_job(j.created_by)
    )
  );

drop policy if exists job_videos_select_own_or_staff on public.job_videos;
create policy job_videos_select_own_or_staff
  on public.job_videos
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.jobs j
      where j.id = job_id
        and public.can_read_job(j.created_by)
    )
  );

do $do$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('role_is_field', 'is_field_role', 'can_post', 'can_read_job', 'assert_role', 'handle_new_user', 'admin_set_role', 'admin_create_user')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname in ('role_is_field', 'is_field_role', 'can_post', 'can_read_job', 'assert_role', 'admin_set_role', 'admin_create_user') then
      execute format('grant execute on function %s to authenticated', r.sig);
    elsif r.proname = 'handle_new_user' then
      execute format('grant execute on function %s to authenticated, anon', r.sig);
    end if;
  end loop;
end
$do$;

notify pgrst, 'reload schema';
