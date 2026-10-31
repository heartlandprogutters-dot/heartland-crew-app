-- Social feed for the Heartland Social agent.
-- Run this once in the Supabase SQL Editor after 20261031170000_job_merge.sql.
-- Safe to run again.
--
-- The anon key can read public_social_feed. It returns approved jobs only.
-- It does not return street addresses, exact pins, poster names, or review names.
-- Town-level lat/lng are the website pin rounded to 2 decimals.
--
-- The agent writes status with set_social_status and a token. Set the token
-- yourself. Do not paste a real token into the app or into git.
--
-- insert into public.app_settings (key, value)
-- values (
--   'social_token_hash',
--   extensions.crypt('PASTE_A_LONG_RANDOM_TOKEN_HERE', extensions.gen_salt('bf'))
-- )
-- on conflict (key) do update set value = excluded.value;

alter table public.jobs add column if not exists social_status text not null default 'pending';
alter table public.jobs add column if not exists privacy_checked boolean not null default false;

alter table public.jobs drop constraint if exists jobs_social_status_check;
alter table public.jobs add constraint jobs_social_status_check
  check (social_status in ('pending', 'building', 'awaiting_kent', 'scheduled', 'posted', 'skip'));

alter table public.job_photos add column if not exists stage text;
alter table public.job_photos add column if not exists original_path text;
alter table public.job_photos add column if not exists original_url text;

alter table public.job_photos drop constraint if exists job_photos_stage_check;
alter table public.job_photos add constraint job_photos_stage_check
  check (stage is null or stage in ('before', 'during', 'after'));

alter table public.job_videos add column if not exists original_path text;
alter table public.job_videos add column if not exists original_url text;
alter table public.job_videos add column if not exists width integer;
alter table public.job_videos add column if not exists height integer;
alter table public.job_videos add column if not exists duration_s double precision;

alter table public.job_videos drop constraint if exists job_videos_size_check;
alter table public.job_videos add constraint job_videos_size_check
  check (
    (width is null or width between 1 and 8000)
    and (height is null or height between 1 and 8000)
    and (duration_s is null or (duration_s > 0 and duration_s <= 60 * 180))
  );

create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  constraint app_settings_key_check check (key ~ '^[a-z0-9_]{1,40}$'),
  constraint app_settings_value_len check (char_length(value) between 1 and 500)
);

alter table public.app_settings enable row level security;
revoke all on table public.app_settings from anon, authenticated;

-- Do not ALTER storage tables. New buckets only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('job-photos-original-private', 'job-photos-original-private', false, 8388608, array['image/webp']::text[]),
  ('job-photos-original', 'job-photos-original', true, 8388608, array['image/webp']::text[]),
  ('job-videos-original-private', 'job-videos-original-private', false, 52428800, array['video/mp4', 'video/webm']::text[]),
  ('job-videos-original', 'job-videos-original', true, 52428800, array['video/mp4', 'video/webm']::text[])
on conflict (id) do nothing;

drop policy if exists crew_upload_original_photos on storage.objects;
create policy crew_upload_original_photos
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'job-photos-original-private'
    and (storage.foldername(name))[1] = auth.uid()::text
    and name ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{1,80}/o[0-9]{1,2}\.webp$'
    and position('..' in name) = 0
  );

drop policy if exists crew_read_own_original_photos on storage.objects;
create policy crew_read_own_original_photos
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'job-photos-original-private'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists approver_read_original_photos on storage.objects;
create policy approver_read_original_photos
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'job-photos-original-private'
    and public.is_approver()
  );

drop policy if exists approver_delete_original_photos on storage.objects;
create policy approver_delete_original_photos
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'job-photos-original-private'
    and public.is_approver()
  );

drop policy if exists public_read_original_photos on storage.objects;
create policy public_read_original_photos
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'job-photos-original');

