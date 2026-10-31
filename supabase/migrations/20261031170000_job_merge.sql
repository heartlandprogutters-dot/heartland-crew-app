-- Combine posts of the same house.
-- Run this once in the Supabase SQL Editor after 20261031160000_delete_job.sql.
-- Safe to run again.
--
-- A trainee's post attaches to the one matching lead man job.
-- The lead's job keeps the photos and videos. The trainee's post is marked
-- merged and is not reviewed on its own. Two leads, or two people in the
-- same role, stay separate until Kent or Haley tap Merge.
-- Field roles still read only their own jobs. The trainee sees a note on
-- their own row, not the lead's job.

alter table public.jobs add column if not exists merged_into text;
alter table public.jobs add column if not exists merge_note text;
alter table public.jobs add column if not exists new_photos boolean not null default false;

alter table public.job_locations add column if not exists exif_lat double precision;
alter table public.job_locations add column if not exists exif_lng double precision;
alter table public.job_locations add column if not exists exif_taken_at timestamptz;

alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs add constraint jobs_status_check
  check (status in ('pending', 'approved', 'rejected', 'merged'));

alter table public.jobs drop constraint if exists jobs_merge_self;
alter table public.jobs add constraint jobs_merge_self
  check (merged_into is null or merged_into <> id);

do $fk$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'jobs_merged_into_fkey'
  ) then
    alter table public.jobs
      add constraint jobs_merged_into_fkey
      foreign key (merged_into) references public.jobs (id) on delete cascade;
  end if;
end
$fk$;

alter table public.job_photos drop constraint if exists job_photos_sort_check;
alter table public.job_photos add constraint job_photos_sort_check
  check (sort_order >= 0 and sort_order < 40);

alter table public.job_videos drop constraint if exists job_videos_sort_check;
alter table public.job_videos add constraint job_videos_sort_check
  check (sort_order >= 0 and sort_order < 12);

