-- Let an approver move the private house pin.
-- The website pin (public_lat / public_lng) is not changed.
-- Run this once in the Supabase SQL Editor after the video migration.
-- It is safe to run again.

create or replace function public.move_exact_pin(
  p_job_id text,
  p_exact_lat double precision,
  p_exact_lng double precision
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform public.assert_role(
    array['approver', 'admin'],
    'Only Kent or Haley can move the house pin.'
  );
  if not exists (select 1 from public.jobs where id = p_job_id) then
    raise exception 'That job was not found.';
  end if;
  perform public.assert_map_point(p_exact_lat, p_exact_lng);
  update public.job_locations
  set exact_lat = p_exact_lat,
      exact_lng = p_exact_lng
  where job_id = p_job_id;
  if not found then
    insert into public.job_locations (job_id, exact_lat, exact_lng, address)
    values (p_job_id, p_exact_lat, p_exact_lng, null);
  end if;
end;
$fn$;

revoke all on function public.move_exact_pin(text, double precision, double precision) from public, anon, authenticated;
grant execute on function public.move_exact_pin(text, double precision, double precision) to authenticated;

notify pgrst, 'reload schema';
