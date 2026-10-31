-- Local stand-in for the Supabase auth and storage catalogs.
-- The real project already has these. This file is only for the automated checks.

create schema if not exists auth;
create schema if not exists extensions;

do $do$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$do$;

grant anon to current_user;
grant authenticated to current_user;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

create table if not exists auth.users (
  instance_id uuid,
  id uuid primary key,
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  confirmation_token text,
  recovery_token text,
  email_change text,
  email_change_token_new text,
  email_change_token_current text,
  email_change_confirm_status smallint,
  phone_change text,
  phone_change_token text,
  reauthentication_token text,
  is_sso_user boolean,
  is_anonymous boolean,
  banned_until timestamptz
);

create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  provider_id text,
  user_id uuid,
  identity_data jsonb,
  provider text,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
);

create or replace function extensions.gen_salt(kind text)
returns text
language sql
immutable
as $$ select 'salt' $$;

create or replace function extensions.crypt(pw text, salt text)
returns text
language sql
immutable
as $$ select 'test-hash' $$;

create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text,
  public boolean,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create or replace function storage.foldername(object_name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(regexp_replace(object_name, '/[^/]*$', ''), '/')
$$;

grant usage on schema storage to anon, authenticated;
