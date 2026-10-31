-- Heartland Crew database.
-- Run this once in the Supabase SQL Editor (the whole file).
-- It is safe to run again: it updates functions and rules without deleting jobs.
--
-- Crew can add jobs and read only their own.
-- Approvers can read every job, including the exact house location.
-- The public website can read approved jobs only, and only the shifted pin.
-- Exact latitude, longitude, and street address live in job_locations.
-- Nothing in this file grants the public website access to that table.

create schema if not exists extensions;

do $ext$
begin
  begin
    create extension if not exists pgcrypto with schema extensions;
  exception
    when others then
      if exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'extensions'
          and p.proname = 'crypt'
      ) then
        null;
      else
        raise;
      end if;
  end;
end
$ext$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null,
  role text not null default 'trainee',
  disabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_role_check check (role in ('trainee', 'lead_man', 'approver', 'admin')),
  constraint profiles_email_unique unique (email)
);

create table if not exists public.jobs (
  id text primary key default gen_random_uuid()::text,
  created_by uuid references public.profiles (id) on delete set null,
  status text not null default 'pending',
  service text not null,
  town text not null,
  state text not null,
  title text not null,
  summary text not null,
  job_date date not null,
  public_lat double precision,
  public_lng double precision,
  review_name text,
  review_stars integer,
  review_text text,
  review_date date,
  gbp_url text,
  rejection_reason text,
  source text not null default 'app',
  approved_at timestamptz,
  approved_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobs_status_check check (status in ('pending', 'approved', 'rejected')),
  constraint jobs_source_check check (source in ('app', 'import')),
  constraint jobs_state_check check (state ~ '^[A-Z]{2}$'),
  constraint jobs_stars_check check (review_stars is null or review_stars between 1 and 5),
  constraint jobs_pending_has_no_pin check (
    status <> 'pending' or (public_lat is null and public_lng is null)
  ),
  constraint jobs_approved_has_pin check (
    status <> 'approved' or (public_lat is not null and public_lng is not null)
  ),
  constraint jobs_pin_pair check (
    (public_lat is null and public_lng is null)
    or (public_lat is not null and public_lng is not null)
  ),
  constraint jobs_summary_check check (
    char_length(summary) between 8 and 200
    and position(chr(10) in summary) = 0
    and position(chr(13) in summary) = 0
    and position(chr(92) in summary) = 0
    and position('@' in summary) = 0
    and summary !~* 'https?://'
    and summary !~ '[0-9]{3}[^0-9]{0,2}[0-9]{3}[^0-9]{0,2}[0-9]{4}'
  ),
  constraint jobs_title_check check (
    char_length(title) between 8 and 120
    and position(chr(10) in title) = 0
    and position(chr(13) in title) = 0
    and position(chr(92) in title) = 0
    and position('@' in title) = 0
    and title !~* 'https?://'
  ),
  constraint jobs_review_name_check check (
    review_name is null
    or review_name ~ '^[A-Z][a-z]+(-[A-Z][a-z]+)?( [A-Z]\.)?$'
  ),
  constraint jobs_review_text_check check (
    review_text is null or (
      char_length(review_text) between 2 and 400
      and position('@' in review_text) = 0
      and review_text !~* 'https?://'
    )
  ),
  constraint jobs_review_complete check (
    (
      review_name is null
      and review_stars is null
      and review_text is null
      and review_date is null
    )
    or (
      review_name is not null
      and review_stars is not null
      and review_text is not null
      and review_date is not null
    )
  ),
  constraint jobs_gbp_check check (
    gbp_url is null
    or (
      gbp_url ~ '^https://'
      and char_length(gbp_url) <= 400
      and position('@' in gbp_url) = 0
    )
  )
);

create table if not exists public.job_locations (
  job_id text primary key references public.jobs (id) on delete cascade,
  exact_lat double precision not null,
  exact_lng double precision not null,
  address text,
  created_at timestamptz not null default now(),
  constraint job_locations_range check (
    exact_lat between 24 and 50
    and exact_lng between -125 and -66
  ),
  constraint job_locations_address_len check (address is null or char_length(address) <= 180)
);

create table if not exists public.job_photos (
  id uuid primary key default gen_random_uuid(),
  job_id text not null references public.jobs (id) on delete cascade,
  storage_path text not null,
  public_url text,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  constraint job_photos_order_unique unique (job_id, sort_order) deferrable initially deferred,
  constraint job_photos_sort_check check (sort_order >= 0 and sort_order < 20),
  constraint job_photos_path_len check (char_length(storage_path) between 3 and 300)
);

create index if not exists jobs_created_by_idx on public.jobs (created_by);
create index if not exists jobs_status_approved_idx on public.jobs (status, approved_at desc);
create index if not exists job_photos_job_idx on public.job_photos (job_id, sort_order);