drop policy if exists approver_upload_original_photos on storage.objects;
create policy approver_upload_original_photos
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'job-photos-original'
    and public.is_approver()
    and position('/' in name) = 0
    and position('..' in name) = 0
    and name ~ '^[a-z0-9-]{3,120}-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{1,2}-full(-[a-z0-9]{4})?\.webp$'
  );

drop policy if exists crew_upload_original_videos on storage.objects;
create policy crew_upload_original_videos
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'job-videos-original-private'
    and (storage.foldername(name))[1] = auth.uid()::text
    and name ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{1,80}/full[0-9]{1,2}\.(mp4|webm)$'
    and position('..' in name) = 0
  );

drop policy if exists crew_read_own_original_videos on storage.objects;
create policy crew_read_own_original_videos
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'job-videos-original-private'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists approver_read_original_videos on storage.objects;
create policy approver_read_original_videos
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'job-videos-original-private'
    and public.is_approver()
  );

drop policy if exists approver_delete_original_videos on storage.objects;
create policy approver_delete_original_videos
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'job-videos-original-private'
    and public.is_approver()
  );

drop policy if exists public_read_original_videos on storage.objects;
create policy public_read_original_videos
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'job-videos-original');

drop policy if exists approver_upload_original_videos on storage.objects;
create policy approver_upload_original_videos
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'job-videos-original'
    and public.is_approver()
    and position('/' in name) = 0
    and position('..' in name) = 0
    and name ~ '^[a-z0-9-]{3,120}-[0-9]{4}-[0-9]{2}-[0-9]{2}-video-[0-9]{1,2}-full(-[a-z0-9]{4})?\.(mp4|webm)$'
  );

