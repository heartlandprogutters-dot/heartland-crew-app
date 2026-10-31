-- Heartland Crew videos.
-- Run this third, after the storage file.
-- Safe to run again.
--
-- Clips are trimmed to 30 seconds on the phone before upload.
-- job-videos-private holds them until approval.
-- job-videos is public, same idea as the photo bucket.
-- Each file must stay under 20 MB (the free plan allows 50 MB per file).

create table if not exists public.job_videos (
  id uuid primary key default gen_random_uuid(),
  job_id text not null references public.jobs (id) on delete cascade,
  storage_path text not null,
  public_url text,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  constraint job_videos_order_unique unique (job_id, sort_order) deferrable initially deferred,
  constraint job_videos_sort_check check (sort_order >= 0 and sort_order < 4),
  constraint job_videos_path_len check (char_length(storage_path) between 3 and 300)
);

create index if not exists job_videos_job_idx on public.job_videos (job_id, sort_order);

drop trigger if exists videos_block_direct_write on public.job_videos;
create trigger videos_block_direct_write
  before update or delete on public.job_videos
  for each row execute function public.block_direct_write();

alter table public.job_videos enable row level security;

drop policy if exists job_videos_select_own_or_staff on public.job_videos;
create policy job_videos_select_own_or_staff
  on public.job_videos
  for select
  to authenticated
  using (
    public.is_active()
    and exists (
      select 1
      from public.jobs j
      where j.id = job_id
        and public.can_read_job(j.created_by)
    )
  );

revoke all on table public.job_videos from anon, authenticated;
grant select on table public.job_videos to authenticated;

create or replace function public.assert_public_video_url(p_url text)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
begin
  if p_url is null
     or p_url !~ '^https://[A-Za-z0-9.-]+/storage/v1/object/public/job-videos/[a-z0-9.-]+\.(mp4|webm)$'
     or position('..' in p_url) > 0
     or position('@' in p_url) > 0 then
    raise exception 'Video link must be a public mp4 or webm file in video storage.';
  end if;
  return p_url;
end;
$fn$;

create or replace function public.attach_video(p_job_id text, p_storage_path text)
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
    'You do not have permission to add a video.'
  );
  select status, created_by into v_status, v_owner
  from public.jobs
  where id = p_job_id;
  if v_owner is distinct from v_profile.id or v_status is distinct from 'pending' then
    raise exception 'You can only add a video to your own new job.';
  end if;
  v_prefix := v_profile.id::text || '/' || p_job_id || '/';
  v_file := regexp_replace(coalesce(p_storage_path, ''), '^.*/', '');
  if p_storage_path is null
     or position('..' in p_storage_path) > 0
     or p_storage_path <> v_prefix || v_file
     or v_file !~ '^v[0-9]{1,2}\.(mp4|webm)$' then
    raise exception 'Video path is not valid.';
  end if;
  select count(*) into v_count from public.job_videos where job_id = p_job_id;
  if v_count >= 2 then
    raise exception '2 videos is the limit for one job.';
  end if;
  insert into public.job_videos (job_id, storage_path, sort_order)
  values (p_job_id, p_storage_path, v_count)
  returning id into v_id;
  return v_id;
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

  update public.job_videos as v
  set sort_order = (1 + u.ord)::integer,
      public_url = public.assert_public_video_url(u.url)
  from unnest(p_video_ids, p_public_urls) with ordinality as u(id, url, ord)
  where v.id = u.id
    and v.job_id = p_job_id;

  update public.job_videos as v
  set sort_order = (u.ord - 1)::integer
  from unnest(p_video_ids) with ordinality as u(id, ord)
  where v.id = u.id
    and v.job_id = p_job_id;
end;
$fn$;

create or replace function public.remove_job_video(p_video_id uuid)
returns json
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_path text;
  v_url text;
begin
  perform public.assert_role(
    array['approver', 'admin'],
    'Only Kent or Haley can remove a video.'
  );
  select storage_path, public_url into v_path, v_url
  from public.job_videos
  where id = p_video_id;
  if v_path is null then
    raise exception 'That video was not found.';
  end if;
  delete from public.job_videos where id = p_video_id;
  return json_build_object('storagePath', v_path, 'publicUrl', v_url);
end;
$fn$;

create or replace function public.import_job_videos(p_job_id text, p_videos json)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_url text;
  v_ord integer := 0;