create table if not exists public.job_contributors (
  id uuid primary key default gen_random_uuid(),
  job_id text not null references public.jobs (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  display_name text not null,
  child_job_id text,
  created_at timestamptz not null default now(),
  constraint job_contributors_child_unique unique (job_id, child_job_id),
  constraint job_contributors_name_len check (char_length(display_name) between 1 and 80)
);

create index if not exists job_contributors_job_idx on public.job_contributors (job_id);

drop trigger if exists contributors_block_direct_write on public.job_contributors;
create trigger contributors_block_direct_write
  before update or delete on public.job_contributors
  for each row execute function public.block_direct_write();

alter table public.job_contributors enable row level security;

drop policy if exists job_contributors_select on public.job_contributors;
create policy job_contributors_select
  on public.job_contributors
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

revoke all on table public.job_contributors from anon, authenticated;
grant select on table public.job_contributors to authenticated;

create or replace function public.person_first_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select coalesce(
    nullif((regexp_match(btrim(coalesce(p_name, '')), '^([A-Za-z]+)'))[1], ''),
    'the lead'
  );
$fn$;

create or replace function public.jobs_match(p_a text, p_b text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  a public.jobs;
  b public.jobs;
  a_lat double precision;
  a_lng double precision;
  a_exif_lat double precision;
  a_exif_lng double precision;
  a_exif_time timestamptz;
  b_lat double precision;
  b_lng double precision;
  b_exif_lat double precision;
  b_exif_lng double precision;
  b_exif_time timestamptz;
  close_enough boolean := false;
begin
  if p_a is null or p_b is null or p_a = p_b then
    return false;
  end if;
  select * into a from public.jobs where id = p_a;
  select * into b from public.jobs where id = p_b;
  if a.id is null or b.id is null then
    return false;
  end if;
  if a.status not in ('pending', 'approved') or b.status not in ('pending', 'approved') then
    return false;
  end if;
  select exact_lat, exact_lng, exif_lat, exif_lng, exif_taken_at
    into a_lat, a_lng, a_exif_lat, a_exif_lng, a_exif_time
  from public.job_locations where job_id = a.id;
  select exact_lat, exact_lng, exif_lat, exif_lng, exif_taken_at
    into b_lat, b_lng, b_exif_lat, b_exif_lng, b_exif_time
  from public.job_locations where job_id = b.id;

  if a_lat is not null and b_lat is not null
     and public.distance_meters(a_lat, a_lng, b_lat, b_lng) <= 150 then
    close_enough := true;
  end if;
  if a_lat is not null and b_exif_lat is not null
     and public.distance_meters(a_lat, a_lng, b_exif_lat, b_exif_lng) <= 150 then
    close_enough := true;
  end if;
  if a_exif_lat is not null and b_lat is not null
     and public.distance_meters(a_exif_lat, a_exif_lng, b_lat, b_lng) <= 150 then
    close_enough := true;
  end if;
  if a_exif_lat is not null and b_exif_lat is not null
     and public.distance_meters(a_exif_lat, a_exif_lng, b_exif_lat, b_exif_lng) <= 150 then
    close_enough := true;
  end if;
  if not close_enough then
    return false;
  end if;

  if a.job_date = b.job_date then
    return true;
  end if;
  if (a.created_at at time zone 'America/Chicago')::date = (b.created_at at time zone 'America/Chicago')::date then
    return true;
  end if;
  if abs(extract(epoch from (a.created_at - b.created_at))) <= 12 * 3600 then
    return true;
  end if;
  if a_exif_time is not null and b_exif_time is not null
     and abs(extract(epoch from (a_exif_time - b_exif_time))) <= 12 * 3600 then
    return true;
  end if;
  if a_exif_time is not null
     and abs(extract(epoch from (a_exif_time - b.created_at))) <= 12 * 3600 then
    return true;
  end if;
  if b_exif_time is not null
     and abs(extract(epoch from (b_exif_time - a.created_at))) <= 12 * 3600 then
    return true;
  end if;
  if a_exif_time is not null
     and (a_exif_time at time zone 'America/Chicago')::date = b.job_date then
    return true;
  end if;
  if b_exif_time is not null
     and (b_exif_time at time zone 'America/Chicago')::date = a.job_date then
    return true;
  end if;
  return false;
end;
$fn$;

create or replace function public.absorb_job(p_child text, p_parent text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_child public.jobs;
  v_parent public.jobs;
  v_owner_name text;
  v_child_name text;
  v_note text;
  v_photo uuid;
  v_video uuid;
  v_next integer;
  v_moved integer := 0;
begin
  if p_child is null or p_parent is null or p_child = p_parent then
    raise exception 'Pick two different jobs.';
  end if;
  select * into v_child from public.jobs where id = p_child;
  select * into v_parent from public.jobs where id = p_parent;
  if v_child.id is null or v_parent.id is null then
    raise exception 'That job was not found.';
  end if;
  if v_child.status = 'merged' or v_parent.status = 'merged' then
    raise exception 'That post is already combined.';
  end if;
  if v_child.status not in ('pending', 'approved') or v_parent.status not in ('pending', 'approved') then
    raise exception 'Only a waiting or approved job can be combined.';
  end if;
  if not public.jobs_match(p_child, p_parent) then
    raise exception 'These jobs are not the same house on the same day.';
  end if;

  select display_name into v_owner_name from public.profiles where id = v_parent.created_by;
  select display_name into v_child_name from public.profiles where id = v_child.created_by;
  v_note := 'added to ' || public.person_first_name(v_owner_name) || '''s job';

  select coalesce(max(sort_order), -1) + 1 into v_next
  from public.job_photos where job_id = p_parent;
  for v_photo in
    select id from public.job_photos where job_id = p_child order by sort_order, created_at
  loop
    if v_next >= 40 then
      raise exception 'That job already has too many photos to add more.';
    end if;
    update public.job_photos set job_id = p_parent, sort_order = v_next where id = v_photo;
    v_next := v_next + 1;
    v_moved := v_moved + 1;
  end loop;

  select coalesce(max(sort_order), -1) + 1 into v_next
  from public.job_videos where job_id = p_parent;
  for v_video in
    select id from public.job_videos where job_id = p_child order by sort_order, created_at
  loop
    if v_next >= 12 then
      raise exception 'That job already has too many videos to add more.';
    end if;
    update public.job_videos set job_id = p_parent, sort_order = v_next where id = v_video;
    v_next := v_next + 1;
    v_moved := v_moved + 1;
  end loop;

  update public.jobs
  set merged_into = p_parent,
      merge_note = v_note
  where merged_into = p_child;

  update public.job_contributors
  set job_id = p_parent
  where job_id = p_child;

  if v_child.created_by is not null then
    insert into public.job_contributors (job_id, profile_id, display_name, child_job_id)
    values (
      p_parent,
      v_child.created_by,
      coalesce(nullif(btrim(v_child_name), ''), 'Crew'),
      p_child
    )
    on conflict (job_id, child_job_id) do nothing;
  end if;

  update public.jobs
  set status = 'merged',
      merged_into = p_parent,
      merge_note = v_note,
      new_photos = false
  where id = p_child;

  if v_parent.status = 'approved' and v_moved > 0 then
    update public.jobs set new_photos = true where id = p_parent;
  end if;
end;
$fn$;

create or replace function public.settle_job(
  p_job_id text,
  p_exif_lat double precision,
  p_exif_lng double precision,
  p_exif_taken_at timestamptz
)
returns json
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_profile public.profiles;
  v_job public.jobs;
  v_lead text;
  v_lead_count integer;
  v_other_leads integer;
  v_trainee text;
  v_names jsonb := '[]'::jsonb;
  v_who text;
  v_note text;
  v_status text;
begin
  v_profile := public.assert_role(
    array['trainee', 'lead_man', 'approver', 'admin'],
    'You do not have permission to post a job.'
  );
  select * into v_job from public.jobs where id = p_job_id;
  if v_job.id is null then
    raise exception 'That job was not found.';
  end if;
  if v_job.created_by is distinct from v_profile.id then
    raise exception 'You can only finish your own job.';
  end if;
  if v_job.status is distinct from 'pending' then
    raise exception 'This job is already finished.';
  end if;

  if p_exif_lat is not null and p_exif_lng is not null
     and p_exif_lat between 24 and 50
     and p_exif_lng between -125 and -66 then
    update public.job_locations
    set exif_lat = p_exif_lat,
        exif_lng = p_exif_lng,
        exif_taken_at = p_exif_taken_at
    where job_id = p_job_id;
  elsif p_exif_taken_at is not null then
    update public.job_locations
    set exif_taken_at = p_exif_taken_at
    where job_id = p_job_id;
  end if;

  if v_profile.role = 'trainee' then
    select count(*) into v_lead_count
    from public.jobs j
    join public.profiles p on p.id = j.created_by
    where p.role = 'lead_man'
      and j.status in ('pending', 'approved')
      and public.jobs_match(p_job_id, j.id);
    if v_lead_count = 1 then
      select j.id into v_lead
      from public.jobs j
      join public.profiles p on p.id = j.created_by
      where p.role = 'lead_man'
        and j.status in ('pending', 'approved')
        and public.jobs_match(p_job_id, j.id);
      perform public.absorb_job(p_job_id, v_lead);
    end if;
  elsif v_profile.role = 'lead_man' then
    select count(*) into v_other_leads
    from public.jobs j
    join public.profiles p on p.id = j.created_by
    where j.id <> p_job_id
      and p.role = 'lead_man'
      and j.status in ('pending', 'approved')
      and public.jobs_match(p_job_id, j.id);
    if v_other_leads = 0 then
      for v_trainee, v_who in
        select j.id, pr.display_name
        from public.jobs j
        join public.profiles pr on pr.id = j.created_by
        where pr.role = 'trainee'
          and j.status = 'pending'
          and public.jobs_match(p_job_id, j.id)
      loop
        perform public.absorb_job(v_trainee, p_job_id);
        v_names := v_names || jsonb_build_array(coalesce(v_who, 'Crew'));
      end loop;
    end if;
  end if;

  select status, merge_note into v_status, v_note from public.jobs where id = p_job_id;
  return json_build_object(
    'id', p_job_id,
    'status', v_status,
    'mergeNote', v_note,
    'absorbed', v_names
  );
end;
$fn$;

create or replace function public.merge_jobs(p_primary text, p_child text)
returns json
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform public.assert_role(
    array['approver', 'admin'],
    'Only Kent or Haley can combine jobs.'
  );
  perform public.absorb_job(p_child, p_primary);
  return json_build_object('primary', p_primary, 'child', p_child);
end;
$fn$;

create or replace function public.remove_review_photo(p_photo_id uuid)
returns json
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_path text;
  v_url text;
  v_public text;
begin
  perform public.assert_role(
    array['approver', 'admin'],
    'Only Kent or Haley can remove a photo.'
  );
  select storage_path, public_url into v_path, v_url
  from public.job_photos
  where id = p_photo_id;
  if v_path is null and v_url is null then
    raise exception 'That photo was not found.';
  end if;
  if v_url is not null and position('/job-photos/' in v_url) > 0 then
    v_public := split_part(regexp_replace(v_url, '^.*/job-photos/', ''), '?', 1);
  end if;
  delete from public.job_photos where id = p_photo_id;
  return json_build_object(
    'storagePath', v_path,
    'publicName', v_public
  );
end;
$fn$;

create or replace function public.publish_new_photos(
  p_job_id text,
  p_photo_ids uuid[],
  p_public_urls text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_job public.jobs;
  v_url text;
  v_base integer;
begin
  perform public.assert_role(
    array['approver', 'admin'],
    'Only Kent or Haley can publish photos.'
  );
  select * into v_job from public.jobs where id = p_job_id;
  if v_job.id is null or v_job.status is distinct from 'approved' then
    raise exception 'Only a website job can get new photos this way.';
  end if;
  if p_photo_ids is null or cardinality(p_photo_ids) = 0 then
    if exists (select 1 from public.job_photos where job_id = p_job_id and public_url is null) then
      raise exception 'Include every new photo.';
    end if;
    update public.jobs set new_photos = false where id = p_job_id;
    return;
  end if;
  if p_public_urls is null or cardinality(p_photo_ids) <> cardinality(p_public_urls) then
    raise exception 'Each new photo needs a public link.';
  end if;
  if (select count(*) from public.job_photos where job_id = p_job_id and public_url is null) <> cardinality(p_photo_ids) then
    raise exception 'Include every new photo.';
  end if;
  if exists (
    select 1
    from unnest(p_photo_ids) as pid
    where not exists (
      select 1 from public.job_photos p
      where p.id = pid and p.job_id = p_job_id and p.public_url is null
    )
  ) then
    raise exception 'Those photos do not belong to this job.';
  end if;
  foreach v_url in array p_public_urls loop
    perform public.assert_public_photo_url(v_url);
  end loop;

  select coalesce(max(sort_order), -1) into v_base
  from public.job_photos
  where job_id = p_job_id and public_url is not null;

  update public.job_photos as p
  set public_url = public.assert_public_photo_url(u.url),
      sort_order = v_base + u.ord
  from unnest(p_photo_ids, p_public_urls) with ordinality as u(id, url, ord)
  where p.id = u.id
    and p.job_id = p_job_id;

  update public.jobs set new_photos = false where id = p_job_id;
end;
$fn$;

create or replace function public.publish_job_videos(
  p_job_id text,
  p_video_ids uuid[],
  p_public_urls text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
  v_url text;
  v_base integer;
begin
  perform public.assert_role(
    array['approver', 'admin'],
    'Only Kent or Haley can publish videos.'
  );
  select status into v_status from public.jobs where id = p_job_id;
  if v_status is distinct from 'approved' then
    raise exception 'Approve the job before its video goes on the website.';
  end if;
  if p_video_ids is null or p_public_urls is null or cardinality(p_video_ids) = 0 then
    return;
  end if;
  if cardinality(p_video_ids) <> cardinality(p_public_urls) then
    raise exception 'Each video needs a public link.';
  end if;
  if (select count(*) from public.job_videos where job_id = p_job_id and public_url is null) <> cardinality(p_video_ids) then
    raise exception 'Include every video that is not on the website yet.';
  end if;
  if exists (
    select 1
    from unnest(p_video_ids) as vid
    where not exists (
      select 1 from public.job_videos v
      where v.id = vid and v.job_id = p_job_id and v.public_url is null
    )
  ) then
    raise exception 'Those videos do not belong to this job.';
  end if;
  foreach v_url in array p_public_urls loop
    perform public.assert_public_video_url(v_url);
  end loop;

  select coalesce(max(sort_order), -1) into v_base
  from public.job_videos
  where job_id = p_job_id and public_url is not null;

  update public.job_videos as v
  set public_url = public.assert_public_video_url(u.url),
      sort_order = v_base + u.ord
  from unnest(p_video_ids, p_public_urls) with ordinality as u(id, url, ord)
  where v.id = u.id
    and v.job_id = p_job_id;
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
  if v_owner is distinct from v_profile.id then
    raise exception 'You can only delete your own job before it is on the website.';
  end if;
  if v_status = 'merged' then
    raise exception 'This post was combined with the lead''s job.';
  end if;
  if v_status not in ('pending', 'rejected') then
    raise exception 'You can only delete your own job before it is on the website.';
  end if;
  delete from public.jobs where id = p_job_id;
end;
$fn$;

revoke all on function public.person_first_name(text) from public, anon, authenticated;
revoke all on function public.jobs_match(text, text) from public, anon, authenticated;
revoke all on function public.absorb_job(text, text) from public, anon, authenticated;
revoke all on function public.settle_job(text, double precision, double precision, timestamptz) from public, anon, authenticated;
revoke all on function public.merge_jobs(text, text) from public, anon, authenticated;
revoke all on function public.remove_review_photo(uuid) from public, anon, authenticated;
revoke all on function public.publish_new_photos(text, uuid[], text[]) from public, anon, authenticated;

grant execute on function public.settle_job(text, double precision, double precision, timestamptz) to authenticated;
grant execute on function public.merge_jobs(text, text) to authenticated;
grant execute on function public.remove_review_photo(uuid) to authenticated;
grant execute on function public.publish_new_photos(text, uuid[], text[]) to authenticated;

notify pgrst, 'reload schema';
