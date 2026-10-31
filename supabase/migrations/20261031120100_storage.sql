-- Heartland Crew photo storage.
-- Run this second, after 20261031120000_init.sql.
-- Safe to run again.
--
-- job-photos-private holds pictures until a job is approved.
-- job-photos is the public website bucket. Only approvers can put files there,
-- and only with names like seamless-gutters-murray-2026-11-05-1.webp.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('job-photos-private', 'job-photos-private', false, 204800, array['image/webp']::text[]),
  ('job-photos', 'job-photos', true, 204800, array['image/webp']::text[])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table storage.objects enable row level security;

grant select on storage.objects to anon, authenticated;
grant insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to anon, authenticated;

drop policy if exists crew_read_own_private_photos on storage.objects;
create policy crew_read_own_private_photos
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'job-photos-private'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists approver_read_private_photos on storage.objects;
create policy approver_read_private_photos
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'job-photos-private'
    and public.is_approver()
  );

drop policy if exists crew_upload_own_private_photos on storage.objects;
create policy crew_upload_own_private_photos
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'job-photos-private'
    and (storage.foldername(name))[1] = auth.uid()::text
    and name ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{1,80}/[0-9]{1,2}\.webp$'
    and position('..' in name) = 0
  );

drop policy if exists crew_delete_own_private_photos on storage.objects;
create policy crew_delete_own_private_photos
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'job-photos-private'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists approver_delete_private_photos on storage.objects;
create policy approver_delete_private_photos
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'job-photos-private'
    and public.is_approver()
  );

drop policy if exists public_read_job_photos on storage.objects;
create policy public_read_job_photos
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'job-photos');

drop policy if exists approver_upload_public_photos on storage.objects;
create policy approver_upload_public_photos
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'job-photos'
    and public.is_approver()
    and position('/' in name) = 0
    and position('..' in name) = 0
    and name ~ '^[a-z0-9-]{3,80}-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{1,2}(-[a-z0-9]{4})?\.webp$'
  );

drop policy if exists approver_delete_public_photos on storage.objects;
create policy approver_delete_public_photos
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'job-photos'
    and public.is_approver()
  );

notify pgrst, 'reload schema';