begin
  perform public.assert_role(
    array['approver', 'admin'],
    'Only Kent or Haley can import videos.'
  );
  if p_videos is null or json_typeof(p_videos) <> 'array' then
    return;
  end if;
  if json_array_length(p_videos) > 2 then
    raise exception '2 videos is the limit for one job.';
  end if;
  for v_url in select value from json_array_elements_text(p_videos)
  loop
    if v_url !~ '^https://[A-Za-z0-9.-]+/'
       or v_url !~ '\.(mp4|webm)$'
       or position('@' in v_url) > 0
       or position(chr(92) in v_url) > 0
       or char_length(v_url) > 500 then
      raise exception 'Each video must be an https mp4 or webm link.';
    end if;
    insert into public.job_videos (job_id, storage_path, public_url, sort_order)
    values (p_job_id, 'imported/' || p_job_id || '/v' || v_ord::text, v_url, v_ord);
    v_ord := v_ord + 1;
  end loop;
end;
$fn$;

-- BEGIN PUBLIC FEED
-- Newest approved jobs first. Shifted pin only. No street address and no poster.
-- videos is an extra list. Every older field stays in the same order.
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
            'gbpUrl', j.gbp_url,
            'videos', coalesce((
              select json_agg(v.public_url order by v.sort_order)
              from public.job_videos v
              where v.job_id = j.id
                and v.public_url is not null
            ), '[]'::json)
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
  elem ->> 'gbpUrl' as "gbpUrl",
  elem -> 'videos' as videos
from json_array_elements(public.public_jobs_feed()) as elem;

comment on function public.public_jobs_feed() is
  'Public read-only feed of approved jobs. Returns shifted pins only, newest first, plus optional video links.';
-- END PUBLIC FEED

revoke all on table public.approved_jobs from public, anon, authenticated;
grant select on table public.approved_jobs to anon, authenticated;

do $do$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'attach_video', 'publish_job_videos', 'remove_job_video',
        'import_job_videos', 'assert_public_video_url', 'public_jobs_feed'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname = 'public_jobs_feed' then
      execute format('grant execute on function %s to anon, authenticated', r.sig);
    elsif r.proname in ('attach_video', 'publish_job_videos', 'remove_job_video', 'import_job_videos') then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end
$do$;

-- Hosted Supabase already enables row level security on storage.objects.
-- Do not ALTER storage.objects or storage.buckets here. The SQL Editor is not
-- the owner of those tables.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('job-videos-private', 'job-videos-private', false, 20971520, array['video/mp4', 'video/webm']::text[]),
  ('job-videos', 'job-videos', true, 20971520, array['video/mp4', 'video/webm']::text[])
on conflict (id) do nothing;

drop policy if exists crew_read_own_private_videos on storage.objects;
create policy crew_read_own_private_videos
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'job-videos-private'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists approver_read_private_videos on storage.objects;
create policy approver_read_private_videos
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'job-videos-private'
    and public.is_approver()
  );

drop policy if exists crew_upload_own_private_videos on storage.objects;
create policy crew_upload_own_private_videos
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'job-videos-private'
    and (storage.foldername(name))[1] = auth.uid()::text
    and name ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{1,80}/v[0-9]{1,2}\.(mp4|webm)$'
    and position('..' in name) = 0
  );

drop policy if exists crew_delete_own_private_videos on storage.objects;
create policy crew_delete_own_private_videos
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'job-videos-private'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists approver_delete_private_videos on storage.objects;
create policy approver_delete_private_videos
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'job-videos-private'
    and public.is_approver()
  );

drop policy if exists public_read_job_videos on storage.objects;
create policy public_read_job_videos
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'job-videos');

drop policy if exists approver_upload_public_videos on storage.objects;
create policy approver_upload_public_videos
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'job-videos'
    and public.is_approver()
    and position('/' in name) = 0
    and position('..' in name) = 0
    and name ~ '^[a-z0-9-]{3,80}-[0-9]{4}-[0-9]{2}-[0-9]{2}-video-[0-9]{1,2}(-[a-z0-9]{4})?\.(mp4|webm)$'
  );

drop policy if exists approver_delete_public_videos on storage.objects;
create policy approver_delete_public_videos
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'job-videos'
    and public.is_approver()
  );

notify pgrst, 'reload schema';
