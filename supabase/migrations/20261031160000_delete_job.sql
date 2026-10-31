-- Let an approver or admin delete any job.
-- Run this once in the Supabase SQL Editor after 20261031150000_roles.sql.
-- Safe to run again.
--
-- The job row goes away, so it leaves the public map feed.
-- The app then deletes the photo and video files from storage.
-- Trainees and lead men cannot call this.

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
begin
  perform public.assert_role(
    array['approver', 'admin'],
    'Only Kent or Haley can delete a job.'
  );
  if p_job_id is null or not exists (select 1 from public.jobs where id = p_job_id) then
    raise exception 'That job was not found.';
  end if;

  select coalesce(json_agg(storage_path), '[]'::json)
  into v_private_photos
  from public.job_photos
  where job_id = p_job_id
    and storage_path is not null
    and storage_path not like 'imported/%'
    and storage_path not like 'http%';

  select coalesce(json_agg(split_part(regexp_replace(public_url, '^.*/', ''), '?', 1)), '[]'::json)
  into v_public_photos
  from public.job_photos
  where job_id = p_job_id
    and public_url is not null
    and position('/job-photos/' in public_url) > 0;

  select coalesce(json_agg(storage_path), '[]'::json)
  into v_private_videos
  from public.job_videos
  where job_id = p_job_id
    and storage_path is not null
    and storage_path not like 'imported/%'
    and storage_path not like 'http%';

  select coalesce(json_agg(split_part(regexp_replace(public_url, '^.*/', ''), '?', 1)), '[]'::json)
  into v_public_videos
  from public.job_videos
  where job_id = p_job_id
    and public_url is not null
    and position('/job-videos/' in public_url) > 0;

  delete from public.jobs where id = p_job_id;

  return json_build_object(
    'privatePhotos', v_private_photos,
    'publicPhotos', v_public_photos,
    'privateVideos', v_private_videos,
    'publicVideos', v_public_videos
  );
end;
$fn$;

revoke all on function public.delete_job(text) from public, anon, authenticated;
grant execute on function public.delete_job(text) to authenticated;

notify pgrst, 'reload schema';