create or replace function public.save_photo_extra(
  p_photo_id uuid,
  p_stage text,
  p_original_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_profile public.profiles;
  v_job_id text;
  v_owner uuid;
  v_status text;
  v_stage text;
begin
  v_profile := public.assert_role(
    array['trainee', 'lead_man', 'approver', 'admin'],
    'You do not have permission to update a photo.'
  );
  select job_id into v_job_id from public.job_photos where id = p_photo_id;
  if v_job_id is null then
    raise exception 'That photo was not found.';
  end if;
  select created_by, status into v_owner, v_status from public.jobs where id = v_job_id;
  if v_owner is distinct from v_profile.id or v_status is distinct from 'pending' then
    raise exception 'You can only update photos on your own new job.';
  end if;
  v_stage := nullif(btrim(coalesce(p_stage, '')), '');
  if v_stage is not null and v_stage not in ('before', 'during', 'after') then
    raise exception 'Stage must be before, during, or after.';
  end if;
  if p_original_path is not null and (
    position('..' in p_original_path) > 0
    or p_original_path !~ ('^' || v_profile.id::text || '/' || v_job_id || '/o[0-9]{1,2}\.webp$')
  ) then
    raise exception 'Original photo path is not valid.';
  end if;
  update public.job_photos
  set stage = v_stage,
      original_path = p_original_path
  where id = p_photo_id;
end;
$fn$;

create or replace function public.save_video_extra(
  p_video_id uuid,
  p_width integer,
  p_height integer,
  p_duration_s double precision,
  p_original_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_profile public.profiles;
  v_job_id text;
  v_owner uuid;
  v_status text;
begin
  v_profile := public.assert_role(
    array['trainee', 'lead_man', 'approver', 'admin'],
    'You do not have permission to update a video.'
  );
  select job_id into v_job_id from public.job_videos where id = p_video_id;
  if v_job_id is null then
    raise exception 'That video was not found.';
  end if;
  select created_by, status into v_owner, v_status from public.jobs where id = v_job_id;
  if v_owner is distinct from v_profile.id or v_status is distinct from 'pending' then
    raise exception 'You can only update videos on your own new job.';
  end if;
  if p_original_path is not null and (
    position('..' in p_original_path) > 0
    or p_original_path !~ ('^' || v_profile.id::text || '/' || v_job_id || '/full[0-9]{1,2}\.(mp4|webm)$')
  ) then
    raise exception 'Original video path is not valid.';
  end if;
  update public.job_videos
  set width = p_width,
      height = p_height,
      duration_s = p_duration_s,
      original_path = p_original_path
  where id = p_video_id;
end;
$fn$;

create or replace function public.assert_original_photo_url(p_url text)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
begin
  if p_url is null
     or p_url !~ '^https://[A-Za-z0-9.-]+/storage/v1/object/public/job-photos-original/[a-z0-9.-]+\.webp$'
     or position('..' in p_url) > 0
     or position('@' in p_url) > 0 then
    raise exception 'Original photo link must be a public WebP file in original photo storage.';
  end if;
  return p_url;
end;
$fn$;

create or replace function public.assert_original_video_url(p_url text)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
begin
  if p_url is null
     or p_url !~ '^https://[A-Za-z0-9.-]+/storage/v1/object/public/job-videos-original/[a-z0-9.-]+\.(mp4|webm)$'
     or position('..' in p_url) > 0
     or position('@' in p_url) > 0 then
    raise exception 'Original video link must be a public mp4 or webm file in original video storage.';
  end if;
  return p_url;
end;
$fn$;

create or replace function public.publish_photo_original(p_photo_id uuid, p_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform public.assert_role(array['approver', 'admin'], 'Only Kent or Haley can publish photos.');
  if not exists (select 1 from public.job_photos where id = p_photo_id) then
    raise exception 'That photo was not found.';
  end if;
  update public.job_photos
  set original_url = public.assert_original_photo_url(p_url)
  where id = p_photo_id;
end;
$fn$;

create or replace function public.publish_video_original(p_video_id uuid, p_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform public.assert_role(array['approver', 'admin'], 'Only Kent or Haley can publish videos.');
  if not exists (select 1 from public.job_videos where id = p_video_id) then
    raise exception 'That video was not found.';
  end if;
  update public.job_videos
  set original_url = public.assert_original_video_url(p_url)
  where id = p_video_id;
end;
$fn$;

create or replace function public.set_privacy_checked(p_job_id text, p_checked boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform public.assert_role(array['approver', 'admin'], 'Only Kent or Haley can mark privacy.');
  if not exists (select 1 from public.jobs where id = p_job_id and status in ('pending', 'approved')) then
    raise exception 'That job was not found.';
  end if;
  update public.jobs
  set privacy_checked = coalesce(p_checked, false)
  where id = p_job_id;
end;
$fn$;

create or replace function public.set_social_skip(p_job_id text, p_skip boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
  v_social text;
begin
  perform public.assert_role(array['approver', 'admin'], 'Only Kent or Haley can change social posting.');
  select status, social_status into v_status, v_social from public.jobs where id = p_job_id;
  if v_status is distinct from 'approved' then
    raise exception 'Only a website job can be kept off social.';
  end if;
  if coalesce(p_skip, false) then
    update public.jobs set social_status = 'skip' where id = p_job_id;
  elsif v_social = 'skip' then
    update public.jobs set social_status = 'pending' where id = p_job_id;
  end if;
end;
$fn$;

create or replace function public.set_social_status(p_job_id text, p_status text, p_token text)
returns json
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_hash text;
  v_status text;
  v_private text[] := array[]::text[];
  v_photo_names text[] := array[]::text[];
  v_video_names text[] := array[]::text[];
begin
  if p_status is null or p_status not in ('pending', 'building', 'awaiting_kent', 'scheduled', 'posted', 'skip') then
    raise exception 'Status must be pending, building, awaiting_kent, scheduled, posted, or skip.';
  end if;
  select value into v_hash from public.app_settings where key = 'social_token_hash';
  if v_hash is null or p_token is null or extensions.crypt(p_token, v_hash) is distinct from v_hash then
    raise exception 'Social token was not accepted.';
  end if;
  select status into v_status from public.jobs where id = p_job_id;
  if v_status is distinct from 'approved' then
    raise exception 'That job was not found.';
  end if;

  update public.jobs set social_status = p_status where id = p_job_id;

  if p_status in ('posted', 'skip') then
    select coalesce(array_agg(original_path), array[]::text[]) into v_private
    from (
      select original_path from public.job_photos
      where job_id = p_job_id and original_path is not null
      union all
      select original_path from public.job_videos
      where job_id = p_job_id and original_path is not null
    ) paths;
    select coalesce(array_agg(split_part(regexp_replace(original_url, '^.*/', ''), '?', 1)), array[]::text[])
      into v_photo_names
    from public.job_photos
    where job_id = p_job_id and original_url is not null and position('/job-photos-original/' in original_url) > 0;
    select coalesce(array_agg(split_part(regexp_replace(original_url, '^.*/', ''), '?', 1)), array[]::text[])
      into v_video_names
    from public.job_videos
    where job_id = p_job_id and original_url is not null and position('/job-videos-original/' in original_url) > 0;
    begin
      delete from storage.objects
      where (bucket_id in ('job-photos-original-private', 'job-videos-original-private') and name = any (v_private))
         or (bucket_id = 'job-photos-original' and name = any (v_photo_names))
         or (bucket_id = 'job-videos-original' and name = any (v_video_names));
    exception
      when insufficient_privilege or undefined_table then
        null;
    end;
    update public.job_photos
    set original_path = null, original_url = null
    where job_id = p_job_id;
    update public.job_videos
    set original_path = null, original_url = null
    where job_id = p_job_id;
  end if;

  return json_build_object('job_id', p_job_id, 'social_status', p_status);
end;
$fn$;

create or replace function public.public_social_feed(p_status text default 'pending')
returns json
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_status text;
begin
  v_status := nullif(btrim(coalesce(p_status, '')), '');
  if v_status is null or v_status = 'all' then
    v_status := null;
  elsif v_status not in ('pending', 'building', 'awaiting_kent', 'scheduled', 'posted', 'skip') then
    raise exception 'Status must be pending, building, awaiting_kent, scheduled, posted, skip, or all.';
  end if;

  return coalesce(
    (
      select json_agg(item.obj order by item.approved_at desc nulls last)
      from (
        select
          j.approved_at,
          json_build_object(
            'job_id', j.id,
            'approved_at', j.approved_at,
            'service', j.service,
            'town', j.town,
            'state', j.state,
            'title', j.title,
            'summary', j.summary,
            'photos', coalesce((
              select json_agg(
                json_build_object(
                  'url', coalesce(p.original_url, p.public_url),
                  'caption_hint', concat_ws(' ',
                    case p.stage
                      when 'before' then 'Before.'
                      when 'during' then 'During.'
                      when 'after' then 'After.'
                      else null
                    end,
                    j.service,
                    'in',
                    j.town || ',',
                    j.state
                  ),
                  'stage', p.stage
                )
                order by p.sort_order
              )
              from public.job_photos p
              where p.job_id = j.id
                and coalesce(p.original_url, p.public_url) is not null
            ), '[]'::json),
            'videos', coalesce((
              select json_agg(
                json_build_object(
                  'url', v.original_url,
                  'trim_url', v.public_url,
                  'width', v.width,
                  'height', v.height,
                  'duration_s', case when v.duration_s is null then null else round(v.duration_s::numeric, 1) end
                )
                order by v.sort_order
              )
              from public.job_videos v
              where v.job_id = j.id
                and (v.original_url is not null or v.public_url is not null)
            ), '[]'::json),
            'social_status', j.social_status,
            'privacy_checked', j.privacy_checked,
            'lat', round(j.public_lat::numeric, 2),
            'lng', round(j.public_lng::numeric, 2)
          ) as obj
        from public.jobs j
        where j.status = 'approved'
          and j.public_lat is not null
          and j.public_lng is not null
          and (v_status is null or j.social_status = v_status)
      ) item
    ),
    '[]'::json
  );
end;
$fn$;

create or replace function public.delete_job(p_job_id text)
returns json
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_private_photos json;
  v_public_photos json;
  v_private_videos json;
  v_public_videos json;
  v_original_photos json;
  v_original_videos json;
begin
  perform public.assert_role(
    array['approver', 'admin'],
    'Only Kent or Haley can delete a job.'
  );
  if p_job_id is null or not exists (select 1 from public.jobs where id = p_job_id) then
    raise exception 'That job was not found.';
  end if;

  select coalesce(json_agg(storage_path), '[]'::json) into v_private_photos
  from public.job_photos
  where job_id = p_job_id and storage_path is not null
    and storage_path not like 'imported/%' and storage_path not like 'http%';
  select coalesce(json_agg(original_path), '[]'::json) into v_original_photos
  from public.job_photos
  where job_id = p_job_id and original_path is not null;
  select coalesce(json_agg(split_part(regexp_replace(public_url, '^.*/', ''), '?', 1)), '[]'::json)
    into v_public_photos
  from public.job_photos
  where job_id = p_job_id and public_url is not null and position('/job-photos/' in public_url) > 0;
  select coalesce(json_agg(storage_path), '[]'::json) into v_private_videos
  from public.job_videos
  where job_id = p_job_id and storage_path is not null
    and storage_path not like 'imported/%' and storage_path not like 'http%';
  select coalesce(json_agg(original_path), '[]'::json) into v_original_videos
  from public.job_videos
  where job_id = p_job_id and original_path is not null;
  select coalesce(json_agg(split_part(regexp_replace(public_url, '^.*/', ''), '?', 1)), '[]'::json)
    into v_public_videos
  from public.job_videos
  where job_id = p_job_id and public_url is not null and position('/job-videos/' in public_url) > 0;

  delete from public.jobs where id = p_job_id;
  return json_build_object(
    'privatePhotos', v_private_photos,
    'publicPhotos', v_public_photos,
    'privateVideos', v_private_videos,
    'publicVideos', v_public_videos,
    'originalPhotos', v_original_photos,
    'originalVideos', v_original_videos
  );
end;
$fn$;

revoke all on function public.save_photo_extra(uuid, text, text) from public, anon, authenticated;
revoke all on function public.save_video_extra(uuid, integer, integer, double precision, text) from public, anon, authenticated;
revoke all on function public.assert_original_photo_url(text) from public, anon, authenticated;
revoke all on function public.assert_original_video_url(text) from public, anon, authenticated;
revoke all on function public.publish_photo_original(uuid, text) from public, anon, authenticated;
revoke all on function public.publish_video_original(uuid, text) from public, anon, authenticated;
revoke all on function public.set_privacy_checked(text, boolean) from public, anon, authenticated;
revoke all on function public.set_social_skip(text, boolean) from public, anon, authenticated;
revoke all on function public.set_social_status(text, text, text) from public, anon, authenticated;
revoke all on function public.public_social_feed(text) from public, anon, authenticated;

grant execute on function public.save_photo_extra(uuid, text, text) to authenticated;
grant execute on function public.save_video_extra(uuid, integer, integer, double precision, text) to authenticated;
grant execute on function public.publish_photo_original(uuid, text) to authenticated;
grant execute on function public.publish_video_original(uuid, text) to authenticated;
grant execute on function public.set_privacy_checked(text, boolean) to authenticated;
grant execute on function public.set_social_skip(text, boolean) to authenticated;
grant execute on function public.set_social_status(text, text, text) to anon, authenticated;
grant execute on function public.public_social_feed(text) to anon, authenticated;

notify pgrst, 'reload schema';