create or replace function public.clean_text(p_value text, p_max integer)
returns text
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v text;
begin
  if p_value is null then
    return null;
  end if;
  v := replace(p_value, '"', '''');
  v := replace(v, chr(92), '');
  v := regexp_replace(v, '[[:space:]]+', ' ', 'g');
  v := btrim(v);
  if p_max is not null and char_length(v) > p_max then
    v := rtrim(left(v, p_max));
  end if;
  return nullif(v, '');
end;
$fn$;

create or replace function public.assert_no_contact(p_value text)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if p_value is null then
    return;
  end if;
  if p_value ~ '[0-9]{3}[^0-9]{0,2}[0-9]{3}[^0-9]{0,2}[0-9]{4}' then
    raise exception 'Take the phone number out. It would show on the public map.';
  end if;
  if position('@' in p_value) > 0 then
    raise exception 'Take the email address out. It would show on the public map.';
  end if;
  if p_value ~* 'https?://' then
    raise exception 'Take the link out. Links can hide an address.';
  end if;
end;
$fn$;

-- Trainee and Lead Man are the field roles. They match today.
-- A later feature (clock in/out, or a lead seeing a trainee's jobs) should
-- branch here or in can_read_job(), not in every policy.
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
  -- Older functions still pass 'crew' for "anyone who posts." That slot
  -- means every field role.
  if v.role = any (p_roles)
     or (public.role_is_field(v.role) and 'crew' = any (p_roles)) then
    return v;
  end if;
  raise exception '%', p_message;
end;
$fn$;

create or replace function public.is_active()
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
  );
$fn$;

create or replace function public.is_approver()
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
      and role in ('approver', 'admin')
  );
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

-- Posting is the same for every field role and for approvers today.
create or replace function public.can_post()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.is_field_role() or public.is_approver();
$fn$;

-- Field roles read their own jobs. Approvers read every job.
-- Give a lead man a wider view later by editing only this function.
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

create or replace function public.clean_review(
  p_name text,
  p_stars integer,
  p_text text,
  p_date date
)
returns json
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_name text;
  v_text text;
begin
  if nullif(btrim(coalesce(p_name, '')), '') is null
     and p_stars is null
     and nullif(btrim(coalesce(p_text, '')), '') is null
     and p_date is null then
    return null;
  end if;
  v_name := public.clean_text(p_name, 40);
  v_text := public.clean_text(p_text, 400);
  if v_name is null or v_name !~ '^[A-Z][a-z]+(-[A-Z][a-z]+)?( [A-Z]\.)?$' then
    raise exception 'Review name must be a first name and last initial, like Mike L.';
  end if;
  if p_stars is null or p_stars < 1 or p_stars > 5 then
    raise exception 'Choose 1 to 5 stars for the review.';
  end if;
  if v_text is null or char_length(v_text) < 2 then
    raise exception 'Write a short review sentence.';
  end if;
  perform public.assert_no_contact(v_text);
  if p_date is null or p_date < date '2015-01-01' or p_date > current_date + 1 then
    raise exception 'Check the review date.';
  end if;
  return json_build_object(
    'name', v_name,
    'stars', p_stars,
    'text', v_text,
    'date', to_char(p_date, 'YYYY-MM-DD')
  );
end;
$fn$;

create or replace function public.assert_public_photo_url(p_url text)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
begin
  if p_url is null
     or p_url !~ '^https://[A-Za-z0-9.-]+/storage/v1/object/public/job-photos/[a-z0-9.-]+\.webp$'
     or position('..' in p_url) > 0
     or position('@' in p_url) > 0 then
    raise exception 'Photo link must be a public WebP file in job storage.';
  end if;
  return p_url;
end;
$fn$;

create or replace function public.prepare_copy(
  p_service text,
  p_town text,
  p_state text,
  p_summary text,
  p_title text
)
returns json
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_service text;
  v_town text;
  v_state text;
  v_summary text;
  v_title text;
begin
  v_service := public.clean_text(p_service, 60);
  v_town := public.clean_text(p_town, 40);
  v_state := upper(btrim(coalesce(p_state, '')));
  v_summary := public.clean_text(p_summary, 200);
  if v_service is null or v_service !~ '^[A-Za-z0-9 /&-]{2,60}$' then
    raise exception 'Choose a service from the list.';
  end if;
  if v_town is null or v_town ~ '[0-9,]' or char_length(v_town) < 2 then
    raise exception 'Enter the town only, without a house number.';
  end if;
  if v_state !~ '^[A-Z]{2}$' then
    raise exception 'Use a two-letter state, like KY.';
  end if;
  if v_summary is null or char_length(v_summary) < 8 then
    raise exception 'Write a short note about the job (at least a few words).';
  end if;
  perform public.assert_no_contact(v_summary);
  v_title := public.clean_text(p_title, 120);
  if v_title is null then
    v_title := public.clean_text(v_service || ' in ' || v_town || ', ' || v_state, 120);
  end if;
  if v_title is null or char_length(v_title) < 8 then
    raise exception 'Write a short title.';
  end if;
  perform public.assert_no_contact(v_title);
  return json_build_object(
    'service', v_service,
    'town', v_town,
    'state', v_state,
    'summary', v_summary,
    'title', v_title
  );
end;
$fn$;

create or replace function public.assert_map_point(p_lat double precision, p_lng double precision)
returns void
language plpgsql
immutable
set search_path = ''
as $fn$
begin
  if p_lat is null or p_lng is null
     or p_lat < 24 or p_lat > 50
     or p_lng < -125 or p_lng > -66 then
    raise exception 'That location is outside the area this app accepts. Check the address or try location again.';
  end if;
end;
$fn$;

create or replace function public.clean_address(p_address text)
returns text
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v text;
begin
  if p_address is null then
    return null;
  end if;
  v := replace(p_address, chr(92), '');
  v := regexp_replace(v, '[[:space:]]+', ' ', 'g');
  v := btrim(v);
  if v = '' then
    return null;
  end if;
  if char_length(v) > 180 then
    v := rtrim(left(v, 180));
  end if;
  return v;
end;
$fn$;

create or replace function public.distance_meters(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
)
returns double precision
language sql
immutable
set search_path = ''
as $fn$
  select 2 * 6378137 * asin(sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
  ));
$fn$;

create or replace function public.destination_point(
  p_lat double precision,
  p_lng double precision,
  p_distance_m double precision,
  p_bearing_rad double precision
)
returns table (lat double precision, lng double precision)
language sql
immutable
set search_path = ''
as $fn$
  with params as (
    select
      p_lat * pi() / 180 as lat1,
      p_lng * pi() / 180 as lng1,
      p_distance_m / 6378137 as ang,
      p_bearing_rad as bearing
  ),
  dest as (
    select
      asin(
        sin(lat1) * cos(ang) + cos(lat1) * sin(ang) * cos(bearing)
      ) as lat2,
      lng1,
      lat1,
      ang,
      bearing
    from params
  )
  select
    degrees(lat2) as lat,
    degrees(
      lng1 + atan2(
        sin(bearing) * sin(ang) * cos(lat1),
        cos(ang) - sin(lat1) * sin(lat2)
      )
    ) as lng
  from dest;
$fn$;

create or replace function public.offset_pin(p_lat double precision, p_lng double precision)
returns table (lat double precision, lng double precision)
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_dist double precision := 150 + random() * 100;
  v_bearing double precision := random() * (2 * pi());
  v_lat double precision;
  v_lng double precision;
begin
  select d.lat, d.lng into v_lat, v_lng
  from public.destination_point(p_lat, p_lng, v_dist, v_bearing) as d;
  return query select v_lat, v_lng;
end;
$fn$;

create or replace function public.clean_gbp(p_url text)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v text := nullif(btrim(coalesce(p_url, '')), '');
begin
  if v is null then
    return null;
  end if;
  if v !~ '^https://[A-Za-z0-9.-]+/' or position('@' in v) > 0 or char_length(v) > 400 then
    raise exception 'The Google link must start with https://.';
  end if;
  return v;
end;
$fn$;

-- New logins from the dashboard start disabled until the admin SQL turns Kent on.
-- The in-app Add person action sets app.creating_staff for this transaction only.
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Blocks the signed-in API roles from editing tables directly.
-- Security-definer functions run as the database owner, so the app's checked actions still work.
create or replace function public.block_direct_write()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if tg_op is null then
    raise exception 'Not allowed.';
  end if;
  if current_user in ('anon', 'authenticated', 'authenticator') then
    raise exception 'Direct changes are blocked. Use the app.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_table_name in ('jobs', 'profiles') then
    new.updated_at := now();
  end if;
  return new;
end;
$fn$;

drop trigger if exists jobs_block_direct_write on public.jobs;
create trigger jobs_block_direct_write
  before update or delete on public.jobs
  for each row execute function public.block_direct_write();

drop trigger if exists profiles_block_direct_write on public.profiles;
create trigger profiles_block_direct_write
  before update or delete on public.profiles
  for each row execute function public.block_direct_write();

drop trigger if exists locations_block_direct_write on public.job_locations;
create trigger locations_block_direct_write
  before update or delete on public.job_locations
  for each row execute function public.block_direct_write();

drop trigger if exists photos_block_direct_write on public.job_photos;
create trigger photos_block_direct_write
  before update or delete on public.job_photos
  for each row execute function public.block_direct_write();

alter table public.profiles enable row level security;
alter table public.jobs enable row level security;
alter table public.job_locations enable row level security;
alter table public.job_photos enable row level security;

drop policy if exists profiles_select_own_or_staff on public.profiles;
create policy profiles_select_own_or_staff
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid() or public.is_approver());

drop policy if exists jobs_select_own_or_staff on public.jobs;
create policy jobs_select_own_or_staff
  on public.jobs
  for select
  to authenticated
  using (
    public.can_read_job(created_by)
  );

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

drop policy if exists job_locations_select_staff_only on public.job_locations;
create policy job_locations_select_staff_only
  on public.job_locations
  for select
  to authenticated
  using (public.is_approver());

create or replace function public.create_job(
  p_service text,
  p_town text,
  p_state text,
  p_summary text,
  p_job_date date,
  p_exact_lat double precision,
  p_exact_lng double precision,
  p_address text
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_profile public.profiles;
  v_copy json;
  v_id text;
  v_address text;
begin
  v_profile := public.assert_role(
    array['trainee', 'lead_man', 'approver', 'admin'],
    'You do not have permission to post a job.'
  );
  if p_job_date is null
     or p_job_date < current_date - 400
     or p_job_date > current_date + 1 then
    raise exception 'Check the date of the job.';
  end if;
  perform public.assert_map_point(p_exact_lat, p_exact_lng);
  v_address := public.clean_address(p_address);
  v_copy := public.prepare_copy(p_service, p_town, p_state, p_summary, null);
  insert into public.jobs (
    created_by, status, service, town, state, title, summary, job_date,
    public_lat, public_lng, source
  ) values (
    v_profile.id,
    'pending',
    v_copy ->> 'service',
    v_copy ->> 'town',
    v_copy ->> 'state',
    v_copy ->> 'title',
    v_copy ->> 'summary',
    p_job_date,
    null,
    null,
    'app'
  )
  returning id into v_id;

  insert into public.job_locations (job_id, exact_lat, exact_lng, address)
  values (v_id, p_exact_lat, p_exact_lng, v_address);

  return v_id;
end;
$fn$;

create or replace function public.attach_photo(p_job_id text, p_storage_path text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_profile public.profiles;
  v_status text;
  v_owner uuid;
  v_count integer;
  v_file text;
  v_prefix text;
  v_id uuid;
begin
  v_profile := public.assert_role(
    array['trainee', 'lead_man', 'approver', 'admin'],
    'You do not have permission to add a photo.'
  );
  select status, created_by into v_status, v_owner
  from public.jobs
  where id = p_job_id;
  if v_owner is distinct from v_profile.id or v_status is distinct from 'pending' then
    raise exception 'You can only add photos to your own new job.';
  end if;
  v_prefix := v_profile.id::text || '/' || p_job_id || '/';
  v_file := regexp_replace(coalesce(p_storage_path, ''), '^.*/', '');
  if p_storage_path is null
     or position('..' in p_storage_path) > 0
     or p_storage_path <> v_prefix || v_file
     or v_file !~ '^[0-9]{1,2}\.webp$' then
    raise exception 'Photo path is not valid.';
  end if;
  select count(*) into v_count from public.job_photos where job_id = p_job_id;
  if v_count >= 8 then
    raise exception '8 photos is the limit for one job.';
  end if;
  insert into public.job_photos (job_id, storage_path, sort_order)
  values (p_job_id, p_storage_path, v_count)
  returning id into v_id;
  return v_id;
end;
$fn$;

create or replace function public.delete_own_job(p_job_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_profile public.profiles;
  v_status text;
  v_owner uuid;
begin
  v_profile := public.assert_role(
    array['trainee', 'lead_man', 'approver', 'admin'],
    'You do not have permission to delete that job.'
  );
  select status, created_by into v_status, v_owner
  from public.jobs
  where id = p_job_id;
  if v_owner is distinct from v_profile.id or v_status not in ('pending', 'rejected') then
    raise exception 'You can only delete your own job before it is on the website.';
  end if;
  delete from public.jobs where id = p_job_id;
end;
$fn$;

create or replace function public.approve_job(
  p_job_id text,
  p_title text,
  p_summary text,
  p_service text,
  p_town text,
  p_state text,
  p_job_date date,
  p_photo_ids uuid[],
  p_public_urls text[],
  p_review_name text,
  p_review_stars integer,
  p_review_text text,
  p_review_date date,
  p_gbp_url text
)
returns json
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_profile public.profiles;
  v_job public.jobs;
  v_exact_lat double precision;
  v_exact_lng double precision;
  v_copy json;
  v_review json;
  v_gbp text;
  v_pub_lat double precision;
  v_pub_lng double precision;
  v_dist double precision;
  v_try integer;
  v_url text;
begin
  v_profile := public.assert_role(
    array['approver', 'admin'],
    'Only Kent or Haley can approve jobs.'
  );
  select * into v_job from public.jobs where id = p_job_id;
  if not found then
    raise exception 'That job was not found.';
  end if;
  if v_job.status <> 'pending' then
    raise exception 'Only a waiting job can be approved.';
  end if;
  if p_job_date is null or p_job_date < date '2015-01-01' or p_job_date > current_date + 1 then
    raise exception 'Check the date of the job.';
  end if;
  select exact_lat, exact_lng into v_exact_lat, v_exact_lng
  from public.job_locations
  where job_id = p_job_id;
  if v_exact_lat is null then
    raise exception 'This job has no saved location, so it cannot be approved.';
  end if;
  if p_photo_ids is null
     or p_public_urls is null
     or cardinality(p_photo_ids) < 1
     or cardinality(p_photo_ids) <> cardinality(p_public_urls) then
    raise exception 'Add at least one photo before approving.';
  end if;
  if (select count(*) from public.job_photos where job_id = p_job_id) <> cardinality(p_photo_ids) then
    raise exception 'Include every photo, with the main photo first.';
  end if;
  if exists (
    select 1
    from unnest(p_photo_ids) as pid
    where not exists (
      select 1 from public.job_photos p where p.id = pid and p.job_id = p_job_id
    )
  ) then
    raise exception 'Those photos do not belong to this job.';
  end if;
  foreach v_url in array p_public_urls loop
    perform public.assert_public_photo_url(v_url);
  end loop;

  v_copy := public.prepare_copy(p_service, p_town, p_state, p_summary, p_title);
  v_review := public.clean_review(p_review_name, p_review_stars, p_review_text, p_review_date);
  v_gbp := public.clean_gbp(p_gbp_url);

  v_dist := 0;
  for v_try in 1..8 loop
    select d.lat, d.lng into v_pub_lat, v_pub_lng
    from public.offset_pin(v_exact_lat, v_exact_lng) as d;
    v_dist := public.distance_meters(v_exact_lat, v_exact_lng, v_pub_lat, v_pub_lng);
    exit when v_dist >= 150 and v_dist <= 250;
  end loop;
  if v_dist < 150 or v_dist > 250 then
    raise exception 'Could not place the public pin safely. Try again.';
  end if;

  update public.job_photos as p
  set sort_order = 10 + u.ord,
      public_url = public.assert_public_photo_url(u.url)
  from unnest(p_photo_ids, p_public_urls) with ordinality as u(id, url, ord)
  where p.id = u.id
    and p.job_id = p_job_id;

  update public.job_photos as p
  set sort_order = u.ord - 1
  from unnest(p_photo_ids) with ordinality as u(id, ord)
  where p.id = u.id
    and p.job_id = p_job_id;

  update public.jobs
  set status = 'approved',
      service = v_copy ->> 'service',
      town = v_copy ->> 'town',
      state = v_copy ->> 'state',
      title = v_copy ->> 'title',
      summary = v_copy ->> 'summary',
      job_date = p_job_date,
      public_lat = v_pub_lat,
      public_lng = v_pub_lng,
      review_name = v_review ->> 'name',
      review_stars = (v_review ->> 'stars')::integer,
      review_text = v_review ->> 'text',
      review_date = (v_review ->> 'date')::date,
      gbp_url = v_gbp,
      rejection_reason = null,
      approved_at = now(),
      approved_by = v_profile.id
  where id = p_job_id;

  return json_build_object(
    'id', p_job_id,
    'publicLat', round(v_pub_lat::numeric, 5)::double precision,
    'publicLng', round(v_pub_lng::numeric, 5)::double precision
  );
end;
$fn$;

create or replace function public.update_approved_job(
  p_job_id text,
  p_title text,
  p_summary text,
  p_service text,
  p_town text,
  p_state text,
  p_job_date date,
  p_photo_ids uuid[],
  p_review_name text,
  p_review_stars integer,
  p_review_text text,
  p_review_date date,
  p_gbp_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_job public.jobs;
  v_copy json;
  v_review json;
begin
  perform public.assert_role(
    array['approver', 'admin'],
    'Only Kent or Haley can edit jobs on the website.'
  );
  select * into v_job from public.jobs where id = p_job_id;
  if not found or v_job.status <> 'approved' then
    raise exception 'Only a website job can be edited this way.';
  end if;
  if p_job_date is null or p_job_date < date '2015-01-01' or p_job_date > current_date + 1 then
    raise exception 'Check the date of the job.';
  end if;
  if p_photo_ids is null
     or cardinality(p_photo_ids) < 1
     or (select count(*) from public.job_photos where job_id = p_job_id) <> cardinality(p_photo_ids) then
    raise exception 'Keep every photo, with the main photo first.';
  end if;
  if exists (
    select 1
    from unnest(p_photo_ids) as pid
    where not exists (
      select 1 from public.job_photos p where p.id = pid and p.job_id = p_job_id
    )
  ) then
    raise exception 'Those photos do not belong to this job.';
  end if;
  v_copy := public.prepare_copy(p_service, p_town, p_state, p_summary, p_title);
  v_review := public.clean_review(p_review_name, p_review_stars, p_review_text, p_review_date);

  update public.job_photos as p
  set sort_order = 10 + u.ord
  from unnest(p_photo_ids) with ordinality as u(id, ord)
  where p.id = u.id and p.job_id = p_job_id;

  update public.job_photos as p
  set sort_order = u.ord - 1
  from unnest(p_photo_ids) with ordinality as u(id, ord)
  where p.id = u.id and p.job_id = p_job_id;

  update public.jobs
  set service = v_copy ->> 'service',
      town = v_copy ->> 'town',
      state = v_copy ->> 'state',
      title = v_copy ->> 'title',
      summary = v_copy ->> 'summary',
      job_date = p_job_date,
      review_name = v_review ->> 'name',
      review_stars = (v_review ->> 'stars')::integer,
      review_text = v_review ->> 'text',
      review_date = (v_review ->> 'date')::date,
      gbp_url = public.clean_gbp(p_gbp_url)
  where id = p_job_id;
end;
$fn$;

create or replace function public.reject_job(p_job_id text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_reason text;
  v_status text;
begin
  perform public.assert_role(
    array['approver', 'admin'],
    'Only Kent or Haley can reject jobs.'
  );
  select status into v_status from public.jobs where id = p_job_id;
  if v_status is distinct from 'pending' then
    raise exception 'Only a waiting job can be rejected.';
  end if;
  v_reason := public.clean_text(p_reason, 300);
  if v_reason is null or char_length(v_reason) < 3 then
    raise exception 'Write a short reason so the crew can fix it.';
  end if;
  update public.jobs
  set status = 'rejected',
      rejection_reason = v_reason
  where id = p_job_id;
end;
$fn$;

create or replace function public.withdraw_job(p_job_id text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_reason text;
  v_status text;
begin
  perform public.assert_role(
    array['approver', 'admin'],
    'Only Kent or Haley can take a job off the website.'
  );
  select status into v_status from public.jobs where id = p_job_id;
  if v_status is distinct from 'approved' then
    raise exception 'That job is not on the website.';
  end if;
  v_reason := public.clean_text(p_reason, 300);
  if v_reason is null or char_length(v_reason) < 3 then
    raise exception 'Write a short reason for taking it off the website.';
  end if;
  update public.jobs
  set status = 'rejected',
      rejection_reason = v_reason
  where id = p_job_id;
end;
$fn$;

create or replace function public.republish_job(p_job_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_job public.jobs;
begin
  perform public.assert_role(
    array['approver', 'admin'],
    'Only Kent or Haley can put a job back on the website.'
  );
  select * into v_job from public.jobs where id = p_job_id;
  if not found or v_job.status <> 'rejected' or v_job.public_lat is null then
    raise exception 'This job cannot go back on the website.';
  end if;
  update public.jobs
  set status = 'approved',
      rejection_reason = null,
      approved_at = coalesce(approved_at, now()),
      approved_by = coalesce(approved_by, auth.uid())
  where id = p_job_id;
end;
$fn$;

create or replace function public.import_jobs(p_kind text, p_jobs json)
returns json
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  item json;
  v_id text;
  v_status text;
  v_copy json;
  v_review json;
  v_lat double precision;
  v_lng double precision;
  v_exact_lat double precision;
  v_exact_lng double precision;
  v_address text;
  v_reason text;
  v_date date;
  v_photo text;
  v_ord integer;
  v_exists boolean;
  imported integer := 0;
  skipped integer := 0;
  errors jsonb := '[]'::jsonb;
begin
  perform public.assert_role(
    array['approver', 'admin'],
    'Only Kent or Haley can import jobs.'
  );
  if p_kind not in ('public', 'backup') then
    raise exception 'Import type must be public or backup.';
  end if;
  if p_jobs is null or json_typeof(p_jobs) <> 'array' then
    raise exception 'Import file must be a list of jobs.';
  end if;
  if json_array_length(p_jobs) > 500 then
    raise exception 'Import up to 500 jobs at a time.';
  end if;

  for item in select value from json_array_elements(p_jobs)
  loop
    begin
      v_id := btrim(item ->> 'id');
      if v_id is null or v_id !~ '^[A-Za-z0-9_-]{1,80}$' then
        raise exception 'Each job needs an id made of letters, numbers, dashes, or underscores.';
      end if;
      select exists (select 1 from public.jobs where id = v_id) into v_exists;
      if v_exists then
        skipped := skipped + 1;
      else
      if json_typeof(item -> 'photos') is distinct from 'array' then
        raise exception 'photos must be a list.';
      end if;
      if json_array_length(item -> 'photos') > 8 then
        raise exception '8 photos is the limit for one job.';
      end if;

      if p_kind = 'public' then
        v_status := 'approved';
        v_exact_lat := null;
        v_exact_lng := null;
        v_address := null;
        v_reason := null;
      else
        v_status := coalesce(item ->> 'status', 'approved');
        if v_status not in ('pending', 'approved', 'rejected') then
          raise exception 'Status must be pending, approved, or rejected.';
        end if;
        if item ->> 'exactLat' is null or item ->> 'exactLng' is null then
          v_exact_lat := null;
          v_exact_lng := null;
        else
          v_exact_lat := (item ->> 'exactLat')::double precision;
          v_exact_lng := (item ->> 'exactLng')::double precision;
          perform public.assert_map_point(v_exact_lat, v_exact_lng);
        end if;
        v_address := public.clean_address(item ->> 'address');
        v_reason := public.clean_text(item ->> 'rejectionReason', 300);
      end if;

      if item ->> 'lat' is null or item ->> 'lng' is null or item ->> 'lat' = '' then
        v_lat := null;
        v_lng := null;
      else
        v_lat := (item ->> 'lat')::double precision;
        v_lng := (item ->> 'lng')::double precision;
        perform public.assert_map_point(v_lat, v_lng);
      end if;
      if v_status = 'pending' and (v_lat is not null or v_lng is not null) then
        raise exception 'A pending job cannot include a public pin.';
      end if;
      if v_status = 'approved' and (v_lat is null or v_lng is null) then
        raise exception 'An approved job needs a map pin.';
      end if;

      v_date := (item ->> 'date')::date;
      if v_date is null or v_date < date '2015-01-01' or v_date > current_date + 1 then
        raise exception 'Check the date of the job.';
      end if;
      v_copy := public.prepare_copy(
        item ->> 'service',
        item ->> 'town',
        item ->> 'state',
        item ->> 'summary',
        item ->> 'title'
      );
      if item -> 'review' is null or json_typeof(item -> 'review') = 'null' then
        v_review := null;
      else
        v_review := public.clean_review(
          item -> 'review' ->> 'name',
          (item -> 'review' ->> 'stars')::integer,
          item -> 'review' ->> 'text',
          (item -> 'review' ->> 'date')::date
        );
      end if;

      insert into public.jobs (
        id, created_by, status, service, town, state, title, summary, job_date,
        public_lat, public_lng, review_name, review_stars, review_text, review_date,
        gbp_url, rejection_reason, source, approved_at, approved_by
      ) values (
        v_id,
        auth.uid(),
        v_status,
        v_copy ->> 'service',
        v_copy ->> 'town',
        v_copy ->> 'state',
        v_copy ->> 'title',
        v_copy ->> 'summary',
        v_date,
        v_lat,
        v_lng,
        v_review ->> 'name',
        (v_review ->> 'stars')::integer,
        v_review ->> 'text',
        (v_review ->> 'date')::date,
        public.clean_gbp(item ->> 'gbpUrl'),
        case when v_status = 'rejected' then v_reason else null end,
        'import',
        case when v_status = 'approved' or v_lat is not null then now() else null end,
        case when v_status = 'approved' or v_lat is not null then auth.uid() else null end
      );

      if v_exact_lat is not null then
        insert into public.job_locations (job_id, exact_lat, exact_lng, address)
        values (v_id, v_exact_lat, v_exact_lng, v_address);
      end if;

      v_ord := 0;
      for v_photo in select value from json_array_elements_text(item -> 'photos')
      loop
        if v_photo !~ '^https://[A-Za-z0-9.-]+/'
           or position('@' in v_photo) > 0
           or position(chr(92) in v_photo) > 0
           or char_length(v_photo) > 500 then
          raise exception 'Each photo must be an https link.';
        end if;
        insert into public.job_photos (job_id, storage_path, public_url, sort_order)
        values (v_id, 'imported/' || v_id || '/' || v_ord::text, v_photo, v_ord);
        v_ord := v_ord + 1;
      end loop;

      if to_regprocedure('public.import_job_videos(text, json)') is not null
         and json_typeof(item -> 'videos') = 'array' then
        perform public.import_job_videos(v_id, item -> 'videos');
      end if;

      imported := imported + 1;
      end if;
    exception
      when others then
        errors := errors || jsonb_build_array(
          jsonb_build_object('id', coalesce(item ->> 'id', ''), 'message', sqlerrm)
        );
    end;
  end loop;

  return json_build_object('imported', imported, 'skipped', skipped, 'errors', errors);
end;
$fn$;

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

create or replace function public.admin_set_disabled(p_user_id uuid, p_disabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_caller public.profiles;
  v_role text;
  v_admins integer;
begin
  v_caller := public.assert_role(array['admin'], 'Only an admin can turn logins on or off.');
  if p_user_id = v_caller.id and p_disabled then
    raise exception 'You cannot turn off your own login.';
  end if;
  select role into v_role from public.profiles where id = p_user_id;
  if v_role is null then
    raise exception 'That person was not found.';
  end if;
  select count(*) into v_admins
  from public.profiles
  where role = 'admin' and disabled = false;
  if p_disabled and v_role = 'admin' and v_admins <= 1 then
    raise exception 'Keep at least one admin turned on.';
  end if;
  update public.profiles set disabled = p_disabled where id = p_user_id;
  begin
    update auth.users
    set banned_until = case
      when p_disabled then now() + interval '100 years'
      else null
    end
    where id = p_user_id;
  exception
    when undefined_column then
      null;
  end;
end;
$fn$;

-- BEGIN PUBLIC FEED
-- Newest approved jobs first. Shifted pin only. No street address and no poster.
create or replace function public.public_jobs_feed()
returns json
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
    (
      select json_agg(item.obj order by item.approved_at desc nulls last, item.created_at desc)
      from (
        select
          j.approved_at,
          j.created_at,
          json_build_object(
            'id', j.id,
            'title', j.title,
            'service', j.service,
            'town', j.town,
            'state', j.state,
            'lat', round(j.public_lat::numeric, 5)::double precision,
            'lng', round(j.public_lng::numeric, 5)::double precision,
            'date', to_char(j.job_date, 'YYYY-MM-DD'),
            'summary', j.summary,
            'photos', coalesce((
              select json_agg(p.public_url order by p.sort_order)
              from public.job_photos p
              where p.job_id = j.id
                and p.public_url is not null
            ), '[]'::json),
            'review', case
              when j.review_name is null then null
              else json_build_object(
                'name', j.review_name,
                'stars', j.review_stars,
                'text', coalesce(j.review_text, ''),
                'date', to_char(j.review_date, 'YYYY-MM-DD')
              )
            end,
            'gbpUrl', j.gbp_url
          ) as obj
        from public.jobs j
        where j.status = 'approved'
          and j.public_lat is not null
          and j.public_lng is not null
      ) item
    ),
    '[]'::json
  );
$fn$;

drop view if exists public.approved_jobs;
create view public.approved_jobs
with (security_barrier = true, security_invoker = true) as
select
  elem ->> 'id' as id,
  elem ->> 'title' as title,
  elem ->> 'service' as service,
  elem ->> 'town' as town,
  elem ->> 'state' as state,
  (elem ->> 'lat')::double precision as lat,
  (elem ->> 'lng')::double precision as lng,
  elem ->> 'date' as date,
  elem ->> 'summary' as summary,
  elem -> 'photos' as photos,
  elem -> 'review' as review,
  elem ->> 'gbpUrl' as "gbpUrl"
from json_array_elements(public.public_jobs_feed()) as elem;

comment on function public.public_jobs_feed() is
  'Public read-only feed of approved jobs. Returns shifted pins only, newest first.';
-- END PUBLIC FEED

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.jobs from anon, authenticated;
revoke all on table public.job_locations from anon, authenticated;
revoke all on table public.job_photos from anon, authenticated;
grant select on table public.profiles to authenticated;
grant select on table public.jobs to authenticated;
grant select on table public.job_locations to authenticated;
grant select on table public.job_photos to authenticated;

revoke all on table public.approved_jobs from public, anon, authenticated;
grant select on table public.approved_jobs to anon, authenticated;

do $do$
declare
  r record;
  allow_auth text[] := array[
    'create_job', 'attach_photo', 'delete_own_job',
    'approve_job', 'reject_job', 'withdraw_job', 'republish_job', 'update_approved_job', 'move_exact_pin',
    'import_jobs', 'admin_create_user', 'admin_set_role', 'admin_set_disabled',
    'public_jobs_feed', 'is_active', 'is_approver', 'is_field_role', 'role_is_field', 'can_post', 'can_read_job'
  ];
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname = 'public_jobs_feed' then
      execute format('grant execute on function %s to anon, authenticated', r.sig);
    elsif r.proname = any (allow_auth) then
      execute format('grant execute on function %s to authenticated', r.sig);
    elsif r.proname in ('handle_new_user', 'block_direct_write') then
      execute format('grant execute on function %s to authenticated, anon', r.sig);
    end if;
  end loop;
end
$do$;

do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.handle_new_user() to supabase_auth_admin;
  end if;
end
$do$;

grant execute on function public.handle_new_user() to public;

notify pgrst, 'reload schema';
